import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveFfmpeg, search } from './ytdlp'

/**
 * Cover art for local files that have none.
 *
 * Files ripped from disk usually carry no embedded picture, so their tile would
 * otherwise stay blank. When the filename holds a real song name we ask YouTube
 * for a match and cache that video's thumbnail. Files with meaningless names
 * ("1", "Track 03") are skipped entirely and keep the default note icon.
 *
 * Every lookup is cached — including a verdict of "nothing close enough" — so a
 * large folder costs one round of searches and nothing afterwards.
 */

const execute = promisify(execFile)
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/** Names that give a search engine nothing to work with. */
const JUNK_EXACT = new Set([
  'audio', 'untitled', 'unknown', 'unknown artist', 'track', 'new recording',
  'recording', 'output', 'song', 'music', 'download', 'final', 'copy',
  'temp', 'test', 'various artists', 'va'
])

/**
 * Rip/downloader noise that is never part of a song name.
 *
 * Files saved from streaming sites carry the site in the title — "モニタリング
 * spotdown.org" is a real example from a user's library — and rips usually tack
 * on a bitrate or a "official audio" tag. Every one of those tokens breaks a
 * lookup, so they are removed before anything is searched.
 */
const NOISE_SITES =
  /\b(?:spotdown|spotifydown|spotidown|spotdl|y2mate|ytmp3|ytconverter|ytdl|mp3juice|mp3juices|mp3download|mp3skull|mp3party|mp3fy|mp3clan|savefrom|ssyoutube|onlinevideoconverter|convert2mp3|klickaud|tubidy|musicdl|myfreemp3|audiojungle|pixabay|zapsplat|soundcloud|newgrounds|bandcamp|dailymotion|nicovideo|bilibili|telegram)\b/gi
/**
 * Domains, matched BEFORE the site names above: removing "spotdown" first would
 * leave a bare ".org" stuck to the song name.
 */
const NOISE_DOMAIN =
  /(?:[a-z0-9][a-z0-9-]*\.)+(?:com|org|net|ru|io|me|cc|to|tv|fm|info|biz|xyz|site|link|online|app|co|uk|de|jp|mp3|download|ws|su|club|store|live|top|space)\b|[.．](?:com|org|net|ru|io|me|cc|to|tv|fm|info|biz|xyz|site|link|online|app|co|uk|de|jp|mp3|download|ws|su|club|store|live|top|space)\b/gi
const NOISE_QUALITY =
  /\b(?:\d{2,3}\s?kbps|kbps|khz|hq|hd|hi-?res|hires|lossless|flac|mp3|m4a|wav|opus|aac|ogg|320k)\b/gi
const NOISE_UPLOAD_JUNK =
  /\b(?:official\s+(?:video|audio|music\s+video|lyric\s+video|visualizer)|lyrics?\s+video|lyric\s+video|visualizer|full\s+(?:album|song|version)|music\s+video|m\/v|mv|out\s+now|explicit|audio)\b/gi

/**
 * Drop the seams the removals leave behind.
 *
 * A trailing dot is kept: "Frisk ver." is exactly the spelling lrclib indexes
 * its fan versions under, and stripping it turns a hit into a miss.
 */
