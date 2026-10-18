# Spinity Changelog

## 1.5.0 — Instant streams, self-healing background caching ⚡

**Play starts from the CDN while the cache catches up behind it**
- **Direct-URL playback.** A click hands `<audio>` the signed googlevideo URL itself — first audio waits only for the CDN, with no main-process round trip. When no accelerator is installed the answer instead carries a cache-backed `streamUrl`, so the one write-through download still serves playback and the cache at the same time.
- **Background fill with aria2c.** In parallel, the same track is downloaded into the stream cache with `-x 16 -s 16 -k 1M` (multi-connection; live-measured seconds per track). Settings → Tools now reports whether aria2c was found (`winget install aria2.aria2` / `brew install aria2`) — nothing is auto-installed and the app works unchanged without it.
- **Self-healing fills.** Some player clients (visionos/ios/android) sign URLs whose server refuses requests that don't look like the client that asked (live-measured: terminated connection, 403). A refused direct fetch is retried through yt-dlp, which re-extracts with the right client and headers and attaches aria2c as its external downloader — one fallback covers expiry *and* client-specific refusal. A missing aria2c only makes yt-dlp warn and use its internal downloader, so fills never hang.
- **Cache entries keyed by video id.** Signed URLs rotate every few hours, so entries live under `yt:<videoId>` (`spinity://stream/?u=…&k=yt:…`) and a re-signed URL still replays from disk. The 512 MB LRU budget is unchanged; stale `.bin.aria2` control files are swept at startup.
- **Concurrency caps.** At most two fills run at once (FIFO queue of 8) — a burst of clicks can never stack twenty 16-connection transfers. New setting: **Cache streamed tracks** (Settings → Downloads, default on).
- **Text resolves.** `youtube.stream(text, { query: true })` turns "Artist - Track" into a stream in one process (`ytsearch1` search + extract, ~5 s live) and remembers the winning id, so later id-based plays are instant. Note: the originally specified `ytmsearch1:` prefix is not an extractor in current yt-dlp (live error: `Unsupported url scheme: "ytmsearch1"`), and music.youtube.com search URLs return browse ids and extract 3–7× slower — `ytsearch1` is what the app's own Search page uses, so text resolve stays consistent with it.
- Every resolve site (click, engine fallbacks, party sync) now plays `info.streamUrl ?? info.url`; the engine's post-failure re-resolve passes `fresh: true`, so a stale signature can never be answered with itself.

**Tests** — 110 → 140
- Instant-parse fixtures: JSON `--print` lines, titles with quotes/pipes, `NA` fields, ranked candidate ids.
- aria2c: argv building, progress/unit parsing, expiry classification, and the download lifecycle against a fake child process (success, expired 403, empty file, watchdog kill).
- Fill orchestration: publish into the cache, full cleanup on failure, single-download dedupe, aria2 → yt-dlp fallback, two-at-a-time queue cap.
- Stream cache: key-hint replay across rotated URLs, external `publish` (refused while a tee owns the key), `.aria2` orphan sweeping at startup.

## 1.4.1 — Search arrives while you're reading, play starts on hover ⚡

**Free-catalogue results appear as they arrive**
- The **Free to play** section no longer waits for the slowest provider: Deezer and Apple rows paint the moment those catalogues answer (~1 s), the Internet Archive's items fill in behind them, and a small `still looking…` chip marks what is still in flight. Partials merge with the same rules as the final list, so nothing shuffles when the search completes.
- **Repeat searches survive a restart.** The session result cache (YouTube and free catalogues, 10-minute freshness) is now persisted, so a query you ran before the app was closed renders instantly instead of paying the network again.
- New tests: per-provider partial events (including *empty providers stay silent*) and merge parity between the partial and final lists.

**Play starts while you are still deciding**
- **Hover prewarm.** Resting the pointer on a result row starts the expensive part early: a YouTube row resolves its stream URL (seconds cold, then cached ~3 h in the main process), a preview/Archive row starts the write-through cache download, and a radio row resolves its `.pls`. Clicking Play then only waits for the element's first buffer.
- Concurrent resolves of the same video now share **one** yt-dlp process instead of racing two (hover + click on the same row).
- Radio stations the Search page shows are resolved quietly right after the channel list lands (three at a time) — the first tune-in skips the playlist round trip.

