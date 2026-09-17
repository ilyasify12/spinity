import { app, BrowserWindow, protocol, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { autoUpdater } from 'electron-updater'
import { createArtworkLoader } from './artwork'
import { db } from './db'
import { registerIpc, restoreSession, setBroadcast, filePathForTrack, wireDownloads } from './ipc'

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
  '.png': 'image/png'
}

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
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
  if (process.platform === 'win32') app.setAppUserModelId('com.spinity.app')
  // spinity://audio/<trackId> -> the signed-in user's file for that track.
  let logoPath: string | null = null
  const localArtwork = createArtworkLoader(path.join(app.getPath('userData'), 'artwork-cache-v2'))

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
        const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
        const file = filePathForTrack(id)
        if (!file) return new Response(null, { status: 404 })
        const image = await localArtwork(file)
        if (!image) return new Response(null, { status: 404 })
        const mime = image[0] === 0xff && image[1] === 0xd8 ? 'image/jpeg' : 'image/png'
        return new Response(new Uint8Array(image), {
          headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' }
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
        'Cache-Control': 'no-store'
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
  if (restored) console.log('[auth] restored session for', restored.username)
  setBroadcast((channel, payload) => {
    mainWindow?.webContents.send(channel, payload)
  })
  wireDownloads()
  createWindow()

  // Auto-updates via GitHub Releases (only in packaged builds)
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => console.log('[updater] checking...'))
    autoUpdater.on('update-available', (info) => console.log('[updater] available', info.version))
    autoUpdater.on('update-downloaded', (info) => console.log('[updater] downloaded', info.version, '- will install on quit'))
    autoUpdater.on('error', (err) => console.error('[updater] error', err))

    setTimeout(() => {
      void autoUpdater.checkForUpdatesAndNotify().catch((e) => console.error('[updater] check failed', e))
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
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  db.flush()
})
