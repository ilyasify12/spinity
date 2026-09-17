/**
 * Types shared between the Electron main process and the renderer.
 * Kept dependency-free so both tsconfig projects can include it.
 */

export type TrackSource = 'youtube' | 'local'

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
}

export interface User {
  id: string
  username: string
  displayName: string
  createdAt: number
  /** Path to the user's avatar image, if they picked one. */
  avatarPath?: string
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  audioFormat: 'm4a',
  audioQuality: '0',
  concurrency: 2,
  preferStreaming: true
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

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}
