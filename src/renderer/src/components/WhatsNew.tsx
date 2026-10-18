import { useEffect, useState } from 'react'

const SEEN_KEY = 'spinity:seenVersion'

interface Note {
  title: string
  body: string
}

/** Newest first. The modal shows every version newer than what was last seen. */
const NOTES_BY_VERSION: { version: string; notes: Note[] }[] = [
  {
    version: '1.5.0',
    notes: [
      { title: 'Instant play, quiet caching', body: 'Clicking a result now hands the player the direct CDN link \u2014 audio starts as soon as the network delivers it. In parallel the same track is copied into the local cache, so every later play is served from disk: instant, and offline once cached.' },
      { title: '16 connections when you have aria2c', body: 'With aria2c installed (\u201cOptional\u201d row in Settings \u2192 Tools; winget install aria2.aria2) the background copy runs multi-connection and fills a track in seconds. Without it everything still works \u2014 the cache just fills on a single connection. Fills are capped at two at a time so a burst of clicks never floods your connection.' },
      { title: 'Caching that heals itself', body: 'If a signed URL is refused mid-download \u2014 some YouTube clients sign URLs that only answer their own requests \u2014 the copy retries through yt-dlp with a freshly minted link. Cache entries are keyed by video id, so even a re-signed stream replays from disk. Music you streamed can now also resolve straight from text ("Artist - Track") when an integration asks for it.' },
      { title: 'Your cache, your rules', body: 'New switch in Settings \u2192 Downloads: Cache streamed tracks. Inside a 512 MB budget, least-recently-used entries are evicted first.' }
    ]
  },
  {
    version: '1.4.1',
    notes: [
      { title: 'Search arrives while you read', body: 'The Free to play section now paints each catalogue the moment it answers \u2014 Deezer and Apple rows in about a second, the Internet Archive filling in behind them. Repeat searches are also remembered across restarts.' },
      { title: 'Play starts on hover', body: 'Rest the pointer on a result and the heavy part starts early: YouTube rows resolve their stream, previews start caching, radio resolves its station. Clicking Play then only waits for the first moments of audio.' },
      { title: 'Radio tunes in faster', body: 'The stations shown on the Search page are resolved in the background right away, so the first tune-in skips the playlist lookup.' }
    ]
  },
  {
    version: '1.4.0',
    notes: [
      { title: 'Free music, straight away', body: 'Search now also looks through Deezer and Apple previews and the Internet Archive\u2019s public-domain and Creative Commons catalogue \u2014 press play and it starts, no account and nothing to download. Add optional Spotify API keys in Settings and Spotify results link out to the real recording.' },
      { title: 'Instant replays', body: 'Every preview is cached on your PC while it plays, so the second listen starts in milliseconds \u2014 Settings \u2192 Free music shows the cache size, the first-byte time and the measured time to first audio.' },
      { title: 'Live radio', body: 'Always-on public stations (SomaFM) now sit on the Search page \u2014 tune in and it just plays. Stations never end, so they are streamed direct and not cached.' },
      { title: 'Two ways to write lyrics', body: 'The lyrics panel has a Normal and an AI writing mode \u2014 your matched lyrics stay intact while the model writes its own version, and switching back is instant.' }
    ]
  },
  {
    version: '1.3.1',
    notes: [
      { title: 'Your own cover art', body: 'Local songs now always show the picture embedded in the file. Previously, if the app couldn\u2019t read the file it would quietly borrow a YouTube thumbnail, so different tracks could end up sharing the same cover.' },
      { title: 'A new installer', body: 'One click, one window: no wizard pages, no directory picker, and no UAC prompt — the install is per-user, so nothing asks for administrator rights.' },
      { title: 'Updates that just work', body: 'Checking for a running copy of the app no longer depends on PowerShell, and your Desktop and Start-menu shortcuts are rebuilt on every install.' }
    ]
  },
  {
    version: '1.3.0',
    notes: [
      { title: 'A brand-new look', body: 'Spinity now wears AURORA: frosted-glass panels floating over a deep-space backdrop, with slow-drifting aurora light behind the whole app — login, sidebar, library, player and settings restyled together.' },
      { title: 'Fresh theme colors', body: 'The palette is retuned — Blaze, Violet, Ice, Rose and Mint in the profile menu. Ember orange is still the default, and whatever you picked before carries over.' },
      { title: 'Calm by default', body: 'The aurora drifts slowly enough to ignore, and Windows\u2019 reduced-motion setting switches off every animation in the app.' }
    ]
  },
  {
    version: '1.2.0',
    notes: [
      { title: 'Arabic interface', body: 'Switch the whole app to Arabic in Settings → Language — full RTL layout with navigation, search, player and pages translated.' },
      { title: 'Search that fills itself', body: 'The Search page opens with quick picks and trending music, matches your library as you type, and quietly searches YouTube in the background.' },
      { title: 'Lighter playback, smoother UI', body: 'The player bar no longer re-renders several times a second, repeat searches render instantly from cache, and pages, toasts and hovers now animate.' }
    ]
  },
  {
    version: '1.1.7',
    notes: [
      { title: 'FX removed', body: 'No more speed & reverb panel — plain playback, nothing to misconfigure.' },
      { title: 'Quiet skipping', body: 'The loading chip only shows when loading genuinely takes a moment.' },
      { title: 'Mini-player behaves', body: 'Announcements hide after 3 seconds and the widget stays out of the taskbar.' }
    ]
  },
  {
    version: '1.1.6',
    notes: [
      { title: 'Instant switching', body: 'Next song starts in ms: pre-loading, no redundant seek, and waveform decoding waits its turn.' },
      { title: 'Sharp local covers', body: 'Embedded art at 512px instead of 128px — old blurry tiles refresh on their own.' },
      { title: 'Faster everywhere', body: 'Throttled progress, parallel tool checks, indexed library search, snappier lists.' }
    ]
  },
  {
    version: '1.1.5',
    notes: [
      { title: 'Back to 1.0.1 sound', body: 'Streams resolve the proven way again and plain playback is byte-identical to 1.0.1 — reverb refetches cleanly when switched on, so FX can never mute you.' }
    ]
  },
  {
    version: '1.1.4',
    notes: [
      { title: 'Resume rescue', body: 'Pressing play recovers first and errors second: expired stream URLs re-resolve, dead sources reload with position kept, autoplay blocks just ask for a press.' }
    ]
  },
  {
    version: '1.1.3',
    notes: [
      { title: 'Adding downloads again', body: 'Liking a song you don\u2019t own saves it to the library automatically; +playlist from Search still downloads first. Your music plays offline, no streaming required.' }
    ]
  },
  {
    version: '1.1.2',
    notes: [
      { title: 'Playback rescue', body: 'Dead files fall back to streaming automatically; every error now says what happened and what to do.' },
      { title: 'Fresh notes, every version', body: 'This popup now shows only the current update\u2019s notes — no more repeats.' },
      { title: 'Stream-first, confirmed', body: 'Likes and +playlist from Search play instantly via streaming (stream chip); Save is the only thing that downloads.' }
    ]
  },
  {
    version: '1.1.1',
    notes: [
      { title: 'FX silence fixed + Reset audio', body: 'CORS-clean fetches, atomic graph builds, suspended-context warnings, and a Reset button that rebuilds sound without restarting.' },
      { title: 'Mini-player rework', body: 'Smaller frosted widget with auto-hide: it sinks when other apps focus and pops back briefly on each song.' },
      { title: 'Faster search & streaming', body: 'New queries kill stale searches; streams resolve via a fast lane and cache for 3 hours.' },
      { title: 'Stream-first likes & playlists', body: 'Liking or adding from Search plays instantly via streaming — downloads only happen when you Save.' },
      { title: 'Errors you can act on', body: 'Dead files auto-fall-back to streaming; messages say what to do instead of raw browser text.' }
    ]
  },
  {
    version: '1.1.0',
    notes: [
      { title: 'Audio effects', body: 'Slowed + reverb, Nightcore and Normal presets, speed, pitch-keep and reverb depth — all persistent.' },
      { title: 'Lossless, labeled', body: 'Codec tags like FLAC · 96 kHz · 24-bit in the player bar.' },
      { title: 'Mini-player', body: 'Always-on-top widget with art, transport and seek.' },
      { title: 'Lyrics', body: 'Fullscreen blurred view; sidecar .lrc wins, otherwise auto-matched and cached.' },
      { title: 'Waveform seek bar', body: 'Real per-track waveforms, computed once and cached.' }
    ]
  },
  {
    version: '1.0.0',
    notes: [
      { title: 'One account, everywhere', body: 'Sign in with your email on any computer — friends and chat follow you, music stays per-device. No more Connect buttons; you\'re online automatically.' },
      { title: 'Your status', body: 'Online, Do not disturb, or Invisible — pick it in Friends (bottom-left). Offline is auto-detected.' },
      { title: 'Notifications that arrive', body: 'Message, call and party popups now fire even inside the app. The bell 🔔 is a notification center: downloads with %, unread chats, one-click party Join.' },
      { title: 'Calls you can hear', body: 'Outgoing ring-back and incoming ringtones are built in.' },
      { title: 'Photos in chat', body: 'Send photos (5 MB max). They auto-delete in 3 days unless you right-click → Pin. Right-click → Save image… keeps a copy.' },
      { title: 'Right-click everything', body: 'Friends, messages, playlists, tracks, search results and downloads all have context menus now.' }
    ]
  }
]


