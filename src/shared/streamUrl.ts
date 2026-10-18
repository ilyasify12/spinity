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
export function streamUrlFor(url: string): string {
  return `spinity://stream/?u=${encodeURIComponent(url)}`
}

/**
 * Recover the source URL from a `spinity://stream/…` request URL.
 * Returns null for anything that is not a well-formed http(s) target, so a
 * malformed request can never reach the network layer.
 */
export function streamUrlFrom(href: string): string | null {
  try {
    const parsed = new URL(href)
    if (parsed.protocol !== 'spinity:' || parsed.hostname !== 'stream') return null
    const raw = parsed.searchParams.get('u')
    if (!raw) return null
    const target = new URL(raw)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return null
    return target.toString()
  } catch {
    return null
  }
}
