// Headless smoke test for website/player/index.html's script (template + wave logic).
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, 'player', 'index.html'), 'utf8')
const m = /<script>([\s\S]*)<\/script>/.exec(html)
if (!m) { console.error('FAIL no script'); process.exit(1) }

const stubs = `
class FakeEl {
  constructor(id) {
    this.id = id; this._html = ''; this.style = {}; this.dataset = {};
    this.title = ''; this.textContent = ''; this.tabIndex = 0;
    this.className = ''; this.value = ''; this.disabled = false;
    this._kids = null; this.onsubmit = null;
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c), remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, f) => { const on = f === undefined ? !set.has(c) : f; on ? set.add(c) : set.delete(c); return on; }
    };
  }
  set innerHTML(v) {
    this._html = String(v);
    // Model children when this is the waveform (updateProgress reads el.children).
    this._kids = this._html.includes('wave-bar')
      ? [...this._html.matchAll(/class="([^"]*)"/g)].map((mm) => {
          const cls = new Set(mm[1].split(/\s+/).filter(Boolean));
          return {
            _cls: cls,
            classList: {
              contains: (c) => cls.has(c),
              add: (c) => cls.add(c),
              remove: (c) => cls.delete(c),
              toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : f; on ? cls.add(c) : cls.delete(c); return on; }
            }
          };
        })
      : null;
  }
  get innerHTML() {
    if (this._kids) return this._kids.map((k) => '<span class="' + [...k._cls].join(' ') + '"></span>').join('');
    return this._html;
  }
  get children() { return this._kids || []; }
  setAttribute(k, v) { this['attr_' + k] = String(v) }
  getAttribute(k) { return this['attr_' + k] ?? null }
  removeAttribute(k) { delete this['attr_' + k] }
  querySelectorAll() { return [] }
  querySelector() { return null }
  appendChild() {}
  remove() {}
  focus() {}
  setSelectionRange() {}
  addEventListener() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 } }
}
const __els = {};
const __el = (id) => (__els[id] = __els[id] || new FakeEl(id));
__el('audio').volume = 1; __el('audio').muted = false; __el('audio').paused = true;
__el('audio').currentTime = 0; __el('audio').duration = 0; __el('audio').src = '';
__el('audio').play = () => { __el('audio').paused = false; return Promise.resolve() };
__el('audio').pause = () => { __el('audio').paused = true };
globalThis.document = {
  getElementById: (id) => __el(id),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: (t) => new FakeEl(t),
  addEventListener: () => {},
  body: new FakeEl('body'),
  title: ''
};
globalThis.localStorage = {
  getItem: (k) => (k === 'spinity-web:token' ? 'test-token' : null),
  setItem: () => {}, removeItem: () => {}
};
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  if (u.startsWith('/api/library')) return json({ tracks: [], playlists: [] });
  if (u.startsWith('/api/me')) return json({ user: { name: 'Tester' }, likedIds: [], playlists: [] });
  if (u.startsWith('/api/probe')) return json({ label: 'MP3 · 44.1 kHz · 256 kbps', title: 'MP3 · 44.1 kHz · 256 kbps · 2ch' });
  if (u.startsWith('/api/like')) return json({ likedIds: [] });
  if (u.startsWith('/api/stream')) return { ok: true, status: 200, headers: { get: () => '1000' }, arrayBuffer: async () => new ArrayBuffer(8) };
  return json({});
};
globalThis.history = { back() {}, forward() {}, pushState() {}, replaceState() {} };
globalThis.window = globalThis;
globalThis.navigator = {};
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = () => {};
globalThis.location = { origin: 'http://localhost:8901', href: 'http://localhost:8901/player/' };
globalThis.prompt = () => null;
globalThis.confirm = () => false;
globalThis.__el = __el;
`

