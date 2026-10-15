import fs from 'node:fs'
import path from 'node:path'
import { db, type StoredLyricSync } from './db'
import { autoLyricSync, isForeignEdit, isStaleLyricSync, parseLrc, type LyricSync } from '../shared/lyrics'
import { isGenericArtist, normalizeTitle } from './coverArt'
import { alignToCaptions } from './captionSync'
import { aiEnabled, alignOffset, identifySong, pickCandidate, writeLyrics } from './ai'
import {
  bestLyricMatch,
  canFetchLyrics,
  parseLyricsText,
  scoreLyricHit,
  songWant,
  type LrclibRecord,
  type SongWant
} from './lyricsText'
import type { CachedLyrics, LyricsResult, Track } from '../shared/types'

/**
 * Lyrics, in priority order:
 *
 *   1. lyrics the user uploaded or pasted (`user` — always wins)
 *   2. a `.lrc` sidecar next to a local file (`sidecar`)
 *   3. a scored match on lrclib.net (`lrclib`), cached per track
 *
 * Automatic lookups only happen for tracks whose name is an actual song title.
 * A local `1.mp3` / `Track 03.wav` has nothing to match, so it is never sent to
 * the network — the panel asks the user for their own lyrics instead.
 *
 * Matching is deliberately forgiving, because local names are messy (site
 * suffixes, bitrates, "(Official Video)", fan-version titles) and lrclib is
 * user-contributed (jobs and fields get swapped, durations are junk). Several
 * cleaned readings of the name are searched, every candidate is scored, and the
 * best one above a confidence bar wins — see `scoreLyricHit`.
 */

const UA = { 'User-Agent': 'Spinity/1.2 (desktop lyrics)' }
const TIMEOUT_MS = 8_000
/** Stop searching as soon as a candidate is this convincing. */
const CONFIDENT = 0.85

function sidecarFor(filePath: string): string | null {
  try {
    const ext = path.extname(filePath)
    const lrc = filePath.slice(0, filePath.length - ext.length) + '.lrc'
    if (fs.existsSync(lrc) && fs.statSync(lrc).isFile()) return lrc
  } catch {}
  return null
}

async function lrclibJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

/** Turn one lrclib record into cached lyrics (synced preferred). */
function toCached(hit: LrclibRecord): CachedLyrics | null {
  if (hit.syncedLyrics) {
    const lines = parseLrc(hit.syncedLyrics)
    if (lines.length > 0) return { synced: true, lines, source: 'lrclib', fetchedAt: Date.now() }
  }
  if (hit.plainLyrics) {
    const lines = parseLyricsText(hit.plainLyrics).lines
    if (lines.length > 0) return { synced: false, lines, source: 'lrclib', fetchedAt: Date.now() }
  }
  return null
}

/**
 * Collect candidate records for a track, cheapest and most precise first.
 *
 * `/api/get` is exact (name + artist + duration) and is the only endpoint that
 * can answer in one request. Everything after it is a fuzzy hunt: the
 * structured search for the primary cleaned name, then the free-text `q=`
 * search for every reading of the name — which is what finds fan versions and
 * records whose title/artist fields were entered the wrong way round.
 */
