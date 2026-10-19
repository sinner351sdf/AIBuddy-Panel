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
    private JSONObject evaluate(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<JSONObject> result=new AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{
            try{Object decoded=new org.json.JSONTokener(value).nextValue();if(decoded instanceof String&&!"null".equals(decoded))result.set(new JSONObject((String)decoded));}catch(Exception invalid){}finally{latch.countDown();}
        }));
        assertTrue("WebView responded",latch.await(5,TimeUnit.SECONDS));return result.get();
    }
    private JSONObject command(ActivityScenario<MainActivity> scenario,String action) throws Exception {
        JSONObject ready=null;
        for(int i=0;i<100&&ready==null;i++){
            ready=evaluate(scenario,"typeof window.Capacitor?.nativePromise==='function' && document.getElementById('local-gateway-port')?JSON.stringify({ready:true}):null");
            if(ready==null)Thread.sleep(100);
        }
        assertNotNull("packaged Capacitor bridge initialized",ready);
        String method=JSONObject.quote(action);
        // This is exactly the dispatch used by registerPlugin's promise methods.
        evaluate(scenario,"(function(){window.__gatewayDeviceReply=null;Capacitor.nativePromise('LocalGateway',"+method+",{port:3065}).then(function(state){window.__gatewayDeviceReply={ok:true,state:state}}).catch(function(error){window.__gatewayDeviceReply={ok:false,error:String(error)}});return null})()");
        long until=System.currentTimeMillis()+90000;JSONObject reply=null;
        while(reply==null&&System.currentTimeMillis()<until){reply=evaluate(scenario,"JSON.stringify(window.__gatewayDeviceReply||null)");if(reply==null)Thread.sleep(100);}
        assertNotNull("native plugin replied through the real WebView bridge",reply);
        assertTrue(reply.toString(),reply.getBoolean("ok"));return reply.getJSONObject("state");
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
                boolean ready=false;AtomicBoolean mobileShellSeen=new AtomicBoolean();
                for(int i=0;i<100&&!ready;i++){
                    CountDownLatch latch=new CountDownLatch(1);AtomicBoolean loaded=new AtomicBoolean();
                    dashboard.onActivity(activity->{WebView web=webView(activity.findViewById(android.R.id.content));web.evaluateJavascript("(function(){if(location.pathname==='/m' && document.querySelector('.m-app')){var b=document.querySelector('[data-slot=dialog-footer] button');if(b){b.click();return 'mobile-login-required'}}return document.readyState==='complete' && document.body!==null && navigator.userAgent.includes(' AIBuddyPanelNative/') && typeof window.Capacitor==='undefined' && location.pathname==='/login' && new URLSearchParams(location.search).get('next')==='/m'})()",value->{loaded.set("true".equals(value));if("\"mobile-login-required\"".equals(value))mobileShellSeen.set(true);latch.countDown();});});
                    latch.await(2,TimeUnit.SECONDS);ready=loaded.get();if(!ready)Thread.sleep(100);
                }
                assertTrue("fresh install rendered the dedicated mobile shell and its login prompt",mobileShellSeen.get());
                assertTrue("mobile login prompt opens login with a return to /m",ready);
                CountDownLatch fixtureReady=new CountDownLatch(1);
                dashboard.onActivity(activity->{WebView web=webView(activity.findViewById(android.R.id.content));web.evaluateJavascript("(function(){var f=document.createElement('iframe');f.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:white';document.body.appendChild(f);var d=f.contentDocument;var b=d.createElement('button');b.textContent='Export fixture';b.style.cssText='position:fixed;inset:0;background:white';b.onclick=function(){var a=d.createElement('a');a.href=f.contentWindow.URL.createObjectURL(new f.contentWindow.Blob(['native-export-fixture'],{type:'application/json'}));a.download='fixture.json';d.body.appendChild(a);a.click();a.remove()};d.body.appendChild(b)})()",ignored->fixtureReady.countDown());});
                assertTrue(fixtureReady.await(5,TimeUnit.SECONDS));
                // A real touch supplies WebView user activation, as in the actual export button flow.
                androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom(WebView.class)).perform(androidx.test.espresso.action.ViewActions.click());
                long until=System.currentTimeMillis()+30000;
                while(output.length()==0&&System.currentTimeMillis()<until)Thread.sleep(100);
                assertTrue("blob export was written through the chosen content URI",output.length()>0);
                try(FileInputStream input=new FileInputStream(output)){byte[] bytes=new byte[(int)output.length()];assertEquals(bytes.length,input.read(bytes));assertEquals("native-export-fixture",new String(bytes,java.nio.charset.StandardCharsets.UTF_8));}
                Intents.intended(org.hamcrest.Matchers.allOf(hasAction(Intent.ACTION_CREATE_DOCUMENT),androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra(Intent.EXTRA_TITLE,"fixture.json")));
            }
        }finally{Intents.release();output.delete();}
    }
    @Test public void gatewayRunsWithoutARemoteServer() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        // The test uses an API 35 emulator; grant the notification permission a user
        // normally chooses before pressing Start, so automation need not dismiss OS UI.
        InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            JSONObject state=command(scenario,GatewayService.START);assertTrue(state.getBoolean("running"));assertEquals("http://127.0.0.1:3065",state.getString("base"));
            assertEquals(200,request("GET", "/health"));assertEquals(200,request("GET", "/login"));assertEquals(200,request("GET", "/islands/ui.js"));
            assertEquals(200,request("GET", "/m/mobile.js"));assertEquals(200,request("GET", "/m/mobile.css"));
            assertEquals("inference fails closed until an API key is configured",503,request("POST", "/v1/chat/completions"));assertEquals("new panel requires setup/login",401,request("GET", "/api/accounts"));
            File data=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"gateway-data/agent2api.db");
            // Exact database filename can evolve; private data directory must contain persisted state.
            assertTrue(data.getParentFile().isDirectory());assertTrue(data.getParentFile().list().length>0);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            assertEquals("gateway survives UI backgrounding",200,request("GET", "/health"));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            exportWithTheSystemPicker();
            // Launching another ActivityScenario replaces the old task. Reopen the
            // launcher instead of trying to resume its already-destroyed Activity.
            try(ActivityScenario<MainActivity> controls=ActivityScenario.launch(MainActivity.class)){
                assertFalse(command(controls,GatewayService.STOP).getBoolean("running"));
            }
            long until=System.currentTimeMillis()+5000;boolean stopped=false;
            while(System.currentTimeMillis()<until){try{request("GET", "/health");Thread.sleep(100);}catch(IOException expected){stopped=true;break;}}
            assertTrue("stop releases the loopback listener",stopped);
        }
    }
}
