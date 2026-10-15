/* Spinity web player (testing) — pure Node, zero dependencies.
 *
 * Serves a mobile-first player UI plus a tiny API over YOUR local library:
 *   GET /                     -> landing page
 *   GET /player/              -> player UI (PWA: manifest + service worker)
 *   GET /api/library          -> { tracks, playlists } (no file paths leaked)
 *   GET /api/stream?id=...    -> audio bytes with Range support (seek works)
 *   GET /api/download?id=...  -> same bytes as an attachment (save to phone)
 *   GET /api/lyrics?id=...    -> synced/plain lyrics (lrclib, cached)
 *
 * Run:  node website/web-server.cjs [port]
 * Open: http://localhost:8901 — phone on the same Wi-Fi: http://<pc-ip>:8901/player
 */
const http = require('node:http')
const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const os = require('node:os')
const { URL } = require('node:url')
const { spawn } = require('node:child_process')

const PORT = Number(process.argv[2]) || 8901
const HERE = __dirname

const MIME = {
  '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus',
  '.flac': 'audio/flac', '.wav': 'audio/wav', '.mka': 'audio/x-matroska',
  '.webm': 'audio/webm'
}

/** Load the desktop app's library; map track id -> absolute file (validated). */
function loadLibrary() {
  const byId = new Map()
  const pub = []
  const playlists = []
  const storePath = path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'spinity.json')
  let db = null
  try {
    db = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  } catch {
    return { byId, pub, playlists }
  }
  const artFor = (t) => {
    if (t.thumbnail && !t.thumbnail.startsWith('spinity:')) return t.thumbnail
    // Local artwork lives behind spinity:// in the desktop app — serve it here.
    return `/api/art?id=${encodeURIComponent(t.id)}`
  }
  const addTrack = (t) => {
    if (!t || !t.id || !t.filePath || byId.has(t.id)) return
    let stat = null
    try {
      stat = fs.statSync(t.filePath)
      if (!stat.isFile() || stat.size === 0) return
    } catch { return }
    byId.set(t.id, { file: t.filePath, size: stat.size })
    pub.push({
      id: t.id, title: t.title || 'Untitled', artist: t.artist || 'Unknown artist',
      durationSec: t.durationSec || 0, source: t.source || 'youtube',
      thumbnail: artFor(t)
    })
  }
  for (const d of Object.values(db.data || {})) {
    for (const t of d.tracks || []) addTrack(t)
    for (const p of d.playlists || []) {
      if (p && p.id) playlists.push({ id: p.id, name: p.name || 'Playlist', trackIds: p.trackIds || [] })
    }
  }
  // Web-saved songs live in a sidecar (never touch the desktop DB file —
  // the desktop app caches it in memory and would overwrite our edits).
  try {
    const side = JSON.parse(fs.readFileSync(WEB_DL_JSON, 'utf8'))
    for (const t of (side.tracks || [])) addTrack(t)
  } catch {}
  return { byId, pub, playlists }
}

let lib = loadLibrary()
// Re-scan every 60s so newly downloaded songs appear without a restart.
setInterval(() => { lib = loadLibrary() }, 60_000).unref()

// Codec labels keyed by file identity (id|size|mtime) — one ffmpeg spawn per file.
const probeCache = new Map()

// Lyrics: network lookups are slow — cache per track id in memory + a sidecar.
const lyricsCache = new Map()
const LYRICS_JSON = path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'web-lyrics.json')
try {
  const j = JSON.parse(fs.readFileSync(LYRICS_JSON, 'utf8'))
  for (const [k, v] of Object.entries(j)) if (v && typeof v === 'object') lyricsCache.set(k, v)
} catch {}
function persistLyrics() {
  try {
    const o = {}
    for (const [k, v] of lyricsCache) o[k] = v
    const tmp = `${LYRICS_JSON}.tmp`
    fs.mkdirSync(path.dirname(LYRICS_JSON), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(o))
    fs.renameSync(tmp, LYRICS_JSON)
  } catch {}
}

