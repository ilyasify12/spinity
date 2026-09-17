import type { Track } from '@shared/types'

/**
 * Search normalisation and fuzzy matching for the local library.
 *
 * Implements the indexing rules for the library search index:
 *   - original titles/artists are kept verbatim for display
 *   - a normalised `searchable_text` is built with special chars stripped
 *   - matching is fuzzy, so common typos and spelling variants still hit
 *
 * This is the local equivalent of what a server-side index (Meilisearch /
 * Typesense) provides. A server is deliberately NOT used: the app is
 * local-only, so an in-memory index over the user's own tracks is simpler and
 * never ships their library anywhere. The `toIndexDocument` shape below is
 * kept identical to that schema anyway, so swapping in a real search engine
 * later is a drop-in change.
 */

/**
 * Normalise a string for matching: strip accents and symbols, lowercase, trim.
 * Accents are removed so "beyonce" and "beyoncé" match. Symbols are replaced
 * with spaces rather than deleted, so "AC/DC" normalises to "ac dc" and a
 * query for "ac" still matches.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** snake_case, e.g. "Daft Punk!" -> "daft_punk". */
export function toSnakeCase(input: string): string {
  return normalizeText(input).replace(/\s+/g, '_')
}

/** The single-string field used for broad, whole-query matching. */
export function buildSearchableText(parts: {
  title: string
  artist: string
  album: string
}): string {
  return normalizeText(`${parts.title} ${parts.artist} ${parts.album}`)
}

/** Field names lowercase/snake_case, matching the search-index schema. */
export interface IndexDocument {
  id: string
  title: string
  artist: string
  album: string
  searchable_text: string
  genre: string[]
  duration_seconds: number
  search_boost_tags: string[]
}

/**
 * Build an index document for a track.
 *
 * `album` and `genre` stay empty: YouTube search results do not expose them
 * without a second metadata request per video, and guessing would poison the
 * index. `search_boost_tags` is where typo/transliteration variants would be
 * pre-generated server-side; locally, fuzzy matching at query time covers the
 * same ground without inventing data.
 */
export function toIndexDocument(track: Track): IndexDocument {
  const album = ''
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album,
    searchable_text: buildSearchableText({ title: track.title, artist: track.artist, album }),
    genre: [],
    duration_seconds: track.durationSec,
    search_boost_tags: []
  }
}

/** Standard DP Levenshtein distance, bounded by early exit for speed. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    const swap = prev
    prev = curr
    curr = swap
  }
  return prev[b.length]
}

/** Tolerated edit distance scales with the query length, capped at 3. */
function maxDistance(needle: string): number {
  if (needle.length <= 4) return 1
  if (needle.length <= 8) return 2
  return 3
}

function tokenMatches(haystack: string, needle: string): boolean {
  if (haystack === needle) return true
  if (haystack.includes(needle)) return true
  return levenshtein(haystack, needle) <= maxDistance(needle)
}

/**
 * Fuzzy-search the library. Every query term must match somewhere; exact
 * token hits score highest, prefixes next, then fuzzy matches.
 */
export function searchLibrary(tracks: Track[], query: string): Track[] {
  const q = normalizeText(query)
  if (!q) return tracks

  const needles = q.split(' ').filter(Boolean)

  const scored: { track: Track; score: number }[] = []
  for (const track of tracks) {
    const doc = toIndexDocument(track)
    const tokens = doc.searchable_text.split(' ').filter(Boolean)

    let total = 0
    let allMatched = true
    for (const needle of needles) {
      let best = 0
      for (const token of tokens) {
        if (token === needle) best = Math.max(best, 3)
        else if (token.startsWith(needle)) best = Math.max(best, 2)
        else if (tokenMatches(token, needle)) best = Math.max(best, 1)
        if (best === 3) break
      }
      if (best === 0) {
        allMatched = false
        break
      }
      total += best
    }
    if (allMatched) scored.push({ track, score: total })
  }

  scored.sort(
    (a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title)
  )
  return scored.map((s) => s.track)
}
