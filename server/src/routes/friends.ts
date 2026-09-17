import { Router } from 'express'
import { body, query, validationResult } from 'express-validator'
import mongoose from 'mongoose'
import { User } from '../models/User.js'
import { FriendRequest } from '../models/FriendRequest.js'
import { Friendship } from '../models/Friendship.js'
import { Block } from '../models/Block.js'
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

// GET /api/friends/search?q=ilyas
router.get('/search', query('q').trim().isLength({ min: 2 }).withMessage('Search needs at least 2 characters'), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const q = String(req.query.q ?? '').trim()
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'i')
  const blockedIds = await Block.find({ blocker: req.userId }).then(r => r.map(x => String(x.blocked)))
  const blockedByIds = await Block.find({ blocked: req.userId }).then(r => r.map(x => String(x.blocker)))
  const exclude = new Set([req.userId!, ...blockedIds, ...blockedByIds])
  const users = await User.find({ $or: [{ username: re }, { displayName: re }] }).limit(20).lean()
  const filtered = users.filter(u => !exclude.has(String(u._id))).slice(0, 12)
  res.json(filtered.map(u => ({ id: String(u._id), username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, status: u.status })))
}))

// POST /api/friends/request { toUserId, message? }
router.post('/request', body('toUserId').notEmpty(), body('message').optional().isString().isLength({ max: 200 }), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const toId = String(req.body.toUserId)
  const fromId = req.userId!
  if (toId === fromId) { res.status(400).json({ error: "You can't add yourself" }); return }
  if (!mongoose.Types.ObjectId.isValid(toId)) { res.status(400).json({ error: 'Invalid user id' }); return }
  const target = await User.findById(toId)
  if (!target) { res.status(404).json({ error: 'User not found' }); return }
  if (await Block.findOne({ $or: [{ blocker: fromId, blocked: toId }, { blocker: toId, blocked: fromId }] })) {
    res.status(403).json({ error: 'Cannot send request to this user' }); return
  }
  const [a, b] = sortedPair(fromId, toId)
  if (await Friendship.findOne({ userA: a, userB: b })) { res.status(409).json({ error: 'Already friends' }); return }
  // If reverse pending exists, auto-accept instead of creating duplicate
  const reverse = await FriendRequest.findOne({ from: toId, to: fromId, status: 'pending' })
  if (reverse) {
    reverse.status = 'accepted'; reverse.respondedAt = new Date(); await reverse.save()
    await Friendship.create({ userA: a, userB: b })
    res.json({ autoAccepted: true, requestId: String(reverse._id) }); return
  }
  if (await FriendRequest.findOne({ from: fromId, to: toId, status: 'pending' })) { res.status(409).json({ error: 'Request already pending' }); return }
  // Reuse cancelled/declined slot
  await FriendRequest.deleteMany({ from: fromId, to: toId, status: { $in: ['cancelled', 'declined'] } })
  const reqDoc = await FriendRequest.create({ from: fromId, to: toId, message: req.body.message ?? null })
  res.json({ id: String(reqDoc._id), status: reqDoc.status })
}))

// POST /api/friends/respond { requestId, accept: boolean }
router.post('/respond', body('requestId').notEmpty(), body('accept').isBoolean(), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const fr = await FriendRequest.findById(String(req.body.requestId))
  if (!fr || String(fr.to) !== req.userId) { res.status(404).json({ error: 'Request not found' }); return }
  if (fr.status !== 'pending') { res.status(409).json({ error: 'Already responded' }); return }
  const accept = Boolean(req.body.accept)
  fr.status = accept ? 'accepted' : 'declined'
  fr.respondedAt = new Date(); await fr.save()
  if (accept) {
    const [a, b] = sortedPair(String(fr.from), String(fr.to))
    if (!await Friendship.findOne({ userA: a, userB: b })) await Friendship.create({ userA: a, userB: b })
  }
  res.json({ status: fr.status })
}))

router.post('/cancel', body('requestId').notEmpty(), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const fr = await FriendRequest.findById(String(req.body.requestId))
  if (!fr || String(fr.from) !== req.userId) { res.status(404).json({ error: 'Request not found' }); return }
  if (fr.status !== 'pending') { res.status(409).json({ error: 'Already responded' }); return }
  fr.status = 'cancelled'; fr.respondedAt = new Date(); await fr.save()
  res.json({ status: fr.status })
}))

router.get('/requests', asyncHandler(async (req: AuthRequest, res) => {
  const [incoming, outgoing] = await Promise.all([
    FriendRequest.find({ to: req.userId, status: 'pending' }).populate('from', 'username displayName avatarUrl').lean(),
    FriendRequest.find({ from: req.userId, status: 'pending' }).populate('to', 'username displayName avatarUrl').lean()
  ])
  res.json({
    incoming: incoming.map(r => ({ id: String(r._id), from: r.from as unknown as { _id: unknown; username: string; displayName: string }, message: r.message, createdAt: r.createdAt })),
    outgoing: outgoing.map(r => ({ id: String(r._id), to: r.to as unknown as { _id: unknown; username: string; displayName: string }, createdAt: r.createdAt }))
  })
}))

router.get('/list', asyncHandler(async (req: AuthRequest, res) => {
  const friendships = await Friendship.find({ $or: [{ userA: req.userId }, { userB: req.userId }] }).lean()
  const friendIds = friendships.map(f => String(f.userA) === req.userId ? String(f.userB) : String(f.userA))
  const users = await User.find({ _id: { $in: friendIds } }).lean()
  res.json(users.map(u => ({ id: String(u._id), username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, status: u.status, lastSeenAt: u.lastSeenAt })))
}))

router.delete('/:friendId', asyncHandler(async (req: AuthRequest, res) => {
  const friendId = String(req.params.friendId)
  const [a, b] = sortedPair(req.userId!, friendId)
  await Friendship.deleteOne({ userA: a, userB: b })
  res.json({ ok: true })
}))

router.post('/block', body('userId').notEmpty(), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const target = String(req.body.userId)
  if (target === req.userId) { res.status(400).json({ error: "Can't block yourself" }); return }
  const [a, b] = sortedPair(req.userId!, target)
  await Friendship.deleteOne({ userA: a, userB: b })
  await FriendRequest.deleteMany({ $or: [{ from: req.userId, to: target }, { from: target, to: req.userId }], status: 'pending' })
  await Block.updateOne({ blocker: req.userId, blocked: target }, { $setOnInsert: { blocker: req.userId, blocked: target } }, { upsert: true })
  res.json({ ok: true })
}))

router.delete('/block/:userId', asyncHandler(async (req: AuthRequest, res) => {
  await Block.deleteOne({ blocker: req.userId, blocked: String(req.params.userId) })
  res.json({ ok: true })
}))

export default router