**Stream protocol**
- A cache-host server that never sends `Content-Length` (chunked) no longer stalls the response for the full 2.5 s header wait: the protocol starts serving with the first body byte. New chunked-server test.

**yt-dlp**
- Stream resolution and downloads point yt-dlp at a JavaScript runtime when one is present (yt-dlp's own `deno` default stays; a Node already on PATH is offered as the alternative, nothing is installed). Without one, yt-dlp warns that YouTube extraction is degraded and formats can be missing — this keeps the fast, complete path.

## 1.4.0 — Free music, on tap 🎧

**Free music tier: previews, public-domain catalogue and radio**
- The Search page now has a **Free to play** section beside the YouTube results: 30-second licensed previews from **Deezer** and **Apple**, full-length public-domain and Creative Commons audio from the **Internet Archive** (the licence is linked on the row), and — when optional Spotify Web API keys are added in Settings — Spotify results that link out to the real recording.
- A **Live radio** section lists the always-on SomaFM stations; the station's `.pls` playlist is resolved to a direct stream in the main process and tuned in with one click.
- **Write-through stream cache.** Each cacheable stream is fetched once by the main process and teed to two consumers at once: the audio element reads the growing file while the bytes are still arriving, and the same bytes are persisted to disk — so the first audio arrives with the first network bytes and a replay is served locally in milliseconds.
- Ranges stay honest: the protocol waits briefly for `Content-Length` so seeking gets real **206** responses, then serves any byte offset — including into the part that is still downloading.
- Hardening: hosts are allow-listed to the known free catalogues, an idle watchdog aborts stalled downloads, crash leftovers (a payload without its completion sidecar) are cleaned on launch, and a soft **512 MB** LRU budget evicts the least recently used entries — never one that is being served right now.
- **Telemetry you can see.** Settings → **Free music** shows the cache size and entry count, the average network first-byte time, and the measured **time to first audio** (last / average) reported by the engine for every play.
- **No downloader, no extraction, no scraping.** Every playable URL is an official preview clip or a file published for free listening; the whole tier works with no account of any kind.
- Tests: the cache is exercised against a local HTTP server (write-through, reads while downloading, failure + retry, stall watchdog, LRU, restart resurrection, byte-exact ranges), and every adapter parser runs on fixtures with an injected fetch, including the Spotify token exchange.

**Two lyrics modes: Normal and AI writing**
- New switch in the lyrics footer (also in **Settings → AI lyrics matching → Lyrics mode**): **Normal** behaves exactly as before (your upload → your `.lrc` file → the matched song), while **AI writing** lets the model write the lyrics for the song.
- The two modes keep **separate copies**. Toggling overwrites nothing: leave AI writing and the real match reappears instantly with no re-fetch; come back and what it wrote is still there. A bad AI write is therefore always **one tap from normal**, which is the whole point of the second mode.
- AI writing returns **plain text only — never invented timings**, because made-up timestamps are precisely the drifting-lyrics problem the deterministic aligner exists to avoid. The panel labels it `AI-written` so it can never be mistaken for a real match.
- The prompt carries a built-in refusal (`{"unknown": true}`): if the model does not know a song with confidence it says so, and a refusal, a malformed answer or a timeout all fall back to the normal lyrics rather than showing invented words. A refusal is remembered per track, so an unknown song costs one call — not one per open.
- **"Match again" becomes "Write again"** in this mode: it re-asks the model but deliberately never touches the normal match, so switching back stays instant.
- Measured live: 46 lines in 13.6 s for one song, 25 lines in 1.4 s for another, no timestamps introduced. Because a slow server day once passed 40 s, the write gets its own 60 s budget (cached after the first time).
- User uploads and `.lrc` sidecars still win in **both** modes — they are the user's own content.
- Two tests: the writing prompt (refusal path, no file paths, no timings) and an end-to-end mode-switch test that proves switching back loses nothing and never re-searches.

**Faster, sharper AI matching**
- **Streaming with early stop.** The model's reply is now read as it arrives and used the instant its JSON object closes, instead of waiting for the model to stop talking. A busy model that would need 16 s for its last token previously blew the 12 s ceiling and the answer was discarded even though the object itself was finished long before. A plain request still backs it up, and a network failure stops there rather than firing three doomed retries.
- **Answers are sanitized before they are used.** The model sometimes echoes downloader noise back into a field — measured on a real library, `モニタリング spotdown.org` came back with artist `Spotdown`. The title now runs through the existing noise filters, and an artist that is *entirely* noise is dropped (a real artist that merely contains a noisy word is untouched). This is a deterministic filter, not a prompt change, so it cannot invent a name the model did not supply.
- **Cached answers follow the model.** Switching to a different model no longer silently reuses the previous model's answers; they are re-asked once. Sanitizing also runs on read, which repairs entries cached before the filter existed.
- **The lrclib lookups now run in parallel.** The structured search and every free-text reading were sequential, each carrying its own 8 s timeout, so a hard track's lookup cost the *sum* of those waits. They are fired together now — one round trip — before the AI is even consulted.
- Three new tests: the noise filter (incl. the real `Spotdown` case), the title cleaner, and an end-to-end match test that stubs the network and proves the searches overlap.

**Optional AI for the hard cases**
- New **Settings → AI lyrics matching**: paste an NVIDIA API key and a small model reads the names the heuristics cannot. It is used only when the built-in matching is unsure, and at most once per song (answers are cached).
- Three jobs, in increasing order of effort:
  - **Read the name.** `Sonne remix by street Music [TIKTOK VERSION]` is gibberish to a database; the model answers `Sonne — Rammstein`, and the normal search runs again with a name that can be found. Measured on a real library: that track went from a 208-second reference (lyrics 105 s out of step) to a **103-second record — the exact edit on disk** — scoring 1.00.
  - **Choose the recording.** When several lrclib entries share a title, the model picks the one whose length is this file, which is what decides whether the timing lines up.
  - **Estimate a shift.** When automatic captions are too noisy for the deterministic aligner, the model reads the two timelines and returns the offset.
- Built for latency, as asked: the default model is `nvidia/nemotron-3.5-lightning-30b-a3b` with its reasoning step switched off (`enable_thinking: false`) — **~370–750 ms** for a full round trip instead of 2.5–11 s with reasoning on. Every call has a hard timeout and falls back to the heuristics on any failure, so a slow or offline model can never stall the panel.
- Privacy: only names, tags, durations and (for alignment) text lines are sent — never audio, never file paths. The key is stored locally like the sign-in token, never reaches the renderer, and never appears in logs. Settings has a **Test connection** button with the latency, and **Forget learned names** to clear the cache.
- Auto-fetched lyrics are re-matched once (cache version 3) so existing libraries benefit from the improved matcher and the AI pass. Uploaded lyrics are never touched.

**New boot screen**
- The startup splash is now the Spinity mark itself: the spiral is generated as an SVG path and **draws itself** while the session and library load, so the screen is never a frozen logo (it doubles as the progress indicator).
- Real status instead of a silent pause — `Starting Spinity…` → `Restoring your session…` → `Loading your library…` → `Almost there…`, and an honest `Large library — this can take a moment.` if a big library is genuinely slow.
- The app is rendered underneath the whole time and the overlay ignores pointer events, so a fast start still feels instant: the splash holds for ~340 ms, fades out over the live app, and is gone in under a second — measured at 110 ms first paint, 245 ms app ready, 884 ms fully clear.
- Lazily-loaded pages get a matching spinner instead of the bare word "Loading…".

**A saved timing fit can no longer be applied to the wrong lyrics**
- Reported symptom: *House of Memories* lyrics running fast. Cause: a `Fit speed ×0.70` had been applied while the app was still matching the 272-second original; when the matcher later found the 190-second remix that is actually on disk, that scale was still being applied to entirely different line timings — compressing them to 70%, so the words raced ahead.
- A stored timing is now tied to the recording it was measured against. If the match moves to a different length, the fit is dropped and recomputed (logged as `dropped a timing fit … measured against a 272s recording, now matched to 190s`). Verified on that track: back to `in sync`, 57 correctly-timed lines.
- Caption alignment now only runs when the matched entry is a *different edit* of the song. When lrclib already has the same recording (its length matches the file), its timings are right and re-aligning could only add noise.

**Lyrics that line up with your file, automatically**
- When lyrics come from a different edit than the file you have (a longer intro, a re-cut, a remix), Spinity now finds the **video that is your recording** — same title, matching length — and uses its timed captions to work out where each line is actually sung. The words stay lrclib's; only the timing is taken from your recording. Measured on a real library: a fan-made *Stronger Than You (Frisk response)* rip, whose first line lrclib places at 11.7s while the singing starts at 18.4s, is now aligned **+6.4s ×1.02** from 17 matched lines.
- This runs by itself once per track (and on demand with **Auto-align**), is cached forever, and refuses to apply anything it is not sure about — if the captions don't describe those lyrics, nothing changes.
- A **different edit** is now reported from a few seconds of length difference rather than 20%, because a 15-second intro is very audible: the panel says `Matched a different edit (2:47 vs 3:01)` so the reason is visible.

**The right recording wins**
- Ranking now treats the file's length as the strongest evidence of *which recording* a lyrics entry belongs to. Previously an exact artist credit on a 4:32 original beat a 3:10 remix entry — so `House of Memories (PΛLΛDIN Remix)` (191s in the user's library) matched the 4:32 original and drifted, instead of the 190s hardstyle remix that is the same audio.
- Weights: title identifies the song (0.5), duration identifies the recording (0.3, plus a bonus within a couple of seconds), artist (0.2), synced availability (0.06).

