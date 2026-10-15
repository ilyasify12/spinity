import { useEffect, useRef, useState } from 'react'
import { IconMusic } from './Icons'
import { hqThumb, artworkTrackId } from '@shared/thumbs'

/**
 * Album-art tile.
 *
 * Three things keep this fast on large libraries:
 *  - nothing is requested until the tile is actually on screen,
 *  - a short debounce (not a full idle round trip) so scrolling never spawns
 *    a burst of ffmpeg jobs, and
 *  - URLs already decoded in this session paint immediately on re-mount, so
 *    navigating between pages does not re-fade every cover in.
 */
export function TrackArtwork({ src, className = 'track-thumb' }: { src: string; className?: string }): React.JSX.Element {
  const tile = useRef<HTMLSpanElement>(null)
  const [requested, setRequested] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Stored library thumbnails are small `mqdefault` URLs — upgrade to
  // `hqdefault` so large tiles (Home moods, heroes) stay sharp.
  const hiRes = hqThumb(src)
  const trackId = artworkTrackId(hiRes)

  useEffect(() => {
    if (!hiRes || !tile.current) return
    // Already decoded once in this session: show it now, no waiting at all.
    if (decodedUrls.has(hiRes)) {
      setFailed(null)
      setRequested(hiRes)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let visible = false
    const cancel = () => clearTimeout(timer)
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancel()
      if (visible) {
        // Do not spawn processes for tiles the user is scrolling past.
        timer = setTimeout(() => {
          if (visible) setRequested(hiRes)
        }, 60)
      }
    }, { rootMargin: '0px' })
    observer.observe(tile.current)
    return () => { visible = false; cancel(); observer.disconnect() }
  }, [hiRes, attempt])

  // Main borrows a YouTube cover for local files with no embedded art. That
  // lookup no longer blocks the request: the tile shows the placeholder, and
  // when the cover lands this event tells us to ask one more time.
  useEffect(() => {
    if (!trackId) return
    const off = window.spinity.events.onArtworkReady(({ trackId: ready }) => {
      if (ready !== trackId) return
      decodedUrls.delete(hiRes)
      setFailed(null)
      setRequested(null)
      setAttempt((n) => n + 1)
    })
    return off
  }, [trackId, hiRes])

  const showImage = requested === hiRes && failed !== hiRes && Boolean(hiRes)
  // Nothing to request, or the request came back empty (no embedded cover and no
  // YouTube match): fall back to the default note instead of a blank tile. A
  // pending request is neither, so the tile stays dark until the answer lands.
  const showDefault = !hiRes || failed === hiRes
  return (
    <span ref={tile} className={`${className} artwork-tile`} aria-label={showDefault ? 'No cover art' : undefined}>
      {showImage && (
        <img
          key={attempt}
          className="artwork-image"
          src={hiRes}
          alt=""
          decoding="async"
          loading="lazy"
          style={{ opacity: loaded === hiRes ? 1 : 0 }}
          onLoad={() => { decodedUrls.add(hiRes); setLoaded(hiRes) }}
          onError={() => setFailed(hiRes)}
        />
      )}
      {showDefault && (
        <span className="artwork-fallback" aria-hidden="true">
          <IconMusic size={24} />
        </span>
      )}
    </span>
  )
}

/** URLs decoded during this session — re-mounts reuse the decoded bitmap. */
const decodedUrls = new Set<string>()