// lrclib throttles bursts (HTTP 429) — serialize lookups, ~1.1s apart.
let lrclibChain = Promise.resolve()
let lrclibLast = 0
function lrclibFetch(url) {
  const run = lrclibChain.then(async () => {
    const wait = Math.max(0, lrclibLast + 1100 - Date.now())
    if (wait) await new Promise((r) => setTimeout(r, wait))
    lrclibLast = Date.now()
    return fetch(url, { headers: { 'User-Agent': 'Spinity web player (+https://github.com/ilyasify12/spinity)' } })
  })
  lrclibChain = run.then(() => {}, () => {})
  return run
}
async function lrclibRetry429(fn) {
  let r = await fn()
  for (const wait of [2600, 8000]) {
    if (r.status !== 429) break
    await new Promise((res) => setTimeout(res, wait))
    r = await fn()
  }
  if (r.status === 429 || r.status >= 500) throw new Error('lrclib unavailable (HTTP ' + r.status + ')')
  return r
}
// Library titles are YouTube-shaped ("Artist - Song (Lyrics)", "Artist - Song - Channel").
// Build the most likely lrclib query from those patterns.
function lyricQueryParts(meta) {
  const strip = (s) => String(s || '')
    .replace(/[\(\[][^\)\]]*[\)\]]/g, ' ')
    .replace(/\b(official|lyrics?|video|audio|visualizer|hd|hq|4k|remaster(ed)?)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const parts = String(meta.title || '').split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean)
  const rawArtist = String(meta.artist || '').trim()
  const artistOk = rawArtist && rawArtist.length > 2 && !/^\d+$/.test(rawArtist)
  if (parts.length >= 2) return { name: strip(parts[1]), artist: strip(parts[0]) }
  return { name: strip(meta.title), artist: strip(artistOk ? rawArtist : '') }
}
async function lrclibLookup(meta) {
  const q = lyricQueryParts(meta)
  const attempts = []
  if (q.name && q.artist) attempts.push({ track_name: q.name, artist_name: q.artist })
  attempts.push({ track_name: String(meta.title || ''), artist_name: String(meta.artist || '') })
  for (const a of attempts) {
    const r = await lrclibRetry429(() => lrclibFetch('https://lrclib.net/api/get?' + new URLSearchParams(a).toString()))
    if (r.ok) {
      const j = await r.json()
      if (j && (j.syncedLyrics || j.plainLyrics)) {
        return { id: meta.id, synced: j.syncedLyrics || null, plain: j.plainLyrics || null, source: 'lrclib' }
      }
    } else if (r.status !== 404) {
      throw new Error('lrclib get failed (HTTP ' + r.status + ')')
    }
  }
  // Fuzzy fallback: search, then score (synced > plain > duration-proximity).
  const s = new URLSearchParams({ q: `${q.name || meta.title || ''} ${q.artist || meta.artist || ''}`.trim() })
  const r2 = await lrclibRetry429(() => lrclibFetch('https://lrclib.net/api/search?' + s.toString()))
  const arr = r2.ok ? await r2.json() : []
  if (!Array.isArray(arr) || !arr.length) return null
  const dur = Number(meta.durationSec) || 0
  const best = arr
    .map((x) => ({ x, score: (x.syncedLyrics ? 100 : 0) + (x.plainLyrics ? 10 : 0) - (dur && x.duration ? Math.abs(x.duration - dur) : 0) }))
    .sort((a, b) => b.score - a.score)[0].x
  return { id: meta.id, synced: best.syncedLyrics || null, plain: best.plainLyrics || null, source: 'lrclib' }
}

// ---------------- Accounts (login like the app) ----------------
// Web-only accounts live in a sidecar. Desktop accounts (same PC) are also
// accepted — passwords verified read-only against the desktop store, never
// written. Likes/playlists are per web session, stored in the sidecar.

