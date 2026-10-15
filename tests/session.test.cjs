const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * Resume-on-restart regressions.
 *
 * The engine keeps the offset in localStorage and needs a media element, so the
 * module is bundled for Node and both are stubbed before it is required.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-session-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/renderer/src/player/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'engine.cjs')
})

class AudioMock extends EventTarget {
  constructor() {
    super()
    global.audio = this
    this.duration = 120
    this.currentTime = 0
    this.paused = true
  }
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  removeAttribute() {}
}
global.Audio = AudioMock

// Minimal localStorage: where the engine persists the resume state.
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => store.clear()
  }
})

const { usePlayer, persistSession, restorePlayerSession } = require(path.join(out, 'engine.cjs'))
const KEY = 'spinity:player-session'

const read = () => {
  const raw = store.get(KEY)
  return raw ? JSON.parse(raw) : null
}

const track = (id, filePath) => ({
  id, source: 'local', title: id, artist: 'x', durationSec: 200,
  filePath, downloadedAt: 0, thumbnail: '', webUrl: ''
})
const t1 = track('a', 'a.mp3')
const t2 = track('b', 'b.mp3')

function reset() {
  store.clear()
  usePlayer.getState().stop()
  store.clear()
}

test('persistSession records the playing track, queue and offset', () => {
  reset()
  const p = usePlayer.getState()
  p.playQueue([t1, t2], 1)
  p.seek(42)
  persistSession(true)

  const saved = read()
  assert.equal(saved.trackId, 'b')
  assert.equal(saved.positionSec, 42)
  assert.deepEqual(saved.queueIds, ['a', 'b'])
  assert.equal(saved.index, 1)
})

test('restorePlayerSession rebuilds the queue and cues the saved offset, paused', () => {
  reset()
  store.set(KEY, JSON.stringify({
    trackId: 'b', positionSec: 42, queueIds: ['a', 'b'], index: 1,
    volume: 0.5, muted: false, shuffle: false, repeat: 'off'
  }))

  assert.equal(restorePlayerSession([t1, t2]), true)

  const s = usePlayer.getState()
  assert.deepEqual(s.queue.map((t) => t.id), ['a', 'b'])
  assert.equal(s.index, 1)
  assert.equal(s.currentTime, 42, 'the bar must show the saved offset, not 0')
  assert.equal(s.playing, false, 'launching must never start audio by itself')
  assert.equal(s.volume, 0.5)
  assert.equal(global.audio.volume, 0.5)

  // Chromium ignores currentTime until metadata exists, so the engine defers it.
  global.audio.dispatchEvent(new Event('loadedmetadata'))
  assert.equal(global.audio.currentTime, 42)
})

test('restorePlayerSession drops queue entries no longer in the library', () => {
  reset()
  store.set(KEY, JSON.stringify({
    trackId: 'a', positionSec: 10, queueIds: ['a', 'b'], index: 0,
    volume: 1, muted: false, shuffle: false, repeat: 'off'
  }))

  assert.equal(restorePlayerSession([t1]), true)

  const s = usePlayer.getState()
  assert.deepEqual(s.queue.map((t) => t.id), ['a'], 'the deleted track must not linger')
  assert.equal(s.index, 0)
})

test('restorePlayerSession bails when the saved track is gone', () => {
  reset()
  store.set(KEY, JSON.stringify({
    trackId: 'zzz', positionSec: 5, queueIds: ['a'], index: 0,
    volume: 1, muted: false, shuffle: false, repeat: 'off'
  }))

  assert.equal(restorePlayerSession([t1]), false)
  assert.equal(usePlayer.getState().index, -1)
})

test('a streamed track is never saved for resume', () => {
  reset()
  usePlayer.getState().playStream('https://example.com/a.webm', {
    id: 's1', source: 'youtube', title: 'S', artist: 'z', durationSec: 100,
    thumbnail: '', webUrl: 'https://youtu.be/s1'
  })
  persistSession(true)

  assert.equal(store.get(KEY), undefined, 'a signed URL cannot be resumed later')
})

test('stop clears the saved session so the next launch starts empty', () => {
  reset()
  const p = usePlayer.getState()
  p.playQueue([t1], 0)
  p.seek(30)
  persistSession(true)
  assert.ok(read(), 'expected a saved session first')

  p.stop()
  assert.equal(store.get(KEY), undefined)
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))