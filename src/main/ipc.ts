import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../shared/ipc'
import { artworkUrl } from '../shared/thumbs'
import { db } from './db'
import { downloads, getToolStatus, resolveStreamUrl, search, updateYtDlp, installYtDlp, installFfmpeg, getPythonStatus, installPythonDeps } from './ytdlp'
import { indexFolder, probeMissingDurations } from './localFiles'
import { warmArtwork } from './artworkWarm'
import { socialApi, setSocialAccount, getSocialAccount, connectSocket, disconnectSocket, socketEmit, socialLogin, socialRegister, setSocialBroadcast, setSelfStatus, CLOUD_URL } from './social'
import { applyLoginItem } from './startup'
import { reconfigurePresence, updatePresence, type PresenceSnapshot } from './presence'
import { setFocusedConversation, testNotification } from './notify'
import { toggleMiniWindow, pushMiniState, forwardMiniCmd } from './mini'
import { phoneStatus, phoneQr, startPhoneServer, stopPhoneServer } from './phoneServer'
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
let trackCache: { arr: Track[]; byId: Map<string, Track> } | null = null
function trackById(trackId: string): Track | null {
  if (!currentUser) return null
  const arr = db.getTracks(currentUser.id)
  if (!trackCache || trackCache.arr !== arr) {
    trackCache = { arr, byId: new Map(arr.map((t) => [t.id, t])) }
  }
  return trackCache.byId.get(trackId) ?? null
}

export function filePathForTrack(trackId: string): string | null {
  return trackById(trackId)?.filePath ?? null
}

/** The full record for a track id, for callers that need its title/artist. */
export function trackForId(trackId: string): Track | null {
  return trackById(trackId)
}

