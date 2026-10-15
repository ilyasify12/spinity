/* ============================================================================
   Spinity native shell (Android APK)
   ----------------------------------------------------------------------------
   Inside the APK there is no HTTP server. This file runs before the player
   script and answers every same-origin '/api/...' request itself:

     library / liked / playlists / auth  -> localStorage
     stream bytes (waveform) + audio.src -> downloaded files on disk
     ytsearch / save (search + download) -> yt-dlp, executed through Termux
     lyrics                              -> lrclib.net (direct)
     probe                               -> skipped (no ffmpeg on the phone side)

   In a browser (the desktop app's web player) this file does nothing: the
   same player keeps talking to the desktop's real web server.
   ========================================================================== */
(function () {
  'use strict';

  var Cap = window.Capacitor;
  var NATIVE = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  // Defaults first, so the player is identical on the desktop. The APK
  // overrides both below with local-file versions.
  window.spinityStreamSrc = window.spinityStreamSrc || function (t) {
    return '/api/stream?id=' + encodeURIComponent(t.id);
  };
  window.spinityDownloadHref = window.spinityDownloadHref || function (t) {
    return '/api/download?id=' + encodeURIComponent(t.id);
  };
  if (!NATIVE) return;

  window.__SPINITY_NATIVE = true;

  /* ---- plugin access ------------------------------------------------------ */
  // Capacitor is used here without a bundler, so plugins are reached through
  // the legacy bridge entry points instead of npm imports.
  function plugin(name) {
    var proxy = null;
    try { proxy = (Cap.Plugins && Cap.Plugins[name]) || null; } catch (e) { proxy = null; }
    return {
      call: function (method, opts) {
        try {
          if (proxy && typeof proxy[method] === 'function') return Promise.resolve(proxy[method](opts));
          if (typeof Cap.nativePromise === 'function') return Cap.nativePromise(name, method, opts);
          if (typeof Cap.toNativePromise === 'function') return Cap.toNativePromise(name, method, opts);
        } catch (e) { return Promise.reject(e); }
        return Promise.reject(new Error('plugin ' + name + ' is not available'));
      }
    };
  }
  var FS = plugin('Filesystem');
  var TERMUX = plugin('TermuxBridge');

  var EXT = 'EXTERNAL_STORAGE';                 // Directory.ExternalStorage
  var ROOT = 'Download/Spinity';                // folder shared with Termux
  var ABS_ROOT = '/storage/emulated/0/' + ROOT; // same, absolute, for convertFileSrc
  var T_BASE = '$HOME/storage/downloads/Spinity'; // the same folder, as Termux sees it
  var LOOKS_READY = { termuxInstalled: false, filesAccess: false };

  function msg(e) { return String((e && e.message) || e || 'unknown error'); }
  function toast(m, err) { try { if (window.toast) window.toast(m, err); } catch (x) { /* not booted yet */ } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function jsonRes(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  function b64ToBytes(b64) {
    var raw = atob(b64);
    var u = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    return u;
  }
  function decText(b64) { return new TextDecoder().decode(b64ToBytes(b64)); }

  /* ---- local "database" --------------------------------------------------- */
  var DB_KEY = 'spinity-native:db:v1';
  var db = { user: { name: 'You' }, tracks: [], likedIds: [], playlists: [] };
  try {
    var stored = JSON.parse(localStorage.getItem(DB_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      db.user = stored.user || db.user;
      db.tracks = Array.isArray(stored.tracks) ? stored.tracks : [];
      db.likedIds = Array.isArray(stored.likedIds) ? stored.likedIds : [];
      db.playlists = Array.isArray(stored.playlists) ? stored.playlists : [];
    }
  } catch (e) { /* fresh start */ }
  function saveDb() { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {} }
  function findTrack(id) {
    for (var i = 0; i < db.tracks.length; i++) if (db.tracks[i].id === id) return db.tracks[i];
    return null;
  }

  /* ---- yt-dlp jobs (run through Termux) ----------------------------------- */
  var JOB_KEY = 'spinity-native:jobs:v1';
  var jobs = [];
  try { jobs = JSON.parse(localStorage.getItem(JOB_KEY) || '[]') || []; } catch (e) { jobs = []; }
  function saveJobs() { try { localStorage.setItem(JOB_KEY, JSON.stringify(jobs)); } catch (e) {} }

  function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

  function emitJob(kind, id, body, extra) {
    var job = { id: id, kind: kind, ts: Date.now() };
    if (extra) for (var k in extra) job[k] = extra[k];
    jobs.push(job);
    saveJobs();
    var cmd = 'mkdir -p "' + T_BASE + '/audio" "' + T_BASE + '/jobs" && { ' + body +
      ' ; } ; echo $? > "' + T_BASE + '/jobs/' + id + '.code"';
    TERMUX.call('exec', { cmd: cmd }).catch(function (e) {
      jobs = jobs.filter(function (j) { return j.id !== id; });
      saveJobs();
      toast('Could not start Termux: ' + msg(e), true);
      job.error = msg(e);
    });
    return job;
  }

  function startSearch(q) {
    var id = 's' + Date.now().toString(36);
    var json = T_BASE + '/jobs/' + id + '.json';
    var err = T_BASE + '/jobs/' + id + '.err';
    return emitJob('search', id,
      'yt-dlp -J --no-warnings --flat-playlist --playlist-end 12 -- ' + shq('ytsearch12:' + q) +
      ' > "' + json + '" 2> "' + err + '"',
      { q: q });
  }

  function startDownload(t) {
    var videoId = String(t.id).replace(/^yt_/, '');
    var id = 'd' + Date.now().toString(36);
    var log = T_BASE + '/jobs/' + id + '.log';
    return emitJob('download', id,
      'cd "' + T_BASE + '/audio" && yt-dlp --no-warnings -x --audio-format mp3 --audio-quality 0' +
      ' --embed-thumbnail --add-metadata -o ' + shq(videoId + '.%(ext)s') + ' ' +
      shq('https://www.youtube.com/watch?v=' + videoId) +
      ' > "' + log + '" 2>&1',
      { videoId: videoId, track: t });
  }

  async function readJobFile(job, suffix) {
    var res = await FS.call('readFile', { path: ROOT + '/jobs/' + job.id + suffix, directory: EXT });
    return res && res.data ? decText(res.data) : '';
  }

  function cleanupJobs() {
    var now = Date.now();
    jobs = jobs.filter(function (j) {
      if (!j.doneAt) return now - j.ts < 30 * 60 * 1000; // stuck job: give up after 30 min
      return now - j.doneAt < 5 * 60 * 1000;             // finished: keep briefly, then drop
    });
    saveJobs();
  }

  async function pollOne(job) {
    var code;
    try { code = (await readJobFile(job, '.code')).trim(); }
    catch (e) {
      if (Date.now() - job.ts > 10 * 60 * 1000 && !job.doneAt) {
        job.doneAt = Date.now();
        job.error = 'Termux never answered — check that Spinity is allowed to run commands in Termux (allow-external-apps=true) and that the phone setup is done.';
        saveJobs();
        toast('yt-dlp timed out — check the phone setup', true);
      }
      return;
    }
    var n = parseInt(code.split(/\s+/).pop(), 10);
    if (job.kind === 'search') {
      if (n === 0) {
        try {
          job.result = mapSearchResults(JSON.parse(await readJobFile(job, '.json')));
        } catch (e) { job.error = 'Could not read yt-dlp output: ' + msg(e); }
      } else {
        try { job.error = (await readJobFile(job, '.err')).split('\n').filter(Boolean).pop() || ('yt-dlp exited ' + n); }
        catch (e) { job.error = 'yt-dlp exited ' + n; }
      }
    } else {
      if (n === 0) {
        var file = ABS_ROOT + '/audio/' + job.videoId + '.mp3';
        try {
          await FS.call('stat', { path: ROOT + '/audio/' + job.videoId + '.mp3', directory: EXT });
          var t = job.track || {};
          if (!findTrack('yt_' + job.videoId)) {
            db.tracks.unshift({
              id: 'yt_' + job.videoId,
              title: t.title || 'Unknown',
              artist: t.artist || 'YouTube',
              durationSec: t.durationSec || 0,
              thumbnail: t.thumbnail || '',
              file: file,
              source: 'youtube',
              downloadedAt: Date.now()
            });
            saveDb();
            toast('Saved to library ✓');
          }
        } catch (e) { job.error = 'yt-dlp finished but the mp3 is missing'; }
      } else {
        try { job.error = (await readJobFile(job, '.log')).split('\n').filter(Boolean).pop() || ('yt-dlp exited ' + n); }
        catch (e) { job.error = 'Download failed (yt-dlp exited ' + n + ')'; }
        toast('Download failed: ' + job.error, true);
      }
    }
    job.doneAt = Date.now();
    saveJobs();
    // A finished download should appear in whatever view is open: the player's
    // own boot() re-fetches the library and re-renders.
    if (job.kind === 'download' && !job.error && typeof window.boot === 'function') {
      try { window.boot(); } catch (e) {}
    }
  }

  function mapSearchResults(raw) {
    var entries = (raw && raw.entries) || [];
    return entries.filter(function (e) { return e && e.id; }).map(function (e) {
      var thumb = '';
      if (Array.isArray(e.thumbnails) && e.thumbnails.length) {
        thumb = e.thumbnails[e.thumbnails.length - 1].url || '';
      }
      if (!thumb) thumb = 'https://i.ytimg.com/vi/' + e.id + '/hqdefault.jpg';
      return {
        id: 'yt_' + e.id,
        title: e.title || 'Unknown',
        artist: e.channel || e.uploader || 'YouTube',
        durationSec: Math.round(e.duration || 0),
        thumbnail: thumb
      };
    });
  }

  function pollJobs() {
    var active = jobs.filter(function (j) { return !j.doneAt; });
    active.forEach(function (j) { pollOne(j).catch(function () {}); });
    if (active.length) cleanupJobs(); else if (jobs.length) cleanupJobs();
  }
  setInterval(pollJobs, 2000);

  /* ---- readiness (Termux + file access) ----------------------------------- */
  var readyCache = null;
  async function ensureReady(force) {
    if (readyCache && !force && Date.now() - readyCache.ts < 4000) return readyCache;
    var st = {};
    try { st = await TERMUX.call('status', {}); }
    catch (e) { st = { termuxInstalled: false, filesAccess: false, error: msg(e) }; }
    LOOKS_READY = { termuxInstalled: !!st.termuxInstalled, filesAccess: !!st.filesAccess };
    var why = st.error ? ('The Termux bridge is not answering: ' + st.error)
      : !LOOKS_READY.termuxInstalled ? 'Termux is not installed'
      : !LOOKS_READY.filesAccess ? 'Spinity needs "All files" access'
      : '';
    readyCache = { ts: Date.now(), ok: !why, why: why };
    if (why && !setupDismissed()) openSetup(why);
    return readyCache;
  }

  /* ---- lyrics (lrclib, straight from the phone) ---------------------------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function cleanArtist(a) {
    return String(a || '')
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/\s*VEVO$/i, '')
      .split(',')[0]
      .split(/ feat[. ]/i)[0]
      .trim() || 'Unknown';
  }
  function pickLyrics(list, t) {
    if (!Array.isArray(list) || !list.length) return null;
    var want = norm(t.title);
    var best = null, bestScore = 0;
    list.forEach(function (x) {
      var s = 0;
      var have = norm(x.trackName || '');
      if (have && have === want) s += 3;
      else if (have && want && (have.indexOf(want) >= 0 || want.indexOf(have) >= 0)) s += 2;
      if (x.syncedLyrics) s += 1;
      if (t.durationSec && x.duration && Math.abs(x.duration - t.durationSec) <= 8) s += 1;
      if (s > bestScore) { bestScore = s; best = x; }
    });
    return bestScore >= 2 ? best : null;
  }
  async function apiLyrics(id) {
    var key = 'spinity-native:lrc:' + id;
    try {
      var memo = JSON.parse(localStorage.getItem(key) || 'null');
      if (memo) return jsonRes(memo);
    } catch (e) {}
    var t = findTrack(id);
    if (!t) return jsonRes({ synced: null, plain: null });
    var out = { synced: null, plain: null };
    try {
      var qs = new URLSearchParams({ track_name: t.title, artist_name: cleanArtist(t.artist) }).toString();
      var r = await fetch('https://lrclib.net/api/search?' + qs);
      if (r.ok) {
        var best = pickLyrics(await r.json(), t);
        if (best) out = { synced: best.syncedLyrics || null, plain: best.plainLyrics || null };
      }
    } catch (e) { /* offline or blocked: treated as "no lyrics" */ }
    if (out.synced || out.plain) { try { localStorage.setItem(key, JSON.stringify(out)); } catch (e) {} }
    return jsonRes(out);
  }

  /* ---- the /api router ---------------------------------------------------- */
  async function handleApi(url, init) {
    var qi = url.indexOf('?');
    var path = qi >= 0 ? url.slice(0, qi) : url;
    var q = new URLSearchParams(qi >= 0 ? url.slice(qi + 1) : '');
    var method = String((init && init.method) || 'GET').toUpperCase();
    var body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    var m = method + ' ' + path;
    var parts = path.split('/').filter(Boolean); // ['api','playlists',id,...]

    var t;
    if (m === 'GET /api/me') return jsonRes({ user: db.user, likedIds: db.likedIds, playlists: db.playlists });
    if (m === 'GET /api/library') return jsonRes({ tracks: db.tracks });
    if (path.indexOf('/api/auth/') === 0) {
      if (path === '/api/auth/login' || path === '/api/auth/register') {
        if (body.displayName) { db.user.name = String(body.displayName); saveDb(); }
        else if (body.username) { db.user.name = String(body.username); saveDb(); }
        return jsonRes({ token: 'native' });
      }
      return jsonRes({});
    }
    if (m === 'POST /api/like') {
      var lid = String(body.id || '');
      var has = db.likedIds.indexOf(lid) >= 0;
      if (body.like && !has) db.likedIds.push(lid);
      if (!body.like && has) db.likedIds = db.likedIds.filter(function (x) { return x !== lid; });
      saveDb();
      return jsonRes({ likedIds: db.likedIds });
    }
    if (m === 'POST /api/playlists') {
      var pl = { id: 'npl' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: String(body.name || 'Playlist'), trackIds: [] };
      db.playlists.push(pl);
      saveDb();
      return jsonRes(pl);
    }
    if (parts[1] === 'playlists' && parts[2]) {
      var target = null;
      for (var i = 0; i < db.playlists.length; i++) if (db.playlists[i].id === parts[2]) target = db.playlists[i];
      if (method === 'DELETE' && !parts[3]) {
        db.playlists = db.playlists.filter(function (x) { return x.id !== parts[2]; });
        saveDb();
        return jsonRes({ ok: true });
      }
      if (target && method === 'POST' && parts[3] === 'tracks' && !parts[4]) {
        var tid = String(body.trackId || '');
        if (tid && target.trackIds.indexOf(tid) < 0) { target.trackIds.push(tid); saveDb(); }
        return jsonRes({ ok: true });
      }
      if (target && method === 'DELETE' && parts[3] === 'tracks' && parts[4]) {
        var rid = decodeURIComponent(parts[4]);
        target.trackIds = target.trackIds.filter(function (x) { return x !== rid; });
        saveDb();
        return jsonRes({ ok: true });
      }
      return jsonRes({ ok: true });
    }
    if (m === 'GET /api/ytsearch') {
      var query = String(q.get('q') || '').trim();
      if (!query) return jsonRes([]);
      var ready = await ensureReady();
      if (!ready.ok) return jsonRes({ error: ready.why }, 503);
      var job = null;
      for (var j = 0; j < jobs.length; j++) {
        if (jobs[j].kind === 'search' && jobs[j].q === query && !jobs[j].doneAt) job = jobs[j];
        if (jobs[j].kind === 'search' && jobs[j].q === query && jobs[j].doneAt && jobs[j].result && Date.now() - jobs[j].doneAt < 10 * 60 * 1000) {
          return jsonRes(jobs[j].result);
        }
      }
      if (!job) job = startSearch(query);
      var deadline = Date.now() + 90 * 1000;
      while (Date.now() < deadline) {
        if (job.result) return jsonRes(job.result);
        if (job.error) return jsonRes({ error: job.error }, 502);
        if (job.doneAt) break;
        await sleep(750);
      }
      return jsonRes({ error: job.error || 'YouTube search timed out — is Termux set up and running?' }, 504);
    }
    if (m === 'POST /api/save') {
      var saveId = String(body.id || '');
      if (!saveId) return jsonRes({ error: 'missing id' }, 400);
      if (findTrack(saveId)) return jsonRes({ ok: true, existing: true });
      var rdy = await ensureReady();
      if (!rdy.ok) return jsonRes({ error: rdy.why }, 503);
      var inFlight = jobs.some(function (x) { return x.kind === 'download' && x.track && x.track.id === saveId && !x.doneAt; });
      if (!inFlight) startDownload(body);
      return jsonRes({ ok: true });
    }
    if (m === 'GET /api/lyrics') return apiLyrics(String(q.get('id') || ''));
    if (m === 'GET /api/probe') return jsonRes({ label: '', title: '' });
    if (m === 'GET /api/stream') {
      t = findTrack(String(q.get('id') || ''));
      if (!t || !t.file) return new Response(null, { status: 404 });
      try {
        var rel = t.file.indexOf(ROOT) >= 0 ? t.file.slice(t.file.indexOf(ROOT)) : t.file;
        var fres = await FS.call('readFile', { path: rel, directory: EXT });
        var bytes = b64ToBytes(fres.data);
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.byteLength) }
        });
      } catch (e) {
        return new Response(null, { status: 500 });
      }
    }
    if (m === 'GET /api/download') {
      var dt = findTrack(String(q.get('id') || ''));
      return jsonRes({ error: dt && dt.file ? 'This file is already on the phone' : 'Nothing to download' }, 404);
    }
    return jsonRes({ error: 'not found: ' + path }, 404);
  }

  var origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/') === 0) {
      return handleApi(url, init || {}).catch(function (e) { return jsonRes({ error: msg(e) }, 500); });
    }
    return origFetch ? origFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };

  /* ---- local-file playback hooks used by the player ------------------------ */
  window.spinityStreamSrc = function (t) {
    return t && t.file ? Cap.convertFileSrc(t.file) : '';
  };
  window.spinityDownloadHref = function (t) {
    // The file already lives on the phone (shared Downloads folder) — nothing
    // to copy, so the download icon goes inert instead of doing something odd
    // inside the WebView.
    return '#';
  };

  /* ---- phone setup panel ---------------------------------------------------- */
  var CMDS = [
    'termux-setup-storage',
    'pkg update && pkg upgrade -y',
    'pkg install -y python ffmpeg',
    'pip install -U "yt-dlp[default]"',
    'mkdir -p ~/storage/downloads/Spinity/audio ~/storage/downloads/Spinity/jobs',
    'echo "allow-external-apps=true" >> ~/.termux/termux.properties',
    'termux-reload-settings'
  ].join('\n');

  function setupDismissed() {
    try { return sessionStorage.getItem('spinity-setup:hidden') === '1'; } catch (e) { return false; }
  }

  function panelEl() { return document.getElementById('sp-native-setup'); }

  function openSetup(reason) {
    if (panelEl()) { setSetupReason(reason || ''); return; }
    if (!document.body) { window.addEventListener('DOMContentLoaded', function () { openSetup(reason); }); return; }
    var wrap = document.createElement('div');
    wrap.id = 'sp-native-setup';
    wrap.setAttribute('style',
      'position:fixed;inset:0;z-index:9000;background:rgba(4,5,9,.82);display:grid;place-items:center;padding:18px;font-family:inherit;');
    wrap.innerHTML =
      '<div style="max-width:520px;width:100%;max-height:88vh;overflow:auto;background:#0d1017;border:1px solid #232a3d;border-radius:16px;padding:22px;color:#f2f4fc">' +
      '<div style="font-weight:700;font-size:18px;margin-bottom:4px">Phone setup</div>' +
      '<div id="sp-native-why" style="color:#ffb27d;font-size:13px;margin-bottom:12px"></div>' +
      '<div style="color:#a4abc4;font-size:13px;line-height:1.55;margin-bottom:12px">Spinity downloads songs on the phone with <b>yt-dlp</b>, which runs inside <b>Termux</b>. This is a one-time setup.</div>' +
      '<ol style="color:#f2f4fc;font-size:13px;line-height:1.7;margin:0 0 12px 18px">' +
      '<li>Install <b>Termux</b> (from F-Droid).</li>' +
      '<li>Open it once, then tap <b>Copy setup commands</b> here, paste in Termux and run them.</li>' +
      '<li>Tap <b>Allow file access</b> so Spinity can reach the downloaded songs.</li>' +
      '<li>Tap <b>Check again</b>.</li>' +
      '</ol>' +
      '<pre id="sp-native-cmds" style="background:#07080d;border:1px solid #232a3d;border-radius:10px;padding:10px;font-size:11.5px;white-space:pre-wrap;color:#a4abc4;margin:0 0 14px">' + CMDS.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button id="sp-native-copy" style="background:#ff6b00;color:#14100a;border:0;border-radius:10px;padding:10px 14px;font-weight:700">Copy setup commands</button>' +
      '<button id="sp-native-termux" style="background:#1b2233;color:#f2f4fc;border:0;border-radius:10px;padding:10px 14px">Open Termux</button>' +
      '<button id="sp-native-files" style="background:#1b2233;color:#f2f4fc;border:0;border-radius:10px;padding:10px 14px">Allow file access</button>' +
      '<button id="sp-native-check" style="background:#1b2233;color:#f2f4fc;border:0;border-radius:10px;padding:10px 14px">Check again</button>' +
      '<button id="sp-native-close" style="background:transparent;color:#a4abc4;border:0;border-radius:10px;padding:10px 8px">Later</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    setSetupReason(reason || '');
    wrap.querySelector('#sp-native-copy').onclick = function () {
      var ta = document.createElement('textarea');
      ta.value = CMDS;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (!ok && navigator.clipboard) navigator.clipboard.writeText(CMDS).catch(function () {});
      toast('Commands copied — paste them in Termux');
    };
    wrap.querySelector('#sp-native-termux').onclick = function () {
      TERMUX.call('openTermux', {}).catch(function () {
        toast('Termux is not installed — get it from F-Droid', true);
      });
    };
    wrap.querySelector('#sp-native-files').onclick = function () {
      TERMUX.call('requestFilesAccess', {}).catch(function (e) { toast(msg(e), true); });
    };
    wrap.querySelector('#sp-native-check').onclick = function () {
      readyCache = null;
      ensureReady(true).then(function (r) {
        if (r.ok) { var p = panelEl(); if (p) p.remove(); toast('Phone setup complete ✓'); }
        else setSetupReason(r.why);
      }).catch(function () {});
    };
    wrap.querySelector('#sp-native-close').onclick = function () {
      try { sessionStorage.setItem('spinity-setup:hidden', '1'); } catch (e) {}
      wrap.remove();
    };
  }
  function setSetupReason(reason) {
    var el = document.getElementById('sp-native-why');
    if (el) el.textContent = reason ? ('Still needed: ' + reason) : '';
  }

  /* ---- boot ----------------------------------------------------------------- */
  // Inside the APK there is no account system: pre-seed the token so the
  // player boots straight into the shell (login still works if logged out).
  try { if (!localStorage.getItem('spinity-web:token')) localStorage.setItem('spinity-web:token', 'native'); } catch (e) {}

  // Never let a stale service worker serve an older player than the APK ships.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) { r.unregister().catch(function () {}); });
    }).catch(function () {});
    if (window.caches && caches.keys) {
      caches.keys().then(function (ks) {
        ks.forEach(function (k) { caches.delete(k); });
      }).catch(function () {});
    }
  }

  window.addEventListener('load', function () {
    setTimeout(function () { ensureReady().catch(function () {}); }, 1500);
  });
})();