**Lyric timing that can be fixed for any song**
- Lyrics are timed against the *reference* recording, and local files are often a different edit of it — sped up, slowed down, re-cut, or with a longer intro. Spinity now stores the matched recording's length and fits the timeline to your file: a slowed rip (1.25× longer) or a sped-up one (0.8×) is stretched automatically, so every line lands back on the beat.
- A **Sync** panel in the lyrics view shifts the words by ±0.25s / ±1s (or `[` and `]`) until the highlighted line matches what you hear, and remembers it per track — that is the escape hatch that works for *every* song, whatever edit it is. **Reset timing** returns it to the automatic fit.
- When the matched recording is a substantially different length (a 1:42 edit against a 4:32 original) the panel says so, so a timing problem is explained instead of mysterious.
- **Match again** re-runs the lookup and takes the closest match for the file, and auto-fetched lyrics matched by the older matcher are retired once so every track gets the improved matching. Lyrics you uploaded are never touched.

**Finding the right song (and its lyrics)**
- Song names are cleaned before anything is searched: downloader site names and domains (`モニタリング spotdown.org` → `モニタリング`), bitrates (`320kbps`), `(Official Video)`/`[HD]`/`.mp3` tags and uploader by-lines (`Sonne remix by street Music [TIKTOK VERSION]` → `Sonne`) are all stripped. Cover art uses the same cleaning, so borrowed thumbnails improve too.
- Matching is now a scored search instead of one exact request: every cleaned reading of the name is looked up (full name, name without asides, remix/edit reading, raw name), all candidates are scored on title agreement, artist, duration and synced availability, and the best one above a confidence bar wins. This is what finally resolves fan versions and badly-tagged files:
  - `モニタリング spotdown.org` → モニタリング — DECO*27
  - `Frisk ver. (Undertale Animation Parody)` → Stronger Than You Response (ver. Frisk)
  - `Sonne remix by street Music [TIKTOK VERSION]` → Sonne — Rammstein