function snapshot(): LibrarySnapshot {
  const user = requireUser()
  const tracks = db.getTracks(user.id)
  const playlists = db.getPlaylists(user.id)
  const likedIds = db.getLikedIds(user.id)
  // Only ship metadata the UI can actually reference (likes + playlist rows).
  const wanted = new Set<string>(likedIds)
  for (const p of playlists) for (const id of p.trackIds) wanted.add(id)
  const owned = new Set(tracks.map((t) => t.id))
  const missing = [...wanted].filter((id) => !owned.has(id))
  return {
    user,
    tracks: tracks.map((track) => track.source === 'local'
      ? { ...track, thumbnail: artworkUrl(track.id) }
      : track),
    playlists,
    likedIds,
    meta: db.getMetas(user.id, missing),
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
  // --------------------------------------------------- window chrome
  const focusedWindow = (): BrowserWindow | null =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

  ipcMain.handle(IPC.windowMinimize, () => {
    focusedWindow()?.minimize()
  })
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    const win = focusedWindow()
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle(IPC.windowClose, () => {
    focusedWindow()?.close()
  })
  ipcMain.handle(IPC.windowIsMaximized, (): boolean => {
    return focusedWindow()?.isMaximized() ?? false
  })

  // ------------------------------------------------------------- accounts
  // 1.0: one cloud login. Local profiles are just per-device music buckets
  // linked to the server account — same email/username on every computer.
  ipcMain.handle(IPC.authListUsers, (): User[] => db.listUsers())

  async function finishCloudAuth(acc: { serverUserId: string; username: string; token: string; serverUrl: string }, displayName?: string): Promise<User> {
    const me = await socialApi.me().catch(() => null)
    const user = db.adoptCloudUser(acc.serverUserId, acc.username, displayName ?? me?.displayName ?? acc.username)
    currentUser = user
    db.setSession(user.id)
    db.setServerAccount(user.id, acc)
    setSocialAccount(acc)
    setSelfStatus(me?.status ?? 'online')
    return user
  }

  ipcMain.handle(
    IPC.authRegister,
    async (_e, username: string, email: string, password: string, displayName?: string) => {
      const acc = await socialRegister(CLOUD_URL, String(username), String(password), displayName ? String(displayName) : undefined, String(email))
      return finishCloudAuth(acc, displayName ? String(displayName) : undefined)
    }
  )

  ipcMain.handle(
    IPC.authLogin,
    async (_e, login: string, password: string) => {
      const acc = await socialLogin(CLOUD_URL, String(login), String(password))
      return finishCloudAuth(acc)
    }
  )

  ipcMain.handle(IPC.authLogout, () => {
    disconnectSocket()
    if (currentUser) db.setServerAccount(currentUser.id, null)
    setSocialAccount(null)
    signOut()
    // Signing out forgets the remembered account, so the next launch asks
    // for credentials again.
    db.setSession(null)
  })

  ipcMain.handle(IPC.authCurrent, (): User | null => currentUser)

  ipcMain.handle(IPC.authUpdateDisplayName, (_e, displayName: string): User => {
    const user = requireUser()
    const updated = db.renameUser(user.id, String(displayName ?? ''))
    currentUser = updated
    // Mirror to the cloud profile (best-effort: offline keeps the local name).
    void socialApi.updateProfile(updated.displayName).catch(() => {})
    return updated
  })

  ipcMain.handle(IPC.authSetAvatar, async (): Promise<User> => {
    const user = requireUser()
    const opts = {
      title: 'Choose a profile picture',
      properties: ['openFile'] as ('openFile')[],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    }
    const focused = BrowserWindow.getFocusedWindow()
    const result = focused ? await dialog.showOpenDialog(focused, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return user
    const src = result.filePaths[0]
    const stat = fs.statSync(src)
    if (stat.size > 5 * 1024 * 1024) throw new Error('Image is too big (max 5 MB)')
    const ext = path.extname(src).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      throw new Error('Pick a PNG, JPG, GIF or WebP image')
    }
    const dest = path.join(db.avatarDir(), `${user.id}${ext}`)
    // Remove a previous avatar with a different extension.
    const prev = db.getAvatarPath(user.id)
    if (prev && prev !== dest) {
      try { fs.rmSync(prev, { force: true }) } catch {}
    }
    fs.copyFileSync(src, dest)
    const updated = db.setAvatarPath(user.id, dest)
    currentUser = updated
    return updated
  })

  ipcMain.handle(IPC.authRemoveAvatar, (): User => {
    const user = requireUser()
    const prev = db.getAvatarPath(user.id)
    if (prev) {
      try { fs.rmSync(prev, { force: true }) } catch {}
    }
    const updated = db.setAvatarPath(user.id, null)
    currentUser = updated
    return updated
  })

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

  ipcMain.handle(IPC.libraryToggleLike, (_e, trackId: string, meta?: SearchResult): boolean => {
    const user = requireUser()
    return db.toggleLike(user.id, String(trackId), meta as SearchResult | undefined)
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

  ipcMain.handle(IPC.playlistAddTrack, (_e, playlistId: string, trackId: string, meta?: SearchResult) => {
    const user = requireUser()
    db.addToPlaylist(user.id, playlistId, trackId)
    if (meta && (meta as SearchResult).id === String(trackId)) db.saveMeta(user.id, meta as SearchResult)
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
      // Artwork is warmed too: extraction and cover lookups happen off the
      // request path, so tiles paint from cache instead of waiting on ffmpeg.
      warmArtwork(tracks)
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
      warmArtwork(tracks)
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
    const next = db.updateSettings(patch)
    // OS-level side effects follow the stored settings immediately.
    applyLoginItem()
    void reconfigurePresence()
    return next
  })

  // -------------------------------------------------- discord rich presence
  ipcMain.handle(IPC.presenceUpdate, (_e, snap: PresenceSnapshot) => {
    if (!currentUser) return
    void updatePresence(snap)
  })

  ipcMain.handle(IPC.toolsStatus, () => getToolStatus())

  ipcMain.handle(IPC.toolsUpdateYtdlp, async (): Promise<string> => {
    requireUser()
    return updateYtDlp()
  })

  ipcMain.handle(IPC.toolsInstallYtdlp, async (): Promise<string> => {
    requireUser()
    return installYtDlp()
  })

  ipcMain.handle(IPC.toolsInstallFfmpeg, async (): Promise<string> => {
    requireUser()
    return installFfmpeg()
  })

  ipcMain.handle(IPC.toolsPythonStatus, async () => {
    requireUser()
    return getPythonStatus()
  })

  ipcMain.handle(IPC.toolsInstallPythonDeps, async (): Promise<string> => {
    requireUser()
    return installPythonDeps()
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
  ipcMain.handle(IPC.chatDelete, async (_e, messageId: string) => { requireServer(); return socialApi.deleteMessage(String(messageId)) })
  ipcMain.handle(IPC.chatRead, async (_e, conversationId: string) => { requireServer(); return socialApi.read(String(conversationId)) })
  ipcMain.handle(IPC.chatFocus, (_e, conversationId: string | null) => {
    setFocusedConversation(typeof conversationId === 'string' && conversationId ? conversationId : null)
  })
  ipcMain.handle(IPC.notifyTest, () => testNotification())
  ipcMain.handle(IPC.socialSetStatus, async (_e, status: 'online' | 'dnd' | 'invisible') => {
    requireServer()
    const s = String(status)
    if (s !== 'online' && s !== 'dnd' && s !== 'invisible') throw new Error('Unknown status')
    const r = await socialApi.setStatus(s as 'online' | 'dnd' | 'invisible')
    setSelfStatus(r.status)
    return r
  })
  ipcMain.handle(IPC.imageSend, async (_e, payload: { toUserId?: string; conversationId?: string; dataUrl: string }) => {
    requireServer()
    const dataUrl = String(payload.dataUrl ?? '')
    // ~6.9M chars ≈ 5MB binary. Reject early before the upload.
    if (dataUrl.length > 7_200_000) throw new Error('Image is too big (max 5 MB)')
    return socialApi.uploadImage({ toUserId: payload.toUserId, conversationId: payload.conversationId, dataUrl })
  })
  ipcMain.handle(IPC.imagePin, async (_e, imageId: string, pinned: boolean) => {
    requireServer()
    return socialApi.pinImage(String(imageId), Boolean(pinned))
  })
  ipcMain.handle(IPC.imageSave, async (_e, imageId: string): Promise<string | null> => {
    requireServer()
    const acc = getSocialAccount() ?? (currentUser ? db.getServerAccount(currentUser.id) : null)
    if (!acc) throw new Error('Not connected')
    const res = await fetch(`${acc.serverUrl.replace(/\/$/, '')}/api/images/${encodeURIComponent(String(imageId))}`, {
      headers: { Authorization: `Bearer ${acc.token}` }
    })
    if (res.status === 410) throw new Error('This image auto-deleted after 3 days')
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') ?? 'image/png'
    const ext = ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'png'
    const saveOpts = {
      title: 'Save image',
      defaultPath: `spinity-image.${ext}`,
      filters: [{ name: 'Images', extensions: [ext] }]
    }
    const win = BrowserWindow.getFocusedWindow()
    const picked = win
      ? await dialog.showSaveDialog(win, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (picked.canceled || !picked.filePath) return null
    await fs.promises.writeFile(picked.filePath, buf)
    return picked.filePath
  })
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
  ipcMain.handle(IPC.partyActive, async () => { requireServer(); return socialApi.partyActive() })

  // -------------------------------------------------------------- updater
  ipcMain.handle(IPC.updaterGetVersion, () => app.getVersion())
  ipcMain.handle(IPC.updaterCheck, async () => {
    if (!app.isPackaged) return { status: 'dev', message: 'Updates only work in the installed app (setup.exe), not in dev mode.' }
    try {
      const res = await autoUpdater.checkForUpdates()
      if (!res?.updateInfo) return { status: 'no-update', message: 'You are on the latest version.' }
      // checkForUpdates already triggers events; this return is for immediate feedback
      return { status: 'available', message: `Update ${res.updateInfo.version} available — downloading...`, version: res.updateInfo.version }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('No published versions') || msg.includes('latest.yml')) return { status: 'no-update', message: 'You are on the latest version.' }
      throw new Error(msg)
    }
  })
  ipcMain.handle(IPC.updaterQuitAndInstall, () => {
    autoUpdater.quitAndInstall()
  })

  // ------------------------------------------------- audio intelligence
  ipcMain.handle(IPC.audioProbe, async (_e, trackId: string) => {
    if (!currentUser) return null
    const file = filePathForTrack(String(trackId))
    if (!file) return null
    const { probeAudio } = await import('./audioInfo')
    return probeAudio(file)
  })

  ipcMain.handle(IPC.lyricsGet, async (_e, trackId: string) => {
    if (!currentUser) return null
    const { getLyrics } = await import('./lyrics')
    return getLyrics(String(trackId))
  })

  /** Pick a `.lrc`/`.txt` file for this track; the picker lives in main. */
  ipcMain.handle(IPC.lyricsUpload, async (_e, trackId: string) => {
    if (!currentUser) throw new Error('Not signed in')
    const id = String(trackId)
    const opts = {
      title: 'Choose a lyrics file',
      properties: ['openFile'] as ('openFile')[],
      filters: [
        { name: 'Lyrics', extensions: ['lrc', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const focused = BrowserWindow.getFocusedWindow()
    const picked = focused
      ? await dialog.showOpenDialog(focused, opts)
      : await dialog.showOpenDialog(opts)
    if (picked.canceled || picked.filePaths.length === 0) return null
    const { setUserLyrics } = await import('./lyrics')
    // Lyrics files are text; utf8 covers the common case and a latin1 retry
    // rescues the legacy ANSI files floating around in old music folders.
    let text = ''
    try {
      text = fs.readFileSync(picked.filePaths[0], 'utf8')
    } catch {
      text = fs.readFileSync(picked.filePaths[0], 'latin1')
    }
    return setUserLyrics(id, text)
  })

  /** Lyrics the user pasted into the panel. */
  ipcMain.handle(IPC.lyricsSet, async (_e, trackId: string, text: string) => {
    if (!currentUser) throw new Error('Not signed in')
    const { setUserLyrics } = await import('./lyrics')
    return setUserLyrics(String(trackId), String(text ?? ''))
  })

  /** Timing fine-tune: `null` clears it back to the automatic fit. */
  ipcMain.handle(IPC.lyricsSync, async (_e, trackId: string, patch: unknown) => {
    if (!currentUser) return null
    const { setLyricSync } = await import('./lyrics')
    const input = patch as { offsetMs?: number | null; scale?: number | null } | null
    const clean = input
      ? {
          offsetMs: typeof input.offsetMs === 'number' ? input.offsetMs : null,
          scale: typeof input.scale === 'number' ? input.scale : null
        }
      : null
    return setLyricSync(String(trackId), clean)
  })

  ipcMain.handle(IPC.lyricsClear, async (_e, trackId: string): Promise<boolean> => {
    if (!currentUser) return false
    const { clearLyrics } = await import('./lyrics')
    clearLyrics(String(trackId))
    return true
  })

  /** "Match again": drop the automatic cache and re-run the lookup. */
  ipcMain.handle(IPC.lyricsRematch, async (_e, trackId: string) => {
    if (!currentUser) return null
    const { rematchLyrics } = await import('./lyrics')
    return rematchLyrics(String(trackId))
  })

  /** Align the lyrics to this exact recording (captions of the matching video). */
  ipcMain.handle(IPC.lyricsAlign, async (_e, trackId: string) => {
    if (!currentUser) return null
    const { alignTrackLyrics } = await import('./lyrics')
    return alignTrackLyrics(String(trackId))
  })

  // ------------------------------------------------- AI lyrics assistance
  ipcMain.handle(IPC.aiStatus, async () => {
    const { aiStatus } = await import('./ai')
    return aiStatus()
  })

  ipcMain.handle(IPC.aiTest, async () => {
    requireUser()
    const { testConnection } = await import('./ai')
    return testConnection()
  })

  ipcMain.handle(IPC.aiForget, async (): Promise<number> => {
    requireUser()
    return db.clearAiCache()
  })

  ipcMain.handle(IPC.wavePeaksGet, (_e, trackId: string) => {
    if (!currentUser) return null
    return db.getWavePeaks(String(trackId))
  })

  ipcMain.handle(
    IPC.wavePeaksSet,
    (_e, trackId: string, peaks: { duration: number; peaks: number[] }) => {
      if (!currentUser) return
      const list = Array.isArray(peaks?.peaks) ? peaks.peaks.slice(0, 400).map(Number).filter((n) => Number.isFinite(n)) : []
      if (list.length === 0) return
      db.setWavePeaks(String(trackId), { duration: Number(peaks.duration) || 0, peaks: list, updatedAt: Date.now() })
    }
  )

  // ------------------------------------------------- mini-player
  ipcMain.handle(IPC.miniToggle, () => toggleMiniWindow())

  ipcMain.handle(IPC.miniSync, (_e, snapshot: unknown) => {
    pushMiniState(snapshot)
  })

  ipcMain.handle(IPC.miniCmd, (_e, action: string, value?: number) => {
    forwardMiniCmd({ action: String(action), value: typeof value === 'number' ? value : undefined })
  })

  // ------------------------------------------------- phone web player
  ipcMain.handle(IPC.phoneStatus, () => phoneStatus())
  ipcMain.handle(IPC.phoneStart, () => startPhoneServer())
  ipcMain.handle(IPC.phoneStop, () => stopPhoneServer())
  ipcMain.handle(IPC.phoneQr, () => phoneQr())
}