/**
 * "What's new" modal. Shows one section per version newer than what was last
 * seen — so two quick updates don't repeat the same notes twice, and nothing
 * repeats after dismissal.
 */
export function WhatsNew({ version, onClose }: { version: string; onClose: () => void }): React.JSX.Element {
  let seen: string | null = null
  try {
    seen = localStorage.getItem(SEEN_KEY)
  } catch {}
  const fresh = NOTES_BY_VERSION.filter((entry) => !seen || compareVersions(entry.version, seen) > 0)
  const sections = fresh.length > 0 ? fresh : NOTES_BY_VERSION.slice(0, 1)
  return (
    <div className="chat-lightbox" role="dialog" aria-label={`What's new in ${version}`}>
      <div className="wn-card">
        <h2>🎉 What&apos;s new in {version}</h2>
        {sections.map((section) => (
          <div key={section.version}>
            {sections.length > 1 && <h3 className="wn-version">{section.version}</h3>}
            <div className="wn-list">
              {section.notes.map((n) => (
                <div key={n.title} className="wn-row">
                  <strong>{n.title}</strong>
                  <span className="hint">{n.body}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <button className="btn" onClick={onClose} autoFocus>Start listening</button>
      </div>
    </div>
  )
}

/** Numeric dot-separated compare: 1.1.10 > 1.1.2, 1.0.0 < 1.1.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** Mount-once helper: shows WhatsNew on first open of each new version. */
export function useWhatsNew(ready: boolean, signedIn: boolean): { version: string | null; dismiss: () => void } {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!ready || !signedIn) return
    let cancelled = false
    void window.spinity.updater
      .getVersion()
      .then((v) => {
        if (cancelled) return
        let seen: string | null = null
        try {
          seen = localStorage.getItem(SEEN_KEY)
        } catch {}
        if (seen !== v) setVersion(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ready, signedIn])
  return {
    version,
    dismiss: () => {
      if (version) {
        try {
          localStorage.setItem(SEEN_KEY, version)
        } catch {}
      }
      setVersion(null)
    }
  }
}
