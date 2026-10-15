import { parseLrc, type LyricLine } from '../shared/lyrics'
import { isGenericArtist, isJunkTitle, normalizeTitle, stripBrackets, stripTitleNoise } from './coverArt'
/**
 * Pure lyrics text + song-matching helpers.
 *
 * No database and no Electron dependency, so the whole matcher can be unit
 * tested and reasoned about on its own. `lyrics.ts` does the network calls.
 */

/**
 * Whether an automatic lookup is worth attempting for this track.
 *
 * Local files are named by whoever ripped them: real names ("Artist - Song")
 * are searchable, while `1.mp3`, `Track 03` or `audio.wav` are not — those must
 * never cost a network request, the panel asks for an upload instead.
 */
export function canFetchLyrics(title: string, artist: string): boolean {
  if (isJunkTitle(title)) return false
  const words = normalizeTitle(stripTitleNoise(title)).split(' ').filter(Boolean)
  // A one- or two-character "title" only counts when the artist is real.
  return words.join('').length >= 3 || !isGenericArtist(artist)
}

/** Drop `[ar:…]`-style metadata lines from a plain-text block. */
export function cleanPlainLyrics(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[[a-z]{2,10}:[^\]]*\]\s*$/i.test(line))
    .join('\n')
}

/**
 * Remix/version/edit tags and uploader by-lines.
 *
 * Used only for the *last* lyrics variant: "Sonne remix by street Music [TIKTOK
 * VERSION]" is never indexed under that name, but "Sonne" is — and the words
 * that identify the song are still there. Kept out of the cover search, which
 * should look for the version the file actually is.
 */
const VERSION_TAGS =
  /\b(?:remix|rmx|remaster(?:ed)?|version|edit|bootleg|mashup|sped\s?up|slowed(?:\s*\+\s*reverb)?|nightcore|reverb|bass\s?boosted|extended|tiktok|tik\s?tok|viral|trending|phonk\s?edit)\b/gi
const BYLINE = /\s+(?:by|from)\s+[^|\-–—]+$/i

/** The bare song name behind a remix/version/uploader by-line. */
export function stripVersionTags(raw: string): string {
  return raw
    .replace(BYLINE, ' ')
    .replace(VERSION_TAGS, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—_.,]+|[\s\-–—_|]+$/g, '')
    .trim()
}

/**
 * Every reading of a local name worth searching for, best first.
 *
 * "モニタリング spotdown.org" → ["モニタリング"]; a title with an aside keeps it
 * for the precise attempt and also offers the bare name, because lyrics
 * databases index parodies and alternate versions under names the file does not
 * carry ("Frisk ver. (Undertale Animation Parody)" only resolves as "Frisk
 * ver."). A remix/edit reading comes third, and the untouched name is kept last
 * as a safety net.
 */
export function songTitleVariants(raw: string): string[] {
  const out: string[] = []
  const push = (value: string): void => {
    const trimmed = value.replace(/\s{2,}/g, ' ').trim()
    if (trimmed.length >= 2 && !out.includes(trimmed)) out.push(trimmed)
  }
  const cleaned = stripTitleNoise(raw)
  const bare = stripBrackets(cleaned)
  push(cleaned)
  push(bare)
  push(stripVersionTags(bare))
  push(raw.trim())
  return out
}

/** Plain text (no timestamps) → evenly spaced placeholder lines. */
export function parsePlainLyrics(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*\]/, '').trim())
    .filter(Boolean)
    .map((line, i) => ({ t: i * 4, text: line }))
}

/** Parse anything the user hands us: synced `.lrc` first, plain text after. */
export function parseLyricsText(text: string): { synced: boolean; lines: LyricLine[] } {
  const synced = parseLrc(text)
  if (synced.length > 0) return { synced: true, lines: synced }
  return { synced: false, lines: parsePlainLyrics(cleanPlainLyrics(text)) }
}

// ------------------------------------------------------------ song matching

