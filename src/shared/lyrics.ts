/**
 * Synced-lyrics (.lrc) parsing — shared by main (cache warming) and renderer
 * (highlighting). Pure and dependency-free.
 */

export interface LyricLine {
  /** Seconds into the track. */
  t: number
  text: string
}

const LEAD = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/
const ONE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

function toSeconds(min: string, sec: string, frac: string | undefined): number {
  const m = Number(min)
  const s = Number(sec)
  let ms = 0
  if (frac !== undefined) {
    // 1 digit = tenths, 2 = hundredths, 3+ = milliseconds.
    if (frac.length === 1) ms = Number(frac) * 100
    else if (frac.length === 2) ms = Number(frac) * 10
    else ms = Number(frac.slice(0, 3))
  }
  return m * 60 + s + ms / 1000
}

/**
 * Parse LRC text into sorted lines. Metadata tags ([ar:], [ti:], …) never
 * match the timestamp shape and are dropped, as are empty lines. A line may
 * carry several timestamps — each becomes its own entry.
 */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const lead = LEAD.exec(raw.trim())
    if (!lead) continue
    const text = lead[2].trim()
    if (!text) continue
    ONE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ONE.exec(lead[1])) !== null) {
      const t = toSeconds(m[1], m[2], m[3])
      if (Number.isFinite(t) && t >= 0) out.push({ t, text })
    }
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** Index of the line playing at `positionSec` (-1 = none yet). */
export function lyricIndexAt(lines: LyricLine[], positionSec: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= positionSec + 0.05) idx = i
    else break
  }
  return idx
}

// ------------------------------------------------------------ sync / timing

/**
 * How a track's lyrics are mapped onto the audio.
 *
 * Lyrics come from a *reference* recording, and local files are frequently not
 * that recording: sped up, slowed down, re-cut, or simply a different intro.
 * `scale` stretches the whole timeline (local duration ÷ reference duration)
 * and `offsetMs` slides it. Both are per track and survive restarts.
 */
export interface LyricSync {
  /** Milliseconds the lyrics are shifted; positive = later. */
  offsetMs: number
  /** Timeline multiplier: local duration ÷ reference duration. 1 = as-is. */
  scale: number
  /** True while the values are still the automatic fit (nothing hand-tuned). */
  auto: boolean
  /** Reference length the fit was derived from, when known. */
  refDurationSec: number
  /**
   * Where the numbers came from: `duration` (the two lengths), `captions`
   * (aligned to the timed captions of the exact recording) or `manual`.
   */
  source?: 'duration' | 'captions' | 'manual'
  /** When the lyrics were last aligned against the actual recording. */
  alignedAt?: number
}

export const DEFAULT_LYRIC_SYNC: LyricSync = { offsetMs: 0, scale: 1, auto: true, refDurationSec: 0 }

/**
 * Automatic fit from the two durations.
 *
 * A file that is the same song at a different speed has a duration ratio that
 * matches its speed factor, so stretching the lyric timeline by that ratio puts
 * every line back on the right beat — this is what fixes sped-up/slowed rips
 * without any manual work. Ratios outside `[0.7, 1.4]` are *not* speed changes
 * but cuts, edits or a different arrangement, where no global transform can be
 * right; those keep scale 1 and get a visible hint in the panel instead.
 */
export function autoLyricSync(localDurationSec: number, refDurationSec: number): LyricSync {
  const local = Number(localDurationSec) || 0
  const ref = Number(refDurationSec) || 0
  if (local <= 0 || ref <= 0) return { ...DEFAULT_LYRIC_SYNC, refDurationSec: ref }
  const ratio = local / ref
  const plausible = ratio >= 0.7 && ratio <= 1.4 && Math.abs(ratio - 1) >= 0.02
  return {
    offsetMs: 0,
    scale: plausible ? ratio : 1,
    auto: true,
    refDurationSec: ref
  }
}

/** Audio position → position inside the lyrics (seconds). */
export function lyricTimeFromAudio(audioSec: number, sync: LyricSync): number {
  const scale = sync.scale > 0 ? sync.scale : 1
  return (audioSec * 1000 - sync.offsetMs) / 1000 / scale
}

/** Position inside the lyrics → audio position (for click-to-seek). */
export function audioTimeFromLyric(lyricSec: number, sync: LyricSync): number {
  const scale = sync.scale > 0 ? sync.scale : 1
  return lyricSec * scale + sync.offsetMs / 1000
}

/** Human label for the current fit, e.g. "+0.75s", "×0.92", "in sync". */
export function describeLyricSync(sync: LyricSync): string {
  const parts: string[] = []
  if (Math.abs(sync.offsetMs) >= 10) {
    const seconds = sync.offsetMs / 1000
    parts.push(`${seconds > 0 ? '+' : '−'}${Math.abs(seconds).toFixed(2).replace(/\.?0+$/, '')}s`)
  }
  if (Math.abs(sync.scale - 1) >= 0.005) parts.push(`×${sync.scale.toFixed(2)}`)
  return parts.length > 0 ? parts.join(' ') : 'in sync'
}

/** True when the reference recording is audibly a different edit of this file. */
export function isForeignEdit(localDurationSec: number, refDurationSec: number): boolean {
  const local = Number(localDurationSec) || 0
  const ref = Number(refDurationSec) || 0
  if (local <= 0 || ref <= 0) return false
  const drift = Math.abs(local - ref)
  return drift > Math.max(4, local * 0.05)
}

/**
 * Whether a stored timing still belongs to the lyrics it was computed for.
 *
 * A fit is an offset into *specific* line timings and a scale for a *specific*
 * reference length. When the matcher later picks a different recording — a
 * 3:10 remix instead of the 4:32 original, say — those numbers are meaningless,
 * and applying them is how lyrics end up racing ahead of the song. Tying the
 * record to its reference lets the app drop it and start again.
 */
export function isStaleLyricSync(stored: LyricSync, refDurationSec: number): boolean {
  const storedRef = Number(stored.refDurationSec) || 0
  const currentRef = Number(refDurationSec) || 0
  if (storedRef <= 0 || currentRef <= 0) return false
  return Math.abs(storedRef - currentRef) > 2
}
