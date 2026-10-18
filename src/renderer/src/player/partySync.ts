import { usePlayer, getAudioElement } from './engine'
import { useParty } from '../store/party'
import { useApp } from '../store/app'
import { applyPartySync } from '../social/party'

let hostTimer: number | null = null
let guestApplying = false
let lastGuestVideoId: string | null = null

function audioEl(): HTMLAudioElement | null {
  try {
    return getAudioElement()
  } catch {
    return document.querySelector('audio')
  }
}

/**
 * Host: broadcast position every 2s + on play/pause/seek.
 * Guest: when party state arrives, ensure the same track is playing
 * (local file if owned, else YouTube stream) and snap position.
 */
export function startPartySync(): void {
  stopPartySync()
  hostTimer = window.setInterval(() => void tick(), 2000)
  // React to local play/pause immediately.
  usePlayer.subscribe((s, prev) => {
    const party = useParty.getState()
    if (!party.partyId || !party.isHost) return
    if (s.playing !== prev.playing || s.index !== prev.index) void pushHost()
  })
}

export function stopPartySync(): void {
  if (hostTimer != null) {
    window.clearInterval(hostTimer)
    hostTimer = null
  }
  lastGuestVideoId = null
}

async function tick(): Promise<void> {
  const party = useParty.getState()
  if (!party.partyId) return
  if (party.isHost) await pushHost()
}

async function pushHost(): Promise<void> {
  const party = useParty.getState()
  if (!party.partyId || !party.isHost) return
  const player = usePlayer.getState()
  const el = audioEl()
  const posSec = el ? el.currentTime : player.currentTime
  const current = player.queue[player.index]
  // Keep the shared queue in sync with what the host actually plays.
  // Local-only files have no webUrl for guests to stream — drop them so the
  // server (webUrl required) never rejects the update.
  const queue = player.queue.slice(0, 100)
    .filter((t) => !!t.webUrl)
    .map((t) => ({
      videoId: t.id,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      thumbnail: t.thumbnail,
      webUrl: t.webUrl
    }))
  try {
    await window.spinity.social.partySync(party.partyId, {
      trackIndex: Math.max(0, player.index),
      positionMs: Math.round(posSec * 1000),
      isPlaying: player.playing
    })
    // Only push queue when it differs (cheap string compare).
    const curIds = party.queue.map((q) => q.videoId).join(',')
    const newIds = queue.map((q) => q.videoId).join(',')
    if (curIds !== newIds && queue.length > 0) {
      await window.spinity.social.partyQueue(party.partyId, queue)
    }
    void current
  } catch {}
}

/** Called when a `party:state` socket event arrives (guests only). */
export async function onPartyState(partyId: string, playback: { trackIndex: number; positionMs: number; isPlaying: boolean; updatedAt: string }, serverAt: number): Promise<void> {
  const party = useParty.getState()
  if (party.partyId !== partyId || party.isHost) return
  if (guestApplying) return
  guestApplying = true
  try {
    const track = party.queue[playback.trackIndex] ?? party.queue[0]
    if (!track) return
    const player = usePlayer.getState()
    const current = player.queue[player.index]
    const needsSwitch = !current || current.id !== track.videoId || lastGuestVideoId !== track.videoId
    if (needsSwitch) {
      lastGuestVideoId = track.videoId
      // Prefer local file; fall back to streaming the YouTube audio.
      const local = useApp.getState().tracks.find((t) => t.id === track.videoId)
      if (local) {
        player.playQueue(useApp.getState().tracks, useApp.getState().tracks.findIndex((t) => t.id === track.videoId))
      } else {
        try {
          const info = await window.spinity.youtube.stream(track.videoId)
          player.playStream(info.streamUrl ?? info.url, { id: track.videoId, source: 'youtube', title: track.title, artist: track.artist, durationSec: track.durationSec, thumbnail: track.thumbnail, webUrl: track.webUrl })
        } catch {
          // Stream failed — guest stays silent until host changes track.
          return
        }
      }
      // Give the element a moment to load before seeking.
      await new Promise((r) => setTimeout(r, 800))
    }
    const el = audioEl()
    if (el) {
      applyPartySync(el, playback, serverAt)
    } else {
      // Fallback if audio element unavailable: emulate via store.
      const target = playback.isPlaying
        ? (playback.positionMs + Math.max(0, Date.now() - serverAt)) / 1000
        : playback.positionMs / 1000
      if (Math.abs(player.currentTime - target) > 1.5) player.seek(target)
      if (playback.isPlaying && !player.playing) player.toggle()
      if (!playback.isPlaying && player.playing) player.toggle()
    }
    useParty.getState().applyState(partyId, playback)
  } finally {
    guestApplying = false
  }
}

/** Called when a `party:queue` socket event arrives. */
export function onPartyQueue(partyId: string, queue: { videoId: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[]): void {
  const party = useParty.getState()
  if (party.partyId !== partyId) return
  useParty.getState().applyQueue(partyId, queue)
}