function tidyTitle(value: string): string {
  return value
    .replace(/[«»"“”]/g, ' ')
    .replace(/[([]\s*[)\]]/g, ' ')
    .replace(/[|•·]+/g, ' - ')
    .replace(/\s*[-–—_]\s*[-–—_]+\s*/g, ' - ')
    .replace(/^[\s\-–—_.,|]+|[\s\-–—_|]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Whole URLs first: "https://y2mate.com Song" must not leave "https://" behind. */
const NOISE_URL = /(?:https?:\/\/|www\.)\S+/gi

/**
 * The song name inside a messy filename: site names, domains, bitrate/codec
 * tags and "official audio"-style uploader junk removed.
 *
 * An empty result is meaningful and is left empty: a name made *entirely* of
 * noise ("320kbps", "spotdown.org") is junk, and `isJunkTitle` turns it into
 * "not worth searching" instead of sending it to a search engine.
 */
export function stripTitleNoise(raw: string): string {
  return tidyTitle(
    raw
      .replace(NOISE_URL, ' ')
      .replace(NOISE_DOMAIN, ' ')
      .replace(NOISE_SITES, ' ')
      .replace(NOISE_QUALITY, ' ')
      .replace(NOISE_UPLOAD_JUNK, ' ')
  )
}

/** Same name without any bracketed asides: "Song (Live)" -> "Song". */
export function stripBrackets(text: string): string {
  return tidyTitle(text.replace(/[([][^)\]]*[)\]]/g, ' '))
}

/**
 * Fold a title to comparable words: drop bracketed noise like "(Official
 * Video)", punctuation and case. Unicode-aware so non-Latin titles survive.
 */
export function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** True when a filename is pure noise and must not trigger a lookup. */
export function isJunkTitle(title: string): boolean {
  const raw = normalizeTitle(stripTitleNoise(title))
  if (raw.length < 2) return true
  if (/^\d+$/.test(raw)) return true
  if (JUNK_EXACT.has(raw)) return true
  // "track 3", "audio 12", "cd1", "untitled 2" and friends.
  return /^(?:track|audio|untitled|recording|output|song|cd|part)\s*\d*$/.test(raw)
}

/**
 * `Unknown artist` is the placeholder `parseName` invents from the parent
 * folder, so it is dropped rather than sent to YouTube as a keyword.
 */
export function isGenericArtist(artist: string): boolean {
  const a = normalizeTitle(artist)
  return !a || JUNK_EXACT.has(a) || a === 'unknown' || a === 'unknown artist'
}

/**
 * True when a name is nothing but noise — a downloader site, a bitrate, an
 * "(Official Video)" tag — with no song or artist left in it.
 *
 * Used to sanity-check what the optional model returns: it reads messy metadata
 * well, but it can still echo a site back as the "artist". Measured on a real
 * library, `モニタリング spotdown.org` came back as artist `Spotdown`, which then
 * poisoned the follow-up search.
 */
export function isNoiseOnly(text: string): boolean {
  const raw = text.trim()
  return raw.length > 0 && stripTitleNoise(raw).trim().length === 0
}

/**
 * Clean a name the AI produced: strip the noise it may have echoed, but never
 * hand back an empty string — a title returned unchanged is still better than
 * no answer at all.
 */
export function cleanAiGuess(raw: string): string {
  const trimmed = raw.trim()
  const stripped = stripTitleNoise(trimmed).trim()
  return stripped.length > 0 ? stripped : trimmed
}

/**
 * The search string for a track, or null when it is not worth searching.
 */
export function coverQuery(title: string, artist: string): string | null {
  if (isJunkTitle(title)) return null
  const name = stripTitleNoise(title)
  return isGenericArtist(artist) ? name : `${artist.trim()} ${name}`
}

/** Share of the local title's words that also appear in the candidate. */
export function titleOverlap(localTitle: string, hitTitle: string): number {
  const want = normalizeTitle(localTitle).split(' ').filter((w) => w.length > 1)
  if (want.length === 0) return 0
  const hay = new Set(normalizeTitle(hitTitle).split(' '))
  return want.filter((w) => hay.has(w)).length / want.length
}

/**
 * Whether a search hit is close enough to be that song's cover.
 *
 * Word overlap alone rejects legitimate matches whose punctuation or extra
 * tokens differ, so containment of the shorter title also counts.
 */
export function isGoodMatch(localTitle: string, hitTitle: string, threshold = 0.6): boolean {
  const a = normalizeTitle(localTitle)
  const b = normalizeTitle(hitTitle)
  if (!a || !b) return false
  if (titleOverlap(localTitle, hitTitle) >= threshold) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 4 && longer.includes(shorter)
}

/**
 * Centre-crop to a square and re-encode as JPEG.
 *
 * The protocol sniffs JPEG by its magic bytes, and a square crop stops the UI's
 * `object-fit: cover` from lopping the sides off a 16:9 thumbnail.
 */
async function squareJpeg(raw: Buffer): Promise<Buffer | null> {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return null
  const tmp = path.join(os.tmpdir(), `spinity-cover-${process.pid}-${Date.now()}.img`)
  try {
    await fs.writeFile(tmp, raw)
    const { stdout } = await execute(
      ffmpeg,
      [
        '-nostdin', '-v', 'error', '-threads', '1', '-i', tmp,
        '-frames:v', '1',
        // `crop=ih:ih` is a centred square; no commas, so nothing to escape.
        '-vf', 'crop=ih:ih,scale=512:512',
        '-threads', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'
      ],
      { encoding: 'buffer', windowsHide: true, timeout: 15_000, maxBuffer: MAX_IMAGE_BYTES }
    )
    return stdout.length > 0 ? stdout : null
  } catch {
    return null
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
}

/** Download a video's thumbnail, preferring the largest size available. */
async function fetchThumbnail(videoId: string): Promise<Buffer | null> {
  for (const name of ['maxresdefault.jpg', 'hqdefault.jpg', 'mqdefault.jpg']) {
    try {
      const response = await fetch(`https://i.ytimg.com/vi/${videoId}/${name}`, {
        signal: AbortSignal.timeout(8_000)
      })
      if (!response.ok) continue
      const raw = Buffer.from(await response.arrayBuffer())
      if (raw.length === 0 || raw.length > MAX_IMAGE_BYTES) continue
      // ffmpeg is optional: without it, serve the raw thumbnail as-is.
      return (await squareJpeg(raw)) ?? raw
    } catch {
      // Offline or blocked — try the next size down.
    }
  }
  return null
}

/**
 * What the cache already knows about a title, without doing any work.
 *
 * `unknown` means "nobody has looked this up yet" — the caller decides whether
 * paying for a yt-dlp search is worth it right now or should wait until later.
 */
export type CoverVerdict =
  | { state: 'hit'; image: Buffer }
  | { state: 'none' }
  | { state: 'unknown' }

export interface CoverLookup {
  /** Cached answer only: memory → disk. Never spawns a process or a request. */
  ready: (title: string, artist: string) => Promise<CoverVerdict>
  /** Synchronous memory-only peek (undefined = not resolved yet). */
  peek: (title: string, artist: string) => Buffer | null | undefined
  /** Resolve now, running a (queued) lookup when the answer is unknown. */
  warm: (title: string, artist: string) => Promise<Buffer | null>
  /** Blocking convenience: cached answer or a fresh lookup. */
  get: (title: string, artist: string) => Promise<Buffer | null>
}

/** Cache key for one query — shared by every entry point below. */
function coverKey(cacheVersion: string, query: string): string {
  return createHash('sha256').update(`${cacheVersion}|${normalizeTitle(query)}`).digest('hex')
}

/**
 * Build a cached `(title, artist) -> JPEG cover` lookup.
 *
 * Lookups are throttled to a couple at a time because each one spawns yt-dlp,
 * and results (positive and negative) are cached on disk across launches.
 *
 * The returned object separates "what do we already know" (`ready`/`peek`)
 * from "go find out" (`warm`). That split is what keeps the artwork protocol
 * fast: a tile paints its placeholder immediately instead of blocking a
 * request for seconds behind a yt-dlp search.
 */
export function createCoverLookup(cacheRoot: string, cacheVersion = 'cover-v2'): CoverLookup {
  const memory = new Map<string, Buffer | null>()
  const pending = new Map<string, Promise<Buffer | null>>()
  const queue: Array<() => void> = []
  let active = 0
  const maxConcurrent = 2

  const remember = (key: string, image: Buffer | null): void => {
    memory.set(key, image)
    while (memory.size > 200) memory.delete(memory.keys().next().value!)
  }

  const worker = async (query: string, localTitle: string, key: string): Promise<Buffer | null> => {
    const destination = path.join(cacheRoot, `${key}.jpg`)
    try {
      const cached = await fs.readFile(destination)
      if (cached.length <= MAX_IMAGE_BYTES) return cached.length ? cached : null
    } catch {
      // First lookup for this title.
    }

    let image: Buffer | null = null
    try {
      const hits = await search(query, 5, { background: true })
      const match = hits.find((hit) => isGoodMatch(localTitle, hit.title))
      if (match) image = await fetchThumbnail(match.id)
    } catch (err) {
      // Offline, or yt-dlp missing. Deliberately NOT cached: a single failed
      // lookup must not pin the default icon on this track forever.
      console.error('[cover] lookup failed for', query, err)
      return null
    }

    try {
      await fs.mkdir(cacheRoot, { recursive: true })
      const temp = `${destination}.${process.pid}.tmp`
      // A zero-byte file records "searched, nothing close enough".
      await fs.writeFile(temp, image ?? Buffer.alloc(0))
      await fs.rename(temp, destination)
    } catch {
      // A read-only or full cache must never break the tile.
    }
    return image
  }

  /** Start (or join) the queued lookup for one query. */
  const ensureJob = (query: string, localTitle: string, key: string): Promise<Buffer | null> => {
    const running = pending.get(key)
    if (running) return running

    const job = new Promise<Buffer | null>((resolve) => {
      queue.push(() => {
        active += 1
        worker(query, localTitle, key)
          .then((image) => {
            remember(key, image)
            resolve(image)
          })
          .catch((err) => {
            console.error('[cover] worker failed for', query, err)
            resolve(null)
          })
          .finally(() => {
            active -= 1
            pending.delete(key)
            if (queue.length > 0) queue.shift()!()
          })
      })
      if (active < maxConcurrent) queue.shift()!()
    })
    pending.set(key, job)
    return job
  }

  const keyFor = (title: string, artist: string): { key: string; query: string } | null => {
    const query = coverQuery(title, artist)
    if (!query) return null // Junk name — the caller shows the default icon.
    return { key: coverKey(cacheVersion, query), query }
  }

  const ready: CoverLookup['ready'] = async (title, artist) => {
    const k = keyFor(title, artist)
    if (!k) return { state: 'none' }
    if (memory.has(k.key)) {
      const image = memory.get(k.key) ?? null
      return image ? { state: 'hit', image } : { state: 'none' }
    }
    try {
      const cached = await fs.readFile(path.join(cacheRoot, `${k.key}.jpg`))
      if (cached.length > MAX_IMAGE_BYTES) return { state: 'unknown' }
      const image = cached.length ? cached : null
      remember(k.key, image)
      return image ? { state: 'hit', image } : { state: 'none' }
    } catch {
      return { state: 'unknown' }
    }
  }

  const peek: CoverLookup['peek'] = (title, artist) => {
    const k = keyFor(title, artist)
    if (!k) return null
    return memory.has(k.key) ? memory.get(k.key) ?? null : undefined
  }

  const warm: CoverLookup['warm'] = async (title, artist) => {
    const k = keyFor(title, artist)
    if (!k) return null
    const verdict = await ready(title, artist)
    if (verdict.state === 'hit') return verdict.image
    if (verdict.state === 'none') return null
    return ensureJob(k.query, title, k.key)
  }

  return { ready, peek, warm, get: warm }
}