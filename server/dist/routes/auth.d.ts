declare const router: import("express-serve-static-core").Router;
/** Effective presence derived from the user's own choice at connect time. */
export declare function effectiveStatus(pref: string | undefined): 'online' | 'dnd' | 'offline';
/** Tell every friend of `userId` about a presence change. */
export declare function broadcastPresence(userId: string, status: string): Promise<void>;
export default router;
//# sourceMappingURL=auth.d.ts.map