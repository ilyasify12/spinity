import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import mongoose from 'mongoose'
import { Conversation } from '../models/Conversation.js'
import { ChatImage } from '../models/ChatImage.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const MAX_BYTES = 5 * 1024 * 1024
const TTL_MS = 3 * 24 * 60 * 60 * 1000
const ALLOWED = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp']
])

function handleValidation(req: import('express').Request, res: import('express').Response): boolean {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg as string }); return true }
  return false
}

function sortedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a] }

async function getOrCreateConversation(a: string, b: string) {
  const [p0, p1] = sortedPair(a, b)
  let conv = await Conversation.findOne({ participants: [p0, p1] })
  if (!conv) conv = await Conversation.create({ participants: [p0, p1] })
  return conv
}

/** Resolve the target conversation exactly like POST /messages/send does. */
async function resolveConv(req: AuthRequest, res: import('express').Response) {
  let conversationId = req.body.conversationId ? String(req.body.conversationId) : null
  const conv = conversationId ? await Conversation.findById(conversationId) : null
  if (conv) {
    if (!conv.participants.map(String).includes(req.userId!)) { res.status(403).json({ error: 'Not a participant' }); return null }
    return conv
  }
  const toUserId = req.body.toUserId ? String(req.body.toUserId) : null
  if (!toUserId) { res.status(400).json({ error: 'toUserId or conversationId required' }); return null }
  if (toUserId === req.userId) { res.status(400).json({ error: "Can't message yourself" }); return }
  if (!mongoose.Types.ObjectId.isValid(toUserId)) { res.status(400).json({ error: 'Invalid user id' }); return }
  const { Friendship } = await import('../models/Friendship.js')
  const [userA, userB] = sortedPair(req.userId!, toUserId)
  if (!await Friendship.findOne({ userA, userB })) { res.status(403).json({ error: 'You can only message friends' }); return null }
  return getOrCreateConversation(req.userId!, toUserId)
}

// POST /api/images { toUserId?, conversationId?, dataUrl } — 5 MB max, auto-deletes after 3 days unless pinned.
router.post(
  '/',
  body('dataUrl').isString().notEmpty().withMessage('Image required'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (handleValidation(req, res)) return
    const conv = await resolveConv(req, res)
    if (!conv) return
    const dataUrl = String(req.body.dataUrl)
    const match = /^data:(image\/(png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!match) { res.status(400).json({ error: 'Send a PNG, JPG, GIF or WebP image' }); return }
    const contentType = match[1]
    if (!ALLOWED.has(contentType)) { res.status(400).json({ error: 'Send a PNG, JPG, GIF or WebP image' }); return }
    const data = Buffer.from(match[3], 'base64')
    if (data.length === 0 || data.length > MAX_BYTES) { res.status(400).json({ error: 'Image is too big (max 5 MB)' }); return }
    const img = await ChatImage.create({
      conversationId: conv._id, senderId: req.userId, contentType,
      size: data.length, data, pinned: false, expiresAt: new Date(Date.now() + TTL_MS)
    })
    res.json({ imageId: String(img._id), conversationId: String(conv._id), expiresAt: img.expiresAt })
  })
)

// GET /api/images/:id — raw bytes, participants only.
router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(404).json({ error: 'Image not found' }); return }
  const img = await ChatImage.findById(req.params.id)
  if (!img) { res.status(410).json({ error: 'This image auto-deleted after 3 days' }); return }
  const conv = await Conversation.findById(img.conversationId)
  if (!conv || !conv.participants.map(String).includes(req.userId!)) { res.status(403).json({ error: 'Not a participant' }); return }
  res.setHeader('Content-Type', img.contentType)
  res.setHeader('Content-Length', String(img.size))
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.send(img.data)
}))

// PATCH /api/images/:id { pinned: boolean } — pin keeps it forever, unpin re-arms 3 days.
router.patch(
  '/:id',
  body('pinned').isBoolean().withMessage('pinned must be true or false'),
  asyncHandler(async (req: AuthRequest, res) => {
    if (handleValidation(req, res)) return
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(404).json({ error: 'Image not found' }); return }
    const img = await ChatImage.findById(req.params.id)
    if (!img) { res.status(410).json({ error: 'This image auto-deleted after 3 days' }); return }
    const conv = await Conversation.findById(img.conversationId)
    if (!conv || !conv.participants.map(String).includes(req.userId!)) { res.status(403).json({ error: 'Not a participant' }); return }
    const pinned = req.body.pinned === true
    img.pinned = pinned
    img.expiresAt = pinned ? null : new Date(Date.now() + TTL_MS)
    await img.save()
    res.json({ imageId: String(img._id), pinned, expiresAt: img.expiresAt })
  })
)

export default router
