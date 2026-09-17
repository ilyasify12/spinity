import { create } from 'zustand'

export interface SocialUser { id: string; username: string; displayName: string; avatarUrl?: string | null; status?: string; lastSeenAt?: string | null }
export interface IncomingReq { id: string; from: { _id: string; username: string; displayName: string }; message?: string | null; createdAt: string }

interface SocialState {
  serverUrl: string
  connected: boolean
  me: SocialUser | null
  friends: SocialUser[]
  incoming: IncomingReq[]
  outgoing: { id: string; to: { _id: string; username: string; displayName: string } }[]
  conversations: { id: string; otherId: string; lastMessagePreview: string | null; unread: number }[]
  error: string | null
  setServerUrl: (url: string) => void
  refresh: () => Promise<void>
  search: (q: string) => Promise<SocialUser[]>
  request: (toUserId: string, message?: string) => Promise<void>
  respond: (requestId: string, accept: boolean) => Promise<void>
  cancel: (requestId: string) => Promise<void>
  remove: (friendId: string) => Promise<void>
}

const DEFAULT_URL = 'https://spinity-server.onrender.com'

export const useSocial = create<SocialState>((set, get) => ({
  serverUrl: (() => { try { return localStorage.getItem('spinity:serverUrl') ?? DEFAULT_URL } catch { return DEFAULT_URL } })(),
  connected: false,
  me: null,
  friends: [],
  incoming: [],
  outgoing: [],
  conversations: [],
  error: null,

  setServerUrl: (url) => {
    set({ serverUrl: url })
    try { localStorage.setItem('spinity:serverUrl', url) } catch {}
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
      set({
        me: me as SocialUser | null,
        friends: friends as SocialUser[],
        incoming: (reqs as { incoming: IncomingReq[] }).incoming,
        outgoing: (reqs as { outgoing: { id: string; to: { _id: string; username: string; displayName: string } }[] }).outgoing,
        conversations: convs as never,
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
  request: async (toUserId, message) => { await window.spinity.social.request(toUserId, message); await get().refresh() },
  respond: async (requestId, accept) => { await window.spinity.social.respond(requestId, accept); await get().refresh() },
  cancel: async (requestId) => { await window.spinity.social.cancel(requestId); await get().refresh() },
  remove: async (friendId) => { await window.spinity.social.remove(friendId); await get().refresh() }
}))