- Instrumentals are recognised: when the match is confident but no lyrics exist (common in phonk libraries, e.g. `Sahara (phonk)`), the panel says **Instrumental** instead of "no lyrics found".
- The panel shows which record matched, so a wrong match is obvious and one click away from being replaced.

**Lyrics panel polish**
- Blurred album art and an accent wash behind the words, an animated "now playing" equaliser, a song progress line under the header, and a shimmer while the lookup runs.
- The active line is highlighted with an accent glow and underline, past lines fade, the list fades out at both ends, and it scrolls to centre smoothly (no twitching on the 4 Hz clock).
- Click any synced line to jump playback there (also reachable with Enter/Space).

**Layout fixes**
- The Spinity brand lockup is gone from the top of the sidebar; the rail starts straight at Home/Search.
- The centred page caption in the top bar no longer sits on top of the search pill when the lyrics panel is open — it is hidden instead.

**Lyrics moved to the right side**
- Lyrics are a docked panel on the right edge instead of a full-screen overlay: pages, the queue and the player bar stay visible and usable while they are open.
- The panel has a proper close button (X), closes with `Esc`, and toggles with `L` from anywhere. It stays open while you browse.

**Lyrics for local files**
- Automatic lyrics are now only looked up for tracks whose name is an actual song title. `1.mp3`, `2.mp3`, `Track 03.wav` and friends are never sent to the network — the panel says so and offers an upload instead.
- Real names still match, and matching got smarter: an exact lrclib lookup first, then a scored search that tolerates a different artist tag or duration.
- You can add your own lyrics at any time: **Choose .lrc file** (a native picker) or paste them into the panel. Manual lyrics always win over anything auto-fetched, and can be replaced or removed from the same panel. A `.lrc` next to the audio file still works and is never overwritten.

