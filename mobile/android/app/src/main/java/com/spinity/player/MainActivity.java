package com.spinity.player;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TermuxBridgePlugin.class);
        registerPlugin(SpinityBridgePlugin.class);
        super.onCreate(savedInstanceState);
        // Unpack the bundled python + yt-dlp + ffmpeg in the background so
        // search/download are instant by the time the user tries them.
        YtDlpEngine.ensureInit(getApplicationContext());
    }
}
