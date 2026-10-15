import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { newId } from './auth'
import type { AppSettings, DownloadJob, SearchResult, StreamInfo, ToolStatus } from '../shared/types'

/**
 * yt-dlp / ffmpeg integration.
 *
 * SECURITY: every argument is passed as an element of an argv array to
 * `spawn` with `shell: false`. User-supplied text (search queries, URLs,
 * titles) is therefore never interpreted by a shell, so quotes, `&`, `;`
 * or backticks in a title cannot inject a command.
 *
 * yt-dlp is a fast-moving target; YouTube changes routinely break older
 * builds. `getToolStatus()` surfaces the installed version and
 * `updateYtDlp()` gives the user a one-click upgrade path.
 */

let cachedYtDlp: string | null | undefined
let cachedFfmpeg: string | null | undefined
let cachedFfprobe: string | null | undefined
/** In-flight search, aborted when a newer query arrives. */
let searchAbort: AbortController | null = null
/** Resolved stream URLs with expiry (signed CDN URLs die after ~6h). */
const streamCache = new Map<string, { info: StreamInfo; at: number }>()
const STREAM_TTL_MS = 3 * 60 * 60 * 1000

export const isWin = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
/** Binary name with the platform's extension (.exe on Windows, bare elsewhere). */
const bin = (name: string): string => (isWin ? `${name}.exe` : name)

/** Spinity-managed tools dir (writable, no admin). Memoized — mkdir once. */
let toolsDirCache: string | null = null
export function toolsDir(): string {
  if (toolsDirCache) return toolsDirCache
  // Lazy-require electron so unit tests can import this module without it.
  let base = isMac
    ? path.join(os.homedir(), 'Library', 'Application Support', 'spinity', 'tools')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'tools')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    base = path.join(app.getPath('userData'), 'tools')
  } catch {}
  try { fs.mkdirSync(base, { recursive: true }) } catch {}
  toolsDirCache = base
  return base
}

/** Well-known install locations for the current OS (Homebrew, pipx, …). */
function systemToolDirs(tool: string): string[] {
  if (isWin) return []
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    path.join(os.homedir(), '.local', 'bin')
  ].map((dir) => path.join(dir, tool))
}

