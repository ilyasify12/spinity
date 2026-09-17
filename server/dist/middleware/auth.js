import { verifyToken } from '../utils/token.js';
export function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    try {
        const payload = verifyToken(token);
        req.userId = payload.userId;
        req.username = payload.username;
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
//# sourceMappingURL=auth.js.map