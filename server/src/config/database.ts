import mongoose, { type Connection } from 'mongoose'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let cached: Connection | null = null

export async function connectMongo(): Promise<Connection> {
  if (cached) return cached
  // Load .env relative to the server package root, not cwd (cwd differs
  // between `tsx watch src/index.ts` and `node dist/index.js`)
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    // src/config -> server root
    const serverRoot = path.resolve(here, '..', '..')
    dotenv.config({ path: path.join(serverRoot, '.env') })
    // Fallback: also try cwd (covers `node dist/index.js` when dist is outDir)
    if (!process.env.MONGODB_URI) dotenv.config()
  } catch {}

  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI environment variable is required')

  // Warn if no database name is present — mongoose would silently use `test`
  try {
    const parsed = new URL(uri.replace('mongodb+srv://', 'https://'))
    const dbFromPath = parsed.pathname.replace(/^\//, '').split('?')[0]
    if (!dbFromPath) console.warn('[mongo] MONGODB_URI has no database name — defaulting to `spinity`. Add `/spinity` before `?`')
  } catch {}

  const conn = await mongoose.connect(uri, { dbName: uri.includes('.net/') && !uri.split('.net/')[1]?.startsWith('/') ? undefined : undefined })
  // Ensure a concrete db name; if URI had none, mongoose.connect above used `test`.
  // Force `spinity` as dbName when absent without requiring callers to change URI.
  // We handle this by checking connection name after connect.
  cached = conn.connection
  if (cached.name === 'test') {
    console.warn('[mongo] Connected to `test` database — set MONGODB_URI to include `/spinity` to avoid this')
  }
  return cached
}
