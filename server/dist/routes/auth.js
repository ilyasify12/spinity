import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { signToken } from '../utils/token.js';
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
router.post('/register', body('username').trim().isLength({ min: 3, max: 24 }).matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username must be 3-24 chars: letters, numbers, _ . -'), body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be 6-128 characters'), body('displayName').optional().trim().isLength({ max: 40 }), asyncHandler(async (req, res) => {
    if (handleValidation(req, res))
        return;
    const username = String(req.body.username).toLowerCase().trim();
    const displayName = (req.body.displayName ? String(req.body.displayName).trim() : username) || username;
    const existing = await User.findOne({ username });
    if (existing) {
        res.status(409).json({ error: 'Username already taken' });
        return;
    }
    const passwordHash = await bcrypt.hash(String(req.body.password), 10);
    const user = await User.create({ username, displayName, passwordHash });
    const token = signToken({ userId: String(user._id), username });
    res.json({ token, user: { id: String(user._id), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl } });
}));
router.post('/login', body('username').trim().notEmpty(), body('password').notEmpty(), asyncHandler(async (req, res) => {
    if (handleValidation(req, res))
        return;
    const username = String(req.body.username).toLowerCase().trim();
    const user = await User.findOne({ username });
    // Same error for unknown user and bad password
    if (!user || !(await bcrypt.compare(String(req.body.password), user.passwordHash))) {
        res.status(401).json({ error: 'Incorrect username or password' });
        return;
    }
    const token = signToken({ userId: String(user._id), username: user.username });
    await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: new Date(), status: 'online' } });
    res.json({ token, user: { id: String(user._id), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl } });
}));
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await User.findById(req.userId);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json({ id: String(user._id), username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl });
}));
export default router;
//# sourceMappingURL=auth.js.map