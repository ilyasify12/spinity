import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { resolveFfprobe } from './ytdlp'
import type { AudioInfo } from '../shared/types'

/**
 * On-demand audio properties for the player bar's codec tag
 * (e.g. "FLAC · 96 kHz · 24-bit"). ffprobe discovery is shared with the
 * local indexer and the artwork pipeline (see ytdlp.ts). Results are cached
 * in memory (capped) so replays cost nothing.
 */

const cache = new Map<string, AudioInfo | null>()
const MAX_CACHE = 200

function cacheKey(filePath: string, stat: fs.Stats): string {
  return `${filePath}|${stat.size}|${stat.mtimeMs}`
}

export function probeAudio(filePath: string): Promise<AudioInfo | null> {
  const ffprobe = resolveFfprobe()
  if (!ffprobe) return Promise.resolve(null)
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
    if (!stat.isFile()) return Promise.resolve(null)
  } catch {
    return Promise.resolve(null)
  }
  const key = cacheKey(filePath, stat)
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null)

  return new Promise((resolve) => {
    const child = spawn(
      ffprobe,
      [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,sample_rate,bits_per_sample,bits_per_raw_sample,channels,bit_rate:format=bit_rate,size',
        '-of', 'json',
        filePath
      ],
      { shell: false, windowsHide: true }
    )
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, 10_000)
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
      if (out.length > 65536) child.kill()
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out) as {
          streams?: { codec_name?: string; sample_rate?: string; bits_per_sample?: number; bits_per_raw_sample?: number; channels?: number; bit_rate?: string }[]
          format?: { bit_rate?: string; size?: string }
        }
        const s = parsed.streams?.[0]
        if (!s?.codec_name) {
          resolve(null)
          return
        }
        const info: AudioInfo = {
          codec: s.codec_name,
          sampleRate: Number(s.sample_rate) || 0,
          bitsPerSample: Number(s.bits_per_sample ?? s.bits_per_raw_sample) || 0,
          channels: Number(s.channels) || 0,
          bitRate: Number(s.bit_rate ?? parsed.format?.bit_rate) || 0
        }
        cache.set(key, info)
        while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
        resolve(info)
      } catch {
        resolve(null)
      }
    })
  })
}
