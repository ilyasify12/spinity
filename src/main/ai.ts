import { db } from './db'
import { cleanAiGuess, isGenericArtist, isNoiseOnly } from './coverArt'
import {
  alignPrompt,
  extractJson,
  identifyPrompt,
  isRepeatedWrite,
  pickPrompt,
  readNumber,
  readText,
  writeLyricsPrompt,
  type CandidateView
} from './aiText'
import type { LyricLine } from '../shared/lyrics'

/**
 * Optional AI assistance for lyrics matching.
 *
 * Heuristics get most songs right, but local names are hostile — downloader
 * sites, remix by-lines, fan-version titles — and a small language model reads
 * them far better than a regex. Three uses, all JSON-output and all optional:
 *
 *  1. `identifySong`  — the file name is gibberish to a search engine; ask what
 *     the song actually is, then search normally with that answer.
 *  2. `pickCandidate` — several lrclib records fit; ask which one is *this*
 *     recording (the words can be right while the timing belongs to another
 *     edit, which is the difference between lyrics that line up and lyrics that
 *     race).
 *  3. `alignOffset`   — the timed captions of the matching video are known but
 *     the deterministic aligner could not fit them; ask for the shift.
 *
 * Design rules that keep this from being a liability:
 *  - **Fast by default.** The default model is asked to skip its reasoning step
 *    (`enable_thinking: false`), which is the difference between ~400 ms and
 *    2.5–11 s. It returns plain JSON in `content`.
 *  - **Never in the way.** Every call has a hard timeout and returns null on any
 *    failure; the heuristic result is always the fallback.
 *  - **Once per track.** Answers are cached in the store, so a song costs at
 *    most one round trip per question, ever.
 *  - **Never the key in logs.** Only the model name and timings are logged.
 */

export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'
const BASE_URL = 'https://integrate.api.nvidia.com/v1'
/** Hard ceiling for a single call; past this the heuristics win. */
const CALL_TIMEOUT_MS = 12_000

export interface AiSettings {
  enabled: boolean
  apiKey: string
  model: string
}

export interface AiSongGuess {
  title: string
  artist: string
}

export interface AiCacheEntry {
  /** What the model said the song is. */
  title?: string
  artist?: string
  /** Index into the candidate list that it picked, if it picked one. */
  pick?: number
  /** Constant shift it proposed for the lyric timeline. */
  offsetSec?: number
  model: string
  at: number
  ms: number
}

let lastCallMs: number | null = null
let lastError: string | null = null
let calls = 0

/** Diagnostics for Settings: never includes the key. */
export function aiStatus(): {
  configured: boolean
  model: string
  calls: number
  lastMs: number | null
  lastError: string | null
} {
  const settings = readSettings()
  return {
    configured: Boolean(settings.apiKey),
    model: settings.model,
    calls,
    lastMs: lastCallMs,
    lastError
  }
}

function readSettings(): AiSettings {
  let settings: { aiLyrics?: boolean; aiApiKey?: string; aiModel?: string } = {}
  try {
    settings = db.getSettings()
  } catch {
    // Not signed in / store not ready: AI is simply unavailable.
  }
  const apiKey = process.env.SPINITY_AI_KEY || settings.aiApiKey || ''
  return {
    enabled: settings.aiLyrics !== false && Boolean(apiKey),
    apiKey,
    model: settings.aiModel || DEFAULT_MODEL
  }
}

/**
 * The outcome of one request.
 *
 * `flagError` means the gateway rejected the call *because* of the
 * `enable_thinking:false` flags, so it is worth retrying without them; `empty`
 * means the call worked but carried no JSON; `fail` is terminal — network,
 * timeout or a hard HTTP error — and must not be followed by more requests.
 */
type ChatAttempt =
  | { kind: 'answer'; answer: Record<string, unknown> }
  | { kind: 'flagError' }
  | { kind: 'empty' }
  | { kind: 'fail' }

/** The request body. `enable_thinking:false` is what makes this interactive. */
function chatBody(
  model: string,
  prompt: string,
  maxTokens: number,
  withFlags: boolean,
  stream: boolean,
  temperature = 0
): Record<string, unknown> {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a precise music metadata assistant. You answer with a single JSON object and no other text.'
      },
      { role: 'user', content: prompt }
    ],
    temperature,
    top_p: 1,
    max_tokens: maxTokens,
    stream,
    ...(withFlags ? { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: 'none' } : {})
  }
}

/**
 * Stream a completion and stop the moment a complete JSON object has arrived.
 *
 * The caller only ever wants the JSON, so waiting for the whole reply is wasted
 * time: a busy model that needs 16 s to emit its final token blows the 12 s
 * ceiling and the answer is thrown away, even though the object finished long
 * before. Reading the SSE deltas means the answer is used as soon as its closing
 * brace lands, which is what keeps the panel responsive when the model is slow.
 */
