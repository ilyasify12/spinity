import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { resolveYtDlp, search } from './ytdlp'
import { spawn } from 'node:child_process'
import { alignLyricsToCues, parseCaptionCues, type CaptionCue, type CaptionFit } from './lyricsText'
import type { LyricLine } from '../shared/lyrics'

/**
 * Align lyrics to the recording the user actually has.
 *
 * The trick that makes this work: YouTube's automatic captions are timed to
 * *that video's* audio, and yt-dlp can tell us which video is this file
 * (matching duration, same title). So the captions give us the real vocal
 * timing for the exact recording, while lrclib gives us the correct words —
 * and `alignLyricsToCues` marries the two. A local file that starts singing at
 * 18s instead of lrclib's 11s is then fixed in one shot, automatically.
 *
 * Everything is cached: the caption file on disk per video, and the resulting
 * fit in the database, so this costs one search per track, ever.
 */

const CAPTION_TIMEOUT_MS = 30_000
const MAX_CAPTION_BYTES = 4 * 1024 * 1024

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'caption-cache-v1')
}

/** Language codes to try, in order. `-orig` is YouTube's ASR of the original. */
function languageCandidates(text: string): string[] {
  const langs = ['en-orig', 'en']
  // Ask for the original-language ASR when the text is clearly not English.
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) langs.unshift('ja-orig', 'zh-Hans-orig')
  else if (/[\uac00-\ud7af]/.test(text)) langs.unshift('ko-orig')
  else if (/[\u0400-\u04ff]/.test(text)) langs.unshift('ru-orig')
  else if (/[\u0600-\u06ff]/.test(text)) langs.unshift('ar-orig')
  else if (/[\u0900-\u097f]/.test(text)) langs.unshift('hi-orig')
  return [...new Set(langs)]
}

function run(bin: string, args: string[], timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true })
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      resolve(null)
    }, timeoutMs)
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', (code) => { clearTimeout(timer); resolve(code) })
  })
}

/** Fetch (or reuse) the timed captions for one video id. */
async function captionsFor(videoId: string, languageHint: string): Promise<string | null> {
  const dir = cacheDir()
  const cached = path.join(dir, `${videoId}.json3`)
  try {
    const existing = await fs.promises.readFile(cached, 'utf8')
    if (existing.length > 0) return existing
  } catch {
    // Not downloaded yet.
  }

  const bin = resolveYtDlp()
  if (!bin) return null
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {})
  const template = path.join(dir, `${videoId}.%(ext)s`)

  for (const lang of languageCandidates(languageHint)) {
    const code = await run(
      bin,
      [
        '--no-warnings',
        '--skip-download',
        '--write-auto-subs',
        '--sub-langs', lang,
        '--sub-format', 'json3',
        '--retries', '1',
        '-o', template,
        `https://www.youtube.com/watch?v=${videoId}`
      ],
      CAPTION_TIMEOUT_MS
    )
    if (code !== 0) continue
    try {
      // yt-dlp writes `<id>.<lang>.json3` (or `.json3` variations).
      const files = await fs.promises.readdir(dir)
      const hit = files.find((f) => f.startsWith(`${videoId}.`) && f.endsWith('.json3'))
      if (!hit) continue
      const raw = await fs.promises.readFile(path.join(dir, hit), 'utf8')
      if (raw.length === 0 || raw.length > MAX_CAPTION_BYTES) continue
      // Keep the first language that produced usable timings, under the plain
      // `<id>.json3` name so later lookups are a single read.
      await fs.promises.writeFile(cached, raw).catch(() => {})
      return raw
    } catch {
      // Try the next language.
    }
  }
  return null
}

export interface CaptionAlignment {
  videoId: string
  videoTitle: string
  videoDurationSec: number
  /** Timed captions of that video — useful even when the text fit fails. */
  cues: CaptionCue[]
  /** The deterministic text alignment, or null when the captions disagree. */
  fit: CaptionFit | null
}

/**
 * Find the video that *is* this file and line the given lyrics up with its
 * captions.
 *
 * Returns null only when there is nothing to work with: no video whose length
 * matches, or no captions at all. When captions exist but the text alignment
 * refuses (automatic captions are noisy), they are handed back with `fit: null`
 * so a model can still estimate the shift from them.
 */
export async function alignToCaptions(
  title: string,
  durationSec: number,
  lines: LyricLine[]
): Promise<CaptionAlignment | null> {
  if (lines.length < 2 || durationSec <= 0) return null

  let hits: Awaited<ReturnType<typeof search>>
  try {
    // `background` keeps this from cancelling a search the user is typing.
    hits = await search(title, 8, { background: true })
  } catch {
    return null
  }

  // The recording is identified by its length: within a second is the same
  // audio, a couple of seconds still plausible for a slightly different rip.
  const tolerance = Math.max(3, durationSec * 0.02)
  const candidates = hits
    .filter((hit) => hit.durationSec > 0 && Math.abs(hit.durationSec - durationSec) <= tolerance)
    .sort((a, b) => Math.abs(a.durationSec - durationSec) - Math.abs(b.durationSec - durationSec))
  if (candidates.length === 0) return null

  const video = candidates[0]
  const raw = await captionsFor(video.id, `${title} ${lines[0]?.text ?? ''} ${lines[1]?.text ?? ''}`)
  if (!raw) return null

  const cues = parseCaptionCues(raw)
  if (cues.length < 2) return null

  return {
    videoId: video.id,
    videoTitle: video.title,
    videoDurationSec: video.durationSec,
    cues,
    fit: alignLyricsToCues(lines, cues)
  }
}
