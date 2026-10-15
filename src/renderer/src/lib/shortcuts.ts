/**
 * One place that defines the keyboard shortcuts, so the help sheet, the
 * Settings card and the actual key handler can never drift apart.
 *
 * The set mirrors Spotify's desktop client — transport on Space / Ctrl+arrows,
 * seek on Shift+arrows, volume on Ctrl+Up/Down — plus Spinity extras (lyrics,
 * like, shuffle, repeat).
 */

export interface ShortcutDef {
  id: string
  /** Key caps, already platform-formatted for display. */
  keys: string[]
  /** i18n key + English literal (t(key, en)). */
  labelKey: string
  label: string
}

const MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent)
/** Modifier shown in the UI: ⌘ on macOS, Ctrl everywhere else. */
export const MOD = MAC ? '⌘' : 'Ctrl'

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'play', keys: ['Space'], labelKey: 'sc.play', label: 'Play / pause' },
  { id: 'next', keys: [`${MOD}`, '→'], labelKey: 'sc.next', label: 'Next track' },
  { id: 'prev', keys: [`${MOD}`, '←'], labelKey: 'sc.prev', label: 'Previous track' },
  { id: 'seek-fwd', keys: ['Shift', '→'], labelKey: 'sc.seekFwd', label: 'Seek forward 10s' },
  { id: 'seek-back', keys: ['Shift', '←'], labelKey: 'sc.seekBack', label: 'Seek back 10s' },
  { id: 'vol-up', keys: [`${MOD}`, '↑'], labelKey: 'sc.volUp', label: 'Volume up' },
  { id: 'vol-down', keys: [`${MOD}`, '↓'], labelKey: 'sc.volDown', label: 'Volume down' },
  { id: 'mute', keys: ['M'], labelKey: 'sc.mute', label: 'Mute / unmute' },
  { id: 'shuffle', keys: ['S'], labelKey: 'sc.shuffle', label: 'Toggle shuffle' },
  { id: 'repeat', keys: ['R'], labelKey: 'sc.repeat', label: 'Cycle repeat mode' },
  { id: 'like', keys: ['F'], labelKey: 'sc.like', label: 'Like the current song' },
  { id: 'lyrics', keys: ['L'], labelKey: 'sc.lyrics', label: 'Show / hide lyrics' },
  { id: 'lyrics-earlier', keys: ['['], labelKey: 'sc.lyricsEarlier', label: 'Lyrics earlier 0.25s (lyrics open)' },
  { id: 'lyrics-later', keys: [']'], labelKey: 'sc.lyricsLater', label: 'Lyrics later 0.25s (lyrics open)' },
  { id: 'search', keys: [`${MOD}`, 'K'], labelKey: 'sc.search', label: 'Jump to search' },
  { id: 'help', keys: ['?'], labelKey: 'sc.help', label: 'This shortcut list' },
  { id: 'escape', keys: ['Esc'], labelKey: 'sc.escape', label: 'Close panels' }
]
