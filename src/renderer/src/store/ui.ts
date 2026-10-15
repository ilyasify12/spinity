import { create } from 'zustand'

/** Virtual playlists that behave like real ones in rail + detail views. */
export type VirtualPlaylistId = 'liked' | 'local' | 'all'
export type PlaylistSelection = string | VirtualPlaylistId | null

interface UiState {
  /** Which playlist the detail view shows (id or virtual). */
  selectedPlaylist: PlaylistSelection
  openPlaylist: (id: PlaylistSelection) => void
  /** Left rail collapsed to icons (Spotify "Collapse Your Library"). */
  railCollapsed: boolean
  toggleRail: () => void
  /**
   * Conversation the Friends page should open. Set by desktop-notification
   * clicks in App — a store handoff (not an event) so it survives the
   * lazy-loaded Friends page mounting *after* the click arrives.
   */
  pendingChatId: string | null
  requestChat: (id: string | null) => void
  /**
   * Lyrics docked on the right edge, Spotify-style: the rest of the app keeps
   * working (and playing) while it is open, so this lives in the shell store
   * rather than inside the player bar.
   */
  lyricsOpen: boolean
  setLyricsOpen: (open: boolean) => void
  toggleLyrics: () => void
  /** Keyboard-shortcut cheat sheet. */
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  selectedPlaylist: null,
  openPlaylist: (id) => set({ selectedPlaylist: id }),
  railCollapsed: false,
  toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
  pendingChatId: null,
  requestChat: (id) => set({ pendingChatId: id }),
  lyricsOpen: false,
  setLyricsOpen: (open) => set({ lyricsOpen: open }),
  toggleLyrics: () => set((s) => ({ lyricsOpen: !s.lyricsOpen })),
  helpOpen: false,
  setHelpOpen: (open) => set({ helpOpen: open })
}))
