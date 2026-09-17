import { useState } from 'react'
import { useApp } from '../store/app'
import { useCurrentTrack, usePlayer } from '../player/engine'
import { TrackRow } from '../components/TrackRow'
import { IconPlay, IconTrash } from '../components/Icons'
import type { Track } from '@shared/types'

/** Playlists are per local account and reference tracks already downloaded. */
export function PlaylistsPage(): React.JSX.Element {
  const playlists = useApp((s) => s.playlists)
  const tracks = useApp((s) => s.tracks)
  const createPlaylist = useApp((s) => s.createPlaylist)
  const deletePlaylist = useApp((s) => s.deletePlaylist)
  const removeFromPlaylist = useApp((s) => s.removeFromPlaylist)

  const playQueue = usePlayer((s) => s.playQueue)
  const current = useCurrentTrack()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const selected = playlists.find((p) => p.id === selectedId) ?? null

  // Ignore ids that no longer resolve (track deleted) instead of crashing.
  const selectedTracks: Track[] = selected
    ? (selected.trackIds.map((id) => byId.get(id)).filter(Boolean) as Track[])
    : []

  async function onCreate(): Promise<void> {
    const name = newName.trim()
    if (!name) return
    const created = await createPlaylist(name)
    setNewName('')
    if (created) setSelectedId(created.id)
  }

  return (
    <>
      <h1 className="page-title">Playlists</h1>
      <p className="page-sub">Group tracks from your library into your own collections.</p>

      <div className="searchbar" style={{ maxWidth: 520 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onCreate()
          }}
          placeholder="New playlist name…"
          aria-label="New playlist name"
        />
        <button className="btn" onClick={() => void onCreate()} disabled={newName.trim() === ''}>
          Create
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">
          No playlists yet. Create one above, then add tracks from your Library.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 26 }}>
          <div className="list-plain">
            {playlists.map((p) => (
              <button
                key={p.id}
                className={`pl-row${p.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(p.id)}
                style={{
                  textAlign: 'left',
                  background: p.id === selectedId ? 'var(--bg-elev-2)' : undefined
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="track-title" title={p.name}>
                    {p.name}
                  </div>
                  <div className="track-artist">
                    {p.trackIds.length} track{p.trackIds.length === 1 ? '' : 's'}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div>
            {selected ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 16
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: 20 }}>{selected.name}</h2>
                  <button
                    className="btn btn-sm"
                    disabled={selectedTracks.length === 0}
                    onClick={() => playQueue(selectedTracks, 0)}
                  >
                    <IconPlay size={13} /> Play
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      void deletePlaylist(selected.id)
                      setSelectedId(null)
                    }}
                  >
                    <IconTrash size={13} /> Delete playlist
                  </button>
                </div>

                {selectedTracks.length === 0 ? (
                  <div className="empty">
                    This playlist is empty. Add tracks from the Library page.
                  </div>
                ) : (
                  <div className="track-list">
                    {selectedTracks.map((t, i) => (
                      <TrackRow
                        key={t.id}
                        index={i}
                        title={t.title}
                        artist={t.artist}
                        thumbnail={t.thumbnail}
                        durationSec={t.durationSec}
                        playing={current?.id === t.id}
                        onPlay={() => playQueue(selectedTracks, i)}
                        actions={
                          <button
                            className="btn btn-danger btn-sm"
                            title="Remove from playlist"
                            onClick={() => void removeFromPlaylist(selected.id, t.id)}
                          >
                            <IconTrash size={13} />
                          </button>
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="empty">Select a playlist on the left.</div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
