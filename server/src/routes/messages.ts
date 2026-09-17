import { Router } from 'express'
import { body, query, validationResult } from 'express-validator'
import mongoose from 'mongoose'
import { Conversation } from '../models/Conversation.js'
import { Message } from '../models/Message.js'
import { Friendship } from '../models/Friendship.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

function handleValidation(req: import('express').Request, res: import('express').Response): boolean {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg as string }); return true }
  return false
}

function sortedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a] }

async function areFriends(a: string, b: string): Promise<boolean> {
  const [userA, userB] = sortedPair(a, b)
  return !!(await Friendship.findOne({ userA, userB }))
}

async function getOrCreateConversation(a: string, b: string) {
  const [p0, p1] = sortedPair(a, b)
  let conv = await Conversation.findOne({ participants: [p0, p1] })
  if (!conv) conv = await Conversation.create({ participants: [p0, p1] })
  return conv
}

// GET /api/messages/conversations
router.get('/conversations', asyncHandler(async (req: AuthRequest, res) => {
  const convs = await Conversation.find({ participants: req.userId }).sort({ lastMessageAt: -1 }).lean()
  // Attach unread count
  const result: unknown[] = []
  for (const c of convs) {
    const unread = await Message.countDocuments({ conversationId: c._id, readBy: { $ne: new mongoose.Types.ObjectId(req.userId) }, senderId: { $ne: new mongoose.Types.ObjectId(req.userId) } })
    const otherId = String(c.participants.find(p => String(p) !== req.userId))
    result.push({ id: String(c._id), otherId, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview, unread })
  }
  res.json(result)
}))

// GET /api/messages/:conversationId?before=&limit=50
router.get('/:conversationId', query('limit').optional().isInt({ min: 1, max: 100 }), asyncHandler(async (req: AuthRequest, res) => {
  const conv = await Conversation.findById(req.params.conversationId)
  if (!conv || !conv.participants.map(String).includes(req.userId!)) { res.status(404).json({ error: 'Conversation not found' }); return }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
  const before = req.query.before ? new Date(String(req.query.before)) : null
  const filter: Record<string, unknown> = { conversationId: conv._id }
  if (before && !isNaN(before.getTime())) (filter as { createdAt: unknown }).createdAt = { $lt: before }
  const msgs = await Message.find(filter).sort({ createdAt: -1 }).limit(limit).lean()
  res.json(msgs.reverse().map(m => ({
    id: String(m._id), conversationId: String(m.conversationId), senderId: String(m.senderId),
    kind: m.kind, body: m.body, payload: m.payload, readBy: m.readBy.map(String), createdAt: m.createdAt
  })))
}))

// POST /api/messages/send { toUserId?, conversationId?, kind, body?, payload? }
router.post('/send', body('kind').isIn(['text', 'playlist', 'track']), body('body').optional().isString().isLength({ max: 4000 }), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const kind = String(req.body.kind) as 'text' | 'playlist' | 'track'
  const bodyText = req.body.body ? String(req.body.body).trim().slice(0, 4000) : null
  const payload = req.body.payload ?? null

  if (kind === 'text' && !bodyText) { res.status(400).json({ error: 'Message body required' }); return }
  if ((kind === 'playlist' || kind === 'track') && !payload) { res.status(400).json({ error: 'Payload required for share' }); return }
  if (payload?.tracks && (!Array.isArray(payload.tracks) || payload.tracks.length > 100)) { res.status(400).json({ error: 'Too many tracks (max 100)' }); return }

  let conversationId = req.body.conversationId ? String(req.body.conversationId) : null
  let conv = conversationId ? await Conversation.findById(conversationId) : null

  if (!conv) {
    const toUserId = req.body.toUserId ? String(req.body.toUserId) : null
    if (!toUserId) { res.status(400).json({ error: 'toUserId or conversationId required' }); return }
    if (toUserId === req.userId) { res.status(400).json({ error: "Can't message yourself" }); return }
    if (!await areFriends(req.userId!, toUserId)) { res.status(403).json({ error: 'You can only message friends' }); return }
    conv = await getOrCreateConversation(req.userId!, toUserId)
  } else {
    if (!conv.participants.map(String).includes(req.userId!)) { res.status(403).json({ error: 'Not a participant' }); return }
  }

  const msg = await Message.create({
    conversationId: conv._id, senderId: req.userId, kind,
    body: bodyText, payload: payload ?? null, readBy: [req.userId]
  })
  const preview = kind === 'text' ? (bodyText ?? '') : kind === 'playlist' ? `🎵 Playlist: ${payload?.name ?? 'shared'}` : `🎵 Track shared`
  conv.lastMessageAt = new Date(); conv.lastMessagePreview = preview.slice(0, 120); await conv.save()

  res.json({ id: String(msg._id), conversationId: String(conv._id), senderId: req.userId, kind, body: bodyText, payload, createdAt: msg.createdAt })
}))

router.post('/:conversationId/read', asyncHandler(async (req: AuthRequest, res) => {
  const conv = await Conversation.findById(req.params.conversationId)
  if (!conv || !conv.participants.map(String).includes(req.userId!)) { res.status(404).json({ error: 'Conversation not found' }); return }
  await Message.updateMany({ conversationId: conv._id, readBy: { $ne: new mongoose.Types.ObjectId(req.userId) } }, { $addToSet: { readBy: new mongoose.Types.ObjectId(req.userId) } })
  res.json({ ok: true })
}))

export default router
