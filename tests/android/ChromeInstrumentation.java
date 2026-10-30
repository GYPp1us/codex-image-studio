package site.arcol.imagestudio;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.lang.reflect.Field;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs the real Activity + JS port in an isolated APK, without accounts or generation. */
public final class ChromeInstrumentation extends Instrumentation {
    private MainActivity activity;
    private WebView web;
    private View root;
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);start();}
    private Object field(String name) throws Exception {
        Field field=MainActivity.class.getDeclaredField(name);field.setAccessible(true);return field.get(activity);
    }
    private String js(String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(script,result->{value.set(result);done.countDown();}));
        check(done.await(10,TimeUnit.SECONDS),"JS timed out");return value.get();
    }
    private void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    private void bars(boolean visible) throws Exception {
        for(int i=0;i<50;i++){
            AtomicReference<Boolean> actual=new AtomicReference<>();
            runOnMainSync(()->{WindowInsets insets=root.getRootWindowInsets();actual.set(insets!=null
                && insets.isVisible(WindowInsets.Type.statusBars())==visible
                && insets.isVisible(WindowInsets.Type.navigationBars())==visible);});
            if(Boolean.TRUE.equals(actual.get()))return;Thread.sleep(100);
        }
        throw new AssertionError("System bars did not become visible="+visible);
    }
    @Override public void onStart(){
        Bundle result=new Bundle();
        try {
            activity=(MainActivity)startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            web=(WebView)field("web");root=(View)field("root");
            int resource=getTargetContext().getResources().getIdentifier("studio_chrome","raw",getTargetContext().getPackageName());
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            try(InputStream input=getTargetContext().getResources().openRawResource(resource)){
                byte[] buffer=new byte[8192];int read;while((read=input.read(buffer))!=-1)bytes.write(buffer,0,read);
            }
            String chrome=new String(bytes.toByteArray(),StandardCharsets.UTF_8);
            String html="<html><head><meta name='viewport' content='width=device-width,initial-scale=1'><meta name='theme-color' content='#f5f4ef'><style>"
                +"html,body{margin:0;height:100%}#app{position:relative;height:100%;background:rgb(245,244,239)}#screens,#layers{position:absolute;inset:0;pointer-events:none}#screens{z-index:55}#layers{z-index:60}.scrim{position:absolute;inset:0;background:rgba(20,20,16,.38)}.sheet{position:absolute;bottom:0;height:200px;width:100%;background:rgb(255,254,250)}"
                +"</style></head><body><div id='app'><div id='screens'></div><div id='layers'></div></div><script>const app=document.getElementById('app');window.connected=0;addEventListener('message',e=>{if(e.data==='IMAGE_STUDIO_CHROME_PORT_V1')window.connected++;});</script><script>"
                +chrome+"</script></body></html>";
            CountDownLatch loaded=new CountDownLatch(1);
            runOnMainSync(()->{
                web.stopLoading();WebViewClient original=web.getWebViewClient();
                web.setWebViewClient(new WebViewClient(){
                    @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){
                        if(request.isForMainFrame() && "/__qa_system_chrome__".equals(request.getUrl().getPath()))
                            return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                        return null;
                    }
                    @Override public void onPageStarted(WebView v,String url,Bitmap icon){original.onPageStarted(v,url,icon);}
                    @Override public void onPageFinished(WebView v,String url){original.onPageFinished(v,url);loaded.countDown();}
                });
                web.loadUrl("https://image.arcol.site/__qa_system_chrome__");
            });
            check(loaded.await(20,TimeUnit.SECONDS),"Fixture did not load");
            for(int i=0;i<40&&!"1".equals(js("window.connected"));i++)Thread.sleep(100);
            check("1".equals(js("window.connected")),"Native channel not delivered: "+js("JSON.stringify({connected:window.connected,url:location.href,ua:navigator.userAgent,chrome:typeof StudioChrome})")+" port="+(field("chromePort")!=null));
            Thread.sleep(550);bars(true);
            check((Integer)field("topColor")==Color.rgb(245,244,239),"Initial native color");
            js("document.getElementById('layers').innerHTML='<div class=\"scrim\"></div><div class=\"sheet\"></div>';document.querySelector('.scrim').animate([{opacity:0},{opacity:1}],{duration:220});");
            Thread.sleep(600);
            check((Integer)field("topColor")==Color.rgb(160,159,154),"Menu status-bar dimming");
            check((Integer)field("bottomColor")==Color.rgb(255,254,250),"Menu navigation-bar surface");
            AtomicReference<Integer> appearance=new AtomicReference<>();
            runOnMainSync(()->appearance.set(activity.getWindow().getInsetsController().getSystemBarsAppearance()));
            check((appearance.get()&WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)!=0,"Menu needs dark status glyphs");
            Bitmap screenshot=getUiAutomation().takeScreenshot();
            int sample=screenshot.getPixel(screenshot.getWidth()/2,2);screenshot.recycle();
            check(sample==Color.rgb(160,159,154),"Actual inset band is not painted: "+Integer.toHexString(sample));
            js("StudioChrome.enterViewer()");bars(false);
            check((Integer)field("topColor")==Color.rgb(12,12,10),"Viewer native background");
            runOnMainSync(()->{activity.onWindowFocusChanged(false);callActivityOnPause(activity);callActivityOnResume(activity);activity.onWindowFocusChanged(true);});bars(false);
            runOnMainSync(()->appearance.set(activity.getWindow().getInsetsController().getSystemBarsAppearance()));
            check((appearance.get()&WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS)==0,"Viewer needs light transient glyphs");
            js("StudioChrome.leaveViewer();true");bars(true);Thread.sleep(300);
            check((Integer)field("topColor")==Color.rgb(160,159,154),"Viewer close restores dimmed menu");
            js("document.getElementById('layers').innerHTML=''");Thread.sleep(550);
            check((Integer)field("topColor")==Color.rgb(245,244,239),"Menu close restores page");
            result.putString("stream","PASS: origin channel, actual gray inset pixels, separate bottom surface, status/navigation hide, focus resume and close restoration\n");
            runOnMainSync(()->activity.finish());finish(Activity.RESULT_OK,result);
        } catch(Throwable error){
            result.putString("stream","FAIL: "+error.toString()+"\n");
            if(activity!=null)runOnMainSync(()->activity.finish());finish(Activity.RESULT_CANCELED,result);
        }
    }
}
