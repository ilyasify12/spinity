import { create } from 'zustand'
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
const audio = new Audio()
audio.preload = 'auto'

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
}

const srcFor = (track: Track): string => `spinity://audio/${encodeURIComponent(track.id)}`

export const usePlayer = create<PlayerState>((set, get) => {
  /** Load a track into the single audio element and begin playback. */
  const load = (track: Track | undefined, autoplay: boolean): void => {
    if (!track) return
    set({ loading: true, error: null, currentTime: 0, duration: 0, streaming: false })
    currentStreamResult = null
    audio.src = srcFor(track)
    audio.currentTime = 0
    if (autoplay) {
      // play() can reject if the file is missing; surface that to the UI
      // instead of producing an unhandled promise rejection.
      void audio.play().catch((err: unknown) => {
        set({
          playing: false,
          loading: false,
          error: err instanceof Error ? err.message : 'Could not play this file'
        })
      })
    }
  }

  // --------------------------------------------------------- element wiring
  audio.addEventListener('playing', () => set({ playing: true, loading: false, error: null }))
  audio.addEventListener('pause', () => set({ playing: false }))
  audio.addEventListener('waiting', () => set({ loading: true }))
  audio.addEventListener('canplay', () => set({ loading: false }))
  /**
   * Duration as reported by the media element, with a fallback to the track's
   * known metadata.
   *
   * Streamed WebM/Opus has NO seek index up front and reports `Infinity`. My
   * original code turned that into `0`, which made a slider whose max was 0 —
   * so the seek bar snapped back to zero no matter how it was dragged. This
   * is the core of the seek bug.
   */
  const effectiveDuration = (): number => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration
    const track = get().queue[get().index]
    return track?.durationSec ?? 0
  }

  audio.addEventListener('durationchange', () => set({ duration: effectiveDuration() }))
  audio.addEventListener('loadedmetadata', () => set({ duration: effectiveDuration() }))
  audio.addEventListener('timeupdate', () => set({ currentTime: audio.currentTime }))
  audio.addEventListener('error', () => {
    const state = get()
    const track = state.queue[state.index]
    const wasStreaming = state.streaming
    set({
      playing: false,
      loading: false,
      streaming: false,
      error: track
        ? `Cannot play "${track.title}" — the file may have been moved or deleted.`
        : 'Playback error'
    })
    // A dying stream is recoverable: hand back the original search result so
    // the caller can fall back to downloading that exact track.
    if (wasStreaming && currentStreamResult && streamErrorHandler) {
      streamErrorHandler(currentStreamResult)
    }
  })
  audio.addEventListener('ended', () => {
    const { repeat } = get()
    if (repeat === 'one') {
      audio.currentTime = 0
      void audio.play()
      return
    }
    get().next()
  })

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
      audio.currentTime = 0
      void audio.play().catch((err: unknown) => {
        set({
          playing: false,
          loading: false,
          streaming: false,
          error: err instanceof Error ? err.message : 'Could not start streaming'
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
      } else {
        void audio.play().catch(() => set({ error: 'Could not resume playback' }))
      }
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
        audio.currentTime = 0
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
      audio.volume = clamped
      audio.muted = false
      set({ volume: clamped, muted: false })
    },

    toggleMute: () => {
      const muted = !get().muted
      audio.muted = muted
      set({ muted })
    },

    toggleShuffle: () => set({ shuffle: !get().shuffle }),

    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one']
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] })
    },

    stop: () => {
      audio.pause()
      audio.removeAttribute('src')
      set({ queue: [], index: -1, playing: false, currentTime: 0, duration: 0 })
    }
  }

})

/** The track currently loaded, or null. */
export function useCurrentTrack(): Track | null {
  return usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
}
