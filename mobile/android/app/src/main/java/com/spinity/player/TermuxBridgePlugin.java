package com.spinity.player;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges Spinity to Termux.
 *
 * The phone build downloads music with yt-dlp, which is not shipped inside
 * the APK: it runs in Termux (a real Linux userland), where it can also be
 * kept up to date with a single pip command when YouTube changes. This plugin
 * only sends commands over and reports whether the setup is complete — all
 * orchestration (job files, progress, library updates) happens in native.js.
 *
 * Requirements on the Termux side (see MOBILE.md):
 *   - allow-external-apps=true in ~/.termux/termux.properties
 *   - python + pip + ffmpeg + yt-dlp installed
 */
@CapacitorPlugin(name = "TermuxBridge")
public class TermuxBridgePlugin extends Plugin {

    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    private static final String TERMUX_SHELL = "/data/data/com.termux/files/usr/bin/bash";

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("termuxInstalled", isTermuxInstalled());
        ret.put("filesAccess", hasFilesAccess());
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestFilesAccess(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                Intent i = new Intent(
                        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } else if (getActivity() != null) {
                getActivity().requestPermissions(
                        new String[] {
                                "android.permission.READ_EXTERNAL_STORAGE",
                                "android.permission.WRITE_EXTERNAL_STORAGE"
                        }, 4711);
            }
            call.resolve();
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open the file-access settings: " + e2.getMessage());
            }
        }
    }

    @PluginMethod
    public void openTermux(PluginCall call) {
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
        if (launch == null) {
            call.reject("Termux is not installed");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(launch);
        call.resolve();
    }

    @PluginMethod
    public void exec(PluginCall call) {
        String cmd = call.getString("cmd");
        if (cmd == null || cmd.isEmpty()) {
            call.reject("cmd is required");
            return;
        }
        if (!isTermuxInstalled()) {
            call.reject("Termux is not installed");
            return;
        }
        try {
            Intent i = new Intent();
            i.setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE);
            i.setAction(ACTION_RUN_COMMAND);
            i.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_SHELL);
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[] { "-lc", cmd });
            i.putExtra("com.termux.RUN_COMMAND_WORKDIR", TERMUX_HOME);
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            i.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");
            i.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Spinity");
            getContext().startService(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Termux refused the command: " + e.getMessage() +
                    " (check allow-external-apps=true in ~/.termux/termux.properties)");
        }
    }

    private boolean isTermuxInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private boolean hasFilesAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            return Environment.isExternalStorageManager();
        }
        return getContext().checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE")
                == PackageManager.PERMISSION_GRANTED;
    }
}