async function askStream(
  prompt: string,
  maxTokens: number,
  withFlags: boolean,
  timeoutMs = CALL_TIMEOUT_MS,
  temperature = 0
): Promise<ChatAttempt> {
  const { apiKey, model } = readSettings()
  const started = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody(model, prompt, maxTokens, withFlags, true, temperature)),
      signal: AbortSignal.timeout(timeoutMs)
    })
    calls += 1
    lastCallMs = Date.now() - started
    if (!res.ok || !res.body) {
      lastError = `HTTP ${res.status}`
      if (withFlags && res.status === 400) return { kind: 'flagError' }
      console.error('[ai] stream failed', res.status)
      return { kind: 'fail' }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const payload = line.replace(/^data:\s*/, '').trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
            const delta = chunk.choices?.[0]?.delta?.content
            if (delta) content += delta
          } catch {
            // A keep-alive comment or a split line — the next read completes it.
          }
        }
        // `extractJson` only returns once the object is balanced, so this fires
        // exactly when the answer is complete — not before, not a token after.
        const answer = extractJson(content)
        if (answer) {
          lastError = null
          return { kind: 'answer', answer }
        }
      }
    } finally {
      // Stop the model as soon as we have what we need (or have given up).
      await reader.cancel().catch(() => {})
    }

    const final = extractJson(content)
    if (final) {
      lastError = null
      return { kind: 'answer', answer: final }
    }
    lastError = 'empty stream'
    return { kind: 'empty' }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error('[ai] stream call failed:', lastError)
    return { kind: 'fail' }
  }
}

/** The plain fallback: one non-streaming request, parse the whole reply. */
async function askPlain(
  prompt: string,
  maxTokens: number,
  withFlags: boolean,
  timeoutMs = CALL_TIMEOUT_MS,
  temperature = 0
): Promise<ChatAttempt> {
  const { apiKey, model } = readSettings()
  const started = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody(model, prompt, maxTokens, withFlags, false, temperature)),
      signal: AbortSignal.timeout(timeoutMs)
    })
    calls += 1
    lastCallMs = Date.now() - started
    if (!res.ok) {
      lastError = `HTTP ${res.status}`
      if (withFlags && res.status === 400) return { kind: 'flagError' }
      console.error('[ai] request failed', res.status, (await res.text().catch(() => '')).slice(0, 160))
      return { kind: 'fail' }
    }
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    lastError = null
    const answer = extractJson(payload.choices?.[0]?.message?.content ?? '')
    return answer ? { kind: 'answer', answer } : { kind: 'empty' }
  } catch (err) {
    calls += 1
    lastCallMs = Date.now() - started
    lastError = err instanceof Error ? err.message : String(err)
    console.error('[ai] call failed:', lastError)
    return { kind: 'fail' }
  }
}

/**
 * One chat completion, JSON out.
 *
 * Streaming first — the answer is used the moment its JSON closes rather than
 * when the model stops talking. Then a plain request, and finally the same
 * without the flags in case the gateway rejects unknown parameters. A network or
 * timeout failure stops immediately instead of firing three doomed requests.
 */
async function askJson(
  prompt: string,
  maxTokens = 300,
  timeoutMs = CALL_TIMEOUT_MS,
  temperature = 0
): Promise<Record<string, unknown> | null> {
  if (!readSettings().enabled) return null

  let withFlags = true
  let attempt = await askStream(prompt, maxTokens, withFlags, timeoutMs, temperature)
  if (attempt.kind === 'answer') return attempt.answer
  if (attempt.kind === 'fail') return null
  if (attempt.kind === 'flagError') withFlags = false

  attempt = await askPlain(prompt, maxTokens, withFlags, timeoutMs, temperature)
  if (attempt.kind === 'answer') return attempt.answer
  if (attempt.kind === 'fail') return null
  if (attempt.kind === 'flagError') {
    if (!withFlags) return null
    withFlags = false
  }

  if (withFlags) {
    const last = await askPlain(prompt, maxTokens, false, timeoutMs, temperature)
    if (last.kind === 'answer') return last.answer
  }
  return null
}

// ------------------------------------------------------------------ caching

/**
 * Merge an answer into the track's entry.
 *
 * One entry per track holds everything the model ever said about it, so asking
 * a second question (or asking again later) never re-asks one already answered.
 */
function cacheMerge(trackId: string, patch: Partial<AiCacheEntry>, ms: number): AiCacheEntry {
  const current = db.getAiCache(trackId)
  const merged: AiCacheEntry = {
    ...(current ?? { model: readSettings().model, at: Date.now(), ms }),
    ...patch,
    model: readSettings().model,
    at: Date.now(),
    ms
  }
  db.setAiCache(trackId, merged)
  return merged
}