/** One record as returned by lrclib's get/search endpoints. */
export interface LrclibRecord {
  id?: number
  trackName?: string | null
  artistName?: string | null
  albumName?: string | null
  duration?: number | null
  instrumental?: boolean
  hasWordSync?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

export interface SongWant {
  /** What the file claims, and every cleaned reading of it. */
  titles: string[]
  artist: string
  /** Seconds, 0 when unknown. */
  duration: number
}

/**
 * Comparable words of a name — brackets KEPT.
 *
 * Deliberately not `normalizeTitle` from the cover matcher: that one drops
 * bracketed text because YouTube is full of "(Official Video)" noise, but in
 * lyrics-land an aside is often the whole identity of the track. Dropping it
 * turns "Stronger Than You Response (ver. Frisk)" into a title with no "Frisk"
 * in it at all, which is precisely why the Frisk cover never matched.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 1)
}

/** Share of `want`'s words that appear in `got`. */
function wordOverlap(want: string, got: string): number {
  const a = words(want)
  if (a.length === 0) return 0
  const hay = new Set(words(got))
  return a.filter((word) => hay.has(word)).length / a.length
}

/** True when `needle`'s words all appear in `haystack` (min 4 chars). */
function containedIn(needle: string, haystack: string): boolean {
  const a = words(needle).join(' ')
  if (a.length < 4) return false
  const hay = words(haystack)
  if (hay.length === 0) return false
  if (hay.join(' ').includes(a)) return true
  const set = new Set(hay)
  const parts = a.split(' ').filter((w) => w.length > 1)
  return parts.length >= 2 && parts.every((w) => set.has(w))
}

/**
 * How well one lrclib record matches the wanted song, 0 (unrelated) to 1.
 *
 * Lyrics databases are user-contributed, so "wrong" is normal: titles and
 * artists get swapped, artists are channel names or remixers, and durations are
 * metadata junk. The weights are chosen around one hard-won lesson: the *file's
 * length* is the strongest evidence that a record is the same edit as the audio
 * you are about to hear. A perfect artist credit on a 272-second original must
 * not beat a 189-second remix entry when the local file is 191 seconds long —
 * that is exactly the case where the words line up but the timing is miles off.
 *
 * So: title agreement identifies the song, duration agreement identifies the
 * *recording* and outweighs the artist, and synced lyrics break ties.
 */
export function scoreLyricHit(want: SongWant, hit: LrclibRecord): number {
  const hitTitle = hit.trackName ?? ''
  const hitArtist = hit.artistName ?? ''
  if (!hitTitle && !hitArtist) return 0

  // Title: best agreement across every reading of the local name, and also
  // against the hit's *artist* field because those two are frequently swapped.
  const titleScore = Math.max(
    0,
    ...want.titles.map((title) => Math.max(wordOverlap(title, hitTitle), wordOverlap(title, hitArtist))),
    ...want.titles.map((title) => (containedIn(title, hitTitle) || containedIn(hitTitle, title) ? 0.85 : 0))
  )
  if (titleScore < 0.5) return 0

  // A local artist tag that is really the song's own name ("Stronger than you"
  // on a Frisk cover) is a strong signal, not a mismatch.
  const artistKnown = !isGenericArtist(want.artist)
  const artistScore = !artistKnown
    ? 0.6
    : Math.max(
        wordOverlap(want.artist, hitArtist),
        wordOverlap(want.artist, hitTitle),
        containedIn(want.artist, hitTitle) ? 1 : 0
      )

  // Duration: unknown on either side is neutral; a close match is a good sign,
  // a far one only costs points (bad duration metadata is extremely common).
  const wantDuration = Math.round(want.duration || 0)
  const hitDuration = Math.round(hit.duration || 0)
  const tolerance = Math.max(4, wantDuration * 0.06)
  let durationScore = 0.5
  let sameRecording = false
  if (wantDuration > 0 && hitDuration > 0) {
    const drift = Math.abs(hitDuration - wantDuration)
    durationScore = Math.max(0, 1 - drift / tolerance)
    // Within a couple of seconds (or 1.5%) this is the same audio file, whatever
    // the uploader called it — worth more than any artist credit.
    sameRecording = drift <= Math.max(3, wantDuration * 0.015)
  }

  const synced = Boolean(hit.syncedLyrics)
  const score =
    0.5 * titleScore +
    0.2 * artistScore +
    0.3 * durationScore +
    (sameRecording ? 0.1 : 0) +
    (synced ? 0.06 : 0)
  return Math.min(1, score)
}

/** Pick the best-scoring record, or null when nothing clears the bar. */
export function bestLyricMatch(want: SongWant, records: LrclibRecord[], threshold = 0.6): { hit: LrclibRecord; score: number } | null {
  let best: { hit: LrclibRecord; score: number } | null = null
  for (const hit of records) {
    const score = scoreLyricHit(want, hit)
    if (score > (best?.score ?? 0)) best = { hit, score }
  }
  return best && best.score >= threshold ? best : null
}

/** Build the "what do we want" bundle from a track's own metadata. */
export function songWant(title: string, artist: string, durationSec: number): SongWant {
  const titles = songTitleVariants(title)
  return {
    titles: titles.length > 0 ? titles : [title],
    artist: artist ?? '',
    duration: 0 + (durationSec ?? 0)
  }
}

// ------------------------------------------------- timing from caption cues

/** One timed caption cue: when it starts and what it says. */
export interface CaptionCue {
  t: number
  text: string
}

/** What a caption alignment concluded. */
export interface CaptionFit {
  offsetMs: number
  scale: number
  /** How many lyric lines were found in the captions. */
  matches: number
  /** Median disagreement between the fit and the matched pairs, in seconds. */
  residualSec: number
}

/** Captions annotate non-speech as bracket tags; those are not lyric words. */
function cueWords(text: string): string[] {
  return words(text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' '))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Line up lyric timings with the timed captions of the *exact* recording.
 *
 * This is the piece that fixes "the words start before the singing does".
 * lrclib's timings belong to whatever recording its contributor used; YouTube's
 * automatic captions belong to the video that *is* this file (matched by
 * duration), so their cue times say where each phrase is actually sung.
 *
 * Words are matched, not cues: automatic captions break lines wherever the
 * recogniser felt like it, so each lyric line is located inside a flattened
 * word stream and the time of its first words is taken as the observed time.
 * A robust (median-based) linear fit then yields the offset and any speed
 * difference, and a bad fit is rejected rather than applied.
 */
export function alignLyricsToCues(lines: LyricLine[], cues: CaptionCue[]): CaptionFit | null {
  if (lines.length < 2 || cues.length < 2) return null

  // Flatten captions into a word stream with an interpolated time per word.
  const stream: { word: string; t: number }[] = []
  for (let i = 0; i < cues.length; i++) {
    const ws = cueWords(cues[i].text)
    if (ws.length === 0) continue
    const start = cues[i].t
    const end = i + 1 < cues.length ? Math.max(start + 0.4, cues[i + 1].t) : start + 3
    const span = (end - start) / ws.length
    ws.forEach((word, index) => stream.push({ word, t: start + index * span }))
  }
  if (stream.length < 8) return null

  // Locate each lyric line in the stream by its first few words, allowing the
  // recogniser to have inserted or dropped a word along the way.
  const pairs: { lyric: number; observed: number }[] = []
  let cursor = 0
  for (const line of lines) {
    const want = words(line.text)
    if (want.length === 0) continue
    const probe = want.slice(0, Math.min(4, want.length))
    const found = findSequence(stream, probe, cursor)
    if (found < 0) continue
    pairs.push({ lyric: line.t, observed: stream[found].t })
    cursor = Math.max(cursor, found + 1)
  }
  if (pairs.length < 2) return null

  // Theil–Sen slope: immune to the occasional wrong match, unlike least squares.
  if (pairs.length >= 3) {
    const slopes: number[] = []
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const dx = pairs[j].lyric - pairs[i].lyric
        if (dx > 5) slopes.push((pairs[j].observed - pairs[i].observed) / dx)
      }
    }
    const scale = slopes.length > 0 ? Math.max(0.7, Math.min(1.4, median(slopes))) : 1
    const offsets = pairs.map((p) => p.observed - scale * p.lyric)
    const offset = median(offsets)
    const residualSec = median(offsets.map((value) => Math.abs(value - offset)))
    // One wrong match must not shift the whole song, and a fit that disagrees
    // with itself is not a fit.
    if (residualSec > 2.5) return null
    return { offsetMs: Math.round(offset * 1000), scale: Math.round(scale * 1000) / 1000, matches: pairs.length, residualSec }
  }

  // Two points: only trust them when they tell the same story.
  const [a, b] = pairs
  const offsetA = a.observed - a.lyric
  const offsetB = b.observed - b.lyric
  if (Math.abs(offsetA - offsetB) > 2.5) return null
  const offset = (offsetA + offsetB) / 2
  return { offsetMs: Math.round(offset * 1000), scale: 1, matches: 2, residualSec: Math.abs(offsetA - offsetB) / 2 }
}

