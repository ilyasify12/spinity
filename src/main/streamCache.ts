import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FreeStats } from '../shared/types'

/**
 * Stream cache — one network pass per URL, teed to the audio element AND disk.
 *
 * The problem this solves: preview clips (and Creative Commons catalogue
 * tracks) live on remote CDNs. Pointing `<audio>` straight at them costs a
 * TLS handshake + CDN round trip on every play, and replaying the same row
 * pays it again.
 *
 * The pipeline:
 *
 *   spinity://stream/?u=<cdnaudio>          (renderer, <audio src>)
 *        └─ main protocol handler
 *            └─ cache.open(url)  — fetch once, write-through
 *                ├─ growing file  → served to the audio element immediately
 *                │                  (first audio ≈ first network bytes)
 *                └─ disk copy     → every replay is served locally, ~0 ms
 *
 * One download, two consumers: the element streams the file while it is
 * still growing (the read side polls `received`, the write side advances it),
 * and once complete the file is a normal cache entry with LRU eviction.
 *
 * Deliberately electron-free: paths and limits arrive through options so the
 * whole state machine is unit-testable against a local HTTP server.
 */

export interface StreamSession {
  /** sha1(url) prefix — also the protocol URL key. */
  key: string
  url: string
  /** Payload path (`<key>.bin`); grows while the download is in flight. */
  file: string
  /** Sidecar JSON with url + content type + size (written on completion). */
  meta: string
  /** Content-Length when the server sent one, else the received size. */
  total: number
  /** Bytes written to disk so far — the readable prefix of the file. */
  received: number
  done: boolean
  error: string | null
  contentType: string
  /** ms from fetch start to the first body byte (null until it lands). */
  firstByteMs: number | null
  startedAt: number
  lastUsed: number
  /** Active readers (protocol responses); never evicted while > 0. */
  serving: number
  /** True when this open() was satisfied from disk (no network). */
  cached: boolean
  /** Resolves when the download completes; rejects with its error. */
  promise: Promise<void>
}

export interface StreamCacheOptions {
  /** Directory for `<key>.bin` + `<key>.json` entries. */
  dir: string
  /** Soft cap for the on-disk cache; LRU eviction beyond it. */
  maxBytes?: number
  /** Gap with no bytes that aborts a stalled download. */
  idleMs?: number
  /** Time allowed to receive the response headers. */
  connectMs?: number
  /** Hosts the cache may fetch; everything else is refused. */
  hostFilter?: (hostname: string) => boolean
}

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_IDLE_MS = 10_000
const DEFAULT_CONNECT_MS = 8_000
const READ_CHUNK = 256 * 1024
/** Rolling latency window for the telemetry numbers. */
const LATENCY_WINDOW = 100

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((n, v) => n + v, 0) / values.length)
}

