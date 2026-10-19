package com.aibuddy.panel.mobile;

import android.content.*;
import android.os.*;
import android.app.Activity;
import android.view.*;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.test.espresso.intent.Intents;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
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
        scenario.onActivity(activity->{Intent intent=new Intent(activity,GatewayService.class).setAction(action).putExtra("port",3065).putExtra("reply",GatewayService.remoteReceiver(receiver));if(GatewayService.START.equals(action))activity.startForegroundService(intent);else activity.startService(intent);});
        assertTrue("native service replied",latch.await(90,TimeUnit.SECONDS));assertEquals(String.valueOf(result.get()),0,code.get());return result.get();
    }
    private int request(String method, String path) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL("http://127.0.0.1:3065"+path).openConnection(Proxy.NO_PROXY);
        connection.setRequestMethod(method);
        if("POST".equals(method)){connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.getOutputStream().write("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        connection.setConnectTimeout(3000);connection.setReadTimeout(3000);connection.setInstanceFollowRedirects(false);
        try{return connection.getResponseCode();}finally{connection.disconnect();}
    }
    private WebView webView(View root){
        if(root instanceof WebView)return (WebView)root;
        if(root instanceof ViewGroup)for(int i=0;i<((ViewGroup)root).getChildCount();i++){WebView found=webView(((ViewGroup)root).getChildAt(i));if(found!=null)return found;}
        return null;
    }
    private void exportWithTheSystemPicker() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File output=File.createTempFile("gateway-export-",".json",context.getCacheDir());
        Intent chosen=new Intent().setData(FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",output));
        Intents.init();
        try {
            Intents.intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(new android.app.Instrumentation.ActivityResult(Activity.RESULT_OK,chosen));
            Intent open=new Intent(context,DashboardActivity.class).putExtra("url","http://127.0.0.1:3065").putExtra("name","Local test");
            try(ActivityScenario<DashboardActivity> dashboard=ActivityScenario.launch(open)){
                boolean ready=false;
                for(int i=0;i<100&&!ready;i++){
                    CountDownLatch latch=new CountDownLatch(1);AtomicBoolean loaded=new AtomicBoolean();
                    dashboard.onActivity(activity->{WebView web=webView(activity.findViewById(android.R.id.content));web.evaluateJavascript("document.readyState==='complete' && document.body!==null && location.pathname==='/login'",value->{loaded.set("true".equals(value));latch.countDown();});});
                    latch.await(2,TimeUnit.SECONDS);ready=loaded.get();if(!ready)Thread.sleep(100);
                }
                assertTrue("embedded full panel reached its login page",ready);
                dashboard.onActivity(activity->{WebView web=webView(activity.findViewById(android.R.id.content));web.evaluateJavascript("(function(){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['native-export-fixture'],{type:'application/json'}));a.download='fixture.json';document.body.appendChild(a);a.click();a.remove()})()",null);});
                long until=System.currentTimeMillis()+30000;
                while(output.length()==0&&System.currentTimeMillis()<until)Thread.sleep(100);
                assertTrue("blob export was written through the chosen content URI",output.length()>0);
                try(FileInputStream input=new FileInputStream(output)){byte[] bytes=new byte[(int)output.length()];assertEquals(bytes.length,input.read(bytes));assertEquals("native-export-fixture",new String(bytes,java.nio.charset.StandardCharsets.UTF_8));}
                Intents.intended(hasAction(Intent.ACTION_CREATE_DOCUMENT));
            }
        }finally{Intents.release();output.delete();}
    }
    @Test public void gatewayRunsWithoutARemoteServer() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            JSONObject state=command(scenario,GatewayService.START);assertTrue(state.getBoolean("running"));assertEquals("http://127.0.0.1:3065",state.getString("base"));
            assertEquals(200,request("GET", "/health"));assertEquals(200,request("GET", "/login"));assertEquals(200,request("GET", "/islands/ui.js"));
            assertEquals("inference fails closed until an API key is configured",503,request("POST", "/v1/chat/completions"));assertEquals("new panel requires setup/login",401,request("GET", "/api/accounts"));
            File data=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"gateway-data/agent2api.db");
            // Exact database filename can evolve; private data directory must contain persisted state.
            assertTrue(data.getParentFile().isDirectory());assertTrue(data.getParentFile().list().length>0);
            exportWithTheSystemPicker();
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
