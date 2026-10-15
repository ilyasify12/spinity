const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * The AI assistant's pure half: prompt wording and answer parsing. Small models
 * answer with stray prose, fenced code or stringified numbers, so the parser is
 * the part worth pinning down — a bad parse silently loses the match.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-aitext-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/main/aiText.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'aiText.cjs')
})
const { extractJson, identifyPrompt, pickPrompt, alignPrompt, writeLyricsPrompt, isRepeatedWrite, readNumber, readText, MAX_CANDIDATES } = require(path.join(out, 'aiText.cjs'))

test('JSON is recovered from messy model replies', () => {
  assert.deepEqual(extractJson('{"title":"Sonne","artist":"Rammstein"}'), { title: 'Sonne', artist: 'Rammstein' })
  assert.deepEqual(extractJson('```json\n{"pick": 2}\n```'), { pick: 2 })
  assert.deepEqual(extractJson('Sure! Here you go: {"pick":0} — hope that helps.'), { pick: 0 })
  // Braces inside strings must not end the object early.
  assert.deepEqual(extractJson('{"title":"Song {with braces}","artist":"X"}'), {
    title: 'Song {with braces}',
    artist: 'X'
  })
  assert.equal(extractJson('no json at all'), null)
  assert.equal(extractJson('{"broken": '), null)
})

test('numbers and strings survive a sloppy answer', () => {
  assert.equal(readNumber(2), 2)
  assert.equal(readNumber('2'), 2)
  assert.equal(readNumber('-1'), -1)
  assert.equal(readNumber('1.5'), 1.5)
  assert.equal(readNumber('two'), null)
  assert.equal(readNumber(null), null)
  assert.equal(readText('  Sonne '), 'Sonne')
  assert.equal(readText(42), '')
})

test('the identify prompt carries the metadata and nothing else', () => {
  const prompt = identifyPrompt({
    fileName: 'Rammstein - Sonne remix by street Music  [TIKTOK VERSION].mp3',
    title: 'Sonne remix by street Music  [TIKTOK VERSION]',
    artist: 'Rammstein',
    durationSec: 103
  })
  assert.match(prompt, /Sonne remix by street Music/)
  assert.match(prompt, /103 seconds/)
  assert.match(prompt, /Ignore downloader site names/)
  assert.match(prompt, /underlying\* song/)
  assert.doesNotMatch(prompt, /C:\\/, 'never send a file path')
})

test('the pick prompt lists candidates with their lengths, capped', () => {
  const candidates = Array.from({ length: 15 }, (_, i) => ({
    trackName: `House of Memories ${i}`,
    artistName: 'Panic! At The Disco',
    duration: 190 + i,
    syncedLyrics: i === 0 ? '[00:01.00] x' : null
  }))
  const prompt = pickPrompt({ title: 'House of Memories (PΛLΛDIN Remix)', artist: 'Panic! At The Disco', durationSec: 191 }, candidates)
  assert.match(prompt, /0: "House of Memories 0" by "Panic! At The Disco" \(190s\) \[timed lyrics\]/)
  assert.match(prompt, /length 191 seconds/)
  assert.ok(prompt.includes(`${MAX_CANDIDATES - 1}:`), 'sends up to the cap')
  assert.ok(!prompt.includes(`${MAX_CANDIDATES}:`), 'and no more')
})

test('the alignment prompt sends both timelines and asks for a shift', () => {
  const prompt = alignPrompt(
    [{ t: 11.66, text: "I didn't know what I got into" }, { t: 14.05, text: 'Somehow I can’t go back' }],
    [{ t: 18.4, text: "I didn't know what I got into." }, { t: 20.88, text: 'Somehow I can’t go back even if I really' }]
  )
  assert.match(prompt, /11\.66s I didn't know what I got into/)
  assert.match(prompt, /18\.40s I didn't know what I got into\./)
  assert.match(prompt, /ADDED to the lyric times/)
  assert.match(prompt, /"offsetSec"/)
})

test('the writing prompt names the song, forbids timings and allows a refusal', () => {
  const prompt = writeLyricsPrompt({ title: 'Sonne', artist: 'Rammstein' })
  assert.match(prompt, /Sonne/)
  assert.match(prompt, /Rammstein/)
  // The sanctioned way to say "I do not know this song" — without it a small
  // model invents words, which is worse than showing nothing at all.
  assert.match(prompt, /\{"unknown": true\}/)
  // The shape it must answer with, and no instruction to invent timings.
  assert.match(prompt, /"lines": \[/)
  assert.doesNotMatch(prompt, /C:\\/, 'never send a file path')

  // Telling the model a file is 103 seconds long once made it pad a short edit
  // by looping one chorus line forever; the prompt must not name a length.
  assert.doesNotMatch(prompt, /103 seconds/)
  assert.doesNotMatch(prompt, /Length:/)

  // Empty fields are omitted rather than sent as blank labels.
  const bare = writeLyricsPrompt({ title: 'Unknown', artist: '' })
  assert.doesNotMatch(bare, /Artist:/)
})

test('a chorus looped forever is recognised as a failed write', () => {
  // What the model actually streamed for one track: one line, ~50 times, with
  // the JSON never completing. Such answers are discarded so the real match wins.
  const loop = Array.from({ length: 50 }, () => 'Die Sonne, die Sonne, die Sonne')
  assert.equal(isRepeatedWrite(loop), true)

  const real = [
    'Hier kommt die Sonne',
    'Sie ist der hellste Stern von allen',
    'Und wird nie vom Himmel fallen',
    'Die Strahlen haben uns verbrannt',
    'Doch nur die Sonne scheint bestand',
    'Verse zwei beginnt hier',
    'Noch eine Zeile mehr',
    'Und der Refrain kehrt zurück'
  ]
  assert.equal(isRepeatedWrite(real), false, 'a real chorus repeated a few times is fine')
  assert.equal(isRepeatedWrite(['a', 'b', 'c']), false, 'too short to judge')
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))
