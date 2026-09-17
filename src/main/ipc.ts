import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import { IPC } from '../shared/ipc'
import { db } from './db'
import { downloads, getToolStatus, resolveStreamUrl, search, updateYtDlp } from './ytdlp'
import { indexFolder, probeMissingDurations } from './localFiles'
import { socialApi, setSocialAccount, getSocialAccount, connectSocket, disconnectSocket, socketEmit, socialLogin, socialRegister, setSocialBroadcast } from './social'
import type {
  DownloadJob,
  LibrarySnapshot,
  Playlist,
  SearchResult,
  StreamInfo,
  Track,
  User
} from '../shared/types'

/**
 * IPC surface. Every handler validates that a user is signed in before
 * touching library data, so a compromised renderer cannot read another
 * local account's library.
 */

let currentUser: User | null = null

function requireUser(): User {
  if (!currentUser) throw new Error('Not signed in')
  return currentUser
}

export function currentUserSnapshot(): User | null {
  return currentUser
}

export function signOut(): void {
  currentUser = null
}

/**
 * Reopen the remembered account on startup. Returns it so the caller can log
 * whether a session was restored.
 */
export function restoreSession(): User | null {
  const user = db.getSessionUser()
  if (user) {
    currentUser = user
    const acc = db.getServerAccount(user.id)
    if (acc) { setSocialAccount(acc); try { connectSocket() } catch {} }
  }
  return currentUser
}

/** Resolve a trackId to its on-disk path for the active user (protocol use). */
export function filePathForTrack(trackId: string): string | null {
  if (!currentUser) return null
  const track = db.getTracks(currentUser.id).find((t) => t.id === trackId)
  return track?.filePath ?? null
}

function snapshot(): LibrarySnapshot {
  const user = requireUser()
  return {
    user,
    tracks: db.getTracks(user.id).map((track) => track.source === 'local'
      ? { ...track, thumbnail: `spinity://artwork/${encodeURIComponent(track.id)}` }
      : track),
    playlists: db.getPlaylists(user.id),
    localFolders: db.getLocalFolders(user.id),
    settings: db.getSettings()
  }
}

type Broadcast = (channel: string, payload: unknown) => void
let broadcast: Broadcast = () => {}

export function setBroadcast(fn: Broadcast): void {
  broadcast = fn
  setSocialBroadcast(fn)
}

/** Push download progress to the UI and auto-file finished downloads. */
export function wireDownloads(): void {
  downloads.onChange((job: DownloadJob) => {
    if (job.status === 'done' && job.filePath) {
      const track: Track = {
        ...job.source,
        filePath: job.filePath,
        downloadedAt: Date.now()
      }
      try {
        db.upsertTrack(job.userId, track)
      } catch (err) {
        console.error('[ipc] failed to index downloaded track', err)
      }
    }
    broadcast(IPC.evtDownloadUpdated, job)
  })
}

