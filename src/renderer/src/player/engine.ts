import { create } from 'zustand'
import { streamUrlFrom } from '@shared/streamUrl'
import type { SearchResult, Track } from '@shared/types'

/**
 * Playback engine.
 *
 * Key design decision: exactly ONE HTMLAudioElement exists for the whole app,
 * created here at module scope. Recreating an <audio> element per track (a very
 * common mistake) causes double-playback, leaks, and loses position state.
 * React never owns the element; it only renders controls that call these
 * actions and reads the mirrored state below.
 *
 * Audio is streamed through the privileged `spinity://audio/<trackId>` scheme
 * registered in the main process, which supports HTTP Range requests, so
 * seeking works instantly against the local file.
 */
let audio = new Audio()
audio.preload = 'auto'

/**
 * Gapless-ish next-track warming: a detached element with preload=auto pulls
 * the upcoming file through the spinity:// protocol (disk + decode warmup)
 * while the current song still plays, so `next()`/`ended` starts in ms.
 * Never played, never wired — just a cache primer. Shuffle can't be
 * predicted, so warming is sequential-queue only.
 */
let preloadEl: HTMLAudioElement | null = null
let preloadedId: string | null = null
function preloadTrack(track: Track | undefined): void {
  if (!track?.id || !track.filePath) {
    preloadedId = null
    return
  }
  if (preloadedId === track.id) return
  preloadedId = track.id
  try {
    if (!preloadEl) {
      preloadEl = new Audio()
      preloadEl.preload = 'auto'
      preloadEl.muted = true
    }
    preloadEl.src = srcFor(track)
    try { preloadEl.load() } catch {}
  } catch {
    preloadedId = null
  }
}

/**
 * Network-track warming for the queue: preview clips play from the same
 * write-through cache the main process fills, so asking it to start the next
 * track now means `next()`/`ended` starts from disk instead of the network.
 * Radio URLs are plain https (not spinity://stream) and are skipped.
 */
function warmNextStream(track: Track | undefined): void {
  if (!track?.streamUrl || track.filePath) return
  const raw = streamUrlFrom(track.streamUrl)
  if (!raw) return
  try {
    void window.spinity.free.prewarm(raw).catch(() => {})
  } catch {}
}

/**
 * Time-to-first-audio instrumentation. Armed at every load, settled by the
 * first `playing` event after it — the delta is the number the Settings
 * "Free music" panel reports. Pure telemetry: it can never affect playback.
 */
let ttfaFrom = 0
let ttfaId: string | null = null
let ttfaSettled = true
function armTtfa(track: Track | undefined): void {
  ttfaFrom = performance.now()
  ttfaId = track?.id ?? null
  ttfaSettled = false
}
function settleTtfa(track: Track | undefined): void {
  if (ttfaSettled || !ttfaId) return
  ttfaSettled = true
  const ms = Math.max(0, Math.round(performance.now() - ttfaFrom))
  const kind: 'local' | 'network' = track?.filePath ? 'local' : 'network'
  try {
    void window.spinity.free.reportTtfa(ms, kind).catch(() => {})
  } catch {}
}

/** Volume/mute path: straight element knobs (no effects chain). */
function applyVolume(): void {
  const { volume, muted } = usePlayer.getState()
  try {
    audio.volume = volume
    audio.muted = muted
  } catch {}
}

/**
 * Duration as reported by the media element, with a fallback to the track's
 * known metadata.
 *
 * Streamed WebM/Opus has NO seek index up front and reports `Infinity` — that
 * must fall back to metadata, never to 0, or the seek bar snaps back to zero
 * no matter how it is dragged.
 */
function effectiveDuration(): number {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration
  const st = usePlayer.getState()
  const track = st.queue[st.index]
  return track?.durationSec ?? 0
}

/**
 * Playback position survives a restart. `timeupdate` fires about four times a
 * second, so writes are coalesced here instead of hitting localStorage on
 * every tick.
 */
const SESSION_KEY = 'spinity:player-session'
let saveTimer: ReturnType<typeof setTimeout> | null = null

