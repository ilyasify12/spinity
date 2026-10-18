/**
 * Types shared between the Electron main process and the renderer.
 * Kept dependency-free so both tsconfig projects can include it.
 */

import type { LyricSync } from './lyrics'

export type TrackSource = 'youtube' | 'local' | 'preview' | 'radio'

/** A candidate track discovered via yt-dlp metadata (not yet on disk). */
export interface SearchResult {
  id: string
  source: TrackSource
  title: string
  artist: string
  durationSec: number
  thumbnail: string
  webUrl: string
}

/** A track that has been downloaded and indexed into a user's library. */
export interface Track extends SearchResult {
  /** Absolute path to the local audio file. */
  filePath: string
  downloadedAt: number
  /** Free-form licence note surfaced in the UI. */
  license?: string
  /**
   * Direct network stream for non-library sources (previews, radio).
   *
   * Library tracks always resolve through `spinity://audio/<id>`; these
   * sources instead carry their own URL — previews use the cache-backed
   * `spinity://stream/?u=…` wrapper, radio dials the station directly.
   */
  streamUrl?: string
}

export interface User {
  id: string
  username: string
  displayName: string
  createdAt: number
  /** Path to the user's avatar image, if they picked one. */
  avatarPath?: string | null
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  /** Container/codec yt-dlp should transcode to. */
  audioFormat: 'm4a' | 'mp3' | 'opus'
  /** yt-dlp -x --audio-quality value. */
  audioQuality: '0' | '2' | '5' | '7'
  /** Max simultaneous downloads. */
  concurrency: number
  /**
   * Stream straight from YouTube when possible and only download when the
   * stream fails (403, expiry, bot check, throttling). When false, everything
   * is downloaded before it plays.
   */
  preferStreaming: boolean
  /** Custom library root; defaults to %APPDATA%/spinity/users. */
  libraryRoot?: string
  /** Start Spinity automatically when Windows starts (login item). */
  launchAtLogin: boolean
  /**
   * Mini-player auto-hide: sink when another app takes focus, pop back
   * briefly on every track change to announce the next song.
   */
  miniAutoHide: boolean
  /** Show "Listening to Spinity" with the current song on Discord. */
  discordPresence: boolean
  /** Master switch for desktop notifications (messages, calls, invites). */
  notificationsEnabled: boolean
  /** Desktop notification when a chat message arrives. */
  notifyMessages: boolean
  /** Desktop notification on incoming voice calls. */
  notifyCalls: boolean
  /** Desktop notification when invited to a listening party. */
  notifyPartyInvites: boolean
  /** UI language. 'ar' switches the whole shell to Arabic + RTL. */
  language: 'en' | 'ar'
  /**
   * Ask a small language model to read messy file names and pick the right
   * recording. Only names, tags and timings are sent — never audio or paths.
   */
  aiLyrics: boolean
  /** NVIDIA API key (stored locally, like the Spinity account token). */
  aiApiKey: string
  /** Model id; the default is chosen for latency, not size. */
  aiModel: string
  /**
   * Which lyrics the panel shows.
   *
   * - `normal` — the usual chain: upload > `.lrc` sidecar > lrclib match.
   * - `ai` — the model writes the lyrics for the song. The normal result is
   *   stored *separately*, so switching back shows it again instantly; AI
   *   writing is never allowed to overwrite a real match or a user upload.
   *
   * Defaults to `normal`, so nothing changes until it is deliberately turned on.
   */
  lyricsMode: 'normal' | 'ai'
  /**
   * Spotify Web API credentials (client-credentials flow) for the free
   * metadata tier: Spotify `/v1/search` results are shown as link-outs to the
   * real recordings. Optional — previews from Deezer/Apple and the Internet
   * Archive work with no account at all. Stored locally, like the AI key.
   */
  spotifyClientId: string
  spotifyClientSecret: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioFormat: 'm4a',
  audioQuality: '0',
  concurrency: 2,
  preferStreaming: true,
  launchAtLogin: false,
  miniAutoHide: true,
  discordPresence: true,
  notificationsEnabled: true,
  notifyMessages: true,
  notifyCalls: true,
  notifyPartyInvites: true,
  language: 'en',
  aiLyrics: true,
  aiApiKey: '',
  aiModel: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  lyricsMode: 'normal',
  spotifyClientId: '',
  spotifyClientSecret: ''
}

/**
 * A direct media URL resolved by yt-dlp, suitable for `<audio src>`.
 *
 * These URLs are signed by YouTube's CDN and expire (typically after several
 * hours), so they must be resolved at play time and never persisted.
 */
export interface StreamInfo {
  url: string
  ext: string
  protocol: string
}

/** Which public catalogue a free-to-play hit came from. */
export type FreeProvider = 'deezer' | 'itunes' | 'spotify' | 'archive'

/**
 * One searchable result from a free/public catalogue.
 *
 * - `deezer` / `itunes` — short preview clips (licensed, no account needed).
 * - `archive` — full-length audio from the Internet Archive (public domain
 *   or Creative Commons; the licence URL is surfaced in the UI).
 * - `spotify` — metadata only, opened in the Spotify app/browser via
 *   link-out. Present only when the user configured Web API credentials.
 */
export interface FreeHit {
  /** `provider:externalId`, e.g. `deezer:3135556`. */
  id: string
  provider: FreeProvider
  title: string
  artist: string
  album: string
  durationSec: number
  /** Remote artwork URL (https). */
  artwork: string
  /** Direct audio URL; absent for link-out-only hits (Spotify). */
  audioUrl?: string
  /** True when the audio is a short preview clip, not the full track. */
  preview?: boolean
  /** Provider page for the recording (attribution / open externally). */
  pageUrl?: string
  /** `open.spotify.com` link for the same recording, when known. */
  spotifyUrl?: string
  /** The same recording also exists on these other providers. */
  alsoOn?: FreeProvider[]
  /** Licence note (Internet Archive items). */
  license?: string
}

