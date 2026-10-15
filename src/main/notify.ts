import { BrowserWindow, Notification } from 'electron'
import { db } from './db'
import { getSelfStatus } from './social'
import { IPC } from '../shared/ipc'

/**
 * Desktop notifications for messages, calls and party invites.
 *
 * Shown from the main process so they fire even when the Friends page isn't
 * open (or the window is in the background). Fully gated by Settings:
 * a master switch plus one toggle per kind. Clicking a notification focuses
 * the window and tells the renderer what to open via `evt:notify-click`.
 */

export type NotifyKind = 'message' | 'call' | 'party-invite'

export interface NotifyClick {
  kind: NotifyKind
  /** Conversation id for messages/invites. */
  conversationId?: string
  /** Party code for invites (prefills the join box). */
  code?: string
}

type Deps = {
  getWindow: () => BrowserWindow | null
  send: (channel: string, payload: unknown) => void
}

let deps: Deps | null = null

export function initNotifier(next: Deps): void {
  deps = next
}

/** Conversation id the renderer currently has open (null = none). */
let focusedConversation: string | null = null

export function setFocusedConversation(conversationId: string | null): void {
  focusedConversation = conversationId
}

function allowed(kind: NotifyKind): boolean {
  const s = db.getSettings()
  if (!s.notificationsEnabled) return false
  // Do-not-disturb silences everything except ringing calls.
  if (getSelfStatus() === 'dnd' && kind !== 'call') return false
  if (kind === 'message') return s.notifyMessages !== false
  if (kind === 'call') return s.notifyCalls !== false
  return s.notifyPartyInvites !== false
}

function logSkip(kind: NotifyKind, reason: string): void {
  console.log(`[notify] skip ${kind}: ${reason}`)
}

export function showNotification(kind: NotifyKind, title: string, body: string, click: NotifyClick, opts?: { force?: boolean }): void {
  if (!opts?.force && !allowed(kind)) {
    // Name the exact switch that killed it, so "why no popup?" is answerable
    // from the devtools console without guessing.
    const s = db.getSettings()
    if (getSelfStatus() === 'dnd' && kind !== 'call') logSkip(kind, 'do-not-disturb')
    else if (!s.notificationsEnabled) logSkip(kind, 'master switch off (Settings → Notifications)')
    else logSkip(kind, `${kind} toggle off (Settings → Notifications)`)
    return
  }
  try {
    if (!Notification.isSupported()) {
      logSkip(kind, 'notifications not supported on this system')
      return
    }
    const win = deps?.getWindow() ?? null
    // Skip the toast only when the user is literally looking at that exact
    // conversation — being anywhere else in the app still pops.
    if (
      !opts?.force &&
      kind === 'message' &&
      win?.isFocused() &&
      click.conversationId &&
      focusedConversation === click.conversationId
    ) {
      logSkip(kind, 'conversation open and focused')
      return
    }
    const n = new Notification({ title: title.slice(0, 120), body: body.slice(0, 240), silent: false })
    n.on('click', () => {
      try {
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
        deps?.send(IPC.evtNotifyClick, click)
      } catch {}
    })
    n.show()
    console.log(`[notify] shown ${kind}: ${title.slice(0, 60)}`)
  } catch (err) {
    console.error('[notify] failed to show notification', err)
  }
}

/**
 * Settings "send a test" — always shows, proving the OS path works.
 *
 * Resolves `{ ok: false, error }` when the OS refuses the toast (unsupported
 * system, or Electron emitted a failure) instead of pretending it worked —
 * that fake success is exactly what made missing notifications look random.
 */
export function testNotification(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    try {
      if (!Notification.isSupported()) {
        console.log('[notify] test: notifications not supported on this system')
        resolve({ ok: false, error: 'Notifications are not supported on this system' })
        return
      }
      const n = new Notification({
        title: 'Spinity notifications work 🎉',
        body: 'New messages, calls and party invites will pop up here.',
        silent: false
      })
      n.on('show', () => resolve({ ok: true }))
      n.on('failed', (_event, error) => {
        console.error('[notify] test failed:', error)
        resolve({ ok: false, error: String(error) })
      })
      n.show()
      console.log('[notify] test shown')
      // The OS may confirm neither way (Windows can silently drop a toast when
      // the AppUserModelID has no Start Menu shortcut). Assume shown rather
      // than leaving the Settings button hanging.
      setTimeout(() => resolve({ ok: true }), 2000)
    } catch (err) {
      console.error('[notify] test failed to create', err)
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
}

interface ChatMessagePayload {
  conversationId?: string
  senderId?: string
  senderName?: string | null
  kind?: string
  body?: string | null
  payload?: { name?: string; tracks?: unknown[]; partyCode?: string } | null
}

/**
 * Inspect a social socket event and raise the matching desktop notification.
 * Called from the main broadcast path so it works regardless of which page
 * the renderer currently shows.
 */
export function notifyForSocialEvent(type: string, payload: unknown): void {
  try {
    if (type === 'chat:message') {
      const m = payload as ChatMessagePayload
      const code = m.payload?.partyCode
      const sender = m.senderName || 'Someone'
      if (code) {
        showNotification(
          'party-invite',
          'Listening party invite 🎵',
          `${sender} invited you — code ${code}. Click to join.`,
          { kind: 'party-invite', conversationId: m.conversationId, code }
        )
      } else {
        const preview =
          m.kind === 'text'
            ? (m.body ?? 'sent you a message')
            : m.kind === 'playlist'
              ? `🎵 shared a playlist (${m.payload?.name ?? 'playlist'})`
              : m.kind === 'image'
                ? `📷 sent you a photo`
                : '🎵 shared music with you'
        showNotification('message', sender, preview, {
          kind: 'message',
          conversationId: m.conversationId
        })
      }
    } else if (type === 'call:incoming') {
      showNotification('call', 'Incoming voice call 📞', 'Someone is calling you — click to answer in Spinity.', {
        kind: 'call'
      })
    }
  } catch (err) {
    console.error('[notify] failed to handle social event', err)
  }
}
