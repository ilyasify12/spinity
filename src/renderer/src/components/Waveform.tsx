import { useEffect, useRef } from 'react'
import { usePlayer } from '../player/engine'

export const PEAK_COUNT = 180
const MAX_DECODE_BYTES = 100 * 1024 * 1024

/**
 * Waveform seek bar. Peaks come from the engine (main-cache first, computed
 * lazily in an idle callback); with no peaks yet it renders the classic flat
 * bar with identical seek behaviour.
 *
 * Progress does NOT flow through React: the engine ticks `currentTime` at 4Hz
 * and re-rendering 180 spans on every tick was the biggest source of player
 * jank. A store subscription paints the DOM directly — only bars that crossed
 * the played boundary get a class toggle, the flat bar gets a gradient string.
 */
export function Waveform({
  maxTime,
  disabled,
  onSeek
}: {
  maxTime: number
  disabled: boolean
  onSeek: (seconds: number) => void
}): React.JSX.Element {
  const peaks = usePlayer((s) => s.peaks)
  const peaksId = usePlayer((s) => s.peaksId)
  const trackId = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index]?.id ?? null) : null))
  const loading = usePlayer((s) => s.loading)
  const dragging = useRef(false)
  const barRef = useRef<HTMLDivElement>(null)
  /** Imperative progress state — read by keyboard seeking and the painter. */
  const timeRef = useRef(0)
  const lastPlayedRef = useRef(-1)
  const maxTimeRef = useRef(maxTime)

  // Compute peaks lazily for local files, then cache in main for next time.
  // Deferred WELL past playback start: the full-file fetch + decode used to
  // contend with the track's own first bytes through the protocol (~3s gap).
  useEffect(() => {
    if (!trackId || peaksId === trackId || peaks.length > 0) return
    // Still starting up — the effect re-runs when loading settles (dep below)
    // instead of contending with the track's first bytes.
    if (loading) return
    let cancelled = false
    const track = usePlayer.getState().queue.find((t) => t.id === trackId)
    if (!track?.filePath) return // streams: no local bytes to decode
    let idle = 0
    const startTimer = setTimeout(() => {
      if (cancelled) return
      const live = usePlayer.getState()
      if (live.queue[live.index]?.id !== trackId) return
      idle = window.requestIdleCallback(
        () => {
          if (cancelled) return
          void (async () => {
          try {
            const cached = await window.spinity.wave.get(trackId).catch(() => null)
            if (cancelled) return
            if (cached && cached.peaks.length > 0 && Math.abs((cached.duration || 0) - (track.durationSec || 0)) < 3) {
              usePlayer.getState().setPeaks(trackId, cached.peaks)
              return
            }
            // Re-check: user may have skipped on during the wait.
            if (usePlayer.getState().queue[usePlayer.getState().index]?.id !== trackId) return
            const res = await fetch(`spinity://audio/${encodeURIComponent(trackId)}`)
            if (!res.ok || cancelled) return
            const buf = await res.arrayBuffer()
            if (cancelled || buf.byteLength === 0 || buf.byteLength > MAX_DECODE_BYTES) return
            const ctx = new OfflineAudioContext(1, 44100, 44100)
            const decoded = await ctx.decodeAudioData(buf)
            if (cancelled) return
            if (usePlayer.getState().queue[usePlayer.getState().index]?.id !== trackId) return
            const data = decoded.getChannelData(0)
            const out: number[] = []
            const bucket = Math.max(1, Math.floor(data.length / PEAK_COUNT))
            for (let i = 0; i < PEAK_COUNT; i++) {
              const start = i * bucket
              let max = 0
              const end = Math.min(data.length, start + bucket)
              for (let j = start; j < end; j += 4) {
                const v = Math.abs(data[j])
                if (v > max) max = v
              }
              // Square-root scaling reads like music (lows stay visible).
              out.push(Math.min(1, Math.sqrt(max) * 1.1))
            }
            usePlayer.getState().setPeaks(trackId, out)
            void window.spinity.wave.set(trackId, { duration: track.durationSec, peaks: out }).catch(() => {})
          } catch {}
          })()
        },
        { timeout: 8000 }
      )
    }, 3000)
    return () => {
      cancelled = true
      clearTimeout(startTimer)
      if (idle) window.cancelIdleCallback(idle)
    }
  }, [trackId, peaksId, peaks.length, loading])

  // Initial render reads the live clock straight from the store (renders only
  // happen on track/queue/prop changes); every tick after that is painted
  // imperatively below.
  const liveNow = usePlayer.getState().currentTime
  const pct = maxTime > 0 ? Math.max(0, Math.min(1, liveNow / maxTime)) : 0
  timeRef.current = liveNow

  // Subscribe to the store (no selector middleware available) and paint only
  // when the clock actually moved. Runs after every render so a track change
  // realigns the DOM with the freshly rendered classes.
  useEffect(() => {
    maxTimeRef.current = maxTime
    const paint = (): void => {
      const state = usePlayer.getState()
      const time = state.currentTime
      if (Math.abs(time - timeRef.current) < 0.005) return
      timeRef.current = time
      const max = maxTimeRef.current
      const p = max > 0 ? Math.max(0, Math.min(1, time / max)) : 0
      const el = barRef.current
      if (!el) return
      if (peaks.length === 0) {
        const percent = (p * 100).toFixed(2)
        el.style.background = `linear-gradient(to right, var(--accent) 0 ${percent}%, #4d4d4d ${percent}% 100%)`
        el.setAttribute('aria-valuenow', String(Math.round(time)))
        return
      }
      const played = Math.floor(p * peaks.length)
      el.setAttribute('aria-valuenow', String(Math.round(time)))
      const last = lastPlayedRef.current
      if (played === last) return
      const bars = el.children
      if (played < last) {
        for (let i = played; i < last && i < bars.length; i++) {
          ;(bars[i] as HTMLElement).classList.remove('played')
        }
      } else {
        for (let i = Math.max(last, 0); i < played && i < bars.length; i++) {
          ;(bars[i] as HTMLElement).classList.add('played')
        }
      }
      lastPlayedRef.current = played
    }
    // Force a full repaint on mount / track change (timeRef may coincidentally
    // match while the DOM still shows the previous track's progress).
    timeRef.current = -9999
    lastPlayedRef.current = -1
    paint()
    return usePlayer.subscribe(paint)
  }, [peaks.length, maxTime])

  function seekFromClientX(clientX: number): void {
    const el = barRef.current
    if (!el || maxTime <= 0) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    onSeek(ratio * maxTime)
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onSeek(Math.max(0, timeRef.current - 5))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onSeek(Math.min(maxTime, timeRef.current + 5))
    }
  }

  if (peaks.length === 0) {
    const flatPct = (pct * 100).toFixed(2)
    return (
      <div
        ref={barRef}
        className="wave-flat"
        role="slider"
        tabIndex={disabled ? undefined : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(maxTime)}
        aria-valuenow={Math.round(liveNow)}
        aria-disabled={disabled}
        style={{ background: `linear-gradient(to right, var(--accent) 0 ${flatPct}%, #4d4d4d ${flatPct}% 100%)` }}
        onPointerDown={(e) => {
          if (disabled) return
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          seekFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (dragging.current && !disabled) seekFromClientX(e.clientX)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onKeyDown={onKey}
      />
    )
  }

  const played = Math.floor(pct * peaks.length)
  return (
    <div
      ref={barRef}
      className="waveform"
      role="slider"
      tabIndex={disabled ? undefined : 0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(maxTime)}
      aria-valuenow={Math.round(liveNow)}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return
        dragging.current = true
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        seekFromClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (dragging.current && !disabled) seekFromClientX(e.clientX)
      }}
      onPointerUp={() => {
        dragging.current = false
      }}
      onPointerCancel={() => {
        dragging.current = false
      }}
      onKeyDown={onKey}
    >
      {peaks.map((v, i) => (
        <span
          key={i}
          className={`wave-bar${i < played ? ' played' : ''}`}
          style={{ height: `${Math.max(8, Math.round(v * 100))}%` }}
        />
      ))}
    </div>
  )
}
