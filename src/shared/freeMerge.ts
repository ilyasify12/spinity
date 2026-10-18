import type { FreeHit, FreeProvider } from './types'

/**
 * Cross-provider deduplication for free-catalogue hits.
 *
 * Lives in `shared` because both sides of the wire need it: the main process
 * merges the final list, and the renderer merges the per-provider partials
 * that arrive while the slower catalogues are still being searched.
 */

/** Lower-case, diacritics-stripped, punctuation-free comparison text. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const PROVIDER_RANK: Record<FreeProvider, number> = { deezer: 0, itunes: 1, archive: 2, spotify: 3 }

/** Prefer playable hits, then a stable provider order. */
function betterHit(a: FreeHit, b: FreeHit): FreeHit {
  const aPlay = a.audioUrl ? 1 : 0
  const bPlay = b.audioUrl ? 1 : 0
  if (aPlay !== bPlay) return aPlay > bPlay ? a : b
  if (PROVIDER_RANK[a.provider] !== PROVIDER_RANK[b.provider]) {
    return PROVIDER_RANK[a.provider] < PROVIDER_RANK[b.provider] ? a : b
  }
  return a
}

function fingerprint(hit: FreeHit): string {
  return `${normalizeText(hit.title)}|${normalizeText(hit.artist.replace(/\s*-\s*topic$/i, ''))}`
}

/**
 * Deduplicate across providers: the same recording found on Deezer and Apple
 * keeps one playable row and notes the other source in `alsoOn`. Durations
 * (when both known) must agree within 6s, so live versions don't collapse
 * into studio takes.
 */
export function mergeHits(hits: FreeHit[]): FreeHit[] {
  const out: FreeHit[] = []
  const seenIds = new Set<string>()
  const index = new Map<string, FreeHit>()
  for (const hit of hits) {
    if (seenIds.has(hit.id)) continue
    seenIds.add(hit.id)
    const fp = fingerprint(hit)
    const existing = index.get(fp)
    if (existing && (!existing.durationSec || !hit.durationSec || Math.abs(existing.durationSec - hit.durationSec) <= 6)) {
      const keep = betterHit(existing, hit)
      const drop = keep === existing ? hit : existing
      if (!keep.alsoOn) keep.alsoOn = []
      if (!keep.alsoOn.includes(drop.provider)) keep.alsoOn.push(drop.provider)
      if (!keep.spotifyUrl && drop.spotifyUrl) keep.spotifyUrl = drop.spotifyUrl
      if (drop.provider === 'spotify' && drop.pageUrl && !keep.pageUrl) keep.pageUrl = drop.pageUrl
      if (keep !== existing) {
        // The challenger won: replace the row already emitted.
        const at = out.indexOf(existing)
        if (at >= 0) out[at] = keep
        index.set(fp, keep)
      }
      continue
    }
    if (!existing) index.set(fp, hit)
    out.push(hit)
  }
  return out
}