// The search result behind the currently playing stream, plus the handler the
// app store registers to fall back to downloading when streaming fails.
let currentStreamResult: SearchResult | null = null
let streamErrorHandler: ((result: SearchResult) => void) | null = null

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: Track[]
  index: number
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  loading: boolean
  /** True while audio is being streamed from the network rather than disk. */
  streaming: boolean
  error: string | null
  /** Cached waveform peaks for the loaded track (empty = not computed yet). */
  peaks: number[]
  peaksId: string | null

  playQueue: (tracks: Track[], startIndex?: number) => void
  playNow: (track: Track, context?: Track[]) => void
  playStream: (url: string, result: SearchResult) => void
  onStreamError: (fn: (result: SearchResult) => void) => void
  toggle: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  stop: () => void
  setPeaks: (trackId: string, peaks: number[]) => void
}

const srcFor = (track: Track): string =>
  !track.filePath && track.streamUrl
    ? track.streamUrl
    : `spinity://audio/${encodeURIComponent(track.id)}`

/** Raw media failures translated into something actionable. */
function friendlyPlayError(err: unknown, track: Track | undefined): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (/no supported source|notsupported/i.test(raw)) {
    if (track?.source === 'local') {
      return `Couldn't play "${track.title ?? 'this track'}". The file may have moved — right-click it → Show in Explorer to check.`
    }
    return `Couldn't load "${track?.title ?? 'this track'}". Check your connection, then try again or re-save it.`
  }
  if (/notallowed|interaction/i.test(raw)) {
    return 'Playback was blocked — press Play once to start audio.'
  }
  return raw || 'Could not play this file'
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** Load a track into the single audio element and begin playback. */
  const load = (track: Track | undefined, autoplay: boolean, streamedFallback = false): void => {
    if (!track) return
    set({ loading: true, error: null, currentTime: 0, duration: track.durationSec || 0, streaming: false, peaks: [], peaksId: null })
    currentStreamResult = null
    armTtfa(track)
    // Assigning src already resets position — an extra synchronous
    // `currentTime = 0` here forced a second seek round-trip through the
    // spinity:// protocol before metadata existed (part of the ~3s gap).
    audio.src = srcFor(track)
    if (preloadedId === track.id) preloadedId = null
    if (autoplay) {
      void audio.play().catch((err: unknown) => {
        // Self-heal: a download whose file is gone/moved/unreadable can still
        // stream when it carries a YouTube URL — try that once before failing.
        if (!streamedFallback && track.source === 'youtube' && track.webUrl) {
          set({ loading: true, error: null })
          const result: SearchResult = {
            id: track.id,
            source: 'youtube',
            title: track.title,
            artist: track.artist,
            durationSec: track.durationSec,
            thumbnail: track.thumbnail,
            webUrl: track.webUrl
          }
          void window.spinity.youtube
            .stream(track.id, { fill: true })
            .then((info) => {
              // The user may have skipped on while we resolved — only take
              // over if this track is still the one loaded.
              const s = get()
              if (s.queue[s.index]?.id !== track.id) return
              currentStreamResult = result
              get().playStream(info.streamUrl ?? info.url, result)
            })
            .catch(() => {
              const s = get()
              if (s.queue[s.index]?.id !== track.id) return
              set({ playing: false, loading: false, error: friendlyPlayError(err, track) })
            })
          return
        }
        set({
          playing: false,
          loading: false,
          error: friendlyPlayError(err, track)
        })
      })
    }
    // Coalesced (2s) — an immediate localStorage write of the whole queue on
    // every auto-advance blocked the next-track start.
    persistSession()
  }

  // --------------------------------------------------------- element wiring
  // Everything here talks to `el`, never the module binding.
  const wire = (el: HTMLAudioElement): void => {
    el.addEventListener('playing', () => {
      if (el !== audio) return
      set({ playing: true, loading: false, error: null })
      // Warm the sequential next track (shuffle off): warm disk + decode
      // while this song plays so advancing starts in ms, not seconds.
      try {
        const s = get()
        const current = s.index >= 0 ? s.queue[s.index] : undefined
        settleTtfa(current)
        if (!s.shuffle && s.index >= 0 && s.index + 1 < s.queue.length) {
          const next = s.queue[s.index + 1]
          preloadTrack(next)
          warmNextStream(next)
        }
      } catch {}
    })
    el.addEventListener('pause', () => {
      // Ignore pause events from a retired element after a rebuild.
      if (el !== audio) return
      set({ playing: false })
      // Capture the exact offset when playback stops, not just the next tick.
      persistSession(true)
    })
    el.addEventListener('waiting', () => {
      if (el === audio) set({ loading: true })
    })
    el.addEventListener('canplay', () => {
      if (el === audio) set({ loading: false })
    })
    el.addEventListener('durationchange', () => {
      if (el === audio) set({ duration: effectiveDuration() })
    })
    el.addEventListener('loadedmetadata', () => {
      if (el === audio) set({ duration: effectiveDuration() })
      // Warm the next track as soon as the current one has metadata — earlier
      // than the old `playing` hook, so the sequential-queue advance is
      // usually fully cached by the time the song ends. Idempotent.
      try {
        const s = usePlayer.getState()
        if (!s.shuffle && s.index >= 0 && s.index + 1 < s.queue.length) {
          const next = s.queue[s.index + 1]
          preloadTrack(next)
          warmNextStream(next)
        }
      } catch {}
    })
    el.addEventListener('timeupdate', () => {
      if (el !== audio) return
      set({ currentTime: el.currentTime })
      persistSession()
    })
    el.addEventListener('error', () => {
      if (el !== audio) return
      const state = get()
      const track = state.queue[state.index]
      const wasStreaming = state.streaming
      set({
        playing: false,
        loading: false,
        streaming: false,
        error: track
          ? track.source === 'local'
            ? `Cannot play "${track.title}" — the file may have been moved or deleted.`
            : track.source === 'preview'
              ? `Cannot play "${track.title}" — the stream failed. Try again, or open it on its provider page.`
              : track.source === 'radio'
                ? `Lost "${track.title}" — live stations drop occasionally. Pick it again.`
                : `Cannot play "${track.title}" — check your connection, or re-save it from Search.`
          : 'Playback error'
      })
      // A dying stream is recoverable: hand back the original search result so
      // the caller can fall back to downloading that exact track.
      if (wasStreaming && currentStreamResult && streamErrorHandler) {
        streamErrorHandler(currentStreamResult)
      }
    })
    el.addEventListener('ended', () => {
      if (el !== audio) return
      const { repeat } = get()
      if (repeat === 'one') {
        try { el.currentTime = 0 } catch {}
        void el.play().catch((err: unknown) => {
          const s = get()
          const t = s.queue[s.index]
          set({ playing: false, error: friendlyPlayError(err, t) })
        })
        return
      }
      get().next()
    })
  }
  wire(audio)

  return {
    queue: [],
    index: -1,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    shuffle: false,
    repeat: 'off',
    loading: false,
    streaming: false,
    error: null,
    peaks: [],
    peaksId: null,

    playQueue: (tracks, startIndex = 0) => {
      if (tracks.length === 0) return
      const index = Math.max(0, Math.min(startIndex, tracks.length - 1))
      set({ queue: tracks, index })
      load(tracks[index], true)
    },

    playNow: (track, context) => {
      const list = context && context.length > 0 ? context : [track]
      const index = Math.max(
        0,
        list.findIndex((t) => t.id === track.id)
      )
      set({ queue: list, index })
      load(list[index], true)
    },

    /**
     * Play a network stream directly.
     *
     * `result` is remembered so that if the stream dies mid-playback we can
     * fall back to downloading that exact track. The queue entry is a Track
     * placeholder sharing the same id, so existing UI (now-playing, highlight)
     * keeps working unchanged.
     */
    playStream: (url, result) => {
      const placeholder: Track = { ...result, filePath: '', downloadedAt: 0 }
      currentStreamResult = result
      armTtfa(placeholder)
      set({
        queue: [placeholder],
        index: 0,
        streaming: true,
        loading: true,
        error: null,
        currentTime: 0,
        // Seed the duration from metadata so the seek bar is usable before the
        // element has decoded enough to report its own (possibly Infinity).
        duration: result.durationSec
      })
      audio.src = url
      void audio.play().catch((err: unknown) => {
        set({
          playing: false,
          loading: false,
          streaming: false,
          error: friendlyPlayError(err, { ...result, filePath: '', downloadedAt: 0 })
        })
        if (streamErrorHandler) streamErrorHandler(result)
      })
    },

    /** Register the fallback used when a network stream fails. */
    onStreamError: (fn) => {
      streamErrorHandler = fn
    },

    toggle: () => {
      const { queue, index, playing } = get()
      if (index < 0 || queue.length === 0) return
      if (playing) {
        audio.pause()
        return
      }
      const track = queue[index]
      const fail = (err: unknown): void => {
        set({ playing: false, loading: false, error: friendlyPlayError(err, track) })
      }
      void audio.play().catch((err: unknown) => {
        if (!track) {
          fail('resume')
          return
        }
        // Autoplay policy blocks need a real gesture, not retries — say so now.
        if (err instanceof Error && /notallowed/i.test(`${err.name} ${err.message}`)) {
          fail(err)
          return
        }
        // Stream entry (liked/playlist placeholder): the signed URL probably
        // expired — re-resolve once and take over if still current. Only
        // YouTube has a resolver; other sources just fail with a message.
        if (!track.filePath && track.webUrl && track.source === 'youtube') {
          set({ loading: true, error: null })
          const result: SearchResult = {
            id: track.id,
            source: 'youtube',
            title: track.title,
            artist: track.artist,
            durationSec: track.durationSec,
            thumbnail: track.thumbnail,
            webUrl: track.webUrl
          }
          void window.spinity.youtube
            .stream(track.id, { fill: true, fresh: true })
            .then((info) => {
              const s = get()
              if (s.queue[s.index]?.id !== track.id) return
              currentStreamResult = result
              get().playStream(info.streamUrl ?? info.url, result)
            })
            .catch((err: unknown) => {
              const s = get()
              if (s.queue[s.index]?.id !== track.id) return
              fail(err)
            })
          return
        }
        // Local file that won't start: if the element lost its source,
        // reload once (keeps position); otherwise report friendly text.
        if (audio.networkState === audio.NETWORK_NO_SOURCE) {
          try {
            audio.load()
          } catch {}
          void audio.play().catch((err2: unknown) => fail(err2))
          return
        }
        try {
          audio.load()
        } catch {}
        const pos = get().currentTime
        const onMeta = (): void => {
          try {
            if (pos > 0) audio.currentTime = pos
          } catch {}
          void audio.play().catch((err2: unknown) => fail(err2))
        }
        audio.addEventListener('loadedmetadata', onMeta, { once: true })
        // If metadata never arrives, the element error handler reports it.
        window.setTimeout(() => {
          const s = get()
          if (s.queue[s.index]?.id === track.id && !s.playing && !s.error) {
            audio.removeEventListener('loadedmetadata', onMeta)
            fail('resume')
          }
        }, 8000)
      })
    },

    /** Advance honouring shuffle; stop at the end unless repeat is 'all'. */
    next: () => {
      const { queue, index, shuffle, repeat } = get()
      if (queue.length === 0) return

      if (shuffle && queue.length > 1) {
        let pick = index
        while (pick === index) pick = Math.floor(Math.random() * queue.length)
        set({ index: pick })
        load(queue[pick], true)
        return
      }

      const isLast = index >= queue.length - 1
      if (isLast && repeat !== 'all') {
        audio.pause()
        audio.currentTime = 0
        set({ playing: false, currentTime: 0 })
        return
      }
      const nextIndex = isLast ? 0 : index + 1
      set({ index: nextIndex })
      load(queue[nextIndex], true)
    },

    previous: () => {
      const { queue, index, currentTime } = get()
      if (queue.length === 0) return
      // Standard behaviour: restart the current song if we are past 3 seconds.
      if (currentTime > 3) {
        try { audio.currentTime = 0 } catch {}
        set({ currentTime: 0 })
        return
      }
      const prevIndex = index <= 0 ? queue.length - 1 : index - 1
      set({ index: prevIndex })
      load(queue[prevIndex], true)
    },

    seek: (seconds) => {
      if (!Number.isFinite(seconds) || seconds < 0) return
      try {
        // Request the chosen timestamp, including beyond currently loaded data.
        // Chromium can fetch the required byte range. Clamping to a transient
        // seekable end changed a forward seek into a jump back near zero.
        const duration = effectiveDuration()
        const target = duration > 0 ? Math.min(seconds, duration) : seconds
        audio.currentTime = target
        set({ currentTime: target })
      } catch {
        // Not seekable yet (metadata still loading) — ignore rather than throw.
      }
    },

    setVolume: (v) => {
      const clamped = Math.max(0, Math.min(1, v))
      set({ volume: clamped, muted: false })
      applyVolume()
      persistSession()
    },

    toggleMute: () => {
      set({ muted: !get().muted })
      applyVolume()
      persistSession()
    },

    toggleShuffle: () => set({ shuffle: !get().shuffle }),

    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one']
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] })
    },

    stop: () => {
      audio.pause()
      audio.removeAttribute('src')
      set({ queue: [], index: -1, playing: false, currentTime: 0, duration: 0, loading: false, error: null, streaming: false })
      // An explicit stop means "do not resume this next launch".
      persistSession(true)
    },

    setPeaks: (trackId, peaks) => {
      const s = get()
      const current = s.index >= 0 ? s.queue[s.index] : undefined
      if (current?.id === trackId) set({ peaks, peaksId: trackId })
    },
  }

})

