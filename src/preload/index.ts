import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  AudioInfo,
  CachedPeaks,
  DownloadJob,
  LibrarySnapshot,
  LyricsResult,
  PhoneServerStatus,
  Playlist,
  SearchResult,
  StreamInfo,
  ToolStatus,
  Track,
  User
} from '../shared/types'

/** Live player snapshot relayed to the mini-player window. */
export interface MiniSnapshot {
  trackId: string | null
  title: string
  artist: string
  art: string
  playing: boolean
  currentTime: number
  duration: number
}

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
  /** Frameless window controls for the custom top bar. */
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized)
  },

  auth: {
    listUsers: (): Promise<User[]> => ipcRenderer.invoke(IPC.authListUsers),
    /** 1.0 cloud account: same email/username on every computer. */
    register: (username: string, email: string, password: string, displayName?: string): Promise<User> =>
      ipcRenderer.invoke(IPC.authRegister, username, email, password, displayName),
    login: (login: string, password: string): Promise<User> =>
      ipcRenderer.invoke(IPC.authLogin, login, password),
    logout: (): Promise<void> => ipcRenderer.invoke(IPC.authLogout),
    current: (): Promise<User | null> => ipcRenderer.invoke(IPC.authCurrent),
    updateDisplayName: (displayName: string): Promise<User> =>
      ipcRenderer.invoke(IPC.authUpdateDisplayName, displayName),
    /** Opens a file picker; resolves the updated user (unchanged on cancel). */
    setAvatar: (): Promise<User> => ipcRenderer.invoke(IPC.authSetAvatar),
    removeAvatar: (): Promise<User> => ipcRenderer.invoke(IPC.authRemoveAvatar)
  },

  library: {
    snapshot: (): Promise<LibrarySnapshot> => ipcRenderer.invoke(IPC.librarySnapshot),
    addTrack: (track: Track): Promise<void> => ipcRenderer.invoke(IPC.libraryAddTrack, track),
    removeTrack: (trackId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.libraryRemoveTrack, trackId),
    revealFile: (trackId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.libraryRevealFile, trackId),
    toggleLike: (trackId: string, meta?: SearchResult): Promise<boolean> =>
      ipcRenderer.invoke(IPC.libraryToggleLike, trackId, meta)
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
    addTrack: (playlistId: string, trackId: string, meta?: SearchResult): Promise<void> =>
      ipcRenderer.invoke(IPC.playlistAddTrack, playlistId, trackId, meta),
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
    updateYtDlp: (): Promise<string> => ipcRenderer.invoke(IPC.toolsUpdateYtdlp),
    installYtDlp: (): Promise<string> => ipcRenderer.invoke(IPC.toolsInstallYtdlp),
    installFfmpeg: (): Promise<string> => ipcRenderer.invoke(IPC.toolsInstallFfmpeg),
    pythonStatus: (): Promise<{ path: string | null; version: string | null }> => ipcRenderer.invoke(IPC.toolsPythonStatus),
    installPythonDeps: (): Promise<string> => ipcRenderer.invoke(IPC.toolsInstallPythonDeps)
  },

  updater: {
    getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.updaterGetVersion),
    check: (): Promise<{ status: string; message: string; version?: string }> => ipcRenderer.invoke(IPC.updaterCheck),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke(IPC.updaterQuitAndInstall)
  },

  notify: {
    /** Settings "send a test" — ok:false + reason when the OS refuses the toast. */
    test: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.notifyTest)
  },

  /** Chat image attachments (5 MB, auto-delete in 3 days unless pinned). */
  images: {
    send: (payload: { toUserId?: string; conversationId?: string; dataUrl: string }): Promise<{ imageId: string; conversationId: string; expiresAt: string }> =>
      ipcRenderer.invoke(IPC.imageSend, payload),
    pin: (imageId: string, pinned: boolean): Promise<{ imageId: string; pinned: boolean; expiresAt: string | null }> =>
      ipcRenderer.invoke(IPC.imagePin, imageId, pinned),
    /** Opens a Save dialog; resolves the path or null on cancel. */
    save: (imageId: string): Promise<string | null> => ipcRenderer.invoke(IPC.imageSave, imageId)
  },

  /** Discord Rich Presence: push playback snapshots (main throttles + gates). */
  presence: {
    update: (snap: { title: string; artist: string; durationSec: number; positionSec: number; playing: boolean }): Promise<void> =>
      ipcRenderer.invoke(IPC.presenceUpdate, snap)
  },

  /** ffprobe codec tag for the player bar (null when unavailable). */
  audio: {
    probe: (trackId: string): Promise<AudioInfo | null> => ipcRenderer.invoke(IPC.audioProbe, trackId)
  },

  /**
   * Lyrics: uploads first, then a `.lrc` sidecar, then an automatic lrclib
   * match. Tracks with meaningless names (local `1.mp3`) are never searched —
   * `canFetch` is false and the panel offers a manual upload instead.
   */
  lyrics: {
    get: (trackId: string): Promise<LyricsResult | null> => ipcRenderer.invoke(IPC.lyricsGet, trackId),
    /** Native open dialog for a .lrc/.txt file; null when the user cancels. */
    upload: (trackId: string): Promise<LyricsResult | null> => ipcRenderer.invoke(IPC.lyricsUpload, trackId),
    /** Save lyrics pasted into the panel. */
    set: (trackId: string, text: string): Promise<LyricsResult> => ipcRenderer.invoke(IPC.lyricsSet, trackId, text),
    /**
     * Fine-tune timing: shift by milliseconds (positive = later) and/or set a
     * speed fit. `null` returns the track to the automatic fit.
     */
    sync: (
      trackId: string,
      patch: { offsetMs?: number | null; scale?: number | null } | null
    ): Promise<LyricsResult | null> => ipcRenderer.invoke(IPC.lyricsSync, trackId, patch),
    /** Forget cached/uploaded lyrics for a track (disk .lrc files are untouched). */
    clear: (trackId: string): Promise<boolean> => ipcRenderer.invoke(IPC.lyricsClear, trackId),
    /** Drop the cached automatic match and look the song up again. */
    rematch: (trackId: string): Promise<LyricsResult | null> => ipcRenderer.invoke(IPC.lyricsRematch, trackId),
    /**
     * Align the lyrics to the file itself: the duration fit, then the timed
     * captions of the YouTube video that matches this recording.
     */
    align: (trackId: string): Promise<LyricsResult | null> => ipcRenderer.invoke(IPC.lyricsAlign, trackId)
  },

  /**
   * Optional AI assistance (NVIDIA NIM). The key never leaves the main process;
   * the renderer only ever sees whether it is configured and how fast it is.
   */
  ai: {
    status: (): Promise<{ configured: boolean; model: string; calls: number; lastMs: number | null; lastError: string | null }> =>
      ipcRenderer.invoke(IPC.aiStatus),
    /** One tiny round trip; the Settings "Test" button. */
    test: (): Promise<{ ok: boolean; ms: number; model: string; answer: string; error?: string }> =>
      ipcRenderer.invoke(IPC.aiTest),
    /** Forget every name the model has learned (they are cached per track). */
    forget: (): Promise<number> => ipcRenderer.invoke(IPC.aiForget)
  },

  /** Waveform peaks cache (computed in the renderer, stored in main). */
  wave: {
    get: (trackId: string): Promise<CachedPeaks | null> => ipcRenderer.invoke(IPC.wavePeaksGet, trackId),
    set: (trackId: string, peaks: { duration: number; peaks: number[] }): Promise<void> =>
      ipcRenderer.invoke(IPC.wavePeaksSet, trackId, peaks)
  },

  /** Mini-player widget window. */
  mini: {
    toggle: (): Promise<boolean> => ipcRenderer.invoke(IPC.miniToggle),
    /** Main window → main: live snapshot, relayed to the mini window. */
    sync: (snapshot: MiniSnapshot): Promise<void> => ipcRenderer.invoke(IPC.miniSync, snapshot),
    /** Mini window → main → main window: transport command (+ optional value). */
    cmd: (action: string, value?: number): Promise<void> => ipcRenderer.invoke(IPC.miniCmd, action, value)
  },

  /** LAN web player server that phones on the same Wi-Fi open. */
  phone: {
    status: (): Promise<PhoneServerStatus> => ipcRenderer.invoke(IPC.phoneStatus),
    start: (): Promise<PhoneServerStatus> => ipcRenderer.invoke(IPC.phoneStart),
    stop: (): Promise<PhoneServerStatus> => ipcRenderer.invoke(IPC.phoneStop),
    /** PNG data URL of the QR for the phone URL; empty string without a LAN. */
    qr: (): Promise<string> => ipcRenderer.invoke(IPC.phoneQr)
  },

  social: {
    status: (): Promise<{ connected: boolean; username?: string; serverUrl?: string }> => ipcRenderer.invoke(IPC.socialStatus),
    setStatus: (status: 'online' | 'dnd' | 'invisible'): Promise<{ status: string; statusPref: string }> =>
      ipcRenderer.invoke(IPC.socialSetStatus, status),
    register: (serverUrl: string, username: string, password: string, displayName?: string): Promise<{ serverUserId: string; username: string }> =>
      ipcRenderer.invoke(IPC.socialRegister, serverUrl, username, password, displayName),
    login: (serverUrl: string, username: string, password: string): Promise<{ serverUserId: string; username: string }> =>
      ipcRenderer.invoke(IPC.socialLogin, serverUrl, username, password),
    connect: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.socialConnect),
    disconnect: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.socialDisconnect),
    me: (): Promise<{ id: string; username: string; displayName: string; email?: string | null; status?: string; statusPref?: string }> => ipcRenderer.invoke(IPC.socialMe),
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
    deleteMessage: (messageId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.chatDelete, messageId),
    read: (conversationId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.chatRead, conversationId),
    /** Tell main which conversation is open (null = none) for smart toasts. */
    focus: (conversationId: string | null): Promise<void> => ipcRenderer.invoke(IPC.chatFocus, conversationId),
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
    partyGet: (partyId: string): Promise<unknown> => ipcRenderer.invoke(IPC.partyGet, partyId),
    partyActive: (): Promise<{ party: unknown | null }> => ipcRenderer.invoke(IPC.partyActive)
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
    },
    onUpdater: (cb: (evt: { type: string; data?: unknown }) => void): (() => void) => {
      const handler = (_e: unknown, evt: { type: string; data?: unknown }): void => cb(evt)
      ipcRenderer.on(IPC.evtUpdater, handler)
      return () => ipcRenderer.removeListener(IPC.evtUpdater, handler)
    },
    onMaximizeChanged: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_e: unknown, payload: { maximized: boolean }): void => cb(payload.maximized)
      ipcRenderer.on(IPC.evtMaximizeChanged, handler)
      return () => ipcRenderer.removeListener(IPC.evtMaximizeChanged, handler)
    },
    /** A desktop notification (message/call/party invite) was clicked. */
    onNotifyClick: (cb: (click: { kind: string; conversationId?: string; code?: string }) => void): (() => void) => {
      const handler = (_e: unknown, click: { kind: string; conversationId?: string; code?: string }): void => cb(click)
      ipcRenderer.on(IPC.evtNotifyClick, handler)
      return () => ipcRenderer.removeListener(IPC.evtNotifyClick, handler)
    },
    /**
     * A borrowed cover finished downloading for a local track, so any tile
     * still showing the placeholder should ask for its artwork again.
     */
    onArtworkReady: (cb: (payload: { trackId: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { trackId: string }): void => cb(payload)
      ipcRenderer.on(IPC.evtArtworkReady, handler)
      return () => ipcRenderer.removeListener(IPC.evtArtworkReady, handler)
    },
    /** Mini window: live player snapshot from the main window. */
    onMiniState: (cb: (snapshot: MiniSnapshot) => void): (() => void) => {
      const handler = (_e: unknown, snapshot: MiniSnapshot): void => cb(snapshot)
      ipcRenderer.on(IPC.evtMiniState, handler)
      return () => ipcRenderer.removeListener(IPC.evtMiniState, handler)
    },
    /** Main window: transport command from the mini window. */
    onMiniCmd: (cb: (action: string, value?: number) => void): (() => void) => {
      const handler = (_e: unknown, action: string, value?: number): void => cb(action, value)
      ipcRenderer.on(IPC.evtMiniCmd, handler)
      return () => ipcRenderer.removeListener(IPC.evtMiniCmd, handler)
    }
  }
}

export type SpinityApi = typeof api

contextBridge.exposeInMainWorld('spinity', api)
