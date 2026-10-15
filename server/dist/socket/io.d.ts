import type { Server } from 'socket.io';
export declare function setIo(server: Server): void;
export declare function getIo(): Server | null;
/** Best-effort push to one user's room (notifications, presence, deletions). */
export declare function emitToUser(userId: string, event: string, data: unknown): void;
//# sourceMappingURL=io.d.ts.map