/** The track currently loaded, or null. */
export function useCurrentTrack(): Track | null {
  return usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
}

/** Direct access to the single audio element (party sync, visualizers). */
export function getAudioElement(): HTMLAudioElement {
  return audio
}

// ---------------------------------------------------------------- persistence

/** What a restart needs to pick up where the previous session left off. */
export interface SavedSession {
  trackId: string
  positionSec: number
  queueIds: string[]
  index: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
}

/**
 * Persist the queue and playback offset.
 *
 * A streamed track is deliberately not saved: its URL is signed and expires, so
 * an offset into it would be meaningless after a restart. That case clears the
 * stored session rather than writing an unusable one.
 */
export function persistSession(immediate = false): void {
  const flush = (): void => {
    saveTimer = null
    const { queue, index, currentTime, volume, muted, shuffle, repeat } = usePlayer.getState()
    const track = index >= 0 ? queue[index] : undefined
    if (!track || !track.filePath) {
      try { localStorage.removeItem(SESSION_KEY) } catch { /* storage disabled */ }
      return
    }
    const payload: SavedSession = {
      trackId: track.id,
      positionSec: currentTime,
      queueIds: queue.map((t) => t.id),
      index,
      volume,
      muted,
      shuffle,
      repeat
    }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(payload)) } catch { /* quota */ }
  }

  if (immediate) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    flush()
    return
  }
  if (!saveTimer) saveTimer = setTimeout(flush, 2000)
}

