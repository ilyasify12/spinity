import type { Track } from '../shared/types'
import type { CoverLookup } from './coverArt'
import type { EmbeddedArtwork } from './artwork'

/**
 * Background artwork warmer.
 *
 * A freshly indexed local folder used to make its first paint crawl: every
 * visible tile triggered its own ffprobe/ffmpeg extraction, and files without
 * embedded art fell through to a yt-dlp cover search — seconds of work per tile,
 * all of it on the requests the user is waiting for.
 *
 * This module pays that cost early, at a deliberately low priority, so tiles
 * are usually served straight from memory:
 *
 *   - embedded art is extracted first (per-file, bounded)
 *   - borrowed YouTube covers are only searched for titles that are real song
 *     names (`1.mp3` is skipped by `coverQuery`), and only up to a budget so a
 *     5000-file folder can never turn into 5000 background searches
 *
 * Everything is cached on disk, so this runs once per folder, not per launch.
 */

interface Deps {
  /** Same loader the `spinity://artwork` protocol uses. */
  localArtwork: (filePath: string) => Promise<EmbeddedArtwork>
  cover: CoverLookup
  /** Called when a borrowed cover becomes available (so tiles can refresh). */
  onCover: (trackId: string) => void
}

let deps: Deps | null = null
let running = false
let queue: Track[] = []
const done = new Set<string>()

/** Per-round budgets: correctness never depends on either being hit. */
const MAX_EMBEDDED = 150
const MAX_COVERS = 40

export function initArtworkWarmer(d: Deps): void {
  deps = d
}

/** Remember tracks that still need artwork, and pump the queue. */
export function warmArtwork(tracks: Track[]): void {
  if (!deps) return
  for (const track of tracks) {
    if (track.source !== 'local' || !track.filePath || done.has(track.id)) continue
    done.add(track.id)
    queue.push(track)
  }
  void pump()
}

/** Drop tracks that are no longer in the library (folder removed / re-indexed). */
export function forgetArtworkWarm(trackIds: string[]): void {
  for (const id of trackIds) done.delete(id)
}

async function pump(): Promise<void> {
  if (running) return
  const d = deps
  if (!d) return
  running = true
  try {
    let embedded = 0
    let covers = 0
    while (queue.length > 0) {
      const track = queue.shift()!
      // The other two budgets are shared: embedded extraction is cheap, the
      // yt-dlp searches are not, so they run out first.
      if (embedded >= MAX_EMBEDDED && covers >= MAX_COVERS) break
      const hasBudget = embedded < MAX_EMBEDDED
      if (hasBudget) {
        embedded += 1
        const art = await d.localArtwork(track.filePath).catch((): EmbeddedArtwork => ({ image: null, embedded: null }))
        if (art.image) continue
        // No verdict yet (tools missing, probe failed): borrowing a cover for
        // it could paint an unrelated thumbnail over a file that does have art.
        if (art.embedded !== false) continue
      }
      if (covers >= MAX_COVERS) continue
      covers += 1
      // `warm` checks memory/disk first, so this only searches when unknown.
      const cover = await d.cover.warm(track.title, track.artist).catch(() => null)
      if (cover) d.onCover(track.id)
      // Yield between tracks so a big folder never blocks IPC or playback.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } finally {
    running = false
  }
}
