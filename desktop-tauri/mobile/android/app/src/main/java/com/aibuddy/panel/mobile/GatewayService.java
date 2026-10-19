package com.aibuddy.panel.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;

/** The isolated process makes a stop/restart discard every Rust scheduler and global handle. */
public final class GatewayService extends Service {
    public static final String START="start", STOP="stop", STATUS="status";
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private volatile boolean running=false;
    private int port=3065;
    private String error="";
    private static final String CHANNEL="local_gateway";
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        String action=intent.getAction();
        ResultReceiver receiver=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra("reply",ResultReceiver.class):intent.getParcelableExtra("reply");
        if(START.equals(action)){
            try {foreground();}catch(Exception failure){error=failure.getMessage();reply(receiver,false);stopSelf();return START_NOT_STICKY;}
        }
        worker.execute(()->{
            try {
                if(START.equals(action)){
                    int requested=intent.getIntExtra("port",3065);
                    if(requested<1024||requested>65535)throw new IOException("端口需为 1024–65535 的整数");
                    if(running&&requested!=port)throw new IOException("请先停止本机网关，再修改端口");
                    if(!running){
                        port=requested;
                        File home=new File(getFilesDir(),"gateway-data"),ui=new File(getFilesDir(),"gateway-ui");
                        if(!home.isDirectory()&&!home.mkdirs())throw new IOException("无法创建本机数据目录");
                        copyAssets("gateway-ui",ui);
                        JSONObject result=new JSONObject(GatewayNative.start(home.getAbsolutePath(),ui.getAbsolutePath(),port));
                        if(!result.optBoolean("ok"))throw new IOException(result.optString("error","本机网关启动失败"));
                        waitHealthy(); running=true; error=""; foreground();
                    }
                    reply(receiver,true);
                }else if(STOP.equals(action)){
                    if(running)GatewayNative.stop();
                    running=false;error="";reply(receiver,true);stopSelf();
                }else{
                    reply(receiver,true);if(!running)stopSelf();
                }
            }catch(Throwable failure){
                error=failure.getMessage()==null?failure.getClass().getSimpleName():failure.getMessage();
                reply(receiver,false);if(!running)stopSelf();
            }
        });
        return START_NOT_STICKY;
    }
    private void waitHealthy() throws Exception {
        long until=System.currentTimeMillis()+20000;
        while(System.currentTimeMillis()<until){
            HttpURLConnection connection=null;
            try{
                connection=(HttpURLConnection)new URL("http://127.0.0.1:"+port+"/health").openConnection(Proxy.NO_PROXY);
                connection.setConnectTimeout(500);connection.setReadTimeout(500);
                if(connection.getResponseCode()==200)return;
            }catch(IOException ignored){}finally{if(connection!=null)connection.disconnect();}
            Thread.sleep(100);
        }
        throw new IOException("本机网关健康检查超时");
    }
    private void reply(ResultReceiver receiver,boolean success){
        if(receiver==null)return;
        try{
            JSONObject data=new JSONObject();data.put("running",running);data.put("base","http://127.0.0.1:"+port);data.put("version",getPackageManager().getPackageInfo(getPackageName(),0).versionName);
            if(!error.isEmpty())data.put("error",error);
            Bundle bundle=new Bundle();bundle.putString("json",data.toString());receiver.send(success?0:1,bundle);
        }catch(Exception ignored){receiver.send(1,Bundle.EMPTY);}
    }
    private void foreground(){
        NotificationManager manager=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel(CHANNEL,"本机网关",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,GatewayService.class).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("AIBuddy 本机网关").setContentText(running?"运行中 · 127.0.0.1:"+port:"正在启动本机网关…").setOngoing(true).setContentIntent(open).addAction(android.R.drawable.ic_media_pause,"停止",stop).build();
        if(Build.VERSION.SDK_INT>=34)startForeground(3065,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(3065,notification);
    }
    private void copyAssets(String asset,File target) throws IOException {
        String[] children=getAssets().list(asset);
        if(children!=null&&children.length>0){
            if(!target.isDirectory()&&!target.mkdirs())throw new IOException("无法创建内置网页目录");
            for(String child:children)copyAssets(asset+"/"+child,new File(target,child));
        }else{
            File next=new File(target.getPath()+".next");
            try(InputStream input=getAssets().open(asset);OutputStream output=new FileOutputStream(next)){byte[] bytes=new byte[32768];int n;while((n=input.read(bytes))!=-1)output.write(bytes,0,n);}
            if(!next.renameTo(target))throw new IOException("无法更新内置网页："+target.getName());
        }
    }
    @Override public void onDestroy(){
        running=false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        worker.shutdownNow();
        // This is the dedicated :gateway process, never the UI process.
        new Handler(Looper.getMainLooper()).postDelayed(()->android.os.Process.killProcess(android.os.Process.myPid()),750);
        super.onDestroy();
    }
}
