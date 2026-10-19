package com.aibuddy.panel.mobile;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.widget.*;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.*;

/** A first-party WebView for the mobile panel. Remote pages receive NO native/Capacitor bridge. */
public final class DashboardActivity extends AppCompatActivity {
    private WebView web;
    private DashboardDownloads downloads;
    private android.webkit.ValueCallback<Uri[]> files;
    private String entry;
    private String origin;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        try{origin=LocalGatewayPlugin.dashboardUrl(getIntent().getStringExtra("url"));entry=origin+"m";}catch(Exception invalid){finish();return;}
        setTitle(getIntent().getStringExtra("name"));
        android.widget.FrameLayout root=new android.widget.FrameLayout(this);
        ViewCompat.setOnApplyWindowInsetsListener(root,(view,insets)->{Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        web=new WebView(this);root.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));setContentView(root);
        WebSettings settings=web.getSettings();settings.setUserAgentString(settings.getUserAgentString()+" AIBuddyPanelNative/1");settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setSupportMultipleWindows(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        downloads=new DashboardDownloads(this,web,origin);
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String url){downloads.observeClicks();}
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri url=request.getUrl();String scheme=url.getScheme();
                if(!("http".equals(scheme)||"https".equals(scheme)))return true;
                Uri base=Uri.parse(entry);
                if(base.getScheme().equals(scheme)&&base.getAuthority().equals(url.getAuthority()))return false;
                if(request.hasGesture())openExternal(url);return true;
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())new androidx.appcompat.app.AlertDialog.Builder(DashboardActivity.this).setTitle("无法连接网关").setMessage("确认服务已启动、地址正确，然后重试。").setPositiveButton("重试",(dialog,which)->web.loadUrl(entry)).setNegativeButton("返回服务选择",(dialog,which)->finish()).show();}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(files!=null)files.onReceiveValue(null);files=callback;
                try{startActivityForResult(params.createIntent(),401);return true;}catch(Exception unavailable){files.onReceiveValue(null);files=null;return false;}
            }
            @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean userGesture,android.os.Message message){
                if(!userGesture)return false;
                // OAuth/help popups are opened in the user's browser, never a native-privileged WebView.
                WebView popup=new WebView(DashboardActivity.this);
                popup.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView unused,WebResourceRequest request){Uri uri=request.getUrl();if("https".equals(uri.getScheme())||"http".equals(uri.getScheme()))openExternal(uri);popup.destroy();return true;}});
                ((WebView.WebViewTransport)message.obj).setWebView(popup);message.sendToTarget();return true;
            }
        });
        // Secondary screens return to the mobile tab; a primary screen returns to service selection.
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){
            web.evaluateJavascript("(function(){var b=document.querySelector('.m-navbar button');if(b){b.click();return true}return false})()",handled->{if(!"true".equals(handled))finish();});
        }});
        if(state==null)web.loadUrl(entry);else web.restoreState(state);
    }
    private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException ignored){}}
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(downloads!=null&&downloads.onResult(code,result,data))return;if(code==401&&files!=null){files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));files=null;}}
    @Override protected void onSaveInstanceState(Bundle state){if(web!=null)web.saveState(state);super.onSaveInstanceState(state);}
    @Override protected void onPause(){CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onDestroy(){if(files!=null)files.onReceiveValue(null);if(downloads!=null)downloads.close();if(web!=null){web.stopLoading();web.destroy();}super.onDestroy();}
}
