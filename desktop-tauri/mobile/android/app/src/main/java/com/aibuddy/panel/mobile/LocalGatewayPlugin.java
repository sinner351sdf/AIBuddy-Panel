package com.aibuddy.panel.mobile;

import android.Manifest;
import android.app.ActivityManager;
import android.content.*;
import android.os.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.net.URI;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="LocalGateway",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public final class LocalGatewayPlugin extends Plugin {
    @PluginMethod public void start(PluginCall call){
        if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED){requestPermissionForAlias("notifications",call,"afterNotificationPermission");return;}
        command(GatewayService.START,call);
    }
    @PermissionCallback private void afterNotificationPermission(PluginCall call){command(GatewayService.START,call);}
    @PluginMethod public void stop(PluginCall call){
        if(!serviceExists()){call.resolve(new JSObject().put("running",false));return;}
        command(GatewayService.STOP,call);
    }
    @PluginMethod public void status(PluginCall call){
        if(!serviceExists()){call.resolve(new JSObject().put("running",false));return;}
        command(GatewayService.STATUS,call);
    }
    private boolean serviceExists(){
        ActivityManager manager=(ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
        for(ActivityManager.RunningServiceInfo info:manager.getRunningServices(Integer.MAX_VALUE))if(info.service.getClassName().equals(GatewayService.class.getName()))return true;
        return false;
    }
    private boolean gatewayProcessExists(){
        ActivityManager manager=(ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes=manager.getRunningAppProcesses();
        if(processes!=null)for(ActivityManager.RunningAppProcessInfo p:processes)if(p.processName.equals(getContext().getPackageName()+":gateway"))return true;
        return false;
    }
    private void awaitProcessExit() throws Exception {
        long until=System.currentTimeMillis()+6000;
        while(gatewayProcessExists()&&System.currentTimeMillis()<until)Thread.sleep(100);
        if(gatewayProcessExists())throw new IllegalStateException("本机网关仍在停止中，请稍后重试");
    }
    private void command(String action,PluginCall call){
        Handler main=new Handler(Looper.getMainLooper());AtomicBoolean settled=new AtomicBoolean(false);
        Runnable timeout=()->{if(settled.compareAndSet(false,true))call.reject("本机网关操作超时，请查看服务通知后重试");};
        main.postDelayed(timeout,90000);
        ResultReceiver receiver=new ResultReceiver(main){@Override protected void onReceiveResult(int code,Bundle data){
            if(!settled.compareAndSet(false,true))return;main.removeCallbacks(timeout);
            try{
                JSObject result=new JSObject(data.getString("json","{}"));
                if(code!=0){call.reject(result.getString("error","本机网关操作失败"));return;}
                if(GatewayService.STOP.equals(action)){
                    getBridge().execute(()->{try{awaitProcessExit();call.resolve(result);}catch(Exception error){call.reject(error.getMessage());}});
                }else call.resolve(result);
            }catch(Exception error){call.reject(error.getMessage());}
        }};
        getBridge().execute(()->{
            try {
                if(GatewayService.START.equals(action)&&!serviceExists()&&gatewayProcessExists())awaitProcessExit();
                Intent intent=new Intent(getContext(),GatewayService.class).setAction(action).putExtra("port",call.getInt("port",3065)).putExtra("reply",receiver);
                if(GatewayService.START.equals(action)&&Build.VERSION.SDK_INT>=26)getContext().startForegroundService(intent);else getContext().startService(intent);
            }catch(Exception failure){main.removeCallbacks(timeout);if(settled.compareAndSet(false,true))call.reject(failure.getMessage());}
        });
    }
    static String dashboardUrl(String raw){
        URI uri=URI.create(raw);
        if(!("http".equals(uri.getScheme())||"https".equals(uri.getScheme()))||uri.getHost()==null||uri.getRawUserInfo()!=null||uri.getPort()==0||uri.getPort()>65535)throw new IllegalArgumentException("服务器地址不合法");
        return uri.getScheme()+"://"+uri.getRawAuthority()+"/";
    }
    @PluginMethod public void openDashboard(PluginCall call){
        try {
            String url=dashboardUrl(call.getString("url",""));
            String name=call.getString("name","AIBuddy Panel");
            Intent intent=new Intent(getActivity(),DashboardActivity.class).putExtra("url",url).putExtra("name",name);
            getActivity().runOnUiThread(()->{getActivity().startActivity(intent);call.resolve();});
        }catch(Exception error){call.reject(error.getMessage());}
    }
}
