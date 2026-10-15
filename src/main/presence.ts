import { Client } from 'discord-rpc'
import { db } from './db'

/**
 * Discord Rich Presence — "Listening to Spinity" with the song title,
 * artists and elapsed/total timestamps, Spotify-style.
 *
 * The renderer pushes compact playback snapshots over IPC (only on
 * track/play/pause changes, never per tick). This module owns the Discord
 * IPC client: connect lazily when a client ID is configured, reconnect when
 * the ID changes, and tear down when presence is disabled or the ID is
 * cleared. Every failure path is silent — Discord not running must never
 * break playback.
 */

export interface PresenceSnapshot {
  title: string
  artist: string
  /** Total length in seconds (0/unknown = no end timestamp). */
  durationSec: number
  /** Position in seconds when this snapshot was taken. */
  positionSec: number
  playing: boolean
}

let client: Client | null = null
let activeClientId: string | null = null
let connecting: Promise<void> | null = null
let lastKey = ''

/** Baked-in Spinity Discord application ID (not user-configurable). */
const CLIENT_ID = '1551062733049434213'

function wanted(): { clientId: string; enabled: boolean } {
  const s = db.getSettings()
  return { clientId: CLIENT_ID, enabled: s.discordPresence !== false }
}

function destroyClient(): void {
  lastKey = ''
  if (!client) return
  const c = client
  client = null
  activeClientId = null
  try {
    const r = c.clearActivity() as unknown
    if (r && typeof (r as Promise<unknown>).catch === 'function') {
      ;(r as Promise<unknown>).catch(() => {})
    }
  } catch {}
  try {
    void c.destroy().catch(() => {})
  } catch {}
}

async function ensureClient(clientId: string): Promise<Client | null> {
  if (client && activeClientId === clientId) return client
  if (connecting) {
    try {
      await connecting
    } catch {}
    return client && activeClientId === clientId ? client : null
  }
  destroyClient()
  const c = new Client({ transport: 'ipc' })
  connecting = c
    .login({ clientId })
    .then(() => {
      client = c
      activeClientId = clientId
    })
    .catch(() => {
      // Discord not running / bad ID / pipe busy — stay silent, retry on
      // the next snapshot instead of throwing into the IPC handler.
      try {
        void c.destroy().catch(() => {})
      } catch {}
    })
    .finally(() => {
      connecting = null
    })
  try {
    await connecting
  } catch {}
  return client
}

/** Push a playback snapshot to Discord. Call only on track/play/pause changes. */
export async function updatePresence(snap: PresenceSnapshot): Promise<void> {
  const { clientId, enabled } = wanted()
  const title = snap.title.slice(0, 128)
  const artist = snap.artist.slice(0, 128)
  if (!enabled || !clientId || !title) {
    if (client) destroyClient()
    return
  }
  const key = `${clientId}|${title}|${artist}|${snap.playing ? '1' : '0'}`
  if (key === lastKey && client) return // same song+state: Discord already shows it
  const c = await ensureClient(clientId)
  if (!c) return
  lastKey = key
  const nowSec = Math.floor(Date.now() / 1000)
  const pos = Math.max(0, Math.floor(snap.positionSec))
  const dur = Math.max(0, Math.floor(snap.durationSec))
  // App icon shown on Discord. The image itself must be uploaded once in the
  // Discord Developer Portal (application → Rich Presence → Art Assets) under
  // the exact name below — Discord serves art by key, code can't upload it.
  const art = { largeImageKey: 'spinity_logo', largeImageText: 'Spinity' }
  try {
    if (!snap.playing) {
      // Paused: freeze the timers so Discord doesn't count up.
      c.setActivity({ details: title, state: artist || undefined, instance: false, ...art })
    } else if (dur > pos) {
      c.setActivity({
        details: title,
        state: artist || undefined,
        startTimestamp: nowSec - pos,
        endTimestamp: nowSec + (dur - pos),
        instance: false,
        ...art
      })
    } else {
      // Live/unknown length: elapsed only.
      c.setActivity({
        details: title,
        state: artist || undefined,
        startTimestamp: nowSec - pos,
        instance: false,
        ...art
      })
    }
  } catch {
    lastKey = ''
  }
}

/** Re-read settings (toggle/ID changed): reconnect, switch ID, or tear down. */
export async function reconfigurePresence(): Promise<void> {
  const { clientId, enabled } = wanted()
  if (!enabled || !clientId || clientId !== activeClientId) destroyClient()
  lastKey = ''
}

/** Clear on quit. */
export function shutdownPresence(): void {
  destroyClient()
}
