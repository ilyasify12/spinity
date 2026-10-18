import { memo, useEffect, useRef, type ReactNode } from 'react'
import { IconPause, IconPlay } from './Icons'
import { TrackArtwork } from './TrackArtwork'
import { formatTime } from '../lib/format'
import { t } from '../lib/i18n'

interface TrackRowProps {
  index: number
  title: string
  artist: string
  thumbnail: string
  durationSec: number
  /** Highlights the row when it is the track currently playing. */
  playing?: boolean
  onPlay?: () => void
  /**
   * Speculative warmup for network rows: fired ~140ms after the pointer
   * settles on the row (not every fly-by), so the click starts instantly.
   * De-duplicated by the caller; failures are its problem, never the UI's.
   */
  onPrewarm?: () => void
  /** Buttons revealed on hover (download, add to playlist, remove...). */
  actions?: ReactNode
  /** Heart toggle (Liked Songs). Rendered ahead of actions when provided. */
  liked?: boolean
  onToggleLike?: () => void
  /**
   * Keeps the track number in the first column and moves Play to the far right
   * (used by the Home rotation list) so both stay visible at rest.
   */
  numbered?: boolean
  /** Right-click menu for the whole row (built by the parent page). */
  onContextMenu?: (e: React.MouseEvent) => void
}

/**
 * Presentational row shared by search results, the library, playlists and
 * downloads, so the layout stays identical everywhere.
 */
export const TrackRow = memo(function TrackRow({
  index,
  title,
  artist,
  thumbnail,
  durationSec,
  playing = false,
  onPlay,
  onPrewarm,
  actions,
  liked,
  onToggleLike,
  numbered = false,
  onContextMenu
}: TrackRowProps): React.JSX.Element {
  const interactive = Boolean(onPlay)
  const prewarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPrewarm = (): void => {
    if (prewarmTimer.current) {
      clearTimeout(prewarmTimer.current)
      prewarmTimer.current = null
    }
  }
  // A row unmounting mid-hover (results replaced) must not fire later.
  useEffect(() => cancelPrewarm, [])
  const schedulePrewarm = (): void => {
    if (!onPrewarm || prewarmTimer.current) return
    prewarmTimer.current = setTimeout(() => {
      prewarmTimer.current = null
      try {
        onPrewarm()
      } catch {}
    }, 140)
  }

  return (
    <div
      className={`track-row${playing ? ' playing' : ''}`}
      onContextMenu={onContextMenu}
      onPointerEnter={onPrewarm ? schedulePrewarm : undefined}
      onPointerLeave={onPrewarm ? cancelPrewarm : undefined}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, select, input, a')) onPlay?.()
      }}
      role="group"
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (!interactive || e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPlay?.()
        }
      }}
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <div className="track-index">
        {onPlay && !numbered ? (
          <button type="button" className={`track-play${playing ? ' is-playing' : ''}`} aria-label={playing ? `${t('ctx.stop', 'Stop')} ${title}` : `${t('ctx.play', 'Play')} ${title}`} title={playing ? `${t('ctx.stop', 'Stop')} ${title}` : `${t('ctx.play', 'Play')} ${title}`}
            onClick={(e) => { e.stopPropagation(); onPlay() }}>
            {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
        ) : index + 1}
      </div>
      <TrackArtwork src={thumbnail} />
      <div className="track-main">
        <div className="track-title" title={title}>
          {title}
        </div>
        <div className="track-artist" title={artist}>
          {artist}
        </div>
      </div>
      <div className="track-dur">{durationSec > 0 ? formatTime(durationSec) : '—'}</div>
      <div />
      <div className={`row-actions${numbered ? ' always' : ''}`}>
        {onToggleLike && (
          <button
            type="button"
            className={`like-btn${liked ? ' liked' : ''}`}
            aria-label={liked ? `${t('ctx.unlike', 'Unlike')} ${title}` : `${t('ctx.like', 'Like')} ${title}`}
            title={liked ? t('ctx.unlike', 'Unlike') : t('ctx.like', 'Like')}
            onClick={(e) => { e.stopPropagation(); onToggleLike() }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0017.5 4c-1.8 0-3.4 1-4.2 2.4h-2.6C9.9 5 8.3 4 6.5 4A4.5 4.5 0 002 8.5c0 2.3 1.5 4 3 5.5l7 7z" />
            </svg>
          </button>
        )}
        {actions}
        {numbered && onPlay && (
          <button
            type="button"
            className={`track-play end-play${playing ? ' is-playing' : ''}`}
            aria-label={playing ? `Stop ${title}` : `Play ${title}`}
            title={playing ? `Stop ${title}` : `Play ${title}`}
            onClick={(e) => { e.stopPropagation(); onPlay() }}
          >
            {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
          </button>
        )}
      </div>
    </div>
  )
})