/** Candidate locations, probed in order. */
function ytDlpCandidates(): string[] {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  let managed = ''
  let managedLegacy = ''
  try {
    managed = path.join(toolsDir(), bin('yt-dlp'))
    managedLegacy = path.join(toolsDir(), 'yt-dlp.exe')
  } catch {}

  const direct = [
    process.env.SPINITY_YTDLP, // explicit override wins
    managed,
    managedLegacy,
    ...systemToolDirs('yt-dlp'),
    path.join(local, 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
    path.join(local, 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
    path.join(local, 'Programs', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
    path.join(roaming, 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    path.join(local, 'Programs', 'yt-dlp', 'yt-dlp.exe')
  ].filter((p): p is string => Boolean(p))

  // Any other Python3xx install the user may have (Windows).
  if (isWin) {
    try {
      const pyRoot = path.join(local, 'Programs', 'Python')
      for (const entry of fs.readdirSync(pyRoot)) {
        direct.push(path.join(pyRoot, entry, 'Scripts', 'yt-dlp.exe'))
      }
    } catch {
      /* directory absent — fine */
    }
  }
  return direct
}

function ffmpegCandidates(): string[] {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  let managed = ''
  let managedBin = ''
  try {
    managed = path.join(toolsDir(), bin('ffmpeg'))
    managedBin = path.join(toolsDir(), 'ffmpeg', 'bin', bin('ffmpeg'))
  } catch {}
  return [
    process.env.SPINITY_FFMPEG,
    managed,
    managedBin,
    ...systemToolDirs('ffmpeg'),
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    path.join(local, 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe'
  ].filter((p): p is string => Boolean(p))
}

export function resolveYtDlp(): string | null {
  if (cachedYtDlp !== undefined) return cachedYtDlp
  cachedYtDlp = ytDlpCandidates().find((p) => fs.existsSync(p)) ?? null
  return cachedYtDlp
}

export function resolveFfmpeg(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg
  cachedFfmpeg = ffmpegCandidates().find((p) => fs.existsSync(p)) ?? null
  return cachedFfmpeg
}

/**
 * ffprobe — the other half of the toolchain: durations, codec tags and, for
 * local files, the only reliable way to answer "does this file carry a
 * picture at all?".
 *
 * Every distribution ships ffprobe in the same folder as ffmpeg — except the
 * Spinity-managed install, which copies `ffmpeg.exe` alone into `tools/`,
 * while the downloaded build's `ffprobe.exe` stays inside
 * `tools/ffmpeg-dl/<version>/bin/`. So "next to ffmpeg" is not enough:
 * treating the resulting spawn failure as "no cover here" is what stamped
 * borrowed (and often wrong) YouTube thumbnails over local files.
 */
export function resolveFfprobe(): string | null {
  if (cachedFfprobe !== undefined) return cachedFfprobe
  const name = bin('ffprobe')
  const fromFfmpeg = resolveFfmpeg()
  const neighbour = fromFfmpeg ? path.join(path.dirname(fromFfmpeg), name) : ''
  let realNeighbour = ''
  try {
    if (fromFfmpeg) realNeighbour = path.join(path.dirname(fs.realpathSync(fromFfmpeg)), name)
  } catch {}
  let managed = ''
  try { managed = path.join(toolsDir(), name) } catch {}
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  const candidates = [
    process.env.SPINITY_FFPROBE, // explicit override wins
    neighbour, // winget links, Homebrew, gyan.dev zip: same folder as ffmpeg
    realNeighbour, // …including when ffmpeg.exe is a link into the package dir
    managed, // in case a future build drops it next to the managed ffmpeg
    isWin ? path.join(local, 'Microsoft', 'WinGet', 'Links', name) : '',
    isWin ? path.join(local, 'Programs', 'ffmpeg', 'bin', name) : '',
    isWin ? 'C:\\ffmpeg\\bin\\ffprobe.exe' : '',
    ...systemToolDirs('ffprobe')
  ].filter((p): p is string => Boolean(p))
  const found = candidates.find((p) => fs.existsSync(p))
  if (found) {
    cachedFfprobe = found
    return found
  }
  // Last resort: the extracted download tree under the managed tools dir.
  let deep: string | null = null
  try { deep = findFile(path.join(toolsDir(), 'ffmpeg-dl'), name) } catch {}
  cachedFfprobe = deep
  return deep
}

/** Run a command to completion, collecting stdout/stderr. Abortable via signal. Output capped. */
function run(
  bin: string,
  args: string[],
  timeoutMs = 120_000,
  signal?: AbortSignal
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const MAX_OUT = 2_000_000
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      // Grace period then force-kill (hung yt-dlp holds the slot otherwise).
      killTimer = setTimeout(() => { try { child.kill('SIGKILL' as NodeJS.Signals) } catch {} }, 2000)
      finish(() => reject(new Error('Timed out')))
    }, timeoutMs)
    let killTimer: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0)
    clearTimeout(killTimer)
    const onAbort = (): void => {
      try { child.kill() } catch {}
      finish(() => reject(new Error('Superseded')))
    }
    if (signal) {
      if (signal.aborted) {
        child.kill()
        finish(() => reject(new Error('Superseded')))
        return
      }
      signal.addEventListener('abort', onAbort)
    }

    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUT) stdout += d.toString().slice(0, MAX_OUT - stdout.length)
    })
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUT) stderr += d.toString().slice(0, MAX_OUT - stderr.length)
    })
    child.on('error', (err) => {
      finish(() => reject(err))
    })
    child.on('close', (code) => {
      finish(() => resolve({ code, stdout, stderr }))
    })
  })
}

// ------------------------------------------------------------------ tools

export async function getToolStatus(): Promise<ToolStatus> {
  const ytdlpPath = resolveYtDlp()
  const ffmpegPath = resolveFfmpeg()

  // Parallel probes with a tight cap — serial 20s+20s froze Settings.
  const probe = async (bin: string | null, args: string[]): Promise<string | null> => {
    if (!bin) return null
    try {
      const r = await run(bin, args, 8_000)
      return r.stdout.trim().split('\n')[0] || null
    } catch {
      return null
    }
  }
  const [ytdlpVersion, ffmpegVersion] = await Promise.all([
    probe(ytdlpPath, ['--version']),
    probe(ffmpegPath, ['-version']).then((v) => v?.split('\n')[0].trim() ?? null)
  ])

  return {
    ytdlpPath,
    ytdlpVersion,
    ffmpegPath,
    ffmpegVersion,
    ready: Boolean(ytdlpPath && ffmpegPath)
  }
}

