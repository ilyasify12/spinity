const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-lyrics-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/shared/lyrics.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'lyrics.cjs')
})
const { parseLrc, lyricIndexAt, autoLyricSync, lyricTimeFromAudio, audioTimeFromLyric, describeLyricSync, isForeignEdit, isStaleLyricSync } = require(path.join(out, 'lyrics.cjs'))

test('parses timestamps, drops metadata and empty lines', () => {
  const lines = parseLrc('[ar:Someone]\n[ti:Song]\n[00:12.00]Hello\n[01:02.500]World\n\n[02:00]   \n[03:04.5]End')
  assert.deepEqual(lines, [
    { t: 12, text: 'Hello' },
    { t: 62.5, text: 'World' },
    { t: 184.5, text: 'End' }
  ])
})

test('expands repeated timestamps on one line and sorts', () => {
  const lines = parseLrc('[00:20.00][00:10.00]Chorus')
  assert.deepEqual(lines, [
    { t: 10, text: 'Chorus' },
    { t: 20, text: 'Chorus' }
  ])
})

test('lyricIndexAt follows playback position', () => {
  const lines = [{ t: 0, text: 'a' }, { t: 10, text: 'b' }, { t: 20, text: 'c' }]
  assert.equal(lyricIndexAt(lines, -1), -1)
  assert.equal(lyricIndexAt(lines, 0), 0)
  assert.equal(lyricIndexAt(lines, 15), 1)
  assert.equal(lyricIndexAt(lines, 99), 2)
})

test('a sped-up or slowed file gets its timeline stretched automatically', () => {
  // 102s local file against a 272s reference: not a speed change but an edit.
  const cut = autoLyricSync(102, 272)
  assert.equal(cut.scale, 1, 'a 2.7x length difference is a cut, not a speed change')
  assert.equal(isForeignEdit(102, 272), true)

  // A slowed + reverb rip is ~1.25x longer, a sped-up one ~0.8x: both are
  // uniform speed changes, so scaling puts every line back on the beat.
  const slowed = autoLyricSync(340, 272)
  assert.ok(Math.abs(slowed.scale - 1.25) < 0.01)
  assert.equal(slowed.auto, true)
  const sped = autoLyricSync(218, 272)
  assert.ok(Math.abs(sped.scale - 0.8) < 0.01)

  // Same length (or unknown): untouched, so nothing can be made worse.
  assert.equal(autoLyricSync(272, 272).scale, 1)
  assert.equal(autoLyricSync(0, 272).scale, 1)
  assert.equal(autoLyricSync(272, 0).scale, 1)
})

test('sync maps the audio clock onto the lyrics and back', () => {
  const sync = { offsetMs: 1500, scale: 1, auto: false, refDurationSec: 0 }
  // Positive offset = the lyrics are shown later.
  assert.equal(lyricTimeFromAudio(10, sync), 8.5)
  // Click-to-seek must be the exact inverse, or tapping a line lands elsewhere.
  assert.equal(audioTimeFromLyric(8.5, sync), 10)

  const slowed = { offsetMs: 0, scale: 1.25, auto: true, refDurationSec: 340 }
  assert.equal(lyricTimeFromAudio(125, slowed), 100)
  assert.equal(audioTimeFromLyric(100, slowed), 125)
})

test('sync labels and the different-edit hint read correctly', () => {
  assert.equal(describeLyricSync({ offsetMs: 0, scale: 1, auto: true, refDurationSec: 0 }), 'in sync')
  assert.equal(describeLyricSync({ offsetMs: 750, scale: 1, auto: false, refDurationSec: 0 }), '+0.75s')
  assert.equal(describeLyricSync({ offsetMs: -750, scale: 1, auto: false, refDurationSec: 0 }), '−0.75s')
  assert.equal(describeLyricSync({ offsetMs: 0, scale: 0.92, auto: false, refDurationSec: 0 }), '×0.92')
  assert.equal(describeLyricSync({ offsetMs: 1000, scale: 0.92, auto: false, refDurationSec: 0 }), '+1s ×0.92')

  assert.equal(isForeignEdit(272, 272), false)
  assert.equal(isForeignEdit(191, 189), false, 'a couple of seconds is the same recording')
  assert.equal(isForeignEdit(182, 167), true, '15s of extra intro is audible, so say so')
  assert.equal(isForeignEdit(250, 272), true, 'even 8% is enough to hear')
  assert.equal(isForeignEdit(0, 272), false, 'an unknown duration must not claim a mismatch')
})

test('a timing fit is dropped when the match moves to another recording', () => {
  // The real bug: a "Fit speed ×0.70" clicked while the app was still matching
  // the 272s original, then the matcher found the 190s remix the file really is.
  // Applying the old scale to the new timings made the lyrics race ahead.
  const stale = { offsetMs: 250, scale: 0.702, auto: false, refDurationSec: 272, source: 'manual' }
  assert.equal(isStaleLyricSync(stale, 190), true, 'different recording: the fit cannot be reused')
  assert.equal(isStaleLyricSync(stale, 272), false, 'same recording: keep the user’s tuning')
  assert.equal(isStaleLyricSync(stale, 271), false, 'a second of drift is not a different recording')
  assert.equal(isStaleLyricSync({ ...stale, refDurationSec: 0 }, 190), false, 'unknown reference: keep it')
  assert.equal(isStaleLyricSync(stale, 0), false, 'unknown match: keep it')
})

