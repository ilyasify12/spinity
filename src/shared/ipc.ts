/**
 * Canonical IPC channel names. Imported by main, preload and renderer so a
 * typo becomes a compile error rather than a silent no-op at runtime.
 */
export const IPC = {
  // accounts
  authListUsers: 'auth:list-users',
  authRegister: 'auth:register',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authCurrent: 'auth:current',
  authUpdateDisplayName: 'auth:update-display-name',
  authSetAvatar: 'auth:set-avatar',
  authRemoveAvatar: 'auth:remove-avatar',

  // window chrome (frameless custom top bar)
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',

  // library
  librarySnapshot: 'library:snapshot',
  libraryAddTrack: 'library:add-track',
  libraryRemoveTrack: 'library:remove-track',
  libraryRevealFile: 'library:reveal-file',
  libraryToggleLike: 'library:toggle-like',

  // playlists
  playlistCreate: 'playlist:create',
  playlistRename: 'playlist:rename',
  playlistDelete: 'playlist:delete',
  playlistAddTrack: 'playlist:add-track',
  playlistRemoveTrack: 'playlist:remove-track',

  // search + download
  youtubeSearch: 'youtube:search',
  /** Resolve a direct stream URL for a video id (no download). */
  youtubeStream: 'youtube:stream',
  downloadStart: 'download:start',
  downloadCancel: 'download:cancel',
  downloadList: 'download:list',

  // local music folders
  localAddFolder: 'local:add-folder',
  localRescan: 'local:rescan',
  localRemoveFolder: 'local:remove-folder',

  // settings + tools
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  toolsStatus: 'tools:status',
  toolsUpdateYtdlp: 'tools:update-ytdlp',
  toolsInstallYtdlp: 'tools:install-ytdlp',
  toolsInstallFfmpeg: 'tools:install-ffmpeg',
  toolsPythonStatus: 'tools:python-status',
  toolsInstallPythonDeps: 'tools:install-python-deps',

  // social (online friends, chat, calls, party)
  socialConnect: 'social:connect',
  socialDisconnect: 'social:disconnect',
  socialStatus: 'social:status',
  socialSetStatus: 'social:set-status',
  socialRegister: 'social:register',
  socialLogin: 'social:login',
  socialMe: 'social:me',
  friendsSearch: 'friends:search',
  friendsRequest: 'friends:request',
  friendsRespond: 'friends:respond',
  friendsCancel: 'friends:cancel',
  friendsList: 'friends:list',
  friendsRequests: 'friends:requests',
  friendsRemove: 'friends:remove',
  friendsBlock: 'friends:block',
  friendsUnblock: 'friends:unblock',
  chatConversations: 'chat:conversations',
  chatMessages: 'chat:messages',
  chatSend: 'chat:send',
  chatDelete: 'chat:delete',
  chatRead: 'chat:read',
  chatTyping: 'chat:typing',
  /** Renderer reports which conversation is open (null = none) for smart toasts. */
  chatFocus: 'chat:focus',
  /** Settings "send a test" button. */
  notifyTest: 'notify:test',
  /** Chat images: upload dataUrl, pin/unpin, save-as. */
  imageSend: 'image:send',
  imagePin: 'image:pin',
  imageSave: 'image:save',
  callIce: 'call:ice',
  callInvite: 'call:invite',
  callAccept: 'call:accept',
  callDecline: 'call:decline',
  callEnd: 'call:end',
  callSignal: 'call:signal',
  partyCreate: 'party:create',
  partyJoin: 'party:join',
  partyLeave: 'party:leave',
  partySync: 'party:sync',
  partyQueue: 'party:queue',
  partyGet: 'party:get',
  partyActive: 'party:active',

  // discord rich presence (renderer → main playback snapshots)
  presenceUpdate: 'presence:update',

  // local audio intelligence: codec tags, lyrics, waveform peaks
  audioProbe: 'audio:probe',
  lyricsGet: 'lyrics:get',
  /** Pick a .lrc/.txt file for the current track (native open dialog). */
  lyricsUpload: 'lyrics:upload',
  /** Save lyrics the user pasted into the panel. */
  lyricsSet: 'lyrics:set',
  /**
   * Hand-tune lyric timing for a track (offset and/or speed fit); `null`
   * clears it back to the automatic fit.
   */
  lyricsSync: 'lyrics:sync',
  /** Drop the cached automatic match and look the song up again. */
  lyricsRematch: 'lyrics:rematch',
  /**
   * Align the lyrics to the recording the user actually has (duration fit, then
   * the timed captions of the matching video).
   */
  lyricsAlign: 'lyrics:align',

  // optional AI assistance (NVIDIA NIM; key stored in local settings)
  /** Settings "Test": one tiny round trip, with the latency. */
  aiTest: 'ai:test',
  /** Diagnostics: configured?, model, calls, last latency (never the key). */
  aiStatus: 'ai:status',
  /** Forget every name the model has learned. */
  aiForget: 'ai:forget',
  /** Forget cached/uploaded lyrics for a track (the .lrc on disk is untouched). */
  lyricsClear: 'lyrics:clear',
  wavePeaksGet: 'wave:peaks-get',
  wavePeaksSet: 'wave:peaks-set',

  // phone web player (serves website/player over the LAN for phones)
  phoneStatus: 'phone:status',
  phoneStart: 'phone:start',
  phoneStop: 'phone:stop',
  phoneQr: 'phone:qr',

  // mini-player window
  miniToggle: 'mini:toggle',
  /** Main window → main: live player snapshot, relayed to the mini window. */
  miniSync: 'mini:sync',
  /** Mini window → main → main window: transport command. */
  miniCmd: 'mini:cmd',
  /** Main → mini window: live player snapshot. */
  evtMiniState: 'evt:mini-state',
  /** Main → main window: transport command from the mini window. */
  evtMiniCmd: 'evt:mini-cmd',

  // updater
  updaterCheck: 'updater:check',
  updaterQuitAndInstall: 'updater:quit-and-install',
  updaterGetVersion: 'updater:get-version',

  // main → renderer push events
  evtDownloadUpdated: 'evt:download-updated',
  evtAuthChanged: 'evt:auth-changed',
  evtSocial: 'evt:social',
  evtUpdater: 'evt:updater',
  evtMaximizeChanged: 'evt:maximize-changed',
  /** Main → renderer: a desktop notification was clicked. */
  evtNotifyClick: 'evt:notify-click',
  /**
   * Main → renderer: a borrowed YouTube cover finished downloading for a local
   * track, so its tile can stop showing the placeholder and ask again.
   */
  evtArtworkReady: 'evt:artwork-ready'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
