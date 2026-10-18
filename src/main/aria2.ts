import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isWin, toolsDir } from './ytdlp'

/**
 * aria2c — the optional multi-connection downloader behind the stream cache.
 *
 * YouTube's CDN throttles a single connection, so the write-through cache
 * fills at whatever one socket delivers. aria2c splits the same file across
 * several parallel connections (`-x 16 -s 16 -k 1M`) and typically fills it
 * in seconds — which is what turns "replay this tomorrow" into an instant,
 * offline-capable play.
 *
 * Nothing is ever installed automatically and nothing here is required: when
 * aria2c is absent the app falls back to the single-connection cache exactly
 * as before. Discovery is memoized because it stats PATH on first use.
 *
 * SECURITY: every argument is an argv element of `spawn(shell:false)`; the
 * only URL that ever reaches this module is one yt-dlp just signed.
 */

const BIN_NAME = isWin ? 'aria2c.exe' : 'aria2c'

/** Overall watchdog for one fill (a 15 MB track over 16 connections is seconds). */
export const DEFAULT_FILL_TIMEOUT_MS = 15 * 60_000

let cached: string | null | undefined

/** Bounded walk for `aria2c` inside package-style trees (winget, archives). */
function findIn(dir: string, depth: number): string | null {
  if (depth < 0) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === BIN_NAME.toLowerCase()) {
      return path.join(dir, entry.name)
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = findIn(path.join(dir, entry.name), depth - 1)
    if (found) return found
  }
  return null
}

/** Windows: winget keeps binaries inside versioned package folders. */
function findWinGetPackage(): string | null {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const packages = path.join(local, 'Microsoft', 'WinGet', 'Packages')
  try {
    for (const entry of fs.readdirSync(packages)) {
      if (!/^aria2/i.test(entry)) continue
      const found = findIn(path.join(packages, entry), 4)
      if (found) return found
    }
  } catch {
    /* no winget packages dir — fine */
  }
  return null
}

/** Candidate locations, probed in order. Memoized (may stat PATH once). */
export function resolveAria2c(): string | null {
  if (cached !== undefined) return cached
  const candidates: string[] = []
  if (process.env.SPINITY_ARIA2C) candidates.push(process.env.SPINITY_ARIA2C)
  try {
    candidates.push(path.join(toolsDir(), BIN_NAME))
  } catch {
    /* tools dir unavailable — keep probing */
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, BIN_NAME))
  }
  if (isWin) {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', BIN_NAME))
    const inPackage = findWinGetPackage()
    if (inPackage) candidates.push(inPackage)
  } else {
    candidates.push(
      path.join('/opt/homebrew/bin', 'aria2c'),
      path.join('/usr/local/bin', 'aria2c'),
      path.join('/opt/local/bin', 'aria2c')
    )
  }
  cached =
    candidates.find((p) => {
      try {
        return Boolean(p) && fs.existsSync(p)
      } catch {
        return false
      }
    }) ?? null
  return cached
}

/** First line of `aria2c --version` ("aria2 version 1.37.0"), or null. */
export function aria2Version(bin: string | null = resolveAria2c()): Promise<string | null> {
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(bin, ['--version'], { windowsHide: true, shell: false })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      done(null)
    }, 8_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (out.length < 8_192) out += chunk.toString()
    })
    child.on('error', () => done(null))
    child.on('close', () => done(out.trim().split('\n')[0] || null))
  })
}

// ------------------------------------------------------------------- args

export interface Aria2ArgsOptions {
  url: string
  /** Destination directory (the stream cache dir). */
  dir: string
  /** Destination file name inside `dir` (`<key>.bin`). */
  file: string
  /** Max connections per server (`-x`). */
  connections?: number
  /** Split count (`-s`). */
  split?: number
  /** Minimum split size (`-k`). */
  minSplit?: string
}

/**
 * argv for one fill. The flags that matter:
 *
 *  - `--no-conf=true` ignores the user's own aria2.conf — a stray global
 *    setting (`max-connection-per-server=1`, a proxy, a rate cap) must not
 *    silently change what this app does.
 *  - `--file-allocation=none` keeps the file growing as bytes land instead of
 *    preallocating: the cache entry only claims space it actually received.
 *  - `--summary-interval=1` prints the one-line progress readout this module
 *    parses; `--console-log-level=warn` keeps everything else out of the way.
 *  - `--auto-file-renaming=false` + `--allow-overwrite=true` pin the exact
 *    destination name the cache expects.
 */
export function buildAria2Args(o: Aria2ArgsOptions): string[] {
  return [
    '--no-conf=true',
    '-d',
    o.dir,
    '-o',
    o.file,
    '-x',
    String(o.connections ?? 16),
    '-s',
    String(o.split ?? 16),
    '-k',
    o.minSplit ?? '1M',
    '--continue=true',
    '--allow-overwrite=true',
    '--auto-file-renaming=false',
    '--file-allocation=none',
    '--max-tries=3',
    '--retry-wait=2',
    '--connect-timeout=15',
    '--timeout=30',
    '--summary-interval=1',
    '--console-log-level=warn',
    '--download-result=hide',
    // A browser-ish UA: some CDN edges reject the default client string
    // outright (403), which we would wastefully read as "expired URL".
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    o.url
  ]
}

// --------------------------------------------------------------- progress

export interface Aria2Progress {
  /** 0–100, as printed by aria2c. */
  pct: number
  /** Total file size once aria2c knows it. */
  totalBytes: number | null
  /** Instantaneous download speed. */
  speedBps: number | null
}

