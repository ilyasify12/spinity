import { create } from 'zustand'
import { usePlayer } from '../player/engine'

export interface PartyTrack {
  videoId: string
  title: string
  artist: string
  durationSec: number
  thumbnail: string
  webUrl: string
}

export interface PartyMember {
  id: string
  username: string
  displayName: string
  status?: string
}

export interface PartyPlayback {
  trackIndex: number
  positionMs: number
  isPlaying: boolean
  updatedAt: string
}

interface PartyState {
  partyId: string | null
  code: string
  isHost: boolean
  queue: PartyTrack[]
  members: PartyMember[]
  playback: PartyPlayback | null
  nowPlayingVideoId: string | null
  error: string | null
  setCodeInput: (code: string) => void
  create: (queue: PartyTrack[]) => Promise<void>
  join: (code: string) => Promise<void>
  leave: () => Promise<void>
  restore: () => Promise<void>
  applyState: (partyId: string, playback: PartyPlayback) => void
  applyQueue: (partyId: string, queue: PartyTrack[]) => void
  applyMembers: (partyId: string, participantIds: string[]) => void
  refreshMembers: () => Promise<void>
}

const LS_ID = 'spinity:partyId'
const LS_CODE = 'spinity:partyCode'

function loadPersisted(): { partyId: string | null; code: string } {
  try {
    return {
      partyId: localStorage.getItem(LS_ID),
      code: localStorage.getItem(LS_CODE) ?? ''
    }
  } catch {
    return { partyId: null, code: '' }
  }
}

function persist(partyId: string | null, code: string): void {
  try {
    if (partyId) {
      localStorage.setItem(LS_ID, partyId)
      localStorage.setItem(LS_CODE, code)
    } else {
      localStorage.removeItem(LS_ID)
      localStorage.removeItem(LS_CODE)
    }
  } catch {}
}

const persisted = loadPersisted()

export function friendlyPartyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("Path 'webUrl' is required") || msg.includes('webUrl')) {
    return 'Those tracks are local-only files with no shareable link — play a YouTube track to share it with guests.'
  }
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg
}

/** Resolve display names for participant ids via the friends list cache. */
function namesFor(ids: string[], friends: { id: string; username: string; displayName: string; status?: string }[], meId?: string | null, meName?: string | null): PartyMember[] {
  return ids.map((id) => {
    if (meId && id === meId) return { id, username: meName ?? 'you', displayName: `${meName ?? 'You'} (you)`, status: 'online' }
    const f = friends.find((x) => x.id === id)
    if (f) return { id, username: f.username, displayName: f.displayName, status: f.status ?? 'online' }
    return { id, username: id.slice(0, 8), displayName: `User ${id.slice(0, 8)}`, status: 'online' }
  })
}