**Artwork is fast again**
- Cover requests are answered instantly with a placeholder while a borrowed YouTube cover is fetched in the background; the tile refreshes itself the moment the cover lands. Previously every request queued behind a yt-dlp search, so a folder of local files took tens of seconds to show any art.
- Artwork responses carry real cache headers now, so navigating between pages no longer re-requests every cover, and a per-session memory cache answers repeat tiles without touching ffmpeg again.
- Adding or rescanning a folder (and starting the app) warms artwork in the background at low priority: embedded covers are extracted ahead of time, and only real song titles trigger a cover search.
- Tiles request their image as soon as they are visible (60 ms debounce) instead of waiting on a full idle round trip, and already-decoded covers paint immediately on re-mounts.

**Spotify-style controls and shortcuts**
- Keyboard shortcuts: `Space` play/pause, `Ctrl+←/→` previous/next, `Shift+←/→` seek 10s, `Ctrl+↑/↓` volume, `M` mute, `S` shuffle, `R` repeat, `F` like the current song, `L` lyrics, `Ctrl+K` search, `?` shortcut list, `Esc` close panels.
- New **save to Liked Songs** button in the player bar, and a keyboard-shortcut button in the top bar.
- The full shortcut list is discoverable in-app: press `?`, use the top-bar button, or see the new Settings → Keyboard shortcuts card.

## 1.3.1 — The right cover art, every time 🖼️

**Local files finally show their own cover**
- A local song now always shows the artwork embedded in the file. The app used to silently fall back to a YouTube thumbnail whenever it could not read the file's picture, so unrelated tracks could share someone else's cover.
- The cover lookup now reports three answers instead of two: the file **has** artwork, the file **has none**, or the file **could not be read**. Only a confirmed "no picture" is allowed to borrow a YouTube cover, so a missing decoder can no longer masquerade as an absent picture.
- `ffprobe` ships and is discovered properly. It is now copied alongside `ffmpeg` into the tools folder and located whether it sits in the same folder, in the downloaded package, or on `PATH`.
- Artwork URLs carry a version segment, so a cover cached by an older build can never be served again after upgrading.

**A new installer**
- One click, one window. The wizard (directory page, install-mode page, license page, finish page) is gone — the installer opens a single dark window with the Spinity logo, a progress bar and a **Close** button.
- **No UAC prompt.** The install is per-user, so nothing asks for administrator rights and the install can no longer fail with an elevation error. An old machine-wide install is detected and explained instead of leaving two copies behind.
- Looking for a running copy of the app no longer depends on PowerShell, so the install and update no longer break where the execution policy is locked down.
- Desktop and Start-menu shortcuts are rebuilt on every install, so a missing or stale one heals itself.

## 1.3.0 — AURORA 🟠

**A new look: glass on midnight**
- The interface was rebuilt on the **AURORA** design system: frosted-glass panels floating over a deep-space backdrop, lit by three slow-drifting aurora sources behind the shell.
- Softer geometry, hairline borders and layered shadows replace the old flat-black theme — login, sidebar, top bar, library, player and settings were all restyled together.
- Themes are driven by a single `--accent` token with CSS-derived tints (`--accent-ink`, `--accent-soft`, `--accent-glow`), so picking a colour repaints every control at once instead of leaving stray hard-coded shades behind.

