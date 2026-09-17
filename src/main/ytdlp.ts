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

/** Candidate locations, probed in order. */
function ytDlpCandidates(): string[] {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')

  const direct = [
    process.env.SPINITY_YTDLP, // explicit override wins
    path.join(local, 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
    path.join(local, 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'),
    path.join(local, 'Programs', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
    path.join(roaming, 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'),
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe'),
    path.join(local, 'Programs', 'yt-dlp', 'yt-dlp.exe')
  ].filter((p): p is string => Boolean(p))

  // Any other Python3xx install the user may have.
  try {
    const pyRoot = path.join(local, 'Programs', 'Python')
    for (const entry of fs.readdirSync(pyRoot)) {
      direct.push(path.join(pyRoot, entry, 'Scripts', 'yt-dlp.exe'))
    }
  } catch {
    /* directory absent — fine */
  }
  return direct
}

function ffmpegCandidates(): string[] {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  return [
    process.env.SPINITY_FFMPEG,
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

/** Run a command to completion, collecting stdout/stderr. */
function run(
  bin: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Timed out'))
    }, timeoutMs)

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

// ------------------------------------------------------------------ tools

export async function getToolStatus(): Promise<ToolStatus> {
  const ytdlpPath = resolveYtDlp()
  const ffmpegPath = resolveFfmpeg()

  let ytdlpVersion: string | null = null
  let ffmpegVersion: string | null = null

  if (ytdlpPath) {
    try {
      const r = await run(ytdlpPath, ['--version'], 20_000)
      ytdlpVersion = r.stdout.trim().split('\n')[0] || null
    } catch {
      ytdlpVersion = null
    }
  }
  if (ffmpegPath) {
    try {
      const r = await run(ffmpegPath, ['-version'], 20_000)
      ffmpegVersion = r.stdout.split('\n')[0].trim() || null
    } catch {
      ffmpegVersion = null
    }
  }

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
export async function search(query: string, limit = 20): Promise<SearchResult[]> {
  const bin = resolveYtDlp()
  if (!bin) throw new Error('yt-dlp was not found on this system')

  const trimmed = query.trim()
  if (!trimmed) return []

  // Clamp so a hostile renderer can't ask for a million results.
  const n = Math.max(1, Math.min(50, Math.floor(limit)))

  const { stdout } = await run(
    bin,
    [
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--ignore-errors',
      '--socket-timeout',
      '15',
      `ytsearch${n}:${trimmed}`
    ],
    90_000
  )

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
        thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
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

  onChange(fn: JobListener): void {
    this.listener = fn
  }

  private emit(job: DownloadJob): void {
    job.updatedAt = Date.now()
    this.listener({ ...job })
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
          job.progress = Math.min(90, Math.round(pct * 0.9))
          this.emit(job)
        }
        return
      }
      if (line.includes('[ExtractAudio]') || line.includes('[ffmpeg]')) {
        job.status = 'converting'
        job.progress = 92
        this.emit(job)
        return
      }
      // `--print after_move:filepath` writes a bare path, and by the time it
      // appears the file is already moved into place.
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('[') && fs.existsSync(trimmed)) {
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

  const { stdout } = await run(
    bin,
    [
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '15',
      '--retries', '2',
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
    60_000
  )

  // Take the LAST non-empty line: yt-dlp writes its own messages to stderr,
  // but being tolerant here costs nothing.
  const line = stdout.trim().split('\n').filter(Boolean).pop()
  if (!line) throw new Error('yt-dlp returned no stream URL')

  const [url = '', ext = '', protocol = ''] = line.split('|')
  if (!url.startsWith('http')) {
    throw new Error('Could not resolve a stream URL (yt-dlp output was unexpected)')
  }

  return { url, ext, protocol }
}



