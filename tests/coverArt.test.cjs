const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * Cover-fallback matching rules.
 *
 * Only the pure helpers are exercised: the lookup itself spawns yt-dlp and hits
 * the network, which is not something a test should depend on.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-cover-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/main/coverArt.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'cover.cjs')
})
const { isJunkTitle, coverQuery, normalizeTitle, titleOverlap, isGoodMatch, stripTitleNoise, isNoiseOnly, cleanAiGuess } = require(path.join(out, 'cover.cjs'))
const { createCoverLookup, isGenericArtist } = require(path.join(out, 'cover.cjs'))

test('junk names are never searched', () => {
  for (const junk of ['1', '2', '03', 'Track 3', 'track', 'audio', 'Untitled', 'New recording', 'output', 'cd1']) {
    assert.equal(isJunkTitle(junk), true, `${junk} should be treated as noise`)
  }
  for (const real of ['Bohemian Rhapsody', 'SAINT MOTEL', 'Frisk ver.', 'モニタリング', 'DEMO']) {
    assert.equal(isJunkTitle(real), false, `${real} should be searchable`)
  }
})

test('coverQuery drops the placeholder artist but keeps a real one', () => {
  assert.equal(coverQuery('1', 'Unknown artist'), null, 'a junk title is never searched at all')
  assert.equal(coverQuery('Slow mornings', 'Unknown artist'), 'Slow mornings')
  assert.equal(coverQuery('Slow mornings', 'Soap&Skin'), 'Soap&Skin Slow mornings')
})

test('normalizeTitle strips bracketed noise and punctuation but keeps unicode', () => {
  assert.equal(normalizeTitle('Move (Official Video)'), 'move')
  assert.equal(normalizeTitle('AnythingBecomeMoe / DECO * 27'), 'anythingbecomemoe deco 27')
  assert.equal(normalizeTitle('モニタリング'), 'モニタリング', 'non-Latin titles must survive')
})

test('titleOverlap scores shared words', () => {
  assert.equal(titleOverlap('Move', 'Move (Official Video)'), 1)
  assert.equal(titleOverlap('Saint Motel Move', 'Move'), 1 / 3)
  assert.equal(titleOverlap('Move', 'Something else'), 0)
})

test('isGoodMatch accepts real matches and rejects unrelated hits', () => {
  assert.equal(isGoodMatch('Move', 'Move (Official Video)'), true)
  assert.equal(isGoodMatch('Frisk ver. (Undertale Animation Parody)', 'Frisk ver. Undertale Animation Parody'), true)
  assert.equal(isGoodMatch('SAINT MOTEL', 'SAINT MOTEL - My Type'), true, 'containment covers longer hits')
  assert.equal(isGoodMatch('Move', 'Holiday In Cambodia'), false)
  // A two-letter hit must not count as a substring match for everything.
  assert.equal(isGoodMatch('Me and the Devil', 'me'), false)
})

test('placeholder artists are recognised so they are never searched', () => {
  for (const generic of ['', 'Unknown artist', 'unknown', 'Various Artists', 'VA']) {
    assert.equal(isGenericArtist(generic), true, `${generic || '(empty)'} is a placeholder`)
  }
  assert.equal(isGenericArtist('Soap&Skin'), false)
})

test('downloader noise is stripped before a search', () => {
  // Reported from a real library: the site name was glued onto the song title.
  assert.equal(stripTitleNoise('モニタリング spotdown.org'), 'モニタリング')
  assert.equal(stripTitleNoise('Song Name - y2mate.com'), 'Song Name')
  assert.equal(stripTitleNoise('Bohemian Rhapsody 320kbps'), 'Bohemian Rhapsody')
  assert.equal(stripTitleNoise('Song (Official Video) [HD].mp3'), 'Song')
  assert.equal(stripTitleNoise('https://y2mate.com Song Name'), 'Song Name')
  assert.equal(stripTitleNoise('Me and the Devil (Lyrics)'), 'Me and the Devil (Lyrics)', 'real asides stay for the precise attempt')
  assert.equal(stripTitleNoise('DEMO'), 'DEMO', 'never strip a name down to nothing useful')
})

