import { useEffect, useState } from 'react'
import { TrackArtwork } from './TrackArtwork'
import { IconNext, IconPause, IconPlay, IconPrev, IconX } from './Icons'

/** Mirrors the MiniSnapshot shape exposed by the preload bridge. */
interface MiniSnapshot {
  trackId: string | null
  title: string
  artist: string
  art: string
  playing: boolean
  currentTime: number
  duration: number
}

/**
 * Mini-player widget (the `?mini=1` window). Fully driven by snapshots pushed
 * from the main window; every button sends a command back the same way.
 */
export function MiniPlayer(): React.JSX.Element {
  const [snap, setSnap] = useState<MiniSnapshot | null>(null)

  useEffect(() => window.spinity.events.onMiniState(setSnap), [])

  const pct = snap && snap.duration > 0 ? Math.max(0, Math.min(100, (snap.currentTime / snap.duration) * 100)) : 0

  function seekFromClientX(clientX: number, el: HTMLDivElement): void {
    if (!snap || snap.duration <= 0) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    void window.spinity.mini.cmd('seek', ratio * snap.duration)
  }

  return (
    <div className="mini">
      <div className="mini-drag" />
      <div className="mini-main">
        {snap?.art ? (
          <TrackArtwork src={snap.art} className="mini-art" />
        ) : (
          <span className="mini-art mini-art-empty">♪</span>
        )}
        <div className="mini-meta">
          <div className="mini-title" title={snap?.title ?? 'Nothing playing'}>
            {snap?.title ?? 'Nothing playing'}
          </div>
          <div className="mini-artist">{snap?.artist ?? 'Spinity'}</div>
          <div
            className="mini-progress"
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemax={Math.round(snap?.duration ?? 0)}
            aria-valuenow={Math.round(snap?.currentTime ?? 0)}
            onPointerDown={(e) => {
              ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
              seekFromClientX(e.clientX, e.currentTarget)
            }}
            onKeyDown={(e) => {
              if (!snap) return
              if (e.key === 'ArrowLeft') void window.spinity.mini.cmd('seek', Math.max(0, snap.currentTime - 5))
              if (e.key === 'ArrowRight') void window.spinity.mini.cmd('seek', Math.min(snap.duration, snap.currentTime + 5))
            }}
          >
            <span className="mini-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="mini-controls">
          <button className="ctrl sm" title="Previous" aria-label="Previous" onClick={() => void window.spinity.mini.cmd('previous')}>
            <IconPrev size={13} />
          </button>
          <button className="ctrl ctrl-play sm" title={snap?.playing ? 'Pause' : 'Play'} aria-label={snap?.playing ? 'Pause' : 'Play'} onClick={() => void window.spinity.mini.cmd('toggle')}>
            {snap?.playing ? <IconPause size={14} /> : <IconPlay size={14} />}
          </button>
          <button className="ctrl sm" title="Next" aria-label="Next" onClick={() => void window.spinity.mini.cmd('next')}>
            <IconNext size={13} />
          </button>
        </div>
        <button className="mini-close" title="Close mini-player" aria-label="Close mini-player" onClick={() => void window.spinity.mini.toggle()}>
          <IconX size={13} />
        </button>
      </div>
    </div>
  )
}
