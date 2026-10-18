const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { buildSync } = require('esbuild')

/**
 * Stream cache: the write-through pipeline behind free-tier playback.
 *
 * Everything here runs against a local HTTP server that impersonates a CDN —
 * including the load-bearing behaviour of previews: an <audio> element reads
 * the file while it is still growing, and the same bytes stay on disk so the
 * second play never touches the network.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-streamcache-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/main/streamCache.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'streamCache.cjs')
})
const { createStreamCache } = require(path.join(out, 'streamCache.cjs'))

// ------------------------------------------------------------ fake CDN

const BODY = Buffer.from(Array.from({ length: 300 * 1024 }, (_, i) => (i * 31 + 7) % 256))
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const hits = { full: 0, slow: 0, missing: 0, flaky: 0, hang: 0 }
let flakyOk = false
const sockets = new Set()

const server = http.createServer((req, res) => {
  sockets.add(req.socket)
  req.socket.on('close', () => sockets.delete(req.socket))
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/full') {
    hits.full++
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(BODY.length) })
    res.end(BODY)
    return
  }
  if (url.pathname === '/slow') {
    hits.slow++
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(BODY.length) })
    // 12 chunks over ~240ms: the reader is guaranteed to catch the file growing.
    let offset = 0
    const step = Math.ceil(BODY.length / 12)
    const tick = () => {
      if (offset >= BODY.length) {
        res.end()
        return
      }
      res.write(BODY.subarray(offset, offset + step))
      offset += step
      setTimeout(tick, 20)
    }
    tick()
    return
  }
  if (url.pathname === '/flaky') {
    hits.flaky++
    if (!flakyOk) {
      res.writeHead(500)
      res.end('nope')
      return
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(BODY.length) })
    res.end(BODY)
    return
  }
  if (url.pathname === '/chunked') {
    // No Content-Length: the response is chunked, so the reader must be able
    // to start from the first byte without ever learning the total.
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
    let offset = 0
    const step = Math.ceil(BODY.length / 6)
    const tick = () => {
      if (offset >= BODY.length) {
        res.end()
        return
      }
      res.write(BODY.subarray(offset, offset + step))
      offset += step
      setTimeout(tick, 30)
    }
    tick()
    return
  }
  if (url.pathname === '/hang') {
    hits.hang++
    // Never respond; the idle watchdog has to give up on its own.
    return
  }
  hits.missing++
  res.writeHead(404)
  res.end('not found')
})

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
})

after(async () => {
  for (const socket of [...sockets]) socket.destroy()
  await new Promise((resolve) => server.close(resolve))
  fs.rmSync(out, { recursive: true, force: true })
})

const base = () => `http://127.0.0.1:${server.address().port}`

async function readAll(stream) {
  const reader = stream.getReader()
  const parts = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) parts.push(Buffer.from(value))
  }
  return Buffer.concat(parts)
}

// ------------------------------------------------------------ tests

test('prewarm downloads write-through: correct bytes on disk, replay is local', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const url = `${base()}/full`

  const session = cache.open(url)
  assert.equal(session.cached, false)
  const got = await cache.waitFirstByte(session.key, 2000)
  assert.equal(got, true, 'first byte must land quickly')

  await cache.wait(session.key)
  assert.equal(session.done, true)
  assert.equal(session.total, BODY.length)
  assert.equal(session.firstByteMs !== null, true, 'first-byte latency is recorded')

  const stored = fs.readFileSync(path.join(dir, `${session.key}.bin`))
  assert.equal(sha(stored), sha(BODY), 'disk copy is byte-identical')
  assert.equal(fs.existsSync(path.join(dir, `${session.key}.json`)), true, 'sidecar marks completion')

  const stats = cache.stats()
  assert.equal(stats.entries, 1)
  assert.equal(stats.bytes, BODY.length)
  assert.equal(typeof stats.firstByteAvgMs, 'number')

  // Replay: served from disk, no new network request.
  const before = hits.full
  const again = cache.open(url)
  assert.equal(again.cached, true)
  assert.equal(again.done, true)
  assert.equal(again.key, session.key)
  assert.equal(hits.full, before, 'a cached open must not hit the network')
  assert.equal(sha(await readAll(cache.read(again.key))), sha(BODY))
})

test('the audio element can read the file while it is still downloading', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const url = `${base()}/slow`

  const session = cache.open(url)
  assert.equal(session.done, false)
  // Start reading immediately — this is exactly what the protocol handler does
  // on Chromium's first `bytes=0-` request.
  const collecting = readAll(cache.read(session.key))
  assert.equal(session.done, false, 'the read starts before the download finishes')

  const bytes = await collecting
  assert.equal(sha(bytes), sha(BODY), 'growing-file reads converge on the full payload')
  assert.equal(session.done, true)
})

test('a failed download surfaces its error, and the next open retries cleanly', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })

  const missing = cache.open(`${base()}/missing`)
  await assert.rejects(cache.wait(missing.key), /HTTP 404/)
  assert.match(missing.error, /HTTP 404/)
  assert.equal(fs.existsSync(path.join(dir, `${missing.key}.bin`)), false, 'no partial file is kept')

  // The same URL that failed before: a fresh open() resets and retries.
  flakyOk = false
  const flaky = `${base()}/flaky`
  const first = cache.open(flaky)
  await assert.rejects(cache.wait(first.key), /HTTP 500/)
  flakyOk = true
  const second = cache.open(flaky)
  assert.equal(second.cached, false)
  await cache.wait(second.key)
  assert.equal(sha(fs.readFileSync(path.join(dir, `${second.key}.bin`))), sha(BODY))
})

test('a stalled connection is aborted by the idle watchdog', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 250, connectMs: 250 })
  const session = cache.open(`${base()}/hang`)
  const startedAt = Date.now()
  await assert.rejects(cache.wait(session.key), /stalled/i)
  assert.equal(Date.now() - startedAt < 3000, true, 'gave up promptly')
})

test('LRU eviction frees space, and an evicted entry re-downloads', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  // Holds two files; a third download evicts the least-recently-used one.
  const cache = createStreamCache({ dir, maxBytes: Math.floor(BODY.length * 2.2), idleMs: 2000, connectMs: 2000 })

  const a = cache.open(`${base()}/full?a=1`)
  await cache.wait(a.key)
  const b = cache.open(`${base()}/full?b=1`)
  await cache.wait(b.key)
  assert.equal(cache.stats().entries, 2)

  const before = hits.full
  const c = cache.open(`${base()}/full?c=1`)
  await cache.wait(c.key)
  assert.equal(cache.stats().entries, 2)
  assert.equal(fs.existsSync(path.join(dir, `${a.key}.bin`)), false, 'oldest entry evicted')
  assert.equal(fs.existsSync(path.join(dir, `${c.key}.bin`)), true, 'newest entry kept')

  // The evicted URL comes back through the network.
  const again = cache.open(`${base()}/full?a=1`)
  assert.equal(again.cached, false)
  await cache.wait(again.key)
  assert.equal(hits.full, before + 2, 'one request for c, one re-download for a')
  assert.equal(sha(fs.readFileSync(path.join(dir, `${again.key}.bin`))), sha(BODY))
})

test('open() is idempotent per URL and honours the host filter', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const url = `${base()}/full?dedupe=1`

  const one = cache.open(url)
  const two = cache.open(url)
  assert.equal(one, two, 'concurrent opens share one download')
  await cache.wait(one.key)

  const filtered = createStreamCache({
    dir: fs.mkdtempSync(path.join(out, 'cache-')),
    hostFilter: (h) => h === '127.0.0.1'
  })
  assert.throws(() => filtered.open('https://evil.example/track.mp3'), /host not allowed/)
  assert.throws(() => filtered.open('ftp://127.0.0.1/x'), /Unsupported stream scheme/)
})

test('disk entries survive a restart (new cache instance resurrects them)', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const url = `${base()}/full?restart=1`
  const first = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const session = first.open(url)
  await first.wait(session.key)

  const before = hits.full
  const second = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const revived = second.open(url)
  assert.equal(revived.cached, true, 'completion sidecar is enough to serve from disk')
  assert.equal(hits.full, before)
  assert.equal(sha(await readAll(second.read(revived.key))), sha(BODY))
  assert.equal(second.stats().bytes >= BODY.length, true)
})

test('crash leftovers are cleaned: no sidecar means the payload is re-fetched', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  fs.mkdirSync(dir, { recursive: true })
  const key = crypto.createHash('sha1').update(`${base()}/full?leftover=1`).digest('hex').slice(0, 16)
  fs.writeFileSync(path.join(dir, `${key}.bin`), Buffer.alloc(1234, 9))

  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  assert.equal(cache.stats().entries, 0, 'a partial payload is not counted as an entry')
  assert.equal(fs.existsSync(path.join(dir, `${key}.bin`)), false, 'the dead partial is removed')

  const session = cache.open(`${base()}/full?leftover=1`)
  await cache.wait(session.key)
  assert.equal(sha(fs.readFileSync(path.join(dir, `${session.key}.bin`))), sha(BODY))
})

test('ranged reads are byte-exact, and clear() empties completed entries', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const session = cache.open(`${base()}/full?range=1`)
  await cache.wait(session.key)

  const start = 100_000
  const end = 180_000
  const slice = await readAll(cache.read(session.key, start, end))
  assert.equal(Buffer.compare(slice, BODY.subarray(start, end + 1)), 0, 'inclusive range matches the source')

  const tail = await readAll(cache.read(session.key, BODY.length - 10, null))
  assert.equal(Buffer.compare(tail, BODY.subarray(BODY.length - 10)), 0)

  const stats = cache.clear()
  assert.equal(stats.entries, 0)
  assert.equal(stats.bytes, 0)
})

test('a server without Content-Length still serves from the first byte', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 3000, connectMs: 3000 })
  const session = cache.open(`${base()}/chunked`)

  // The protocol handler waits (briefly) for `total` before answering; with a
  // chunked upstream the wait must yield to the first byte instead of burning
  // its whole budget and delaying every play by the timeout.
  const t0 = Date.now()
  await cache.waitForTotal(session.key, 5000)
  const waited = Date.now() - t0
  assert.ok(waited < 1500, `waitForTotal must not burn its full timeout (waited ${waited} ms)`)
  assert.equal(session.total, 0, 'no Content-Length: the total is unknown when serving starts')

  const got = await readAll(cache.read(session.key, 0, null))
  await cache.wait(session.key)
  assert.equal(sha(got), sha(BODY), 'the streamed copy is byte-identical')
  assert.equal(session.total, BODY.length, 'completion backfills the total')
  assert.equal(session.done, true)
})

test('play telemetry keeps a rolling window', () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir })
  cache.recordPlay(250, 'network')
  cache.recordPlay(40, 'local')
  cache.recordPlay(310, 'network')
  const stats = cache.stats()
  assert.equal(stats.plays, 3)
  assert.equal(stats.playLastMs, 310)
  assert.equal(stats.playMinMs, 40)
  assert.equal(stats.playAvgMs, 200)
  assert.equal(stats.netPlays, 2)
  assert.equal(stats.netAvgMs, 280)
})

test('a key hint keeps one entry across rotated (re-signed) URLs', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })

  const before = hits.full
  const first = cache.open(`${base()}/full`, { keyHint: 'yt:abcdefghijk' })
  await cache.wait(first.key)
  assert.equal(hits.full, before + 1, 'the first open fetched once')

  // The same video identity, re-signed: a different URL, the same entry.
  const replay = cache.open(`${base()}/full?resign=2`, { keyHint: 'yt:abcdefghijk' })
  assert.equal(replay.key, first.key)
  assert.equal(replay.cached, true)
  const got = await readAll(cache.read(replay.key, 0, null))
  assert.equal(sha(got), sha(BODY))
  assert.equal(hits.full, before + 1, 'a re-signed URL must not re-download')
})

test('publish adopts a file written by an external downloader', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir })
  const key = cache.keyFor('yt:zzzzzzzzzzz')
  const payload = Buffer.from(Array.from({ length: 40 * 1024 }, (_, i) => (i * 13 + 5) % 256))
  fs.writeFileSync(path.join(dir, `${key}.bin`), payload)

  const before = hits.full
  assert.equal(
    cache.publish(key, { url: `${base()}/full`, contentType: 'audio/mp4', total: payload.length }),
    true
  )

  const entry = cache.get(key)
  assert.equal(entry.done, true)
  assert.equal(entry.cached, true)
  assert.equal(entry.total, payload.length)
  assert.equal(entry.contentType, 'audio/mp4')
  const got = await readAll(cache.read(key, 0, null))
  assert.equal(sha(got), sha(payload))
  const ranged = await readAll(cache.read(key, 10, 109))
  assert.equal(sha(ranged), sha(payload.subarray(10, 110)))
  assert.equal(hits.full, before, 'an adopted entry never touches the network')

  // Nothing on disk: publish must refuse.
  assert.equal(cache.publish(cache.keyFor('yt:nonexistent'), { url: 'x', contentType: '', total: 0 }), false)
})

test('publish refuses to steal a key from an active writer', async () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  const cache = createStreamCache({ dir, idleMs: 2000, connectMs: 2000 })
  const session = cache.open(`${base()}/slow`)
  assert.equal(
    cache.publish(session.key, { url: session.url, contentType: 'audio/mpeg', total: 1 }),
    false,
    'a tee in flight owns the payload'
  )
  await cache.wait(session.key)
})

test('aria2 control files and orphaned payloads are cleaned at startup', () => {
  const dir = fs.mkdtempSync(path.join(out, 'cache-'))
  fs.writeFileSync(path.join(dir, 'aaaaaaaaaaaaaaaa.bin'), 'partial')
  fs.writeFileSync(path.join(dir, 'aaaaaaaaaaaaaaaa.bin.aria2'), 'control')
  fs.writeFileSync(path.join(dir, 'bbbbbbbbbbbbbbbb.bin.aria2'), 'orphan control')
  createStreamCache({ dir })
  assert.equal(fs.existsSync(path.join(dir, 'aaaaaaaaaaaaaaaa.bin')), false)
  assert.equal(fs.existsSync(path.join(dir, 'aaaaaaaaaaaaaaaa.bin.aria2')), false)
  assert.equal(fs.existsSync(path.join(dir, 'bbbbbbbbbbbbbbbb.bin.aria2')), false)
})
