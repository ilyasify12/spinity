'use strict';
// Native shell (website/player/native.js): the APK has no server, so the shim
// answers every /api/... call itself. These tests run it against a fake
// Capacitor bridge and a fake Termux: nothing here touches a real phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'website', 'player', 'native.js'), 'utf8');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function makeSandbox({ native, db }) {
  const files = { 'Download/Spinity/existing.mp3': b64('OLD') };
  const execs = [];
  const intervals = [];

  const sandbox = {
    console,
    Promise, JSON, Date, Math,
    Response, URLSearchParams, TextDecoder, atob,
    setTimeout, clearTimeout,
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); intervals.push(id); return id; },
    clearInterval,
    localStorage: {
      _d: {},
      getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    sessionStorage: {
      _d: {},
      getItem(k) { return k in this._d ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
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
  return sandbox;
}

const getJson = async (sb, url, init) => (await sb.window.fetch(url, init)).json();
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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

test('native: ytsearch runs yt-dlp through Termux and maps the results', async () => {
  const sb = makeSandbox({ native: true });
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

test('native: save downloads and the track only appears once the mp3 exists', async () => {
  const sb = makeSandbox({ native: true });
  try {
    const track = { id: 'yt_abc123', title: 'Centuries', artist: 'Fall Out Boy', durationSec: 200, thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg' };
    const save = await getJson(sb, '/api/save', post(track));
    assert.deepEqual(save, { ok: true });
    // not in the library yet: the file is still downloading
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
    assert.equal(sb.execs.length, 0);
  } finally { sb.cleanup(); }
});