/** True when the model can be used at all (a key is configured). */
export function aiEnabled(): boolean {
  return readSettings().enabled
}

/**
 * The cached answers for a track, but only while they came from the model
 * configured *now*. Switching models must not silently keep the old answers.
 */
function freshCache(trackId: string): AiCacheEntry | null {
  const cached = db.getAiCache(trackId)
  if (!cached) return null
  return cached.model === readSettings().model ? cached : null
}

/**
 * Drop an "artist" the model echoed back as a downloader site or placeholder
 * ("Spotdown", "Unknown artist"). Only a field that is *entirely* noise is
 * dropped — a real artist that merely contains a noisy word is left alone, so
 * nothing legitimate is lost.
 */
function sanitizeArtist(artist: string): string {
  const value = artist.trim()
  return isGenericArtist(value) || isNoiseOnly(value) ? '' : value
}

/**
 * Ask what song a local file really is.
 *
 * Only the name and tags go out — never a path, never audio.
 */
export async function identifySong(
  trackId: string,
  input: { fileName: string; title: string; artist: string; durationSec: number }
): Promise<AiSongGuess | null> {
  if (!readSettings().enabled) return null
  const cached = freshCache(trackId)
  if (cached && (cached.title || cached.artist)) {
    // Sanitising on read also repairs an entry cached before the filter existed.
    return { title: cleanAiGuess(cached.title ?? ''), artist: sanitizeArtist(cached.artist ?? '') }
  }

  const started = Date.now()
  const answer = await askJson(identifyPrompt(input), 120)
  if (!answer) return null
  // The model can echo downloader noise back into either field — measured on a
  // real library: `モニタリング spotdown.org` came back with artist `Spotdown`.
  // Cleaning the title and discarding a fully-noisy artist keeps the follow-up
  // search honest, and can never invent a name the model did not supply.
  const title = cleanAiGuess(readText(answer.title))
  const artist = sanitizeArtist(readText(answer.artist))
  if (!title) return null
  cacheMerge(trackId, { title, artist }, Date.now() - started)
  return { title, artist }
}

/**
 * Ask which of the candidate records is the recording the user actually has.
 *
 * The words are identical across edits; the length is what separates them, and
 * a model reads a list far better than a single score threshold.
 */
export async function pickCandidate(
  trackId: string,
  input: { title: string; artist: string; durationSec: number },
  candidates: CandidateView[]
): Promise<number | null> {
  if (!readSettings().enabled || candidates.length === 0) return null
  const cached = freshCache(trackId)
  if (cached && typeof cached.pick === 'number') return cached.pick >= 0 ? cached.pick : null

  const started = Date.now()
  const answer = await askJson(pickPrompt(input, candidates), 60)
  if (!answer) return null
  const pick = readNumber(answer.pick)
  if (pick === null || !Number.isInteger(pick) || pick >= candidates.length) return null
  cacheMerge(trackId, { pick }, Date.now() - started)
  return pick >= 0 ? pick : null
}

/**
 * Ask for the constant shift that puts the lyric lines onto the captions.
 *
 * Used only when the deterministic fit refuses: a rough answer from the model
 * beats lyrics that start seconds early.
 */
export async function alignOffset(
  trackId: string,
  lines: LyricLine[],
  cues: { t: number; text: string }[]
): Promise<number | null> {
  if (!readSettings().enabled || lines.length < 2 || cues.length < 2) return null
  const cached = freshCache(trackId)
  if (cached && typeof cached.offsetSec === 'number') return cached.offsetSec

  const started = Date.now()
  const answer = await askJson(alignPrompt(lines, cues), 80)
  if (!answer) return null
  const offset = readNumber(answer.offsetSec)
  if (offset === null || Math.abs(offset) > 120) return null
  cacheMerge(trackId, { offsetSec: offset }, Date.now() - started)
  return offset
}

/** A write only counts as an answer once it has a plausible number of lines. */
const MIN_WRITTEN_LINES = 3
/**
 * Writing a whole song is a long generation — the 12s default would cut it off.
 * Measured: a 46-line song took 13.6 s, but a slow server day blew past 40 s for
 * a 25-line one, so this is generous. It only ever costs a wait the *first* time
 * a song is opened, and a timeout falls back to the normal lyrics.
 */
const WRITE_TIMEOUT_MS = 60_000
const WRITE_MAX_TOKENS = 1_400
/**
 * Temperature for writing. Matching uses 0 (deterministic), but lyrics at 0
 * fall into repetition loops — the model emits one chorus line forever and the
 * JSON never completes. 0.7 wanders enough to move through the song, and two
 * deterministic guards (repetition + echo) still verify what comes back.
 */