const SPINITY_JSON = path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'spinity.json')
const WEB_USERS_JSON = path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'web-users.json')

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2))
  fs.renameSync(tmp, file)
}
function webUsers() { return readJson(WEB_USERS_JSON, { users: {}, tokens: {} }) }

function verifyScrypt(password, stored) {
  try {
    const parts = String(stored).split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const derived = crypto.scryptSync(password, Buffer.from(parts[4], 'hex'), Buffer.from(parts[5], 'hex').length, {
      N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3])
    })
    return crypto.timingSafeEqual(derived, Buffer.from(parts[5], 'hex'))
  } catch { return false }
}
function hashScrypt(password) {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`
}

/** Find a desktop account by username or email (read-only). */
function findDesktopAccount(login) {
  const db = readJson(SPINITY_JSON, null)
  if (!db || !Array.isArray(db.users)) return null
  const needle = String(login || '').toLowerCase()
  return db.users.find((u) =>
    (u.username && u.username.toLowerCase() === needle) ||
    (u.email && u.email.toLowerCase() === needle)) || null
}

function ensureWebUser(store, key) {
  if (!store.users[key]) store.users[key] = { displayName: key, pass: null, likedIds: [], playlists: [] }
  const u = store.users[key]
  if (!Array.isArray(u.likedIds)) u.likedIds = []
  if (!Array.isArray(u.playlists)) u.playlists = []
  return u
}

function sessionUser(req) {
  const h = req.headers.authorization || ''
  const m = /^Bearer (.+)$/.exec(h)
  if (!m) return null
  const store = webUsers()
  const key = store.tokens[m[1]]
  if (!key) return null
  const user = ensureWebUser(store, key)
  return { key, user, store }
}

function publicUser(key, user) {
  return { id: key, name: user.displayName || key, source: key.startsWith('desk:') ? 'desktop' : 'web' }
}

// ---------------- YouTube search + save (new songs) ----------------

const WEB_DL_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'web-downloads')
const WEB_DL_JSON = path.join(WEB_DL_DIR, 'web-downloads.json')
const saving = new Set()

function findYtDlp() {
  const cands = [
    process.env.SPINITY_YTDLP,
    path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'tools', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe')
  ].filter(Boolean)
  try {
    const pyRoot = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python')
    for (const e of fs.readdirSync(pyRoot)) {
      cands.push(path.join(pyRoot, e, 'Scripts', 'yt-dlp.exe'))
    }
  } catch {}
  return cands.find((p) => { try { return fs.statSync(p).isFile() } catch { return false } }) || null
}

function runBin(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { try { child.kill() } catch {} reject(new Error('timed out')) }, timeoutMs)
    child.stdout.on('data', (d) => { if (stdout.length < 2e6) stdout += d.toString() })
    child.stderr.on('data', (d) => { if (stderr.length < 2e6) stderr += d.toString() })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

function runBinBuffer(bin, args, timeoutMs, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true })
    const chunks = []
    let size = 0
    const timer = setTimeout(() => { try { child.kill() } catch {} reject(new Error('timed out')) }, timeoutMs)
    child.stdout.on('data', (d) => { if (size < maxBytes) { chunks.push(d); size += d.length } })
    child.stderr.on('data', () => {})
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: Buffer.concat(chunks) }) })
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (d) => { s += d.toString(); if (s.length > 1e6) req.destroy() })
    req.on('end', () => resolve(s))
    req.on('error', reject)
  })
}

function saveSidecar(track) {
  let side = { tracks: [] }
  try { side = JSON.parse(fs.readFileSync(WEB_DL_JSON, 'utf8')) } catch {}
  side.tracks = (side.tracks || []).filter((t) => t.id !== track.id)
  side.tracks.push(track)
  fs.mkdirSync(WEB_DL_DIR, { recursive: true })
  const tmp = `${WEB_DL_JSON}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(side, null, 2))
  fs.renameSync(tmp, WEB_DL_JSON)
}

function send(res, code, headers, body) {
  res.writeHead(code, headers)
  res.end(body)
}

