import fs from 'node:fs'
import path from 'node:path'
import {
  Aria2Error,
  downloadWithAria2c,
  resolveAria2c,
  type Aria2DownloadOptions
} from './aria2'
import { getStreamCache, type StreamCache } from './streamCache'
import { downloadForCache } from './ytdlp'
import type { StreamInfo } from '../shared/types'

/** Re-exported so callers can distinguish an expired-URL failure. */
export { Aria2Error } from './aria2'

/**
 * Background fills: resolved YouTube streams copied into the stream cache
 * while the element plays the direct CDN URL.
 *
 * Why this shape. The click path hands `<audio>` the signed URL itself — the
 * first audio byte arrives with the first network byte and no main-process
 * hop sits in between. In parallel, this module downloads the same track
 * into the stream cache, then *publishes* it: the cache learns the file
 * (`publish`), so every later play of that video id is served from disk —
 * instantly, and offline once cached.
 *
 * Two download paths, in order (both live-measured):
 *
 *  1. aria2c fetches the resolved URL directly — no re-extraction, 16
 *     connections, typically a few seconds for a track.
 *  2. If that fetch is refused (some player clients — ios/visionos/android —
 *     sign URLs whose server rejects requests that don't look like the
 *     client that asked; measured as a terminated connection, not only 403),
 *     yt-dlp downloads it instead: it re-extracts with the right client and
 *     headers, and attaches aria2c as its external downloader so the
 *     transfer stays multi-connection. Re-extraction also mints a fresh
 *     signature, so expiry is covered by the same step.
 *
 * Entries are keyed by `yt:<videoId>`, not by URL: signed googlevideo URLs
 * rotate every few hours, and a URL-keyed cache would miss forever.
 *
 * Concurrency is capped (fills are background bandwidth): at most
 * MAX_ACTIVE fills run, extras wait in a small FIFO; a burst of clicks can
 * never stack twenty 16-connection downloads.
 */

const MAX_ACTIVE = 2
const MAX_QUEUED = 8

/** Can this resolution be cached at all? Progressive http(s) on YouTube's CDN. */
export function cacheableStream(info: StreamInfo): boolean {
  if (!/^https?:/i.test(info.url)) return false
  if (/^m3u8/i.test(info.protocol || '')) return false
  try {
    return /(^|\.)googlevideo\.com$/i.test(new URL(info.url).hostname)
  } catch {
    return false
  }
}

/** Sidecar content type from yt-dlp's container choice. */
export function contentTypeForExt(ext: string): string {
  switch ((ext || '').toLowerCase()) {
    case 'm4a':
    case 'mp4':
    case 'aac':
      return 'audio/mp4'
    case 'webm':
    case 'weba':
      return 'audio/webm'
    case 'mp3':
      return 'audio/mpeg'
    case 'opus':
    case 'ogg':
    case 'oga':
      return 'audio/ogg'
    default:
      return 'audio/mpeg'
  }
}

/** Stable cache identity for a YouTube track (URLs rotate, ids don't). */
export function streamKeyHint(videoId: string): string {
  return `yt:${videoId}`
}

export interface FillDeps {
  cache: StreamCache
  /** aria2c's path, or null when it is not installed (fill is skipped). */
  aria2cPath: () => string | null
  download: (options: Aria2DownloadOptions) => Promise<{ bytes: number }>
  /** yt-dlp-driven download — the fallback after a refused direct fetch. */
  downloadViaYtDlp: (
    videoId: string,
    destBase: string,
    opts: { aria2cPath: string | null }
  ) => Promise<{ file: string; ext: string; bytes: number }>
}

export interface FillOptions {
  /** Diagnostics; a no-op by default so tests stay quiet. */
  log?: (line: string) => void
  /** Test seams — the app never passes these. */
  deps?: Partial<FillDeps>
}

// ------------------------------------------------------------ concurrency

let active = 0
const waiting: Array<() => void> = []

async function acquireSlot(): Promise<boolean> {
  if (active < MAX_ACTIVE) {
    active++
    return true
  }
  if (waiting.length >= MAX_QUEUED) return false
  await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  return true
}

function releaseSlot(): void {
  active = Math.max(0, active - 1)
  waiting.shift()?.()
}

// ---------------------------------------------------------------- filling

const inflight = new Map<string, Promise<boolean>>()

/** True while a fill for this video id is queued or downloading. */
export function isFilling(videoId: string): boolean {
  return inflight.has(streamKeyHint(videoId))
}

/** Test seam: how many fills are running right now. */
export function activeFills(): number {
  return active
}