/** First index at/after `from` where `probe` appears in the stream, or -1. */
function findSequence(stream: { word: string; t: number }[], probe: string[], from: number): number {
  const first = probe[0]
  for (let i = Math.max(0, from); i < stream.length; i++) {
    if (stream[i].word !== first) continue
    // Allow a couple of ASR insertions between the probe's words.
    let si = i + 1
    let pi = 1
    let slack = 2
    while (pi < probe.length && si < stream.length) {
      if (stream[si].word === probe[pi]) {
        pi += 1
        si += 1
      } else if (slack > 0) {
        slack -= 1
        si += 1
      } else {
        break
      }
    }
    // The whole probe (or all but one word, for very short lines) matched.
    if (pi >= probe.length || (probe.length >= 3 && pi >= probe.length - 1)) return i
  }
  return -1
}

/** Parse yt-dlp's `json3` caption format into cues (.vtt also accepted). */
export function parseCaptionCues(raw: string): CaptionCue[] {
  const text = raw.trim()
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] }
      const cues: CaptionCue[] = []
      for (const event of parsed.events ?? []) {
        const words = (event.segs ?? []).map((s) => s.utf8 ?? '').join('')
        const label = words.replace(/\s+/g, ' ').trim()
        if (!label) continue
        cues.push({ t: (event.tStartMs ?? 0) / 1000, text: label })
      }
      return cues
    } catch {
      return []
    }
  }
  // WebVTT fallback: one block per cue, "00:00:12.450 --> 00:00:14.000".
  const cues: CaptionCue[] = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const rows = block.split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
    const timeRow = rows.findIndex((row) => row.includes('-->'))
    if (timeRow < 0) continue
    const match = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(rows[timeRow])
    if (!match) continue
    const t =
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0')) / 1000
    const body = rows
      .slice(timeRow + 1)
      .filter((row) => !/^\d+$/.test(row))
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .trim()
    if (body) cues.push({ t, text: body })
  }
  return cues
}