/** Locate an ffmpeg binary (same search order the artwork extractor uses). */
function findFfmpeg() {
  return [
    process.env.SPINITY_FFMPEG,
    path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'tools', 'ffmpeg.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'
  ].filter(Boolean).find((p) => { try { return fs.statSync(p).isFile() } catch { return false } }) || null
}

function serveFile(filePath, fallbackType) {
  try {
    const data = fs.readFileSync(filePath)
    return { data, type: fallbackType }
  } catch {
    return null
  }
}

const server = http.createServer(async (req, res) => {
  let u = null
  try {
    u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  } catch {
    return send(res, 400, {}, 'bad request')
  }

  // ---- UI: landing page + web player ----
  if (u.pathname === '/' || u.pathname === '/index.html') {
    const hit = serveFile(path.join(HERE, 'index.html'), 'text/html; charset=utf-8')
    if (!hit) return send(res, 500, {}, 'landing page missing')
    return send(res, 200, { 'Content-Type': hit.type, 'Cache-Control': 'no-store' }, hit.data)
  }
  if (u.pathname === '/player' || u.pathname === '/player/') {
    const hit = serveFile(path.join(HERE, 'player', 'index.html'), 'text/html; charset=utf-8')
    if (!hit) return send(res, 500, {}, 'player UI missing')
    return send(res, 200, { 'Content-Type': hit.type, 'Cache-Control': 'no-store' }, hit.data)
  }

  // ---- PWA assets: manifest, service worker, icons ----
  if (u.pathname === '/player/manifest.webmanifest') {
    const hit = serveFile(path.join(HERE, 'player', 'manifest.webmanifest'), 'application/manifest+json; charset=utf-8')
    return hit ? send(res, 200, { 'Content-Type': hit.type, 'Cache-Control': 'no-cache' }, hit.data) : send(res, 404, {}, 'missing')
  }
  if (u.pathname === '/player/sw.js') {
    const hit = serveFile(path.join(HERE, 'player', 'sw.js'), 'text/javascript; charset=utf-8')
    return hit ? send(res, 200, { 'Content-Type': hit.type, 'Cache-Control': 'no-cache' }, hit.data) : send(res, 404, {}, 'missing')
  }
  const iconHit = /^\/player\/icons\/([A-Za-z0-9._-]+\.png)$/.exec(u.pathname)
  if (iconHit) {
    const hit = serveFile(path.join(HERE, 'player', 'icons', iconHit[1]), 'image/png')
    return hit ? send(res, 200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=86400' }, hit.data) : send(res, 404, {}, 'missing')
  }

  // ---- API: library ----
  if (u.pathname === '/api/library') {
    const body = JSON.stringify({ tracks: lib.pub, playlists: lib.playlists })
    return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body)
  }

  // ---- API: auth ----
  if (u.pathname === '/api/auth/register' && req.method === 'POST') {
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch {}
    const username = String((body && body.username) || '').trim()
    const password = String((body && body.password) || '')
    if (!/^[a-z0-9_.-]{3,24}$/i.test(username)) return send(res, 400, {}, 'username: 3-24 chars, letters/numbers/._-')
    if (password.length < 6) return send(res, 400, {}, 'password: min 6 chars')
    const store = webUsers()
    const key = 'web:' + username.toLowerCase()
    if (store.users[key] || findDesktopAccount(username)) return send(res, 409, {}, 'name taken')
    store.users[key] = {
      displayName: String((body && body.displayName) || username).trim() || username,
      pass: hashScrypt(password), likedIds: [], playlists: []
    }
    const token = crypto.randomUUID()
    store.tokens[token] = key
    writeJsonAtomic(WEB_USERS_JSON, store)
    return send(res, 200, { 'Content-Type': 'application/json' },
      JSON.stringify({ token, user: publicUser(key, store.users[key]) }))
  }

  if (u.pathname === '/api/auth/login' && req.method === 'POST') {
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch {}
    const login = String((body && body.login) || '').trim()
    const password = String((body && body.password) || '')
    if (!login || !password) return send(res, 400, {}, 'missing credentials')
    const store = webUsers()
    // 1. web account
    const wkey = 'web:' + login.toLowerCase()
    if (store.users[wkey] && store.users[wkey].pass && verifyScrypt(password, store.users[wkey].pass)) {
      const token = crypto.randomUUID()
      store.tokens[token] = wkey
      writeJsonAtomic(WEB_USERS_JSON, store)
      return send(res, 200, { 'Content-Type': 'application/json' },
        JSON.stringify({ token, user: publicUser(wkey, store.users[wkey]) }))
    }
    // 2. desktop account on this PC (same login as the app)
    const desk = findDesktopAccount(login)
    if (desk && desk.passwordHash && verifyScrypt(password, desk.passwordHash)) {
      const key = 'desk:' + desk.id
      ensureWebUser(store, key).displayName = desk.displayName || desk.username || login
      const token = crypto.randomUUID()
      store.tokens[token] = key
      writeJsonAtomic(WEB_USERS_JSON, store)
      return send(res, 200, { 'Content-Type': 'application/json' },
        JSON.stringify({ token, user: publicUser(key, store.users[key]) }))
    }
    return send(res, 401, {}, 'wrong login or password')
  }

  if (u.pathname === '/api/auth/logout' && req.method === 'POST') {
    const h = req.headers.authorization || ''
    const m = /^Bearer (.+)$/.exec(h)
    if (m) {
      const store = webUsers()
      delete store.tokens[m[1]]
      writeJsonAtomic(WEB_USERS_JSON, store)
    }
    return send(res, 200, { 'Content-Type': 'application/json' }, '{}')
  }

  // ---- API: me (profile + likes + playlists) ----
  if (u.pathname === '/api/me' && req.method === 'GET') {
    const s = sessionUser(req)
    if (!s) return send(res, 401, {}, 'login required')
    return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      JSON.stringify({ user: publicUser(s.key, s.user), likedIds: s.user.likedIds, playlists: s.user.playlists }))
  }

  // ---- API: like/unlike ----
  if (u.pathname === '/api/like' && req.method === 'POST') {
    const s = sessionUser(req)
    if (!s) return send(res, 401, {}, 'login required')
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch {}
    const id = String((body && body.id) || '')
    if (!lib.byId.has(id)) return send(res, 404, {}, 'unknown track')
    const set = new Set(s.user.likedIds)
    if (body && body.like === false) set.delete(id)
    else set.add(id)
    s.user.likedIds = [...set]
    writeJsonAtomic(WEB_USERS_JSON, s.store)
    return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ likedIds: s.user.likedIds }))
  }

  // ---- API: playlists ----
  if (u.pathname === '/api/playlists' && req.method === 'POST') {
    const s = sessionUser(req)
    if (!s) return send(res, 401, {}, 'login required')
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch {}
    const name = String((body && body.name) || '').trim().slice(0, 60)
    if (!name) return send(res, 400, {}, 'name required')
    const pl = { id: crypto.randomUUID(), name, trackIds: [] }
    s.user.playlists.push(pl)
    writeJsonAtomic(WEB_USERS_JSON, s.store)
    return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(pl))
  }

  const plMatch = /^\/api\/playlists\/([^/]+)(\/tracks(?:\/([^/]+))?)?$/.exec(u.pathname)
  if (plMatch) {
    const s = sessionUser(req)
    if (!s) return send(res, 401, {}, 'login required')
    const pl = s.user.playlists.find((p) => p.id === plMatch[1])
    if (!pl) return send(res, 404, {}, 'no playlist')
    if (req.method === 'DELETE' && !plMatch[2]) {
      s.user.playlists = s.user.playlists.filter((p) => p.id !== pl.id)
      writeJsonAtomic(WEB_USERS_JSON, s.store)
      return send(res, 200, { 'Content-Type': 'application/json' }, '{}')
    }
    if (req.method === 'POST' && plMatch[2] === '/tracks') {
      let body = null
      try { body = JSON.parse(await readBody(req)) } catch {}
      const tid = String((body && body.trackId) || '')
      if (!lib.byId.has(tid)) return send(res, 404, {}, 'unknown track')
      if (!pl.trackIds.includes(tid)) pl.trackIds.push(tid)
      writeJsonAtomic(WEB_USERS_JSON, s.store)
      return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(pl))
    }
    if (req.method === 'DELETE' && plMatch[3]) {
      pl.trackIds = pl.trackIds.filter((t) => t !== plMatch[3])
      writeJsonAtomic(WEB_USERS_JSON, s.store)
      return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(pl))
    }
    return send(res, 405, {}, 'method not allowed')
  }

  // ---- API: YouTube search (find NEW songs) ----
  if (u.pathname === '/api/ytsearch' && req.method === 'GET') {
    const q = (u.searchParams.get('q') || '').trim()
    if (!q) return send(res, 400, {}, 'missing q')
    const binPath = findYtDlp()
    if (!binPath) return send(res, 503, {}, 'yt-dlp not found on this PC')
    try {
      const r = await runBin(binPath, [
        '--dump-single-json', '--flat-playlist', '--no-warnings',
        '--ignore-errors', '--socket-timeout', '10', `ytsearch10:${q}`
      ], 60_000)
      const parsed = JSON.parse(r.stdout)
      const out = (parsed.entries || []).filter((e) => e && e.id).map((e) => ({
        id: e.id,
        title: e.title || 'Untitled',
        artist: e.uploader || e.channel || 'Unknown artist',
        durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : 0,
        thumbnail: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
        webUrl: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`
      }))
      return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify(out))
    } catch (e) {
      return send(res, 502, {}, `search failed: ${e.message}`)
    }
  }

  // ---- API: save a YouTube result into the web library (downloads it) ----
  if (u.pathname === '/api/save' && req.method === 'POST') {
    let meta = null
    try { meta = JSON.parse(await readBody(req)) } catch {}
    if (!meta || !meta.id || !/^[A-Za-z0-9_-]{6,20}$/.test(meta.id)) {
      return send(res, 400, {}, 'bad track')
    }
    if (lib.byId.has(meta.id)) {
      return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ saved: true }))
    }
    if (saving.has(meta.id)) {
      return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ saving: true }))
    }
    const binPath = findYtDlp()
    if (!binPath) return send(res, 503, {}, 'yt-dlp not found on this PC')
    saving.add(meta.id)
    send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ saving: true }));
    (async () => {
      try {
        fs.mkdirSync(WEB_DL_DIR, { recursive: true })
        const r = await runBin(binPath, [
          '-x', '--audio-format', 'm4a', '--audio-quality', '0',
          '--no-playlist', '--no-warnings', '--retries', '3',
          '--socket-timeout', '20',
          '-o', path.join(WEB_DL_DIR, '%(id)s.%(ext)s'),
          meta.webUrl || `https://www.youtube.com/watch?v=${meta.id}`
        ], 300_000)
        if (r.code !== 0) throw new Error('yt-dlp failed')
        const files = fs.readdirSync(WEB_DL_DIR).filter((f) => f.startsWith(meta.id + '.'))
        if (!files.length) throw new Error('no file produced')
        const file = path.join(WEB_DL_DIR, files[0])
        saveSidecar({
          id: meta.id, title: meta.title || 'Untitled', artist: meta.artist || 'Unknown artist',
          durationSec: meta.durationSec || 0, source: 'youtube',
          thumbnail: meta.thumbnail || null, filePath: file
        })
        lib = loadLibrary()
      } catch (e) {
        console.error('[web] save failed', meta.id, e.message)
      } finally {
        saving.delete(meta.id)
      }
    })()
    return
  }

  // ---- API: codec tag for the now-playing bar (ffmpeg header parse, cached) ----
  // Mirrors the desktop app's ffprobe label: "MP3 · 44.1 kHz · 320 kbps".
  if (u.pathname === '/api/probe' && req.method === 'GET') {
    const id = u.searchParams.get('id') || ''
    const entry = lib.byId.get(id)
    if (!entry) return send(res, 404, {}, 'unknown track')
    let stat = null
    try {
      stat = fs.statSync(entry.file)
      if (!stat.isFile()) throw new Error('gone')
    } catch {
      return send(res, 410, {}, 'file gone')
    }
    const json = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    const key = `${id}|${stat.size}|${stat.mtimeMs}`
    if (probeCache.has(key)) return send(res, 200, json, JSON.stringify(probeCache.get(key)))
    const ff = findFfmpeg()
    if (!ff) return send(res, 404, {}, 'no ffmpeg')
    let out = { label: null, title: '' }
    try {
      const r = await runBin(ff, ['-hide_banner', '-i', entry.file], 8000)
      const line = r.stderr.split('\n').find((l) => l.includes('Audio:')) || ''
      const codec = ((/Audio:\s*([A-Za-z0-9_]+)/.exec(line) || [])[1] || '').trim()
      if (codec) {
        const sr = Number((/(\d+)\s*Hz/.exec(line) || [])[1] || 0)
        const chStr = ((/Hz,\s*([^,]+)/.exec(line) || [])[1] || '').trim()
        const fmt = ((/Hz,\s*[^,]+,\s*([a-z0-9_]+)/.exec(line) || [])[1] || '')
        const bits = Number((/\((\d+)\s*bit\)/.exec(line) || [])[1] || 0) ||
          ({ s8: 8, u8: 8, s16: 16, u16: 16, s32: 32, u32: 32, s64: 64 }[fmt] || 0)
        const kb = Number((/(\d+)\s*kb\/s/.exec(line) || [])[1] || 0)
        const CH = { mono: 1, stereo: 2, quad: 4, '2.1': 3, '3.1': 4, '5.1': 6, '5.1(side)': 6, '7.1': 8 }
        const channels = CH[chStr] || 0
        const parts = [codec.toUpperCase()]
        const khz = sr / 1000
        if (sr > 0) parts.push((Number.isInteger(khz) ? khz : khz.toFixed(1)) + ' kHz')
        if (bits > 0) parts.push(bits + '-bit')
        else if (kb > 0) parts.push(kb + ' kbps')
        const label = parts.join(' · ')
        out = { label, title: [label, channels > 0 ? channels + 'ch' : ''].filter(Boolean).join(' · ') }
      }
    } catch { /* leave label null — bar just shows no tag */ }
    probeCache.set(key, out)
    return send(res, 200, json, JSON.stringify(out))
  }

  // ---- API: local artwork (embedded covers via ffmpeg, cached) ----
  if (u.pathname === '/api/art' && req.method === 'GET') {
    const id = u.searchParams.get('id') || ''
    const entry = lib.byId.get(id)
    if (!entry) return send(res, 404, {}, 'unknown track')
    let stat = null
    try {
      stat = fs.statSync(entry.file)
      if (!stat.isFile()) throw new Error('gone')
    } catch {
      return send(res, 410, {}, 'file gone')
    }
    const artDir = path.join(os.homedir(), 'AppData', 'Roaming', 'spinity', 'web-art')
    const key = crypto.createHash('sha256').update(`${entry.file}|${stat.size}|${stat.mtimeMs}`).digest('hex')
    const cached = path.join(artDir, `${key}.jpg`)
    try {
      const hit = fs.readFileSync(cached)
      if (hit.length) return send(res, 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }, hit)
    } catch {}
    const ffmpeg = findFfmpeg()
    if (!ffmpeg) return send(res, 404, {}, 'no ffmpeg')
    try {
      const r = await runBinBuffer(ffmpeg, ['-nostdin', '-v', 'error', '-i', entry.file,
        '-map', '0:v?', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], 12_000)
      if (r.code !== 0) return send(res, 404, {}, 'no art')
      const out = r.out
      if (out.length < 100) return send(res, 404, {}, 'no art')
      try {
        fs.mkdirSync(artDir, { recursive: true })
        fs.writeFileSync(cached, out)
      } catch {}
      return send(res, 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }, out)
    } catch {
      return send(res, 404, {}, 'no art')
    }
  }

  // ---- API: lyrics (lrclib — exact match first, then search; cached) ----
  if (u.pathname === '/api/lyrics') {
    const id = u.searchParams.get('id') || ''
    const meta = lib.pub.find((t) => t.id === id)
    if (!meta) return send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'unknown track' }))
    const cached = lyricsCache.get(id)
    if (cached) return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify(cached))
    let out = null
    try {
      out = await lrclibLookup(meta)
    } catch (e) {
      // Rate limited / down — tell the player so it can retry later (never cache this).
      return send(res, 503, { 'Content-Type': 'application/json' }, JSON.stringify({ error: String((e && e.message) || e) }))
    }
    if (!out) out = { id, synced: null, plain: null, source: 'lrclib' }
    lyricsCache.set(id, out)
    persistLyrics()
    return send(res, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify(out))
  }

  // ---- API: audio stream (Range-capable) ----
  if (u.pathname === '/api/stream') {
    const id = u.searchParams.get('id') || ''
    const entry = lib.byId.get(id)
    if (!entry) return send(res, 404, {}, 'unknown track')
    let stat = null
    try {
      stat = fs.statSync(entry.file)
      if (!stat.isFile()) throw new Error('gone')
    } catch {
      lib = loadLibrary()
      return send(res, 410, {}, 'file gone')
    }
    const total = stat.size
    const type = MIME[path.extname(entry.file).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.range
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
    if (range && !m) {
      return send(res, 416, { 'Content-Range': `bytes */${total}` }, '')
    }
    let start = 0
    let end = total - 1
    let partial = false
    if (m) {
      partial = true
      if (m[1] === '') {
        const suffix = Number(m[2])
        start = suffix > 0 && Number.isSafeInteger(suffix) ? Math.max(0, total - suffix) : total
      } else {
        start = Number(m[1])
        if (m[2] !== '') end = Number(m[2])
      }
      end = Math.min(end, total - 1)
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) {
        return send(res, 416, { 'Content-Range': `bytes */${total}` }, '')
      }
    }
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Cache-Control': 'no-store'
    }
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${total}`
    res.writeHead(partial ? 206 : 200, headers)
    fs.createReadStream(entry.file, { start, end }).pipe(res)
    return
  }

  // ---- API: download to this device (attachment, browser saves the file) ----
  if (u.pathname === '/api/download') {
    const id = u.searchParams.get('id') || ''
    const entry = lib.byId.get(id)
    const meta = lib.pub.find((t) => t.id === id)
    if (!entry || !meta) return send(res, 404, {}, 'unknown track')
    let stat = null
    try { stat = fs.statSync(entry.file) } catch { return send(res, 410, {}, 'file gone') }
    const ext = path.extname(entry.file) || '.m4a'
    const name = `${meta.artist || 'Unknown'} - ${meta.title || 'track'}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'track'
    const ascii = name.replace(/[^\x20-\x7e]/g, '_')
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(entry.file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${ascii}${ext}"; filename*=UTF-8''${encodeURIComponent(name + ext)}`,
      'Cache-Control': 'no-store'
    })
    fs.createReadStream(entry.file).pipe(res)
    return
  }

  return send(res, 404, {}, 'not found')
})

server.listen(PORT, '0.0.0.0', () => {
  const urls = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni && ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${PORT}/player`)
    }
  }
  console.log(`Spinity web player on http://localhost:${PORT}/player  (${lib.pub.length} tracks)`)
  for (const ip of urls) console.log(`  phone, same Wi-Fi: ${ip}`)
})
