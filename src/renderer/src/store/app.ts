import { create } from 'zustand'
import { restorePlayerSession, usePlayer } from '../player/engine'
import { prefetchRadioChannels, resolveRadio } from '../player/prewarm'
import { t } from '../lib/i18n'
import { loadAccent, loadAvatarBg, saveAccent, saveAvatarBg } from '../lib/profile'
import { normalizeText } from '../lib/search'
import { streamUrlFor } from '@shared/streamUrl'
import { mergeHits } from '@shared/freeMerge'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type DownloadJob,
  type FreeHit,
  type Playlist,
  type RadioChannel,
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

/**
 * Session resume runs exactly once per launch: `reload()` also fires after
 * every finished download, and re-seeking to the saved offset each time would
 * fight whatever the user has since started playing.
 */
let sessionRestored = false

/**
 * Session-scoped YouTube search cache, keyed by the normalised query.
 * Revisiting a query (back/forward nav, clearing + retyping, the Search page's
 * default "popular" fill) renders instantly instead of re-hitting the network.
 * Persisted to localStorage so a restart doesn't pay the search twice either.
 */
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const SEARCH_CACHE_MAX = 80
const SEARCH_CACHE_KEY = 'spinity:search-cache-v1'
const FREE_CACHE_KEY = 'spinity:free-cache-v1'

interface CacheRow<T> {
  at: number
  value: T
}

/** Rehydrate a persisted query cache, dropping entries past their TTL. */
function hydrateCache<T>(storageKey: string): Map<string, CacheRow<T>> {
  const map = new Map<string, CacheRow<T>>()
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return map
    const rows = JSON.parse(raw) as Array<[string, CacheRow<T>]>
    if (!Array.isArray(rows)) return map
    const now = Date.now()
    for (const row of rows.slice(-SEARCH_CACHE_MAX)) {
      if (!Array.isArray(row) || row.length !== 2) continue
      const [key, entry] = row
      if (typeof key !== 'string' || !entry || typeof entry.at !== 'number') continue
      if (now - entry.at > SEARCH_CACHE_TTL_MS) continue
      map.set(key, entry)
    }
  } catch {
    /* first run, private mode or a corrupt payload — start empty */
  }
  return map
}

/** Best-effort persist; quota or serialization problems keep the memory cache. */
function persistCache<T>(storageKey: string, map: Map<string, CacheRow<T>>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...map.entries()].slice(-SEARCH_CACHE_MAX)))
  } catch {
    /* over quota — the session cache still answers */
  }
}

/** Coalesced writers: a burst of searches touches localStorage once. */
let searchFlushTimer: ReturnType<typeof setTimeout> | null = null
let freeFlushTimer: ReturnType<typeof setTimeout> | null = null

const searchCache = hydrateCache<SearchResult[]>(SEARCH_CACHE_KEY)
const freeCache = hydrateCache<FreeHit[]>(FREE_CACHE_KEY)

function cacheGet(key: string): SearchResult[] | undefined {
  const hit = searchCache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key)
    return undefined
  }
  return hit.value
}

function cachePut(key: string, results: SearchResult[]): void {
  searchCache.delete(key)
  searchCache.set(key, { at: Date.now(), value: results })
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value
    if (oldest === undefined) break
    searchCache.delete(oldest)
  }
  if (!searchFlushTimer) {
    searchFlushTimer = setTimeout(() => {
      searchFlushTimer = null
      persistCache(SEARCH_CACHE_KEY, searchCache)
    }, 800)
  }
}

/**
 * The same idea for the free catalogues (Deezer / Apple / Internet Archive /
 * Spotify): preview and catalogue results change slowly, so a 10-minute
 * cache keeps retyping and back-navigation instant — and it survives a
 * restart, so "search too slow" is paid once per query, not per launch.
 */
function freeCacheGet(key: string): FreeHit[] | undefined {
  const hit = freeCache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) {
    freeCache.delete(key)
    return undefined
  }
  return hit.value
}

function freeCachePut(key: string, hits: FreeHit[]): void {
  freeCache.delete(key)
  freeCache.set(key, { at: Date.now(), value: hits })
  while (freeCache.size > SEARCH_CACHE_MAX) {
    const oldest = freeCache.keys().next().value
    if (oldest === undefined) break
    freeCache.delete(oldest)
  }
  if (!freeFlushTimer) {
    freeFlushTimer = setTimeout(() => {
      freeFlushTimer = null
      persistCache(FREE_CACHE_KEY, freeCache)
    }, 800)
  }
}