/**
 * Rebuild the previous queue from the live library and cue the saved track at
 * the saved offset — paused, so launching the app never blasts audio on its own.
 *
 * Queue ids are re-resolved against the current library, so tracks that were
 * deleted or moved drop out instead of leaving dead entries behind. Returns
 * whether anything was restored.
 */
export function restorePlayerSession(tracks: Track[]): boolean {
  let saved: SavedSession | null = null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) saved = JSON.parse(raw) as SavedSession
  } catch {
    return false
  }
  if (!saved?.trackId) return false

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const queue = (saved.queueIds ?? [])
    .map((id) => byId.get(id))
    .filter((t): t is Track => Boolean(t && t.filePath))
  const index = queue.findIndex((t) => t.id === saved.trackId)
  if (index < 0) return false

  const track = queue[index]
  // Never restore to the very end of a track, which would look like a skip.
  const lastPlayable = Math.max(0, track.durationSec - 1)
  const position = Math.max(0, Math.min(saved.positionSec || 0, lastPlayable))
  const volume = typeof saved.volume === 'number' ? Math.max(0, Math.min(1, saved.volume)) : 1
  const muted = Boolean(saved.muted)

  usePlayer.setState({
    queue,
    index,
    playing: false,
    currentTime: position,
    duration: track.durationSec,
    volume,
    muted,
    shuffle: Boolean(saved.shuffle),
    repeat: saved.repeat ?? 'off',
    streaming: false,
    loading: false,
    error: null
  })
  // Route volume through the element knobs.
  applyVolume()

  audio.src = srcFor(track)
  // Chromium ignores currentTime until metadata exists, so the offset is applied
  // when it arrives rather than immediately after assigning src.
  audio.addEventListener(
    'loadedmetadata',
    () => {
      try {
        audio.currentTime = position
      } catch {
        // Not seekable yet — the element will simply start from zero.
      }
      const measured = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track.durationSec
      usePlayer.setState({ currentTime: position, duration: measured })
    },
    { once: true }
  )
  return true
}
