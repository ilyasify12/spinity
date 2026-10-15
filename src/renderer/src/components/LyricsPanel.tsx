import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayer } from '../player/engine'
import { useUi } from '../store/ui'
import { useApp } from '../store/app'
import {
  DEFAULT_LYRIC_SYNC,
  audioTimeFromLyric,
  describeLyricSync,
  isForeignEdit,
  lyricIndexAt,
  lyricTimeFromAudio,
  type LyricLine,
  type LyricSync
} from '@shared/lyrics'
import type { LyricsResult } from '@shared/types'
import { formatTime } from '../lib/format'
import { t } from '../lib/i18n'
import { IconX, IconUpload, IconMusic, IconSearch, IconShuffle, IconTarget } from './Icons'

/** One tap of the sync buttons. Fine enough to nail a chorus by ear. */
const SYNC_STEP_MS = 250

/**
 * Lyrics docked on the right edge of the shell.
 *
 * Deliberately NOT an overlay: the pages, the player bar and the queue stay
 * visible and usable while lyrics are open, exactly like Spotify's right-hand
 * lyrics view. The X in the header (or `L` / Esc) closes it again.
 *
 * Sources, in order: lyrics the user uploaded/pasted, a `.lrc` sidecar next to
 * the local file, then a scored lrclib match. Local files whose name is not a
 * song title (`1.mp3`, `Track 03.wav`) are never looked up — the panel asks for
 * an upload instead, and a match that turns out to be an instrumental says so.
 */
