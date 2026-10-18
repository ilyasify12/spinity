const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * Text-search instant resolve: yt-dlp prints one JSON object per result, so
 * titles with quotes, pipes or unicode can never mis-map the fields.
 * Fixtures mirror real yt-dlp output lines.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-instant-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/shared/instant.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'instant.cjs')
})
const {
  normalizeInstantQuery,
  parseInstantCandidates,
  parseInstantLine,
  INSTANT_CANDIDATE_TEMPLATE,
  INSTANT_PRINT_TEMPLATE
} = require(path.join(out, 'instant.cjs'))

test('query normalization collapses noise and caps length', () => {
  assert.equal(normalizeInstantQuery('  daft   punk\n\tharder '), 'daft punk harder')
  assert.equal(normalizeInstantQuery('a\u0000b\u001fc'), 'a b c')
  assert.equal(normalizeInstantQuery(undefined), '')
  assert.equal(normalizeInstantQuery('x'.repeat(500)).length, 200)
  assert.equal(normalizeInstantQuery('  \u0007  '), '')
})

test('the print template carries every field', () => {
  for (const field of ['id', 'title', 'url', 'ext', 'protocol']) {
    assert.ok(INSTANT_PRINT_TEMPLATE.includes(`%(${field})j`), `template must print ${field}`)
  }
  // Ids only: `%(field)j` prints a bare `NA` for missing fields, which is not
  // valid JSON — the candidate template must never request one.
  assert.equal(INSTANT_CANDIDATE_TEMPLATE, '{"id":%(id)j}')
})

test('parseInstantCandidates keeps ranked video ids and drops noise', () => {
  const stdout = [
    '{"id":"a5uQMwRMHcs"}',
    'not json at all',
    '{"id":"MPSPPLUH0nnSKG_yzJ1lrmA5p8FBDjB3XwpcGS"}', // browse/playlist id: too long
    '{"id":"a5uQMwRMHcs"}', // duplicate ranking entry
    '{"title":"no id field"}',
    '{"id":7}',
    '{"id":"sbTVZMJ9Z2I"}',
    ''
  ].join('\n')
  assert.deepEqual(parseInstantCandidates(stdout), ['a5uQMwRMHcs', 'sbTVZMJ9Z2I'])
  assert.deepEqual(parseInstantCandidates(''), [])
  assert.deepEqual(parseInstantCandidates(undefined), [])
})

test('parseInstantLine reads the last valid JSON line', () => {
  const line = JSON.stringify({
    id: 'kJQP7kiw5Fk',
    title: 'Luis Fonsi - Despacito ft. Daddy Yankee | "official"',
    url: 'https://rr3---sn-4g5e6nez.googlevideo.com/videoplayback?expire=1&sig=abc',
    ext: 'm4a',
    protocol: 'https'
  })
  const stdout = `[youtube:search] Extracting URL: ytmsearch1:despacito\n${line}\n`
  const got = parseInstantLine(stdout)
  assert.equal(got.videoId, 'kJQP7kiw5Fk')
  assert.equal(got.title, 'Luis Fonsi - Despacito ft. Daddy Yankee | "official"')
  assert.equal(got.ext, 'm4a')
  assert.equal(got.protocol, 'https')
  assert.ok(got.url.startsWith('https://rr3---'))
})

test('parseInstantLine skips noise and malformed lines', () => {
  const good = JSON.stringify({ id: 'abcdefghijk', title: 'ok', url: 'https://x.test/a', ext: 'm4a', protocol: 'https' })
  const stdout = [
    'not json at all',
    '{"id": 7}', // wrong types
    '{"id":"abcdefghijk","title":"missing url","url":null}', // %(url)j on a missing field
    '{"id":"ab","title":"id too short","url":"https://x.test/a"}',
    '{"id":"abcdefghijk","title":"bad url","url":"ftp://x.test/a"}',
    '{ broken json ',
    good,
    ''
  ].join('\n')
  const got = parseInstantLine(stdout)
  assert.equal(got.videoId, 'abcdefghijk')
  assert.equal(got.title, 'ok')
})

test('parseInstantLine returns null when nothing usable is printed', () => {
  assert.equal(parseInstantLine(''), null)
  assert.equal(parseInstantLine('WARNING: no formats found'), null)
  assert.equal(parseInstantLine(undefined), null)
})
