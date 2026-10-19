package com.aibuddy.panel.mobile;

/** Only loaded inside the isolated :gateway foreground-service process. */
public final class GatewayNative {
    static { System.loadLibrary("aibuddy_gateway"); }
    private GatewayNative() {}
    public static native String start(String home, String ui, int port);
    public static native String stop();
}
