import type { Request, Response, NextFunction } from 'express'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[api] error', err)
  if (err instanceof Error && 'status' in err) {
    const status = Number((err as { status: number }).status) || 500
    res.status(status).json({ error: err.message })
    return
  }
  const message = err instanceof Error ? err.message : 'Internal server error'
  // Don't leak stack in production; do log it above
  res.status(500).json({ error: message })
}