/** Remove the destination plus every scratch/produced leftover for that key. */
function cleanup(dest: string): void {
  try {
    fs.rmSync(dest, { force: true })
  } catch {}
  const dir = path.dirname(dest)
  const keyBase = path.basename(dest).replace(/\.bin$/, '')
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`${keyBase}.`)) continue
      // The cache's own payload/sidecar stay; anything else under this key
      // (`.bin.aria2`, `.m4a`, `.m4a.part`, `.ytdl`, …) is this fill's mess.
      if (name === `${keyBase}.bin` || name === `${keyBase}.json`) continue
      fs.rmSync(path.join(dir, name), { force: true })
    }
  } catch {
    /* best effort */
  }
}

/**
 * Fill `videoId` into the stream cache. Concurrent calls for the same id
 * share one download. Resolves `true` when the cache now holds the complete
 * file, `false` for every skip or failure (already cached, aria2c missing,
 * queue full, download error) — callers treat it as best effort.
 */
export function fillStream(
  videoId: string,
  info: StreamInfo,
  options: FillOptions = {}
): Promise<boolean> {
  const keyHint = streamKeyHint(videoId)
  const running = inflight.get(keyHint)
  if (running) return running
  const promise = runFill(keyHint, videoId, info, options).catch(() => false)
  inflight.set(keyHint, promise)
  void promise.then(() => {
    if (inflight.get(keyHint) === promise) inflight.delete(keyHint)
  })
  return promise
}

async function runFill(
  keyHint: string,
  videoId: string,
  info: StreamInfo,
  options: FillOptions
): Promise<boolean> {
  const deps: FillDeps = {
    cache: options.deps?.cache ?? getStreamCache(),
    aria2cPath: options.deps?.aria2cPath ?? (() => resolveAria2c()),
    download: options.deps?.download ?? downloadWithAria2c,
    downloadViaYtDlp: options.deps?.downloadViaYtDlp ?? downloadForCache
  }
  const log = options.log ?? ((): void => {})

  if (!cacheableStream(info)) return false

  const key = deps.cache.keyFor(keyHint)
  const dest = path.join(deps.cache.dir, `${key}.bin`)
  const sidecar = path.join(deps.cache.dir, `${key}.json`)

  // Already published (or a tee from a previous open) — nothing to do.
  if (fs.existsSync(dest) && fs.existsSync(sidecar)) return false
  const aria2cPath = deps.aria2cPath()
  if (!aria2cPath) {
    log(`[fill] ${keyHint} skipped: aria2c not installed`)
    return false
  }
  if (!(await acquireSlot())) {
    log(`[fill] ${keyHint} skipped: too many fills in flight`)
    return false
  }

  try {
    // Path 1: aria2c fetches the resolved URL directly — no re-extraction.
    try {
      const { bytes } = await deps.download({
        url: info.url,
        dir: deps.cache.dir,
        file: `${key}.bin`,
        timeoutMs: 15 * 60_000,
        onProgress: () => {}
      })
      if (deps.cache.publish(key, { url: info.url, contentType: contentTypeForExt(info.ext), total: bytes })) {
        log(`[fill] ${keyHint} cached (${bytes} bytes)`)
        return true
      }
      cleanup(dest)
      log(`[fill] ${keyHint} failed: the cache refused the finished file`)
      return false
    } catch (err) {
      cleanup(dest)
      const why =
        err instanceof Aria2Error && err.expired
          ? 'signed URL refused'
          : err instanceof Error
            ? err.message
            : String(err)
      log(`[fill] ${keyHint} direct fetch failed (${why}) — retrying through yt-dlp`)
    }

    // Path 2: yt-dlp downloads it (correct client/headers; aria2c attached
    // as its external downloader). Re-extraction also refreshes the URL.
    try {
      const produced = await deps.downloadViaYtDlp(videoId, path.join(deps.cache.dir, key), {
        aria2cPath
      })
      fs.renameSync(produced.file, dest)
      if (
        !deps.cache.publish(key, {
          url: info.url,
          contentType: contentTypeForExt(produced.ext),
          total: produced.bytes
        })
      ) {
        cleanup(dest)
        log(`[fill] ${keyHint} failed: the cache refused the finished file`)
        return false
      }
      log(`[fill] ${keyHint} cached via yt-dlp (${produced.bytes} bytes, ${produced.ext})`)
      return true
    } catch (err) {
      // Sweeps the renamed payload and any `<key>.<ext>` sibling the
      // downloader may have produced before failing.
      cleanup(dest)
      log(`[fill] ${keyHint} failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  } finally {
    releaseSlot()
  }
}
