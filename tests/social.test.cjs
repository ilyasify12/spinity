const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-social-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/shared/social.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'social.cjs')
})
const m = require(path.join(out, 'social.cjs'))

test('playlistToSharePayload caps at 100 tracks and trims name', () => {
  const tracks = Array.from({ length: 120 }, (_, i) => ({ id: `id${i}`, title: `T${i}`, artist: 'A', durationSec: 200, thumbnail: 'https://x', webUrl: 'https://x' }))
  const p = m.playlistToSharePayload('  hello world  '.repeat(20), tracks)
  assert.equal(p.tracks.length, 100)
  assert.ok(p.name.length <= 80)
})

test('validateSharePayload rejects empty and too-large', () => {
  assert.equal(m.validateSharePayload(null), 'Invalid payload')
  assert.equal(m.validateSharePayload({ name: '', tracks: [{ videoId: 'x' }] }), 'Playlist name required')
  assert.equal(m.validateSharePayload({ name: 'ok', tracks: [] }), 'At least one track required')
  const big = { name: 'ok', tracks: Array.from({ length: 101 }, () => ({ videoId: 'x' })) }
  assert.equal(m.validateSharePayload(big), 'Too many tracks (max 100)')
  assert.equal(m.validateSharePayload({ name: 'ok', tracks: [{ videoId: 'x' }] }), null)
})

test('computeSyncTarget advances when playing, freezes when paused', () => {
  const playing = { positionMs: 10000, isPlaying: true, updatedAt: new Date().toISOString() }
  const paused = { positionMs: 10000, isPlaying: false, updatedAt: new Date().toISOString() }
  const now = Date.now()
  const serverAt = now - 2000
  const tPlay = m.computeSyncTarget(playing, serverAt, now)
  const tPause = m.computeSyncTarget(paused, serverAt, now)
  assert.ok(Math.abs(tPlay - 12) < 0.05)
  assert.equal(tPause, 10)
})

test('shouldSeek respects threshold', () => {
  assert.equal(m.shouldSeek(10, 11.4, 1.5), false)
  assert.equal(m.shouldSeek(10, 12, 1.5), true)
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))
