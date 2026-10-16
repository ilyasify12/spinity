'use strict';
// Native shell (website/player/native.js): the APK has no server, so the shim
// answers every /api/... call itself. These tests run it against a fake
// Capacitor bridge (SpinityBridge + TermuxBridge + Filesystem): nothing here
// touches a real phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'website', 'player', 'native.js'), 'utf8');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function makeLocalStorage() {
  return {
    _d: {},
    get length() { return Object.keys(this._d).length; },
    key(i) { return Object.keys(this._d)[i] ?? null; },
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  };
}

/**
 * @param {object} opts
 * @param {boolean} opts.native
 * @param {'termux'|'embedded'} [opts.engine]   which download engine to fake
 * @param {object} [opts.bridge]                mutable fake-bridge state
 * @param {Array}  [opts.bridge.files]          scanAudio file list (mutable)
 * @param {Array}  [opts.bridge.meta]           scanAudio metadata list
 */
function makeSandbox({ native, engine = 'termux', bridge = {}, db }) {
  const files = { 'Download/Spinity/existing.mp3': b64('OLD') };
  const execs = [];
  const intervals = [];
  const bridgeCalls = [];
  const bridgeState = {
    available: engine === 'embedded',
    initializing: false,
    error: engine === 'embedded' ? undefined : 'no engine in this build',
    version: '2026.01.01',
    files: [],
    meta: [],
    importCount: 0,
    roots: {
      audio: '/storage/emulated/0/Download/Spinity/audio',
      music: '/storage/emulated/0/Music',
      downloads: '/storage/emulated/0/Download'
    },
    ...bridge
  };
  if (engine === 'embedded' && !bridgeState.searchEntries) {
    bridgeState.searchEntries = [
      { id: 'abc123', title: 'Centuries', channel: 'Fall Out Boy', duration: 200, thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }] }
    ];
  }

  const sandbox = {
    console,
    Promise, JSON, Date, Math, Object,
    Response, URLSearchParams, TextDecoder, atob,
    setTimeout, clearTimeout,
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); intervals.push(id); return id; },
    clearInterval,
    localStorage: makeLocalStorage(),
    sessionStorage: makeLocalStorage(),
    navigator: {},
    Capacitor: {
      isNativePlatform: () => native,
      convertFileSrc: (p) => 'https://localhost/_capacitor_file_' + p,
      Plugins: {
        Filesystem: {
          async readFile({ path: p }) {
            if (!(p in files)) throw new Error('File does not exist');
            return { data: files[p] };
          },
          async stat({ path: p }) {
            if (!(p in files)) throw new Error('File does not exist');
            return {};
          }
        },
        SpinityBridge: {
          async ytdlpAvailable() {
            bridgeCalls.push({ method: 'ytdlpAvailable' });
            return {
              available: bridgeState.available,
              initializing: bridgeState.initializing,
              error: bridgeState.error,
              version: bridgeState.version
            };
          },
          async ytdlpSearch(opts) {
            bridgeCalls.push({ method: 'ytdlpSearch', ...opts });
            return { entries: bridgeState.searchEntries || [] };
          },
          async ytdlpDownload(opts) {
            bridgeCalls.push({ method: 'ytdlpDownload', ...opts });
            files[`Download/Spinity/audio/${opts.videoId}.mp3`] = b64('MP3DATA');
            return { jobId: 'ejob1' };
          },
          async ytdlpJob(opts) {
            bridgeCalls.push({ method: 'ytdlpJob', ...opts });
            return { state: 'done', progress: 100, path: '/storage/emulated/0/Download/Spinity/audio/abc123.mp3' };
          },
          async ytdlpUpdate() {
            bridgeCalls.push({ method: 'ytdlpUpdate' });
            return { status: 'DONE' };
          },
          async scanAudio(opts) {
            bridgeCalls.push({ method: 'scanAudio', ...opts });
            return {
              roots: bridgeState.roots,
              needPermission: false,
              files: bridgeState.files,
              meta: bridgeState.meta
            };
          },
          async importAudio() {
            bridgeCalls.push({ method: 'importAudio' });
            return { count: bridgeState.importCount };
          }
        },
        TermuxBridge: {
          async status() { return { termuxInstalled: true, filesAccess: true, sdk: 34 }; },
          async requestFilesAccess() { return {}; },
          async openTermux() { return {}; },
          async exec({ cmd }) {
            execs.push(cmd);
            const id = (cmd.match(/jobs\/([a-z0-9]+)\.code/) || [])[1];
            if (!id) throw new Error('no job id in command');
            setTimeout(() => {
              if (id[0] === 's') {
                files[`Download/Spinity/jobs/${id}.code`] = b64('0\n');
                files[`Download/Spinity/jobs/${id}.json`] = b64(JSON.stringify({
                  entries: [
                    { id: 'abc123', title: 'Centuries', channel: 'Fall Out Boy', duration: 200, thumbnails: [{ url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' }] },
                    { id: 'def456', title: 'Thnks fr th Mmrs', uploader: 'Fall Out Boy', duration: 183 }
                  ]
                }));
              } else {
                const vid = (cmd.match(/-o '([A-Za-z0-9_-]+)\.%\(ext\)s'/) || [])[1];
                files[`Download/Spinity/audio/${vid}.mp3`] = b64('MP3DATA');
                files[`Download/Spinity/jobs/${id}.code`] = b64('0\n');
              }
            }, 20);
            return {};
          }
        }
      }
    }
  };

  const lrclib = [{ trackName: 'Centuries', duration: 200, syncedLyrics: '[00:01.00] hello', plainLyrics: 'hello' }];
  sandbox.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://lrclib.net/')) {
      return { ok: true, status: 200, json: async () => lrclib };
    }
    throw new Error('unexpected fetch: ' + url);
  };
  sandbox.origFetch = sandbox.fetch;

  sandbox.window = sandbox;
  sandbox.document = { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, remove() {}, querySelector: () => null, select() {} }), body: { appendChild() {} }, addEventListener() {} };
  sandbox.addEventListener = () => {};

  if (db) sandbox.localStorage._d['spinity-native:db:v1'] = JSON.stringify(db);

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'native.js' });
  sandbox.cleanup = () => intervals.forEach(clearInterval);
  sandbox.files = files;
  sandbox.execs = execs;
  sandbox.bridgeCalls = bridgeCalls;
  sandbox.bridgeState = bridgeState;
  return sandbox;
}

