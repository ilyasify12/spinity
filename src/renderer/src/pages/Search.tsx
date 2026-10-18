import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useApp } from '../store/app'
import { useCurrentTrack, usePlayer } from '../player/engine'
import { prewarmFree, prewarmRadio, prewarmStream } from '../player/prewarm'
import { TrackRow } from '../components/TrackRow'
import { openContextMenu, playlistSubmenu, type MenuItem } from '../components/ContextMenu'
import { IconDownload, IconExternal, IconPause, IconPlay } from '../components/Icons'
import { createLibraryIndex, searchIndexed } from '../lib/search'
import { t } from '../lib/i18n'
import type { FreeHit, FreeProvider, SearchResult, Track } from '@shared/types'

/**
 * Default fill for the page: a silent YouTube search issued on mount so the
 * page is never blank before the first query (local quick picks show
 * immediately regardless).
 */
function popularQuery(): string {
  return useApp.getState().settings.language === 'ar' ? 'أغاني شائعة' : 'popular music'
}

/** Human label for a free-catalogue provider chip. */
function providerLabel(provider: FreeProvider): string {
  switch (provider) {
    case 'deezer':
      return 'Deezer'
    case 'itunes':
      return 'Apple'
    case 'archive':
      return 'Internet Archive'
    default:
      return 'Spotify'
  }
}

/**
 * Search page: instant local matches while typing + debounced background
 * YouTube search (silent — errors/emptiness only toast on explicit Enter).
 *
 * Three inputs share one view:
 *   - `q`            live keystrokes (local state, pushed to the store debounced)
 *   - `searchQuery`  committed query (TopBar submissions land here and refill
 *                    the input when the user navigates to this page)
 *   - `resultsQuery` which query `results` belongs to, so old results never
 *                    flash under a newer query
 */
