import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  DownloadJob,
  LibrarySnapshot,
  Playlist,
  SearchResult,
  StreamInfo,
  ToolStatus,
  Track,
  User
} from '../shared/types'

/**
 * The ONLY surface the renderer can reach. `nodeIntegration` is off and
 * `contextIsolation` is on, so the UI has no access to `fs`, `child_process`
 * or `ipcRenderer` directly — every privileged action goes through an
 * explicitly named method here.
 *
 * Each call returns a plain serialisable object; errors thrown in main are
 * rethrown in the renderer by Electron's `invoke` contract.
 */
const api = {
  auth: {
    listUsers: (): Promise<User[]> => ipcRenderer.invoke(IPC.authListUsers),
    /** `remember` defaults to true in main; pass false explicitly to opt out. */
    register: (
      username: string,
      password: string,
      displayName?: string,
      remember?: boolean
    ): Promise<User> =>
      ipcRenderer.invoke(IPC.authRegister, username, password, displayName, remember),
    login: (username: string, password: string, remember?: boolean): Promise<User> =>
      ipcRenderer.invoke(IPC.authLogin, username, password, remember),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.authLogout),
    current: (): Promise<User | null> => ipcRenderer.invoke(IPC.authCurrent)
  },

  library: {
    snapshot: (): Promise<LibrarySnapshot> => ipcRenderer.invoke(IPC.librarySnapshot),
    addTrack: (track: Track): Promise<void> => ipcRenderer.invoke(IPC.libraryAddTrack, track),
    removeTrack: (trackId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.libraryRemoveTrack, trackId),
    revealFile: (trackId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.libraryRevealFile, trackId)
  },

  /**
   * Local music folders. Files are indexed in place and never copied, moved
   * or modified; removing a folder only makes Spinity forget it.
   */
  local: {
    /** Opens a native folder picker. `folder` is null when the user cancels. */
    addFolder: (): Promise<{ folder: string | null; added: number }> =>
      ipcRenderer.invoke(IPC.localAddFolder),
    /** Re-scan every registered folder for new, moved or removed files. */
    rescan: (): Promise<{ added: number }> => ipcRenderer.invoke(IPC.localRescan),
    /** Forget a folder and its indexed tracks; files on disk are untouched. */
    removeFolder: (folder: string): Promise<void> =>
      ipcRenderer.invoke(IPC.localRemoveFolder, folder)
  },

  playlists: {
    create: (name: string): Promise<Playlist> => ipcRenderer.invoke(IPC.playlistCreate, name),
    rename: (playlistId: string, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.playlistRename, playlistId, name),
    remove: (playlistId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.playlistDelete, playlistId),
    addTrack: (playlistId: string, trackId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.playlistAddTrack, playlistId, trackId),
    removeTrack: (playlistId: string, trackId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.playlistRemoveTrack, playlistId, trackId)
  },

  youtube: {
    search: (query: string, limit?: number): Promise<SearchResult[]> =>
      ipcRenderer.invoke(IPC.youtubeSearch, query, limit),
    /** Resolve a direct stream URL for a video id. */
    stream: (videoId: string): Promise<StreamInfo> =>
      ipcRenderer.invoke(IPC.youtubeStream, videoId)
  },

  downloads: {
    start: (result: SearchResult): Promise<DownloadJob> =>
      ipcRenderer.invoke(IPC.downloadStart, result),
    cancel: (jobId: string): Promise<void> => ipcRenderer.invoke(IPC.downloadCancel, jobId),
    list: (): Promise<DownloadJob[]> => ipcRenderer.invoke(IPC.downloadList)
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },

  tools: {
    status: (): Promise<ToolStatus> => ipcRenderer.invoke(IPC.toolsStatus),
    updateYtDlp: (): Promise<string> => ipcRenderer.invoke(IPC.toolsUpdateYtdlp)
  },

  social: {
    status: (): Promise<{ connected: boolean; username?: string; serverUrl?: string }> => ipcRenderer.invoke(IPC.socialStatus),
    register: (serverUrl: string, username: string, password: string, displayName?: string): Promise<{ serverUserId: string; username: string }> =>
      ipcRenderer.invoke(IPC.socialRegister, serverUrl, username, password, displayName),
    login: (serverUrl: string, username: string, password: string): Promise<{ serverUserId: string; username: string }> =>
      ipcRenderer.invoke(IPC.socialLogin, serverUrl, username, password),
    connect: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.socialConnect),
    disconnect: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.socialDisconnect),
    me: (): Promise<{ id: string; username: string; displayName: string }> => ipcRenderer.invoke(IPC.socialMe),
    search: (q: string): Promise<{ id: string; username: string; displayName: string; status?: string }[]> => ipcRenderer.invoke(IPC.friendsSearch, q),
    request: (toUserId: string, message?: string): Promise<{ id: string }> => ipcRenderer.invoke(IPC.friendsRequest, toUserId, message),
    respond: (requestId: string, accept: boolean): Promise<{ status: string }> => ipcRenderer.invoke(IPC.friendsRespond, requestId, accept),
    cancel: (requestId: string): Promise<{ status: string }> => ipcRenderer.invoke(IPC.friendsCancel, requestId),
    friends: (): Promise<{ id: string; username: string; displayName: string; status?: string }[]> => ipcRenderer.invoke(IPC.friendsList),
    requests: (): Promise<{ incoming: { id: string; from: { _id: string; username: string; displayName: string } }[]; outgoing: { id: string; to: { _id: string; username: string; displayName: string } }[] }> => ipcRenderer.invoke(IPC.friendsRequests),
    remove: (friendId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.friendsRemove, friendId),
    block: (userId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.friendsBlock, userId),
    unblock: (userId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.friendsUnblock, userId),
    conversations: (): Promise<{ id: string; otherId: string; lastMessagePreview: string | null; unread: number }[]> => ipcRenderer.invoke(IPC.chatConversations),
    messages: (conversationId: string, limit?: number): Promise<{ id: string; conversationId: string; senderId: string; kind: string; body: string | null; payload: unknown; createdAt: string }[]> => ipcRenderer.invoke(IPC.chatMessages, conversationId, limit),
    send: (payload: { toUserId?: string; conversationId?: string; kind: string; body?: string | null; payload?: unknown }): Promise<{ id: string; conversationId: string }> => ipcRenderer.invoke(IPC.chatSend, payload),
    read: (conversationId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.chatRead, conversationId),
    typing: (toUserId: string, isTyping: boolean): Promise<void> => ipcRenderer.invoke(IPC.chatTyping, toUserId, isTyping),
    ice: (): Promise<{ iceServers: { urls: string | string[] }[] }> => ipcRenderer.invoke(IPC.callIce),
    callInvite: (toUserId: string, callId: string): Promise<void> => ipcRenderer.invoke(IPC.callInvite, toUserId, callId),
    callAccept: (toUserId: string, callId: string): Promise<void> => ipcRenderer.invoke(IPC.callAccept, toUserId, callId),
    callDecline: (toUserId: string, callId: string): Promise<void> => ipcRenderer.invoke(IPC.callDecline, toUserId, callId),
    callEnd: (toUserId: string, callId: string): Promise<void> => ipcRenderer.invoke(IPC.callEnd, toUserId, callId),
    callSignal: (toUserId: string, callId: string, signal: unknown): Promise<void> => ipcRenderer.invoke(IPC.callSignal, toUserId, callId, signal),
    partyCreate: (queue?: unknown[]): Promise<{ id: string; code: string }> => ipcRenderer.invoke(IPC.partyCreate, queue),
    partyJoin: (code: string): Promise<{ id: string; code: string }> => ipcRenderer.invoke(IPC.partyJoin, code),
    partyLeave: (partyId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.partyLeave, partyId),
    partySync: (partyId: string, playback: { trackIndex: number; positionMs: number; isPlaying: boolean }): Promise<void> => ipcRenderer.invoke(IPC.partySync, partyId, playback),
    partyQueue: (partyId: string, queue: unknown[]): Promise<void> => ipcRenderer.invoke(IPC.partyQueue, partyId, queue),
    partyGet: (partyId: string): Promise<unknown> => ipcRenderer.invoke(IPC.partyGet, partyId)
  },

  /** Main-process push events. Each returns an unsubscribe function. */
  events: {
    onDownloadUpdated: (cb: (job: DownloadJob) => void): (() => void) => {
      const handler = (_e: unknown, job: DownloadJob): void => cb(job)
      ipcRenderer.on(IPC.evtDownloadUpdated, handler)
      return () => ipcRenderer.removeListener(IPC.evtDownloadUpdated, handler)
    },
    onSocial: (cb: (evt: { type: string; payload: unknown }) => void): (() => void) => {
      const handler = (_e: unknown, evt: { type: string; payload: unknown }): void => cb(evt)
      ipcRenderer.on(IPC.evtSocial, handler)
      return () => ipcRenderer.removeListener(IPC.evtSocial, handler)
    }
  }
}

export type SpinityApi = typeof api

contextBridge.exposeInMainWorld('spinity', api)
