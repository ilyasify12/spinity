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

  // library
  librarySnapshot: 'library:snapshot',
  libraryAddTrack: 'library:add-track',
  libraryRemoveTrack: 'library:remove-track',
  libraryRevealFile: 'library:reveal-file',

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

  // social (online friends, chat, calls, party)
  socialConnect: 'social:connect',
  socialDisconnect: 'social:disconnect',
  socialStatus: 'social:status',
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
  chatRead: 'chat:read',
  chatTyping: 'chat:typing',
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

  // main → renderer push events
  evtDownloadUpdated: 'evt:download-updated',
  evtAuthChanged: 'evt:auth-changed',
  evtSocial: 'evt:social'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
