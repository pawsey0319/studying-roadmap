package io.github.pawsey0319.learninghub;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onStart() {
        super.onStart(); ScreenContextPlugin.ownVisible = true;
        ScreenCaptureService s = ScreenCaptureService.current; if (s != null) s.pauseCapture();
    }
    @Override public void onStop() {
        ScreenContextPlugin.ownVisible = false;
        ScreenCaptureService s = ScreenCaptureService.current; if (s != null) s.resumeCapture();
        super.onStop();
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenContextPlugin.class);
        registerPlugin(AppUpdatePlugin.class);   // App 内更新（app/native/AppUpdatePlugin.java）
        super.onCreate(savedInstanceState);
    }
}