**Refreshed palette**
- Theme colours renamed and retuned: **Blaze, Violet, Ice, Rose, Mint** — ember orange is still the default.
- Avatar gradients refreshed to match the new palette, and saved picks keep working (the old green default still migrates on its own).

**Motion that knows when to stop**
- The aurora drifts on a 46-second loop. `prefers-reduced-motion` still switches off every animation in the app, drift included.

## 1.2.0 — Arabic + living search 🌍

**Arabic interface**
- New **Settings → Language** option: the whole app flips to RTL Arabic — sidebar, top bar, search, library, player bar, settings, login, friends, notifications and toasts.
- Arabic-aware library matching: harakat/tatweel stripped and hamza carriers folded (أ/إ/آ → ا, ة → ه, ى → ي), so Arabic queries actually find songs — they used to match nothing.

**Search page that is never empty**
- Opens with **Quick picks** (local likes + recent tracks) and a **Trending** shelf fed by a silent, cached popular search — no more blank "search for something" prompt.
- Instant local matches while you type (deferred so large libraries never block a keystroke) plus a debounced background YouTube search; Enter still forces an explicit search with its toasts.
- The top-bar query now refills the Search page input, and results track which query they answer — stale results can't flash under a newer search.
- YouTube results are cached for the session (10-minute TTL): back-navigation and repeat queries render instantly.

**Lighter playback**
- The player bar and its 180-bar waveform no longer re-render on the engine's 4Hz clock — elapsed time and played bars paint the DOM directly, cutting the biggest source of player jank.
- Sequential next-track warming starts at `loadedmetadata` (earlier than playback start), so song advances are usually already cached.
- Starting a stream shows an optimistic "starting…" chip instead of looking frozen.

**Smoother UI, proper RTL**
- Page switches fade in, toasts slide up, row hovers ease, the sidebar rail glides when collapsing, and long lists skip rendering offscreen rows. `prefers-reduced-motion` disables all of it.
- RTL polish: transport and history arrows mirror, dropdowns/submenus/overlays open on the correct side, and physical paddings/margins were converted to logical ones throughout.

## 1.1.7 — Simpler player 🎈

**FX effects removed**
- The Speed & reverb panel is gone, along with the whole effects chain in the engine — plain playback, nothing to mute or misconfigure.

**No more "loading…" flash**
- Skipping songs no longer blinks a loading chip; it only appears when loading genuinely takes a moment.

**Mini-player behaves**
- Song announcements hide themselves after 3 seconds (they used to steal focus and stick around until you clicked back).
- The widget no longer shows in the taskbar, hover thumbnails, or Alt+Tab.

## 1.1.6 — Instant switching ⚡

**Next song starts in ms, not seconds**
- The upcoming track pre-loads while the current one still plays, the redundant seek after every load is gone, and session saves no longer block the switch.
- Waveform decoding waits until playback is settled instead of fighting the song's first bytes for disk and CPU.

**Sharp local covers**
- Embedded artwork extracts at 512px (was a blurry 128px); YouTube-borrowed covers prefer max resolution. Old blurry tiles refresh automatically.

**Faster everywhere**
- Download progress throttled, tool checks parallel, stream/cover caches true LRU, library search indexed + debounced, playlist art and like-checks O(1).

## 1.1.5 — Back to 1.0.1 sound 🔊

**Playback you can trust again**
- Streams resolve with yt-dlp's default client again (the android fast-lane broke real videos) — repeat plays stay instant via the URL cache.
- CORS mode now follows actual DSP need: plain loads behave exactly like 1.0.1, and enabling reverb refetches the current track CORS-clean keeping position, so pre-FX buffers can never go mute.

## 1.1.4 — Resume rescue ▶️

**"Could not resume playback" fixed**
- Pressing play no longer gives up on the first failure: stream entries re-resolve expired URLs, dead local sources reload once with position kept, autoplay blocks say "press Play" instead of erroring, and everything else lands on the friendly messages from 1.1.2.

## 1.1.3 — Old-school saves 💾

**Adding downloads again**
- Liking a song you don't own saves it to the library (one queued download, heart flips instantly). +playlist from Search was already download-first — kept that way. Nothing you add depends on streaming anymore.

## 1.1.2 — Playback rescue 🛟

