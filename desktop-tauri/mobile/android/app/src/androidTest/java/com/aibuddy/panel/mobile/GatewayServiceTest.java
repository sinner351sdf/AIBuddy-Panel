package com.aibuddy.panel.mobile;

import android.content.*;
import android.os.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

/** Device-side proof: bundled Rust JNI -> foreground service -> real HTTP and full-panel assets. */
@RunWith(AndroidJUnit4.class)
public class GatewayServiceTest {
    private JSONObject command(ActivityScenario<MainActivity> scenario,String action) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<JSONObject> result=new AtomicReference<>();AtomicInteger code=new AtomicInteger(-1);
        ResultReceiver receiver=new ResultReceiver(new Handler(Looper.getMainLooper())){@Override protected void onReceiveResult(int value,Bundle data){code.set(value);try{result.set(new JSONObject(data.getString("json","{}")));}catch(Exception invalid){}latch.countDown();}};
        scenario.onActivity(activity->{Intent intent=new Intent(activity,GatewayService.class).setAction(action).putExtra("port",3065).putExtra("reply",receiver);if(GatewayService.START.equals(action))activity.startForegroundService(intent);else activity.startService(intent);});
        assertTrue("native service replied",latch.await(90,TimeUnit.SECONDS));assertEquals(String.valueOf(result.get()),0,code.get());return result.get();
    }
    private int request(String method, String path) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL("http://127.0.0.1:3065"+path).openConnection(Proxy.NO_PROXY);
        connection.setRequestMethod(method);
        if("POST".equals(method)){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.getOutputStream().write("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        connection.setConnectTimeout(3000);connection.setReadTimeout(3000);connection.setInstanceFollowRedirects(false);
        try{return connection.getResponseCode();}finally{connection.disconnect();}
    }
    @Test public void gatewayRunsWithoutARemoteServer() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            JSONObject state=command(scenario,GatewayService.START);assertTrue(state.getBoolean("running"));assertEquals("http://127.0.0.1:3065",state.getString("base"));
            assertEquals(200,request("GET", "/health"));assertEquals(200,request("GET", "/login"));assertEquals(200,request("GET", "/islands/ui.js"));
            assertEquals("inference fails closed until an API key is configured",503,request("POST", "/v1/chat/completions"));assertEquals("new panel requires setup/login",401,request("GET", "/api/accounts"));
            File data=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"gateway-data/agent2api.db");
            // Exact database filename can evolve; private data directory must contain persisted state.
            assertTrue(data.getParentFile().isDirectory());assertTrue(data.getParentFile().list().length>0);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            assertEquals("gateway survives UI backgrounding",200,request("GET", "/health"));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            assertFalse(command(scenario,GatewayService.STOP).getBoolean("running"));
            long until=System.currentTimeMillis()+5000;boolean stopped=false;
            while(System.currentTimeMillis()<until){try{request("GET", "/health");Thread.sleep(100);}catch(IOException expected){stopped=true;break;}}
            assertTrue("stop releases the loopback listener",stopped);
        }
    }
}
