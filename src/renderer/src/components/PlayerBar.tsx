import { TrackArtwork } from './TrackArtwork'
import { useEffect, useState } from 'react'
import { useCurrentTrack, usePlayer } from '../player/engine'
import { formatTime } from '../lib/format'
import {
  IconMute,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconShuffle,
  IconVolume
} from './Icons'

/**
 * The persistent bottom bar. Reads the single audio element's state from the
 * player store; it never owns audio state itself.
 */
export function PlayerBar(): React.JSX.Element {
  const track = useCurrentTrack()
  const playing = usePlayer((s) => s.playing)
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const loading = usePlayer((s) => s.loading)
  const error = usePlayer((s) => s.error)

  const { toggle, next, previous, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat } =
    usePlayer.getState()

  const hasTrack = Boolean(track)

  /**
   * While the user is dragging, `timeupdate` keeps firing with the OLD
   * position. With a plain controlled input that fights the thumb and yanks it
   * straight back — the second half of the "seek resets to zero" bug. Holding
   * the dragged value in local state takes precedence until they let go.
   */
  const [dragValue, setDragValue] = useState<number | null>(null)
  const trackId = track?.id ?? ''
  useEffect(() => {
    setDragValue(null)
  }, [trackId])

  const maxTime = Math.max(1, Math.floor(duration))
  const shown = Math.min(dragValue ?? Math.floor(currentTime), maxTime)

  return (
    <footer className="player">
      <div className="now-playing">
        {track ? (
          <>
            <TrackArtwork src={track.thumbnail} className="now-artwork" />
            <div className="track-main">
              <div className="track-title" title={track.title}>
                {track.title}
              </div>
              <div className="track-artist">{track.artist}</div>
            </div>
          </>
        ) : (
          <span className="hint">Nothing playing — pick a track from your library.</span>
        )}
      </div>

      <div>
        <div className="player-controls" style={{ justifyContent: 'center' }}>
          <button
            className={`ctrl${shuffle ? ' on' : ''}`}
            onClick={toggleShuffle}
            title={shuffle ? 'Shuffle on' : 'Shuffle off'}
            aria-label="Toggle shuffle"
          >
            <IconShuffle />
          </button>

          <button
            className="ctrl"
            onClick={previous}
            disabled={!hasTrack}
            title="Previous"
            aria-label="Previous track"
          >
            <IconPrev />
          </button>

          <button
            className="ctrl ctrl-play"
            onClick={toggle}
            disabled={!hasTrack}
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <IconPause size={19} /> : <IconPlay size={19} />}
          </button>

          <button
            className="ctrl"
            onClick={next}
            disabled={!hasTrack}
            title="Next"
            aria-label="Next track"
          >
            <IconNext />
          </button>

          <button
            className={`ctrl${repeat !== 'off' ? ' on' : ''}`}
            onClick={cycleRepeat}
            title={`Repeat: ${repeat}`}
            aria-label="Cycle repeat mode"
          >
            <IconRepeat />
            {repeat === 'one' && <span style={{ fontSize: 9, marginLeft: -4 }}>1</span>}
          </button>
        </div>

        <div className="progress-wrap" style={{ marginTop: 6 }}>
          <span className="time">{formatTime(shown)}</span>
          <input
            type="range"
            min={0}
            max={maxTime}
            step={1}
            value={shown}
            onChange={(e) => {
              const next = Number(e.target.value)
              setDragValue(next)
              seek(next)
            }}
            onPointerUp={() => setDragValue(null)}
            onKeyUp={() => setDragValue(null)}
            onBlur={() => setDragValue(null)}
            disabled={!hasTrack}
            aria-label="Seek"
          />
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        {loading && <span className="chip">loading…</span>}
        {error && <span className="chip chip-err" title={error}>playback error</span>}

        <button
          className="ctrl"
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <IconMute /> : <IconVolume />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          style={{ width: 96, flex: 'none' }}
          aria-label="Volume"
        />
      </div>
    </footer>
  )
}