export function registerIpc(): void {
  // ------------------------------------------------------------- accounts
  ipcMain.handle(IPC.authListUsers, (): User[] => db.listUsers())

  ipcMain.handle(
    IPC.authRegister,
    (_e, username: string, password: string, displayName?: string, remember?: boolean) => {
      const user = db.register(username, password, displayName)
      currentUser = user
      // Remembering is the default; `remember === false` is the explicit opt-out.
      db.setSession(remember === false ? null : user.id)
      return user
    }
  )

  ipcMain.handle(
    IPC.authLogin,
    (_e, username: string, password: string, remember?: boolean) => {
      const user = db.login(username, password)
      currentUser = user
      db.setSession(remember === false ? null : user.id)
      return user
    }
  )

  ipcMain.handle(IPC.authLogout, () => {
    signOut()
    // Signing out deliberately forgets the remembered account, so the next
    // launch asks for credentials again.
    db.setSession(null)
  })

  ipcMain.handle(IPC.authCurrent, (): User | null => currentUser)

  // -------------------------------------------------------------- library
  ipcMain.handle(IPC.librarySnapshot, (): LibrarySnapshot => snapshot())

  ipcMain.handle(IPC.libraryAddTrack, (_e, track: Track) => {
    const user = requireUser()
    db.upsertTrack(user.id, track)
  })

  ipcMain.handle(IPC.libraryRemoveTrack, (_e, trackId: string) => {
    const user = requireUser()
    db.removeTrack(user.id, trackId)
  })

  ipcMain.handle(IPC.libraryRevealFile, async (_e, trackId: string) => {
    const user = requireUser()
    const track = db.getTracks(user.id).find((t) => t.id === trackId)
    if (!track) throw new Error('Track not in your library')
    const { shell } = await import('electron')
    shell.showItemInFolder(track.filePath)
  })

  // ------------------------------------------------------------ playlists
  ipcMain.handle(IPC.playlistCreate, (_e, name: string): Playlist => {
    const user = requireUser()
    return db.createPlaylist(user.id, name)
  })

  ipcMain.handle(IPC.playlistRename, (_e, playlistId: string, name: string) => {
    const user = requireUser()
    db.renamePlaylist(user.id, playlistId, name)
  })

  ipcMain.handle(IPC.playlistDelete, (_e, playlistId: string) => {
    const user = requireUser()
    db.deletePlaylist(user.id, playlistId)
  })

  ipcMain.handle(IPC.playlistAddTrack, (_e, playlistId: string, trackId: string) => {
    const user = requireUser()
    db.addToPlaylist(user.id, playlistId, trackId)
  })

  ipcMain.handle(IPC.playlistRemoveTrack, (_e, playlistId: string, trackId: string) => {
    const user = requireUser()
    db.removeFromPlaylist(user.id, playlistId, trackId)
  })

  // --------------------------------------------------------------- search
  ipcMain.handle(
    IPC.youtubeSearch,
    async (_e, query: string, limit?: number): Promise<SearchResult[]> => {
      requireUser()
      return search(query, limit ?? 20)
    }
  )

  /**
   * Resolve a direct stream URL. Kept separate from search so a slow YouTube
   * lookup never blocks listing results.
   *
   * The video id is re-validated here rather than trusting the renderer, since
   * it ends up inside a URL yt-dlp will fetch.
   */
  ipcMain.handle(IPC.youtubeStream, (_e, videoId: string): Promise<StreamInfo> => {
    requireUser()
    const id = String(videoId ?? '').trim()
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return Promise.reject(new Error('Invalid video id'))
    }
    return resolveStreamUrl(id)
  })

  // ------------------------------------------------------------ downloads
  ipcMain.handle(IPC.downloadStart, (_e, result: SearchResult): DownloadJob => {
    const user = requireUser()
    if (db.hasTrack(user.id, result.id)) {
      throw new Error('That track is already in your library')
    }
    if (downloads.isPending(result.id)) {
      throw new Error('That track is already downloading')
    }
    return downloads.enqueue({
      userId: user.id,
      outDir: db.audioDir(user.id),
      result,
      settings: db.getSettings()
    })
  })

  ipcMain.handle(IPC.downloadCancel, (_e, jobId: string) => {
    requireUser()
    downloads.cancel(jobId)
  })

  ipcMain.handle(IPC.downloadList, (): DownloadJob[] => {
    const user = requireUser()
    // Only surface this user's jobs.
    return downloads.list().filter((j) => j.userId === user.id)
  })

  // ------------------------------------------------------- local folders
  ipcMain.handle(
    IPC.localAddFolder,
    async (): Promise<{ folder: string | null; added: number }> => {
      const user = requireUser()
      const opts = {
        title: 'Choose a folder of music',
        properties: ['openDirectory'] as ('openDirectory')[]
      }
      const focused = BrowserWindow.getFocusedWindow()
      const result = focused ? await dialog.showOpenDialog(focused, opts) : await dialog.showOpenDialog(opts)
      if (result.canceled || result.filePaths.length === 0) {
        return { folder: null, added: 0 }
      }

      const folder = result.filePaths[0]
      const tracks = indexFolder(user.id, folder)
      const added = db.syncLocalTracks(user.id, folder, tracks)
      db.addLocalFolder(user.id, folder)
      // Real durations are filled in the background; the library refreshes
      // as ffprobe reports each one.
      probeMissingDurations(user.id, tracks)
      return { folder, added }
    }
  )

  ipcMain.handle(IPC.localRescan, async (): Promise<{ added: number }> => {
    const user = requireUser()
    let added = 0
    for (const folder of db.getLocalFolders(user.id)) {
      if (!fs.existsSync(folder)) continue // folder moved or removed on disk
      const tracks = indexFolder(user.id, folder)
      added += db.syncLocalTracks(user.id, folder, tracks)
      probeMissingDurations(user.id, tracks)
    }
    return { added }
  })

  ipcMain.handle(IPC.localRemoveFolder, (_e, folder: string) => {
    const user = requireUser()
    db.removeLocalFolder(user.id, String(folder))
  })

  // -------------------------------------------------- settings and tools
  ipcMain.handle(IPC.settingsGet, () => {
    requireUser()
    return db.getSettings()
  })

  ipcMain.handle(IPC.settingsUpdate, (_e, patch) => {
    requireUser()
    return db.updateSettings(patch)
  })

  ipcMain.handle(IPC.toolsStatus, () => getToolStatus())

  ipcMain.handle(IPC.toolsUpdateYtdlp, async (): Promise<string> => {
    requireUser()
    return updateYtDlp()
  })

  // -------------------------------------------------------------- social
  const requireServer = (): { user: User; token: string } => {
    const user = requireUser()
    const acc = db.getServerAccount(user.id) ?? getSocialAccount()
    if (!acc) throw new Error('Not connected to Spinity online — connect in Settings → Friends')
    return { user, token: acc.token }
  }

  ipcMain.handle(IPC.socialStatus, () => {
    const user = currentUser ? db.getServerAccount(currentUser.id) ?? getSocialAccount() : null
    return user ? { connected: true, username: user.username, serverUrl: user.serverUrl } : { connected: false }
  })

  ipcMain.handle(IPC.socialRegister, async (_e, serverUrl: string, username: string, password: string, displayName?: string) => {
    const user = requireUser()
    const acc = await socialRegister(String(serverUrl), String(username), String(password), displayName ? String(displayName) : undefined)
    db.setServerAccount(user.id, acc); setSocialAccount(acc)
    return { serverUserId: acc.serverUserId, username: acc.username }
  })

  ipcMain.handle(IPC.socialLogin, async (_e, serverUrl: string, username: string, password: string) => {
    const user = requireUser()
    const acc = await socialLogin(String(serverUrl), String(username), String(password))
    db.setServerAccount(user.id, acc); setSocialAccount(acc)
    return { serverUserId: acc.serverUserId, username: acc.username }
  })

  ipcMain.handle(IPC.socialConnect, async () => {
    requireServer(); connectSocket(); return { ok: true }
  })

  ipcMain.handle(IPC.socialDisconnect, async () => {
    disconnectSocket()
    if (currentUser) { db.setServerAccount(currentUser.id, null); setSocialAccount(null) }
    return { ok: true }
  })

  ipcMain.handle(IPC.socialMe, async () => { requireServer(); return socialApi.me() })
  ipcMain.handle(IPC.friendsSearch, async (_e, q: string) => { requireServer(); return socialApi.search(String(q)) })
  ipcMain.handle(IPC.friendsRequest, async (_e, toUserId: string, message?: string) => { requireServer(); return socialApi.request(String(toUserId), message ? String(message) : undefined) })
  ipcMain.handle(IPC.friendsRespond, async (_e, requestId: string, accept: boolean) => { requireServer(); return socialApi.respond(String(requestId), Boolean(accept)) })
  ipcMain.handle(IPC.friendsCancel, async (_e, requestId: string) => { requireServer(); return socialApi.cancel(String(requestId)) })
  ipcMain.handle(IPC.friendsList, async () => { requireServer(); return socialApi.friends() })
  ipcMain.handle(IPC.friendsRequests, async () => { requireServer(); return socialApi.requests() })
  ipcMain.handle(IPC.friendsRemove, async (_e, friendId: string) => { requireServer(); return socialApi.remove(String(friendId)) })
  ipcMain.handle(IPC.friendsBlock, async (_e, userId: string) => { requireServer(); return socialApi.block(String(userId)) })
  ipcMain.handle(IPC.friendsUnblock, async (_e, userId: string) => { requireServer(); return socialApi.unblock(String(userId)) })
  ipcMain.handle(IPC.chatConversations, async () => { requireServer(); return socialApi.conversations() })
  ipcMain.handle(IPC.chatMessages, async (_e, conversationId: string, limit?: number) => { requireServer(); return socialApi.messages(String(conversationId), limit) })
  ipcMain.handle(IPC.chatSend, async (_e, payload: { toUserId?: string; conversationId?: string; kind: string; body?: string | null; payload?: unknown }) => { requireServer(); return socialApi.send(payload) })
  ipcMain.handle(IPC.chatRead, async (_e, conversationId: string) => { requireServer(); return socialApi.read(String(conversationId)) })
  ipcMain.handle(IPC.chatTyping, async (_e, toUserId: string, isTyping: boolean) => { socketEmit('chat:typing', { toUserId: String(toUserId), isTyping: Boolean(isTyping) }) })
  ipcMain.handle(IPC.callIce, async () => { requireServer(); try { return await socialApi.ice() } catch { return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } } })
  ipcMain.handle(IPC.callInvite, async (_e, toUserId: string, callId: string) => { socketEmit('call:invite', { toUserId: String(toUserId), callId: String(callId) }) })
  ipcMain.handle(IPC.callAccept, async (_e, toUserId: string, callId: string) => { socketEmit('call:accept', { toUserId: String(toUserId), callId: String(callId) }) })
  ipcMain.handle(IPC.callDecline, async (_e, toUserId: string, callId: string) => { socketEmit('call:decline', { toUserId: String(toUserId), callId: String(callId) }) })
  ipcMain.handle(IPC.callEnd, async (_e, toUserId: string, callId: string) => { socketEmit('call:end', { toUserId: String(toUserId), callId: String(callId) }) })
  ipcMain.handle(IPC.callSignal, async (_e, toUserId: string, callId: string, signal: unknown) => { socketEmit('call:signal', { toUserId: String(toUserId), callId: String(callId), signal }) })
  ipcMain.handle(IPC.partyCreate, async (_e, queue?: unknown[]) => { requireServer(); const r = await socialApi.partyCreate(queue as never); socketEmit('party:join-room', { partyId: r.id }); return r })
  ipcMain.handle(IPC.partyJoin, async (_e, code: string) => { requireServer(); const r = await socialApi.partyJoin(String(code)); socketEmit('party:join-room', { partyId: (r as { id: string }).id }); return r })
  ipcMain.handle(IPC.partyLeave, async (_e, partyId: string) => { requireServer(); socketEmit('party:leave-room', { partyId: String(partyId) }); return socialApi.partyLeave(String(partyId)) })
  ipcMain.handle(IPC.partySync, async (_e, partyId: string, playback: { trackIndex: number; positionMs: number; isPlaying: boolean }) => { socketEmit('party:sync', { partyId: String(partyId), playback }) })
  ipcMain.handle(IPC.partyQueue, async (_e, partyId: string, queue: unknown[]) => { socketEmit('party:queue', { partyId: String(partyId), queue }) })
  ipcMain.handle(IPC.partyGet, async (_e, partyId: string) => { requireServer(); return socialApi.partyGet(String(partyId)) })
}
