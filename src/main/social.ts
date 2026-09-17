import { io, type Socket } from 'socket.io-client'

interface ServerAccount {
  serverUserId: string
  username: string
  token: string
  serverUrl: string
}

type SocialEvent = { type: string; payload: unknown }

let socket: Socket | null = null
let account: ServerAccount | null = null
let broadcast: (channel: string, payload: unknown) => void = () => {}

export function setSocialBroadcast(fn: (channel: string, payload: unknown) => void): void {
  broadcast = fn
}

export function getSocialAccount(): ServerAccount | null { return account }

export function setSocialAccount(next: ServerAccount | null): void { account = next }

function serverBase(url: string): string {
  return url.replace(/\/$/, '')
}

async function api<T>(path: string, opts: RequestInit & { token?: string } = {}): Promise<T> {
  if (!account) throw new Error('Not connected to Spinity online')
  const base = serverBase(account.serverUrl)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) }
  if (account.token) headers.Authorization = `Bearer ${account.token}`
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${base}${path}`, { ...opts, headers })
  const body = await res.json().catch(() => ({})) as { error?: string } & T
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
  return body as T
}

export async function socialRegister(serverUrl: string, username: string, password: string, displayName?: string): Promise<ServerAccount> {
  const base = serverBase(serverUrl)
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, displayName })
  })
  const body = await res.json().catch(() => ({})) as { error?: string; token?: string; user?: { id: string; username: string } }
  if (!res.ok) throw new Error(body.error ?? 'Registration failed')
  const acc: ServerAccount = { serverUserId: body.user!.id, username: body.user!.username, token: body.token!, serverUrl: base }
  account = acc
  connectSocket()
  return acc
}

export async function socialLogin(serverUrl: string, username: string, password: string): Promise<ServerAccount> {
  const base = serverBase(serverUrl)
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const body = await res.json().catch(() => ({})) as { error?: string; token?: string; user?: { id: string; username: string } }
  if (!res.ok) throw new Error(body.error ?? 'Login failed')
  const acc: ServerAccount = { serverUserId: body.user!.id, username: body.user!.username, token: body.token!, serverUrl: base }
  account = acc
  connectSocket()
  return acc
}

export function connectSocket(): void {
  if (!account) return
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null }
  const base = serverBase(account.serverUrl)
  socket = io(base, { auth: { token: account.token }, transports: ['websocket', 'polling'] })

  const forward = (type: string) => (payload: unknown) => broadcast('evt:social', { type, payload } as SocialEvent)

  socket.on('connect', () => broadcast('evt:social', { type: 'social:connected', payload: { id: socket!.id } }))
  socket.on('disconnect', (reason) => broadcast('evt:social', { type: 'social:disconnected', payload: { reason } }))
  socket.on('connect_error', (err) => broadcast('evt:social', { type: 'social:error', payload: { message: err.message } }))

  socket.on('presence:update', forward('presence:update'))
  socket.on('chat:typing', forward('chat:typing'))
  socket.on('call:incoming', forward('call:incoming'))
  socket.on('call:accepted', forward('call:accepted'))
  socket.on('call:declined', forward('call:declined'))
  socket.on('call:ended', forward('call:ended'))
  socket.on('call:signal', forward('call:signal'))
  socket.on('party:state', forward('party:state'))
  socket.on('party:queue', forward('party:queue'))
  // Friends updates are delivered via REST polling today; also listen if server emits them
  socket.on('friend:request', forward('friend:request'))
  socket.on('friend:updated', forward('friend:updated'))
}

export function disconnectSocket(): void {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null }
}

export function socketEmit(event: string, data: unknown): void {
  socket?.emit(event, data)
}

export function getSocket(): Socket | null { return socket }

// REST helpers that require an active account
export const socialApi = {
  me: () => api<{ id: string; username: string; displayName: string }>(`/api/auth/me`),
  search: (q: string) => api<{ id: string; username: string; displayName: string; avatarUrl?: string | null; status?: string }[]>(`/api/friends/search?q=${encodeURIComponent(q)}`),
  request: (toUserId: string, message?: string) => api<{ id: string }>(`/api/friends/request`, { method: 'POST', body: JSON.stringify({ toUserId, message }) }),
  respond: (requestId: string, accept: boolean) => api<{ status: string }>(`/api/friends/respond`, { method: 'POST', body: JSON.stringify({ requestId, accept }) }),
  cancel: (requestId: string) => api<{ status: string }>(`/api/friends/cancel`, { method: 'POST', body: JSON.stringify({ requestId }) }),
  friends: () => api<{ id: string; username: string; displayName: string; status?: string }[]>(`/api/friends/list`),
  requests: () => api<{ incoming: unknown[]; outgoing: unknown[] }>(`/api/friends/requests`),
  remove: (friendId: string) => api<{ ok: boolean }>(`/api/friends/${encodeURIComponent(friendId)}`, { method: 'DELETE' }),
  block: (userId: string) => api<{ ok: boolean }>(`/api/friends/block`, { method: 'POST', body: JSON.stringify({ userId }) }),
  unblock: (userId: string) => api<{ ok: boolean }>(`/api/friends/block/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  conversations: () => api<unknown[]>(`/api/messages/conversations`),
  messages: (conversationId: string, limit = 50) => api<unknown[]>(`/api/messages/${encodeURIComponent(conversationId)}?limit=${limit}`),
  send: (payload: { toUserId?: string; conversationId?: string; kind: string; body?: string | null; payload?: unknown }) => api<unknown>(`/api/messages/send`, { method: 'POST', body: JSON.stringify(payload) }),
  read: (conversationId: string) => api<{ ok: boolean }>(`/api/messages/${encodeURIComponent(conversationId)}/read`, { method: 'POST' }),
  ice: () => api<{ iceServers: { urls: string | string[]; username?: string; credential?: string }[] }>(`/api/calls/ice`),
  partyCreate: (queue?: unknown[]) => api<{ id: string; code: string }>(`/api/parties/create`, { method: 'POST', body: JSON.stringify({ queue: queue ?? [] }) }),
  partyJoin: (code: string) => api<{ id: string; code: string }>(`/api/parties/join`, { method: 'POST', body: JSON.stringify({ code }) }),
  partyGet: (id: string) => api<unknown>(`/api/parties/${encodeURIComponent(id)}`),
  partyLeave: (id: string) => api<{ ok: boolean; ended?: boolean }>(`/api/parties/${encodeURIComponent(id)}/leave`, { method: 'POST' })
}