/**
 * Raw per-provider hits of the free search in flight. The stores below merge
 * them (shared `mergeHits`, same rules as the main process) as each provider
 * settles, then replace everything with the authoritative final list.
 */
let freePartialHits: FreeHit[] = []

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
  /** Liked-song ids (Liked Songs virtual playlist). */
  likedIds: string[]
  /**
   * Stream-first metadata for liked/playlist ids missing from the library,
   * so they play via streaming without forcing a download.
   */
  meta: Record<string, SearchResult>
  settings: AppSettings
  jobs: DownloadJob[]
  results: SearchResult[]
  searching: boolean
  /** Free-catalogue hits (previews/CC/Spotify link-outs) for the same query. */
  freeResults: FreeHit[]
  freeSearching: boolean
  /** Which query `freeResults` belongs to (mirrors resultsQuery). */
  freeQuery: string
  /** Public radio channels; loaded once per session. */
  radio: RadioChannel[]
  /** Live Search-page query (shared so TopBar submissions fill the page input). */
  searchQuery: string
  /** Which query `results` belongs to — pages render them only when it matches. */
  resultsQuery: string
  /** Optimistic streaming: id of the track being started (row shows a chip). */
  startingId: string | null
  toast: Toast | null
  /** Profile customization (reactive; persisted to localStorage). */
  avatarBg: string
  accent: string
  setAvatarBg: (bg: string) => void
  setAccent: (value: string) => void

  init: () => Promise<void>
  reload: () => Promise<void>
  register: (username: string, email: string, password: string, displayName?: string) => Promise<void>
  login: (login: string, password: string) => Promise<void>
  logout: () => Promise<void>
  updateDisplayName: (displayName: string) => Promise<void>
  setAvatar: () => Promise<void>
  removeAvatar: () => Promise<void>
  setSearchQuery: (query: string) => void
  search: (query: string, opts?: { silent?: boolean }) => Promise<void>
  /** Same query, free catalogues: previews, Internet Archive, Spotify links. */
  searchFree: (query: string, opts?: { silent?: boolean }) => Promise<void>
  /** Play a free hit (previews/CC queue through the write-through cache). */
  playFree: (hit: FreeHit) => void
  /** Fetch the radio channel list (idempotent; cached for the session). */
  loadRadio: () => Promise<void>
  /** Dial a live radio station (resolved through its .pls playlist). */
  playRadio: (channel: RadioChannel) => Promise<void>
  /** Play a search result: local file if owned, else stream, else download. */
  playFromSearch: (result: SearchResult) => Promise<void>
  download: (result: SearchResult) => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  clearJobs: () => void
  createPlaylist: (name: string) => Promise<Playlist | null>
  renamePlaylist: (playlistId: string, name: string) => Promise<void>
  deletePlaylist: (playlistId: string) => Promise<void>
  addToPlaylist: (playlistId: string, trackId: string, meta?: SearchResult) => Promise<void>
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>
  removeTrack: (trackId: string) => Promise<void>
  toggleLike: (trackId: string, meta?: SearchResult) => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  notify: (message: string, kind?: 'info' | 'error') => void
  dismissToast: () => void
  /** "Save to library + add to playlist" (for Search → playlist). Downloads first, adds on completion. */
  downloadAndAddToPlaylist: (result: SearchResult, playlistId: string) => Promise<void>
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  user: null,
  users: [],
  tracks: [],
  playlists: [],
  likedIds: [],
  meta: {},
  settings: DEFAULT_SETTINGS,
  jobs: [],
  results: [],
  searching: false,
  freeResults: [],
  freeSearching: false,
  freeQuery: '',
  radio: [],
  searchQuery: '',
  resultsQuery: '',
  startingId: null,
  toast: null,
  avatarBg: loadAvatarBg(null),
  accent: loadAccent(),

  setAvatarBg: (bg) => {
    saveAvatarBg(get().user?.id, bg)
    set({ avatarBg: bg })
  },

  setAccent: (value) => {
    saveAccent(value)
    set({ accent: value })
  },

  /** Called once on mount: restores the session and subscribes to events. */
  init: async () => {
    try {
      // Independent reads go out together instead of one round-trip at a time.
      const [users, user] = await Promise.all([
        window.spinity.auth.listUsers(),
        window.spinity.auth.current()
      ])
      set({ users })
      if (user) {
        // 1.0 cloud session: the app opens straight in. A dead token (server
        // reset, 90-day expiry) surfaces via the socket auth error, which
        // drops back to login — an offline boot keeps working locally.
        set({ user, avatarBg: loadAvatarBg(user.id) })
        await get().reload()
      }
    } catch (err) {
      get().notify(errMessage(err), 'error')
    } finally {
      set({ ready: true })
    }

    window.spinity.events.onDownloadUpdated((job) => {
      // Coalesce 4Hz progress ticks: only re-render on % change or terminal.
      const prev = get().jobs.find((j) => j.id === job.id)
      if (prev && prev.status === job.status && prev.progress === job.progress) return
      set((state) => ({ jobs: [job, ...state.jobs.filter((j) => j.id !== job.id)] }))
      if (job.status === 'error' && job.error) get().notify(job.error, 'error')
      if (job.status === 'done') {
        void (async () => {
          await get().reload()
          // Pending "download then add to playlist" from Search page.
          try {
            const raw = localStorage.getItem('spinity:pendingPlaylistAdds')
            if (raw) {
              const pending = JSON.parse(raw) as Record<string, string>
              const plId = pending[job.trackId]
              if (plId) {
                try {
                  await window.spinity.playlists.addTrack(plId, job.trackId)
                  await get().reload()
                  get().notify(t('toast.savedAdded', 'Saved to library and added to playlist'))
                } catch {}
                delete pending[job.trackId]
                localStorage.setItem('spinity:pendingPlaylistAdds', JSON.stringify(pending))
              }
            }
          } catch {}
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

    // Free catalogues paint as they settle: Deezer and Apple answer in about a
    // second while the Internet Archive's metadata round trips keep going. The
    // partials are merged with the same rules the final list uses, so no row
    // jumps when the authoritative answer replaces them.
    window.spinity.events.onFreePartial((payload) => {
      const { freeQuery: active, freeSearching: busy } = get()
      if (!busy || payload.query !== active) return
      freePartialHits = freePartialHits.concat(payload.hits)
      try {
        set({ freeResults: mergeHits(freePartialHits).slice(0, 28) })
      } catch {
        set({ freeResults: freePartialHits.slice(0, 28) })
      }
    })

    // Streaming failure → fall back to downloading the same track. Free-tier
    // streams (previews / radio) have no downloader behind them — just say so.
    usePlayer.getState().onStreamError((result) => {
      if (result.source !== 'youtube') {
        get().notify(t('toast.freeStreamFailed', 'That stream failed — try another result'), 'error')
        return
      }
      get().notify(t('toast.streamFailed', 'Streaming failed — downloading instead'), 'error')
      void get().download(result)
    })
  },

  reload: async () => {
    try {
      const snap = await window.spinity.library.snapshot()
      set({
        user: snap.user,
        avatarBg: loadAvatarBg(snap.user.id),
        tracks: snap.tracks,
        playlists: snap.playlists,
        likedIds: snap.likedIds ?? [],
        meta: snap.meta ?? {},
        settings: snap.settings
      })
      set({ jobs: await window.spinity.downloads.list() })
      if (!sessionRestored) {
        sessionRestored = true
        // Cue the track, and the offset, that was playing when the app closed.
        restorePlayerSession(snap.tracks)
      }
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  register: async (username, email, password, displayName) => {
    try {
      const user = await window.spinity.auth.register(username, email, password, displayName)
      set({ user, avatarBg: loadAvatarBg(user.id), users: await window.spinity.auth.listUsers() })
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
      throw err
    }
  },

  login: async (login, password) => {
    try {
      const user = await window.spinity.auth.login(login, password)
      set({ user, avatarBg: loadAvatarBg(user.id) })
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
      throw err
    }
  },

  logout: async () => {
    await window.spinity.auth.logout()
    set({ user: null, avatarBg: loadAvatarBg(null), tracks: [], playlists: [], likedIds: [], results: [], resultsQuery: '', searchQuery: '', jobs: [], searching: false, freeResults: [], freeQuery: '', freeSearching: false, radio: [] })
  },

  updateDisplayName: async (displayName) => {
    try {
      const user = await window.spinity.auth.updateDisplayName(displayName.trim())
      set({ user, users: await window.spinity.auth.listUsers() })
      get().notify(t('toast.profileUpdated', 'Profile updated'))
    } catch (err) {
      get().notify(errMessage(err), 'error')
      throw err
    }
  },

  setAvatar: async () => {
    try {
      const before = get().user?.avatarPath ?? null
      const user = await window.spinity.auth.setAvatar()
      set({ user, users: await window.spinity.auth.listUsers() })
      if ((user.avatarPath ?? null) !== before) get().notify(t('toast.pictureUpdated', 'Profile picture updated'))
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  removeAvatar: async () => {
    try {
      const user = await window.spinity.auth.removeAvatar()
      set({ user, users: await window.spinity.auth.listUsers() })
      get().notify(t('toast.pictureRemoved', 'Profile picture removed'))
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  setSearchQuery: (query) => {
    if (get().searchQuery === query) return
    set({ searchQuery: query })
  },

  search: async (query, opts) => {
    const silent = opts?.silent ?? false
    const trimmed = query.trim()
    if (!trimmed) {
      set({ results: [], resultsQuery: '', searching: false })
      return
    }
    const key = normalizeText(trimmed)

    // Instant render from the session cache; a background refresh is not
    // worth it for a 10-minute TTL.
    const cached = cacheGet(key)
    if (cached) {
      set({ results: cached, resultsQuery: trimmed, searching: false })
      return
    }

    set({ searching: true, resultsQuery: trimmed })
    try {
      const results = await window.spinity.youtube.search(trimmed, 20)
      cachePut(key, results)
      // Only commit if this is still the newest query — a superseded request
      // must not paint over fresher results.
      if (get().resultsQuery === trimmed) set({ results, searching: false })
      if (results.length === 0 && !silent) get().notify(t('toast.noResults', 'No results found for that search'))
    } catch (err) {
      // A newer keystroke already superseded this query — stay quiet and keep
      // whatever the latest search returns.
      if (err instanceof Error && err.message.includes('Superseded')) {
        if (get().resultsQuery === trimmed) set({ searching: false })
        return
      }
      if (!silent) get().notify(errMessage(err), 'error')
      if (get().resultsQuery === trimmed) set({ results: [], searching: false })
    }
  },

  /**
   * Free catalogues, same query: Deezer/Apple previews, Internet Archive
   * Creative Commons tracks, plus Spotify link-outs when credentials are
   * configured. Runs alongside the YouTube search; silent by default so the
   * section just appears when it has something to show.
   */
  searchFree: async (query, opts) => {
    const silent = opts?.silent ?? false
    const trimmed = query.trim()
    if (!trimmed) {
      set({ freeResults: [], freeQuery: '', freeSearching: false })
      return
    }
    const key = normalizeText(trimmed)
    const cached = freeCacheGet(key)
    if (cached) {
      set({ freeResults: cached, freeQuery: trimmed, freeSearching: false })
      return
    }
    set({ freeSearching: true, freeQuery: trimmed, freeResults: [] })
    freePartialHits = []
    try {
      // Rows are painted by the onFreePartial subscription while this runs;
      // the resolved list below is the authoritative merge.
      const hits = await window.spinity.free.search(trimmed, 14)
      freeCachePut(key, hits)
      freePartialHits = []
      if (get().freeQuery === trimmed) set({ freeResults: hits, freeSearching: false })
    } catch (err) {
      freePartialHits = []
      if (get().freeQuery === trimmed) set({ freeResults: [], freeSearching: false })
      if (!silent) get().notify(errMessage(err), 'error')
    }
  },

  /**
   * Play a free hit.
   *
   * Every playable hit of the current list becomes the queue (previews flow
   * into each other), and each entry wraps its provider URL in
   * `spinity://stream/?u=…` so the main-process cache fetches it once and
   * serves the growing file — first audio with the first network bytes, and
   * replays straight from disk. Link-out-only hits (Spotify) open externally.
   */
  playFree: (hit) => {
    if (!hit.audioUrl) {
      const url = hit.spotifyUrl ?? hit.pageUrl
      if (url) window.open(url, '_blank')
      return
    }
    // Kick the cache immediately: playback then reads the same download.
    try {
      void window.spinity.free.prewarm(hit.audioUrl).catch(() => {})
    } catch {}
    const tracks: Track[] = get()
      .freeResults.filter((h) => Boolean(h.audioUrl))
      .map((h) => ({
        id: h.id,
        source: 'preview',
        title: h.title,
        artist: h.artist,
        durationSec: h.durationSec,
        thumbnail: h.artwork,
        webUrl: h.pageUrl ?? '',
        filePath: '',
        downloadedAt: 0,
        streamUrl: streamUrlFor(h.audioUrl as string),
        license: h.license
      }))
    if (tracks.length === 0) return
    const index = Math.max(
      0,
      tracks.findIndex((tk) => tk.id === hit.id)
    )
    usePlayer.getState().playQueue(tracks, index)
  },

  /** Radio channel list, fetched once per session. */
  loadRadio: async () => {
    if (get().radio.length > 0) return
    try {
      const radio = await window.spinity.free.radio()
      set({ radio })
      // Resolve the playlists of the stations the UI shows first, quietly, so
      // the first tune-in skips the .pls round trip entirely.
      prefetchRadioChannels(radio, 8)
    } catch {
      /* offline — the section simply stays hidden */
    }
  },

  /** Dial a live station: resolve its .pls, then play the direct stream. */
  playRadio: async (channel) => {
    try {
      // Usually already resolved by the prefetch/hover warmup.
      const url = await resolveRadio(channel.plsUrl)
      const track: Track = {
        id: `radio:${channel.id}`,
        source: 'radio',
        title: channel.title,
        artist: channel.genre ? `Live radio · ${channel.genre}` : t('radio.live', 'Live radio'),
        durationSec: 0,
        thumbnail: channel.image,
        webUrl: `https://somafm.com/${channel.id}/`,
        filePath: '',
        downloadedAt: 0,
        streamUrl: url
      }
      usePlayer.getState().playQueue([track], 0)
      get().notify(`${channel.title} · ${t('radio.live', 'live radio')}`)
    } catch (err) {
      get().notify(errMessage(err), 'error')
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
      set({ startingId: result.id })
      try {
        await get().download(result)
      } finally {
        set({ startingId: null })
      }
      get().notify(t('toast.downloadingLibrary', 'Downloading — it will appear in your Library'))
      return
    }

    set({ startingId: result.id })
    try {
      const info = await window.spinity.youtube.stream(result.id)
      usePlayer.getState().playStream(info.url, result)
      get().notify(t('toast.streamingFallback', 'Streaming — will download automatically if this fails'))
    } catch (err) {
      get().notify(`${errMessage(err)}${t('toast.downloadingInstead', ' — downloading instead')}`, 'error')
      await get().download(result)
    } finally {
      set({ startingId: null })
    }
  },

  download: async (result) => {
    try {
      const job = await window.spinity.downloads.start(result)
      set((state) => ({ jobs: [job, ...state.jobs] }))
      get().notify(`${t('toast.queuedColon', 'Queued:')} ${result.title}`)
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

  renamePlaylist: async (playlistId, name) => {
    const clean = name.trim()
    if (!clean) {
      get().notify(t('toast.playlistNameEmpty', 'Playlist name cannot be empty'), 'error')
      return
    }
    try {
      await window.spinity.playlists.rename(playlistId, clean)
      await get().reload()
    } catch (err) {
      get().notify(errMessage(err), 'error')
    }
  },

  addToPlaylist: async (playlistId, trackId, meta) => {
    try {
      await window.spinity.playlists.addTrack(playlistId, trackId, meta)
      const name = get().playlists.find((p) => p.id === playlistId)?.name ?? 'playlist'
      await get().reload()
      get().notify(`${t('toast.addedTo', 'Added to')} ${name}`)
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

  toggleLike: async (trackId, meta) => {
    // Optimistic: flip instantly, roll back on failure.
    const was = get().likedIds.includes(trackId)
    set((s) => ({ likedIds: was ? s.likedIds.filter((id) => id !== trackId) : [trackId, ...s.likedIds] }))
    try {
      await window.spinity.library.toggleLike(trackId, meta)
      // Liking something you don't own saves it to the library (classic
      // behaviour): queue one download so it plays offline and never depends
      // on streaming. The heart flips instantly; the file lands shortly after.
      if (!was && meta && !get().tracks.some((t) => t.id === trackId)) {
        const busy = get().jobs.some(
          (j) =>
            j.trackId === trackId &&
            (j.status === 'queued' || j.status === 'downloading' || j.status === 'converting')
        )
        if (!busy) await get().download(meta)
      }
    } catch (err) {
      set((s) => ({ likedIds: was ? [trackId, ...s.likedIds] : s.likedIds.filter((id) => id !== trackId) }))
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

  dismissToast: () => set({ toast: null }),

  downloadAndAddToPlaylist: async (result, playlistId) => {
    // Already in library → add straight away.
    if (get().tracks.some((t) => t.id === result.id)) {
      await get().addToPlaylist(playlistId, result.id)
      return
    }
    try {
      const raw = localStorage.getItem('spinity:pendingPlaylistAdds')
      const pending = (raw ? JSON.parse(raw) : {}) as Record<string, string>
      pending[result.id] = playlistId
      localStorage.setItem('spinity:pendingPlaylistAdds', JSON.stringify(pending))
    } catch {}
    await get().download(result)
    get().notify(t('toast.downloadThenAdd', 'Downloading — will add to playlist when finished'))
  }

}))
