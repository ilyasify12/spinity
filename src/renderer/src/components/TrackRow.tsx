import type { ReactNode } from 'react'
import { IconPlay } from './Icons'
import { TrackArtwork } from './TrackArtwork'
import { formatTime } from '../lib/format'

interface TrackRowProps {
  index: number
  title: string
  artist: string
  thumbnail: string
  durationSec: number
  /** Highlights the row when it is the track currently playing. */
  playing?: boolean
  onPlay?: () => void
  /** Buttons revealed on hover (download, add to playlist, remove...). */
  actions?: ReactNode
}

/**
 * Presentational row shared by search results, the library, playlists and
 * downloads, so the layout stays identical everywhere.
 */
export function TrackRow({
  index,
  title,
  artist,
  thumbnail,
  durationSec,
  playing = false,
  onPlay,
  actions
}: TrackRowProps): React.JSX.Element {
  const interactive = Boolean(onPlay)

  return (
    <div
      className={`track-row${playing ? ' playing' : ''}`}
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
        {onPlay ? (
          <button type="button" className="track-play" aria-label={`Play ${title}`} title={`Play ${title}`}
            onClick={(e) => { e.stopPropagation(); onPlay() }}>
            <IconPlay size={16} />
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
      <div className="row-actions">{actions}</div>
    </div>
  )
}
