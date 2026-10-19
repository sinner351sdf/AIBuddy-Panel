package com.aibuddy.panel.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(LocalGatewayPlugin.class);
        super.onCreate(state);
    }
}
