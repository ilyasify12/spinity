import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/app'
import { useCurrentTrack, usePlayer } from '../player/engine'
import { TrackRow } from '../components/TrackRow'
import { openContextMenu, playlistSubmenu, type MenuItem } from '../components/ContextMenu'
import { IconFolder, IconPause, IconPlay, IconTrash } from '../components/Icons'
import { formatTime } from '../lib/format'
import { createLibraryIndex, searchIndexed } from '../lib/search'

/** The downloaded, locally-stored collection. Plays without any network. */
export function LibraryPage(): React.JSX.Element {
  const tracks = useApp((s) => s.tracks)
  const playlists = useApp((s) => s.playlists)
  const removeTrack = useApp((s) => s.removeTrack)
  const addToPlaylist = useApp((s) => s.addToPlaylist)
  const notify = useApp((s) => s.notify)

  const playQueue = usePlayer((s) => s.playQueue)
  const stop = usePlayer((s) => s.stop)
  const playing = usePlayer((s) => s.playing)
  const current = useCurrentTrack()

  // Hooks must run before the empty-state return below.
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(t)
  }, [query])
  const index = useMemo(() => createLibraryIndex(tracks), [tracks])
  const list = useMemo(() => searchIndexed(index, debounced), [index, debounced])

  const totalSeconds = useMemo(() => tracks.reduce((sum, t) => sum + t.durationSec, 0), [tracks])

  const isPlayingAll = Boolean(playing && current && list.some((t) => t.id === current.id))
  const handlePlayAll = useCallback(() => {
    if (isPlayingAll) stop()
    else playQueue(list, 0)
  }, [isPlayingAll, stop, playQueue, list])

  if (tracks.length === 0) {
    return (
      <>
        <h1 className="page-title">Library</h1>
        <p className="page-sub">Everything you have downloaded or indexed lives here.</p>
        <div className="empty">
          Your library is empty.
          <br />
          Head to <strong>Search</strong> and save a few tracks, or open{' '}
          <strong>Settings → Local music folders</strong> to index music that is
          already on this computer.
        </div>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">Library</h1>
      <p className="page-sub">
        {query
          ? `${list.length} of ${tracks.length} tracks match "${query}"`
          : `${tracks.length} track${tracks.length === 1 ? '' : 's'} · ${formatTime(totalSeconds)} total · stored locally`}
      </p>

      <div className="searchbar" style={{ maxWidth: 560 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter your library — fuzzy matching handles typos"
          aria-label="Filter library"
        />
        {query && (
          <button className="btn btn-ghost" onClick={() => setQuery('')}>
            Clear
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <button className={`btn${isPlayingAll ? ' btn-danger' : ''}`} onClick={handlePlayAll} disabled={list.length === 0}>
          {isPlayingAll ? <IconPause size={14} /> : <IconPlay size={14} />} {isPlayingAll ? (query ? `Stop results (${list.length})` : 'Stop all') : query ? `Play results (${list.length})` : 'Play all'}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">No tracks match “{query}”.</div>
      ) : (
        <div className="track-list">
          {list.map((t, i) => {
            const isActive = current?.id === t.id && playing
            const handlePlay = (): void => {
              if (isActive) stop()
              else playQueue(list, i)
            }
            const menu = (e: React.MouseEvent): void => {
              const items: MenuItem[] = [
                { label: isActive ? 'Stop' : 'Play', onSelect: handlePlay },
                playlistSubmenu(playlists, (pid) => void addToPlaylist(pid, t.id)),
                { label: 'Copy title', onSelect: () => void navigator.clipboard.writeText(`${t.title} — ${t.artist}`).then(() => notify('Copied')).catch(() => {}) },
                { label: 'Show in Explorer', onSelect: () => void window.spinity.library.revealFile(t.id).catch((err: unknown) => notify(err instanceof Error ? err.message : 'Could not open folder', 'error')) },
                { label: t.source === 'local' ? 'Remove from library' : 'Delete from library and disk', danger: true, onSelect: () => void removeTrack(t.id) }
              ]
              openContextMenu(e, items)
            }
            return (
            <TrackRow
              key={t.id}
              index={i}
              title={t.title}
              artist={t.artist}
              thumbnail={t.thumbnail}
              durationSec={t.durationSec}
              playing={isActive}
              onPlay={handlePlay}
              onContextMenu={menu}
            actions={
              <>
                {playlists.length > 0 && (
                  <select
                    className="btn btn-ghost btn-sm"
                    value=""
                    title="Add to playlist"
                    onChange={(e) => {
                      if (e.target.value) void addToPlaylist(e.target.value, t.id)
                    }}
                  >
                    <option value="">+ playlist</option>
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  title="Show file in Explorer"
                  onClick={() => {
                    void window.spinity.library
                      .revealFile(t.id)
                      .catch((err: unknown) =>
                        notify(err instanceof Error ? err.message : 'Could not open folder', 'error')
                      )
                  }}
                >
                  <IconFolder size={13} />
                </button>
                <button
                  className={`btn btn-sm ${t.source === 'local' ? 'btn-ghost' : 'btn-danger'}`}
                  title={
                    t.source === 'local'
                      ? 'Remove from library — the file on disk is never deleted'
                      : 'Delete from library and disk'
                  }
                  onClick={() => {
                    void removeTrack(t.id)
                  }}
                >
                  <IconTrash size={13} />
                </button>
              </>
            }
          />
            )
          })}
         </div>
      )}
    </>
  )
}