const getJson = async (sb, url, init) => (await sb.window.fetch(url, init)).json();
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const runScan = (sb) => sb.window.spinitySettings.scanNow();

test('native: seeds the token and routes library / me / likes', async () => {
  const sb = makeSandbox({ native: true });
  try {
    assert.equal(sb.localStorage.getItem('spinity-web:token'), 'native');
    assert.equal(await getJson(sb, '/api/library').then((j) => j.tracks.length), 0);
    const me = await getJson(sb, '/api/me');
    assert.equal(me.user.name, 'You');
    assert.deepEqual(me.likedIds, []);

    const liked = await getJson(sb, '/api/like', post({ id: 'yt_abc123', like: true }));
    assert.deepEqual(liked.likedIds, ['yt_abc123']);
    const unliked = await getJson(sb, '/api/like', post({ id: 'yt_abc123', like: false }));
    assert.deepEqual(unliked.likedIds, []);
  } finally { sb.cleanup(); }
});

test('native: playlists create / add / remove / delete', async () => {
  const sb = makeSandbox({ native: true });
  try {
    const pl = await getJson(sb, '/api/playlists', post({ name: 'Chill' }));
    assert.equal(pl.name, 'Chill');
    await getJson(sb, `/api/playlists/${pl.id}/tracks`, post({ trackId: 'yt_abc123' }));
    let me = await getJson(sb, '/api/me');
    assert.deepEqual(me.playlists[0].trackIds, ['yt_abc123']);

    const del = await sb.window.fetch(`/api/playlists/${pl.id}/tracks/yt_abc123`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    me = await getJson(sb, '/api/me');
    assert.deepEqual(me.playlists[0].trackIds, []);

    await sb.window.fetch(`/api/playlists/${pl.id}`, { method: 'DELETE' });
    me = await getJson(sb, '/api/me');
    assert.deepEqual(me.playlists, []);
  } finally { sb.cleanup(); }
});

test('native: search uses the bundled engine when it is up (no Termux involved)', async () => {
  const sb = makeSandbox({ native: true, engine: 'embedded' });
  try {
    const rows = await getJson(sb, '/api/ytsearch?q=fall%20out%20boy');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'yt_abc123');
    assert.equal(rows[0].title, 'Centuries');
    assert.equal(rows[0].artist, 'Fall Out Boy');
    assert.equal(rows[0].durationSec, 200);
    assert.equal(rows[0].thumbnail, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');
    assert.equal(sb.execs.length, 0); // Termux untouched
    const search = sb.bridgeCalls.find((c) => c.method === 'ytdlpSearch');
    assert.equal(search.q, 'fall out boy');
    assert.equal(search.limit, 12);
  } finally { sb.cleanup(); }
});

test('native: with no bundled engine, search falls back to yt-dlp via Termux', async () => {
  const sb = makeSandbox({ native: true, engine: 'termux' });
  try {
    const rows = await getJson(sb, '/api/ytsearch?q=fall%20out%20boy');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'yt_abc123');
    assert.equal(rows[0].title, 'Centuries');
    assert.equal(rows[0].artist, 'Fall Out Boy');
    assert.equal(rows[0].durationSec, 200);
    assert.equal(rows[0].thumbnail, 'https://i.ytimg.com/vi/abc123/hqdefault.jpg');
    // second entry has no thumbnails array -> deterministic fallback url
    assert.equal(rows[1].thumbnail, 'https://i.ytimg.com/vi/def456/hqdefault.jpg');
    assert.equal(rows[1].artist, 'Fall Out Boy');

    assert.equal(sb.execs.length, 1);
    assert.match(sb.execs[0], /yt-dlp -J/);
    assert.match(sb.execs[0], /'ytsearch12:fall out boy'/);
    assert.match(sb.execs[0], /echo \$\? > "\$HOME\/storage\/downloads\/Spinity\/jobs\//);
  } finally { sb.cleanup(); }
});

test('native: save with the bundled engine downloads and lands in the library', async () => {
  const sb = makeSandbox({ native: true, engine: 'embedded' });
  try {
    const track = { id: 'yt_abc123', title: 'Centuries', artist: 'Fall Out Boy', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' };
    const save = await getJson(sb, '/api/save', post(track));
    assert.deepEqual(save, { ok: true });
    assert.equal((await getJson(sb, '/api/library')).tracks.length, 0); // not yet

    const dl = sb.bridgeCalls.find((c) => c.method === 'ytdlpDownload');
    assert.equal(dl.videoId, 'abc123');
    assert.equal(sb.execs.length, 0); // no Termux

    await new Promise((r) => setTimeout(r, 2600)); // one poller tick
    const lib = await getJson(sb, '/api/library');
    assert.equal(lib.tracks.length, 1);
    assert.equal(lib.tracks[0].id, 'yt_abc123');
    assert.equal(lib.tracks[0].file, '/storage/emulated/0/Download/Spinity/audio/abc123.mp3');

    const stream = await sb.window.fetch('/api/stream?id=yt_abc123');
    assert.equal(stream.status, 200);
    assert.equal(Buffer.from(await stream.arrayBuffer()).toString('utf8'), 'MP3DATA');
  } finally { sb.cleanup(); }
});

test('native: save without the engine still works through Termux', async () => {
  const sb = makeSandbox({ native: true, engine: 'termux' });
  try {
    const track = { id: 'yt_abc123', title: 'Centuries', artist: 'Fall Out Boy', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' };
    const save = await getJson(sb, '/api/save', post(track));
    assert.deepEqual(save, { ok: true });
    assert.equal((await getJson(sb, '/api/library')).tracks.length, 0);

    // let the fake Termux finish + one poller tick (2s interval)
    await new Promise((r) => setTimeout(r, 2600));
    const lib = await getJson(sb, '/api/library');
    assert.equal(lib.tracks.length, 1);
    assert.equal(lib.tracks[0].id, 'yt_abc123');
    assert.equal(lib.tracks[0].file, '/storage/emulated/0/Download/Spinity/audio/abc123.mp3');

    const stream = await sb.window.fetch('/api/stream?id=yt_abc123');
    assert.equal(stream.status, 200);
    assert.equal(stream.headers.get('content-length'), '7');
    assert.equal(Buffer.from(await stream.arrayBuffer()).toString('utf8'), 'MP3DATA');
  } finally { sb.cleanup(); }
});

test('native: local scan merges phone files with real metadata + covers', async () => {
  const sb = makeSandbox({
    native: true,
    bridge: {
      files: [
        { path: '/storage/emulated/0/Download/Spinity/audio/mine.mp3', name: 'mine.mp3', size: 111, mtime: 1000 },
        { path: '/storage/emulated/0/Music/Album/track_two.flac', name: 'track_two.flac', size: 222, mtime: 2000 }
      ],
      meta: [
        { path: '/storage/emulated/0/Download/Spinity/audio/mine.mp3', title: 'My Song', artist: 'Me', durationSec: 180, cover: '/storage/emulated/0/Download/Spinity/covers/abc.jpg' },
        { path: '/storage/emulated/0/Music/Album/track_two.flac', title: 'Track Two', artist: 'Band', durationSec: 200 }
      ]
    }
  });
  try {
    const r = await runScan(sb);
    assert.equal(r.total, 2);
    assert.equal(r.added, 2);

    const scan = sb.bridgeCalls.find((c) => c.method === 'scanAudio');
    assert.equal(scan.folders.join(','), 'audio,music'); // default options
    assert.deepEqual(JSON.parse(scan.knownJson), {});

    const lib = await getJson(sb, '/api/library');
    assert.equal(lib.tracks.length, 2);
    const mine = lib.tracks.find((t) => /mine\.mp3$/.test(t.file));
    assert.match(mine.id, /^loc_/);
    assert.equal(mine.title, 'My Song');
    assert.equal(mine.artist, 'Me');
    assert.equal(mine.durationSec, 180);
    assert.equal(mine.source, 'local');
    assert.equal(mine.thumbnail, 'https://localhost/_capacitor_file_/storage/emulated/0/Download/Spinity/covers/abc.jpg');

    const two = lib.tracks.find((t) => /track_two\.flac$/.test(t.file));
    assert.equal(two.title, 'Track Two');
    assert.equal(two.thumbnail, ''); // no embedded art: never a guessed image

    // rescan sends the known cache back so the bridge can skip tag parsing
    await runScan(sb);
    const scans = sb.bridgeCalls.filter((c) => c.method === 'scanAudio');
    const known = JSON.parse(scans[scans.length - 1].knownJson);
    assert.equal(known['/storage/emulated/0/Download/Spinity/audio/mine.mp3'], '1000:111');
  } finally { sb.cleanup(); }
});

test('native: scanned files the user deleted disappear on the next scan', async () => {
  const bridge = {
    files: [{ path: '/storage/emulated/0/Music/gone.mp3', name: 'gone.mp3', size: 10, mtime: 5 }],
    meta: [{ path: '/storage/emulated/0/Music/gone.mp3', title: 'Gone', artist: 'Someone' }]
  };
  const sb = makeSandbox({ native: true, bridge });
  try {
    await runScan(sb);
    assert.equal((await getJson(sb, '/api/library')).tracks.length, 1);
    sb.bridgeState.files = [];
    sb.bridgeState.meta = [];
    await runScan(sb);
    assert.equal((await getJson(sb, '/api/library')).tracks.length, 0);
  } finally { sb.cleanup(); }
});

test('native: scan never duplicates a track yt-dlp already downloaded', async () => {
  const file = '/storage/emulated/0/Download/Spinity/audio/abc123.mp3';
  const sb = makeSandbox({
    native: true,
    db: {
      user: { name: 'You' }, likedIds: [], playlists: [],
      tracks: [{ id: 'yt_abc123', title: 'Centuries', artist: 'Fall Out Boy', durationSec: 200, file, source: 'youtube' }]
    },
    bridge: { files: [{ path: file, name: 'abc123.mp3', size: 7, mtime: 9 }], meta: [] }
  });
  try {
    await runScan(sb);
    const lib = await getJson(sb, '/api/library');
    assert.equal(lib.tracks.length, 1);
    assert.equal(lib.tracks[0].id, 'yt_abc123'); // keeps its richer metadata
  } finally { sb.cleanup(); }
});

test('native: settings API exposes state, persists options and imports', async () => {
  const sb = makeSandbox({ native: true, bridge: { importCount: 2 } });
  try {
    const st = sb.window.spinitySettings.state();
    assert.equal(st.options.music, true);
    assert.equal(st.options.downloads, false);
    assert.equal(st.options.autoScan, true);
    assert.equal(st.roots.audio, '/storage/emulated/0/Download/Spinity/audio');

    sb.window.spinitySettings.setOption('music', false);
    sb.window.spinitySettings.setOption('downloads', true);
    const saved = JSON.parse(sb.localStorage.getItem('spinity-native:scan:v1'));
    assert.equal(saved.options.music, false);
    assert.equal(saved.options.downloads, true);

    // toggling triggers a rescan (the second toggle lands while the first
    // scan still runs, so settle it, then rescan explicitly)
    await new Promise((r) => setTimeout(r, 20));
    await runScan(sb);
    const scans = sb.bridgeCalls.filter((c) => c.method === 'scanAudio');
    assert.equal(scans[scans.length - 1].folders.join(','), 'audio,downloads');

    await sb.window.spinitySettings.importAudio();
    assert.ok(sb.bridgeCalls.some((c) => c.method === 'importAudio'));

    const refreshed = await sb.window.spinitySettings.refresh();
    assert.equal(refreshed.engine.available, false); // default fake: no engine
    assert.equal(refreshed.engine.termuxInstalled, true);
  } finally { sb.cleanup(); }
});

test('native: lyrics come from lrclib and are cached', async () => {
  const sb = makeSandbox({
    native: true,
    db: {
      user: { name: 'You' }, likedIds: [], playlists: [],
      tracks: [{ id: 'yt_abc123', title: 'Centuries', artist: 'Fall Out Boy - Topic', durationSec: 200, file: '/storage/emulated/0/Download/Spinity/audio/abc123.mp3' }]
    }
  });
  try {
    const j = await getJson(sb, '/api/lyrics?id=yt_abc123');
    assert.equal(j.synced, '[00:01.00] hello');
    assert.equal(j.plain, 'hello');
    assert.ok(sb.localStorage.getItem('spinity-native:lrc:yt_abc123'));
  } finally { sb.cleanup(); }
});

test('browser: native.js is a no-op outside the APK', async () => {
  const sb = makeSandbox({ native: false });
  try {
    assert.equal(sb.localStorage.getItem('spinity-web:token'), null);
    assert.equal(sb.window.fetch, sb.origFetch); // fetch not wrapped
    assert.equal(sb.window.spinityStreamSrc({ id: 'x' }), '/api/stream?id=x');
    assert.equal(sb.window.spinityDownloadHref({ id: 'x' }), '/api/download?id=x');
    assert.equal(sb.window.spinitySettings, undefined);
    assert.equal(sb.execs.length, 0);
  } finally { sb.cleanup(); }
});