export const useParty = create<PartyState>((set, get) => ({
  partyId: persisted.partyId,
  code: persisted.code,
  isHost: false,
  queue: [],
  members: [],
  playback: null,
  nowPlayingVideoId: null,
  error: null,
  setCodeInput: (code) => set({ code: code.toUpperCase() }),

  create: async (queue) => {
    const r = (await window.spinity.social.partyCreate(queue)) as unknown as {
      id: string; code: string; hostId?: string; queue?: PartyTrack[]; playback?: PartyPlayback;
      participants?: string[]; members?: PartyMember[]
    }
    const me = await window.spinity.social.me().catch(() => null)
    const members: PartyMember[] = r.members ?? namesFor(r.participants ?? (me ? [me.id] : []), [], me?.id ?? null, me?.displayName ?? null)
    persist(r.id, r.code)
    set({ partyId: r.id, code: r.code, isHost: true, queue: r.queue ?? queue, members, playback: r.playback ?? null, error: null })
  },

  join: async (code) => {
    const clean = code.trim().toUpperCase()
    if (!clean) throw new Error('Enter a party code')
    const r = (await window.spinity.social.partyJoin(clean)) as unknown as {
      id: string; code: string; hostId?: string; queue?: PartyTrack[]; playback?: PartyPlayback;
      participants?: string[]; members?: PartyMember[]
    }
    const me = await window.spinity.social.me().catch(() => null)
    let members: PartyMember[] = r.members ?? []
    if (members.length === 0 && r.participants) {
      try {
        const friends = (await window.spinity.social.friends()) as { id: string; username: string; displayName: string; status?: string }[]
        members = namesFor(r.participants, friends, me?.id ?? null, me?.displayName ?? null)
      } catch {
        members = namesFor(r.participants, [], me?.id ?? null, me?.displayName ?? null)
      }
    }
    const myId = me?.id ?? null
    persist(r.id, r.code)
    set({
      partyId: r.id, code: r.code,
      isHost: myId != null && r.hostId != null ? String(r.hostId) === String(myId) : false,
      queue: r.queue ?? [], members, playback: r.playback ?? null, error: null
    })
  },

  leave: async () => {
    const { partyId } = get()
    if (partyId) {
      try { await window.spinity.social.partyLeave(partyId) } catch {}
    }
    persist(null, '')
    try {
      // Guests stop party playback; hosts keep their local music playing.
      if (!get().isHost) usePlayer.getState().stop()
    } catch {}
    set({ partyId: null, code: '', isHost: false, queue: [], members: [], playback: null, nowPlayingVideoId: null })
  },

  restore: async () => {
    const { partyId } = get()
    try {
      // Prefer the server's active party (survives reload), fall back to stored id.
      const active = (await window.spinity.social.partyActive().catch(() => null)) as unknown as {
        party: { id: string; code: string; hostId: string; queue: PartyTrack[]; playback: PartyPlayback; participants: string[]; members: PartyMember[] } | null
      } | null
      if (active?.party) {
        const p = active.party
        const me = await window.spinity.social.me().catch(() => null)
        persist(p.id, p.code)
        set({
          partyId: p.id, code: p.code,
          isHost: me ? String(p.hostId) === String(me.id) : false,
          queue: p.queue ?? [], members: p.members ?? [], playback: p.playback ?? null
        })
        return
      }
    } catch {}
    if (!partyId) return
    try {
      const p = (await window.spinity.social.partyGet(partyId)) as unknown as {
        id: string; code: string; hostId: string; queue: PartyTrack[]; playback: PartyPlayback;
        participants: string[]; members: PartyMember[]; endedAt?: string | null
      }
      if (p.endedAt) {
        persist(null, '')
        set({ partyId: null, code: '', isHost: false, queue: [], members: [], playback: null })
        return
      }
      const me = await window.spinity.social.me().catch(() => null)
      set({
        code: p.code,
        isHost: me ? String(p.hostId) === String(me.id) : get().isHost,
        queue: p.queue ?? [], members: p.members ?? get().members, playback: p.playback ?? null
      })
    } catch {
      // Party gone or offline — forget it so UI doesn't show a ghost party.
      persist(null, '')
      set({ partyId: null, code: '', isHost: false, queue: [], members: [], playback: null })
    }
  },

  applyState: (partyId, playback) => {
    if (get().partyId !== partyId) return
    set({ playback })
  },

  applyQueue: (partyId, queue) => {
    if (get().partyId !== partyId) return
    set({ queue })
  },

  applyMembers: (partyId, participantIds) => {
    if (get().partyId !== partyId) return
    set((s) => {
      const byId = new Map(s.members.map((m) => [m.id, m]))
      const members = participantIds.map((id) => byId.get(id) ?? { id, username: id.slice(0, 8), displayName: `User ${id.slice(0, 8)}`, status: 'online' })
      return { members }
    })
    // Resolve real names in the background.
    void (async () => {
      try {
        const [friends, me] = await Promise.all([
          window.spinity.social.friends() as Promise<{ id: string; username: string; displayName: string; status?: string }[]>,
          window.spinity.social.me().catch(() => null) as Promise<{ id: string; displayName: string } | null>
        ])
        if (get().partyId !== partyId) return
        set({ members: namesFor(participantIds, friends, me?.id ?? null, me?.displayName ?? null) })
      } catch {}
    })()
  },

  refreshMembers: async () => {
    const { partyId } = get()
    if (!partyId) return
    try {
      const p = (await window.spinity.social.partyGet(partyId)) as unknown as {
        participants: string[]; members: PartyMember[]; queue: PartyTrack[]; playback: PartyPlayback; code: string; hostId: string
      }
      const me = await window.spinity.social.me().catch(() => null)
      set({
        members: p.members?.length ? p.members : namesFor(p.participants ?? [], [], me?.id ?? null, me?.displayName ?? null),
        queue: p.queue ?? get().queue,
        playback: p.playback ?? get().playback,
        code: p.code ?? get().code
      })
    } catch {}
  }
}))