/** One always-on radio station (SomaFM-style public streams). */
export interface RadioChannel {
  id: string
  title: string
  genre: string
  description: string
  image: string
  /** Playlist (.pls) URL, resolved to a direct stream at play time. */
  plsUrl: string
}

/**
 * Stream-cache + instant-start telemetry, shown in Settings → Free music.
 * Byte counts cover the on-disk preview/catalogue cache; the latency figures
 * are rolling windows (last ~100 samples) kept in the main process.
 */
export interface FreeStats {
  /** Completed cache entries on disk. */
  entries: number
  bytes: number
  maxBytes: number
  /** Downloads currently being written. */
  inflight: number
  /** Network latency to the first body byte, ms. */
  firstByteLastMs: number | null
  firstByteAvgMs: number | null
  /** Time-to-first-audio measured by the renderer, ms. */
  plays: number
  playLastMs: number | null
  playMinMs: number | null
  playAvgMs: number | null
  /** The same figures restricted to network-backed tracks. */
  netPlays: number
  netAvgMs: number | null
}

export type DownloadStatus = 'queued' | 'downloading' | 'converting' | 'done' | 'error' | 'canceled'

export interface DownloadJob {
  id: string
  /** Owning local account; jobs are per-user. */
  userId: string
  trackId: string
  title: string
  artist: string
  /** The search result this job came from, so completion can build a Track. */
  source: SearchResult
  status: DownloadStatus
  /** 0–100 */
  progress: number
  error?: string
  /** Absolute path to the finished file, set when status becomes 'done'. */
  filePath?: string
  createdAt: number
  updatedAt: number
}

/** Everything the renderer needs for one user session, in a single payload. */
export interface LibrarySnapshot {
  user: User
  tracks: Track[]
  playlists: Playlist[]
  settings: AppSettings
  /** Liked-song ids (Liked Songs virtual playlist). */
  likedIds: string[]
  /**
   * Stream-first metadata for liked/playlist ids missing from `tracks`,
   * so they can play via streaming without a download.
   */
  meta: Record<string, SearchResult>
  /**
   * Folders registered as local music sources for this account. Optional so
   * snapshots from before local folders existed still satisfy the type; the
   * main process fills it from the per-user library data.
   */
  localFolders?: string[]
}

export interface ToolStatus {
  ytdlpPath: string | null
  ytdlpVersion: string | null
  ffmpegPath: string | null
  ffmpegVersion: string | null
  ready: boolean
}

/** ffprobe result for the player bar's codec tag. All rates in Hz/bits. */
export interface AudioInfo {
  codec: string
  sampleRate: number
  bitsPerSample: number
  channels: number
  bitRate: number
}

/** One synced lyric line. */
export interface LyricLine {
  /** Seconds into the track. */
  t: number
  text: string
}

/**
 * Where lyrics came from.
 *
 * - `sidecar`: a `.lrc` sitting next to the local audio file.
 * - `lrclib`: matched automatically against lrclib.net.
 * - `user`: uploaded or pasted by the user (always wins over every other source).
 * - `ai`: written by the model in AI writing mode. Always plain text (never
 *   invents timings) and always labelled in the panel, so it can never be
 *   mistaken for a real match.
 */
export type LyricsSource = 'sidecar' | 'lrclib' | 'user' | 'ai'

/** What a lyrics lookup matched against, so the panel can be transparent. */
export interface LyricsMatch {
  title: string
  artist: string
}

/** Cached lyrics for a track (sidecar .lrc, auto-fetched or user-supplied). */
export interface CachedLyrics {
  synced: boolean
  lines: LyricLine[]
  source: LyricsSource
  fetchedAt: number
  /** The lrclib record an automatic match came from (absent for local lyrics). */
  matched?: LyricsMatch | null
  /**
   * Length of the recording the lyrics were timed against. Local files are
   * often a sped-up, slowed or re-cut edit of it, and the ratio between the two
   * lengths is what the automatic timing fit is built from.
   */
  matchedDurationSec?: number
  /** True when a language model helped identify or choose this match. */
  ai?: boolean
}

/** What the lyrics panel renders for one track. */
export interface LyricsResult {
  synced: boolean
  lines: LyricLine[]
  source: LyricsSource
  /**
   * False when this track has no name worth searching for — a local `1.mp3`,
   * `Track 03.wav` or similar. The panel then offers a manual upload instead
   * of pretending a lookup could work.
   */
  canFetch: boolean
  /**
   * A confident match exists but publishes no lyrics (typical for phonk and
   * other instrumental-heavy libraries). The panel says "instrumental" rather
   * than "nothing found".
   */
  instrumental: boolean
  /** Which lrclib record matched, when the lookup was automatic. */
  matched?: LyricsMatch | null
  /** Timing applied to the lines (speed fit + manual offset). */
  sync: LyricSync
  /** True when a language model helped identify or choose this match. */
  ai?: boolean
}

/** Cached waveform peaks for a track (0–1, fixed count). */
export interface CachedPeaks {
  duration: number
  peaks: number[]
  updatedAt: number
}
export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Status of the LAN web player server that phones connect to. */
export interface PhoneServerStatus {
  running: boolean
  /** http://<lan-ip>:<port>/player — what the phone opens (null with no LAN). */
  url: string | null
  /** The same player on this PC; works with no network at all. */
  localUrl: string
  port: number
  error: string | null
  /** Last lines of server output, for diagnosing a failed start. */
  log: string[]
}
