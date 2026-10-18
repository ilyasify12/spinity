const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

/**
 * Free-music adapters: every parser runs against recorded-shape fixtures and
 * every network call goes through an injected fetch stub, so the suite pins
 * down exactly what the UI will receive — without touching a live API.
 */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinity-freemusic-test-'))
buildSync({
  entryPoints: [path.join(__dirname, '../src/main/freeMusic.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(out, 'freeMusic.cjs')
})
const {
  parseDeezer,
  parseItunes,
  parseSpotify,
  parseArchiveSearch,
  parseArchiveItem,
  mergeHits,
  searchFree,
  parseRadioChannels,
  parsePls,
  resolveRadioStream,
  spotifySearchUrl,
  searchSpotify
} = require(path.join(out, 'freeMusic.cjs'))

// ------------------------------------------------------------ fixtures

const DEEZER = {
  data: [
    {
      id: 3135556,
      title: 'Harder, Better, Faster, Stronger',
      duration: 224,
      preview: 'https://cdns-preview-d.dzcdn.net/stream/c-deadbeef-0.mp3',
      link: 'https://www.deezer.com/track/3135556',
      artist: { name: 'Daft Punk' },
      album: {
        title: 'Discovery',
        cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/250x250-000000.jpg'
      }
    },
    // No preview URL: not playable, must be dropped.
    { id: 999, title: 'Preview Missing', duration: 100, artist: { name: 'Someone' } }
  ]
}

const ITUNES = {
  results: [
    {
      trackId: 697195164,
      trackName: 'Harder, Better, Faster, Stronger',
      artistName: 'Daft Punk',
      collectionName: 'Discovery',
      trackTimeMillis: 226013,
      previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/v4/x/y/mzaf_123.m4a',
      trackViewUrl: 'https://music.apple.com/us/album/x/697194953?i=697195164',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg'
    },
    {
      trackId: 2,
      trackName: 'Nothing Alike',
      artistName: 'Artist Two',
      collectionName: 'Other Album',
      trackTimeMillis: 180000,
      previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/v4/2.m4a',
      trackViewUrl: 'https://music.apple.com/us/album/something/1?i=2',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/y/100x100bb.jpg'
    }
  ]
}

const SPOTIFY = {
  tracks: {
    items: [
      {
        id: '4iV5W9uYEdYUVa79Axb7Rh',
        name: 'Harder, Better, Faster, Stronger',
        duration_ms: 224560,
        artists: [{ name: 'Daft Punk' }],
        album: { name: 'Discovery', images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273aa.jpg' }] },
        external_urls: { spotify: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh' }
      }
    ]
  }
}

const ARCHIVE_SEARCH = {
  response: {
    docs: [
      { identifier: 'moonlight-sonata-1905', title: 'Moonlight Sonata', creator: ['A Pianist'] },
      { identifier: 'no-audio-item', title: 'Sleeve Notes', creator: 'Nobody' }
    ]
  }
}

const ARCHIVE_META = {
  files: [
    { name: 'cover.jpg', format: 'JPEG' },
    { name: 'sub folder/Track 01.ogg', format: 'Ogg Vorbis', length: '60.2' },
    { name: 'track01.mp3', format: 'VBR MP3', length: '324.51' }
  ],
  metadata: { licenseurl: 'https://creativecommons.org/licenses/by/4.0/', collection: 'netlabels' }
}

const ARCHIVE_META_NO_AUDIO = { files: [{ name: 'notes.txt', format: 'Text' }], metadata: {} }
const ARCHIVE_META_ONLY_OGG = {
  files: [{ name: 'sub folder/Track 01.ogg', format: 'Ogg Vorbis', length: '60.2' }],
  metadata: {}
}
// Login-walled item: the file is private and the item is access-restricted.
const ARCHIVE_META_RESTRICTED = {
  files: [{ name: 'listen.mp3', format: 'VBR MP3', length: '100', private: true }],
  metadata: { 'access-restricted-item': 'true', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }
}
// Unrestricted item that still mixes a private mp3 with a public ogg.
const ARCHIVE_META_MIXED = {
  files: [
    { name: 'locked.mp3', format: 'VBR MP3', length: '100', private: true },
    { name: 'open.ogg', format: 'Ogg Vorbis', length: '90' }
  ],
  metadata: {}
}

const CHANNELS = {
  channels: [
    {
      id: 'groovesalad',
      title: 'Groove Salad',
      genre: 'ambient|electronic',
      description: 'A nicely chilled plate of ambient beats.',
      image: 'https://api.somafm.com/logos/120/groovesalad120.png',
      playlists: [
        { url: 'https://api.somafm.com/groovesalad.pls', format: 'mp3', quality: 'highest' },
        { url: 'https://api.somafm.com/groovesalad130.pls', format: 'aac', quality: 'highest' }
      ]
    },
    { id: 'broken', title: 'Broken Station', playlists: [] }
  ]
}

const PLS = '[playlist]\nNumberOfEntries=1\nFile1=https://ice4.somafm.com/groovesalad-128-mp3\nTitle1=SomaFM\n'

// ------------------------------------------------------------ helpers

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

function textRes(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => JSON.parse(text),
    text: async () => text
  }
}

// ------------------------------------------------------------ parsing

test('deezer payload maps to playable hits and drops preview-less rows', () => {
  const hits = parseDeezer(DEEZER)
  assert.equal(hits.length, 1)
  const hit = hits[0]
  assert.equal(hit.id, 'deezer:3135556')
  assert.equal(hit.provider, 'deezer')
  assert.equal(hit.title, 'Harder, Better, Faster, Stronger')
  assert.equal(hit.artist, 'Daft Punk')
  assert.equal(hit.album, 'Discovery')
  assert.equal(hit.durationSec, 224)
  assert.equal(hit.preview, true)
  assert.equal(hit.audioUrl, 'https://cdns-preview-d.dzcdn.net/stream/c-deadbeef-0.mp3')
  assert.equal(hit.pageUrl, 'https://www.deezer.com/track/3135556')
  assert.match(hit.artwork, /dzcdn\.net\/images\/cover/)
})

test('itunes payload upgrades artwork and keeps the preview URL', () => {
  const hits = parseItunes(ITUNES)
  assert.equal(hits.length, 2)
  const hit = hits[0]
  assert.equal(hit.id, 'itunes:697195164')
  assert.equal(hit.provider, 'itunes')
  assert.equal(hit.durationSec, 226)
  assert.equal(hit.preview, true)
  assert.match(hit.artwork, /600x600bb\.jpg$/)
  assert.match(hit.audioUrl, /audio-ssl\.itunes\.apple\.com/)
  assert.match(hit.pageUrl, /music\.apple\.com/)
})

test('spotify payload becomes link-out-only hits', () => {
  const hits = parseSpotify(SPOTIFY)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, 'spotify:4iV5W9uYEdYUVa79Axb7Rh')
  assert.equal(hits[0].audioUrl, undefined, 'no audio URL: the real recording opens in Spotify')
  assert.equal(hits[0].spotifyUrl, 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh')
  assert.equal(hits[0].durationSec, 225)
})

// ------------------------------------------------------------ merging

test('mergeHits collapses the same recording across providers', () => {
  const merged = mergeHits([...parseDeezer(DEEZER), ...parseItunes(ITUNES)])
  assert.equal(merged.length, 2, 'same song merged, the other track passes through')
  const daft = merged.find((h) => h.artist === 'Daft Punk')
  assert.equal(daft.provider, 'deezer', 'the higher-ranked provider wins when both are playable')
  assert.deepEqual(daft.alsoOn, ['itunes'])
  const other = merged.find((h) => h.artist === 'Artist Two')
  assert.equal(other.alsoOn, undefined)
})

test('a Spotify link-out folds into the playable row for the same track', () => {
  const merged = mergeHits([...parseDeezer(DEEZER), ...parseSpotify(SPOTIFY)])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].provider, 'deezer', 'the playable preview stays the row')
  assert.equal(merged[0].spotifyUrl, 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh')
  assert.deepEqual(merged[0].alsoOn, ['spotify'])
})

test('durations that disagree beyond tolerance are kept apart', () => {
  const long = { ...parseItunes(ITUNES)[0], durationSec: 400 }
  const merged = mergeHits([...parseDeezer(DEEZER), long])
  assert.equal(merged.length, 2, 'a 3-minute gap means a different recording')
})

// ------------------------------------------------------------ search

test('searchFree queries every provider and merges the results', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    const href = String(url)
    seen.push(href)
    assert.equal(typeof init?.signal, 'object', 'every request carries a timeout signal')
    if (href.includes('api.deezer.com')) return jsonRes(DEEZER)
    if (href.includes('itunes.apple.com')) return jsonRes(ITUNES)
    if (href.includes('advancedsearch')) return jsonRes(ARCHIVE_SEARCH)
    if (href.includes('/metadata/no-audio-item')) return jsonRes(ARCHIVE_META_NO_AUDIO)
    if (href.includes('/metadata/')) return jsonRes(ARCHIVE_META)
    if (href.includes('accounts.spotify.com')) {
      assert.match(init.headers.Authorization, /^Basic /)
      assert.equal(init.body, 'grant_type=client_credentials')
      return jsonRes({ access_token: 'tok-1', expires_in: 3600 })
    }
    if (href.includes('api.spotify.com')) {
      assert.equal(init.headers.Authorization, 'Bearer tok-1')
      return jsonRes(SPOTIFY)
    }
    throw new Error(`unexpected URL ${href}`)
  }

  const hits = await searchFree({
    query: 'daft punk',
    limit: 10,
    fetchImpl,
    spotify: { clientId: 'cid', clientSecret: 'secret' }
  })

  // Same song from four providers → one row; then the iTunes extra and the
  // playable Internet Archive item; the no-audio archive item drops out.
  assert.equal(hits.length, 3)
  const daft = hits.find((h) => h.artist === 'Daft Punk')
  assert.equal(daft.provider, 'deezer')
  assert.equal(daft.spotifyUrl, 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh')
  assert.deepEqual([...daft.alsoOn].sort(), ['itunes', 'spotify'])
  assert.equal(hits.filter((h) => h.provider === 'archive').length, 1, 'the no-audio archive item is dropped')

  // The archive item with an audio file is kept when it has one.
  assert.equal(seen.some((u) => u.includes('advancedsearch')), true)
})

test('searchFree survives a provider going down', async () => {
  const fetchImpl = async (url) => {
    const href = String(url)
    if (href.includes('api.deezer.com')) throw new Error('ECONNREFUSED')
    if (href.includes('itunes.apple.com')) return jsonRes(ITUNES)
    if (href.includes('archive.org')) return jsonRes({ response: { docs: [] } })
    throw new Error('no')
  }
  const hits = await searchFree({ query: 'x y', fetchImpl, providers: ['deezer', 'itunes', 'archive'] })
  assert.equal(hits.length, 2, 'Apple results still arrive when Deezer fails')
})

test('spotify credentials are exchanged once and reused', async () => {
  let tokenCalls = 0
  const fetchImpl = async (url) => {
    const href = String(url)
    if (href.includes('accounts.spotify.com')) {
      tokenCalls++
      return jsonRes({ access_token: 'tok-reuse', expires_in: 3600 })
    }
    if (href.includes('api.spotify.com')) return jsonRes(SPOTIFY)
    throw new Error(`unexpected ${href}`)
  }
  const first = await searchSpotify(fetchImpl, 5000, 'daft', 5, 'client-reuse', 'secret')
  const second = await searchSpotify(fetchImpl, 5000, 'punk', 5, 'client-reuse', 'secret')
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)
  assert.equal(tokenCalls, 1, 'the token is cached until it expires')
})