export function SearchPage(): React.JSX.Element {
  const results = useApp((s) => s.results)
  const resultsQuery = useApp((s) => s.resultsQuery)
  const searching = useApp((s) => s.searching)
  const query = useApp((s) => s.searchQuery)
  const setSearchQuery = useApp((s) => s.setSearchQuery)
  const search = useApp((s) => s.search)
  const startingId = useApp((s) => s.startingId)
  const download = useApp((s) => s.download)
  const playFromSearch = useApp((s) => s.playFromSearch)
  const downloadAndAddToPlaylist = useApp((s) => s.downloadAndAddToPlaylist)
  const playlists = useApp((s) => s.playlists)
  const likedIds = useApp((s) => s.likedIds)
  const toggleLike = useApp((s) => s.toggleLike)
  const tracks = useApp((s) => s.tracks)
  const jobs = useApp((s) => s.jobs)
  const notify = useApp((s) => s.notify)
  const freeResults = useApp((s) => s.freeResults)
  const freeQuery = useApp((s) => s.freeQuery)
  const freeSearching = useApp((s) => s.freeSearching)
  const searchFree = useApp((s) => s.searchFree)
  const playFree = useApp((s) => s.playFree)
  const radio = useApp((s) => s.radio)
  const loadRadio = useApp((s) => s.loadRadio)
  const playRadio = useApp((s) => s.playRadio)

  const [q, setQ] = useState(query)
  const current = useCurrentTrack()
  const playing = usePlayer((s) => s.playing)
  const stop = usePlayer((s) => s.stop)
  const defaultQ = useMemo(popularQuery, [])

  // TopBar commit → refill this input (and only then — typing must not fight
  // the store).
  const [committed, setCommitted] = useState(query)
  useEffect(() => {
    if (query !== committed) {
      setCommitted(query)
      setQ(query)
    }
  }, [query, committed])

  // Default fill: while the input is empty, keep a (cached) popular search in
  // `results` so the page has content.
  useEffect(() => {
    if (q.trim() !== '') return
    if (searching || resultsQuery === defaultQ) return
    void search(defaultQ, { silent: true })
  }, [q, searching, resultsQuery, defaultQ, search])

  // Same default fill for the free catalogues (own session cache).
  useEffect(() => {
    if (q.trim() !== '') return
    if (freeSearching || freeQuery === defaultQ) return
    void searchFree(defaultQ, { silent: true })
  }, [q, freeSearching, freeQuery, defaultQ, searchFree])

  // Public radio channels: one silent fetch per session.
  useEffect(() => {
    void loadRadio()
  }, [loadRadio])

  // Background YouTube + free-catalogue search as the user types (debounced,
  // silent, cached). The free tier fires in parallel so its section appears
  // without delaying the YouTube list.
  useEffect(() => {
    const trimmed = q.trim()
    if (trimmed.length < 2 || trimmed === resultsQuery) return
    const id = window.setTimeout(() => {
      setCommitted(trimmed)
      setSearchQuery(trimmed)
      void search(trimmed, { silent: true })
      void searchFree(trimmed, { silent: true })
    }, 500)
    return () => window.clearTimeout(id)
  }, [q, resultsQuery, search, searchFree, setSearchQuery])

  const ownedIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks])
  const likedSet = useMemo(() => new Set(likedIds), [likedIds])
  const pendingIds = useMemo(() => new Set(
    jobs
      .filter(
        (j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting'
      )
      .map((j) => j.trackId)
  ), [jobs])

  // Local matches: deferred so a large fuzzy index never blocks keystrokes.
  const index = useMemo(() => createLibraryIndex(tracks), [tracks])
  const deferredQ = useDeferredValue(q)
  const localMatches = useMemo(() => {
    const needle = deferredQ.trim()
    if (!needle) return []
    return searchIndexed(index, needle).slice(0, 20)
  }, [index, deferredQ])

  // Quick picks (empty input only): likes first, then the newest additions.
  const quickPicks = useMemo(() => {
    const liked = likedIds
      .map((id) => tracks.find((track) => track.id === id))
      .filter((track): track is Track => Boolean(track))
    const rest = tracks.filter((track) => !likedSet.has(track.id))
    return [...liked, ...rest].slice(0, 6)
  }, [tracks, likedIds, likedSet])

  const trimmedQ = q.trim()
  const hasQuery = trimmedQ !== ''
  // True when `results` answers what's in the input right now.
  const resultsLive = hasQuery && resultsQuery === trimmedQ
  const trendingLive = !hasQuery && resultsQuery === defaultQ
  const showSpinner = searching && (hasQuery ? resultsLive || resultsQuery === '' : trendingLive)
  // Same for the free catalogues.
  const freeShown = hasQuery ? freeQuery === trimmedQ : freeQuery === defaultQ

  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    const trimmed = q.trim()
    if (!trimmed) return
    setCommitted(trimmed)
    setSearchQuery(trimmed)
    void search(trimmed)
    void searchFree(trimmed)
  }

  function playLocal(track: Track): void {
    const idx = tracks.findIndex((tk) => tk.id === track.id)
    if (idx >= 0) usePlayer.getState().playQueue(tracks, idx)
  }

  function renderResult(r: SearchResult, i: number): React.JSX.Element {
    const owned = ownedIds.has(r.id)
    const pending = pendingIds.has(r.id)
    const starting = startingId === r.id
    const isActive = current?.id === r.id && playing
    const handlePlay = (): void => {
      if (isActive) stop()
      else void playFromSearch(r)
    }
    const menu = (e: React.MouseEvent): void => {
      const items: MenuItem[] = [
        { label: isActive ? t('ctx.stop', 'Stop') : t('ctx.play', 'Play'), onSelect: handlePlay },
        ...(owned
          ? []
          : pending
            ? [{ label: t('ctx.downloading', 'Downloading…'), disabled: true } as MenuItem]
            : [{ label: t('ctx.saveToLibrary', 'Save to library'), onSelect: () => void download(r) } as MenuItem]),
        playlistSubmenu(playlists, (pid) => void downloadAndAddToPlaylist(r, pid)),
        { label: likedSet.has(r.id) ? t('ctx.unlike', 'Unlike') : t('ctx.like', 'Like'), onSelect: () => void toggleLike(r.id, r) },
        { label: t('ctx.copyTitle', 'Copy title'), onSelect: () => void navigator.clipboard.writeText(`${r.title} — ${r.artist}`).then(() => notify(t('action.copied', 'Copied'))).catch(() => {}) },
        { label: t('ctx.openYouTube', 'Open on YouTube'), onSelect: () => void window.open(r.webUrl, '_blank') }
      ]
      openContextMenu(e, items)
    }
    return (
      <TrackRow
        key={r.id}
        index={i}
        title={r.title}
        artist={r.artist}
        thumbnail={r.thumbnail}
        durationSec={r.durationSec}
        playing={isActive}
        onPlay={handlePlay}
        // Hovering warms the yt-dlp resolve (seconds cold, cached 3h) so the
        // click only waits for the element's first buffer.
        onPrewarm={owned ? undefined : () => prewarmStream(r.id)}
        liked={likedSet.has(r.id)}
        onToggleLike={() => void toggleLike(r.id, r)}
        onContextMenu={menu}
        actions={
          <>
            <button
              className={`btn btn-sm${isActive ? ' btn-danger' : ''}`}
              onClick={handlePlay}
              title={
                isActive
                  ? t('search.tipStop', 'Stop playback')
                  : owned
                    ? t('search.tipLocal', 'Play from your library (offline)')
                    : t('search.tipStream', 'Stream now — downloads automatically if streaming fails')
              }
            >
              {isActive ? <IconPause size={13} /> : <IconPlay size={13} />} {isActive ? t('ctx.stop', 'Stop') : t('ctx.play', 'Play')}
            </button>
            {starting ? (
              <span className="chip">{t('search.starting', 'starting…')}</span>
            ) : owned ? (
              <span className="chip chip-ok">{t('search.inLibrary', 'in library')}</span>
            ) : pending ? (
              <span className="chip">{t('search.downloadingChip', 'downloading…')}</span>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void download(r)}
                title={t('search.tipDownload', 'Download to library')}
              >
                <IconDownload size={13} /> {t('action.save', 'Save')}
              </button>
            )}
            {playlists.length > 0 && (
              <select
                className="btn btn-ghost btn-sm"
                value=""
                title={owned ? t('search.tipAdd', 'Add to playlist') : t('search.tipAddSave', 'Save to library + add to playlist')}
                onChange={(e) => {
                  if (e.target.value) void downloadAndAddToPlaylist(r, e.target.value)
                  e.target.value = ''
                }}
              >
                <option value="">{t('search.addOption', '+ playlist')}</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void window.open(r.webUrl, '_blank')}
              title={t('ctx.openYouTube', 'Open on YouTube')}
            >
              <IconExternal size={13} />
            </button>
          </>
        }
      />
    )
  }

  /**
   * Free-catalogue row: provider chip, play (preview/CC go through the
   * write-through cache) and link-outs. Spotify rows carry no audio and open
   * the real recording instead.
   */
  function renderFree(hit: FreeHit, i: number): React.JSX.Element {
    const isActive = current?.id === hit.id && playing
    const playable = Boolean(hit.audioUrl)
    const handlePlay = (): void => {
      if (isActive) stop()
      else playFree(hit)
    }
    const alsoOn = hit.alsoOn?.length
      ? ` · ${t('free.alsoOn', 'also on')} ${hit.alsoOn.map(providerLabel).join(', ')}`
      : ''
    return (
      <TrackRow
        key={hit.id}
        index={i}
        title={hit.title}
        artist={[hit.artist, hit.album].filter(Boolean).join(' — ')}
        thumbnail={hit.artwork}
        durationSec={hit.durationSec}
        playing={isActive}
        onPlay={handlePlay}
        // Hovering starts the write-through cache download; the click then
        // reads locally instead of opening the network path.
        onPrewarm={playable ? () => prewarmFree(hit) : undefined}
        actions={
          <>
            <span className="chip" title={`${providerLabel(hit.provider)}${alsoOn}`}>
              {providerLabel(hit.provider)}
              {hit.preview ? ` · ${t('free.previewChip', 'preview')}` : ''}
            </span>
            {playable ? (
              <button
                className={`btn btn-sm${isActive ? ' btn-danger' : ''}`}
                onClick={handlePlay}
                title={
                  hit.preview
                    ? t('free.tipPreview', 'Play the preview instantly — cached for replays')
                    : t('free.tipFull', 'Play now — cached locally for instant replays')
                }
              >
                {isActive ? <IconPause size={13} /> : <IconPlay size={13} />} {isActive ? t('ctx.stop', 'Stop') : t('ctx.play', 'Play')}
              </button>
            ) : (
              <button
                className="btn btn-sm"
                onClick={() => void window.open(hit.spotifyUrl ?? hit.pageUrl ?? '', '_blank')}
                title={t('free.tipSpotify', 'Open this recording on Spotify')}
              >
                <IconExternal size={13} /> {t('free.openSpotify', 'Open in Spotify')}
              </button>
            )}
            {playable && hit.pageUrl && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void window.open(hit.pageUrl as string, '_blank')}
                title={`${t('free.openProvider', 'Open on')} ${providerLabel(hit.provider)}${hit.license ? ` — ${hit.license}` : ''}`}
              >
                <IconExternal size={13} />
              </button>
            )}
            {playable && hit.spotifyUrl && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void window.open(hit.spotifyUrl as string, '_blank')}
                title={t('free.tipSpotify', 'Open this recording on Spotify')}
              >
                <IconExternal size={13} />
              </button>
            )}
          </>
        }
      />
    )
  }

  return (
    <>
      <h1 className="page-title">{t('page.search', 'Search')}</h1>
      <p className="page-sub">{t('search.sub', 'Find music on YouTube, then save it to your local library.')}</p>

      <form className="searchbar" onSubmit={onSubmit}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search.placeholder', 'Search YouTube — artists, songs, albums, mixes…')}
          autoFocus
          aria-label={t('search.queryAria', 'Search query')}
        />
        <button className="btn" type="submit" disabled={searching || trimmedQ === ''}>
          {searching ? t('search.searching', 'Searching…') : t('search.searchBtn', 'Search')}
        </button>
      </form>

      {!hasQuery && quickPicks.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div className="sp-section-head">
            <h2>{t('search.quickPicks', 'Quick picks')}</h2>
          </div>
          <div className="track-list">
            {quickPicks.map((track, i) => {
              const isActive = current?.id === track.id && playing
              return (
                <TrackRow
                  key={track.id}
                  index={i}
                  title={track.title}
                  artist={track.artist}
                  thumbnail={track.thumbnail}
                  durationSec={track.durationSec}
                  playing={isActive}
                  onPlay={() => { if (isActive) stop(); else playLocal(track) }}
                  liked={likedSet.has(track.id)}
                  onToggleLike={() => void toggleLike(track.id)}
                  actions={
                    <button className="btn btn-sm" onClick={() => { if (isActive) stop(); else playLocal(track) }}>
                      {isActive ? <IconPause size={13} /> : <IconPlay size={13} />} {isActive ? t('ctx.stop', 'Stop') : t('ctx.play', 'Play')}
                    </button>
                  }
                />
              )
            })}
          </div>
        </section>
      )}

      {hasQuery && localMatches.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div className="sp-section-head">
            <h2>{t('search.fromLibrary', 'From your library')}</h2>
          </div>
          <div className="track-list">
            {localMatches.map((track, i) => {
              const isActive = current?.id === track.id && playing
              return (
                <TrackRow
                  key={track.id}
                  index={i}
                  title={track.title}
                  artist={track.artist}
                  thumbnail={track.thumbnail}
                  durationSec={track.durationSec}
                  playing={isActive}
                  onPlay={() => { if (isActive) stop(); else playLocal(track) }}
                  liked={likedSet.has(track.id)}
                  onToggleLike={() => void toggleLike(track.id)}
                  actions={
                    <button className="btn btn-sm" onClick={() => { if (isActive) stop(); else playLocal(track) }}>
                      {isActive ? <IconPause size={13} /> : <IconPlay size={13} />} {isActive ? t('ctx.stop', 'Stop') : t('ctx.play', 'Play')}
                    </button>
                  }
                />
              )
            })}
          </div>
        </section>
      )}

      {freeShown && (freeResults.length > 0 || freeSearching) && (
        <section style={{ marginBottom: 24 }}>
          <div className="sp-section-head">
            <h2>{t('free.title', 'Free to play')}</h2>
            {/* Partials land while the slower catalogues are still answering. */}
            {freeSearching && freeResults.length > 0 && (
              <span className="chip">{t('free.stillLooking', 'still looking…')}</span>
            )}
          </div>
          <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
            {t(
              'free.hint',
              'Preview clips from Deezer and Apple, public-domain and Creative Commons tracks from the Internet Archive — streamed instantly and cached on this PC for replays. No account needed.'
            )}
          </p>
          {freeResults.length > 0 && <div className="track-list">{freeResults.slice(0, 10).map(renderFree)}</div>}
          {freeResults.length === 0 && freeSearching && (
            <div className="empty">{t('free.lookingUp', 'Looking through the free catalogues…')}</div>
          )}
        </section>
      )}

      {!hasQuery && radio.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <div className="sp-section-head">
            <h2>{t('radio.title', 'Live radio')}</h2>
          </div>
          <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
            {t('radio.hint', 'Always-on public stations (SomaFM) — tuned in instantly. Live streams are not cached; they never end.')}
          </p>
          <div className="track-list">
            {radio.slice(0, 8).map((channel, i) => {
              const radioId = `radio:${channel.id}`
              const isActive = current?.id === radioId && playing
              const handleTune = (): void => {
                if (isActive) stop()
                else void playRadio(channel)
              }
              return (
                <TrackRow
                  key={channel.id}
                  index={i}
                  title={channel.title}
                  artist={channel.genre || t('radio.live', 'Live radio')}
                  thumbnail={channel.image}
                  durationSec={0}
                  playing={isActive}
                  onPlay={handleTune}
                  onPrewarm={isActive ? undefined : () => prewarmRadio(channel)}
                  actions={
                    <>
                      <span className="chip" title={channel.description}>
                        {t('radio.liveChip', 'live')}
                      </span>
                      <button
                        className={`btn btn-sm${isActive ? ' btn-danger' : ''}`}
                        onClick={handleTune}
                        title={t('radio.tip', 'Tune in — an always-on public stream')}
                      >
                        {isActive ? <IconPause size={13} /> : <IconPlay size={13} />} {isActive ? t('ctx.stop', 'Stop') : t('radio.tuneIn', 'Tune in')}
                      </button>
                    </>
                  }
                />
              )
            })}
          </div>
        </section>
      )}

      {(trendingLive || resultsLive) && (
        <section>
          <div className="sp-section-head">
            <h2>{hasQuery ? t('search.youtubeResults', 'YouTube results') : t('search.trending', 'Trending')}</h2>
          </div>
          {results.length > 0 && <div className="track-list">{results.map(renderResult)}</div>}
          {showSpinner && results.length === 0 && <div className="empty">{t('search.lookingUp', 'Searching YouTube…')}</div>}
          {!searching && results.length === 0 && (
            <div className="empty">
              {hasQuery
                ? t('search.noResults', 'No results. Try different keywords.')
                : t('search.emptyDefault', 'Search for something to get started.')}
            </div>
          )}
        </section>
      )}

      {/* First load: no results settled yet (spinner for the default fill). */}
      {!hasQuery && !trendingLive && !quickPicks.length && searching && (
        <div className="empty">{t('search.lookingUp', 'Searching YouTube…')}</div>
      )}
      {hasQuery && !resultsLive && !localMatches.length && (
        <div className="empty">
          {q.trim().length >= 2
            ? t('search.lookingUp', 'Searching YouTube…')
            : t('search.keepTyping', 'Keep typing to search…')}
        </div>
      )}
    </>
  )
}
