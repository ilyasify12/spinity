package com.spinity.player;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Everything the phone build needs beyond a plain WebView:
 *
 *   - scanning the on-device music folders so songs the user copies onto the
 *     phone (or downloads with another app) show up in the Library — with
 *     their real embedded cover art, straight from the file's tags;
 *   - importing files through the system picker (copied into the app's audio
 *     folder so everything lives in one place);
 *   - the bundled yt-dlp engine (see YtDlpEngine): search + download with no
 *     Termux, no root, no setup.
 *
 * All heavy work runs on a private pool — Capacitor's plugin thread stays free.
 */
@CapacitorPlugin(name = "SpinityBridge")
public class SpinityBridgePlugin extends Plugin {

    private static final ExecutorService POOL = Executors.newFixedThreadPool(3);
    private static final Set<String> AUDIO_EXT = new HashSet<>(Arrays.asList(
            "mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "wav", "wma", "m4b"));
    private static final int MAX_FILES = 3000;
    private static final int MAX_DEPTH = 5;

    /* ---- shared storage --------------------------------------------------- */

    private File downloadsDir() {
        return Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
    }

    private File spinityRoot() {
        return new File(downloadsDir(), "Spinity");
    }

    private File audioDir() {
        File f = new File(spinityRoot(), "audio");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    private File coversDir() {
        File f = new File(spinityRoot(), "covers");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    private boolean hasAllFiles() {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return getContext().checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE")
                == PackageManager.PERMISSION_GRANTED;
    }

    /* ---- local library scan ----------------------------------------------- */

    @PluginMethod
    public void scanAudio(final PluginCall call) {
        final String knownRaw = call.getString("knownJson", "{}");
        final JSArray wanted = call.getArray("folders");
        call.setKeepAlive(true);
        POOL.execute(new Runnable() {
            @Override
            public void run() {
                JSObject ret = new JSObject();
                try {
                    JSObject roots = new JSObject();
                    roots.put("audio", audioDir().getAbsolutePath());
                    roots.put("music", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC).getAbsolutePath());
                    roots.put("downloads", downloadsDir().getAbsolutePath());
                    ret.put("roots", roots);

                    if (!hasAllFiles()) {
                        ret.put("needPermission", true);
                        ret.put("files", new JSArray());
                        ret.put("meta", new JSArray());
                        call.resolve(ret);
                        return;
                    }

                    JSONObject known = new JSONObject(knownRaw);
                    List<String> aliases = new ArrayList<>();
                    if (wanted != null) {
                        for (int i = 0; i < wanted.length(); i++) {
                            String a = String.valueOf(wanted.get(i));
                            if (!aliases.contains(a)) aliases.add(a);
                        }
                    }
                    if (aliases.isEmpty()) aliases.add("audio");

                    List<File> files = new ArrayList<>();
                    Set<String> seen = new HashSet<>();
                    for (String a : aliases) {
                        File root = null;
                        if ("audio".equals(a)) root = audioDir();
                        else if ("music".equals(a)) root = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
                        else if ("downloads".equals(a)) root = downloadsDir();
                        if (root == null || !root.isDirectory()) continue;
                        List<File> found = new ArrayList<>();
                        walk(root, 0, found);
                        for (File f : found) {
                            if (seen.add(f.getAbsolutePath())) files.add(f);
                        }
                    }

                    File covers = coversDir();
                    JSArray jf = new JSArray();
                    JSArray jm = new JSArray();
                    for (File f : files) {
                        String p = f.getAbsolutePath();
                        long mtime = f.lastModified();
                        long size = f.length();
                        JSObject o = new JSObject();
                        o.put("path", p);
                        o.put("name", f.getName());
                        o.put("size", (Object) size);
                        o.put("mtime", (Object) mtime);
                        jf.put(o);

                        // Skip tag/art extraction for files we have already seen
                        // unchanged — this is what keeps rescans instant.
                        boolean same = known.optString(p, "").equals(mtime + ":" + size);
                        if (!same) {
                            JSObject m = extractMeta(f, covers);
                            if (m != null) jm.put(m);
                        }
                    }
                    ret.put("needPermission", false);
                    ret.put("files", jf);
                    ret.put("meta", jm);
                    call.resolve(ret);
                } catch (Throwable t) {
                    call.reject("Could not scan your music folders: " + t.getMessage());
                }
            }
        });
    }

    private void walk(File dir, int depth, List<File> out) {
        if (depth > MAX_DEPTH || out.size() >= MAX_FILES) return;
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            if (out.size() >= MAX_FILES) return;
            String name = f.getName();
            if (name.startsWith(".")) continue;
            if (f.isDirectory()) {
                if ("Android".equals(name)) continue;
                walk(f, depth + 1, out);
            } else if (isAudio(name)) {
                out.add(f);
            }
        }
    }

    private static boolean isAudio(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0) return false;
        return AUDIO_EXT.contains(name.substring(dot + 1).toLowerCase());
    }

    /**
     * Read title / artist / album / duration and the embedded cover picture.
     * The cover is written once into Download/Spinity/covers and reused, so
     * the player can show the real artwork without re-reading the file.
     */
    private JSObject extractMeta(File f, File coversDir) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(f.getAbsolutePath());
            JSObject m = new JSObject();
            m.put("path", f.getAbsolutePath());
            String title = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            if (artist == null) artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST);
            String album = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (title != null) m.put("title", title);
            if (artist != null) m.put("artist", artist);
            if (album != null) m.put("album", album);
            if (dur != null) {
                try {
                    m.put("durationSec", (Object) Math.round(Long.parseLong(dur) / 1000.0));
                } catch (NumberFormatException ignored) {
                    // leave duration out; the player shows "—"
                }
            }
            byte[] art = r.getEmbeddedPicture();
            if (art != null && art.length > 0) {
                File out = new File(coversDir, Integer.toHexString(f.getAbsolutePath().hashCode()) + ".jpg");
                if (!out.exists() || out.length() != art.length) {
                    FileOutputStream fos = new FileOutputStream(out);
                    fos.write(art);
                    fos.close();
                }
                m.put("cover", out.getAbsolutePath());
            }
            return m;
        } catch (Throwable t) {
            return null; // unreadable file: native.js falls back to the name
        } finally {
            try {
                r.release();
            } catch (Throwable ignored) {
                // nothing to do
            }
        }
    }

    /* ---- import through the system picker --------------------------------- */

    @PluginMethod
    public void importAudio(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("audio/*");
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, i, "importResult");
    }

    @ActivityCallback
    private void importResult(final PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("count", (Object) 0);
            call.resolve(ret);
            return;
        }
        final Intent data = result.getData();
        call.setKeepAlive(true);
        POOL.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    List<Uri> uris = new ArrayList<>();
                    if (data.getClipData() != null) {
                        for (int k = 0; k < data.getClipData().getItemCount(); k++) {
                            uris.add(data.getClipData().getItemAt(k).getUri());
                        }
                    } else if (data.getData() != null) {
                        uris.add(data.getData());
                    }
                    ContentResolver cr = getContext().getContentResolver();
                    File dir = audioDir();
                    List<String> copied = new ArrayList<>();
                    for (Uri u : uris) {
                        String name = queryName(cr, u);
                        File out = uniqueFile(dir, name);
                        InputStream in = cr.openInputStream(u);
                        if (in == null) continue;
                        OutputStream os = new FileOutputStream(out);
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                        os.close();
                        in.close();
                        copied.add(out.getAbsolutePath());
                    }
                    if (!copied.isEmpty()) {
                        MediaScannerConnection.scanFile(
                                getContext(), copied.toArray(new String[0]), null, null);
                    }
                    JSObject ret = new JSObject();
                    ret.put("count", (Object) copied.size());
                    JSArray paths = new JSArray();
                    for (String p : copied) paths.put(p);
                    ret.put("paths", paths);
                    call.resolve(ret);
                } catch (Throwable t) {
                    call.reject("Import failed: " + t.getMessage());
                }
            }
        });
    }

    private String queryName(ContentResolver cr, Uri u) {
        String name = null;
        Cursor c = null;
        try {
            c = cr.query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        } catch (Throwable ignored) {
            // fall through to the generated name
        } finally {
            if (c != null) c.close();
        }
        if (name == null || name.trim().isEmpty()) {
            name = "imported-" + System.currentTimeMillis() + ".mp3";
        }
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int k = 2; k < 1000; k++) {
            File cand = new File(dir, base + " (" + k + ")" + ext);
            if (!cand.exists()) return cand;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    /* ---- bundled yt-dlp engine -------------------------------------------- */

    @PluginMethod
    public void ytdlpAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", YtDlpEngine.isReady());
        ret.put("initializing", YtDlpEngine.isInitializing());
        if (YtDlpEngine.initError() != null) ret.put("error", YtDlpEngine.initError());
        if (YtDlpEngine.version() != null) ret.put("version", YtDlpEngine.version());
        call.resolve(ret);
    }

    @PluginMethod
    public void ytdlpSearch(final PluginCall call) {
        final String q = String.valueOf(call.getString("q", ""));
        final int limit = call.getInt("limit", 12);
        if (!YtDlpEngine.isReady()) {
            call.reject(engineNotReadyMessage());
            return;
        }
        call.setKeepAlive(true);
        POOL.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    String out = YtDlpEngine.searchJson(q, limit);
                    JSONObject root = new JSONObject(out);
                    JSArray entries = new JSArray();
                    JSONArray arr = root.optJSONArray("entries");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject e = arr.optJSONObject(i);
                            if (e != null) entries.put(slimEntry(e));
                        }
                    } else if (root.has("id")) {
                        entries.put(slimEntry(root));
                    }
                    JSObject ret = new JSObject();
                    ret.put("entries", entries);
                    call.resolve(ret);
                } catch (Throwable t) {
                    String m = t.getMessage() == null ? t.toString() : t.getMessage();
                    call.reject("YouTube search failed: " + YtDlpEngine.tail(m, 300));
                }
            }
        });
    }

    private static JSObject slimEntry(JSONObject e) throws Exception {
        JSObject o = new JSObject();
        o.put("id", e.optString("id", ""));
        o.put("title", e.optString("title", ""));
        String channel = e.optString("channel", "");
        if (channel == null || channel.isEmpty()) channel = e.optString("uploader", "");
        o.put("channel", channel);
        o.put("duration", (Object) e.optDouble("duration", 0));
        JSONArray thumbs = e.optJSONArray("thumbnails");
        if (thumbs != null && thumbs.length() > 0) {
            JSONObject last = thumbs.optJSONObject(thumbs.length() - 1);
            if (last != null) {
                JSONArray one = new JSONArray();
                JSONObject t = new JSONObject();
                t.put("url", last.optString("url", ""));
                one.put(t);
                o.put("thumbnails", one);
            }
        }
        return o;
    }

    @PluginMethod
    public void ytdlpDownload(final PluginCall call) {
        String raw = call.getString("videoId", "");
        final String videoId = raw == null ? "" : raw.replaceAll("[^A-Za-z0-9_-]", "");
        if (videoId.isEmpty()) {
            call.reject("videoId is required");
            return;
        }
        if (!YtDlpEngine.isReady()) {
            call.reject(engineNotReadyMessage());
            return;
        }
        try {
            final String jobId = "e" + System.currentTimeMillis();
            YtDlpEngine.newJob(jobId);
            final File dir = audioDir();
            final File out = new File(dir, videoId + ".mp3");
            POOL.execute(new Runnable() {
                @Override
                public void run() {
                    YtDlpEngine.download(jobId, videoId, dir.getAbsolutePath(), out.getAbsolutePath());
                }
            });
            JSObject ret = new JSObject();
            ret.put("jobId", jobId);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("Could not start the download: " + t.getMessage());
        }
    }

    @PluginMethod
    public void ytdlpJob(PluginCall call) {
        try {
            String id = call.getString("jobId", "");
            YtDlpEngine.Job j = id == null ? null : YtDlpEngine.getJob(id);
            JSObject ret = new JSObject();
            if (j == null) {
                ret.put("state", "unknown");
                call.resolve(ret);
                return;
            }
            ret.put("state", j.state);
            ret.put("progress", (Object) j.progress);
            ret.put("eta", (Object) j.eta);
            if (j.error != null) ret.put("error", j.error);
            if (j.path != null) ret.put("path", j.path);
            call.resolve(ret);
            if ("done".equals(j.state) || "error".equals(j.state)) YtDlpEngine.removeJob(id);
        } catch (Throwable t) {
            call.reject("job lookup failed: " + t.getMessage());
        }
    }

    @PluginMethod
    public void ytdlpCancel(PluginCall call) {
        String id = call.getString("jobId", "");
        if (id != null && !id.isEmpty()) {
            YtDlpEngine.cancel(id);
            YtDlpEngine.removeJob(id);
        }
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void ytdlpUpdate(final PluginCall call) {
        if (!YtDlpEngine.isReady()) {
            call.reject(engineNotReadyMessage());
            return;
        }
        call.setKeepAlive(true);
        POOL.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    String status = YtDlpEngine.update(getContext());
                    JSObject ret = new JSObject();
                    ret.put("status", status);
                    if (YtDlpEngine.version() != null) ret.put("version", YtDlpEngine.version());
                    call.resolve(ret);
                } catch (Throwable t) {
                    String m = t.getMessage() == null ? t.toString() : t.getMessage();
                    call.reject("Update failed: " + YtDlpEngine.tail(m, 300));
                }
            }
        });
    }

    private String engineNotReadyMessage() {
        if (YtDlpEngine.isInitializing()) return "engine still starting";
        return "engine unavailable: " + YtDlpEngine.initError();
    }
}
