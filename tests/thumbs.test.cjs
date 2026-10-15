const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-thumbs-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/shared/thumbs.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'thumbs.cjs')
})
const { hqThumb, artworkUrl, artworkTrackId, ARTWORK_URL_VERSION } = require(path.join(out, 'thumbs.cjs'))

test('upgrades low-res YouTube thumbnails to hqdefault', () => {
  assert.equal(hqThumb('https://i.ytimg.com/vi/abc123/mqdefault.jpg'), 'https://i.ytimg.com/vi/abc123/hqdefault.jpg')
  assert.equal(hqThumb('https://i.ytimg.com/vi/abc123/default.jpg'), 'https://i.ytimg.com/vi/abc123/hqdefault.jpg')
  assert.equal(hqThumb('https://i.ytimg.com/vi/abc123/0.jpg'), 'https://i.ytimg.com/vi/abc123/hqdefault.jpg')
  assert.equal(hqThumb('http://i9.ytimg.com/vi/x_Y-1/mqdefault.jpg?sqp=oaymwEh'), 'http://i9.ytimg.com/vi/x_Y-1/hqdefault.jpg?sqp=oaymwEh')
})

test('leaves good and non-YouTube URLs alone', () => {
  const hq = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg'
  assert.equal(hqThumb(hq), hq)
  assert.equal(hqThumb('https://i.ytimg.com/vi/abc123/maxresdefault.jpg'), 'https://i.ytimg.com/vi/abc123/maxresdefault.jpg')
  assert.equal(hqThumb('spinity://artwork/abc'), 'spinity://artwork/abc')
  assert.equal(hqThumb('https://example.com/cover.png'), 'https://example.com/cover.png')
  assert.equal(hqThumb(''), '')
  assert.equal(hqThumb(null), '')
  assert.equal(hqThumb(undefined), '')
})

test('artwork URLs carry a version so a stale cache cannot outlive a fix', () => {
  const url = artworkUrl('loc_abcdef')
  assert.equal(url, `spinity://artwork/${ARTWORK_URL_VERSION}/loc_abcdef`)
  assert.equal(artworkTrackId(url), 'loc_abcdef')
  assert.equal(artworkTrackId(artworkUrl('a b/c')), 'a b/c', 'ids round-trip through percent-encoding')
  // Libraries indexed by older builds still carry version-less URLs.
  assert.equal(artworkTrackId('spinity://artwork/loc_legacy'), 'loc_legacy')
  assert.equal(artworkTrackId('spinity://artwork/v9/loc_future'), 'loc_future')
  assert.equal(artworkTrackId('https://i.ytimg.com/vi/x/hqdefault.jpg'), null)
  assert.equal(artworkTrackId('spinity://artwork/'), null)
  assert.equal(artworkTrackId(''), null)
  assert.equal(artworkTrackId(null), null)
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))
