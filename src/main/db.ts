import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import { JsonStore } from './store'
import { hashPassword, newId, verifyPassword } from './auth'
import type { LyricSync } from '../shared/lyrics'
import type { AiCacheEntry } from './ai'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CachedLyrics,
  type CachedPeaks,
  type Playlist,
  type SearchResult,
  type Track,
  type User
} from '../shared/types'

/** A user record as persisted, including the secret parts. */
interface StoredUser extends User {
  passwordHash: string
  /** Absolute path to a custom avatar image (png/jpg/gif/webp), if uploaded. */
  avatarPath?: string | null
  /** 1.0 cloud identity this device profile is linked to (one login everywhere). */
  serverUserId?: string | null
}

interface UserData {
  tracks: Track[]
  playlists: Playlist[]
  /** Folders the user added as a local music source. Optional because
   * libraries created before local files existed will not have it. */
  localFolders?: string[]
  /** Liked-song ids backing the Liked Songs virtual playlist. */
  likedIds?: string[]
  /**
   * Stream-first metadata for ids that are NOT in `tracks` (liked or
   * playlist-added straight from search). Lets likes/playlists play via
   * streaming without forcing a download first.
   */
  metaCache?: Record<string, SearchResult>
}

export interface ServerAccount {
  serverUserId: string
  username: string
  token: string
  serverUrl: string
}

/**
 * Persisted lyric timing for one track.
 *
 * Deliberately its own record rather than a field on `CachedLyrics`: a `.lrc`
 * sidecar is never cached, and a user upload replaces the cached lyrics — the
 * hand-tuned timing must survive both.
 */
export interface StoredLyricSync extends LyricSync {
  updatedAt: number
}

interface DbShape {
  version: number
  settings: AppSettings
  users: StoredUser[]
  /** Keyed by user id. Kept separate so account metadata stays small. */
  data: Record<string, UserData>
  /** Remembered login, so the app can reopen the last account. */
  session?: { userId: string } | null
  /** Online Spinity account, keyed by local user id. */
  serverAccounts?: Record<string, ServerAccount>
  /** Lyrics cache, keyed by track id (any local account's track). */
  lyrics?: Record<string, CachedLyrics>
  /**
   * Lyrics the model wrote (AI writing mode), keyed by track id — deliberately
   * a separate record from `lyrics`, which holds the user's own chain
   * (upload > `.lrc` sidecar > lrclib match).
   *
   * Two caches is what makes the Normal / AI switch safe: enabling AI writing
   * never overwrites a real match, and turning it off again shows exactly the
   * same lyrics as before, instantly, with no re-fetch and no model call.
   */
  aiLyrics?: Record<string, CachedLyrics>
  /**
   * Hand-tuned lyric timing, keyed by track id. Kept apart from the lyrics
   * cache so it survives a re-fetch, a replace or a `.lrc` edit.
   */
  lyricSync?: Record<string, StoredLyricSync>
  /** Version of the automatic-lyrics cache (see migrateLyricsCache). */
  lyricsCacheVersion?: number
  /**
   * Answers from the optional AI helper, keyed by track id. Kept so a song
   * costs at most one model call, ever.
   */
  aiCache?: Record<string, AiCacheEntry>
  /** Waveform peaks cache, keyed by track id. */
  wavePeaks?: Record<string, CachedPeaks>
}

const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/
const MIN_PASSWORD = 6

function defaults(): DbShape {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, users: [], data: {}, session: null }
}

/** Strip the password hash before anything leaves the main process. */
function toPublicUser(u: StoredUser): User {
  const { passwordHash: _ignored, ...rest } = u
  return rest
}

class Database {
  private store = new JsonStore<DbShape>('spinity.json', defaults())

  // ---------------------------------------------------------------- accounts

