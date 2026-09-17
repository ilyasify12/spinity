import { create } from 'zustand'
import { usePlayer } from '../player/engine'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type DownloadJob,
  type Playlist,
  type SearchResult,
  type Track,
  type User
} from '@shared/types'

/** Normalise the many shapes an IPC rejection can take. */
function errMessage(err: unknown): string {
  if (err instanceof Error) {
    // Electron wraps main-process throws with this prefix; strip it for clarity.
    return err.message
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error:\s*/, '')
  }
  return String(err)
}

interface Toast {
  message: string
  kind: 'info' | 'error'
}

interface AppState {
  ready: boolean
  user: User | null
  users: User[]
  tracks: Track[]
  playlists: Playlist[]
  settings: AppSettings
  jobs: DownloadJob[]
  results: SearchResult[]
  searching: boolean
  toast: Toast | null

  init: () => Promise<void>
  reload: () => Promise<void>
  register: (username: string, password: string, displayName?: string) => Promise<void>
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  search: (query: string) => Promise<void>
  /** Play a search result: local file if owned, else stream, else download. */
  playFromSearch: (result: SearchResult) => Promise<void>
  download: (result: SearchResult) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  clearJobs: () => void
  createPlaylist: (name: string) => Promise<Playlist | null>
  deletePlaylist: (playlistId: string) => Promise<void>
  addToPlaylist: (playlistId: string, trackId: string) => Promise<void>
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>
  removeTrack: (trackId: string) => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  notify: (message: string, kind?: 'info' | 'error') => void
  dismissToast: () => void
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  user: null,
  users: [],
  tracks: [],
  playlists: [],
  settings: DEFAULT_SETTINGS,
  jobs: [],
  results: [],
  searching: false,
  toast: null,

  /** Called once on mount: restores the session and subscribes to events. */
  init: async () => {
    try {
      const users = await window.spinity.auth.listUsers()
      set({ users })
      const user = await window.spinity.auth.current()
      if (user) {
        set({ user })
        await get().reload()
      }
    } catch (err) {
      get().notify(errMessage(err), 'error')
    } finally {
      set({ ready: true })
    }

    window.spinity.events.onDownloadUpdated((job) => {
      set((state) => ({ jobs: [job, ...state.jobs.filter((j) => j.id !== job.id)] }))
      if (job.status === 'error' && job.error) get().notify(job.error, 'error')
      if (job.status === 'done') {
        void (async () => {
          await get().reload()
          // If a stream failed and this download was the fallback, switch to
          // the local file so playback resumes without another click.
          const player = usePlayer.getState()
          const current = player.queue[player.index]
          if (current && current.id === job.trackId && !player.playing) {
            const idx = get().tracks.findIndex((t) => t.id === job.trackId)
            if (idx >= 0) usePlayer.getState().playQueue(get().tracks, idx)
          }
        })()
      }
    })

    // Streaming failure → fall back to downloading the same track.
    usePlayer.getState().onStreamError((result) => {
      get().notify('Streaming failed — downloading instead', 'error')
      void get().download(result)
    })
  },

  reload: async () => {
    try {
      const snap = await window.spinity.library.snapshot()
      set({
        user: snap.user,
        tracks: snap.tracks,
        playlists: snap.playlists,
        settings: snap.settings
      })
      set({ jobs: await window.spinity.downloads.list() })
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  register: async (username, password, displayName) => {
    try {
      const user = await window.spinity.auth.register(username, password, displayName)
      set({ user, users: await window.spinity.auth.listUsers() })
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
      throw err
    }
  },

  login: async (username, password) => {
    try {
      const user = await window.spinity.auth.login(username, password)
      set({ user })
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
      throw err
    }
  },

  logout: async () => {
    await window.spinity.auth.logout()
    set({ user: null, tracks: [], playlists: [], results: [], jobs: [], searching: false })
  },

  search: async (query) => {
    const trimmed = query.trim()
    if (!trimmed) {
      set({ results: [] })
      return
    }
    set({ searching: true })
    try {
      const results = await window.spinity.youtube.search(trimmed, 20)
      set({ results })
      if (results.length === 0) get().notify('No results found for that search')
    } catch (err) {
      get().notify(errMessage(err), 'error')
      set({ results: [] })
    } finally {
      set({ searching: false })
    }
  },

  /**
   * Play a search result with the user's chosen strategy.
   *
   * 1. Already downloaded -> play the local file (instant, works offline).
   * 2. Streaming preferred  -> resolve a direct URL and stream it.
   * 3. Otherwise            -> download it.
   *
   * Step 2 failing (403, expired signature, bot check, throttling) is handled
   * by the stream-error handler registered in init(), which starts a download.
   */
  playFromSearch: async (result) => {
    const tracks = get().tracks
    const localIdx = tracks.findIndex((t) => t.id === result.id)
    if (localIdx >= 0) {
      usePlayer.getState().playQueue(tracks, localIdx)
      return
    }

    if (!get().settings.preferStreaming) {
      await get().download(result)
      get().notify('Downloading — it will appear in your Library')
      return
    }

    try {
      const info = await window.spinity.youtube.stream(result.id)
      usePlayer.getState().playStream(info.url, result)
      get().notify('Streaming — will download automatically if this fails')
    } catch (err) {
      get().notify(`${errMessage(err)} — downloading instead`, 'error')
      await get().download(result)
    }
  },

  download: async (result) => {
    try {
      const job = await window.spinity.downloads.start(result)
      set((state) => ({ jobs: [job, ...state.jobs] }))
      get().notify(`Queued: ${result.title}`)
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  cancelJob: async (jobId) => {
    try {
      await window.spinity.downloads.cancel(jobId)
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  /** Drop finished/failed/cancelled rows, keeping anything still in flight. */
  clearJobs: () =>
    set((state) => ({
      jobs: state.jobs.filter(
        (j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting'
      )
    })),

  createPlaylist: async (name) => {
    try {
      const playlist = await window.spinity.playlists.create(name)
      await get().reload()
      return playlist
    } catch (err) {
      get().notify(errMessage(err), 'error')
      return null
    }
  },

  deletePlaylist: async (playlistId) => {
    try {
      await window.spinity.playlists.remove(playlistId)
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  addToPlaylist: async (playlistId, trackId) => {
    try {
      await window.spinity.playlists.addTrack(playlistId, trackId)
      const name = get().playlists.find((p) => p.id === playlistId)?.name ?? 'playlist'
      await get().reload()
      get().notify(`Added to ${name}`)
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  removeFromPlaylist: async (playlistId, trackId) => {
    try {
      await window.spinity.playlists.removeTrack(playlistId, trackId)
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  removeTrack: async (trackId) => {
    try {
      await window.spinity.library.removeTrack(trackId)
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  updateSettings: async (patch) => {
    try {
      set({ settings: await window.spinity.settings.update(patch) })
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  notify: (message, kind = 'info') => set({ toast: { message, kind } }),

  dismissToast: () => set({ toast: null })

}))
