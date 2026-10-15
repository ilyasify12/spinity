/**
 * The live socket.io server, shared with REST routes that need to push
 * realtime events (e.g. delivering a chat message to its recipient).
 * Set once by createSocketServer; routes must tolerate null (tests, boot).
 */
let io = null;
export function setIo(server) {
    io = server;
}
export function getIo() {
    return io;
}
/** Best-effort push to one user's room (notifications, presence, deletions). */
export function emitToUser(userId, event, data) {
    try {
        io?.to(`user:${userId}`).emit(event, data);
    }
    catch { }
}
//# sourceMappingURL=io.js.map