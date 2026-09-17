import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { env } from './config/env.js';
import { connectMongo } from './config/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import friendsRoutes from './routes/friends.js';
import messagesRoutes from './routes/messages.js';
import callsRoutes from './routes/calls.js';
import partiesRoutes from './routes/parties.js';
import { createSocketServer } from './socket/index.js';
const app = express();
app.use(cors({ origin: env.CLIENT_URL === '*' ? true : env.CLIENT_URL.split(',').map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/parties', partiesRoutes);
// 404 for unknown API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);
const httpServer = createServer(app);
createSocketServer(httpServer, env.CLIENT_URL);
const port = env.PORT;
async function start() {
    await connectMongo();
    console.log('[mongo] connected');
    httpServer.listen(port, '0.0.0.0', () => console.log(`[server] listening on 0.0.0.0:${port} -> external http://node1.waifly.com:${port}`));
}
start().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map