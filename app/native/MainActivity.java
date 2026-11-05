package io.github.pawsey0319.learninghub;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppUpdatePlugin.class);   // App 内更新（app/native/AppUpdatePlugin.java）
        super.onCreate(savedInstanceState);
    }
}
