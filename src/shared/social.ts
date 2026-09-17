/**
 * Shared social types — used by main, preload and renderer.
 * Keep dependency-free.
 */

export interface ServerUser {
  id: string
  username: string
  displayName: string
  avatarUrl?: string | null
  status?: 'online' | 'offline' | 'idle'
  lastSeenAt?: string | null
}

export interface FriendRequestView {
  id: string
  from?: { _id: string; username: string; displayName: string; avatarUrl?: string | null }
  to?: { _id: string; username: string; displayName: string; avatarUrl?: string | null }
  message?: string | null
  createdAt: string
}

export interface ConversationView {
  id: string
  otherId: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unread: number
}

export type MessageKind = 'text' | 'playlist' | 'track' | 'system'

export interface SharedTrack {
  videoId: string
  title: string
  artist: string
  durationSec: number
  thumbnail: string
  webUrl: string
}

export interface SharePayload {
  name: string
  tracks: SharedTrack[]
}

export interface MessageView {
  id: string
  conversationId: string
  senderId: string
  kind: MessageKind
  body: string | null
  payload: SharePayload | null
  readBy: string[]
  createdAt: string
}

export interface PartyPlayback {
  trackIndex: number
  positionMs: number
  isPlaying: boolean
  updatedAt: string
}

export interface PartyView {
  id: string
  code: string
  hostId: string
  queue: SharedTrack[]
  playback: PartyPlayback
  participants: string[]
  endedAt?: string | null
}

export interface IceServersResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[]
}

export type SocialEvent =
  | { type: 'friend:request'; payload: unknown }
  | { type: 'friend:updated'; payload: unknown }
  | { type: 'presence:update'; payload: { userId: string; status: string } }
  | { type: 'chat:message'; payload: MessageView & { conversationId: string } }
  | { type: 'chat:typing'; payload: { from: string; isTyping: boolean } }
  | { type: 'call:incoming'; payload: { from: string; callId: string } }
  | { type: 'call:accepted'; payload: { from: string; callId: string } }
  | { type: 'call:declined'; payload: { from: string; callId: string } }
  | { type: 'call:ended'; payload: { from: string; callId: string } }
  | { type: 'call:signal'; payload: { from: string; callId: string; signal: unknown } }
  | { type: 'party:state'; payload: { partyId: string; playback: PartyPlayback; at: number } }
  | { type: 'party:queue'; payload: { partyId: string; queue: SharedTrack[] } }

// Pure helpers — testable via existing esbuild+node:test harness

export function playlistToSharePayload(name: string, tracks: { id: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[]): SharePayload {
  return {
    name: name.slice(0, 80),
    tracks: tracks.slice(0, 100).map(t => ({
      videoId: t.id,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      thumbnail: t.thumbnail,
      webUrl: t.webUrl
    }))
  }
}

export function validateSharePayload(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'Invalid payload'
  const payload = p as { name?: unknown; tracks?: unknown }
  if (typeof payload.name !== 'string' || !payload.name.trim()) return 'Playlist name required'
  if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) return 'At least one track required'
  if (payload.tracks.length > 100) return 'Too many tracks (max 100)'
  return null
}

export function computeSyncTarget(playback: PartyPlayback, serverAt: number, now: number): number {
  if (!playback.isPlaying) return playback.positionMs / 1000
  const elapsedMs = Math.max(0, now - serverAt)
  return (playback.positionMs + elapsedMs) / 1000
}

export function shouldSeek(currentTime: number, target: number, thresholdSec = 1.5): boolean {
  return Math.abs(currentTime - target) > thresholdSec
}
