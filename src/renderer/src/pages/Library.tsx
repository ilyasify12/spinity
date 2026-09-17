import { useState } from 'react'
import { useApp } from '../store/app'
import { useCurrentTrack, usePlayer } from '../player/engine'
import { TrackRow } from '../components/TrackRow'
import { IconFolder, IconPlay, IconTrash } from '../components/Icons'
import { formatTime } from '../lib/format'
import { searchLibrary } from '../lib/search'

/** The downloaded, locally-stored collection. Plays without any network. */
export function LibraryPage(): React.JSX.Element {
  const tracks = useApp((s) => s.tracks)
  const playlists = useApp((s) => s.playlists)
  const removeTrack = useApp((s) => s.removeTrack)
  const addToPlaylist = useApp((s) => s.addToPlaylist)
  const notify = useApp((s) => s.notify)

  const playQueue = usePlayer((s) => s.playQueue)
  const current = useCurrentTrack()

  // Hooks must run before the empty-state return below.
  const [query, setQuery] = useState('')
  const list = searchLibrary(tracks, query)

  const totalSeconds = tracks.reduce((sum, t) => sum + t.durationSec, 0)

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
        <button className="btn" onClick={() => playQueue(list, 0)} disabled={list.length === 0}>
          <IconPlay size={14} /> {query ? `Play results (${list.length})` : 'Play all'}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">No tracks match “{query}”.</div>
      ) : (
        <div className="track-list">
          {list.map((t, i) => (
            <TrackRow
              key={t.id}
              index={i}
              title={t.title}
              artist={t.artist}
              thumbnail={t.thumbnail}
              durationSec={t.durationSec}
              playing={current?.id === t.id}
              onPlay={() => playQueue(list, i)}
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
          ))}
        </div>
      )}
    </>
  )
}