const tail = `
;(async () => {
  const ok = (name, cond) => console.log((cond ? 'PASS ' : 'FAIL ') + name);
  await new Promise((r) => setTimeout(r, 80));
  const app = __el('app');
  ok('shell rendered', app.innerHTML.includes('class="player"'));
  ok('idle hint (app copy)', app.innerHTML.includes('Nothing playing — pick a track.'));
  ok('wave slot present', app.innerHTML.includes('id="bar2"'));
  ok('no heart button in bar', !app.innerHTML.includes('now-like'));
  ok('vol fill inline', app.innerHTML.includes('linear-gradient'));

  queue = [{ id: 't1', title: 'Song One', artist: 'Artist A', durationSec: 180, thumbnail: null }];
  index = 0; byId.set('t1', queue[0]);
  loadTrack(queue[0], false);
  const h1 = app.innerHTML;
  ok('now playing title', h1.includes('Song One'));
  ok('artwork fallback tile', h1.includes('now-artwork'));
  ok('play button enabled', h1.includes('ctrl ctrl-play') && !/id="btn-play"[^>]*disabled/.test(h1));
  ok('repeat one badge off', !h1.includes('margin-left:-4px'));
  ok('t-end from duration', h1.includes('3:00'));

  await new Promise((r) => setTimeout(r, 60));
  const codec = __el('now-codec');
  ok('codec tag filled', codec && codec.textContent.includes('MP3 · 44.1 kHz · 256 kbps'));

  wavePeaks.set('t1', { d: 180, p: Array.from({ length: 180 }, (_, i) => (i % 10) / 10) });
  paintWave();
  const bar = __el('bar2');
  ok('waveform bars mode', bar.className === 'waveform');
  ok('180 wave bars', String(bar.innerHTML).split('wave-bar').length === 181);
  ok('seek keyboard bound', typeof bar.onkeydown === 'function');

  audio.currentTime = 90;
  updateProgress();
  ok('time text 1:30', __el('t-cur').textContent === '1:30');
  ok('aria-valuenow updated', bar['attr_aria-valuenow'] === '90');
  ok('played bars marked', String(bar.innerHTML).split('wave-bar played').length === 91);

  wavePeaks.delete('t1');
  paintWave();
  ok('flat fallback mode', bar.className === 'wave-flat' && String(bar.style.background).includes('accent'));

  repeat = 'one';
  queue = [{ id: 't1', title: 'Song One', artist: 'A', durationSec: 180, thumbnail: null }];
  index = 0; render();
  ok('repeat-one badge on', app.innerHTML.includes('margin-left:-4px'));
  ok('badge in button', app.innerHTML.includes('btn-rep') && app.innerHTML.includes('>1</span>'));

  queue = []; index = -1; repeat = 'off'; render();
  ok('controls disabled when idle', /id="btn-play"[^>]*disabled/.test(app.innerHTML));
  ok('idle hint again', app.innerHTML.includes('Nothing playing — pick a track.'));
  // ---- mobile shell ----
  queue = [{ id: 't1', title: 'Song One', artist: 'Artist A', durationSec: 180, thumbnail: null }];
  index = 0; view = 'home'; render();
  ok('tab bar rendered', app.innerHTML.includes('class="tabbar"'));
  ok('three tabs', String(app.innerHTML).split('tabbtn').length === 4);
  ok('mini progress slot', app.innerHTML.includes('id="mbprog"'));
  ok('sheet markup built', __el('np').innerHTML.includes('np-play') && __el('np').innerHTML.includes('id="npbar"'));
  ok('sheet queue lists current', __el('np').innerHTML.includes('Song One'));
  ok('sheet download link', __el('np').innerHTML.includes('/api/download?id=t1'));
  const lrc = parseLrc('[00:01.00]one\\n[00:02.00]two\\n[00:03.00]three\\n[00:04.00]four');
  ok('lrc parsed', lrc && lrc.length === 4 && lrc[0].t === 1);
  view = 'library'; render();
  ok('library view lists liked + create', app.innerHTML.includes('Liked Songs') && app.innerHTML.includes('pl-add2'));
  view = 'home'; render();

  console.log('DONE');
  process.exit(0);
})().catch((e) => { console.error('FAIL crash: ' + e.stack); process.exit(1) });
`

const file = path.join(require('node:os').tmpdir(), 'opencode', 'player-smoke.js')
fs.writeFileSync(file, stubs + '\n' + m[1] + '\n' + tail)
require(file)