// ------------------------------------------------------------ archive

test('archive search + item metadata produce a full-length CC hit', () => {
  const docs = parseArchiveSearch(ARCHIVE_SEARCH)
  assert.equal(docs.length, 2)
  assert.deepEqual(docs[0], { identifier: 'moonlight-sonata-1905', title: 'Moonlight Sonata', creator: 'A Pianist' })

  const hit = parseArchiveItem(docs[0], ARCHIVE_META)
  assert.equal(hit.id, 'archive:moonlight-sonata-1905')
  assert.equal(hit.provider, 'archive')
  assert.equal(hit.preview, false, 'catalogue tracks are full length')
  assert.equal(hit.durationSec, 325)
  assert.equal(hit.audioUrl, 'https://archive.org/download/moonlight-sonata-1905/track01.mp3', 'the VBR MP3 wins over the Ogg')
  assert.equal(hit.license, 'https://creativecommons.org/licenses/by/4.0/')
  assert.equal(hit.pageUrl, 'https://archive.org/details/moonlight-sonata-1905')

  const oggOnly = parseArchiveItem(docs[0], ARCHIVE_META_ONLY_OGG)
  assert.equal(oggOnly.audioUrl, 'https://archive.org/download/moonlight-sonata-1905/sub%20folder/Track%2001.ogg', 'subfolder paths stay intact, segments escaped')

  assert.equal(parseArchiveItem(docs[1], ARCHIVE_META_NO_AUDIO), null, 'an item without audio is not playable')
  assert.equal(parseArchiveItem(docs[0], ARCHIVE_META_RESTRICTED), null, 'login-walled items are dropped (their files 401)')
  assert.match(
    parseArchiveItem(docs[0], ARCHIVE_META_MIXED).audioUrl,
    /open\.ogg$/,
    'a private file is skipped in favour of a public one'
  )
})