test('a name that is only a site or bitrate is treated as junk', () => {
  assert.equal(isJunkTitle('spotdown.org'), true)
  assert.equal(isJunkTitle('320kbps'), true)
  assert.equal(coverQuery('モニタリング spotdown.org', 'Music'), 'モニタリング', 'the placeholder folder artist is dropped too')
})

test('an all-noise name is caught so the AI cannot pass it off as the artist', () => {
  // Measured live: for `モニタリング spotdown.org` the model answered with artist
  // "Spotdown" — which then poisoned the follow-up search.
  assert.equal(isNoiseOnly('Spotdown'), true)
  assert.equal(isNoiseOnly('spotdown.org'), true)
  assert.equal(isNoiseOnly('320kbps'), true)
  assert.equal(isNoiseOnly(''), false, 'empty is a placeholder artist, not something to strip here')
  for (const real of ['Rammstein', 'Estelle', 'Panic! At The Disco', 'Soap&Skin']) {
    assert.equal(isNoiseOnly(real), false, `${real} must survive`)
  }
})

test('cleanAiGuess strips echoed noise but never empties a title', () => {
  assert.equal(cleanAiGuess('モニタリング spotdown.org'), 'モニタリング')
  assert.equal(cleanAiGuess('Sonne'), 'Sonne')
  assert.equal(cleanAiGuess('  Sonne  '), 'Sonne')
  // If stripping would leave nothing, the title is returned untouched rather
  // than an empty string that would lose the answer entirely.
  assert.equal(cleanAiGuess('320kbps'), '320kbps')
  assert.equal(cleanAiGuess(''), '')
})

/**
 * The fast path the artwork protocol depends on: answering from the cache
 * must never spawn yt-dlp. A miss is reported as `unknown` so the caller can
 * paint a placeholder now and search in the background.
 */
test('cover lookup reports cached answers without searching', async () => {
  const crypto = require('node:crypto')
  const cacheRoot = path.join(out, 'cover-cache')
  const lookup = createCoverLookup(cacheRoot, 'cover-v2')

  assert.deepEqual(await lookup.ready('1', 'Unknown artist'), { state: 'none' }, 'junk names are resolved as "nothing to find"')
  assert.deepEqual(await lookup.ready('A Real Song', 'Real Artist'), { state: 'unknown' }, 'a cold title needs a lookup')
  assert.equal(lookup.peek('A Real Song', 'Real Artist'), undefined)

  // Seed the on-disk cache exactly like a completed lookup would.
  const query = coverQuery('A Real Song', 'Real Artist')
  const key = crypto.createHash('sha256').update(`cover-v2|${normalizeTitle(query)}`).digest('hex')
  fs.mkdirSync(cacheRoot, { recursive: true })
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  fs.writeFileSync(path.join(cacheRoot, `${key}.jpg`), jpeg)

  const hit = await lookup.ready('A Real Song', 'Real Artist')
  assert.equal(hit.state, 'hit')
  assert.deepEqual(hit.image, jpeg)
  assert.deepEqual(lookup.peek('A Real Song', 'Real Artist'), jpeg, 'the answer is memoised in memory')

  // A recorded "nothing matched" is just as fast, and just as final.
  const negativeRoot = path.join(out, 'cover-cache-negative')
  fs.mkdirSync(negativeRoot, { recursive: true })
  const negativeQuery = coverQuery('Nothing Here', 'Real Artist')
  const negativeKey = crypto.createHash('sha256').update(`cover-v2|${normalizeTitle(negativeQuery)}`).digest('hex')
  fs.writeFileSync(path.join(negativeRoot, `${negativeKey}.jpg`), Buffer.alloc(0))
  const cold = createCoverLookup(negativeRoot, 'cover-v2')
  assert.deepEqual(await cold.ready('Nothing Here', 'Real Artist'), { state: 'none' })
  assert.deepEqual(await cold.ready('A Real Song', 'Real Artist'), { state: 'unknown' }, 'a different title is still unknown')
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))