export function createStreamCache(options: StreamCacheOptions) {
  const dir = options.dir
  fs.mkdirSync(dir, { recursive: true })
  let maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const connectMs = options.connectMs ?? DEFAULT_CONNECT_MS

  const sessions = new Map<string, StreamSession>()
  const firstBytes: number[] = []
  const playSamples: number[] = []
  const netSamples: number[] = []
  let bytesOnDisk = 0
  let evictions = 0

  const keyFor = (url: string): string => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)
  const fileFor = (key: string): string => path.join(dir, `${key}.bin`)
  const metaFor = (key: string): string => path.join(dir, `${key}.json`)

  // ------------------------------------------------------------- disk index
  // Crash leftovers: a payload without its completion sidecar is a dead
  // partial download — remove it (retries start clean); sidecars without a
  // payload are cleaned too. Complete entries count towards the LRU budget.
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (name.endsWith('.bin')) {
        const key = name.slice(0, -'.bin'.length)
        if (!fs.existsSync(metaFor(key))) {
          fs.rmSync(full, { force: true })
          continue
        }
        try {
          bytesOnDisk += fs.statSync(full).size
        } catch {
          /* raced with a delete — simply not counted */
        }
        continue
      }
      if (name.endsWith('.json')) {
        const key = name.slice(0, -'.json'.length)
        if (!fs.existsSync(fileFor(key))) fs.rmSync(full, { force: true })
      }
    }
  } catch {
    /* unreadable cache dir — start empty */
  }

  function readSidecar(key: string): { url?: string; contentType?: string } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(metaFor(key), 'utf8')) as Record<string, unknown>
      return typeof raw?.url === 'string' ? { url: raw.url, contentType: String(raw.contentType ?? '') } : null
    } catch {
      return null
    }
  }

  function writeSidecar(session: StreamSession): void {
    try {
      fs.writeFileSync(
        session.meta,
        JSON.stringify({ url: session.url, contentType: session.contentType, total: session.received, at: Date.now() })
      )
    } catch {
      /* sidecar is an optimisation; a miss just means a re-download */
    }
  }

  /** Rebuild a session for a completed on-disk entry (no network). */
  function resurrect(key: string): StreamSession | null {
    const meta = readSidecar(key)
    if (!meta?.url) return null
    let size = 0
    try {
      const stat = fs.statSync(fileFor(key))
      if (!stat.isFile()) return null
      size = stat.size
    } catch {
      return null
    }
    const session: StreamSession = {
      key,
      url: meta.url,
      file: fileFor(key),
      meta: metaFor(key),
      total: size,
      received: size,
      done: true,
      error: null,
      contentType: meta.contentType || 'application/octet-stream',
      firstByteMs: null,
      startedAt: Date.now(),
      lastUsed: Date.now(),
      serving: 0,
      cached: true,
      promise: Promise.resolve()
    }
    sessions.set(key, session)
    return session
  }

  // ------------------------------------------------------------- eviction
  function evict(): void {
    const done = [...sessions.values()].filter((s) => s.done)
    let total = done.reduce((n, s) => n + s.received, 0)
    bytesOnDisk = total
    if (total <= maxBytes) return
    done.sort((a, b) => a.lastUsed - b.lastUsed)
    for (const session of done) {
      if (total <= maxBytes) break
      // A session with active readers may be mid-playback — never yank it.
      if (session.serving > 0) continue
      try {
        fs.rmSync(session.file, { force: true })
        fs.rmSync(session.meta, { force: true })
      } catch {
        continue
      }
      sessions.delete(session.key)
      total -= session.received
      evictions++
    }
    bytesOnDisk = total
  }

  // ------------------------------------------------------------- download
  function start(key: string, url: string): StreamSession {
    const session: StreamSession = {
      key,
      url,
      file: fileFor(key),
      meta: metaFor(key),
      total: 0,
      received: 0,
      done: false,
      error: null,
      contentType: 'application/octet-stream',
      firstByteMs: null,
      startedAt: Date.now(),
      lastUsed: Date.now(),
      serving: 0,
      cached: false,
      promise: Promise.resolve()
    }
    sessions.set(key, session)

    const abort = new AbortController()
    let watchdog: ReturnType<typeof setTimeout> | null = null
    const arm = (ms: number): void => {
      if (watchdog) clearTimeout(watchdog)
      watchdog = setTimeout(() => abort.abort(new Error(`Stream stalled (no data for ${ms} ms)`)), ms)
    }
    const disarm = (): void => {
      if (watchdog) clearTimeout(watchdog)
      watchdog = null
    }
    arm(connectMs)

    const started = Date.now()
    session.promise = (async () => {
      const res = await fetch(url, { signal: abort.signal, redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`Stream unavailable (HTTP ${res.status})`)
      session.contentType = res.headers.get('content-type') ?? 'application/octet-stream'
      const len = Number(res.headers.get('content-length'))
      if (Number.isFinite(len) && len > 0) session.total = len

      const out = await fsp.open(session.file, 'w')
      try {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value || value.length === 0) continue
          await out.write(value)
          session.received += value.length
          if (session.firstByteMs === null) {
            session.firstByteMs = Date.now() - started
            firstBytes.push(session.firstByteMs)
            if (firstBytes.length > LATENCY_WINDOW) firstBytes.shift()
          }
          arm(idleMs)
        }
      } finally {
        disarm()
        await out.close()
      }
      if (session.received === 0) throw new Error('Stream returned no data')
      if (!session.total) session.total = session.received
      session.done = true
      writeSidecar(session)
      evict()
    })().catch((err: unknown) => {
      disarm()
      const reason = abort.signal.reason
      const msg =
        reason instanceof Error
          ? reason.message
          : err instanceof Error
            ? err.message
            : String(err ?? 'stream failed')
      session.error = msg
      fs.rmSync(session.file, { force: true })
      throw err instanceof Error ? err : new Error(msg)
    })
    // Nobody may await this promise (fire-and-forget prewarm); keep Node's
    // unhandled-rejection warning away while still rejecting real awaiters.
    session.promise.catch(() => {})
    return session
  }

  // ------------------------------------------------------------- public API
  function open(url: string): StreamSession {
    const target = new URL(url) // throws on garbage
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error(`Unsupported stream scheme: ${target.protocol}`)
    }
    if (options.hostFilter && !options.hostFilter(target.hostname)) {
      throw new Error(`Stream host not allowed: ${target.hostname}`)
    }
    const key = keyFor(target.toString())
    const existing = sessions.get(key)
    if (existing) {
      if (!existing.error) {
        existing.lastUsed = Date.now()
        // A completed session needs no network for this open either.
        if (existing.done) existing.cached = true
        return existing
      }
      // A previous attempt failed — retry with a clean slate.
      sessions.delete(key)
    }
    const fromDisk = resurrect(key)
    if (fromDisk) return fromDisk
    return start(key, target.toString())
  }

  function get(key: string): StreamSession | null {
    return sessions.get(key) ?? resurrect(key) ?? null
  }

  /** Memory-only lookup (no disk fallback) — used where key uniqueness matters. */
  function peek(key: string): StreamSession | null {
    return sessions.get(key) ?? null
  }

  /**
   * Read the entry — including while it is still being written.
   *
   * `end` is inclusive, like HTTP ranges; null means "to the end" (which for
   * an in-flight download keeps yielding as bytes arrive). This is what makes
   * first-audio latency ≈ first-network-byte latency: the element reads the
   * file we are simultaneously filling.
   */
  function read(key: string, start = 0, end: number | null = null): ReadableStream<Uint8Array> {
    const session = sessions.get(key)
    if (!session) throw new Error('Unknown stream key')
    session.lastUsed = Date.now()
    session.serving++
    let released = false
    let pos = start
    let handle: fsp.FileHandle | null = null
    const release = (): void => {
      if (released) return
      released = true
      session.serving = Math.max(0, session.serving - 1)
      // Close the read handle on every terminal path (natural end included) —
      // relying on the garbage collector leaks descriptors and warns on exit.
      void handle?.close().catch(() => {})
      handle = null
    }
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          for (;;) {
            const avail = session.received
            if (pos >= avail) {
              if (session.error) {
                release()
                controller.error(new Error(session.error))
                return
              }
              if (session.done) {
                release()
                controller.close()
                return
              }
              await sleep(20)
              continue
            }
            if (end !== null && pos > end) {
              release()
              controller.close()
              return
            }
            if (!handle) handle = await fsp.open(session.file, 'r')
            const size = Math.min(avail, end !== null ? end + 1 : Number.MAX_SAFE_INTEGER, pos + READ_CHUNK) - pos
            const buf = Buffer.alloc(size)
            const { bytesRead } = await handle.read(buf, 0, size, pos)
            if (bytesRead <= 0) {
              await sleep(20)
              continue
            }
            pos += bytesRead
            controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, bytesRead))
            return
          }
        } catch (err) {
          release()
          controller.error(err)
        }
      },
      cancel() {
        release()
      }
    })
  }

  /** Resolve when the download finishes; rejects on failure. */
  async function wait(key: string): Promise<void> {
    const session = sessions.get(key)
    if (!session) throw new Error('Unknown stream key')
    await session.promise
  }

  /** Best-effort wait for the first body byte (prewarm completes fast). */
  async function waitFirstByte(key: string, timeoutMs = 8_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const session = sessions.get(key)
      if (!session) return false
      if (session.firstByteMs !== null || session.done || session.error) return !session.error || session.done
      if (Date.now() > deadline) return false
      await sleep(10)
    }
  }

  /**
   * Best-effort wait until the protocol response can be built truthfully:
   * resolves as soon as either Content-Length is known (arrives with the
   * response headers) or the first body byte has landed. A server that never
   * sends a length must not cost the caller the whole timeout — bytes are
   * already readable, so the 200 answer can start immediately.
   */
  async function waitForTotal(key: string, timeoutMs = 2_500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const session = sessions.get(key)
      if (!session || session.total > 0 || session.firstByteMs !== null || session.done || session.error) return
      if (Date.now() > deadline) return
      await sleep(10)
    }
  }

  /** Record a renderer-measured time-to-first-audio sample. */
  function recordPlay(ms: number, kind: 'local' | 'network' = 'local'): void {
    playSamples.push(ms)
    if (playSamples.length > LATENCY_WINDOW) playSamples.shift()
    if (kind === 'network') {
      netSamples.push(ms)
      if (netSamples.length > LATENCY_WINDOW) netSamples.shift()
    }
  }

  function stats(): FreeStats {
    let entries = 0
    let inflight = 0
    for (const session of sessions.values()) {
      if (session.done) entries++
      else if (!session.error) inflight++
    }
    return {
      entries,
      bytes: bytesOnDisk,
      maxBytes,
      inflight,
      firstByteLastMs: firstBytes.length ? firstBytes[firstBytes.length - 1] : null,
      firstByteAvgMs: avg(firstBytes),
      plays: playSamples.length,
      playLastMs: playSamples.length ? playSamples[playSamples.length - 1] : null,
      playMinMs: playSamples.length ? Math.min(...playSamples) : null,
      playAvgMs: avg(playSamples),
      netPlays: netSamples.length,
      netAvgMs: avg(netSamples)
    }
  }

  /** Drop completed entries; anything mid-download is left to finish. */
  function clear(): FreeStats {
    for (const [key, session] of [...sessions]) {
      if (!session.done) continue
      try {
        fs.rmSync(session.file, { force: true })
        fs.rmSync(session.meta, { force: true })
      } catch {
        continue
      }
      sessions.delete(key)
      bytesOnDisk = Math.max(0, bytesOnDisk - session.received)
    }
    return stats()
  }

  return {
    open,
    get,
    peek,
    read,
    wait,
    waitFirstByte,
    waitForTotal,
    recordPlay,
    stats,
    clear,
    keyFor,
    setMaxBytes(n: number): void {
      maxBytes = Math.max(1024, n)
      evict()
    },
    get dir(): string {
      return dir
    },
    /** Test seam: how many evictions have happened this run. */
    get evictions(): number {
      return evictions
    }
  }
}

export type StreamCache = ReturnType<typeof createStreamCache>

// ------------------------------------------------------------- app singleton

let singleton: StreamCache | null = null

/** Wire the cache to the app's userData directory (called once, main). */
export function initStreamCache(options: StreamCacheOptions): StreamCache {
  singleton = createStreamCache(options)
  return singleton
}

export function getStreamCache(): StreamCache {
  if (!singleton) throw new Error('Stream cache not initialised')
  return singleton
}

export function hasStreamCache(): boolean {
  return singleton !== null
}
