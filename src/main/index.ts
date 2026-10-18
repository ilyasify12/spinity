import { app, BrowserWindow, protocol, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { autoUpdater } from 'electron-updater'
import { createArtworkLoader } from './artwork'
import { createCoverLookup } from './coverArt'
import { initArtworkWarmer, warmArtwork } from './artworkWarm'
import { migrateLyricsCache } from './lyrics'
import { IPC } from '../shared/ipc'
import { artworkTrackId } from '../shared/thumbs'
import { db } from './db'
import { getSocialAccount } from './social'
import { applyLoginItem } from './startup'
import { shutdownPresence } from './presence'
import { initNotifier, notifyForSocialEvent } from './notify'
import { initMini, closeMiniWindow } from './mini'
import { registerIpc, restoreSession, setBroadcast, filePathForTrack, trackForId, wireDownloads, currentUserSnapshot } from './ipc'
import { stopPhoneServer } from './phoneServer'
import { initStreamCache, getStreamCache, type StreamSession } from './streamCache'
import { streamUrlFrom } from '../shared/streamUrl'

/**
 * A privileged custom scheme is registered BEFORE app ready.
 *
 * Why not a plain `file://` src on the <audio> element: the renderer is served
 * over http in dev, and browsers block http pages from reading file:// URLs.
 * The usual "fix" is `webSecurity: false`, which disables the same-origin
 * policy for the entire app — far too blunt.
 *
 * Registering `spinity://` instead keeps webSecurity ON while letting the
 * renderer stream a single track by id. `stream: true` is what enables HTTP
 * Range requests, and Range support is what makes seeking work in <audio>.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'spinity',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** Sniff an image's real type, so the response Content-Type is truthful. */
function imageMime(image: Uint8Array): string {
  if (image[0] === 0xff && image[1] === 0xd8) return 'image/jpeg' // JPEG SOI
  if (image[0] === 0x89 && image[1] === 0x50) return 'image/png' // \x89PNG
  if (
    image[0] === 0x52 && image[1] === 0x49 && image[2] === 0x46 && image[3] === 0x46 &&
    image[8] === 0x57 && image[9] === 0x45 && image[10] === 0x42 && image[11] === 0x50
  ) {
    return 'image/webp' // RIFF....WEBP
  }
  return 'image/jpeg'
}

/**
 * Locate logo.png for the UI.
 * Dev/ready copy: sits next to the app. Packaged: copied by
 * `extraResources` into the resources directory.
 */
function resolveLogoPath(): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'logo.png') : '',
    path.join(app.getAppPath(), 'logo.png'),
    path.join(app.getAppPath(), 'build', 'logo.png')
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0b0f',
    title: 'Spinity',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'build', 'icon.png'),
    autoHideMenuBar: true,
    // Frameless: the renderer draws its own top bar (logo drag region,
    // search, window controls). Native Alt+F4 / snapping still work.
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload is bundled by electron-vite and only uses contextBridge +
      // ipcRenderer. contextIsolation is the security boundary that matters.
      sandbox: false
    }
  })

  // Avoid a white flash on launch.
  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Tell the custom top bar when maximize state changes (Win+arrows, drag
  // to top, taskbar). The renderer swaps maximize/restore glyphs on this.
  mainWindow.on('maximize', () => mainWindow?.webContents.send('evt:maximize-changed', { maximized: true }))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('evt:maximize-changed', { maximized: false }))

  // Never let the app itself become a browser: hand external links to the OS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    // Windows silently drops any toast whose AppUserModelID has no Start Menu
    // shortcut behind it. electron-builder writes `appId` into the installed
    // shortcuts, so the packaged app claims `com.spinity.app`; in dev there is
    // no shortcut for that id, so use the exe path — the exact value Electron's
    // dev bootstrap expects (pin electron.exe to the Start Menu once).
    app.setAppUserModelId(app.isPackaged ? 'com.spinity.app' : process.execPath)
  }
  // spinity://audio/<trackId> -> the signed-in user's file for that track.
  let logoPath: string | null = null
  const localArtwork = createArtworkLoader(path.join(app.getPath('userData'), 'artwork-cache-v3'))
  // Thumbnails borrowed from YouTube for local files with no embedded cover.
  const coverFallback = createCoverLookup(path.join(app.getPath('userData'), 'cover-cache-v2'))

  // Preview / free-catalogue audio cache (write-through, LRU). Driven by
  // the renderer's spinity://stream/ requests; the host allowlist keeps the
  // scheme from ever acting as a generic fetch proxy.
  initStreamCache({
    dir: path.join(app.getPath('userData'), 'stream-cache-v1'),
    hostFilter: (hostname) =>
      /(^|\.)dzcdn\.net$/i.test(hostname) ||
      /(^|\.)mzstatic\.com$/i.test(hostname) ||
      /(^|\.)itunes\.apple\.com$/i.test(hostname) ||
      /(^|\.)archive\.org$/i.test(hostname) ||
      /(^|\.)somafm\.com$/i.test(hostname)
  })

  /**
   * Artwork responses already resolved for this session, keyed by track id.
   *
   * Two wins over extracting on every request: a repeat tile costs one `stat`
   * instead of an ffprobe/ffmpeg round trip, and — because the response now
   * carries an ETag and a real `max-age` — Chromium serves it from its own
   * cache without touching the main process at all.
   */
  const artworkMemo = new Map<string, { tag: string; body: Uint8Array; type: string; stamp: string }>()
  const MAX_ARTWORK_MEMO = 400
  /** Long enough that navigating around never re-requests, short enough to self-heal. */
  const ARTWORK_CACHE = 'private, max-age=600'

  function rememberArtwork(
    id: string,
    entry: { tag: string; body: Uint8Array; type: string; stamp: string }
  ): Response {
    artworkMemo.delete(id)
    artworkMemo.set(id, entry)
    while (artworkMemo.size > MAX_ARTWORK_MEMO) {
      const oldest = artworkMemo.keys().next().value
      if (oldest === undefined) break
      artworkMemo.delete(oldest)
    }
    return new Response(entry.body, {
      headers: { 'Content-Type': entry.type, 'Cache-Control': ARTWORK_CACHE, ETag: entry.tag }
    })
  }

  /** File revision the memo was built from; changes when the audio file does. */
  function fileStamp(stat: fs.Stats): string {
    return `${stat.size}-${Math.round(stat.mtimeMs)}`
  }

  /** Tell the renderer a borrowed cover landed so its tile can ask again. */
  function notifyArtworkReady(trackId: string): void {
    try {
      mainWindow?.webContents.send(IPC.evtArtworkReady, { trackId })
    } catch {}
  }

  initArtworkWarmer({
    localArtwork,
    cover: coverFallback,
    onCover: notifyArtworkReady
  })

  protocol.handle('spinity', async (request) => {
    try {
      const url = new URL(request.url)

      // App logo, so the renderer can display it without file:// access.
      if (url.hostname === 'logo') {
        if (!logoPath) logoPath = resolveLogoPath()
        if (!logoPath) return new Response('No logo', { status: 404 })
        return new Response(
          Readable.toWeb(fs.createReadStream(logoPath)) as unknown as ReadableStream,
          { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }
        )
      }

      if (url.hostname === 'artwork') {
        const id = artworkTrackId(url.href)
        if (!id) return new Response(null, { status: 404 })
        const file = filePathForTrack(id)
        if (!file) return new Response(null, { status: 404 })

        const stat = await fs.promises.stat(file).catch(() => null)
        if (!stat?.isFile()) return new Response(null, { status: 404 })
        const stamp = fileStamp(stat)

        const memo = artworkMemo.get(id)
        if (memo && memo.stamp === stamp) {
          // Served from memory: no ffprobe, no ffmpeg, no yt-dlp. The ETag lets
          // the renderer cache treat it as fresh once max-age lapses.
          return new Response(memo.body, {
            headers: { 'Content-Type': memo.type, 'Cache-Control': ARTWORK_CACHE, ETag: memo.tag }
          })
        }

        const art = await localArtwork(file)
        if (art.image) {
          const body = new Uint8Array(art.image)
          return rememberArtwork(id, {
            tag: `"e-${stamp}"`,
            body,
            type: imageMime(art.image),
            stamp
          })
        }

        // The probe ran and this file carries no picture at all. Files ripped
        // from disk rarely carry one, so borrow the matching YouTube thumbnail
        // instead of leaving the tile blank. A meaningless name ("1",
        // "Track 03") yields null and keeps the default icon rather than
        // stamping an unrelated picture on the song.
        if (art.embedded === false) {
          const track = trackForId(id)
          if (track?.source === 'local') {
            const known = await coverFallback.ready(track.title, track.artist)
            if (known.state === 'hit') {
              const body = new Uint8Array(known.image)
              return rememberArtwork(id, {
                tag: `"c-${stamp}-${body.length}"`,
                body,
                type: imageMime(known.image),
                stamp
              })
            }
            // Never searched before: answer the tile NOW with a placeholder and
            // do the lookup in the background. Blocking here was what made a
            // folder of local files take tens of seconds to show covers — every
            // request queued behind two yt-dlp searches. The renderer refreshes
            // this one tile when evt:artwork-ready arrives.
            if (known.state === 'unknown') {
              void coverFallback
                .warm(track.title, track.artist)
                .then((cover) => {
                  if (cover) notifyArtworkReady(id)
                })
                .catch(() => {})
            }
          }
        }
        // Either the cover search is still running, or the probe could not run
        // at all (tools missing/unreachable file). Borrowing art on a guess is
        // what put wrong thumbnails on local files, so the tile shows the
        // placeholder instead. no-store: "I do not know yet" must never be
        // cached as "no artwork", or the tile would go stale forever.
        return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
      }

      // Profile picture uploaded in the top-bar profile menu.
      // spinity://avatar/<localUserId> -> that account's avatar file.
      if (url.hostname === 'avatar') {
        const userId = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const file = db.getAvatarPath(userId)
        if (!file || !fs.existsSync(file)) return new Response(null, { status: 404 })
        return new Response(
          Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream,
          { headers: { 'Content-Type': mimeFor(file), 'Cache-Control': 'no-store' } }
        )
      }

      // Chat image attachment: spinity://image/<imageId> -> authed server bytes.
      // Keeps the Authorization token in main (the renderer never sees it).
      if (url.hostname === 'image') {
        const imageId = decodeURIComponent(url.pathname.replace(/^\//, ''))
        if (!/^[a-f0-9]{24}$/i.test(imageId)) return new Response(null, { status: 404 })
        const acc = getSocialAccount() ?? (currentUserSnapshot() ? db.getServerAccount(currentUserSnapshot()!.id) : null)
        if (!acc) return new Response(null, { status: 401 })
        try {
          const res = await fetch(`${acc.serverUrl.replace(/\/$/, '')}/api/images/${imageId}`, {
            headers: { Authorization: `Bearer ${acc.token}` }
          })
          if (res.status === 410) return new Response(null, { status: 410 })
          if (!res.ok) return new Response(null, { status: res.status })
          const buf = Buffer.from(await res.arrayBuffer())
          return new Response(new Uint8Array(buf), {
            headers: {
              'Content-Type': res.headers.get('content-type') ?? 'image/png',
              'Cache-Control': 'private, max-age=3600'
            }
          })
        } catch (err) {
          console.error('[protocol] image fetch failed', err)
          return new Response(null, { status: 502 })
        }
      }

      // Cache-backed free audio (preview clips, Internet Archive items):
      // spinity://stream/?u=<encoded direct url>. The cache fetches once,
      // serves the growing file to this response, and persists it for
      // instant replays.
      if (url.hostname === 'stream') {
        const target = streamUrlFrom(request.url)
        if (!target) return new Response('Bad stream request', { status: 400 })
        const cache = getStreamCache()
        let session: StreamSession
        try {
          session = cache.open(target)
        } catch (err) {
          return new Response(err instanceof Error ? err.message : 'Stream refused', { status: 403 })
        }
        // Chromium opens with `bytes=0-`; a truthful range response needs the
        // Content-Length, so give the headers a short moment to arrive.
        await cache.waitForTotal(session.key, 2500)
        if (session.error) return new Response(`Stream failed: ${session.error}`, { status: 502 })

        const total = session.total
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
        let start = 0
        let end: number | null = total > 0 ? total - 1 : null
        let partial = false
        if (match && total > 0) {
          partial = true
          if (match[1] === '') {
            // bytes=-N means the final N bytes, not bytes 0 through N.
            const suffix = Number(match[2])
            start = suffix > 0 && Number.isSafeInteger(suffix) ? Math.max(0, total - suffix) : total
          } else {
            start = Number(match[1])
            if (match[2] !== '') end = Number(match[2])
          }
          if (!Number.isSafeInteger(start) || end === null || !Number.isSafeInteger(end) || start > end || start >= total) {
            return new Response('Range not satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${total}` }
            })
          }
        } else if (match) {
          // Total unknown yet: answer 200 and start at the requested offset.
          // (Later requests see the Content-Length and get real 206s.)
          start = Math.max(0, Number(match[1]) || 0)
        }
        if (end !== null && total > 0) end = Math.min(end, total - 1)

        const headers: Record<string, string> = {
          'Content-Type': session.contentType || 'audio/mpeg',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
        if (total > 0) {
          const last = end ?? total - 1
          headers['Accept-Ranges'] = 'bytes'
          headers['Content-Length'] = String(last - start + 1)
          if (partial) headers['Content-Range'] = `bytes ${start}-${last}/${total}`
        }
        return new Response(cache.read(session.key, start, total > 0 ? (end ?? total - 1) : null), {
          status: partial ? 206 : 200,
          headers
        })
      }

      if (url.hostname !== 'audio') {
        return new Response('Not found', { status: 404 })
      }

      const trackId = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const filePath = filePathForTrack(trackId)
      if (!filePath) {
        return new Response('Track not available', { status: 404 })
      }

      const stat = await fs.promises.stat(filePath).catch(() => null)
      if (!stat || !stat.isFile()) {
        return new Response('File missing', { status: 404 })
      }

      const total = stat.size
      if (total === 0) {
        return new Response(null, {
          status: 200,
          headers: { 'Content-Type': mimeFor(filePath), 'Content-Length': '0' }
        })
      }

      // Parse the Range header. Chromium sends `bytes=0-` when it starts
      // playing and `bytes=N-` every time the user seeks.
      const rangeHeader = request.headers.get('range')
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '')
      if (rangeHeader && (!match || (!match[1] && !match[2]))) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
      }
      let start = 0
      let end = total - 1
      let partial = false

      if (match) {
        partial = true
        if (match[1] === '') {
          // bytes=-N means the final N bytes, not bytes 0 through N.
          const suffix = Number(match[2])
          start = suffix > 0 && Number.isSafeInteger(suffix) ? Math.max(0, total - suffix) : total
        } else {
          start = Number(match[1])
          if (match[2] !== '') end = Number(match[2])
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= total
        ) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${total}` }
          })
        }
      }

      end = Math.min(end, total - 1)
      const headers: Record<string, string> = {
        'Content-Type': mimeFor(filePath),
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'no-store',
        // Lets the renderer's WebAudio graph (DSP/reverb) tap this audio.
        // Without it MediaElementSource outputs silence.
        'Access-Control-Allow-Origin': '*'
      }
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${total}`

      // Serve the requested byte range ourselves and answer 206 for ranges.
      // THIS is what makes seeking work: without a truthful 206 + Content-Range
      // response, Chromium cannot reposition inside a local file and the
      // position resets to zero.
      return new Response(
        Readable.toWeb(
          fs.createReadStream(filePath, { start, end })
        ) as unknown as ReadableStream,
        { status: partial ? 206 : 200, headers }
      )
    } catch (err) {
      console.error('[protocol] failed to serve', err)
      return new Response('Internal error', { status: 500 })
    }
  })

  registerIpc()
  // Reopen the last-used account before the renderer asks, so `auth:current`
  // already returns it on first query.
  const restored = restoreSession()
  if (restored) {
    console.log('[auth] restored session for', restored.username)
    // Re-warm artwork for the restored library at low priority, so opening the
    // app straight into a local folder does not pay extraction costs per tile.
    try {
      warmArtwork(db.getTracks(restored.id).filter((track) => track.source === 'local'))
    } catch {}
    // Retire lyrics matched by an older matcher (user uploads are kept).
    try {
      const retired = migrateLyricsCache()
      if (retired > 0) console.log('[lyrics] retired', retired, 'auto-fetched lyric entr(ies) for a re-match')
    } catch {}
  }
  setBroadcast((channel, payload) => {
    mainWindow?.webContents.send(channel, payload)
    // Desktop notifications for chat/calls/party invites, evaluated in main
    // so they fire even when the Friends page isn't mounted.
    if (channel === 'evt:social' && payload && typeof payload === 'object') {
      const evt = payload as { type?: string; payload?: unknown }
      if (typeof evt.type === 'string') notifyForSocialEvent(evt.type, evt.payload)
    }
  })
  initNotifier({
    getWindow: () => mainWindow,
    send: (channel, payload) => {
      mainWindow?.webContents.send(channel, payload)
    }
  })
  applyLoginItem()
  wireDownloads()
  createWindow()
  initMini(mainWindow)

  // Auto-updates via GitHub Releases (only in packaged builds)
  // Events are forwarded to renderer via evtUpdater so Settings can show Check for updates
  const updaterBroadcast = (payload: { type: string; data?: unknown }): void => {
    mainWindow?.webContents.send('evt:updater', payload)
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking...')
    updaterBroadcast({ type: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] available', info.version)
    updaterBroadcast({ type: 'available', data: { version: info.version } })
  })
  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] not-available', info.version)
    updaterBroadcast({ type: 'not-available', data: { version: info.version } })
  })
  autoUpdater.on('download-progress', (p) => {
    updaterBroadcast({ type: 'progress', data: { percent: p.percent, transferred: p.transferred, total: p.total } })
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded', info.version, '- will install on quit')
    updaterBroadcast({ type: 'downloaded', data: { version: info.version } })
  })
  autoUpdater.on('error', (err) => {
    console.error('[updater] error', err)
    updaterBroadcast({ type: 'error', data: { message: err?.message ?? String(err) } })
  })
  if (app.isPackaged) {
    setTimeout(() => {
      // Silent in-app check: progress + result flow to Settings via
      // evt:updater. Never the OS-level notifier — updates stay inside Spinity.
      void autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed', e))
    }, 3000)
  }

  // Allow getUserMedia for voice calls (renderer). Without this the mic is denied.
  const ses = mainWindow?.webContents.session ?? null
  if (ses) {
    ses.setPermissionCheckHandler((_wc, permission) => {
      if (permission === 'media' || permission === 'mediaKeySystem') return true
      return true
    })
    ses.setPermissionRequestHandler((_wc, permission, cb) => {
      if (permission === 'media' || permission === 'mediaKeySystem') cb(true)
      else cb(true)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Persist the debounced store before exiting.
  db.flush()
  shutdownPresence()
  closeMiniWindow()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  db.flush()
  shutdownPresence()
  closeMiniWindow()
  stopPhoneServer()
})
