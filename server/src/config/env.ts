import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

try {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const serverRoot = path.resolve(here, '..', '..')
  dotenv.config({ path: path.join(serverRoot, '.env') })
  if (!process.env.MONGODB_URI) dotenv.config()
} catch {}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} environment variable is required`)
  return v
}

export const env = {
  get MONGODB_URI(): string { return required('MONGODB_URI') },
  get PORT(): number { return Number(process.env.PORT ?? 3000) },
  get NODE_ENV(): string { return process.env.NODE_ENV ?? 'development' },
  get JWT_SECRET(): string {
    const s = process.env.JWT_SECRET ?? 'spinity-dev-secret-change-in-production'
    if (s === 'spinity-dev-secret-change-in-production' && (process.env.NODE_ENV === 'production')) {
      throw new Error('JWT_SECRET must be changed in production')
    }
    if (s === 'spinity-dev-secret-change-in-production') {
      console.warn('[env] Using default JWT_SECRET — change it before deploying')
    }
    return s
  },
  get JWT_EXPIRES_IN(): string { return process.env.JWT_EXPIRES_IN ?? '7d' },
  get CLIENT_URL(): string { return process.env.CLIENT_URL ?? 'http://localhost:5173' },
  get STUN_SERVERS(): { urls: string }[] {
    const raw = process.env.STUN_SERVERS
    if (!raw) return [{ urls: 'stun:stun.l.google.com:19302' }]
    try {
      const parsed = JSON.parse(raw) as { urls: string }[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    } catch {}
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  },
  get TURN_URL(): string | null { return process.env.TURN_URL ?? null },
  get TURN_USERNAME(): string | null { return process.env.TURN_USERNAME ?? null },
  get TURN_CREDENTIAL(): string | null { return process.env.TURN_CREDENTIAL ?? null }
}
