package com.spinity.player;

import android.content.Context;

import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;

import java.io.File;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import kotlin.Unit;
import kotlin.jvm.functions.Function3;

/**
 * The download engine: yt-dlp + python + ffmpeg bundled straight into the APK
 * (io.github.junkfood02.youtubedl-android).
 *
 * This is what makes the phone build work with zero setup: no Termux, no root,
 * no terminal. The first launch unpacks the bundled python once; after that
 * every search / download runs in-process.
 *
 * All methods here are blocking — call them from a worker thread only.
 */
public final class YtDlpEngine {

    /** Live state of one download, polled by native.js. */
    public static final class Job {
        public volatile String state = "queued"; // queued | downloading | done | error
        public volatile float progress = 0f;
        public volatile long eta = 0;
        public volatile String error = null;
        public volatile String path = null;
        public final long startedAt = System.currentTimeMillis();
    }

    private static volatile boolean initStarted = false;
    private static volatile boolean ready = false;
    private static volatile String initError = null;
    private static volatile String version = null;
    private static final Map<String, Job> JOBS = new ConcurrentHashMap<>();

    private YtDlpEngine() {}

    /** Kick off the one-time unpack of python/yt-dlp/ffmpeg in the background. */
    public static synchronized void ensureInit(final Context ctx) {
        if (initStarted) return;
        initStarted = true;
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    YoutubeDL.getInstance().init(app);
                    FFmpeg.getInstance().init(app);
                    try {
                        version = YoutubeDL.getInstance().version(app);
                    } catch (Throwable ignored) {
                        version = null;
                    }
                    ready = true;
                } catch (Throwable t) {
                    initError = t.getMessage() == null ? t.toString() : t.getMessage();
                }
            }
        }, "spinity-ytdl-init").start();
    }

    public static boolean isReady() { return ready; }

    public static boolean isInitializing() { return initStarted && !ready && initError == null; }

    public static String initError() { return initError; }

    public static String version() { return version; }

    public static Job newJob(String id) {
        Job j = new Job();
        JOBS.put(id, j);
        return j;
    }

    public static Job getJob(String id) { return JOBS.get(id); }

    public static void removeJob(String id) { JOBS.remove(id); }

    /** Stop the yt-dlp process behind a job (also used when a download is cancelled). */
    public static void cancel(String id) {
        try {
            YoutubeDL.getInstance().destroyProcessById(id);
        } catch (Throwable ignored) {
            // process already gone
        }
    }

    /**
     * Search YouTube. Returns the raw "--dump-single-json --flat-playlist"
     * output — the exact same shape the Termux route produced, so the JS side
     * keeps one result mapper.
     */
    public static String searchJson(String query, int limit) throws Exception {
        YoutubeDLRequest req = new YoutubeDLRequest("ytsearch" + limit + ":" + query);
        req.addOption("-J");
        req.addOption("--flat-playlist");
        req.addOption("--playlist-end", limit);
        req.addOption("--no-warnings");
        YoutubeDLResponse res = YoutubeDL.getInstance().execute(req, null, false, null);
        String out = res.getOut();
        if (out == null || out.trim().isEmpty()) {
            throw new Exception("empty result from the download engine");
        }
        return out;
    }

    /**
     * Download one video as mp3 (with cover + tags) into the shared audio
     * folder. Runs synchronously; progress lands in the job object.
     */
    public static void download(String jobId, String videoId, String audioDir, String outPath) {
        Job job = JOBS.get(jobId);
        if (job == null) return;
        job.state = "downloading";
        try {
            YoutubeDLRequest req = new YoutubeDLRequest("https://www.youtube.com/watch?v=" + videoId);
            req.addOption("-x");
            req.addOption("--audio-format", "mp3");
            req.addOption("--audio-quality", "0");
            req.addOption("--embed-thumbnail");
            req.addOption("--add-metadata");
            req.addOption("--no-mtime");
            req.addOption("--no-warnings");
            req.addOption("-o", audioDir + "/" + videoId + ".%(ext)s");
            YoutubeDL.getInstance().execute(req, jobId, false, new Function3<Float, Long, String, Unit>() {
                @Override
                public Unit invoke(Float progress, Long eta, String line) {
                    if (progress != null) job.progress = progress.floatValue();
                    if (eta != null) job.eta = eta.longValue();
                    return Unit.INSTANCE;
                }
            });
            File f = new File(outPath);
            if (!f.exists() || f.length() == 0) {
                throw new Exception("the download finished but no file was written");
            }
            job.path = f.getAbsolutePath();
            job.progress = 100f;
            job.state = "done";
        } catch (Throwable t) {
            if (t instanceof YoutubeDL.CanceledException) {
                job.error = "canceled";
            } else {
                String m = t.getMessage() == null ? t.toString() : t.getMessage();
                job.error = tail(m, 400);
            }
            job.state = "error";
        }
    }

    /** Update the bundled yt-dlp binary. Returns "DONE" or "ALREADY_UP_TO_DATE". */
    public static String update(Context ctx) throws Exception {
        YoutubeDL.UpdateStatus status =
                YoutubeDL.getInstance().updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE.INSTANCE);
        try {
            version = YoutubeDL.getInstance().version(ctx);
        } catch (Throwable ignored) {
            // keep the old version string
        }
        return status == null ? "DONE" : status.name();
    }

    public static String tail(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() <= max ? t : t.substring(t.length() - max);
    }
}