  listUsers(): User[] {
    return this.store
      .read()
      .users.map(toPublicUser)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  register(rawUsername: string, password: string, displayName?: string): User {
    const username = rawUsername.trim().toLowerCase()
    if (!USERNAME_RE.test(username)) {
      throw new Error('Username must be 3-24 characters: letters, numbers, _ . or -')
    }
    if (password.length < MIN_PASSWORD) {
      throw new Error(`Password must be at least ${MIN_PASSWORD} characters`)
    }
    if (this.store.read().users.some((u) => u.username === username)) {
      throw new Error('That username is already taken on this machine')
    }

    const user: StoredUser = {
      id: newId(),
      username,
      displayName: (displayName || rawUsername).trim() || username,
      createdAt: Date.now(),
      passwordHash: hashPassword(password)
    }

    this.store.update((store) => {
      store.users.push(user)
      store.data[user.id] = { tracks: [], playlists: [] }
    })
    return toPublicUser(user)
  }

  login(rawUsername: string, password: string): User {
    const username = rawUsername.trim().toLowerCase()
    const found = this.store.read().users.find((u) => u.username === username)
    // Same error for unknown user and bad password: don't leak which exist.
    if (!found || !verifyPassword(password, found.passwordHash)) {
      throw new Error('Incorrect username or password')
    }
    return toPublicUser(found)
  }

  getUser(userId: string): User | null {
    const found = this.store.read().users.find((u) => u.id === userId)
    return found ? toPublicUser(found) : null
  }

  /** Rename the local profile's display name (username never changes). */
  renameUser(userId: string, displayName: string): User {
    const clean = displayName.trim()
    if (!clean) throw new Error('Display name cannot be empty')
    if (clean.length > 40) throw new Error('Display name is too long (max 40)')
    let updated: StoredUser | null = null
    this.store.update((store) => {
      const found = store.users.find((u) => u.id === userId)
      if (!found) throw new Error('Account not found')
      found.displayName = clean
      updated = found
    })
    if (!updated) throw new Error('Account not found')
    return toPublicUser(updated)
  }

  /** Absolute avatar file for a user, if they uploaded one. */
  getAvatarPath(userId: string): string | null {
    const found = this.store.read().users.find((u) => u.id === userId)
    return found?.avatarPath ?? null
  }

  /** Point a user at an avatar file (or clear it). Returns the public user. */
  setAvatarPath(userId: string, avatarPath: string | null): User {
    let updated: StoredUser | null = null
    this.store.update((store) => {
      const found = store.users.find((u) => u.id === userId)
      if (!found) throw new Error('Account not found')
      found.avatarPath = avatarPath
      updated = found
    })
    if (!updated) throw new Error('Account not found')
    return toPublicUser(updated)
  }

  /** Directory where avatar uploads live. */
  avatarDir(): string {
    const dir = path.join(app.getPath('userData'), 'avatars')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  // ------------------------------------------------------- remembered login

  getSessionUserId(): string | null {
    return this.store.read().session?.userId ?? null
  }

  setSession(userId: string | null): void {
    this.store.update((store) => {
      store.session = userId ? { userId } : null
    })
  }

  /** The remembered account, if it still exists on this machine. */
  getSessionUser(): User | null {
    const id = this.getSessionUserId()
    return id ? this.getUser(id) : null
  }

  // ---------------------------------------------------------------- library

  private userData(userId: string): UserData {
    const existing = this.store.read().data[userId]
    if (existing) return existing
    const fresh: UserData = { tracks: [], playlists: [] }
    this.store.update((store) => {
      store.data[userId] = fresh
    })
    return fresh
  }

  getTracks(userId: string): Track[] {
    return this.userData(userId).tracks
  }

  hasTrack(userId: string, trackId: string): boolean {
    return this.userData(userId).tracks.some((t) => t.id === trackId)
  }

  /** Insert or replace a downloaded track. Returns the stored record. */
  upsertTrack(userId: string, track: Track): Track {
    this.store.update((store) => {
      const bucket = store.data[userId] ?? (store.data[userId] = { tracks: [], playlists: [] })
      const idx = bucket.tracks.findIndex((t) => t.id === track.id)
      if (idx >= 0) bucket.tracks[idx] = track
      else bucket.tracks.unshift(track)
    })
    return track
  }

  /**
   * Remove from the library, detach from every playlist, and delete the file
   * from disk. Leaving orphaned bytes behind would silently grow the library
   * folder forever.
   */
  removeTrack(userId: string, trackId: string): void {
    const existing = this.userData(userId).tracks.find((t) => t.id === trackId)
    this.store.update((store) => {
      const bucket = store.data[userId]
      if (!bucket) return
      bucket.tracks = bucket.tracks.filter((t) => t.id !== trackId)
      // Also drop it from every playlist so no dangling ids remain.
      for (const pl of bucket.playlists) {
        pl.trackIds = pl.trackIds.filter((id) => id !== trackId)
      }
      if (bucket.likedIds) bucket.likedIds = bucket.likedIds.filter((id) => id !== trackId)
    })
    if (existing) {
      // Only YouTube downloads are ours to delete. Local files were added by
      // the user from their own folders — removing them from the library must
      // never delete their actual music.
      if (existing.source === 'youtube') {
        try {
          fs.rmSync(existing.filePath, { force: true })
        } catch (err) {
          console.error('[db] could not delete audio file', existing.filePath, err)
        }
      }
    }
  }

  // -------------------------------------------------------------- playlists

  getPlaylists(userId: string): Playlist[] {
    return this.userData(userId).playlists
  }

  createPlaylist(userId: string, name: string): Playlist {
    const clean = name.trim()
    if (!clean) throw new Error('Playlist name cannot be empty')
    const playlist: Playlist = {
      id: newId(),
      name: clean,
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.store.update((store) => {
      const bucket = store.data[userId] ?? (store.data[userId] = { tracks: [], playlists: [] })
      bucket.playlists.push(playlist)
    })
    return playlist
  }

  renamePlaylist(userId: string, playlistId: string, name: string): void {
    const clean = name.trim()
    if (!clean) throw new Error('Playlist name cannot be empty')
    this.store.update((store) => {
      const pl = store.data[userId]?.playlists.find((p) => p.id === playlistId)
      if (!pl) throw new Error('Playlist not found')
      pl.name = clean
      pl.updatedAt = Date.now()
    })
  }

  deletePlaylist(userId: string, playlistId: string): void {
    this.store.update((store) => {
      const bucket = store.data[userId]
      if (!bucket) return
      bucket.playlists = bucket.playlists.filter((p) => p.id !== playlistId)
    })
  }

  addToPlaylist(userId: string, playlistId: string, trackId: string): void {
    this.store.update((store) => {
      const pl = store.data[userId]?.playlists.find((p) => p.id === playlistId)
      if (!pl) throw new Error('Playlist not found')
      if (pl.trackIds.includes(trackId)) return // idempotent
      pl.trackIds.push(trackId)
      pl.updatedAt = Date.now()
    })
  }

  removeFromPlaylist(userId: string, playlistId: string, trackId: string): void {
    this.store.update((store) => {
      const pl = store.data[userId]?.playlists.find((p) => p.id === playlistId)
      if (!pl) return
      pl.trackIds = pl.trackIds.filter((id) => id !== trackId)
      pl.updatedAt = Date.now()
    })
  }

  // ------------------------------------------------------------ liked songs

  getLikedIds(userId: string): string[] {
    return this.userData(userId).likedIds ?? []
  }

  isLiked(userId: string, trackId: string): boolean {
    return this.getLikedIds(userId).includes(trackId)
  }

  /** Toggle a like. Returns the new state (true = liked). */
  toggleLike(userId: string, trackId: string, meta?: SearchResult): boolean {
    let liked = false
    this.store.update((store) => {
      const bucket =
        store.data[userId] ?? (store.data[userId] = { tracks: [], playlists: [] })
      if (!bucket.likedIds) bucket.likedIds = []
      if (bucket.likedIds.includes(trackId)) {
        bucket.likedIds = bucket.likedIds.filter((id) => id !== trackId)
        liked = false
      } else {
        bucket.likedIds.unshift(trackId)
        liked = true
        if (meta && meta.id === trackId) this.saveMetaLocked(bucket, meta)
      }
    })
    return liked
  }

  /** Remember stream-first metadata for a non-library id (capped). */
  private saveMetaLocked(bucket: { metaCache?: Record<string, SearchResult> }, meta: SearchResult): void {
    if (!bucket.metaCache) bucket.metaCache = {}
    bucket.metaCache[meta.id] = meta
    const keys = Object.keys(bucket.metaCache)
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) delete bucket.metaCache[k]
    }
  }

  saveMeta(userId: string, meta: SearchResult): void {
    if (!meta || !meta.id) return
    this.store.update((store) => {
      const bucket = store.data[userId] ?? (store.data[userId] = { tracks: [], playlists: [] })
      this.saveMetaLocked(bucket, meta)
    })
  }

  /** Metadata for ids missing from the library (stream-first likes/playlists). */
  getMetas(userId: string, ids: string[]): Record<string, SearchResult> {
    const cache = this.store.read().data[userId]?.metaCache ?? {}
    const out: Record<string, SearchResult> = {}
    for (const id of ids) {
      if (cache[id]) out[id] = cache[id]
    }
    return out
  }

  // ------------------------------------------------------------ local files

  getLocalFolders(userId: string): string[] {
    return this.userData(userId).localFolders ?? []
  }

  addLocalFolder(userId: string, folder: string): void {
    this.store.update((store) => {
      const bucket =
        store.data[userId] ?? (store.data[userId] = { tracks: [], playlists: [], localFolders: [] })
      if (!bucket.localFolders) bucket.localFolders = []
      const exists = bucket.localFolders.some((f) => f.toLowerCase() === folder.toLowerCase())
      if (!exists) bucket.localFolders.push(folder)
    })
  }

  /** Forget a folder and drop every local track that lives under it. */
  removeLocalFolder(userId: string, folder: string): void {
    this.store.update((store) => {
      const bucket = store.data[userId]
      if (!bucket) return
      const norm = folder.toLowerCase().replace(/[\\/]+$/, '')
      if (bucket.localFolders) {
        bucket.localFolders = bucket.localFolders.filter(
          (f) => f.toLowerCase().replace(/[\\/]+$/, '') !== norm
        )
      }
      bucket.tracks = bucket.tracks.filter(
        (t) => !(t.source === 'local' && t.filePath.toLowerCase().startsWith(norm))
      )
    })
  }

  /**
   * Replace a folder's local tracks with a fresh scan.
   *
   * Entries whose file still exists are preserved rather than re-created, so
   * durations already discovered by ffprobe are not thrown away on rescan.
   * Returns how many tracks were newly added.
   */
  syncLocalTracks(userId: string, folder: string, scanned: Track[]): number {
    const normFolder = folder.toLowerCase().replace(/[\\/]+$/, '')
    let added = 0
    this.store.update((store) => {
      const bucket =
        store.data[userId] ?? (store.data[userId] = { tracks: [], playlists: [], localFolders: [] })
      const keep = new Set(scanned.map((t) => t.filePath.toLowerCase()))
      bucket.tracks = bucket.tracks.filter((t) => {
        if (t.source !== 'local') return true
        const under = t.filePath.toLowerCase().startsWith(normFolder)
        return under ? keep.has(t.filePath.toLowerCase()) : true
      })
      for (const track of scanned) {
        const idx = bucket.tracks.findIndex((x) => x.id === track.id)
        if (idx >= 0) bucket.tracks[idx] = track
        else {
          bucket.tracks.unshift(track)
          added += 1
        }
      }
    })
    return added
  }

  // --------------------------------------------------------------- settings

  getSettings(): AppSettings {
    // Merge with defaults so settings added by newer versions exist for
    // libraries created before them (the JSON store only merges top level).
    return { ...DEFAULT_SETTINGS, ...this.store.read().settings }
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.store.update((store) => {
      store.settings = { ...store.settings, ...patch }
    })
    // Return the merged view, not the raw record: a library written before a
    // setting existed would otherwise hand the renderer an object missing it.
    return this.getSettings()
  }

  // ---------------------------------------------------------------- storage

  /** Directory where a given user's audio files live. */
  audioDir(userId: string): string {
    const root =
      this.store.read().settings.libraryRoot || path.join(app.getPath('userData'), 'users')
    const dir = path.join(root, userId, 'audio')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  // ---------------------------------------------------------- server account

  getServerAccount(userId: string): ServerAccount | null {
    return this.store.read().serverAccounts?.[userId] ?? null
  }

  setServerAccount(userId: string, account: ServerAccount | null): void {
    this.store.update((store) => {
      if (!store.serverAccounts) store.serverAccounts = {}
      if (account) store.serverAccounts[userId] = account
      else delete store.serverAccounts[userId]
    })
  }

  /**
   * 1.0 cloud login: bind a device profile to the server account so the same
   * login keeps its music on this computer. Prefers an already-linked
   * profile, else adopts a same-username local profile (migration keeps its
   * library), else creates a fresh one. Music libraries stay per-device —
   * only identity, friends and chat live in the cloud.
   */
  adoptCloudUser(serverUserId: string, username: string, displayName: string): User {
    let adopted: StoredUser | null = null
    this.store.update((store) => {
      adopted = store.users.find((u) => u.serverUserId === serverUserId)
        ?? store.users.find((u) => u.username === username.toLowerCase())
        ?? null
      if (adopted) {
        adopted.serverUserId = serverUserId
        adopted.displayName = displayName || adopted.displayName
      } else {
        const fresh: StoredUser = {
          id: newId(),
          username: username.toLowerCase(),
          displayName: displayName || username,
          createdAt: Date.now(),
          // Local password login is gone in 1.0; keep an unusable hash so the
          // shape stays valid and old code paths can't match an empty secret.
          passwordHash: hashPassword(newId()),
          serverUserId
        }
        store.users.push(fresh)
        store.data[fresh.id] = { tracks: [], playlists: [] }
        adopted = fresh
      }
    })
    if (!adopted) throw new Error('Could not set up local profile')
    return toPublicUser(adopted)
  }

  flush(): void {
    this.store.flushNow()
  }

  /** Find a track in any local account's library (device-local lookup). */
  findTrackAnywhere(trackId: string): Track | null {
    const data = this.store.read().data
    for (const userId of Object.keys(data)) {
      const found = data[userId]?.tracks.find((t) => t.id === trackId)
      if (found) return found
    }
    return null
  }

  // ------------------------------------------------- lyrics + wave caches

  getLyrics(trackId: string): CachedLyrics | null {
    return this.store.read().lyrics?.[trackId] ?? null
  }
  setLyrics(trackId: string, lyrics: CachedLyrics): void {
    this.store.update((store) => {
      if (!store.lyrics) store.lyrics = {}
      store.lyrics[trackId] = lyrics
      // Cap the cache so thousand-track libraries stay small on disk.
      const keys = Object.keys(store.lyrics)
      if (keys.length > 300) {
        keys
          .sort((a, b) => (store.lyrics![a].fetchedAt ?? 0) - (store.lyrics![b].fetchedAt ?? 0))
          .slice(0, keys.length - 300)
          .forEach((k) => delete store.lyrics![k])
      }
    })
  }

  /** Drop cached lyrics (auto-fetched or user-uploaded) for one track. */
  clearLyrics(trackId: string): void {
    this.store.update((store) => {
      if (store.lyrics) delete store.lyrics[trackId]
    })
  }

  /**
   * Lyrics the model wrote for this track in AI writing mode.
   *
   * Separate from `getLyrics` so the two modes are independent caches — see
   * `DbShape.aiLyrics`.
   */
  getAiLyrics(trackId: string): CachedLyrics | null {
    return this.store.read().aiLyrics?.[trackId] ?? null
  }

  setAiLyrics(trackId: string, lyrics: CachedLyrics): void {
    this.store.update((store) => {
      if (!store.aiLyrics) store.aiLyrics = {}
      store.aiLyrics[trackId] = lyrics
      const keys = Object.keys(store.aiLyrics)
      if (keys.length > 300) {
        keys
          .sort((a, b) => (store.aiLyrics![a].fetchedAt ?? 0) - (store.aiLyrics![b].fetchedAt ?? 0))
          .slice(0, keys.length - 300)
          .forEach((k) => delete store.aiLyrics![k])
      }
    })
  }

  /** "Write again": forget the model's lyrics for one track. */
  clearAiLyrics(trackId: string): void {
    this.store.update((store) => {
      if (store.aiLyrics) delete store.aiLyrics[trackId]
    })
  }

  // ------------------------------------------------------- lyric timing

  /**
   * Drop auto-fetched lyrics written before the current matcher version.
   *
   * User uploads are never touched: they are the one source the app must not
   * silently replace. Returns how many entries were retired.
   */
  migrateLyricsCache(version: number): number {
    let dropped = 0
    this.store.update((store) => {
      if (store.lyricsCacheVersion === version) return
      for (const [id, entry] of Object.entries(store.lyrics ?? {})) {
        if (entry.source === 'user') continue
        delete store.lyrics![id]
        dropped += 1
      }
      store.lyricsCacheVersion = version
    })
    return dropped
  }

  /** Hand-tuned timing for one track, or null when it is still automatic. */
  getLyricSync(trackId: string): StoredLyricSync | null {
    return this.store.read().lyricSync?.[trackId] ?? null
  }

  setLyricSync(trackId: string, sync: StoredLyricSync): void {
    this.store.update((store) => {
      if (!store.lyricSync) store.lyricSync = {}
      store.lyricSync[trackId] = sync
      const keys = Object.keys(store.lyricSync)
      if (keys.length > 500) {
        keys
          .sort((a, b) => (store.lyricSync![a].updatedAt ?? 0) - (store.lyricSync![b].updatedAt ?? 0))
          .slice(0, keys.length - 500)
          .forEach((k) => delete store.lyricSync![k])
      }
    })
  }

  clearLyricSync(trackId: string): void {
    this.store.update((store) => {
      if (store.lyricSync) delete store.lyricSync[trackId]
    })
  }

  // ---------------------------------------------------------- AI answers

  getAiCache(trackId: string): AiCacheEntry | null {
    return this.store.read().aiCache?.[trackId] ?? null
  }

  setAiCache(trackId: string, entry: AiCacheEntry): void {
    this.store.update((store) => {
      if (!store.aiCache) store.aiCache = {}
      store.aiCache[trackId] = entry
      const keys = Object.keys(store.aiCache)
      if (keys.length > 500) {
        keys
          .sort((a, b) => (store.aiCache![a].at ?? 0) - (store.aiCache![b].at ?? 0))
          .slice(0, keys.length - 500)
          .forEach((k) => delete store.aiCache![k])
      }
    })
  }

  /** Forget every AI answer (Settings → "forget learned names"). */
  clearAiCache(): number {
    let removed = 0
    this.store.update((store) => {
      removed = Object.keys(store.aiCache ?? {}).length
      store.aiCache = {}
    })
    return removed
  }

  getWavePeaks(trackId: string): CachedPeaks | null {
    return this.store.read().wavePeaks?.[trackId] ?? null
  }

  setWavePeaks(trackId: string, peaks: CachedPeaks): void {
    this.store.update((store) => {
      if (!store.wavePeaks) store.wavePeaks = {}
      store.wavePeaks[trackId] = peaks
      const keys = Object.keys(store.wavePeaks)
      if (keys.length > 300) {
        keys
          .sort((a, b) => (store.wavePeaks![a].updatedAt ?? 0) - (store.wavePeaks![b].updatedAt ?? 0))
          .slice(0, keys.length - 300)
          .forEach((k) => delete store.wavePeaks![k])
      }
    })
  }
}

export const db = new Database()
