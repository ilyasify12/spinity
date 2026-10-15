import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveFfmpeg, resolveFfprobe } from './ytdlp'

const execute = promisify(execFile)
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

/**
 * What the probe found in one audio file.
 *
 * `embedded` is deliberately three-state. "We could not read the file" and
 * "the file carries no picture" must never collapse into the same answer:
 * only the second one may open the door to a borrowed YouTube cover, while
 * the first one has to keep showing the placeholder until the tools exist.
 * Collapsing them is how a reinstalled Windows (ffmpeg present, ffprobe
 * unreachable) ended up stamping unrelated thumbnails onto local files.
 */
export interface EmbeddedArtwork {
  /** JPEG/PNG bytes of the embedded picture, when one was read. */
  image: Buffer | null
  /** true = a picture exists, false = none does, null = could not find out. */
  embedded: boolean | null
}

type Probe = EmbeddedArtwork & {
  /** Whether the verdict is safe to persist across launches. */
  cacheable: boolean
}

const UNKNOWN: EmbeddedArtwork = Object.freeze({ image: null, embedded: null })

/** Tool paths in play — changes whenever the user installs the tools. */
function toolState(): string {
  return `${resolveFfmpeg() ?? ''}|${resolveFfprobe() ?? ''}`
}

/**
 * Embedded artwork ONLY. No directory scans or shared folder covers.
 * Uses a limited worker pool to extract artwork without overwhelming the system.
 * Confirmed verdicts (picture found / definitely none) are cached on disk
 * across launches; "could not find out" never is, so a missing tool repairs
 * itself the moment it is installed.
 */
export function createArtworkLoader(cacheRoot: string) {
  const memory = new Map<string, EmbeddedArtwork>()
  const pending = new Map<string, Promise<EmbeddedArtwork>>()
  /** Per-session dead ends, keyed by tool state so a fresh install retries. */
  const unknown = new Map<string, EmbeddedArtwork>()
  let activeCount = 0
  const maxConcurrent = 3
  const queue: Array<() => void> = []

  const remember = (key: string, value: EmbeddedArtwork): void => {
    memory.set(key, value)
    while (memory.size > 200) memory.delete(memory.keys().next().value!)
  }

  const worker = async (filePath: string, key: string): Promise<EmbeddedArtwork> => {
    const destination = path.join(cacheRoot, `${key}.art`)
    try {
      const cached = await fs.readFile(destination)
      if (cached.length <= MAX_IMAGE_BYTES) {
        const result: EmbeddedArtwork = cached.length
          ? { image: cached, embedded: true }
          : { image: null, embedded: false }
        remember(key, result)
        return result
      }
    } catch {
      // First request for this revision of the file.
    }

    const probe = await extractEmbedded(filePath)
    if (probe.cacheable) {
      try {
        await fs.mkdir(cacheRoot, { recursive: true })
        const temp = `${destination}.${process.pid}.tmp`
        await fs.writeFile(temp, probe.image ?? Buffer.alloc(0))
        await fs.rename(temp, destination)
      } catch {
        // Read-only/full cache must not block playback.
      }
    }

    const result: EmbeddedArtwork = { image: probe.image, embedded: probe.embedded }
    if (result.embedded === null) {
      const deadEnd = `${toolState()}|${key}`
      unknown.set(deadEnd, result)
      while (unknown.size > 200) unknown.delete(unknown.keys().next().value!)
    } else {
      remember(key, result)
    }
    return result
  }

  return async (filePath: string): Promise<EmbeddedArtwork> => {
    const stat = await fs.stat(filePath).catch(() => null)
    // A file we cannot even stat has told us nothing about its artwork.
    if (!stat?.isFile()) return UNKNOWN
    const key = createHash('sha256').update(
      `embedded-v5|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`
    ).digest('hex')
    if (memory.has(key)) return memory.get(key)!
    if (pending.has(key)) return pending.get(key)!
    const deadEnd = `${toolState()}|${key}`
    if (unknown.has(deadEnd)) return unknown.get(deadEnd)!

    const job = new Promise<EmbeddedArtwork>((resolve) => {
      queue.push(() => {
        activeCount++
        worker(filePath, key)
          .then((result) => {
            resolve(result)
          })
          .catch((err) => {
            console.error('[artwork] extraction failed for', filePath, err)
            resolve(UNKNOWN)
          })
          .finally(() => {
            activeCount--
            pending.delete(key)
            if (queue.length > 0) {
              const next = queue.shift()!
              next()
            }
          })
      })
      if (activeCount < maxConcurrent) {
        const next = queue.shift()!
        next()
      }
    })
    pending.set(key, job)
    return job
  }
}

async function extractEmbedded(filePath: string): Promise<Probe> {
  const ffmpeg = resolveFfmpeg()
  const ffprobe = resolveFfprobe()
  // Tools not installed (yet): no verdict at all, and nothing is cached, so
  // the first launch after installing them reads the real covers.
  if (!ffmpeg || !ffprobe) return { ...UNKNOWN, cacheable: false }

  let streams: Array<{ index: number; disposition?: { attached_pic?: number } }> = []
  try {
    const { stdout } = await execute(ffprobe, ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=index:stream_disposition=attached_pic', '-of', 'json', filePath],
    { windowsHide: true, timeout: 8000, maxBuffer: MAX_IMAGE_BYTES })
    const data = JSON.parse(stdout) as {
      streams?: Array<{ index: number; disposition?: { attached_pic?: number } }>
    }
    streams = data.streams ?? []
  } catch {
    // Timeout or unreadable container — still no verdict.
    return { ...UNKNOWN, cacheable: false }
  }

  const stream = streams.find((s) => s.disposition?.attached_pic === 1)
  // Probed successfully and there is no picture: record it, this one may fall
  // back to a borrowed cover.
  if (!stream) return { image: null, embedded: false, cacheable: true }

  try {
    const image = await execute(ffmpeg, ['-nostdin', '-v', 'error', '-threads', '1', '-i', filePath,
      '-map', `0:${stream.index}`, '-frames:v', '1', '-vf',
      // Cap the largest side at 512px (was 128 — blurry on Home cards).
      // `decrease` never upscales small embeds; aspect is preserved.
      'scale=512:512:force_original_aspect_ratio=decrease', '-threads', '1',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, timeout: 12000, maxBuffer: MAX_IMAGE_BYTES })
    if (!image.stdout.length) {
      // The picture is there but would not decode: say so, so that no borrowed
      // cover is shown in its place.
      return { image: null, embedded: true, cacheable: false }
    }
    return { image: image.stdout, embedded: true, cacheable: true }
  } catch {
    return { image: null, embedded: true, cacheable: false }
  }
}
