/**
 * `spinity://stream/?u=<encoded-url>` — the cache-backed audio scheme.
 *
 * The renderer wraps any cacheable network audio URL (preview clips, Internet
 * Archive items) with `streamUrlFor()` and assigns the result to the single
 * <audio> element. The main-process protocol handler unwraps it, drives the
 * write-through StreamCache (network → audio element + disk, one pass), and
 * serves the growing file — so first audio arrives with the first network
 * bytes while the same bytes are being persisted for instant replays.
 *
 * Live radio deliberately does NOT use this wrapper: endless streams have no
 * "complete" state to cache, so they are dialled directly by the element.
 */

/** Wrap a direct audio URL in the privileged stream scheme. */
export function streamUrlFor(url: string, keyHint?: string): string {
  const base = `spinity://stream/?u=${encodeURIComponent(url)}`
  return keyHint ? `${base}&k=${encodeURIComponent(keyHint)}` : base
}

export interface StreamRequest {
  url: string
  /**
   * Optional stable identity (`yt:<videoId>`). Signed CDN URLs rotate after
   * a few hours; a hinted request finds the entry by id instead of by URL,
   * so a re-signed stream still replays from disk.
   */
  keyHint?: string
}

/**
 * Unwrap a `spinity://stream/…` request. Returns null for anything that is
 * not a well-formed http(s) target, so a malformed request can never reach
 * the network layer. The key hint is validated to a strict alphabet (it is
 * interpolated into a sha1, never into a command).
 */
export function streamRequestFrom(href: string): StreamRequest | null {
  try {
    const parsed = new URL(href)
    if (parsed.protocol !== 'spinity:' || parsed.hostname !== 'stream') return null
    const raw = parsed.searchParams.get('u')
    if (!raw) return null
    const target = new URL(raw)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return null
    const request: StreamRequest = { url: target.toString() }
    const key = parsed.searchParams.get('k')
    if (key && key.length <= 80 && /^[A-Za-z0-9:_-]+$/.test(key)) request.keyHint = key
    return request
  } catch {
    return null
  }
}

/**
 * Recover just the source URL from a `spinity://stream/…` request URL.
 * (Kept for existing callers; new code uses `streamRequestFrom`.)
 */
export function streamUrlFrom(href: string): string | null {
  return streamRequestFrom(href)?.url ?? null
}
