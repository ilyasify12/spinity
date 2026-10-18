import type { FreeHit, RadioChannel } from '@shared/types'

/**
 * Speculative warmup for network playback: hover a Play button and the work
 * that would block the click happens before it.
 *
 *  - YouTube results: the stream URL is resolved by yt-dlp (seconds cold) and
 *    cached in the main process for 3h — hovering resolves it, so the click
 *    only waits for the element's first buffer.
 *  - Free hits (previews / Internet Archive): the write-through cache fetches
 *    the URL; a warmed entry answers the element from local bytes.
 *  - Radio: the station's .pls is resolved to a direct stream URL and kept
 *    for the session, so tuning in skips that round trip.
 *
 * Everything here is fire-and-forget and de-duplicated; failures are silent
 * because the click path retries properly and owns the user-facing errors.
 * Warming is deliberately conservative (one hover, not every search result),
 * so it never turns a search into a burst of yt-dlp processes.
 */

const warmedStreams = new Set<string>()
const warmedFree = new Set<string>()

/** YouTube: resolve the stream URL ahead of the click. */
export function prewarmStream(videoId: string): void {
  if (!videoId || warmedStreams.has(videoId)) return
  warmedStreams.add(videoId)
  try {
    void window.spinity.youtube.stream(videoId).catch(() => {})
  } catch {}
}

/** Free hit: start the write-through cache download ahead of the click. */
export function prewarmFree(hit: FreeHit): void {
  const url = hit.audioUrl
  if (!url || warmedFree.has(url)) return
  warmedFree.add(url)
  try {
    void window.spinity.free.prewarm(url).catch(() => {})
  } catch {}
}

// ------------------------------------------------------------------ radio

/** Resolved .pls → direct stream URLs, per session (stations don't move). */
const radioResolved = new Map<string, string>()
const radioInflight = new Map<string, Promise<string>>()
const radioWarmed = new Set<string>()

/** Resolve a station once; concurrent callers share the same round trip. */
export function resolveRadio(plsUrl: string): Promise<string> {
  const cached = radioResolved.get(plsUrl)
  if (cached) return Promise.resolve(cached)
  const inflight = radioInflight.get(plsUrl)
  if (inflight) return inflight
  const p = window.spinity.free
    .radioResolve(plsUrl)
    .then((url) => {
      radioResolved.set(plsUrl, url)
      return url
    })
    .finally(() => {
      if (radioInflight.get(plsUrl) === p) radioInflight.delete(plsUrl)
    })
  radioInflight.set(plsUrl, p)
  return p
}

/** Radio row hover: warm this station's .pls. */
export function prewarmRadio(channel: RadioChannel): void {
  if (!channel.plsUrl || radioWarmed.has(channel.plsUrl)) return
  radioWarmed.add(channel.plsUrl)
  void resolveRadio(channel.plsUrl).catch(() => {})
}

/**
 * After the station list lands, quietly resolve the ones the UI shows first
 * (three at a time — these are tiny text files, but politeness is free).
 */
export function prefetchRadioChannels(channels: RadioChannel[], count = 8): void {
  void (async () => {
    const list = channels.slice(0, count)
    for (let i = 0; i < list.length; i += 3) {
      await Promise.allSettled(list.slice(i, i + 3).map((ch) => resolveRadio(ch.plsUrl)))
    }
  })()
}
