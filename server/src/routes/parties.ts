import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { ListenSession } from '../models/ListenSession.js'
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

function code(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function sortedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a] }

router.post('/create', body('queue').optional().isArray({ max: 100 }), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const queue = Array.isArray(req.body.queue) ? req.body.queue : []
  let c = code()
  // Ensure uniqueness (retry up to 5 times)
  for (let i = 0; i < 5; i++) {
    if (!await ListenSession.findOne({ code: c, endedAt: null })) break
    c = code()
  }
  const session = await ListenSession.create({ code: c, hostId: req.userId, participants: [{ userId: req.userId }], queue })
  res.json({ id: String(session._id), code: session.code, hostId: String(session.hostId), queue: session.queue, playback: session.playback })
}))

router.post('/join', body('code').trim().notEmpty().isLength({ min: 4, max: 8 }), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const c = String(req.body.code).toUpperCase().trim()
  const session = await ListenSession.findOne({ code: c, endedAt: null })
  if (!session) { res.status(404).json({ error: 'Party not found' }); return }
  if (session.isPrivate) {
    const [a, b] = sortedPair(req.userId!, String(session.hostId))
    if (!await Friendship.findOne({ userA: a, userB: b })) { res.status(403).json({ error: 'Private party — host must be your friend' }); return }
  }
  if (!session.participants.some(p => String(p.userId) === req.userId)) {
    ;(session.participants as unknown as { userId: unknown; joinedAt: Date }[]).push({ userId: req.userId, joinedAt: new Date() })
    await session.save()
  }
  res.json({ id: String(session._id), code: session.code, hostId: String(session.hostId), queue: session.queue, playback: session.playback, participants: session.participants.map(p => String(p.userId)) })
}))

router.post('/:id/leave', asyncHandler(async (req: AuthRequest, res) => {
  const session = await ListenSession.findById(req.params.id)
  if (!session || session.endedAt) { res.status(404).json({ error: 'Party not found' }); return }
  ;(session as unknown as { participants: unknown[] }).participants = session.participants.filter(p => String((p as { userId: unknown }).userId) !== req.userId) as never
  // If host leaves, end the party
  if (String(session.hostId) === req.userId) session.endedAt = new Date() as unknown as null
  else if (session.participants.length === 0) session.endedAt = new Date() as unknown as null
  await session.save()
  res.json({ ok: true, ended: !!session.endedAt })
}))

router.get('/:id', asyncHandler(async (req: AuthRequest, res) => {
  const session = await ListenSession.findById(req.params.id)
  if (!session) { res.status(404).json({ error: 'Party not found' }); return }
  res.json({ id: String(session._id), code: session.code, hostId: String(session.hostId), queue: session.queue, playback: session.playback, participants: session.participants.map(p => String(p.userId)), endedAt: session.endedAt })
}))

export default router