// ------------------------------------------------------------ radio

test('radio channels keep only tunable stations', () => {
  // The live endpoint wraps the list as {"channels": […]}; the bare-array
  // shape must keep working too.
  const wrapped = parseRadioChannels(CHANNELS)
  const bare = parseRadioChannels(CHANNELS.channels)
  assert.equal(wrapped.length, 1)
  assert.equal(bare.length, 1)
  assert.equal(wrapped[0].id, 'groovesalad')
  assert.equal(wrapped[0].plsUrl, 'https://api.somafm.com/groovesalad.pls', 'the highest-quality mp3 playlist is used')
  assert.equal(wrapped[0].genre, 'ambient|electronic')
  assert.equal(wrapped[0].image, 'https://api.somafm.com/logos/120/groovesalad120.png')
})

test('a .pls playlist resolves to the direct stream URL', async () => {
  assert.equal(parsePls(PLS), 'https://ice4.somafm.com/groovesalad-128-mp3')
  assert.equal(parsePls('nothing here'), null)

  const fetchImpl = async (url) => {
    assert.equal(String(url), 'https://somafm.com/groovesalad.pls')
    return textRes(PLS)
  }
  const direct = await resolveRadioStream(fetchImpl, 'https://somafm.com/groovesalad.pls')
  assert.equal(direct, 'https://ice4.somafm.com/groovesalad-128-mp3')

  await assert.rejects(
    resolveRadioStream(fetchImpl, 'https://elsewhere.example/station.pls'),
    /host not allowed/,
    'a station outside the catalogue is refused before any fetch'
  )
})

test('spotifySearchUrl produces a shareable link for any query', () => {
  assert.equal(spotifySearchUrl(' daft punk '), 'https://open.spotify.com/search/daft%20punk')
})

process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }))
