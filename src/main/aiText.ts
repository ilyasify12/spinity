import type { LyricLine } from '../shared/lyrics'

/**
 * Pure parts of the optional AI assistant: prompt building and answer parsing.
 *
 * Kept apart from `ai.ts` (which does the network calls and the caching) so the
 * wording of a prompt and the tolerance of the parser can be tested without a
 * key, a network or a store.
 */

/** Extract the first balanced JSON object from a model reply. */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1)) as unknown
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** One candidate record as the model sees it. */
export interface CandidateView {
  trackName?: string | null
  artistName?: string | null
  duration?: number | null
  syncedLyrics?: string | null
}

/** How many candidates and lines are worth sending: more costs latency, not accuracy. */
export const MAX_CANDIDATES = 10
export const MAX_LYRIC_LINES = 12
export const MAX_CUES = 24

/**
 * "What song is this really?" — for names a search engine cannot use.
 *
 * Only metadata goes in: no paths, no audio. Downloader noise and uploader
 * by-lines are called out explicitly because that is what breaks a lookup.
 */
export function identifyPrompt(input: {
  fileName: string
  title: string
  artist: string
  durationSec: number
}): string {
  return [
    'A music file on a user’s computer has messy metadata. Identify the real song.',
    `File name: ${JSON.stringify(input.fileName)}`,
    `Title tag: ${JSON.stringify(input.title)}`,
    `Artist tag: ${JSON.stringify(input.artist)}`,
    input.durationSec > 0 ? `Length: ${Math.round(input.durationSec)} seconds` : '',
    'Ignore downloader site names, bitrates, "(Official Video)"-style tags and uploader by-lines.',
    'If the file is a remix, cover or parody, name the *underlying* song so its lyrics can be found.',
    'Answer: {"title": "<song name>", "artist": "<performer>"}'
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * "Which of these records is this file?" — the question the heuristics cannot
 * answer when several edits share a title.
 */
export function pickPrompt(
  input: { title: string; artist: string; durationSec: number },
  candidates: CandidateView[]
): string {
  const lines = candidates
    .slice(0, MAX_CANDIDATES)
    .map((hit, index) => {
      const length = Math.round(hit.duration ?? 0)
      return `${index}: "${hit.trackName ?? ''}" by "${hit.artistName ?? ''}" (${length}s)${hit.syncedLyrics ? ' [timed lyrics]' : ''}`
    })
    .join('\n')

  return [
    'Which record is the same recording as this local file? Lyrics only work when the timing belongs to the same edit.',
    `Local file: title ${JSON.stringify(input.title)}, artist ${JSON.stringify(input.artist)}${input.durationSec > 0 ? `, length ${Math.round(input.durationSec)} seconds` : ''}`,
    'Candidates:',
    lines,
    'A length that matches the local file is much stronger evidence than an artist name; remixes, covers and edits often share the title but not the timing.',
    'Answer: {"pick": <candidate number, or -1 if none of them is the same recording>}'
  ].join('\n')
}

/**
 * "How far must these lyrics move?" — the fallback when automatic captions are
 * too noisy for the deterministic aligner.
 */
export function alignPrompt(lines: LyricLine[], cues: { t: number; text: string }[]): string {
  const lyricLines = lines
    .slice(0, MAX_LYRIC_LINES)
    .map((line, index) => `${index}. ${line.t.toFixed(2)}s ${line.text}`)
    .join('\n')
  const cueLines = cues
    .slice(0, MAX_CUES)
    .map((cue) => `${cue.t.toFixed(2)}s ${cue.text}`)
    .join('\n')

  return [
    'The left list is the lyrics of this song with the timing of a *different* release.',
    'The right list is the timed captions of the user’s exact audio file.',
    'Find the constant number of seconds that must be ADDED to the lyric times so they line up with the captions.',
    'Lyrics:',
    lyricLines,
    'Captions of this file:',
    cueLines,
    'Answer: {"offsetSec": <number>, "confidence": <0 to 1>}'
  ].join('\n')
}

/**
 * "Write this song's lyrics" — the AI writing mode.
 *
 * Four deliberate choices:
 *
 *  - **Plain lines only, never timestamps.** Timings invented by a model are
 *    exactly the drifting-lyrics problem the deterministic aligner exists to
 *    avoid, so this mode can only return un-timed text.
 *  - **No length is sent.** Telling the model a file is 103 seconds long made
 *    it pad short edits by looping one chorus line forever; the full canonical
 *    text is safer than a hallucinated fit.
 *  - **An anti-repeat instruction.** Small models at temperature 0 fall into
 *    repetition loops instead of moving through the song.
 *  - **A built-in refusal.** `{"unknown": true}` is the sanctioned answer when
 *    the model does not actually know the song. Plausible invented words are
 *    worse than showing nothing, because the panel would then fall back to the
 *    real matched lyrics instead of displaying a guess.
 */
export function writeLyricsPrompt(input: {
  title: string
  artist: string
}): string {
  return [
    'Write the complete lyrics of this song, one string per line, in the original language.',
    `Title: ${JSON.stringify(input.title)}`,
    input.artist ? `Artist: ${JSON.stringify(input.artist)}` : '',
    'Return the lines in the order they are sung. No headings, no commentary, no translations, no timestamps.',
    'Do not repeat the same line over and over — keep moving through the verses and the chorus to the end of the song.',
    'If you do not know this song with confidence, answer exactly {"unknown": true} instead of inventing words.',
    'Answer: {"unknown": false, "lines": ["line 1", "line 2", "line 3"]}'
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * True when a written answer is stuck in a repetition loop — the model emitted
 * one chorus line dozens of times instead of moving through the song. Measured
 * against a German track at temperature 0; such answers are discarded rather
 * than displayed or cached.
 */
export function isRepeatedWrite(lines: string[]): boolean {
  if (lines.length < 8) return false
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  const repeated = Math.max(...counts.values())
  return repeated / lines.length > 0.5
}

/** Read a numeric field that may arrive as a string ("pick": "2"). */
export function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** Read a trimmed string field. */
export function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
