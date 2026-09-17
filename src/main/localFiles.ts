import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { db } from './db'
import type { Track } from '../shared/types'

/**
 * Local music folder support.
 *
 * Files are indexed, never copied or moved, and never modified. The track id
 * is a hash of the file path so a rescan recognises the same file instead of
 * duplicating it.
 */

const AUDIO_EXTS = new Set([
  '.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.opus', '.wma', '.webm'
])

/** Depth cap so a folder that (accidentally) contains its own parents cannot
 * make the scan run away. */
const MAX_DEPTH = 8

/** Stable id from the path, case-insensitive (NTFS is case-insensitive). */
export function localTrackId(filePath: string): string {
  const hash = crypto.createHash('sha1').update(filePath.toLowerCase()).digest('hex')
  return `loc_${hash.slice(0, 20)}`
}

/** "Artist - Title.mp3" -> artist/title. Anything else falls back to the
 * parent folder name as the artist, which is a common way people organise. */
function parseName(filePath: string): { title: string; artist: string } {
  const base = path.basename(filePath, path.extname(filePath)).replace(/_+/g, ' ').trim()
  const match = /^(.+?)\s+-\s+(.+)$/.exec(base)
  if (match) {
    return { artist: match[1].trim(), title: match[2].trim() }
  }
  const parent = path.basename(path.dirname(filePath)).replace(/_+/g, ' ').trim()
  return { artist: parent || 'Unknown artist', title: base || 'Untitled' }
}

/** ffprobe sits next to ffmpeg; reuse the same discovery logic. */
function resolveFfprobe(): string | null {
  const home = process.env.USERPROFILE ?? ''
  const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  const candidates = [
    process.env.SPINITY_FFMPEG
      ? process.env.SPINITY_FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
      : '',
    path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe'),
    path.join(local, 'Programs', 'ffmpeg', 'bin', 'ffprobe.exe')
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/** Read the real duration with ffprobe so the seek bar and list are accurate. */
function probeDuration(filePath: string, ffprobe: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { shell: false, windowsHide: true }
    )
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(0)
    }, 10_000)
    child.stdout.on('data', (d: Buffer) => (out += d.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(0)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const seconds = Number.parseFloat(out.trim())
      resolve(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0)
    })
  })
}

/** Recursively collect audio files under a folder. */
export function scanFolder(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable folder — skip it rather than failing the whole scan
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(full)
    }
  }
  walk(root, 0)
  return files
}

/** Index a folder into the user's library. Returns the freshly built tracks. */
export function indexFolder(userId: string, root: string): Track[] {
  const existing = new Map(db.getTracks(userId).map((t) => [t.id, t]))
  const tracks: Track[] = scanFolder(root).map((filePath) => {
    const id = localTrackId(filePath)
    const previous = existing.get(id)
    const { title, artist } = parseName(filePath)
    return {
      id,
      source: 'local',
      title,
      artist,
      // Kept from the previous scan when ffprobe already measured it.
      durationSec: previous?.durationSec ?? 0,
      thumbnail: `spinity://artwork/${encodeURIComponent(id)}`,
      webUrl: '',
      filePath,
      downloadedAt: Date.now()
    }
  })
  return tracks
}

/**
 * Fill in missing durations with ffprobe, a few at a time, updating the
 * library as results land so the UI improves without a blocking scan.
 */
export function probeMissingDurations(userId: string, tracks: Track[]): void {
  const ffprobe = resolveFfprobe()
  if (!ffprobe) return

  const pending = tracks.filter((t) => t.durationSec <= 0).slice(0, 500)
  let cursor = 0
  let active = 0

  const runNext = (): void => {
    while (active < 4 && cursor < pending.length) {
      const track = pending[cursor++]
      active += 1
      void probeDuration(track.filePath, ffprobe).then((seconds) => {
        active -= 1
        if (seconds > 0) {
          const updated = db.getTracks(userId).find((t) => t.id === track.id)
          if (updated) db.upsertTrack(userId, { ...updated, durationSec: seconds })
        }
        runNext()
      })
    }
  }
  runNext()
}
