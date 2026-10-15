import { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../player/engine'
import { lyricIndexAt } from '@shared/lyrics'
import type { LyricsResult } from '@shared/types'
import { t } from '../lib/i18n'
import { IconX } from './Icons'

/**
 * Full-screen lyrics overlay over a blurred album-art backdrop. Synced lines
 * highlight and auto-scroll with playback; plain-text lyrics just scroll.
 */
export function LyricsView({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const trackId = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.id ?? null) : null))
  const title = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.title ?? '') : ''))
  const artist = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.artist ?? '') : ''))
  const art = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.thumbnail ?? '') : ''))
  const currentTime = usePlayer((s) => s.currentTime)

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!trackId) {
      setLyrics(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void window.spinity.lyrics
      .get(trackId)
      .then((r) => {
        if (!cancelled) {
          setLyrics(r)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLyrics(null)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [trackId, attempt])

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const idx = lyrics?.synced && lyrics.lines.length > 0 ? lyricIndexAt(lyrics.lines, currentTime) : -1

  // Keep the active line in view.
  useEffect(() => {
    if (idx < 0) return
    listRef.current
      ?.querySelector(`[data-line="${idx}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idx])

  if (!trackId) return null

  return (
    <div className="lyrics-overlay" role="dialog" aria-label={`Lyrics for ${title}`}>
      {art && <img className="lyrics-bg" src={art} alt="" aria-hidden="true" />}
      <div className="lyrics-shade" />
      <div className="lyrics-top">
        <div className="lyrics-head">
          <strong>{title}</strong>
          <span className="hint">{artist}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} title={t('player.closeLyrics', 'Close lyrics (Esc)')}>
          <IconX size={14} /> Close
        </button>
      </div>
      {loading ? (
        <div className="lyrics-body"><p className="hint">Finding lyrics…</p></div>
      ) : !lyrics || lyrics.lines.length === 0 ? (
        <div className="lyrics-body">
          <p className="hint">No lyrics found for this track.</p>
          <p className="hint">For local files, drop a matching <code>.lrc</code> next to the audio to use your own.</p>
          <button className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      ) : (
        <div className="lyrics-body" ref={listRef}>
          {!lyrics.synced && (
            <p className="hint" style={{ textAlign: 'center' }}>
              Unsynced lyrics {lyrics.source === 'sidecar' ? '(your .lrc file has no timestamps)' : '(auto-fetched)'}
            </p>
          )}
          {lyrics.lines.map((l, i) => (
            <p
              key={i}
              data-line={i}
              className={`lyric-line${lyrics.synced && i === idx ? ' active' : ''}${lyrics.synced && i < idx ? ' past' : ''}`}
            >
              {l.text}
            </p>
          ))}
        </div>
      )}
      {lyrics && lyrics.lines.length > 0 && (
        <div className="lyrics-foot hint">
          {lyrics.synced ? 'Synced' : 'Plain text'} · {lyrics.source === 'sidecar' ? 'your .lrc file' : 'auto-matched'}
        </div>
      )}
    </div>
  )
}
