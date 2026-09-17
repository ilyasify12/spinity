import path from 'node:path'
import { app } from 'electron'
import fs from 'node:fs'
import { JsonStore } from './store'
import { hashPassword, newId, verifyPassword } from './auth'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Playlist,
  type Track,
  type User
} from '../shared/types'

/** A user record as persisted, including the secret parts. */
interface StoredUser extends User {
  passwordHash: string
}

interface UserData {
  tracks: Track[]
  playlists: Playlist[]
  /** Folders the user added as a local music source. Optional because
   * libraries created before local files existed will not have it. */
  localFolders?: string[]
}

export interface ServerAccount {
  serverUserId: string
  username: string
  token: string
  serverUrl: string
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
    return this.store.read().settings
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.store.update((store) => {
      store.settings = { ...store.settings, ...patch }
    })
    return this.store.read().settings
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

  flush(): void {
    this.store.flushNow()
  }

}

export const db = new Database()