// ---------------------------------------------------------------- text side
// `lyricsText.ts` is pure (no db/electron), so it can be bundled directly.
const textOut = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-lyricstext-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/main/lyricsText.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(textOut, 'lyricsText.cjs')
})
const { canFetchLyrics, parsePlainLyrics, parseLyricsText, scoreLyricHit, songTitleVariants, songWant, bestLyricMatch } = require(path.join(textOut, 'lyricsText.cjs'))

test('local files named 1.mp3 / 2.mp3 are never looked up', () => {
  for (const junk of ['1', '2', '03', 'Track 3', 'audio', 'Untitled', 'cd1']) {
    assert.equal(canFetchLyrics(junk, 'Unknown artist'), false, `${junk} must not be searched`)
  }
  assert.equal(canFetchLyrics('1', 'Radiohead'), false, 'a junk title stays junk even with a real artist')
})

test('real song names are searchable, with or without an artist', () => {
  assert.equal(canFetchLyrics('Bohemian Rhapsody', 'Queen'), true)
  assert.equal(canFetchLyrics('Slow mornings', 'Unknown artist'), true)
  assert.equal(canFetchLyrics('Ok', 'Radiohead'), true, 'a short title with a real artist still matches')
  assert.equal(canFetchLyrics('モニタリング', 'DECO*27'), true)
  assert.equal(canFetchLyrics('モニタリング spotdown.org', 'Music'), true, 'the site suffix is noise, the song name is not')
})

test('plain lyrics text becomes evenly spaced lines', () => {
  const lines = parsePlainLyrics('[Verse 1]\nHello there\n\n  World  ')
  assert.deepEqual(lines, [
    { t: 0, text: 'Hello there' },
    { t: 4, text: 'World' }
  ])
})

test('parseLyricsText prefers timestamps and falls back to plain text', () => {
  const synced = parseLyricsText('[00:12.00]Hello\n[00:20.00]World')
  assert.equal(synced.synced, true)
  assert.deepEqual(synced.lines, [{ t: 12, text: 'Hello' }, { t: 20, text: 'World' }])

  const plain = parseLyricsText('[ar:Someone]\n[ti:Song]\nJust words\nNo timestamps')
  assert.equal(plain.synced, false)
  assert.deepEqual(plain.lines.map((l) => l.text), ['Just words', 'No timestamps'])
})

test('name variants strip downloader noise before anything is searched', () => {
  const mono = songTitleVariants('モニタリング spotdown.org')
  assert.equal(mono[0], 'モニタリング', 'the clean name is searched first, so the site name never decides the match')
  assert.equal(songTitleVariants('Bohemian Rhapsody 320kbps')[0], 'Bohemian Rhapsody')
  assert.equal(songTitleVariants('https://y2mate.com Song Name')[0], 'Song Name')
  assert.equal(songTitleVariants('Song (Official Video) [HD].mp3')[0], 'Song')
  // A meaningful aside is kept for the precise attempt AND offered bare, which
  // is what finally resolves fan versions indexed under a shorter name.
  assert.deepEqual(songTitleVariants('Frisk ver. (Undertale Animation Parody)'), [
    'Frisk ver. (Undertale Animation Parody)',
    'Frisk ver.'
  ])
  // A remix/uploader reading is the last resort before the raw name.
  assert.deepEqual(songTitleVariants('Sonne remix by street Music [TIKTOK VERSION]'), [
    'Sonne remix by street Music [TIKTOK VERSION]',
    'Sonne remix by street Music',
    'Sonne'
  ])
})

test('the lyrics matcher accepts fan versions and swapped metadata', () => {
  // Real case: local "Frisk ver. (Undertale Animation Parody)" / "Stronger than you".
  const frisk = songWant('Frisk ver. (Undertale Animation Parody)', 'Stronger than you', 167)
  const response = {
    trackName: 'Stronger Than You Response (ver. Frisk) - Steven Universe(UndertaleFan)',
    artistName: 'Rebecca Sugar',
    duration: 167,
    syncedLyrics: '[00:01.00] hi'
  }
  assert.ok(scoreLyricHit(frisk, response) >= 0.9, 'bracketed version info must count as part of the title')

  // Swapped track/artist fields (real lrclib data for Murder In My Mind).
  const phonk = songWant('MURDER IN MY MIND', 'Kordhell', 145)
  const swapped = { trackName: 'kordhell', artistName: 'murder in my mind', duration: 128, syncedLyrics: '[00:01.00] x' }
  assert.ok(scoreLyricHit(phonk, swapped) >= 0.6, 'title and artist are often entered the wrong way round')

  // Unrelated songs score zero, so nothing is ever force-matched.
  assert.equal(scoreLyricHit(frisk, { trackName: 'Holiday In Cambodia', artistName: 'Dead Kennedys', duration: 260 }), 0)
  assert.equal(bestLyricMatch(frisk, [{ trackName: 'Holiday In Cambodia', artistName: 'Dead Kennedys' }]), null)
})

