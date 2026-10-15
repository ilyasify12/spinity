const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

/**
 * The automatic match, end to end, with the network and the store stubbed.
 *
 * Two things matter here and neither is a pure function: that a confidently
 * matching record is returned, and that the independent lrclib searches are
 * fired *together* rather than one after another (which made a hard track's
 * lookup as slow as the sum of their timeouts).
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-lyricsmatch-test-'))

const dbStub = path.join(out, 'db-stub.cjs')
// The bundle inlines this file, so a plain module-level `state` would not be
// the same object the test requires — globalThis is shared between both.
fs.writeFileSync(
  dbStub,
  `module.exports = {
  db: {
    getSettings: () => ({ lyricsMode: globalThis.__SPINITY_TEST_MODE__ || 'normal' }),
    findTrackAnywhere: () => globalThis.__SPINITY_TEST_TRACK__ || null,
    getLyrics: () => globalThis.__SPINITY_TEST_LYRICS || null,
    setLyrics: (_id, value) => { globalThis.__SPINITY_TEST_LYRICS = value },
    getLyricSync: () => null,
    setLyricSync: () => {},
    clearLyricSync: () => {},
    clearLyrics: () => { globalThis.__SPINITY_TEST_LYRICS = null },
    getAiLyrics: () => globalThis.__SPINITY_TEST_AI_LYRICS || null,
    setAiLyrics: (_id, value) => { globalThis.__SPINITY_TEST_AI_LYRICS = value },
    clearAiLyrics: () => { globalThis.__SPINITY_TEST_AI_LYRICS = null },
    getAiCache: () => null,
    setAiCache: () => {},
    migrateLyricsCache: () => 0
  }
}`
)
const ytdlpStub = path.join(out, 'ytdlp-stub.cjs')
fs.writeFileSync(ytdlpStub, 'module.exports = { resolveFfmpeg: () => null, search: async () => [] }')
// captionSync.ts (pulled in by lyrics.ts) imports `app` from electron at load
// time; outside Electron that require throws, so it is stubbed like the rest.
const electronStub = path.join(out, 'electron-stub.cjs')
fs.writeFileSync(electronStub, 'module.exports = { app: { getPath: () => require("node:os").tmpdir() } }')

const RECORD = {
  id: 42,
  trackName: 'Sonne',
  artistName: 'Rammstein',
  duration: 103,
  syncedLyrics: '[00:01.00] Eins\n[00:05.00] Zwei\n[00:09.00] Drei',
  plainLyrics: null
}

let bundlePath
before(async () => {
  bundlePath = path.join(out, 'lyrics.cjs')
  await build({
    entryPoints: [path.join(__dirname, '../src/main/lyrics.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundlePath,
    plugins: [
      {
        name: 'stub',
        setup(build) {
          build.onResolve({ filter: /^\.\/db$/ }, () => ({ path: dbStub }))
          build.onResolve({ filter: /^\.\/ytdlp$/ }, () => ({ path: ytdlpStub }))
          build.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }))
        }
      }
    ]
  })
})

test('a confident match is found and the searches run concurrently', async () => {
  // No key => the optional AI pass stays out of the way.
  delete process.env.SPINITY_AI_KEY
  delete process.env.SPINITY_AI_MODEL

  const { getLyrics } = require(bundlePath)

  globalThis.__SPINITY_TEST_LYRICS = null
  globalThis.__SPINITY_TEST_TRACK__ = {
    id: 'track-1',
    title: 'Rammstein - Sonne remix by street Music  [TIKTOK VERSION]',
    artist: 'Rammstein',
    durationSec: 103,
    source: 'local',
    filePath: path.join(out, 'does-not-exist.mp3')
  }

  let inFlight = 0
  let maxConcurrent = 0
  const requests = []
  global.fetch = async (url) => {
    requests.push(String(url))
    inFlight += 1
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 40))
    inFlight -= 1
    if (String(url).includes('/api/get')) return { ok: true, json: async () => ({}) }
    if (String(url).includes('/api/search')) return { ok: true, json: async () => [RECORD] }
    return { ok: false, json: async () => null }
  }

  try {
    const result = await getLyrics('track-1')

    assert.equal(result.synced, true)
    assert.equal(result.source, 'lrclib')
    assert.equal(result.lines.length, 3)
    assert.equal(result.matched.title, 'Sonne')
    assert.equal(result.matched.artist, 'Rammstein')
    assert.equal(result.canFetch, true)

    // The structured search and the per-variant searches must overlap: serial
    // execution would never have more than one request in flight at a time.
    assert.ok(maxConcurrent >= 2, `searches ran serially (max concurrent ${maxConcurrent})`)
    assert.ok(requests.some((u) => u.includes('/api/get')), 'the exact endpoint is still tried first')
  } finally {
    delete global.fetch
  }
})

test('a junk-named file is never searched', async () => {
  const { getLyrics } = require(bundlePath)

  globalThis.__SPINITY_TEST_LYRICS = null
  globalThis.__SPINITY_TEST_TRACK__ = { id: 'track-2', title: '1', artist: 'Unknown artist', durationSec: 200, source: 'local', filePath: null }

  let called = 0
  global.fetch = async () => {
    called += 1
    return { ok: true, json: async () => [] }
  }
  try {
    const result = await getLyrics('track-2')
    assert.equal(result.canFetch, false)
    assert.equal(result.lines.length, 0)
    assert.equal(called, 0, 'nothing should be sent for 1.mp3')
  } finally {
    delete global.fetch
  }
})

test('the two modes keep separate lyrics, so switching back is lossless', async () => {
  const { getLyrics } = require(bundlePath)
  // A messy tag in, a clean song out: the writer must be handed the cleaned
  // identity, never the file noise.
  const AI_BODY = '{"unknown":false,"lines":["First line","Second line","Third line"]}'
  const IDENTITY_BODY = '{"title":"Sonne","artist":"Rammstein"}'
  const calls = { lrclib: 0, nvidia: 0 }
  const nvidiaBodies = []

  // Reset everything this test owns, then run it with AI enabled.
  globalThis.__SPINITY_TEST_MODE__ = 'normal'
  globalThis.__SPINITY_TEST_LYRICS = null
  globalThis.__SPINITY_TEST_AI_LYRICS = null
  globalThis.__SPINITY_TEST_TRACK__ = {
    id: 'track-3',
    title: 'Rammstein - Sonne remix by street Music  [TIKTOK VERSION]',
    artist: 'Rammstein',
    durationSec: 103,
    source: 'local',
    filePath: null
  }
  process.env.SPINITY_AI_KEY = 'test-key'

  global.fetch = async (url, init) => {
    const u = String(url)
    if (u.includes('integrate.api.nvidia.com')) {
      calls.nvidia += 1
      let messages = ''
      try {
        messages = JSON.stringify(JSON.parse(init?.body ?? '{}').messages ?? [])
      } catch {}
      nvidiaBodies.push(messages)
      const payload = messages.includes('Identify the real song') ? IDENTITY_BODY : AI_BODY
      // Stream the answer in two chunks: the reader must stitch it back
      // together before the JSON can be recognised as complete.
      const half = Math.ceil(payload.length / 2)
      const events =
        [payload.slice(0, half), payload.slice(half)]
          .map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)
          .join('') + 'data: [DONE]\n\n'
      return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    calls.lrclib += 1
    if (u.includes('/api/get')) return { ok: true, json: async () => ({}) }
    if (u.includes('/api/search')) return { ok: true, json: async () => [RECORD] }
    return { ok: false, json: async () => null }
  }

  try {
    // 1. Normal mode finds and stores the real match.
    const normal = await getLyrics('track-3')
    assert.equal(normal.source, 'lrclib')
    assert.equal(normal.matched.title, 'Sonne')
    assert.equal(globalThis.__SPINITY_TEST_LYRICS.source, 'lrclib')
    const lrclibCalls = calls.lrclib
    // The heuristic may or may not need a helping AI call here, so everything
    // below is asserted relative to what normal mode already used.
    const aiCalls = calls.nvidia

    // 2. AI mode writes its own copy and leaves the normal one completely alone.
    //    The name is identified first (ask 1), then written from the clean
    //    identity (ask 2) — a writer shown the file noise would pad or loop.
    globalThis.__SPINITY_TEST_MODE__ = 'ai'
    const ai = await getLyrics('track-3')
    assert.equal(calls.nvidia, aiCalls + 2, 'identify once, then write once')
    const writeCall = nvidiaBodies.find((m) => m.includes('Write the complete lyrics'))
    assert.ok(writeCall, 'the second call asks for lyrics')
    assert.ok(!writeCall.includes('TIKTOK'), 'the writer is given the cleaned name, not the file noise')
    assert.ok(writeCall.includes('Sonne'), 'and the cleaned song reaches it')
    assert.equal(ai.source, 'ai')
    assert.equal(ai.lines.length, 3)
    assert.equal(ai.synced, false, 'AI writing must never invent timings')
    assert.equal(
      globalThis.__SPINITY_TEST_LYRICS.source,
      'lrclib',
      'the real match must survive the AI write'
    )
    assert.equal(globalThis.__SPINITY_TEST_AI_LYRICS.source, 'ai')

    // 3. Back to normal: the same lyrics come back, with no re-fetch at all.
    globalThis.__SPINITY_TEST_MODE__ = 'normal'
    const back = await getLyrics('track-3')
    assert.equal(back.source, 'lrclib')
    assert.deepEqual(back.lines, normal.lines)
    assert.equal(calls.lrclib, lrclibCalls, 'switching back must not search again')

    // 4. AI mode a second time reuses what it wrote instead of re-asking.
    globalThis.__SPINITY_TEST_MODE__ = 'ai'
    await getLyrics('track-3')
    assert.equal(calls.nvidia, aiCalls + 2, 'a second AI read must be cached')
  } finally {
    delete global.fetch
    delete globalThis.__SPINITY_TEST_MODE__
    delete globalThis.__SPINITY_TEST_AI_LYRICS
    delete process.env.SPINITY_AI_KEY
  }
})

after(() => fs.rmSync(out, { recursive: true, force: true }))