const SIZE_UNITS: [string, number][] = [
  ['TiB', 2 ** 40],
  ['GiB', 2 ** 30],
  ['MiB', 2 ** 20],
  ['KiB', 2 ** 10],
  ['TB', 1e12],
  ['GB', 1e9],
  ['MB', 1e6],
  ['KB', 1e3],
  ['B', 1]
]

/** "4.1MiB" → bytes. Exported for tests and for the progress parser. */
export function parseAria2Size(text: string): number | null {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)$/i.exec(text.trim())
  if (!match) return null
  const unit = SIZE_UNITS.find(([label]) => label.toLowerCase() === match[2].toLowerCase())
  if (!unit) return null
  return Math.round(Number(match[1]) * unit[1])
}

const SIZE_PART = '([0-9]+(?:\\.[0-9]+)?\\s*(?:[KMGT]i?B|B))'

/**
 * One progress readout:
 *   `[#8d6f1f 15MiB/43MiB(34%) CN:8 DL:5.2MiB ETA:3s]`
 * Returns null for any other line.
 */
export function parseAria2Progress(line: string): Aria2Progress | null {
  const match = new RegExp(`${SIZE_PART}/${SIZE_PART}\\((\\d{1,3})%\\)`).exec(line)
  if (!match) return null
  const speed = new RegExp(`DL:${SIZE_PART}`).exec(line)
  return {
    pct: Math.min(100, Number(match[3])),
    totalBytes: parseAria2Size(match[2]),
    speedBps: speed ? parseAria2Size(speed[1]) : null
  }
}

/**
 * aria2c output that means the signed URL is dead (403/410) rather than the
 * network being down. Only these are worth a fresh-URL retry.
 */
export function aria2Expired(text: string): boolean {
  return /status=(?:403|410)|(?:403|410)\s+Forbidden|HTTP\D{0,16}(?:403|410)|errorCode=24|\bexpired\b/i.test(
    text
  )
}

// -------------------------------------------------------------- download

export class Aria2Error extends Error {
  /** The URL was refused (expired signature) — re-resolving may fix it. */
  readonly expired: boolean
  /** aria2c's exit code, when it got that far. */
  readonly code: number | null

  constructor(message: string, opts: { expired?: boolean; code?: number | null } = {}) {
    super(message)
    this.name = 'Aria2Error'
    this.expired = Boolean(opts.expired)
    this.code = opts.code ?? null
  }
}

export interface Aria2DownloadOptions {
  url: string
  dir: string
  file: string
  connections?: number
  split?: number
  minSplit?: string
  /** Overall cap — a stuck fill must not hold a queue slot forever. */
  timeoutMs?: number
  onProgress?: (progress: Aria2Progress) => void
  /** Test seams; the app never passes these. */
  bin?: string
  spawnImpl?: (bin: string, args: string[], options: { windowsHide: boolean; shell: boolean }) => ChildProcess
}

export interface Aria2Result {
  bytes: number
}

/**
 * Run one fill to completion. Resolves with the size of the finished file,
 * rejects with an `Aria2Error` whose `expired` flag tells the caller whether
 * a fresh URL is worth trying. The destination is removed first: a leftover
 * part file from an earlier attempt must never be resumed into.
 */
export function downloadWithAria2c(options: Aria2DownloadOptions): Promise<Aria2Result> {
  const doSpawn = options.spawnImpl ?? spawn
  const binPath = options.bin ?? resolveAria2c()
  const dest = path.join(options.dir, options.file)
  const timeoutMs = options.timeoutMs ?? DEFAULT_FILL_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    if (!binPath) {
      reject(new Aria2Error('aria2c was not found'))
      return
    }
    try {
      fs.rmSync(dest, { force: true })
      fs.rmSync(`${dest}.aria2`, { force: true })
    } catch {
      /* start-clean is best effort */
    }

    const child = doSpawn(
      binPath,
      buildAria2Args({
        url: options.url,
        dir: options.dir,
        file: options.file,
        connections: options.connections,
        split: options.split,
        minSplit: options.minSplit
      }),
      { windowsHide: true, shell: false }
    )

    let tail = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }
    const onChunk = (chunk: Buffer | string): void => {
      const text = chunk.toString()
      tail = (tail + text).slice(-4_096)
      const report = options.onProgress
      if (!report) return
      for (const line of text.split(/\r\n?|\n/)) {
        const progress = parseAria2Progress(line)
        if (!progress) continue
        try {
          report(progress)
        } catch {
          /* a reporting bug must not kill the download */
        }
      }
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (err: Error) => {
      finish(() => reject(new Aria2Error(err.message)))
    })
    child.on('close', (code: number | null) => {
      if (code === 0) {
        let bytes = 0
        try {
          bytes = fs.statSync(dest).size
        } catch {
          /* missing file — reported below */
        }
        if (bytes <= 0) {
          finish(() => reject(new Aria2Error('aria2c finished without a file', { code })))
          return
        }
        finish(() => resolve({ bytes }))
        return
      }
      const reason = tail.trim().split('\n').pop()?.trim() || `aria2c exited with code ${code}`
      finish(() => reject(new Aria2Error(reason, { expired: aria2Expired(tail), code })))
    })

    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {}
      finish(() => reject(new Aria2Error(`aria2c timed out after ${timeoutMs} ms`)))
    }, timeoutMs)
  })
}
