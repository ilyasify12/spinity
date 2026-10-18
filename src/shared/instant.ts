/**
 * Text → stream helpers for the instant-resolve path.
 *
 * The main process asks yt-dlp to extract the first YouTube match for
 * "Artist - Track" free text and to print the result as ONE JSON object per
 * line. Parsing JSON beats splitting `%(url)s|%(ext)s` on a separator: titles
 * may contain pipes, quotes or newlines and a naive split would silently
 * mis-map fields. Live fixtures for both helpers live in the unit tests.
 *
 * NOTE on prefixes: the original spec used `ytmsearch1:` (YouTube Music
 * search). Live measurement on yt-dlp 2026.08.19: `ytmsearch1:` is not an
 * extractor prefix ("ERROR: Unsupported url scheme"), and the equivalent
 * music.youtube.com/search URL returns browse/playlist ids in flat mode and
 * extracts 3–7× slower than plain search. `ytsearch1:` is what the app's
 * Search page already uses, so text resolve stays consistent with it.
 *
 * Kept in `shared` (no electron, no child_process) so the parsers are
 * unit-testable exactly as they ship.
 */

export interface InstantResolve {
  /** YouTube video id of the winning search hit. */
  videoId: string
  title: string
  /** Signed direct media URL suitable for `<audio src>`. */
  url: string
  /** Container yt-dlp picked (m4a, webm, …). */
  ext: string
  /** Transfer protocol — `https` for progressive, `m3u8*` for manifests. */
  protocol: string
}

/**
 * `--print` template for the search + extract pass.
 *
 * `%(field)j` emits JSON-escaped values, so the whole line stays valid JSON
 * even when the title carries quotes or unicode.
 */
export const INSTANT_PRINT_TEMPLATE =
  '{"id":%(id)j,"title":%(title)j,"url":%(url)j,"ext":%(ext)j,"protocol":%(protocol)j}'

/**
 * Flat-search template (no extraction): ids only. Fields that may be missing
 * are never requested — `%(field)j` prints a bare `NA` for those, which is
 * not valid JSON.
 */
export const INSTANT_CANDIDATE_TEMPLATE = '{"id":%(id)j}'

/** Collapse control characters and dead whitespace; cap absurd input. */
export function normalizeInstantQuery(input: string): string {
  return String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/**
 * Pick the result out of yt-dlp stdout: the last well-formed JSON line that
 * carries a plausible video id and an http(s) URL. Anything else (progress
 * noise, warnings) is skipped, so a single malformed line cannot poison the
 * resolve.
 */
export function parseInstantLine(stdout: string): InstantResolve | null {
  const lines = String(stdout ?? '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.length < 2 || !line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const url = typeof raw.url === 'string' ? raw.url : ''
      const videoId = typeof raw.id === 'string' ? raw.id : ''
      if (!/^https?:/i.test(url) || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) continue
      return {
        videoId,
        title: typeof raw.title === 'string' ? raw.title : '',
        url,
        ext: typeof raw.ext === 'string' ? raw.ext : '',
        protocol: typeof raw.protocol === 'string' ? raw.protocol : ''
      }
    } catch {
      /* not JSON — keep scanning upwards */
    }
  }
  return null
}

/**
 * Candidate ids from a flat search, in the order YouTube ranked them.
 * Duplicates removed; non-video entries (browse/playlist ids are longer
 * than a video id) are filtered by the id shape.
 */
export function parseInstantCandidates(stdout: string): string[] {
  const ids: string[] = []
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.trim()
    if (line.length < 2 || !line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (typeof parsed.id !== 'string') continue
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(parsed.id)) continue
      if (!ids.includes(parsed.id)) ids.push(parsed.id)
    } catch {
      /* not JSON — skip */
    }
  }
  return ids
}
