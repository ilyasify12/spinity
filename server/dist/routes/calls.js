import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
const router = Router();
router.get('/ice', requireAuth, (_req, res) => {
    const iceServers = [...env.STUN_SERVERS];
    if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
        iceServers.push({ urls: env.TURN_URL, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
    }
    res.json({ iceServers });
});
export default router;
//# sourceMappingURL=calls.js.map