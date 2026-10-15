import { create } from 'zustand'

export interface SocialUser { id: string; username: string; displayName: string; avatarUrl?: string | null; status?: string; lastSeenAt?: string | null }
export interface IncomingReq { id: string; from: { _id: string; username: string; displayName: string }; message?: string | null; createdAt: string }
/** A listening-party invite seen in chat (feeds the notification center). */
export interface PartyInvite { code: string; fromId: string; fromName: string; conversationId: string; at: string }
/** Our own presence choice. The server auto-detects online/offline around it. */
export type OwnStatus = 'online' | 'dnd' | 'invisible'

interface SocialState {
  connected: boolean
  me: SocialUser | null
  friends: SocialUser[]
  incoming: IncomingReq[]
  outgoing: { id: string; to: { _id: string; username: string; displayName: string } }[]
  conversations: { id: string; otherId: string; lastMessagePreview: string | null; unread: number }[]
  /** Party invites seen in chat (deduped, newest first, max 10). */
  partyInvites: PartyInvite[]
  pushInvite: (invite: PartyInvite) => void
  dismissInvite: (code: string, fromId: string) => void
  /** Our own presence preference (synced with the server). */
  ownStatus: OwnStatus
  setOwnStatus: (status: OwnStatus) => Promise<void>
  error: string | null
  setPresence: (userId: string, status: string) => void
  refresh: () => Promise<void>
  /** Lightweight unread/badge refresh (conversations only, no friends round-trips). */
  refreshBadge: () => Promise<void>
  search: (q: string) => Promise<SocialUser[]>
  request: (toUserId: string, message?: string) => Promise<void>
  respond: (requestId: string, accept: boolean) => Promise<void>
  cancel: (requestId: string) => Promise<void>
  remove: (friendId: string) => Promise<void>
}

export const useSocial = create<SocialState>((set, get) => ({
  connected: false,
  me: null,
  friends: [],
  incoming: [],
  outgoing: [],
  conversations: [],
  partyInvites: [],
  pushInvite: (invite) => {
    set((s) => {
      if (s.partyInvites.some((i) => i.code === invite.code && i.fromId === invite.fromId)) return s
      return { partyInvites: [invite, ...s.partyInvites].slice(0, 10) }
    })
  },
  dismissInvite: (code, fromId) => {
    set((s) => ({ partyInvites: s.partyInvites.filter((i) => !(i.code === code && i.fromId === fromId)) }))
  },
  ownStatus: 'online',
  setOwnStatus: async (status) => {
    const prev = get().ownStatus
    set({ ownStatus: status })
    try {
      const r = await window.spinity.social.setStatus(status)
      if (r?.statusPref) set({ ownStatus: r.statusPref as OwnStatus })
    } catch (err) {
      set({ ownStatus: prev })
      throw err
    }
  },
  error: null,

  setPresence: (userId, status) => {
    set((s) => ({ friends: s.friends.map((f) => (f.id === userId ? { ...f, status } : f)) }))
  },

  refresh: async () => {
    try {
      const status = await window.spinity.social.status()
      set({ connected: status.connected })
      if (!status.connected) { set({ me: null, friends: [], incoming: [], outgoing: [] }); return }
      const [me, friends, reqs, convs] = await Promise.all([
        window.spinity.social.me().catch(() => null),
        window.spinity.social.friends().catch(() => []),
        window.spinity.social.requests().catch(() => ({ incoming: [], outgoing: [] })),
        window.spinity.social.conversations().catch(() => [])
      ])
      const typedMe = me as (SocialUser & { statusPref?: string }) | null
      set({
        me: typedMe,
        friends: friends as SocialUser[],
        incoming: (reqs as { incoming: IncomingReq[] }).incoming,
        outgoing: (reqs as { outgoing: { id: string; to: { _id: string; username: string; displayName: string } }[] }).outgoing,
        conversations: convs as never,
        ownStatus: (typedMe?.statusPref === 'dnd' || typedMe?.statusPref === 'invisible' ? typedMe.statusPref : 'online'),
        error: null
      })
      const badge = (reqs as { incoming: IncomingReq[] }).incoming.length + (convs as { unread: number }[]).reduce((acc, c) => acc + (c.unread ?? 0), 0)
      try { sessionStorage.setItem('spinity:friendsBadge', String(badge)) } catch {}
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  search: async (q) => {
    const r = await window.spinity.social.search(q)
    return r as SocialUser[]
  },
  refreshBadge: async () => {
    try {
      const convs = await window.spinity.social.conversations().catch(() => [])
      set({ conversations: convs as never })
      const badge = get().incoming.length + (convs as { unread: number }[]).reduce((acc, c) => acc + (c.unread ?? 0), 0)
      try { sessionStorage.setItem('spinity:friendsBadge', String(badge)) } catch {}
    } catch {}
  },
  request: async (toUserId, message) => { await window.spinity.social.request(toUserId, message); await get().refresh() },
  respond: async (requestId, accept) => { await window.spinity.social.respond(requestId, accept); await get().refresh() },
  cancel: async (requestId) => { await window.spinity.social.cancel(requestId); await get().refresh() },
  remove: async (friendId) => { await window.spinity.social.remove(friendId); await get().refresh() }
}))