test('instrumental records still match so the panel can say why', () => {
  const want = songWant('Sahara (phonk)', 'Hensonn', 172)
  const best = bestLyricMatch(want, [{ trackName: 'Sahara (phonk edition)', artistName: 'Hensonn', duration: 172, instrumental: true }])
  assert.ok(best, 'an instrumental is a confident match, just without lyrics')
  assert.equal(best.hit.instrumental, true)
  assert.equal(Boolean(best.hit.syncedLyrics || best.hit.plainLyrics), false)
})

// ------------------------------------------- alignment against real captions
// Real data: the user's "Frisk ver. (Undertale Animation Parody)" file is 182s,
// lrclib's match is a 167s edit, and YouTube's auto-captions for the 182s video
// that *is* this file put the first sung line at 18.40s instead of 11.66s.
const FRISK_LINES = [
  { t: 11.66, text: "I didn't know what I got into" },
  { t: 14.05, text: "Somehow I can't go back even if I really wanted to" },
  { t: 16.94, text: 'So what more can I do?' },
  { t: 18.86, text: "Here, in the end, it's just me and you" },
  { t: 21.3, text: 'I never wanted to play by all the rules' },
  { t: 23.82, text: "A knife in hand, I'm playing out the part of the fool" },
  { t: 26.17, text: 'So here we go, you can judge me thoroughly' },
  { t: 28.66, text: "It's too late for apologies" }
]

const FRISK_CUES = [
  { t: 12.45, text: '[music]' },
  { t: 18.4, text: "I didn't know [music] what I got into." },
  { t: 20.88, text: "Somehow I can't go back even if I really" },
  { t: 23.28, text: 'wanted to. So what more can I do here?' },
  { t: 25.92, text: "In the [music] end it's just me and you." },
  { t: 28.16, text: 'I never wanted to play by all the rules.' },
  { t: 30.56, text: "And knife in hand, I'm playing at the" },
  { t: 32.32, text: 'heart of the fool. So here we go. You' },
  { t: 34.0, text: 'can judge me thoroughly. It’s too' },
  { t: 36.02, text: '[music] late for apologies. Go ahead and' }
]

const { alignLyricsToCues, parseCaptionCues } = require(path.join(textOut, 'lyricsText.cjs'))

test('captions of the exact recording fix a lyrics offset', () => {
  const fit = alignLyricsToCues(FRISK_LINES, FRISK_CUES)
  assert.ok(fit, 'the alignment must be found')
  // ~+6.7s later, no speed change: exactly the "words start before the singing"
  // complaint, measured rather than guessed.
  assert.ok(fit.offsetMs > 5000 && fit.offsetMs < 8500, `offset was ${fit.offsetMs}ms`)
  assert.ok(Math.abs(fit.scale - 1) < 0.05, `scale was ${fit.scale}`)
  assert.ok(fit.matches >= 6, `only ${fit.matches} lines matched`)
  assert.ok(fit.residualSec < 1.5)
})

test('alignment is refused when the captions do not describe these lyrics', () => {
  const unrelated = [
    { t: 5, text: 'totally different words here' },
    { t: 9, text: 'nothing at all in common' },
    { t: 13, text: 'another unrelated phrase' }
  ]
  assert.equal(alignLyricsToCues(FRISK_LINES, unrelated), null)
  assert.equal(alignLyricsToCues(FRISK_LINES, []), null)
  assert.equal(alignLyricsToCues([], FRISK_CUES), null)
})

test('caption formats parse into timed cues', () => {
  const json3 = JSON.stringify({
    events: [
      { tStartMs: 12450, segs: [{ utf8: '[music]' }] },
      { tStartMs: 18400, segs: [{ utf8: "I didn't know " }, { utf8: 'what I got into.' }] },
      { tStartMs: 20000, segs: [{ utf8: '\n' }] }
    ]
  })
  assert.deepEqual(parseCaptionCues(json3), [
    { t: 12.45, text: '[music]' },
    { t: 18.4, text: "I didn't know what I got into." }
  ])

  const vtt = ['WEBVTT', '', '00:00:12.450 --> 00:00:14.000', '[music]', '', '00:00:18.400 --> 00:00:21.000', 'I didn’t know what I got into'].join('\n')
  assert.deepEqual(parseCaptionCues(vtt), [
    { t: 12.45, text: '[music]' },
    { t: 18.4, text: 'I didn’t know what I got into' }
  ])
})

process.on('exit', () => {
  fs.rmSync(out, { recursive: true, force: true })
  fs.rmSync(textOut, { recursive: true, force: true })
})
