package com.aibuddy.panel.mobile;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;
import android.widget.Toast;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.OutputStream;
import java.util.UUID;

/** User-initiated web downloads -> system document picker. No JavaScript/native interface. */
final class DashboardDownloads {
    private static final int SAVE=402, MAX_BYTES=16*1024*1024;
    private final Activity activity;
    private final WebView web;
    private final String origin;
    private final Handler main=new Handler(Looper.getMainLooper());
    private byte[] pending;
    private boolean busy, closed;
    DashboardDownloads(Activity activity,WebView web,String entry){
        this.activity=activity;this.web=web;this.origin=entry.replaceAll("/$","");
        web.setDownloadListener((url,userAgent,disposition,mime,length)->begin(url,mime));
    }
    void observeClicks(){
        // The app's export code clicks a temporary blob anchor; retain its file name before it is removed.
        web.evaluateJavascript("(function(){if(window.__aibuddyDownloadClick)return;window.__aibuddyDownloadClick=true;document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[download]');if(a)window.__aibuddyDownloadMeta={url:a.href,name:a.download};},true)})()",null);
    }
    private void begin(String url,String mime){
        if(closed||busy)return;
        try {
            if(!(url.startsWith("blob:"+origin+"/")||url.startsWith("data:"))) {
                if(!LocalGatewayPlugin.dashboardUrl(url).equals(origin+"/"))throw new IllegalArgumentException("请在系统浏览器打开外部下载链接");
            }
            busy=true;
            String slot="__aibuddyExport_"+UUID.randomUUID().toString().replace("-","");
            String key=JSONObject.quote(slot),source=JSONObject.quote(url);
            String script="(function(){var x={state:'loading',offset:0};window["+key+"]=x;var m=window.__aibuddyDownloadMeta;x.name=m&&m.url==="+source+"?m.name:'';fetch("+source+",{credentials:'same-origin'}).then(function(r){if(!r.ok)throw Error('下载失败 HTTP '+r.status);return r.blob()}).then(function(b){if(b.size>"+MAX_BYTES+")throw Error('导出超过 16 MB，请使用系统浏览器下载');x.mime=b.type;var f=new FileReader();f.onload=function(){x.data=String(f.result).split(',')[1]||'';x.state='ready'};f.onerror=function(){x.error='读取导出文件失败';x.state='error'};f.readAsDataURL(b)}).catch(function(e){x.error=String(e.message||e);x.state='error'});return true})()";
            web.evaluateJavascript(script,ignored->poll(slot,new StringBuilder(),System.currentTimeMillis()+30000,mime));
        }catch(Exception error){busy=false;message(error.getMessage());}
    }
    private void poll(String slot,StringBuilder buffer,long until,String fallbackMime){
        if(closed)return;
        String key=JSONObject.quote(slot);
        String script="(function(){var x=window["+key+"];if(!x)return JSON.stringify({state:'error',error:'页面已切换，请重新导出'});if(x.state!=='ready')return JSON.stringify({state:x.state,error:x.error});var p=x.data.slice(x.offset,x.offset+65536);x.offset+=p.length;var done=x.offset>=x.data.length;var r={state:'ready',part:p,done:done,mime:x.mime,name:x.name};if(done)delete window["+key+"];return JSON.stringify(r)})()";
        web.evaluateJavascript(script,raw->{
            if(closed)return;
            try {
                Object decoded=new JSONTokener(raw).nextValue();
                if(!(decoded instanceof String))throw new IllegalStateException("页面已切换，请重新导出");
                JSONObject result=new JSONObject((String)decoded);
                if("error".equals(result.optString("state")))throw new IllegalStateException(result.optString("error","下载失败"));
                if("ready".equals(result.optString("state"))){
                    buffer.append(result.optString("part"));
                    if(buffer.length()>MAX_BYTES*4/3+8)throw new IllegalStateException("导出文件过大，请使用系统浏览器下载");
                    if(result.optBoolean("done")){
                        pending=Base64.decode(buffer.toString(),Base64.DEFAULT);
                        String type=result.optString("mime",fallbackMime==null?"application/octet-stream":fallbackMime);
                        type=type.split(";")[0];
                        if(!type.matches("[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+"))type="application/octet-stream";
                        String filename=result.optString("name","").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
                        if(filename.isEmpty())filename=type.contains("json")?"aibuddy-export.json":type.contains("csv")?"aibuddy-export.csv":"aibuddy-export.txt";
                        if(filename.length()>128)filename=filename.substring(0,128);
                        activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type).putExtra(Intent.EXTRA_TITLE,filename),SAVE);
                        return;
                    }
                }
                if(System.currentTimeMillis()>until)throw new IllegalStateException("导出超时，请重试");
                main.postDelayed(()->poll(slot,buffer,until,fallbackMime),30);
            }catch(Exception error){
                web.evaluateJavascript("delete window["+key+"]",null);
                pending=null;busy=false;message(error.getMessage());
            }
        });
    }
    boolean onResult(int code,int result,Intent data){
        if(code!=SAVE)return false;
        byte[] bytes=pending;pending=null;busy=false;
        if(result==Activity.RESULT_OK&&data!=null&&data.getData()!=null&&"content".equals(data.getData().getScheme())&&bytes!=null){
            android.net.Uri destination=data.getData();
            new Thread(()->{
                try(OutputStream output=activity.getContentResolver().openOutputStream(destination,"w")){
                    if(output==null)throw new IllegalStateException("无法打开保存位置");output.write(bytes);main.post(()->message("导出文件已保存"));
                }catch(Exception error){main.post(()->message("保存失败："+error.getMessage()));}
            },"panel-export").start();
        }
        return true;
    }
    private void message(String text){if(!closed&&!activity.isFinishing())Toast.makeText(activity,text==null?"导出失败":text,Toast.LENGTH_LONG).show();}
    void close(){closed=true;pending=null;main.removeCallbacksAndMessages(null);web.setDownloadListener(null);}
}
