import { useState, type FormEvent } from 'react'
import { useApp } from '../store/app'
import { TrackRow } from '../components/TrackRow'
import { IconDownload, IconExternal, IconPlay } from '../components/Icons'

/**
 * YouTube search. Only metadata is fetched here (`--flat-playlist`), so this
 * is fast and downloads nothing until the user explicitly asks for a track.
 */
export function SearchPage(): React.JSX.Element {
  const results = useApp((s) => s.results)
  const searching = useApp((s) => s.searching)
  const search = useApp((s) => s.search)
  const download = useApp((s) => s.download)
  const playFromSearch = useApp((s) => s.playFromSearch)
  const tracks = useApp((s) => s.tracks)
  const jobs = useApp((s) => s.jobs)

  const [query, setQuery] = useState('')

  const ownedIds = new Set(tracks.map((t) => t.id))
  const pendingIds = new Set(
    jobs
      .filter(
        (j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting'
      )
      .map((j) => j.trackId)
  )

  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    void search(query)
  }

  return (
    <>
      <h1 className="page-title">Search</h1>
      <p className="page-sub">Find music on YouTube, then save it to your local library.</p>

      <form className="searchbar" onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search YouTube — artists, songs, albums, mixes…"
          autoFocus
          aria-label="Search query"
        />
        <button className="btn" type="submit" disabled={searching || query.trim() === ''}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {searching && <div className="empty">Searching YouTube…</div>}

      {!searching && results.length === 0 && (
        <div className="empty">
          {query.trim() === ''
            ? 'Search for something to get started.'
            : 'No results. Try different keywords.'}
        </div>
      )}

      {!searching && results.length > 0 && (
        <div className="track-list">
          {results.map((r, i) => {
            const owned = ownedIds.has(r.id)
            const pending = pendingIds.has(r.id)
            return (
              <TrackRow
                key={r.id}
                index={i}
                title={r.title}
                artist={r.artist}
                thumbnail={r.thumbnail}
                durationSec={r.durationSec}
                onPlay={() => void playFromSearch(r)}
                actions={
                  <>
                    <button
                      className="btn btn-sm"
                      onClick={() => void playFromSearch(r)}
                      title={
                        owned
                          ? 'Play from your library (offline)'
                          : 'Stream now — downloads automatically if streaming fails'
                      }
                    >
                      <IconPlay size={13} /> Play
                    </button>
                    {owned ? (
                      <span className="chip chip-ok">in library</span>
                    ) : pending ? (
                      <span className="chip">downloading…</span>
                    ) : (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void download(r)}
                        title="Download to library"
                      >
                        <IconDownload size={13} /> Save
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => void window.open(r.webUrl, '_blank')}
                      title="Open on YouTube"
                    >
                      <IconExternal size={13} />
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