export function LyricsPanel(): React.JSX.Element | null {
  const open = useUi((s) => s.lyricsOpen)
  const setLyricsOpen = useUi((s) => s.setLyricsOpen)
  const notify = useApp((s) => s.notify)
  const lyricsMode = useApp((s) => s.settings.lyricsMode)
  const updateSettings = useApp((s) => s.updateSettings)

  const trackId = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.id ?? null) : null))
  const title = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.title ?? '') : ''))
  const artist = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.artist ?? '') : ''))
  const art = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.thumbnail ?? '') : ''))
  const filePath = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.filePath ?? '') : ''))
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const playing = usePlayer((s) => s.playing)
  const seek = usePlayer((s) => s.seek)

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pasting, setPasting] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * Normal ⇄ AI writing.
   *
   * The setting is awaited before re-reading, because the main process reads
   * `lyricsMode` while handling `lyrics:get` — bumping `attempt` first would
   * race the write and show the old mode's lyrics.
   */
  const setMode = async (mode: 'normal' | 'ai'): Promise<void> => {
    if (mode === lyricsMode) return
    await updateSettings({ lyricsMode: mode })
    setLyrics(null)
    setAttempt((a) => a + 1)
  }

  const sync: LyricSync = lyrics?.sync ?? DEFAULT_LYRIC_SYNC
  /** Length of the recording the lyrics were timed against (0 = unknown). */
  const refDuration = sync.refDurationSec

  useEffect(() => {
    if (!open || !trackId) {
      setLyrics(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setPasting(false)
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
  }, [open, trackId, attempt])

  const synced = Boolean(lyrics?.synced && lyrics.lines.length > 0)
  // The lines are timed against the reference recording: map the audio clock
  // through the speed fit and the manual offset before picking a line.
  const lyricPos = lyricTimeFromAudio(currentTime, sync)
  const idx = synced ? lyricIndexAt(lyrics!.lines, lyricPos) : -1

  /**
   * Nudge the timing. Every local file is *some* edit of the recording the
   * lyrics were timed against, so this is the escape hatch that works for any
   * song: tap until the highlighted line matches what you hear.
   */
  const nudge = useCallback(
    (deltaMs: number) => {
      if (!trackId) return
      const next = { offsetMs: sync.offsetMs + deltaMs }
      // Optimistic so the highlight moves with the tap, not after a round trip.
      setLyrics((current) => (current ? { ...current, sync: { ...current.sync, offsetMs: next.offsetMs, auto: false } } : current))
      void window.spinity.lyrics.sync(trackId, next).then((r) => r && setLyrics(r)).catch(() => {})
    },
    [trackId, sync.offsetMs]
  )

  const resetSync = useCallback(() => {
    if (!trackId) return
    // Explicit zeros rather than clearing the record: "no shift, I mean it"
    // must survive the automatic alignment that a cleared record would re-run.
    void window.spinity.lyrics
      .sync(trackId, { offsetMs: 0, scale: 1 })
      .then((r) => r && setLyrics(r))
      .catch(() => {})
  }, [trackId])

  /** Ask main to look the song up again (drops the cached automatic match). */
  const rematch = useCallback(async () => {
    if (!trackId || busy) return
    setBusy(true)
    setLoading(true)
    try {
      const r = await window.spinity.lyrics.rematch(trackId)
      setLyrics(r)
      notify(
        r && r.lines.length > 0
          ? lyricsMode === 'ai'
            ? t('lyrics.rewritten', 'Written again')
            : t('lyrics.rematched', 'Matched again')
          : t('lyrics.noneFound', 'No lyrics found for this track.')
      )
    } catch {
      /* keep whatever is on screen */
    } finally {
      setBusy(false)
      setLoading(false)
    }
  }, [trackId, busy, notify])

  /**
   * Line the words up with *this* file: the video whose length matches the
   * track is the recording, and its timed captions say where each line is
   * actually sung. Runs by itself once per track when the match is a different
   * edit, and again whenever the user asks.
   */
  const align = useCallback(
    async (announce: boolean) => {
      if (!trackId || busy) return
      setBusy(true)
      try {
        const r = await window.spinity.lyrics.align(trackId)
        if (r) {
          setLyrics(r)
          if (announce) {
            notify(
              r.sync.source === 'captions'
                ? `${t('lyrics.alignedTo', 'Aligned to this recording')} (${describeLyricSync(r.sync)})`
                : t('lyrics.alignFailed', 'Could not align these lyrics to the file'),
              r.sync.source === 'captions' ? 'info' : 'error'
            )
          }
        }
      } catch {
        if (announce) notify(t('lyrics.alignFailed', 'Could not align these lyrics to the file'), 'error')
      } finally {
        setBusy(false)
      }
    },
    [trackId, busy, notify]
  )

  // Automatic alignment: only for local files, only when the current match is a
  // different edit, and only once per track (main records the attempt).
  const autoAlignKey = useRef<string | null>(null)
  useEffect(() => {
    if (!open || !trackId || !lyrics || loading) return
    if (lyrics.source !== 'lrclib' || lyrics.lines.length < 3) return
    if (lyrics.sync.alignedAt) return
    if (!filePath) return
    if (autoAlignKey.current === trackId) return
    autoAlignKey.current = trackId
    void align(false)
  }, [open, trackId, lyrics, loading, filePath, align])

  /**
   * Explicit speed fit: stretch the lyric timeline by this file's own length
   * ratio. The automatic fit stays conservative (it refuses ratios that look
   * like cuts), but pressing the button is a deliberate instruction.
   */
  const speedFit = refDuration > 0 && duration > 0 ? Math.max(0.25, Math.min(4, duration / refDuration)) : 1
  const fitSpeed = useCallback(() => {
    if (!trackId || !refDuration || duration <= 0) return
    void window.spinity.lyrics
      .sync(trackId, { scale: speedFit, offsetMs: 0 })
      .then((r) => r && setLyrics(r))
      .catch(() => {})
  }, [trackId, refDuration, duration, speedFit])

  // `[` / `]` nudge while the panel is open.
  useEffect(() => {
    if (!open || !synced) return
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (e.key === '[') {
        e.preventDefault()
        nudge(-SYNC_STEP_MS)
      } else if (e.key === ']') {
        e.preventDefault()
        nudge(SYNC_STEP_MS)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, synced, nudge])

  /**
   * Keep the active line centred — the "karaoke" feel. Only lines currently
   * off-centre are scrolled, so a 4Hz timeupdate cannot make the list twitch.
   */
  useEffect(() => {
    if (idx < 0) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-line="${idx}"]`)
    const box = listRef.current
    if (!node || !box) return
    const target = node.offsetTop - box.clientHeight / 2 + node.clientHeight / 2
    if (Math.abs(box.scrollTop - target) < 8) return
    box.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [idx])

  /** Progress through the song, so the header can show where we are. */
  const progress = useMemo(() => {
    const total = duration > 0 ? duration : 0
    if (total <= 0) return 0
    return Math.max(0, Math.min(1, currentTime / total))
  }, [currentTime, duration])

  const onLineClick = useCallback(
    (line: LyricLine) => {
      if (!synced) return
      seek(audioTimeFromLyric(line.t, sync))
    },
    [seek, synced, sync]
  )

  async function upload(): Promise<void> {
    if (!trackId || busy) return
    setBusy(true)
    try {
      const r = await window.spinity.lyrics.upload(trackId)
      if (r) {
        setLyrics(r)
        setPasting(false)
        notify(t('lyrics.saved', 'Lyrics saved for this track'))
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : t('lyrics.saveFailed', 'Could not read that lyrics file'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft(): Promise<void> {
    if (!trackId || busy || !draft.trim()) return
    setBusy(true)
    try {
      setLyrics(await window.spinity.lyrics.set(trackId, draft))
      setPasting(false)
      setDraft('')
      notify(t('lyrics.saved', 'Lyrics saved for this track'))
    } catch (err) {
      notify(err instanceof Error ? err.message : t('lyrics.saveFailed', 'Could not save those lyrics'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function clearMine(): Promise<void> {
    if (!trackId || busy) return
    setBusy(true)
    try {
      await window.spinity.lyrics.clear(trackId)
      setAttempt((a) => a + 1)
    } catch {
      /* nothing to report — the panel just keeps what it has */
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const canFetch = lyrics?.canFetch ?? true
  const instrumental = Boolean(lyrics?.instrumental)
  const empty = !loading && (!lyrics || lyrics.lines.length === 0)
  const matched = lyrics?.matched ?? null
  const foreignEdit = isForeignEdit(duration, refDuration)

  return (
    <aside className="lyrics-panel" aria-label={t('lyrics.panel', 'Lyrics')}>
      {/* Blurred artwork backdrop: the panel reads as part of the track. */}
      {art && <img className="lyrics-art" src={art} alt="" aria-hidden="true" />}
      <div className="lyrics-glow" aria-hidden="true" />

      <header className="lyrics-head">
        <div className="lyrics-head-text">
          <strong title={title}>{title || t('lyrics.nothing', 'Nothing playing')}</strong>
          <span className="hint">{artist}</span>
        </div>
        {playing && (
          <span className="lyrics-eq" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <button
          className="sp-icon-btn"
          onClick={() => setLyricsOpen(false)}
          title={t('player.closeLyrics', 'Close lyrics (Esc)')}
          aria-label={t('player.closeLyrics', 'Close lyrics (Esc)')}
        >
          <IconX size={15} />
        </button>
      </header>

      {/* Where we are in the song — the panel's own progress line. */}
      <div className="lyrics-progress" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      {!trackId ? (
        <div className="lyrics-body">
          <p className="hint">{t('lyrics.playSomething', 'Play a track to see its lyrics here.')}</p>
        </div>
      ) : loading ? (
        <div className="lyrics-body">
          <p className="hint">
            {lyricsMode === 'ai'
              ? t('lyrics.writing', 'Writing lyrics with AI…')
              : t('lyrics.finding', 'Finding lyrics…')}
          </p>
          <span className="lyrics-shimmer" aria-hidden="true" />
        </div>
      ) : pasting ? (
        <div className="lyrics-body lyrics-paste">
          <p className="hint">
            {t('lyrics.pasteHint', 'Paste lyrics — timestamps like [00:12.00] make them scroll along.')}
          </p>
          <textarea
            className="lyrics-textarea"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'[00:12.00] First line\n[00:18.50] Second line'}
            aria-label={t('lyrics.paste', 'Paste lyrics')}
          />
          <div className="lyrics-actions">
            <button className="btn btn-sm" onClick={() => void saveDraft()} disabled={busy || !draft.trim()}>
              {t('action.save', 'Save')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPasting(false); setDraft('') }}>
              {t('action.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      ) : empty ? (
        <div className="lyrics-body lyrics-empty">
          {instrumental ? (
            <>
              <p className="lyrics-badge">
                <IconMusic size={14} /> {t('lyrics.instrumental', 'Instrumental')}
              </p>
              <p className="hint">{t('lyrics.instrumentalHint', 'This track has no lyrics to show.')}</p>
            </>
          ) : canFetch ? (
            <p className="hint">{t('lyrics.noneFound', 'No lyrics found for this track.')}</p>
          ) : (
            <>
              <p className="hint">
                {t('lyrics.noName', 'This file has no song name to match, so nothing was searched.')}
              </p>
              <p className="hint">
                {filePath
                  ? t('lyrics.dropLrc', 'Name the file after the song, or add your own lyrics below — a .lrc next to the audio also works.')
                  : t('lyrics.addOwn', 'Add your own lyrics below.')}
              </p>
            </>
          )}

          {matched && (
            <p className="lyrics-match">
              <IconSearch size={13} />
              <span>
                {t('lyrics.matched', 'Matched')} <strong>{matched.title}</strong>
                {matched.artist ? ` — ${matched.artist}` : ''}
                {lyrics?.ai ? ` · ${t('lyrics.aiPicked', 'AI')}` : ''}
              </span>
            </p>
          )}

          <div className="lyrics-actions">
            <button className="btn btn-sm" onClick={() => void upload()} disabled={busy}>
              <IconUpload size={14} /> {t('lyrics.chooseFile', 'Choose .lrc file')}
            </button>
            {canFetch && !instrumental && (
              <button className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
                {t('lyrics.tryAgain', 'Try again')}
              </button>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setPasting(true)}>
            {t('lyrics.pasteLyrics', 'Paste lyrics instead')}
          </button>
        </div>
      ) : (
        <div className="lyrics-body" ref={listRef}>
          {!lyrics?.synced && (
            <p className="hint" style={{ textAlign: 'center' }}>
              {lyrics?.source === 'ai'
                ? t('lyrics.unsyncedAi', 'AI-written — plain text, not timed')
                : lyrics?.source === 'sidecar'
                  ? t('lyrics.unsyncedSidecar', 'Unsynced — your .lrc has no timestamps')
                  : t('lyrics.unsynced', 'Unsynced lyrics')}
            </p>
          )}
          {lyrics?.lines.map((l: LyricLine, i: number) => (
            <p
              key={i}
              data-line={i}
              role={synced ? 'button' : undefined}
              tabIndex={synced ? 0 : undefined}
              title={synced ? t('lyrics.seekHere', 'Play from here') : undefined}
              onClick={() => onLineClick(l)}
              onKeyDown={(e) => {
                if (synced && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onLineClick(l)
                }
              }}
              className={`lyric-line${synced && i === idx ? ' active' : ''}${synced && i < idx ? ' past' : ''}${synced ? ' clickable' : ''}`}
            >
              {l.text}
            </p>
          ))}
        </div>
      )}

      {/* Timing controls, right above the footer where the eyes already are. */}
      {synced && showSync && (
        <div className="lyrics-sync">
          <div className="lyrics-sync-row">
            <button className="btn btn-ghost btn-sm" onClick={() => nudge(-1000)} title={t('lyrics.earlier1', 'Earlier by 1s')}>
              −1s
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => nudge(-SYNC_STEP_MS)} title={t('lyrics.earlier', 'Earlier by 0.25s ( [ )')}>
              −0.25s
            </button>
            <span className="lyrics-sync-value" title={t('lyrics.syncValueTitle', 'Positive = lyrics shown later')}>
              {describeLyricSync(sync)}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => nudge(SYNC_STEP_MS)} title={t('lyrics.later', 'Later by 0.25s ( ] )')}>
              +0.25s
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => nudge(1000)} title={t('lyrics.later1', 'Later by 1s')}>
              +1s
            </button>
          </div>

          <p className="lyrics-sync-hint">
            {foreignEdit
              ? `${t('lyrics.foreignEdit', 'Matched a different edit')} (${formatTime(refDuration)} ${t('lyrics.versus', 'vs')} ${formatTime(duration)}) — ${t('lyrics.foreignEditHint', 'nudge until the highlighted line matches what you hear.')}`
              : t('lyrics.syncHint', 'Fix the timing if the words run ahead or behind.')}
          </p>

          <div className="lyrics-sync-row">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void align(true)}
              disabled={busy || !filePath || !lyrics || lyrics.lines.length < 3}
              title={t('lyrics.alignTitle', 'Line the words up with this exact recording')}
            >
              <IconTarget size={13} /> {t('lyrics.align', 'Auto-align')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={fitSpeed}
              disabled={!refDuration || duration <= 0}
              title={t('lyrics.fitSpeedTitle', 'Stretch the lyrics to this file’s length (sped-up or slowed rips)')}
            >
              <IconShuffle size={13} /> {t('lyrics.fitSpeed', 'Fit speed')}
              {refDuration > 0 && duration > 0 ? ` ×${speedFit.toFixed(2)}` : ''}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void rematch()}
              disabled={busy || lyrics?.source === 'user'}
              title={
                lyricsMode === 'ai'
                  ? t('lyrics.writeAgainTitle', 'Ask the model to write this song again')
                  : t('lyrics.rematchTitle', 'Look the song up again and take the closest match')
              }
            >
              <IconSearch size={13} />{' '}
              {lyricsMode === 'ai' ? t('lyrics.writeAgain', 'Write again') : t('lyrics.rematch', 'Match again')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={resetSync}
              disabled={sync.offsetMs === 0 && Math.abs(sync.scale - 1) < 0.005}
            >
              {t('lyrics.resetSync', 'Reset timing')}
            </button>
          </div>

          {sync.source === 'captions' && (
            <p className="lyrics-sync-hint ok">
              <IconTarget size={12} /> {t('lyrics.alignedNote', 'Aligned to the captions of this exact recording.')}
            </p>
          )}
        </div>
      )}

      <footer className="lyrics-foot">
        <span className="hint">
          {lyrics && lyrics.lines.length > 0
            ? `${lyrics.synced ? t('lyrics.synced', 'Synced') : t('lyrics.plain', 'Plain text')} · ${
                lyrics.source === 'user'
                  ? t('lyrics.yourUpload', 'your lyrics')
                  : lyrics.source === 'ai'
                    ? t('lyrics.aiWritten', 'AI-written')
                    : lyrics.source === 'sidecar'
                      ? t('lyrics.yourLrc', 'your .lrc file')
                      : t('lyrics.autoMatched', 'auto-matched')
              }${lyrics.ai ? ` · ${t('lyrics.aiPicked', 'AI')}` : ''}${synced && !sync.auto ? ` · ${describeLyricSync(sync)}` : ''}`
            : t('lyrics.panel', 'Lyrics')}
        </span>

        {/*
          Two modes, one switch — the safety net. Each mode keeps its own cache,
          so turning AI writing off shows the real match again immediately, with
          no re-fetch, and turning it back on shows what it wrote last time.
        */}
        <div className="lyrics-modes" role="group" aria-label={t('lyrics.modeLabel', 'Lyrics mode')}>
          <button
            type="button"
            className={`lyrics-mode${lyricsMode !== 'ai' ? ' on' : ''}`}
            aria-pressed={lyricsMode !== 'ai'}
            onClick={() => void setMode('normal')}
            title={t(
              'lyrics.modeNormalTitle',
              'Normal lyrics: your upload, your .lrc file, or the matched song'
            )}
          >
            {t('lyrics.modeNormal', 'Normal')}
          </button>
          <button
            type="button"
            className={`lyrics-mode${lyricsMode === 'ai' ? ' on' : ''}`}
            aria-pressed={lyricsMode === 'ai'}
            onClick={() => void setMode('ai')}
            title={t('lyrics.modeAiTitle', 'Let the model write the lyrics for this song')}
          >
            {t('lyrics.modeAi', 'AI')}
          </button>
        </div>

        <span className="lyrics-foot-actions">
          {synced && (
            <button
              className={`btn btn-ghost btn-sm${showSync ? ' on' : ''}`}
              onClick={() => setShowSync((v) => !v)}
              title={t('lyrics.syncHint', 'Fix the timing if the words run ahead or behind')}
            >
              {t('lyrics.sync', 'Sync')}
            </button>
          )}
          {trackId && lyrics && lyrics.lines.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => void upload()} disabled={busy}>
              {t('lyrics.replace', 'Replace…')}
            </button>
          )}
          {trackId && lyrics?.source === 'user' && (
            <button className="btn btn-ghost btn-sm" onClick={() => void clearMine()} disabled={busy}>
              {t('lyrics.remove', 'Remove')}
            </button>
          )}
        </span>
      </footer>
    </aside>
  )
}
