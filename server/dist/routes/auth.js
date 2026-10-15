import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Friendship } from '../models/Friendship.js';
import { signToken } from '../utils/token.js';
import { emitToUser } from '../socket/io.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
const router = Router();
function handleValidation(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ error: errors.array()[0].msg });
        return true;
    }
    return false;
}
function publicUser(u) {
    return {
        id: String(u._id), username: u.username, email: u.email ?? null,
        displayName: u.displayName, avatarUrl: u.avatarUrl ?? null,
        status: u.status ?? 'offline', statusPref: u.statusPref ?? 'online'
    };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Effective presence derived from the user's own choice at connect time. */
export function effectiveStatus(pref) {
    if (pref === 'invisible')
        return 'offline';
    if (pref === 'dnd')
        return 'dnd';
    return 'online';
}
/** Tell every friend of `userId` about a presence change. */
export async function broadcastPresence(userId, status) {
    try {
        const links = await Friendship.find({ $or: [{ userA: userId }, { userB: userId }] }).lean();
        const others = new Set();
        for (const l of links) {
            const a = String(l.userA);
            const b = String(l.userB);
            others.add(a === userId ? b : a);
        }
        for (const other of others)
            emitToUser(other, 'presence:update', { userId, status });
    }
    catch { }
}
router.post('/register', body('username').trim().isLength({ min: 3, max: 24 }).matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username must be 3-24 chars: letters, numbers, _ . -'), body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email address'), body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be 6-128 characters'), body('displayName').optional().trim().isLength({ max: 40 }), asyncHandler(async (req, res) => {
    if (handleValidation(req, res))
        return;
    const username = String(req.body.username).toLowerCase().trim();
    const email = String(req.body.email).toLowerCase().trim();
    const displayName = (req.body.displayName ? String(req.body.displayName).trim() : username) || username;
    if (await User.findOne({ username })) {
        res.status(409).json({ error: 'Username already taken' });
        return;
    }
    if (await User.findOne({ email })) {
        res.status(409).json({ error: 'That email is already registered — sign in instead' });
        return;
    }
    const passwordHash = await bcrypt.hash(String(req.body.password), 10);
    const user = await User.create({ username, email, displayName, passwordHash });
    const token = signToken({ userId: String(user._id), username });
    res.json({ token, user: publicUser(user) });
}));
router.post('/login', body('username').trim().notEmpty(), body('password').notEmpty(), asyncHandler(async (req, res) => {
    if (handleValidation(req, res))
        return;
    // 1.0: one login — username OR email in the same field.
    const login = String(req.body.username).toLowerCase().trim();
    const user = EMAIL_RE.test(login)
        ? await User.findOne({ email: login })
        : await User.findOne({ username: login });
    // Same error for unknown user and bad password
    if (!user || !(await bcrypt.compare(String(req.body.password), user.passwordHash))) {
        res.status(401).json({ error: 'Incorrect email/username or password' });
        return;
    }
    const token = signToken({ userId: String(user._id), username: user.username });
    const status = effectiveStatus(user.statusPref);
    await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date(), status } });
    res.json({ token, user: publicUser({ ...user.toObject(), status }) });
}));
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(publicUser(user));
}));
// Rename display name (mirrors to friends immediately).
router.patch('/profile', body('displayName').trim().isLength({ min: 1, max: 40 }).withMessage('Display name must be 1-40 characters'), asyncHandler(async (req, res) => {
    if (handleValidation(req, res))
        return;
    const user = await User.findByIdAndUpdate(req.userId, { $set: { displayName: String(req.body.displayName).trim() } }, { new: true });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(publicUser(user));
}));
// Presence preference: online | dnd | invisible. Applies immediately and is
// remembered, so reconnects restore it automatically.
router.post('/status', body('status').isIn(['online', 'dnd', 'invisible']).withMessage('Unknown status'), asyncHandler(async (req, res) => {
    if (handleValidation(req, res))
        return;
    const pref = String(req.body.status);
    const status = effectiveStatus(pref);
    await User.updateOne({ _id: req.userId }, { $set: { statusPref: pref, status, lastSeenAt: new Date() } });
    await broadcastPresence(req.userId, status);
    res.json({ status, statusPref: pref });
}));
export default router;
//# sourceMappingURL=auth.js.map