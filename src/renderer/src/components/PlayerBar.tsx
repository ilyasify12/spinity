import { TrackArtwork } from './TrackArtwork'
import { Waveform } from './Waveform'
import { useEffect, useRef, useState } from 'react'
import { useCurrentTrack, usePlayer } from '../player/engine'
import { useUi } from '../store/ui'
import { useApp } from '../store/app'
import { formatTime } from '../lib/format'
import { t } from '../lib/i18n'
import type { AudioInfo } from '@shared/types'
import {
  IconExternal,
  IconHeart,
  IconMusic,
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
 * Range-track background: accent up to `pct`, muted grey for the rest.
 *
 * Applied inline rather than via a CSS custom property so it also beats the
  * global `input[type=range]:hover` rule and the ember fill survives hovering.
 */
function fillBg(pct: number): { background: string } {
  const p = Math.max(0, Math.min(100, pct)).toFixed(2)
  return { background: `linear-gradient(to right, var(--accent) 0 ${p}%, #4d4d4d ${p}% 100%)` }
}

/** Compact codec tag: "FLAC · 96 kHz · 24-bit", "MP3 · 320 kbps", "OPUS", … */
function codecLabel(info: AudioInfo): string {
  const codec = (info.codec || '').toUpperCase()
  const parts = [codec || 'Audio']
  if (info.sampleRate > 0) {
    const khz = info.sampleRate / 1000
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`)
  }
  if (info.bitsPerSample > 0) parts.push(`${info.bitsPerSample}-bit`)
  else if (info.bitRate > 0) parts.push(`${Math.round(info.bitRate / 1000)} kbps`)
  return parts.join(' · ')
}

/**
 * Spotify-style bottom bar: track left, controls + progress center,
 * volume right. Reads the single audio element's state from the store.
 */
export function PlayerBar(): React.JSX.Element {
  const track = useCurrentTrack()
  const playing = usePlayer((s) => s.playing)
  const duration = usePlayer((s) => s.duration)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const loading = usePlayer((s) => s.loading)
  const error = usePlayer((s) => s.error)

  // The elapsed-time label is updated imperatively at the engine's 4Hz tick —
  // selecting `currentTime` here re-rendered the whole bar (and its 180-span
  // waveform) four times a second, the main source of player jank.
  const timeRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const sync = (): void => {
      const el = timeRef.current
      if (!el) return
      const s = usePlayer.getState()
      const max = Math.max(1, Math.floor(s.duration))
      const next = formatTime(Math.min(Math.floor(s.currentTime), max))
      if (el.textContent !== next) el.textContent = next
    }
    sync()
    return usePlayer.subscribe(sync)
  }, [])

  // The loading flag flips true→false in ms on preloaded tracks — only show
  // the chip when it persists, so skipping songs doesn't flash "loading…".
  const [showLoading, setShowLoading] = useState(false)
  useEffect(() => {
    if (!loading) {
      setShowLoading(false)
      return
    }
    const t = setTimeout(() => setShowLoading(true), 400)
    return () => clearTimeout(t)
  }, [loading])

  const { toggle, next, previous, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat } =
    usePlayer.getState()

  const hasTrack = Boolean(track)

  const maxTime = Math.max(1, Math.floor(duration))
  const shownNow = Math.min(Math.floor(usePlayer.getState().currentTime), maxTime)

  const volFill = fillBg(muted ? 0 : volume * 100)

  const lyricsOpen = useUi((s) => s.lyricsOpen)
  const toggleLyrics = useUi((s) => s.toggleLyrics)
  const likedIds = useApp((s) => s.likedIds)
  const toggleLike = useApp((s) => s.toggleLike)
  const notify = useApp((s) => s.notify)
  const liked = Boolean(track && likedIds.includes(track.id))

  // Codec tag (ffprobe, cached per track). Local + downloaded files alike.
  const codecCache = useRef(new Map<string, string | null>())
  const [codecTag, setCodecTag] = useState<string | null>(null)
  const [codecTitle, setCodecTitle] = useState<string>('')
  useEffect(() => {
    if (!track?.id || !track.filePath) {
      setCodecTag(null)
      return
    }
    let cancelled = false
    const cached = codecCache.current.get(track.id)
    if (cached !== undefined) {
      setCodecTag(cached)
      return
    }
    setCodecTag(null)
    void window.spinity.audio
      .probe(track.id)
      .then((info) => {
        if (cancelled) return
        if (!info) {
          codecCache.current.set(track.id, null)
          return
        }
        const label = codecLabel(info)
        codecCache.current.set(track.id, label)
        setCodecTag(label)
        const ch = info.channels > 0 ? `${info.channels}ch` : ''
        setCodecTitle([label, ch].filter(Boolean).join(' · '))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track?.id, track?.filePath])

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
              <div className="track-artist">
                {track.artist}
                {codecTag && (
                  <>
                    {' '}
                    <span className="codec-tag" title={codecTitle || codecTag}>{codecTag}</span>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <span className="hint">{t('player.nothing', 'Nothing playing — pick a track.')}</span>
        )}
      </div>

      <div className="player-mid">
        <div className="player-controls">
          <button
            className={`ctrl${shuffle ? ' on' : ''}`}
            onClick={toggleShuffle}
            title={shuffle ? t('player.shuffleOn', 'Shuffle on') : t('player.shuffleOff', 'Shuffle off')}
            aria-label={t('player.toggleShuffle', 'Toggle shuffle')}
          >
            <IconShuffle size={15} />
          </button>

          <button
            className="ctrl"
            onClick={previous}
            disabled={!hasTrack}
            title={t('player.prev', 'Previous')}
            aria-label={t('player.prevTrack', 'Previous track')}
          >
            <IconPrev size={15} className="ico-prev" />
          </button>

          <button
            className="ctrl ctrl-play"
            onClick={toggle}
            disabled={!hasTrack}
            title={playing ? t('player.pause', 'Pause') : t('player.play', 'Play')}
            aria-label={playing ? t('player.pause', 'Pause') : t('player.play', 'Play')}
          >
            {playing ? <IconPause size={17} /> : <IconPlay size={17} />}
          </button>

          <button
            className="ctrl"
            onClick={next}
            disabled={!hasTrack}
            title={t('player.next', 'Next')}
            aria-label={t('player.nextTrack', 'Next track')}
          >
            <IconNext size={15} className="ico-next" />
          </button>

          <button
            className={`ctrl${repeat !== 'off' ? ' on' : ''}`}
            onClick={cycleRepeat}
            title={
              repeat === 'one'
                ? t('player.repeatOne', 'Repeat: one')
                : repeat === 'all'
                  ? t('player.repeatAll', 'Repeat: all')
                  : t('player.repeatOff', 'Repeat: off')
            }
            aria-label={t('player.cycleRepeat', 'Cycle repeat mode')}
          >
            <IconRepeat size={15} />
            {repeat === 'one' && <span style={{ fontSize: 9, marginLeft: -4 }}>1</span>}
          </button>
        </div>

        <div className="progress-wrap">
          <span className="time" ref={timeRef}>{formatTime(shownNow)}</span>
          <Waveform maxTime={maxTime} disabled={!hasTrack} onSeek={seek} />
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-right">
        {showLoading && <span className="chip">{t('player.loadingChip', 'loading…')}</span>}
        {error && <span className="chip chip-err" title={error}>{t('player.errorChip', 'error')}</span>}

        <button
          className={`ctrl${liked ? ' on' : ''}`}
          onClick={() => {
            if (!track) return
            void toggleLike(track.id, track)
            notify(
              liked
                ? t('toast.removedLiked', 'Removed from Liked Songs')
                : t('toast.addedLiked', 'Added to Liked Songs')
            )
          }}
          disabled={!hasTrack}
          title={liked ? t('ctx.unlike', 'Remove from Liked Songs') : t('ctx.like', 'Save to Liked Songs')}
          aria-label={liked ? t('ctx.unlike', 'Remove from Liked Songs') : t('ctx.like', 'Save to Liked Songs')}
        >
          <IconHeart size={15} filled={liked} />
        </button>

        <button
          className={`ctrl${lyricsOpen ? ' on' : ''}`}
          onClick={() => toggleLyrics()}
          disabled={!hasTrack}
          title={t('player.lyrics', 'Lyrics')}
          aria-label={t('player.showLyrics', 'Show lyrics')}
        >
          <IconMusic size={15} />
        </button>

        <button
          className="ctrl"
          onClick={() => void window.spinity.mini.toggle().catch(() => {})}
          title={t('player.mini', 'Mini-player widget')}
          aria-label={t('player.openMini', 'Open mini-player')}
        >
          <IconExternal size={14} />
        </button>

        <button
          className="ctrl"
          onClick={toggleMute}
          title={muted ? t('player.unmute', 'Unmute') : t('player.mute', 'Mute')}
          aria-label={muted ? t('player.unmute', 'Unmute') : t('player.mute', 'Mute')}
        >
          {muted ? <IconMute size={15} /> : <IconVolume size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          style={volFill}
          aria-label={t('player.volume', 'Volume')}
        />
      </div>
    </footer>
  )
}
