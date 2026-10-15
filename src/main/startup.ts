import { app } from 'electron'
import { db } from './db'

/**
 * "Start with Windows", Spotify-style: registers Spinity as a login item so
 * it launches on sign-in until the user turns it off in Settings (or removes
 * it in Task Manager → Startup apps, which flips the OS-side switch).
 */
export function applyLoginItem(): void {
  try {
    const { launchAtLogin } = db.getSettings()
    app.setLoginItemSettings({ openAtLogin: !!launchAtLogin })
  } catch (err) {
    console.error('[startup] failed to apply login item setting', err)
  }
}
