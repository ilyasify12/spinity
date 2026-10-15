import { BrowserWindow } from 'electron'
import path from 'node:path'
import { db } from './db'
import { IPC } from '../shared/ipc'

/**
 * Mini-player: a compact always-on-top widget with art, title and transport
 * controls. It renders the same renderer bundle with `?mini=1` (see main.tsx)
 * and talks to the main window only through the main process:
 * main window --mini:sync--> main --evt:mini-state--> mini,
 * mini --mini:cmd--> main --evt:mini-cmd--> main window.
 *
 * Auto-hide (Settings → Mini-player): the widget hides itself whenever
 * another app takes focus, then pops back for a few seconds on every track
 * change just to announce the next song.
 */

let miniWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let lastTrackId: string | null = null
let hideTimer: NodeJS.Timeout | null = null

const ANNOUNCE_MS = 3000

function autoHideEnabled(): boolean {
  try {
    return db.getSettings().miniAutoHide === true
  } catch {
    return false
  }
}

export function initMini(main: BrowserWindow | null): void {
  mainWindow = main
}

function miniEntry(): { file: string } {
  return { file: path.join(__dirname, '../renderer/index.html') }
}

export function miniIsOpen(): boolean {
  return miniWindow !== null && !miniWindow.isDestroyed()
}

export function toggleMiniWindow(): boolean {
  if (miniIsOpen()) {
    closeMiniWindow()
    return false
  }
  const win = new BrowserWindow({
    width: 300,
    height: 112,
    minWidth: 260,
    minHeight: 100,
    maxWidth: 420,
    maxHeight: 180,
    show: false,
    // Transparent shell: the renderer paints a frosted rounded card.
    transparent: true,
    title: 'Spinity Mini',
    autoHideMenuBar: true,
    frame: false,
    alwaysOnTop: true,
    // No taskbar button, no hover thumbnail, no Alt+Tab entry — the widget
    // floats, it doesn't live in the taskbar.
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  miniWindow = win
  lastTrackId = null
  win.on('ready-to-show', () => win.show())
  // Auto-hide: disappear as soon as another app takes focus.
  win.on('blur', () => {
    if (autoHideEnabled() && miniIsOpen()) win.hide()
  })
  win.on('closed', () => {
    if (miniWindow === win) miniWindow = null
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(`${devUrl}?mini=1`)
  } else {
    void win.loadFile(miniEntry().file, { query: { mini: '1' } })
  }
  return true
}

export function closeMiniWindow(): void {
  try {
    miniWindow?.close()
  } catch {}
  miniWindow = null
}

/** Relay a player snapshot from the main window to the mini window. */
export function pushMiniState(payload: unknown): void {
  try {
    if (!miniIsOpen()) return
    miniWindow?.webContents.send(IPC.evtMiniState, payload)
    // Auto-hide announce: a new song pops the widget up briefly, then it
    // sinks away again unless the user is interacting with it.
    if (autoHideEnabled() && payload && typeof payload === 'object') {
      const trackId = (payload as { trackId?: string | null }).trackId ?? null
      if (trackId !== lastTrackId) {
        lastTrackId = trackId
        const win = miniWindow
        if (win && !win.isFocused()) {
          // showInactive: announce without stealing focus, so the timer
          // below actually hides it again (a focused window never auto-hides).
          win.showInactive()
          if (hideTimer) clearTimeout(hideTimer)
          hideTimer = setTimeout(() => {
            try {
              if (miniIsOpen() && !win.isFocused()) win.hide()
            } catch {}
          }, ANNOUNCE_MS)
        }
      }
    }
  } catch {}
}

/** Relay a transport command from the mini window to the main window. */
export function forwardMiniCmd(cmd: { action: string; value?: number }): void {
  try {
    mainWindow?.webContents.send(IPC.evtMiniCmd, cmd.action, cmd.value)
  } catch {}
}