/** `yt-dlp -U`. Only sensible for a standalone/pip install. */
export async function updateYtDlp(): Promise<string> {
  const bin = resolveYtDlp()
  if (!bin) throw new Error('yt-dlp was not found on this system')
  const r = await run(bin, ['-U'], 300_000)
  const output = `${r.stdout}\n${r.stderr}`.trim()
  cachedYtDlp = undefined // force re-probe next time
  if (r.code !== 0) throw new Error(output || 'yt-dlp update failed')
  return output
}

// ----------------------------------------------------------------- search

interface FlatEntry {
  id?: string
  title?: string
  duration?: number | null
  uploader?: string | null
  channel?: string | null
  url?: string
  webpage_url?: string
  thumbnail?: string | null
}

/**
 * Search YouTube without downloading anything.
 *
 * `--flat-playlist` keeps this cheap: yt-dlp reads the search result page only
 * and skips extracting each video individually, so a 20-hit search returns in
 * a couple of seconds instead of a minute.
 */
export async function search(query: string, limit = 20, opts?: { background?: boolean }): Promise<SearchResult[]> {
  const bin = resolveYtDlp()
  if (!bin) throw new Error('yt-dlp was not found on this system')

  const trimmed = query.trim()
  if (!trimmed) return []

  // Foreground search: a new query kills the previous one. Background work
  // (cover art) never touches the shared controller, so it can't cancel typing.
  const background = opts?.background === true
  let ctrl: AbortController | null = null
  if (!background) {
    searchAbort?.abort()
    ctrl = new AbortController()
    searchAbort = ctrl
  } else {
    ctrl = new AbortController()
  }

  // Clamp so a hostile renderer can't ask for a million results.
  const n = Math.max(1, Math.min(50, Math.floor(limit)))

  let stdout: string
  try {
    ;({ stdout } = await run(
      bin,
      [
        '--dump-single-json',
        '--flat-playlist',
        '--no-warnings',
        '--ignore-errors',
        '--socket-timeout',
        '10',
        `ytsearch${n}:${trimmed}`
      ],
      60_000,
      ctrl.signal
    ))
  } catch (err) {
    // Superseded searches die quietly — a newer query is already running.
    if (err instanceof Error && err.message === 'Superseded') throw err
    throw err
  } finally {
    if (!background && searchAbort === ctrl) searchAbort = null
  }

  let parsed: { entries?: FlatEntry[] }
  try {
    parsed = JSON.parse(stdout) as { entries?: FlatEntry[] }
  } catch {
    throw new Error('Could not parse search results (yt-dlp output was not JSON)')
  }
  const entries = parsed.entries ?? []
  return entries
    .filter((e): e is FlatEntry & { id: string } => Boolean(e.id))
    .map((e) => {
      const artist = e.uploader || e.channel || 'Unknown artist'
      return {
        id: e.id,
        source: 'youtube' as const,
        title: e.title || 'Untitled',
        artist,
        durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : 0,
        // Prefer the deterministic i.ytimg.com URL: it always resolves and
        // needs no extra request. `e.thumbnail` can be a signed/hotlink URL.
        // hqdefault (480x360) keeps large tiles sharp; it exists for every video.
        thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
        webUrl: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`
      }
    })
}

// --------------------------------------------------------------- downloads

export interface DownloadRequest {
  userId: string
  /** Directory the finished audio file lands in. */
  outDir: string
  result: SearchResult
  settings: AppSettings
}

/** Matches yt-dlp progress lines, e.g. `[download]   4.2% of ~3MiB at ...`. */
const PROGRESS_RE = /\[download\]\s+([\d.]+)%/

type JobListener = (job: DownloadJob) => void

/**
 * Serial download queue with a concurrency cap.
 *
 * Downloads are intentionally throttled (default 2): hammering YouTube with
 * parallel requests is the fastest route to rate-limiting and temporary
 * blocks, and audio extraction is I/O bound anyway.
 */
class DownloadManager {
  private jobs = new Map<string, DownloadJob>()
  private requests = new Map<string, DownloadRequest>()
  private children = new Map<string, ChildProcess>()
  private queue: string[] = []
  private running = 0
  private cap = 2
  private listener: JobListener = () => {}
  private lastEmit = new Map<string, number>()

  onChange(fn: JobListener): void {
    this.listener = fn
  }

  private emit(job: DownloadJob, throttleProgress = false): void {
    job.updatedAt = Date.now()
    if (throttleProgress) {
      const last = this.lastEmit.get(job.id) ?? 0
      if (Date.now() - last < 250 && job.status !== 'done' && job.status !== 'error' && job.status !== 'canceled') return
    }
    this.lastEmit.set(job.id, Date.now())
    this.listener({ ...job })
    // Long sessions must not accumulate finished rows forever (low-RAM PCs):
    // keep the newest 100, evicting the oldest terminal jobs first.
    if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
      this.lastEmit.delete(job.id)
      this.prune()
    }
  }

  private prune(): void {
    if (this.jobs.size <= 100) return
    // Insertion-ordered Map: oldest first, no sort needed.
    for (const [id, j] of this.jobs) {
      if (this.jobs.size <= 100) break
      if (j.status === 'done' || j.status === 'error' || j.status === 'canceled') {
        this.jobs.delete(id)
        this.requests.delete(id)
      }
    }
  }

  list(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  enqueue(req: DownloadRequest): DownloadJob {
    const job: DownloadJob = {
      id: newId(),
      userId: req.userId,
      trackId: req.result.id,
      title: req.result.title,
      artist: req.result.artist,
      source: req.result,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.jobs.set(job.id, job)
    this.requests.set(job.id, req)
    this.queue.push(job.id)
    // Honour the most recent user preference.
    this.cap = Math.max(1, Math.min(4, req.settings.concurrency || 2))
    this.emit(job)
    this.pump()
    return job
  }

  /** True when this video is already queued, in flight, or finished. */
  isPending(trackId: string): boolean {
    return [...this.jobs.values()].some(
      (j) =>
        j.trackId === trackId &&
        (j.status === 'queued' || j.status === 'downloading' || j.status === 'converting')
    )
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return

    this.queue = this.queue.filter((id) => id !== jobId)

    const child = this.children.get(jobId)
    if (child?.pid) {
      if (isWin) {
        // ffmpeg runs as a grandchild of yt-dlp, so signal the whole tree.
        // /T = tree, /F = force.
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true
          })
        } catch {
          child.kill()
        }
      } else {
        // POSIX: SIGTERM, escalate to SIGKILL shortly after.
        try { child.kill('SIGTERM') } catch {}
        const pid = child.pid
        setTimeout(() => {
          try { process.kill(pid, 0); child.kill('SIGKILL') } catch {}
        }, 2000).unref?.()
      }
      this.children.delete(jobId)
    }

    job.status = 'canceled'
    job.error = undefined
    this.emit(job)
    this.requests.delete(jobId)
    this.pump()
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
        this.jobs.delete(id)
        this.requests.delete(id)
      }
    }
  }

  private pump(): void {
    while (this.running < this.cap && this.queue.length > 0) {
      const nextId = this.queue.shift()
      if (!nextId) break
      const req = this.requests.get(nextId)
      const job = this.jobs.get(nextId)
      if (!req || !job || job.status === 'canceled') {
        this.requests.delete(nextId)
        continue
      }
      this.running += 1
      void this.start(nextId, req, job)
    }
  }

  private async start(jobId: string, req: DownloadRequest, job: DownloadJob): Promise<void> {
    const bin = resolveYtDlp()
    if (!bin) {
      this.running -= 1
      job.status = 'error'
      job.error = 'yt-dlp was not found on this system'
      this.emit(job)
      this.requests.delete(jobId)
      return
    }

    const ffmpeg = resolveFfmpeg()
    const fmt = req.settings.audioFormat || 'm4a'

    const args = [
      '-x', // extract audio only
      '--audio-format', fmt,
      '--audio-quality', req.settings.audioQuality || '0',
      '--newline', // progress on discrete lines; without it output is \r-terminated
      '--no-playlist',
      '--no-warnings',
      '--retries', '3',
      '--socket-timeout', '20',
      // Emit the final path on stdout so we never have to guess the extension.
      '--print', 'after_move:filepath',
      '-o', path.join(req.outDir, '%(id)s.%(ext)s')
    ]
    if (ffmpeg) args.push('--ffmpeg-location', ffmpeg)
    args.push(req.result.webUrl)

    job.status = 'downloading'
    job.progress = 0
    this.emit(job)

    const child = spawn(bin, args, { shell: false, windowsHide: true })
    this.children.set(jobId, child)

    let finalPath: string | null = null

    const onLine = (line: string): void => {
      const m = PROGRESS_RE.exec(line)
      if (m) {
        const pct = Number(m[1])
        if (Number.isFinite(pct)) {
          // Reserve the top 10% of the bar for the ffmpeg transcode step.
          const next = Math.min(90, Math.round(pct * 0.9))
          if (next !== job.progress) {
            job.progress = next
            this.emit(job, true)
          }
        }
        return
      }
      if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
        job.status = 'converting'
        job.progress = 92
        this.emit(job, true)
        return
      }
      // `--print after_move:filepath` writes a bare path. Don't hit the disk
      // per line — remember the candidate, validate once on close.
      // Windows (`C:\…`) and POSIX (`/…`) absolutes both accepted.
      const trimmed = line.trim()
      if (
        trimmed &&
        !trimmed.startsWith('[') &&
        (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('/')) &&
        /\.(m4a|mp3|opus|flac|wav|ogg|mka)$/i.test(trimmed)
      ) {
        finalPath = trimmed
      }
    }

    let buffer = ''
    let stderrTail = ''
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) onLine(line)
    })
    child.stderr.on('data', (d: Buffer) => {
      // Keep only the tail; yt-dlp warnings can be extremely noisy.
      stderrTail = (stderrTail + d.toString()).slice(-2000)
    })

    child.on('error', (err) => {
      this.children.delete(jobId)
      this.running -= 1
      job.status = 'error'
      job.error = err.message
      this.emit(job)
      this.requests.delete(jobId)
      this.pump()
    })

    child.on('close', (code) => {
      this.children.delete(jobId)
      this.running -= 1

      if (job.status === 'canceled') {
        this.emit(job)
        this.pump()
        return
      }

      if (code === 0 && finalPath && fs.existsSync(finalPath)) {
        job.status = 'done'
        job.progress = 100
        job.filePath = finalPath
        this.emit(job)
      } else {
        job.status = 'error'
        job.error = this.friendlyError(code, stderrTail)
        this.emit(job)
      }
      this.requests.delete(jobId)
      this.pump()
    })
  }

  /** Turn yt-dlp's verbose stderr into something a user can act on. */
  private friendlyError(code: number | null, stderr: string): string {
    const s = stderr.toLowerCase()
    if (s.includes('sign in to confirm') || s.includes('not a bot')) {
      return 'YouTube asked this client to prove it is not a bot. Try updating yt-dlp in Settings.'
    }
    if (s.includes('private video') || s.includes('video unavailable')) {
      return 'This video is unavailable, private, or region-locked.'
    }
    if (s.includes('blocked') || s.includes('removed by the uploader')) {
      return 'This video is blocked or has been removed.'
    }
    if (s.includes('timed out') || s.includes('network') || s.includes('getaddrinfo')) {
      return 'Network problem while downloading. Check your connection and retry.'
    }
    const lastLine = stderr.trim().split('\n').filter(Boolean).pop()
    return lastLine ? `yt-dlp failed: ${lastLine.slice(0, 300)}` : `yt-dlp exited with code ${code}`
  }

}

export const downloads = new DownloadManager()

// ----------------------------------------------------------------- streaming

/**
 * Resolve a DIRECT media URL for a video, without downloading anything.
 *
 * Why not `yt-dlp -o -` piped into the app: the HTML5 `<audio>` element cannot
 * consume a raw stdout byte stream — that would need MediaSource Extensions
 * plumbing plus correct webm/mp4 init segments. Handing `<audio>` a direct
 * URL is simpler AND better, because Google's CDN honours HTTP Range
 * requests, so seeking works exactly as it does for local files.
 *
 * The format selector deliberately prefers progressive HTTP streams. HLS
 * (m3u8) and DASH manifests cannot be played by `<audio>` without MSE, so
 * they are filtered out in favour of plain byte-addressable URLs.
 *
 * SECURITY: the video id is validated by the caller. It is interpolated into
 * a URL passed as a single argv element to `spawn` with `shell: false`, so no
 * shell interpretation is possible.
 */
export async function resolveStreamUrl(videoId: string): Promise<StreamInfo> {
  const bin = resolveYtDlp()
  if (!bin) throw new Error('yt-dlp was not found on this system')

  // Defensive: only allow the exact shape of a YouTube video id.
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new Error('Invalid video id')
  }

  // Repeat plays resolve instantly — signed URLs live ~6h, we trust 3h.
  // True LRU: refresh recency on hit, evict oldest insertion without sorting.
  const hit = streamCache.get(videoId)
  if (hit && Date.now() - hit.at < STREAM_TTL_MS) {
    streamCache.delete(videoId)
    streamCache.set(videoId, hit)
    return hit.info
  }
  if (streamCache.size >= 200) {
    const oldest = streamCache.keys().next()
    if (!oldest.done) streamCache.delete(oldest.value)
  }

  const { stdout } = await run(
    bin,
    [
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '10',
      '--retries', '2',
      // NOTE (1.1.5): the android player fast-lane broke streams for some
      // networks/videos, so this is back to yt-dlp's default client
      // selection — slower to resolve, but it plays everywhere 1.0.1 did.
      // The URL cache below keeps repeat plays instant regardless.
      '-f',
      // m4a (AAC) and webm (Opus) both play natively in Chromium. The final
      // fallback keeps things working if the first two formats are absent.
      'bestaudio[protocol^=http][ext=m4a]/' +
        'bestaudio[protocol^=http][ext=webm]/' +
        'bestaudio[protocol^=http]/bestaudio',
      // One line: url|ext|protocol. Parsing this beats -g, which gives the URL
      // alone and no way to tell a playable progressive stream from a
      // manifest we cannot use.
      '--print', '%(url)s|%(ext)s|%(protocol)s',
      `https://www.youtube.com/watch?v=${videoId}`
    ],
    45_000
  )

  // Take the LAST non-empty line: yt-dlp writes its own messages to stderr,
  // but being tolerant here costs nothing.
  const line = stdout.trim().split('\n').filter(Boolean).pop()
  if (!line) throw new Error('yt-dlp returned no stream URL')

  const [url = '', ext = '', protocol = ''] = line.split('|')
  if (!url.startsWith('http')) {
    throw new Error('Could not resolve a stream URL (yt-dlp output was unexpected)')
  }

  const info = { url, ext, protocol }
  streamCache.set(videoId, { info, at: Date.now() })
  return info
}

// ------------------------------------------------------- install / repair

function downloadFile(url: string, dest: string, timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Download timed out')), timeoutMs)
    const doGet = (u: string): void => {
      // Static imports keep types simple; both modules expose .get().
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = u.startsWith('https:') ? require('node:https') as typeof import('node:https') : require('node:http') as typeof import('node:http')
      const req = mod.get(u, { headers: { 'User-Agent': 'spinity' } }, (res: import('node:http').IncomingMessage) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          doGet(res.headers.location)
          return
        }
        if (status !== 200) {
          clearTimeout(timer)
          reject(new Error(`Download failed (HTTP ${status})`))
          return
        }
        const out = fs.createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => {
          clearTimeout(timer)
          out.close()
          resolve()
        })
        out.on('error', (e: Error) => {
          clearTimeout(timer)
          reject(e)
        })
      })
      req.on('error', (e: Error) => {
        clearTimeout(timer)
        reject(e)
      })
    }
    try {
      doGet(url)
    } catch (e: unknown) {
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** Check for a usable Python (needed only for pip-based yt-dlp installs). */
export async function getPythonStatus(): Promise<{ path: string | null; version: string | null }> {
  for (const bin of ['py', 'python', 'python3']) {
    try {
      const args = bin === 'py' ? ['-3', '--version'] : ['--version']
      const r = await run(bin, args, 15_000)
      const out = `${r.stdout}${r.stderr}`.trim().split('\n')[0]
      if (r.code === 0 && /python/i.test(out)) return { path: bin, version: out }
    } catch {}
  }
  return { path: null, version: null }
}

/**
 * Download a standalone yt-dlp (no Python needed) into the
 * Spinity-managed tools dir. URL = latest GitHub release, asset per OS.
 */
export async function installYtDlp(): Promise<string> {
  const dir = toolsDir()
  const name = bin('yt-dlp')
  const dest = path.join(dir, name)
  const tmp = `${dest}.download`
  // Windows build needs nothing; macOS build is a universal binary.
  const asset = isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : 'yt-dlp_linux'
  await downloadFile(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, tmp)
  fs.renameSync(tmp, dest)
  if (!isWin) {
    try { fs.chmodSync(dest, 0o755) } catch {}
  }
  cachedYtDlp = undefined
  const found = resolveYtDlp()
  if (!found) throw new Error('Download finished but yt-dlp was not found')
  const status = await getToolStatus()
  return `yt-dlp installed to ${found} (version ${status.ytdlpVersion ?? 'unknown'})`
}

/**
 * Install ffmpeg without admin rights.
 * Windows: 1. try `winget install ffmpeg`, else 2. gyan.dev zip.
 * macOS: `brew install ffmpeg` (Homebrew), else a clear pointer.
 */
export async function installFfmpeg(): Promise<string> {
  if (isMac) {
    try {
      const r = await run('brew', ['install', 'ffmpeg'], 600_000)
      cachedFfmpeg = undefined
      cachedFfprobe = undefined
      if (resolveFfmpeg()) return `ffmpeg installed via Homebrew.\n${r.stdout.slice(-1000)}`
    } catch {}
    throw new Error('Could not install ffmpeg automatically. Install Homebrew (https://brew.sh) then run: brew install ffmpeg')
  }
  // Fast path: winget (no download plumbing, auto-updates).
  try {
    const r = await run('winget', ['install', '--id', 'Gyan.FFmpeg', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements'], 600_000)
    cachedFfmpeg = undefined
    cachedFfprobe = undefined
    if (resolveFfmpeg()) return `ffmpeg installed via winget.\n${r.stdout.slice(-1000)}`
  } catch {}
  // Fallback: direct zip download (~80MB).
  const dir = toolsDir()
  const zipPath = path.join(dir, 'ffmpeg-essentials.zip')
  const extractDir = path.join(dir, 'ffmpeg-dl')
  await downloadFile('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', zipPath)
  fs.mkdirSync(extractDir, { recursive: true })
  // Expand-Archive via powershell (Windows-only app).
  await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zipPath}' '${extractDir}'`], 300_000)
  // Find bin/ffmpeg.exe inside the extracted tree.
  const found = findFile(extractDir, 'ffmpeg.exe')
  if (!found) throw new Error('ffmpeg download finished but ffmpeg.exe was not found in the archive')
  const dest = path.join(dir, 'ffmpeg.exe')
  fs.copyFileSync(found, dest)
  // Keep ffprobe in the managed folder too: it is what durations, codec tags
  // and embedded artwork all depend on, and the zip is the only install path
  // that would otherwise leave it unreachable.
  const foundProbe = findFile(extractDir, bin('ffprobe'))
  if (foundProbe) {
    try { fs.copyFileSync(foundProbe, path.join(dir, bin('ffprobe'))) } catch {}
  }
  try { fs.rmSync(zipPath, { force: true }) } catch {}
  cachedFfmpeg = undefined
  cachedFfprobe = undefined
  return `ffmpeg installed to ${dest}`
}

function findFile(root: string, name: string): string | null {
  const stack = [root]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full
      if (e.isDirectory()) stack.push(full)
    }
  }
  return null
}

/** `pip install -U yt-dlp` via the detected Python (for pip-based setups). */
export async function installPythonDeps(): Promise<string> {
  const py = await getPythonStatus()
  if (!py.path) {
    throw new Error('Python not found — install it from https://www.python.org/downloads/ (tick "Add python to PATH"), then retry. Or use "Download yt-dlp" above which needs no Python.')
  }
  const base = py.path === 'py' ? ['-3', '-m', 'pip'] : ['-m', 'pip']
  const r = await run(py.path, [...base, 'install', '-U', 'yt-dlp'], 600_000)
  cachedYtDlp = undefined
  const out = `${r.stdout}\n${r.stderr}`.trim()
  if (r.code !== 0) throw new Error(out || 'pip install failed')
  return out.slice(-2000)
}



