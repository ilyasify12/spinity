import type { Server } from 'socket.io'

/**
 * The live socket.io server, shared with REST routes that need to push
 * realtime events (e.g. delivering a chat message to its recipient).
 * Set once by createSocketServer; routes must tolerate null (tests, boot).
 */
let io: Server | null = null

export function setIo(server: Server): void {
  io = server
}

export function getIo(): Server | null {
  return io
}

/** Best-effort push to one user's room (notifications, presence, deletions). */
export function emitToUser(userId: string, event: string, data: unknown): void {
  try {
    io?.to(`user:${userId}`).emit(event, data)
  } catch {}
}
