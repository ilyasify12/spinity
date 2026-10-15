/**
 * YouTube thumbnail quality upgrades — shared by main and renderer.
 *
 * Search results are stored with small `mqdefault` (320x180) URLs, which look
 * blurry stretched over Home mood cards and large tiles. `hqdefault`
 * (480x360) exists for every video, so upgrading the URL fixes quality for
 * existing libraries with zero re-downloads. Non-YouTube URLs pass through
 * untouched.
 */

const LOW_RES = /^(https?:\/\/i\d*\.ytimg\.com\/vi\/[^/?#]+\/)(mqdefault|default|[0-3])(\.jpg)([?#].*)?$/i

export function hqThumb(url: string | null | undefined): string {
  if (!url) return ''
  const m = LOW_RES.exec(url.trim())
  if (!m) return url
  // Keep any query string (?sqp=...) some yt-dlp thumbnails carry.
  return `${m[1]}hqdefault${m[3]}${m[4] ?? ''}`
}

/**
 * Where the main process serves embedded artwork for a local track.
 *
 * The version segment is not decoration: Chromium keys its HTTP cache on the
 * full URL, so bumping it (v1 -> v2, ...) is how a change to what the
 * protocol returns — embedded art replacing a borrowed YouTube cover, say —
 * reaches every tile immediately instead of waiting out the old entry's
 * max-age. Without it a fixed app keeps showing the stale, wrong image for
 * as long as ten minutes after an update.
 */
export const ARTWORK_URL_VERSION = 'v2'

/** Artwork URL for a local track id. */
export function artworkUrl(trackId: string): string {
  return `spinity://artwork/${ARTWORK_URL_VERSION}/${encodeURIComponent(trackId)}`
}

/** Track id inside an artwork URL, or null when it is not one. */
export function artworkTrackId(url: string | null | undefined): string | null {
  if (!url) return null
  const match = /^spinity:\/\/artwork\/(?:v\d+\/)?([^/?#]+)$/i.exec(url.trim())
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}