const WRITE_TEMPERATURE = 0.7

/**
 * True when the "lyrics" are really just what it was given — the title, the
 * artist, or cover-song filler like "Here are the lyrics:" — rather than a
 * song. Such answers are discarded so the real matched lyrics are shown.
 */
function isJunkEcho(lines: LyricLine[], title: string, artist: string): boolean {
  if (lines.length === 0) return false
  const names = [title, artist].map((s) => s.trim().toLowerCase()).filter((s) => s.length > 1)
  if (names.length === 0) return false
  let echoed = 0
  for (const line of lines) {
    const text = line.text.trim().toLowerCase()
    if (/lyrics?[:：]?\s*$/.test(text)) continue
    if (names.some((name) => text.includes(name) || name.includes(text))) echoed += 1
  }
  return echoed / lines.length >= 0.5
}

/**
 * Ask the model to write the lyrics of a song — the AI writing mode.
 *
 * Only the title, artist and length leave the machine: never a path, never
 * audio. The result is stored as its own record, separate from matched lyrics,
 * so turning the mode off shows the real match again exactly as it was.
 *
 * A refusal (`{"unknown": true}`) is stored as an empty entry — an array is
 * always truthy, so this records "the model has already said it does not know
 * this song" instead of re-asking on every open. A network failure stores
 * nothing, so it is retried next time. "Write again" clears the entry.
 */
export async function writeLyrics(
  trackId: string,
  input: { fileName: string; title: string; artist: string; durationSec: number }
): Promise<LyricLine[] | null> {
  if (!readSettings().enabled) return null
  const cached = db.getAiLyrics(trackId)
  if (cached) return cached.lines.length > 0 ? cached.lines : null

  // Identify first: a messy tag ("Sonne remix by street Music [TIKTOK
  // VERSION]") is gibberish for lyric writing too, while the model writes fine
  // from a clean "Song — Artist". Only identity is kept from this step; the
  // name the user could echo back is never written.
  const fileName = input.fileName || input.title
  let title = input.title
  let artist = input.artist
  const identity = await identifySong(trackId, {
    fileName,
    title,
    artist,
    durationSec: input.durationSec
  })
  if (identity?.title) {
    title = identity.title
    artist = identity.artist || artist
  }

  const started = Date.now()
  const answer = await askJson(
    writeLyricsPrompt({ title, artist }),
    WRITE_MAX_TOKENS,
    WRITE_TIMEOUT_MS,
    WRITE_TEMPERATURE
  )
  if (!answer) return null
  const refused = answer.unknown === true || readText(answer.unknown) === 'true'
  const lines = refused ? [] : readLyricLines(answer.lines)
  if (lines === null) return null // unusable: store nothing, allow a retry
  if (lines.length > 0 && isRepeatedWrite(lines.map((line) => line.text))) return null
  if (lines.length > 0 && isJunkEcho(lines, title, artist)) return null

  db.setAiLyrics(trackId, { synced: false, lines, source: 'ai', fetchedAt: Date.now() })
  console.log(
    lines.length > 0
      ? `[ai] wrote ${lines.length} lines for "${title}" in ${Date.now() - started}ms`
      : `[ai] declined "${title}" — not known with confidence`
  )
  return lines.length > 0 ? lines : null
}

/**
 * `{"lines": ["a", "b"]}` → validated lines, or `null` when unusable so the
 * caller can retry rather than cache a broken answer. Strings are the expected
 * shape; objects are tolerated because small models drift.
 */
function readLyricLines(value: unknown): LyricLine[] | null {
  if (!Array.isArray(value)) return null
  const lines: LyricLine[] = []
  for (const raw of value) {
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (text) lines.push({ t: 0, text })
      continue
    }
    if (raw && typeof raw === 'object') {
      const item = raw as { text?: unknown; t?: unknown }
      const text = typeof item.text === 'string' ? item.text.trim() : ''
      const at = typeof item.t === 'number' ? item.t : 0
      if (text) lines.push({ t: at, text })
    }
  }
  return lines.length >= MIN_WRITTEN_LINES ? lines : null
}

/** Settings "Test" button: one tiny round trip, timing included. */
export async function testConnection(): Promise<{ ok: boolean; ms: number; model: string; answer: string; error?: string }> {
  const { enabled, model } = readSettings()
  if (!enabled) return { ok: false, ms: 0, model, answer: '', error: 'No API key configured' }
  const started = Date.now()
  const answer = await askJson('Answer with JSON only: {"ok": true, "hello": "<your model name>"}', 120)
  const ms = Date.now() - started
  if (!answer) return { ok: false, ms, model, answer: '', error: lastError ?? 'No answer' }
  return { ok: true, ms, model, answer: JSON.stringify(answer) }
}
