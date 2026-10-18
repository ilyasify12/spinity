import type { FreeHit, FreeProvider, RadioChannel } from '../shared/types'

/**
 * Free music tier — search adapters for legitimately free/playable audio.
 *
 * Design: one uniform `FreeHit` per provider, merged into a single list. Every
 * parser is a pure function (unit-tested against fixtures), every network call
 * takes an injectable fetch, and per-provider failures are swallowed so one
 * flaky API never empties the section.
 *
 * Sources and their playback category:
 *
 *   deezer   — 30s licensed preview clips (mp3, cache-friendly)
 *   itunes   — 30-60s licensed preview clips (m4a, cache-friendly)
 *   archive  — full-length public-domain / CC audio (mp3/ogg, cache-friendly)
 *   spotify  — metadata only → link-out to the real recording (opt-in: needs
 *              Web API client credentials, free to create)
 *
 * No scraping, no extraction: every audioUrl here is an official preview or a
 * file the uploader published for free listening.
 */

type FetchLike = typeof fetch

const DEFAULT_TIMEOUT_MS = 7_000

/** The always-on radio catalogue (channels.json is SomaFM's public API). */
const RADIO_CHANNELS_URL = 'https://somafm.com/channels.json'

// ------------------------------------------------------------------ helpers

/** Plain Spotify search URL — openable by anyone, no API needed. */
export function spotifySearchUrl(query: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(query.trim())}`
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

// ------------------------------------------------------------------- deezer

interface DeezerRow {
  id?: number | string
  title?: string
  duration?: number
  preview?: string
  link?: string
  artist?: { name?: string }
  album?: { title?: string; cover_medium?: string; cover_big?: string; cover?: string }
}

/** Deezer `/search` payload → hits. Rows without a playable preview drop. */
export function parseDeezer(json: unknown): FreeHit[] {
  const rows = Array.isArray((json as { data?: DeezerRow[] })?.data) ? (json as { data: DeezerRow[] }).data : []
  const hits: FreeHit[] = []
  for (const row of rows) {
    const title = String(row.title ?? '').trim()
    if (!title || !isHttpUrl(row.preview)) continue
    hits.push({
      id: `deezer:${row.id ?? title}`,
      provider: 'deezer',
      title,
      artist: String(row.artist?.name ?? '').trim(),
      album: String(row.album?.title ?? '').trim(),
      durationSec: Number(row.duration) || 0,
      artwork: String(row.album?.cover_medium ?? row.album?.cover_big ?? row.album?.cover ?? ''),
      audioUrl: row.preview,
      preview: true,
      pageUrl: isHttpUrl(row.link) ? row.link : undefined
    })
  }
  return hits
}

export async function searchDeezer(f: FetchLike, timeoutMs: number, query: string, limit: number): Promise<FreeHit[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`
  const res = await f(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Deezer search failed (HTTP ${res.status})`)
  return parseDeezer(await res.json())
}

// ------------------------------------------------------------------- itunes

interface ITunesRow {
  trackId?: number | string
  trackName?: string
  artistName?: string
  collectionName?: string
  trackTimeMillis?: number
  previewUrl?: string
  trackViewUrl?: string
  artworkUrl100?: string
}

/** iTunes Search payload → hits. Artwork is upgraded to 600×600. */
export function parseItunes(json: unknown): FreeHit[] {
  const rows = Array.isArray((json as { results?: ITunesRow[] })?.results)
    ? (json as { results: ITunesRow[] }).results
    : []
  const hits: FreeHit[] = []
  for (const row of rows) {
    const title = String(row.trackName ?? '').trim()
    if (!title || !isHttpUrl(row.previewUrl)) continue
    const rawArt = String(row.artworkUrl100 ?? '')
    hits.push({
      id: `itunes:${row.trackId ?? title}`,
      provider: 'itunes',
      title,
      artist: String(row.artistName ?? '').trim(),
      album: String(row.collectionName ?? '').trim(),
      durationSec: Math.round((Number(row.trackTimeMillis) || 0) / 1000),
      artwork: rawArt.replace('100x100bb', '600x600bb'),
      audioUrl: row.previewUrl,
      preview: true,
      pageUrl: isHttpUrl(row.trackViewUrl) ? row.trackViewUrl : undefined
    })
  }
  return hits
}

export async function searchItunes(f: FetchLike, timeoutMs: number, query: string, limit: number): Promise<FreeHit[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`
  const res = await f(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Apple search failed (HTTP ${res.status})`)
  return parseItunes(await res.json())
}

// ------------------------------------------------------------------ archive

export interface ArchiveDoc {
  identifier: string
  title: string
  creator: string
}

interface ArchiveSearchJson {
  response?: { docs?: Array<{ identifier?: string; title?: unknown; creator?: unknown }> }
}

/** Internet Archive advancedsearch payload → candidate items. */
export function parseArchiveSearch(json: unknown): ArchiveDoc[] {
  const docs = (json as ArchiveSearchJson)?.response?.docs
  if (!Array.isArray(docs)) return []
  const out: ArchiveDoc[] = []
  for (const doc of docs) {
    const identifier = String(doc.identifier ?? '').trim()
    if (!identifier) continue
    const creatorRaw = doc.creator
    const creator = Array.isArray(creatorRaw) ? String(creatorRaw[0] ?? '') : String(creatorRaw ?? '')
    out.push({ identifier, title: String(doc.title ?? identifier).trim(), creator: creator.trim() })
  }
  return out
}

interface ArchiveFileRow {
  name?: string
  format?: string
  length?: string
  /** Present and true on login-walled files. */
  private?: boolean | string
}

/**
 * One item's metadata → a playable hit, or null when the item carries no
 * audio we can stream. Prefers an MP3/VBR MP3 file, then any mp3/ogg.
 *
 * Login-walled items (member previews and similar) are dropped: their files
 * answer 401, so offering them would only produce a dead row.
 */
export function parseArchiveItem(doc: ArchiveDoc, meta: unknown): FreeHit | null {
  const m = meta as { files?: ArchiveFileRow[]; metadata?: Record<string, unknown> } | null
  const metaData = m?.metadata ?? {}
  if (metaData['access-restricted-item'] === true || metaData['access-restricted-item'] === 'true') return null
  const files = Array.isArray(m?.files) ? m.files : []
  const names = files.filter(
    (row) => typeof row.name === 'string' && row.private !== true && row.private !== 'true'
  )
  const pick =
    names.find((row) => /\.mp3$/i.test(row.name!) && /mp3|vbr/i.test(String(row.format))) ??
    names.find((row) => /\.mp3$/i.test(row.name!)) ??
    names.find((row) => /\.(ogg|m4a)$/i.test(row.name!))
  if (!pick?.name) return null

  const seconds = Math.round(Number(pick.length) || 0)
  const licenseUrl = typeof metaData.licenseurl === 'string' ? metaData.licenseurl : ''
  const album = [metaData.album, metaData.collection].find((v) => typeof v === 'string' && v.trim()) as
    | string
    | undefined

  // Keep subfolder paths intact but escape each segment.
  const encodedName = pick.name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return {
    id: `archive:${doc.identifier}`,
    provider: 'archive',
    title: doc.title || String(metaData.title ?? doc.identifier),
    artist: doc.creator || String(metaData.creator ?? '').trim() || 'Internet Archive',
    album: String(album ?? '').trim(),
    durationSec: seconds,
    artwork: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`,
    audioUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodedName}`,
    preview: false,
    pageUrl: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
    license: licenseUrl || 'public domain / check the item page'
  }
}

export async function searchArchive(f: FetchLike, timeoutMs: number, query: string, limit: number): Promise<FreeHit[]> {
  const search =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`${query} AND mediatype:(audio)`)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&rows=${limit}&page=1&output=json`
  const res = await f(search, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Internet Archive search failed (HTTP ${res.status})`)
  const docs = parseArchiveSearch(await res.json()).slice(0, limit)

  // Item metadata is a second round trip; failures drop just that item.
  const settled = await Promise.allSettled(
    docs.map(async (doc) => {
      const res2 = await f(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, {
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res2.ok) return null
      return parseArchiveItem(doc, await res2.json())
    })
  )
  return settled.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
}

// ------------------------------------------------------------------ spotify

interface SpotifyToken {
  token: string
  expiresAt: number
  clientId: string
}

let spotifyToken: SpotifyToken | null = null

/** Spotify track items → link-out hits (no audio URL; the app opens them). */
export function parseSpotify(json: unknown): FreeHit[] {
  const items = (json as { tracks?: { items?: Array<Record<string, unknown>> } })?.tracks?.items
  if (!Array.isArray(items)) return []
  const hits: FreeHit[] = []
  for (const item of items) {
    const name = String((item as { name?: string }).name ?? '').trim()
    if (!name) continue
    const artists = (item as { artists?: Array<{ name?: string }> }).artists
    const images = (item as { album?: { images?: Array<{ url?: string }> } }).album?.images
    const external = (item as { external_urls?: { spotify?: string } }).external_urls?.spotify
    hits.push({
      id: `spotify:${String((item as { id?: string }).id ?? name)}`,
      provider: 'spotify',
      title: name,
      artist: String(artists?.[0]?.name ?? '').trim(),
      album: String((item as { album?: { name?: string } }).album?.name ?? '').trim(),
      durationSec: Math.round((Number((item as { duration_ms?: number }).duration_ms) || 0) / 1000),
      artwork: String(images?.[0]?.url ?? ''),
      pageUrl: isHttpUrl(external) ? external : undefined,
      spotifyUrl: isHttpUrl(external) ? external : undefined
    })
  }
  return hits
}

async function spotifyTokenFor(
  f: FetchLike,
  timeoutMs: number,
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (spotifyToken && spotifyToken.clientId === clientId && Date.now() < spotifyToken.expiresAt) {
    return spotifyToken.token
  }
  const res = await f('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`Spotify auth failed (HTTP ${res.status})`)
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) throw new Error('Spotify auth returned no token')
  spotifyToken = {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 - 60_000,
    clientId
  }
  return spotifyToken.token
}

export async function searchSpotify(
  f: FetchLike,
  timeoutMs: number,
  query: string,
  limit: number,
  clientId: string,
  clientSecret: string
): Promise<FreeHit[]> {
  const token = await spotifyTokenFor(f, timeoutMs, clientId, clientSecret)
  const url = `https://api.spotify.com/v1/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Spotify search failed (HTTP ${res.status})`)
  return parseSpotify(await res.json())
}

// ------------------------------------------------------------------- merge

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

// ------------------------------------------------------------------ search

export interface FreeSearchRequest {
  query: string
  limit?: number
  providers?: FreeProvider[]
  spotify?: { clientId: string; clientSecret: string } | null
  fetchImpl?: FetchLike
  timeoutMs?: number
}

/**
 * Search all enabled providers concurrently; one failing provider is dropped
 * silently. Results are merged (cross-provider duplicates collapse).
 */
export async function searchFree(req: FreeSearchRequest): Promise<FreeHit[]> {
  const f = req.fetchImpl ?? fetch
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const limit = Math.min(Math.max(req.limit ?? 14, 1), 30)
  const providers = req.providers ?? ['deezer', 'itunes', 'archive', 'spotify']

  const tasks: Array<Promise<FreeHit[]>> = []
  if (providers.includes('deezer')) tasks.push(searchDeezer(f, timeoutMs, req.query, limit))
  if (providers.includes('itunes')) tasks.push(searchItunes(f, timeoutMs, req.query, limit))
  if (providers.includes('archive')) tasks.push(searchArchive(f, timeoutMs, req.query, Math.min(limit, 6)))
  if (providers.includes('spotify') && req.spotify?.clientId && req.spotify.clientSecret) {
    tasks.push(searchSpotify(f, timeoutMs, req.query, limit, req.spotify.clientId, req.spotify.clientSecret))
  }
  const settled = await Promise.allSettled(tasks)
  const hits = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  return mergeHits(hits).slice(0, limit * 2)
}

// ------------------------------------------------------------------- radio

interface SomaChannel {
  id?: string
  title?: string
  genre?: string
  description?: string
  image?: string
  largeimage?: string
  playlists?: Array<{ url?: string }>
}

/** SomaFM `channels.json` payload → channels with their .pls URLs. */
export function parseRadioChannels(json: unknown): RadioChannel[] {
  // The live endpoint wraps the list as {"channels": […]}; older copies are
  // a bare array — accept both.
  const rows = Array.isArray(json)
    ? (json as SomaChannel[])
    : Array.isArray((json as { channels?: SomaChannel[] })?.channels)
      ? (json as { channels: SomaChannel[] }).channels
      : []
  const out: RadioChannel[] = []
  for (const row of rows) {
    const id = String(row.id ?? '').trim()
    if (!id) continue
    const pls = Array.isArray(row.playlists) ? row.playlists.find((p) => isHttpUrl(p?.url)) : undefined
    if (!pls?.url) continue
    out.push({
      id,
      title: String(row.title ?? id).trim(),
      genre: String(row.genre ?? '').trim(),
      description: String(row.description ?? '').trim(),
      image: String(row.image ?? row.largeimage ?? ''),
      plsUrl: pls.url
    })
  }
  return out
}

/** Parse a .pls playlist body (File1=…). */
export function parsePls(text: string): string | null {
  const match = /^\s*File\d+\s*=\s*(\S+)/im.exec(text)
  return match ? match[1] : null
}

export async function fetchRadioChannels(f: FetchLike, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RadioChannel[]> {
  const res = await f(RADIO_CHANNELS_URL, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Radio catalogue failed (HTTP ${res.status})`)
  return parseRadioChannels(await res.json())
}

/** Resolve a station's .pls to the direct stream URL the element will dial. */
export async function resolveRadioStream(
  f: FetchLike,
  plsUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const parsed = new URL(plsUrl)
  if (!/(^|\.)somafm\.com$/i.test(parsed.hostname)) throw new Error('Station host not allowed')
  const res = await f(plsUrl, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Station playlist failed (HTTP ${res.status})`)
  const direct = parsePls(await res.text())
  if (!direct || !isHttpUrl(direct)) throw new Error('No stream URL in the station playlist')
  return direct
}
