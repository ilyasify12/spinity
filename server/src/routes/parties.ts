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

/**
 * Drop queue entries guests could never play (no videoId/webUrl, e.g.
 * local-only files) instead of failing the whole request with a validation
 * dump like `queue.14.webUrl: Path 'webUrl' is required`.
 */
function cleanQueue(input: unknown): { videoId: string; title: string; artist: string; durationSec: number; thumbnail: string; webUrl: string }[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      videoId: String(t.videoId ?? ''),
      title: String(t.title ?? 'Untitled'),
      artist: String(t.artist ?? 'Unknown artist'),
      durationSec: Number(t.durationSec ?? 0) || 0,
      thumbnail: String(t.thumbnail ?? ''),
      webUrl: String(t.webUrl ?? '')
    }))
    .filter((t) => !!t.videoId && !!t.webUrl)
    .slice(0, 100)
}

function toView(session: {
  _id: unknown; code: string; hostId: unknown; queue: unknown[];
  playback: unknown; participants: { userId: unknown }[]; endedAt?: unknown; isPrivate?: boolean
}): Record<string, unknown> {
  return {
    id: String(session._id),
    code: session.code,
    hostId: String(session.hostId),
    queue: session.queue,
    playback: session.playback,
    participants: session.participants.map(p => String(p.userId)),
    endedAt: session.endedAt ?? null,
    isPrivate: session.isPrivate ?? false
  }
}

async function memberViews(participantIds: string[]): Promise<{ id: string; username: string; displayName: string; status?: string }[]> {
  if (participantIds.length === 0) return []
  const { User } = await import('../models/User.js')
  const users = await User.find({ _id: { $in: participantIds } }).lean()
  const byId = new Map(users.map(u => [String(u._id), u]))
  return participantIds.map(id => {
    const u = byId.get(id) as unknown as { username?: string; displayName?: string; status?: string } | undefined
    return { id, username: u?.username ?? id.slice(0, 8), displayName: u?.displayName ?? (u?.username ?? id.slice(0, 8)), status: u?.status ?? 'online' }
  })
}

router.post('/create', body('queue').optional().isArray({ max: 100 }), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const queue = cleanQueue(req.body.queue)
  let c = code()
  // Ensure uniqueness (retry up to 5 times)
  for (let i = 0; i < 5; i++) {
    if (!await ListenSession.findOne({ code: c, endedAt: null })) break
    c = code()
  }
  const session = await ListenSession.create({ code: c, hostId: req.userId, participants: [{ userId: req.userId }], queue })
  const ids = session.participants.map(p => String(p.userId))
  res.json({ ...toView(session as never), members: await memberViews(ids) })
}))

// Parties I'm currently in (for restoring state after navigation / restart)
router.get('/my/active', asyncHandler(async (req: AuthRequest, res) => {
  const sessions = await ListenSession.find({ endedAt: null, 'participants.userId': req.userId }).sort({ updatedAt: -1 }).limit(1)
  const session = sessions[0]
  if (!session) { res.json({ party: null }); return }
  const ids = session.participants.map(p => String(p.userId))
  res.json({ party: { ...toView(session as never), members: await memberViews(ids) } })
}))

router.post('/join', body('code').trim().notEmpty().isLength({ min: 4, max: 8 }), asyncHandler(async (req: AuthRequest, res) => {
  if (handleValidation(req, res)) return
  const c = String(req.body.code).toUpperCase().trim()
  const session = await ListenSession.findOne({ code: c, endedAt: null })
  if (!session) { res.status(404).json({ error: 'Party not found — check the code' }); return }
  if (session.isPrivate) {
    const [a, b] = sortedPair(req.userId!, String(session.hostId))
    if (!await Friendship.findOne({ userA: a, userB: b })) { res.status(403).json({ error: 'Private party — host must be your friend' }); return }
  }
  if (!session.participants.some(p => String(p.userId) === req.userId)) {
    ;(session.participants as unknown as { userId: unknown; joinedAt: Date }[]).push({ userId: req.userId, joinedAt: new Date() })
    await session.save()
  }
  const ids = session.participants.map(p => String(p.userId))
  res.json({ ...toView(session as never), members: await memberViews(ids) })
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
  const ids = session.participants.map(p => String(p.userId))
  res.json({ ...toView(session as never), members: await memberViews(ids) })
}))

export default router