async function collectCandidates(want: SongWant, artist: string): Promise<LrclibRecord[]> {
  const pool: LrclibRecord[] = []
  const seen = new Set<string>()
  const add = (records: LrclibRecord[]): number => {
    for (const record of records) {
      const key = `${record.id ?? ''}|${record.trackName ?? ''}|${record.artistName ?? ''}|${record.duration ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      pool.push(record)
    }
    return pool.length
  }
  const bestScore = (): number => bestLyricMatch(want, pool)?.score ?? 0

  const primary = want.titles[0]

  // 1. Exact endpoint — name + artist + duration must all line up.
  const get = new URLSearchParams({ artist_name: isGenericArtist(artist) ? '' : artist.trim(), track_name: primary, album_name: '' })
  const duration = Math.round(want.duration)
  if (duration > 0 && duration <= 3600) get.set('duration', String(duration))
  const exact = (await lrclibJson(`https://lrclib.net/api/get?${get.toString()}`)) as LrclibRecord | null
  if (exact?.trackName) {
    add([exact])
    if (bestScore() >= CONFIDENT) return pool
  }

  // 2. Everything else at once: the structured search on the primary name and
  //    the free-text search for every reading of it. These are independent and
  //    each carries its own 8s timeout, so running them one after another made a
  //    hard track's lookup as slow as the *sum* of those timeouts. Firing them
  //    together costs one round trip instead.
  const structured = new URLSearchParams({ track_name: primary })
  if (!isGenericArtist(artist)) structured.set('artist_name', artist.trim())
  const [byName, ...byVariant] = await Promise.all([
    lrclibJson(`https://lrclib.net/api/search?${structured.toString()}`),
    ...want.titles.map((variant) => lrclibJson(`https://lrclib.net/api/search?q=${encodeURIComponent(variant)}`))
  ])
  if (Array.isArray(byName)) add(byName as LrclibRecord[])
  for (const found of byVariant) {
    if (Array.isArray(found)) add((found as LrclibRecord[]).slice(0, 20))
  }

  return pool
}

function describe(
  cached: CachedLyrics,
  canFetch: boolean,
  sync: LyricSync,
  matched: LyricsResult['matched'] = null
): LyricsResult {
  return {
    synced: cached.synced,
    lines: cached.lines,
    source: cached.source,
    canFetch,
    instrumental: false,
    matched,
    sync,
    ai: cached.ai === true
  }
}

/**
 * Let the optional model help when the heuristics are not convincing.
 *
 * Two questions, cheapest first: *which of these records is this file* (a list
 * the scorer already ranked, so the answer is easy to verify) and, if that
 * fails, *what song is this actually* — after which the normal search runs again
 * with a name a database can find. An answer is only used when the scorer rates
 * it at least as highly as the heuristic pick, so the model can improve a match
 * but never invent one.
 */
async function aiRefine(
  track: Track,
  want: SongWant,
  pool: LrclibRecord[],
  current: { hit: LrclibRecord; score: number } | null
): Promise<{ hit: LrclibRecord; score: number } | null> {
  if (!aiEnabled()) return current

  if (pool.length > 1) {
    const pick = await pickCandidate(
      track.id,
      { title: track.title, artist: track.artist, durationSec: track.durationSec },
      pool
    ).catch(() => null)
    if (pick !== null) {
      const chosen = pool[pick]
      const score = scoreLyricHit(want, chosen)
      if (score >= 0.5 && (!current || score >= current.score - 0.15)) {
        return { hit: chosen, score }
      }
    }
  }

  const fileName = track.filePath ? path.basename(track.filePath) : track.title
  const guess = await identifySong(track.id, {
    fileName,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec
  }).catch(() => null)
  if (!guess?.title) return current

  const refinedWant = songWant(guess.title, guess.artist || track.artist, track.durationSec)
  const sameAsBefore =
    normalizeTitle(refinedWant.titles[0]) === normalizeTitle(want.titles[0]) && !guess.artist
  if (sameAsBefore) return current

  const refinedPool = await collectCandidates(refinedWant, guess.artist || track.artist)
  const refined = bestLyricMatch(refinedWant, refinedPool)
  if (refined && (!current || refined.score > current.score)) {
    console.log(
      `[lyrics] AI read "${track.title}" as "${guess.title}" — ${guess.artist || 'unknown artist'} (score ${refined.score.toFixed(2)})`
    )
    return refined
  }
  return current
}

/**
 * True when the user has switched the panel to AI writing mode.
 *
 * Anything other than `'ai'` behaves as normal, so a missing or unexpected
 * setting can only ever fall back to the trusted chain.
 */
function aiWritingMode(): boolean {
  return db.getSettings().lyricsMode === 'ai'
}

/** `1.mp3` has no name to match — the panel offers a manual upload instead. */
function emptyResult(
  canFetch: boolean,
  sync: LyricSync,
  instrumental = false,
  matched: LyricsResult['matched'] = null
): LyricsResult {
  return { synced: false, lines: [], source: 'lrclib', canFetch, instrumental, matched, sync }
}
/**
 * The timing to apply: what the user tuned by hand, or the automatic fit.
 *
 * The auto fit needs the two durations — the local file's (ffprobe) and the
 * matched record's — so it is computed here, where the match is known, rather
 * than in the renderer.
 */
function resolveSync(trackId: string, localDurationSec: number, refDurationSec: number): LyricSync {
  const stored = db.getLyricSync(trackId)
  if (stored) {
    // A stored fit belongs to the recording it was measured against. Dropping
    // it when the match changes is what stops a hand-tuned (or automatic) speed
    // factor from being applied to entirely different line timings.
    if (isStaleLyricSync(stored, refDurationSec)) {
      db.clearLyricSync(trackId)
      console.log(
        `[lyrics] dropped a timing fit for ${trackId} — measured against a ${stored.refDurationSec}s recording, now matched to ${refDurationSec}s`
      )
    } else {
      return {
        offsetMs: stored.offsetMs,
        scale: stored.scale,
        auto: stored.auto ?? false,
        refDurationSec: stored.refDurationSec || refDurationSec,
        source: stored.source,
        alignedAt: stored.alignedAt
      }
    }
  }
  return { ...autoLyricSync(localDurationSec, refDurationSec), source: 'duration' }
}

/**
 * Align this track's lyrics to the recording the user actually has.
 *
 * Two steps, cheapest first: the duration ratio, then — only when the matched
 * entry is a *different edit* of the song — the timed captions of the YouTube
 * video that is this file, matched by length. When lrclib's record is already
 * the same recording (its length matches the file), its timings are already
 * right and aligning again could only add noise. The attempt is remembered,
 * including "tried and found nothing", so this costs one search per track ever.
 */
export async function alignTrackLyrics(trackId: string): Promise<LyricsResult | null> {
  const track = db.findTrackAnywhere(trackId)
  if (!track) return null
  const cached = db.getLyrics(trackId)
  const refDurationSec = cached?.matchedDurationSec ?? 0
  const durationFit = autoLyricSync(track.durationSec, refDurationSec)
  const differentEdit = refDurationSec <= 0 || isForeignEdit(track.durationSec, refDurationSec)

  let record: StoredLyricSync = {
    ...durationFit,
    source: 'duration',
    alignedAt: Date.now(),
    updatedAt: Date.now()
  }

  // Only local files can be matched against a video by length, and only when
  // there is a full set of timed lines and a reason to think they are off.
  if (track.source === 'local' && differentEdit && cached && cached.lines.length >= 3) {
    const want = songWant(track.title, track.artist, track.durationSec)
    const query = isGenericArtist(track.artist) ? want.titles[0] : `${track.artist} ${want.titles[0]}`
    const alignment = await alignToCaptions(query, track.durationSec, cached.lines).catch(() => null)
    if (alignment) {
      let offsetMs = 0
      let scale = 1
      let how = ''

      if (alignment.fit) {
        offsetMs = alignment.fit.offsetMs
        scale = alignment.fit.scale
        how = `${alignment.fit.matches} lines`
      } else {
        // The deterministic fit refused — automatic captions are noisy — but
        // they are still timed to the right audio, so let the model estimate
        // the shift before falling back to the duration ratio.
        const guess = await alignOffset(track.id, cached.lines, alignment.cues).catch(() => null)
        if (typeof guess !== 'number') return finishAlignment(trackId, track, refDurationSec)
        offsetMs = Math.round(guess * 1000)
        how = 'an AI estimate'
      }

      record = {
        offsetMs,
        scale,
        auto: true,
        refDurationSec,
        source: 'captions',
        alignedAt: Date.now(),
        updatedAt: Date.now()
      }
      console.log(
        `[lyrics] aligned "${track.title}" to ${alignment.videoId} (${alignment.videoTitle.slice(0, 40)}) — ` +
          `${offsetMs >= 0 ? '+' : ''}${(offsetMs / 1000).toFixed(2)}s ×${scale} from ${how}`
      )
    }
  }

  db.setLyricSync(trackId, record)
  return getLyrics(trackId)
}

/** Store the duration-only fit and hand back the refreshed result. */
function finishAlignment(trackId: string, track: Track, refDurationSec: number): Promise<LyricsResult | null> {
  const fit = autoLyricSync(track.durationSec, refDurationSec)
  db.setLyricSync(trackId, { ...fit, source: 'duration', alignedAt: Date.now(), updatedAt: Date.now() })
  return getLyrics(trackId)
}

/** Length of the matched recording, for the fit and the "different edit" hint. */
function referenceDuration(trackId: string): number {
  return db.getLyrics(trackId)?.matchedDurationSec ?? 0
}

/**
 * Retire auto-fetched lyrics written by an older matcher.
 *
 * `matchedDurationSec` (which drives the automatic speed fit and the
 * "different edit" hint) only exists in newer entries, the matching itself
 * improved a lot, and the optional AI pass can now read names the heuristics
 * cannot. Dropping the automatic cache costs one lookup per track the user
 * actually opens, and user uploads are never touched.
 */
export const LYRICS_CACHE_VERSION = 3

export function migrateLyricsCache(): number {
  return db.migrateLyricsCache(LYRICS_CACHE_VERSION)
}

/**
 * Lyrics for a track: user upload > sidecar `.lrc` > cache > scored lrclib match.
 *
 * Never throws for "nothing found": the empty result says which of the three
 * cases it is — nothing to search for, an instrumental, or simply no match —
 * so the panel can offer the right next step.
 */
export async function getLyrics(trackId: string): Promise<LyricsResult | null> {
  const track = db.findTrackAnywhere(trackId)
  if (!track) return null

  const canFetch = canFetchLyrics(track.title, track.artist)
  const cached = db.getLyrics(trackId)
  const sync = resolveSync(trackId, track.durationSec, cached?.matchedDurationSec ?? 0)

  // 1. Lyrics the user supplied always win, and are never re-fetched over.
  if (cached?.source === 'user' && cached.lines.length > 0) return describe(cached, canFetch, sync)

  // 2. A sidecar wins over anything auto-fetched and is never cached (edits
  //    show up immediately). Even a junk-named file can have one.
  if (track.filePath) {
    const lrc = sidecarFor(track.filePath)
    if (lrc) {
      try {
        const lines = parseLrc(fs.readFileSync(lrc, 'utf8'))
        if (lines.length > 0) {
          return { synced: true, lines, source: 'sidecar', canFetch, instrumental: false, matched: null, sync }
        }
      } catch {}
    }
  }

  // 3. AI writing mode: the model's own lyrics take the place of the match.
  //    They live in a separate record, so the normal chain below is untouched
  //    and switching back is instant. Anything this mode cannot produce — no
  //    key, a junk name, a refusal, or a failed call — falls through to that
  //    chain instead of showing the user an empty panel.
  if (aiWritingMode() && canFetch) {
    const written = await writeLyrics(track.id, {
      fileName: track.filePath ? path.basename(track.filePath) : track.title,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec
    })
    if (written && written.length > 0) {
      return {
        synced: false,
        lines: written,
        source: 'ai',
        canFetch,
        instrumental: false,
        matched: null,
        sync
      }
    }
  }

  // 4. A previous automatic match.
  if (cached && cached.lines.length > 0) {
    return describe(cached, canFetch, sync, cached.matched ?? null)
  }

  // 5. Nothing cached: only search for names that could plausibly match.
  if (!canFetch) return emptyResult(false, sync)

  const want = songWant(track.title, track.artist, track.durationSec)
  const pool = await collectCandidates(want, track.artist)
  let best = bestLyricMatch(want, pool)

  // Heuristics could not settle it. A small model reads "Sonne remix by street
  // Music [TIKTOK VERSION]" — or a fan-version title — far better than any
  // regex, so ask it which record is this file (or what the song really is) and
  // only accept an answer the scorer agrees is plausible.
  let aiAssisted = false
  if (!best || best.score < 0.85) {
    const refined = await aiRefine(track, want, pool, best)
    if (refined && refined !== best) {
      aiAssisted = true
      best = refined
    }
  }

  const matched = best
    ? { title: best.hit.trackName ?? '', artist: best.hit.artistName ?? '' }
    : null

  if (best) {
    const lyrics = toCached(best.hit)
    // The reference length drives the automatic speed fit and the "different
    // edit" hint, so it is stored with the match.
    const matchedDurationSec = Math.round(best.hit.duration ?? 0)
    if (lyrics) {
      db.setLyrics(trackId, { ...lyrics, matched, matchedDurationSec, ai: aiAssisted })
      return describe({ ...lyrics, ai: aiAssisted }, true, resolveSync(trackId, track.durationSec, matchedDurationSec), matched)
    }
    // A confident match that publishes no lyrics at all — instrumentals are
    // the common case in phonk/drill libraries. Say so instead of "not found".
    if (best.hit.instrumental) return emptyResult(true, sync, true, matched)
    return emptyResult(true, sync, false, matched)
  }

  return emptyResult(true, sync)
}

/**
 * Hand-tune the timing of one track's lyrics.
 *
 * `offsetMs` slides the lyrics (positive = later) and `scale` stretches their
 * timeline, which is what fixes a sped-up/slowed file exactly. Passing `null`
 * clears the record so the track returns to the automatic fit.
 */
export async function setLyricSync(
  trackId: string,
  patch: { offsetMs?: number | null; scale?: number | null } | null
): Promise<LyricsResult | null> {
  const track = db.findTrackAnywhere(trackId)
  if (!track) return null
  if (!patch) {
    db.clearLyricSync(trackId)
  } else {
    const current = db.getLyricSync(trackId)
    const auto = autoLyricSync(track.durationSec, referenceDuration(trackId))
    const offsetMs = patch.offsetMs ?? current?.offsetMs ?? auto.offsetMs
    const scale = patch.scale ?? current?.scale ?? auto.scale
    db.setLyricSync(trackId, {
      offsetMs: Math.max(-60_000, Math.min(60_000, Math.round(offsetMs))),
      // Hand-set: allowed a wider range than the conservative automatic fit,
      // because a heavily sped-up or chopped edit is exactly when you reach for
      // this button. Still bounded so a typo cannot produce nonsense.
      scale: Number.isFinite(scale) && scale > 0 ? Math.max(0.25, Math.min(4, scale)) : 1,
      auto: false,
      refDurationSec: current?.refDurationSec || auto.refDurationSec,
      // A hand-tuned value keeps the record of the alignment it came from.
      alignedAt: current?.alignedAt,
      source: 'manual',
      updatedAt: Date.now()
    })
  }
  return getLyrics(trackId)
}

/** Store lyrics the user picked from a file or pasted into the panel. */
export function setUserLyrics(trackId: string, text: string): LyricsResult {
  const parsed = parseLyricsText(text)
  if (parsed.lines.length === 0) throw new Error('No lyrics found in that text')
  const cached: CachedLyrics = {
    synced: parsed.synced,
    lines: parsed.lines,
    source: 'user',
    fetchedAt: Date.now()
  }
  db.setLyrics(trackId, cached)
  const track = db.findTrackAnywhere(trackId)
  const sync = resolveSync(trackId, track?.durationSec ?? 0, referenceDuration(trackId))
  return describe(cached, canFetchLyrics(track?.title ?? '', track?.artist ?? ''), sync)
}

/** Forget cached/uploaded lyrics. A `.lrc` file on disk is left untouched. */
export function clearLyrics(trackId: string): void {
  db.clearLyrics(trackId)
}

/**
 * Re-run the match for one track.
 *
 * "Match again" in the panel: the automatic cache is dropped so the current
 * matcher gets another go (a better version may exist, or the previous pick may
 * have been for the wrong edit). Lyrics the user supplied are never discarded.
 */
export async function rematchLyrics(trackId: string): Promise<LyricsResult | null> {
  if (aiWritingMode()) {
    // "Write again": drop only the model's version so it re-writes. The normal
    // match is deliberately left alone — switching back must stay instant.
    db.clearAiLyrics(trackId)
  } else {
    const cached = db.getLyrics(trackId)
    if (cached && cached.source !== 'user') db.clearLyrics(trackId)
  }
  return getLyrics(trackId)
}