**"No supported source" fixed properly**
- Dead/moved files now fall back to streaming automatically when a YouTube URL exists; every media failure shows what happened and what to do instead of raw browser text (`NotSupportedError`, blocked autoplay, moved files, dead streams).

**Changelog that keeps up**
- The What's New popup is now versioned: each update shows only its own notes (missed versions stack), so it never repeats stale entries.

**Stream-first, confirmed**
- Liking or +playlist from Search adds instantly and plays via streaming (look for the `stream` chip) — downloads happen only through Save. If you saw downloads, you were still on 1.1.0: install this build.

## 1.1.1 — Speed + sound rescue 🚑

**FX silence fixed**
- Root causes removed: fetches are now CORS-clean from the first byte (so routing audio through effects can't go mute), the graph builds atomically (no half-wired silence), suspended contexts surface a warning with one-click unlock, and a new "Reset audio" button in the FX panel rebuilds the engine without losing queue or position.

**Mini-player rework**
- Smaller, frosted-glass transparent widget. New Settings → Mini-player auto-hide: it sinks when another app takes focus and pops back for 4 seconds on every song change.

**Search is fast**
- A new query kills the previous yt-dlp search instead of stacking slow processes; superseded results die quietly. Tighter timeouts.

**Streaming is fast**
- Android-player fast lane for URL resolution (web fallback), plus a 3-hour cache — repeat plays start instantly.

**Stream-first likes & playlists**
- Liking or adding a search result no longer downloads it: entries carry a "stream" chip and play instantly, downloading only when you explicitly Save. Liked Songs counts everything, not just downloads.

## 1.1.0 — Studio update 🎛️

**Audio effects (FX button in the player bar)**
- Slowed + reverb, Nightcore, and Normal presets, plus manual speed (50–150%), pitch-keep toggle, and reverb depth. Settings persist across launches.
- Reverb runs on a generated hall impulse — no downloads. Network streams can use speed/pitch; reverb unlocks on local/downloaded files (shown in the panel).

**Lossless, labeled**
- The player bar now shows a codec tag when ffprobe is available: `FLAC · 96 kHz · 24-bit`, `MP3 · 320 kbps`, `OPUS`, … FLAC/WAV/OPUS/ALAC all play natively.

**Mini-player**
- New always-on-top widget (⤢ button in the player bar): art, title, transport controls, seekable progress. The main window keeps playing underneath.

**Lyrics**
- Full-screen lyrics over blurred album art (♪ button). Sidecar `.lrc` next to local files wins; otherwise auto-matched and cached. Synced lines highlight and follow playback.

**Waveform seek bar**
- The progress bar is now a real waveform, computed once per track in the background and cached. Falls back to the classic bar until peaks land.

## 1.0.0 — Official release 🎉

**One account, everywhere**
- Sign in with email (or username) + password — the same login works on all your computers. Friends and chat follow you; downloaded music and local files stay per-device.
- The app connects automatically on launch. No more Connect/Disconnect buttons.
- Your status, your choice: Online, Do not disturb (silences popups, calls still ring), or Invisible — auto-detected when you go offline.

**Notifications that actually arrive**
- Desktop popups for messages, calls and party invites now fire even while you're inside the app (unless you're staring at that exact chat).
- New: the bell is a real notification center — downloads with live %, unread messages that jump into the chat, party invites with one-click Join.
- New: "Send a test notification" in Settings → Notifications to prove the OS path works.

**Calls you can hear**
- Outgoing ring-back and incoming ringtone, synthesized in-app — no more silent calls.

**Photos in chat**
- Send photos (max 5 MB). They auto-delete from the server after 3 days — unless you right-click → Pin to keep one forever (unpin re-arms the timer). Right-click → Save image… downloads to your PC. Click any photo for a full viewer.

**Right-click everything**
- Context menus across Friends, chats, playlists, tracks, search results and downloads: rename, delete, copy, share, invite, pin and more.

**Faster, lighter**
- Unbounded artwork memory caches are now capped, chat photos lazy-load, and background polling is trimmed for low-spec PCs.

**Updates, in-app**
- Update checks, progress bar and one-click "Update now" all live in Settings → Updates. Nothing opens in a browser anymore.
