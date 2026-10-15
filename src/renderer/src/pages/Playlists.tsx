import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../store/app'
import { usePlayer } from '../player/engine'
import { useUi, type PlaylistSelection } from '../store/ui'
import { IconFolder, IconPause, IconPlay, IconShuffle, IconTrash } from '../components/Icons'
import { TrackArtwork } from '../components/TrackArtwork'
import { openContextMenu, playlistSubmenu, type MenuItem } from '../components/ContextMenu'
import { formatTime } from '../lib/format'
import type { Track } from '@shared/types'

/** "Album" column: parent folder for local files, YouTube for downloads. */
function albumFor(track: Track): string {
  if (track.source === 'local' && track.filePath) {
    const parts = track.filePath.split(/[\\/]/).filter(Boolean)
    if (parts.length >= 2) return parts[parts.length - 2]
    return t('lib.localFiles', 'Local Files')
  }
  return 'YouTube'
}

/** Stable hue per playlist id for the hero gradient. */
function heroGradient(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  if (id === 'liked') return 'linear-gradient(180deg, #4b3ec4 0%, #191442 100%)'
  if (id === 'local') return 'linear-gradient(180deg, #5b21b6 0%, #1e1b4b 100%)'
  return `linear-gradient(180deg, hsl(${h}, 65%, 42%) 0%, hsl(${h}, 60%, 16%) 100%)`
}

interface Detail {
  key: string
  title: string
  sub: string
  tracks: Track[]
  art?: string
  userPlaylistId: string | null
  emptyHint: string
}

/** Playlist detail: Spotify hero + table. The rail owns the list (and the
 * + Create pill), so this page is detail-only. */
