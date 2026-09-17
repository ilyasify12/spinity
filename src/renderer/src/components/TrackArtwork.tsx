import { useEffect, useRef, useState } from 'react'

/** Black immediately; request artwork only after a visible tile has settled. */
export function TrackArtwork({ src, className = 'track-thumb' }: { src: string; className?: string }): React.JSX.Element {
  const tile = useRef<HTMLSpanElement>(null)
  const [requested, setRequested] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!src || !tile.current) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let idle: number | undefined
    let visible = false
    const cancel = () => {
      clearTimeout(timer)
      if (idle !== undefined) window.cancelIdleCallback(idle)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancel()
      if (visible) {
        // Do not spawn processes during the first paint or fast scrolling.
        timer = setTimeout(() => {
          idle = window.requestIdleCallback(() => {
            if (visible) setRequested(src)
          }, { timeout: 1000 })
        }, 250)
      }
    }, { rootMargin: '0px' })
    observer.observe(tile.current)
    return () => { visible = false; cancel(); observer.disconnect() }
  }, [src])

  const showImage = requested === src && failed !== src && Boolean(src)
  return (
    <span ref={tile} className={`${className} artwork-tile`} aria-label={loaded === src && src ? undefined : 'No cover art'}>
      {showImage && <img className="artwork-image" src={src} alt="" decoding="async"
        style={{ opacity: loaded === src ? 1 : 0 }}
        onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />}
    </span>
  )
}
