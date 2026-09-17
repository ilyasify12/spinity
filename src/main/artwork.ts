import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveFfmpeg } from './ytdlp'

const execute = promisify(execFile)
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

type Extraction = { image: Buffer | null; cacheable: boolean }

/** Embedded artwork ONLY. No directory scans or shared folder covers.
 * Uses a limited worker pool to extract artwork without overwhelming the system.
 * Both images and confirmed absence are cached on disk across launches.
 */
export function createArtworkLoader(cacheRoot: string) {
  const memory = new Map<string, Buffer | null>()
  const pending = new Map<string, Promise<Buffer | null>>()
  let activeCount = 0
  const maxConcurrent = 3
  const queue: Array<() => void> = []

  const worker = async (filePath: string, key: string): Promise<Buffer | null> => {
    const destination = path.join(cacheRoot, `${key}.art`)
    try {
      const cached = await fs.readFile(destination)
      if (cached.length <= MAX_IMAGE_BYTES) return cached.length ? cached : null
    } catch {
      // First request for this revision of the file.
    }

    const result = await extractEmbedded(filePath)
    if (result.cacheable) {
      try {
        await fs.mkdir(cacheRoot, { recursive: true })
        const temp = `${destination}.${process.pid}.tmp`
        await fs.writeFile(temp, result.image ?? Buffer.alloc(0))
        await fs.rename(temp, destination)
      } catch {
        // Read-only/full cache must not block playback.
      }
    }

    memory.set(key, result.image)
    while (memory.size > 200) memory.delete(memory.keys().next().value!)
    return result.image
  }

  return async (filePath: string): Promise<Buffer | null> => {
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return null
    const key = createHash('sha256').update(
      `embedded-v3|${path.resolve(filePath)}|${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}`
    ).digest('hex')
    if (memory.has(key)) return memory.get(key) ?? null
    if (pending.has(key)) return pending.get(key)!

    const job = new Promise<Buffer | null>((resolve) => {
      queue.push(() => {
        activeCount++
        worker(filePath, key)
          .then((image) => {
            memory.set(key, image)
            while (memory.size > 200) memory.delete(memory.keys().next().value!)
            resolve(image)
          })
          .catch((err) => {
            console.error('[artwork] extraction failed for', filePath, err)
            resolve(null)
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

async function extractEmbedded(filePath: string): Promise<Extraction> {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) return { image: null, cacheable: false }
  try {
    const actual = await fs.realpath(ffmpeg)
    const ffprobe = path.join(path.dirname(actual), 'ffprobe.exe')
    const { stdout } = await execute(ffprobe, ['-v', 'error', '-select_streams', 'v',
      '-show_entries', 'stream=index:stream_disposition=attached_pic', '-of', 'json', filePath],
    { windowsHide: true, timeout: 8000, maxBuffer: MAX_IMAGE_BYTES })
    const data = JSON.parse(stdout) as {
      streams?: Array<{ index: number; disposition?: { attached_pic?: number } }>
    }
    const stream = data.streams?.find((s) => s.disposition?.attached_pic === 1)
    if (!stream) return { image: null, cacheable: true }
    const image = await execute(ffmpeg, ['-nostdin', '-v', 'error', '-threads', '1', '-i', filePath,
      '-map', `0:${stream.index}`, '-frames:v', '1', '-vf',
      'scale=128:128:force_original_aspect_ratio=decrease', '-threads', '1',
      '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
    { encoding: 'buffer', windowsHide: true, timeout: 12000, maxBuffer: MAX_IMAGE_BYTES })
    return { image: image.stdout.length ? image.stdout : null, cacheable: image.stdout.length > 0 }
  } catch {
    // Do not persist failures (missing tools, corrupt files, timeout) as no-art.
    return { image: null, cacheable: false }
  }
}
