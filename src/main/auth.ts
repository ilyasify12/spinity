import crypto from 'node:crypto'

/**
 * Local password hashing using Node's built-in scrypt.
 *
 * Why not bcrypt/argon2: both are native addons, which would drag in the
 * node-gyp toolchain we are deliberately avoiding. scrypt is a memory-hard
 * KDF built into Node, so it needs no dependency and is a sound choice for
 * local account storage.
 *
 * Format stored: `scrypt$N$r$p$<saltHex>$<hashHex>`
 * Parameters are embedded so they can be raised later without invalidating
 * existing accounts.
 */

const N = 16384 // CPU/memory cost
const R = 8 // block size
const P = 1 // parallelisation
const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    const salt = Buffer.from(parts[4], 'hex')
    const expected = Buffer.from(parts[5], 'hex')

    const derived = crypto.scryptSync(password, salt, expected.length, { N: n, r, p })
    // Constant-time compare to avoid leaking hash bytes via timing.
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function newId(): string {
  return crypto.randomUUID()
}