export function PlaylistsPage(): React.JSX.Element {
  const tracks = useApp((s) => s.tracks)
  const playlists = useApp((s) => s.playlists)
  const likedIds = useApp((s) => s.likedIds)
  const toggleLike = useApp((s) => s.toggleLike)
  const deletePlaylist = useApp((s) => s.deletePlaylist)
  const addToPlaylist = useApp((s) => s.addToPlaylist)
  const renamePlaylist = useApp((s) => s.renamePlaylist)
  const removeFromPlaylist = useApp((s) => s.removeFromPlaylist)
  const removeTrack = useApp((s) => s.removeTrack)
  const notify = useApp((s) => s.notify)
  const user = useApp((s) => s.user)

  const selectedPlaylist = useUi((s) => s.selectedPlaylist)
  const openPlaylist = useUi((s) => s.openPlaylist)

  const playQueue = usePlayer((s) => s.playQueue)
  const stop = usePlayer((s) => s.stop)
  const playing = usePlayer((s) => s.playing)
  const shuffle = usePlayer((s) => s.shuffle)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const currentId = usePlayer((s) => (s.index >= 0 ? s.queue[s.index]?.id : undefined))

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const likedSet = useMemo(() => new Set(likedIds), [likedIds])
  const meta = useApp((s) => s.meta)
  const playFromSearch = useApp((s) => s.playFromSearch)

  /**
   * Stream-first resolution: a library track when owned, otherwise a
   * lightweight placeholder built from cached search metadata (plays via
   * streaming, downloads only if the user explicitly saves it).
   */
  const resolveTracks = useMemo(() => {
    return (ids: string[]): Track[] =>
      ids
        .map((id) => {
          const owned = byId.get(id)
          if (owned) return owned
          const m = meta[id]
          if (!m) return null
          const placeholder: Track = {
            ...m,
            filePath: '',
            downloadedAt: 0
          }
          return placeholder
        })
        .filter((t): t is Track => t !== null)
  }, [byId, meta])

  const likedTracks = useMemo(() => resolveTracks(likedIds), [resolveTracks, likedIds])
  const localTracks = useMemo(() => tracks.filter((t) => t.source === 'local'), [tracks])

  const sel: PlaylistSelection = selectedPlaylist ?? 'liked'
  const userPl = typeof sel === 'string' && sel !== 'liked' && sel !== 'local' && sel !== 'all'
    ? playlists.find((p) => p.id === sel) ?? null
    : null

  const detail: Detail = useMemo(() => {
    if (sel === 'liked') {
      return {
        key: 'liked', title: t('lib.likedSongs', 'Liked Songs'),
        sub: `${likedTracks.length} ${t(likedTracks.length === 1 ? 'pl.likedOne' : 'pl.likedMany', likedTracks.length === 1 ? 'liked song' : 'liked songs')}`,
        tracks: likedTracks, userPlaylistId: null,
        emptyHint: t('pl.likedEmpty', 'Songs you like will live here. Tap the heart on any track.')
      }
    }
    if (sel === 'local') {
      return {
        key: 'local', title: t('lib.localFiles', 'Local Files'), sub: t('pl.localSub', 'Files from your computer'),
        tracks: localTracks, userPlaylistId: null,
        emptyHint: t('pl.localEmpty', 'Nothing indexed yet. Add folders in Settings → Local music folders.')
      }
    }
    if (sel === 'all' || !userPl) {
      return {
        key: 'all', title: t('lib.allSongs', 'All Songs'), sub: t('pl.allSub', 'Everything downloaded or indexed'),
        tracks, userPlaylistId: null,
        emptyHint: t('pl.allEmpty', 'Your library is empty. Save tracks from Search.')
      }
    }
    const list = resolveTracks(userPl.trackIds)
    const owner = user?.displayName ?? t('common.you', 'you')
    return {
      key: userPl.id, title: userPl.name,
      sub: `${t('pl.byPrefix', 'By ')}${owner} • ${list.length} ${t(list.length === 1 ? 'pl.songOne' : 'pl.songMany', list.length === 1 ? 'song' : 'songs')}`,
      tracks: list, art: list.map((t) => t.thumbnail).find(Boolean),
      userPlaylistId: userPl.id,
      emptyHint: t('pl.userEmpty', 'This playlist is empty. Add tracks from Search (＋ playlist) or All Songs.')
    }
  }, [sel, userPl, likedTracks, localTracks, tracks, byId, resolveTracks, user?.displayName])

  const totalSec = useMemo(() => detail.tracks.reduce((s, t) => s + (t.durationSec || 0), 0), [detail.tracks])
  const isThisPlaying = Boolean(playing && currentId && detail.tracks.some((t) => t.id === currentId))

  /** Stream-first playback: owned files queue normally, placeholders stream. */
  function playDetailAt(index: number): void {
    const t = detail.tracks[index]
    if (!t) return
    const isActive = currentId === t.id && playing
    if (isActive) {
      stop()
      return
    }
    if (!t.filePath) {
      void playFromSearch(t)
      return
    }
    // Queue the owned entries from here so next/previous walk the list.
    const owned = detail.tracks.filter((x) => x.filePath)
    playQueue(owned, Math.max(0, owned.findIndex((x) => x.id === t.id)))
  }

  function playAll(shuffleFirst: boolean): void {
    if (detail.tracks.length === 0) return
    if (isThisPlaying && !shuffleFirst) {
      stop()
      return
    }
    if (shuffleFirst && !shuffle) toggleShuffle()
    const firstStreamed = detail.tracks.find((t) => !t.filePath)
    if (firstStreamed && !detail.tracks[0].filePath) {
      // List starts with a stream-first entry: stream it, the rest follows on demand.
      void playFromSearch(firstStreamed)
      return
    }
    playQueue(detail.tracks.filter((t) => t.filePath), 0)
  }

  // Inline rename for user-made playlists (virtual lists can't be renamed).
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Set when a playlist is created via the rail: enter naming mode as soon
  // as the new detail lands instead of leaving the auto-generated name.
  const armRename = useRef(false)

  useEffect(() => {
    const onArm = (): void => {
      armRename.current = true
    }
    window.addEventListener('spinity:rename-playlist', onArm)
    return () => window.removeEventListener('spinity:rename-playlist', onArm)
  }, [])

  useEffect(() => {
    if (armRename.current && detail.userPlaylistId) {
      armRename.current = false
      setNameDraft(detail.title)
      setEditingName(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.userPlaylistId])

  function startRename(): void {
    setNameDraft(detail.title)
    setEditingName(true)
  }

  function commitRename(): void {
    const id = detail.userPlaylistId
    setEditingName(false)
    if (id && nameDraft.trim() && nameDraft.trim() !== detail.title) {
      void renamePlaylist(id, nameDraft)
    }
  }

  // Resolved up front: the track table below maps with a row param `t` that
  // shadows the i18n `t`.
  const lbl = {
    play: t('ctx.play', 'Play'),
    playStream: t('pl.playStream', 'Play (stream)'),
    stop: t('ctx.stop', 'Stop'),
    like: t('ctx.like', 'Like'),
    unlike: t('ctx.unlike', 'Unlike'),
    copyTitle: t('ctx.copyTitle', 'Copy title'),
    copied: t('action.copied', 'Copied'),
    shufflePlay: t('ctx.shufflePlay', 'Shuffle play'),
    deletePlaylist: t('ctx.deletePlaylist', 'Delete playlist'),
    renamePlaylist: t('pl.renamePlaylist', 'Rename playlist'),
    playlistNameAria: t('pl.nameAria', 'Playlist name'),
    removeHere: t('pl.removeHere', 'Remove from this playlist'),
    removeFromLibrary: t('ui.removeFromLibrary', 'Remove from library'),
    deleteFromLibrary: t('ui.deleteFromLibrary', 'Delete from library and disk'),
    removeFromPlaylist: t('pl.removeFromPlaylist', 'Remove from playlist'),
    removeFromLibraryKept: t('ui.removeFromLibraryKept', 'Remove from library (file on disk is kept)'),
    remove: t('ui.remove', 'Remove'),
    fromPlaylist: t('pl.fromPlaylist', 'from playlist'),
    streamChipTitle: t('pl.streamChipTitle', 'Not downloaded — plays via streaming'),
    stream: t('pl.stream', 'stream'),
    couldNotOpenFolder: t('ui.couldNotOpenFolder', 'Could not open folder')
  }

  return (
    <div className="pl-detail">
        <div className="pl-hero" style={{ background: heroGradient(detail.key) }}>
          <div className="pl-hero-art">
            {detail.key === 'liked' ? (
              <span className="pl-hero-heart">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0017.5 4c-1.8 0-3.4 1-4.2 2.4h-2.6C9.9 5 8.3 4 6.5 4A4.5 4.5 0 002 8.5c0 2.3 1.5 4 3 5.5l7 7z" /></svg>
              </span>
            ) : detail.key === 'local' ? (
              <span className="pl-hero-folder">
                <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" /></svg>
              </span>
            ) : (
              <TrackArtwork src={detail.art ?? ''} className="fill" />
            )}
          </div>
          <div className="pl-hero-meta">
            <div className="pl-hero-type">{t('lib.playlist', 'Playlist')}</div>
            {detail.userPlaylistId && editingName ? (
              <input
                className="pl-hero-title-input"
                value={nameDraft}
                autoFocus
                maxLength={80}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') setEditingName(false)
                }}
                aria-label={lbl.playlistNameAria}
              />
            ) : (
              <h1 className="pl-hero-title">
                {detail.title}
                {detail.userPlaylistId && (
                  <button
                    className="pl-rename-btn"
                    title={lbl.renamePlaylist}
                    aria-label={lbl.renamePlaylist}
                    onClick={startRename}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
                  </button>
                )}
              </h1>
            )}
            <div className="pl-hero-sub">
              {detail.sub}
              {detail.tracks.length > 0 && totalSec > 0 && ` · ${formatTime(totalSec)} ${t('pl.total', 'total')}`}
            </div>
          </div>
        </div>

        <div className="pl-actions">
          <button
            className={`pl-play${detail.tracks.length === 0 ? ' disabled' : ''}`}
            onClick={() => playAll(false)}
            disabled={detail.tracks.length === 0}
            title={isThisPlaying ? lbl.stop : lbl.play}
            aria-label={isThisPlaying ? lbl.stop : lbl.play}
          >
            {isThisPlaying ? <IconPause size={22} /> : <IconPlay size={22} />}
          </button>
          <button
            className={`ctrl${shuffle ? ' on' : ''}`}
            onClick={() => playAll(true)}
            disabled={detail.tracks.length === 0}
            title={lbl.shufflePlay}
            aria-label={lbl.shufflePlay}
          >
            <IconShuffle />
          </button>
          {detail.userPlaylistId && (
            <button
              className="btn btn-danger btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                void deletePlaylist(detail.userPlaylistId as string)
                openPlaylist('liked')
              }}
            >
              <IconTrash size={13} /> {lbl.deletePlaylist}
            </button>
          )}
        </div>

        {detail.tracks.length === 0 ? (
          <div className="empty">{detail.emptyHint}</div>
        ) : (
          <div className="pl-table">
            <div className="pl-table-head">
              <span>#</span>
              <span>{t('pl.colTitle', 'Title')}</span>
              <span>{t('pl.colAlbum', 'Album')}</span>
              <span style={{ textAlign: 'right' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              </span>
              <span />
              <span />
            </div>
            {detail.tracks.map((t, i) => {
              const isActive = currentId === t.id && playing
              const liked = likedSet.has(t.id)
              const streamed = !t.filePath
              const handlePlay = (): void => playDetailAt(i)
              const menu = (e: React.MouseEvent): void => {
                const others = playlists.filter((p) => p.id !== detail.userPlaylistId)
                const items: MenuItem[] = [
                  { label: isActive ? lbl.stop : streamed ? lbl.playStream : lbl.play, onSelect: handlePlay },
                  ...(others.length > 0
                    ? [playlistSubmenu(others, (pid) => void addToPlaylist(pid, t.id, t))]
                    : []),
                  { label: liked ? lbl.unlike : lbl.like, onSelect: () => void toggleLike(t.id, t) },
                  { label: lbl.copyTitle, onSelect: () => void navigator.clipboard.writeText(`${t.title} — ${t.artist}`).then(() => notify(lbl.copied)).catch(() => {}) },
                  detail.userPlaylistId
                    ? { label: lbl.removeHere, danger: true, onSelect: () => void removeFromPlaylist(detail.userPlaylistId as string, t.id) }
                    : { label: t.source === 'local' ? lbl.removeFromLibrary : lbl.deleteFromLibrary, danger: true, onSelect: () => void removeTrack(t.id) }
                ]
                openContextMenu(e, items)
              }
              return (
                <div
                  key={t.id}
                  className={`pl-table-row${isActive ? ' playing' : ''}`}
                  onDoubleClick={handlePlay}
                  onContextMenu={menu}
                >
                  <span className="pl-num">
                    <span className="num">{i + 1}</span>
                    <button
                      className="mini-play"
                      aria-label={isActive ? `${lbl.stop} ${t.title}` : `${lbl.play} ${t.title}`}
                      onClick={handlePlay}
                    >
                      {isActive ? <IconPause size={13} /> : <IconPlay size={13} />}
                    </button>
                  </span>
                  <span className="pl-title-cell">
                    <TrackArtwork src={t.thumbnail ?? ''} className="pl-thumb" />
                    <span style={{ minWidth: 0 }}>
                      <span className="pl-track-title" title={t.title}>
                        {t.title}
                        {streamed && <span className="chip" title={lbl.streamChipTitle} style={{ marginLeft: 6 }}>{lbl.stream}</span>}
                      </span>
                      <span className="pl-track-artist" title={t.artist}>{t.artist}</span>
                    </span>
                  </span>
                  <span className="pl-album" title={albumFor(t)}>{albumFor(t)}</span>
                  <span className="pl-dur">{t.durationSec > 0 ? formatTime(t.durationSec) : '—'}</span>
                  <span>
                    <button
                      className={`like-btn${liked ? ' liked' : ''}`}
                      title={liked ? lbl.unlike : lbl.like}
                      aria-label={liked ? `${lbl.unlike} ${t.title}` : `${lbl.like} ${t.title}`}
                      onClick={() => void toggleLike(t.id, t)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0017.5 4c-1.8 0-3.4 1-4.2 2.4h-2.6C9.9 5 8.3 4 6.5 4A4.5 4.5 0 002 8.5c0 2.3 1.5 4 3 5.5l7 7z" />
                      </svg>
                    </button>
                  </span>
                  <span>
                    {detail.userPlaylistId ? (
                      <button
                        className="pl-x"
                        title={lbl.removeFromPlaylist}
                        aria-label={`${lbl.remove} ${t.title} ${lbl.fromPlaylist}`}
                        onClick={() => void removeFromPlaylist(detail.userPlaylistId as string, t.id)}
                      >
                        ✕
                      </button>
                    ) : (
                      <button
                        className="pl-x"
                        title={t.source === 'local' ? lbl.removeFromLibraryKept : lbl.deleteFromLibrary}
                        aria-label={`${lbl.remove} ${t.title}`}
                        onClick={() => void removeTrack(t.id)}
                      >
                        <IconTrash size={13} />
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {detail.key === 'local' && (
          <p className="hint" style={{ marginTop: 16 }}>
            {t('pl.localManage', 'Manage folders in Settings → Local music folders. Removing a folder here never deletes files on disk.')}{' '}
            <button
              className="btn btn-ghost btn-sm"
              title={t('pl.showFile', 'Show file in Explorer')}
              style={{ verticalAlign: 'middle' }}
              onClick={() => {
                const first = detail.tracks[0]
                if (first) void window.spinity.library.revealFile(first.id).catch((err: unknown) => notify(err instanceof Error ? err.message : lbl.couldNotOpenFolder, 'error'))
              }}
            >
              <IconFolder size={13} /> {t('pl.openFolder', 'Open folder')}
            </button>
          </p>
        )}
      </div>
  )
}
