import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { verifyToken } from '../utils/token.js'
import { User } from '../models/User.js'
import { Message } from '../models/Message.js'
import { Conversation } from '../models/Conversation.js'
import { ListenSession } from '../models/ListenSession.js'
import { Friendship } from '../models/Friendship.js'

function sortedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a] }

export function createSocketServer(httpServer: HttpServer, corsOrigin: string): Server {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()), methods: ['GET', 'POST'] }
  })

  // Auth handshake
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string })?.token ?? (socket.handshake.query as { token?: string })?.token
    if (!token || typeof token !== 'string') return next(new Error('Missing token'))
    try {
      const payload = verifyToken(token)
      ;(socket.data as { userId: string; username: string }).userId = payload.userId
      ;(socket.data as { userId: string; username: string }).username = payload.username
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket) => {
    const { userId } = socket.data as { userId: string }
    const userRoom = `user:${userId}`
    void socket.join(userRoom)
    void User.updateOne({ _id: userId }, { $set: { status: 'online', lastSeenAt: new Date() } })
    socket.broadcast.emit('presence:update', { userId, status: 'online' })

    socket.on('presence:ping', () => {
      void User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } })
    })

    // ---- chat typing / read (lightweight relay)
    socket.on('chat:typing', (data: { toUserId: string; isTyping: boolean }) => {
      if (!data?.toUserId) return
      io.to(`user:${data.toUserId}`).emit('chat:typing', { from: userId, isTyping: !!data.isTyping })
    })

    // ---- call signaling relay (no media touches server)
    const relayCall = (event: string) => {
      socket.on(event, (data: { toUserId: string; callId?: string; data?: unknown }) => {
        if (!data?.toUserId) return
        io.to(`user:${data.toUserId}`).emit(event.replace('call:', 'call:'), { from: userId, ...data })
      })
    }
    // client emits call:invite / call:accept / call:decline / call:end / call:signal
    // server re-emits as call:incoming / call:accepted / call:declined / call:ended / call:signal
    socket.on('call:invite', (data: { toUserId: string; callId: string }) => {
      if (!data?.toUserId || !data?.callId) return
      io.to(`user:${data.toUserId}`).emit('call:incoming', { from: userId, callId: data.callId })
    })
    socket.on('call:accept', (data: { toUserId: string; callId: string }) => {
      if (!data?.toUserId) return
      io.to(`user:${data.toUserId}`).emit('call:accepted', { from: userId, callId: data.callId })
    })
    socket.on('call:decline', (data: { toUserId: string; callId: string }) => {
      if (!data?.toUserId) return
      io.to(`user:${data.toUserId}`).emit('call:declined', { from: userId, callId: data.callId })
    })
    socket.on('call:end', (data: { toUserId: string; callId: string }) => {
      if (!data?.toUserId) return
      io.to(`user:${data.toUserId}`).emit('call:ended', { from: userId, callId: data.callId })
    })
    socket.on('call:signal', (data: { toUserId: string; callId: string; signal: unknown }) => {
      if (!data?.toUserId || !data?.signal) return
      io.to(`user:${data.toUserId}`).emit('call:signal', { from: userId, callId: data.callId, signal: data.signal })
    })

    // ---- listen party: relay host sync to participants
    socket.on('party:join-room', (data: { partyId: string }) => {
      if (!data?.partyId) return
      void socket.join(`party:${data.partyId}`)
    })
    socket.on('party:leave-room', (data: { partyId: string }) => {
      if (!data?.partyId) return
      void socket.leave(`party:${data.partyId}`)
    })
    socket.on('party:sync', async (data: { partyId: string; playback: { trackIndex: number; positionMs: number; isPlaying: boolean } }) => {
      if (!data?.partyId || !data?.playback) return
      const session = await ListenSession.findById(data.partyId)
      if (!session || String(session.hostId) !== userId) return
      // Only host may sync
      session.playback = { trackIndex: data.playback.trackIndex, positionMs: data.playback.positionMs, isPlaying: data.playback.isPlaying, updatedAt: new Date() } as never
      await session.save()
      // Broadcast to everyone in the room except sender, including timestamp
      socket.to(`party:${data.partyId}`).emit('party:state', { partyId: data.partyId, playback: session.playback, at: Date.now() })
    })
    socket.on('party:queue', async (data: { partyId: string; queue: unknown[] }) => {
      if (!data?.partyId || !Array.isArray(data.queue)) return
      const session = await ListenSession.findById(data.partyId)
      if (!session || String(session.hostId) !== userId) return
      if (data.queue.length > 100) return
      session.queue = data.queue as never
      await session.save()
      io.to(`party:${data.partyId}`).emit('party:queue', { partyId: data.partyId, queue: session.queue })
    })

    // ---- ping for RTT measurement
    socket.on('ping', (cb: (ts: number) => void) => {
      if (typeof cb === 'function') cb(Date.now())
    })

    socket.on('disconnect', () => {
      void User.updateOne({ _id: userId }, { $set: { status: 'offline', lastSeenAt: new Date() } })
      socket.broadcast.emit('presence:update', { userId, status: 'offline' })
    })
  })

  return io
}
