package site.arcol.imagestudio;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import java.util.ArrayList;

/** Thin trusted client. The LA server owns generation, queue and account credentials. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://image.arcol.site/";
    private static final int FILE_REQUEST = 101;
    private WebView web;
    private FrameLayout root;
    private LinearLayout offline;
    private ValueCallback<Uri[]> fileCallback;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(250,249,246));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(250,249,246));
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().getInsetsController().setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            root.setOnApplyWindowInsetsListener((v,insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                int keyboard = insets.getInsets(WindowInsets.Type.ime()).bottom;
                root.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard));
                return WindowInsets.CONSUMED;
            });
        }
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // document picker URIs only; no native JS bridge.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString()+" ImageStudioAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (trusted(url)) return false;
                if (request.isForMainFrame() && "https".equals(url.getScheme())) openExternal(url);
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showOffline("安全连接失败，请检查设备时间和网络。");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if(request.isForMainFrame()) showOffline("连接网络后继续。已提交任务仍在服务器运行。");
            }
            @Override public void onPageFinished(WebView view, String url) {CookieManager.getInstance().flush();}
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if(!trusted(Uri.parse(view.getUrl()==null?"":view.getUrl())))return false;
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                fileCallback=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/png","image/jpeg","image/webp"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {startActivityForResult(intent,FILE_REQUEST);} catch(Exception e){fileCallback.onReceiveValue(null);fileCallback=null;Toast.makeText(MainActivity.this,"没有可用的图片选择器",Toast.LENGTH_SHORT).show();}
                return true;
            }
        });
        web.setDownloadListener((url,ua,disposition,mime,length)->download(Uri.parse(url),ua));
        if(Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::goBack);
        if(savedInstanceState==null || web.restoreState(savedInstanceState)==null)web.loadUrl(HOME);
    }

    private static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme()) && "image.arcol.site".equals(uri.getHost()) && (uri.getPort()==-1 || uri.getPort()==443) && uri.getUserInfo()==null;
    }
    private void openExternal(Uri uri) {
        try {startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}
        catch(Exception e){Toast.makeText(this,"无法打开外部浏览器，可复制链接继续",Toast.LENGTH_SHORT).show();}
    }
    private void download(Uri uri,String userAgent) {
        if(trusted(uri) && "/downloads/image-studio.apk".equals(uri.getPath())){openExternal(uri);return;}
        if(!trusted(uri) || uri.getPath()==null || !uri.getPath().matches("/media/[a-f0-9]{32}")) {
            Toast.makeText(this,"请在系统浏览器下载应用安装包",Toast.LENGTH_SHORT).show();return;
        }
        try {
            DownloadManager.Request request=new DownloadManager.Request(uri);
            String cookie=CookieManager.getInstance().getCookie(HOME);
            if(cookie!=null)request.addRequestHeader("Cookie",cookie);
            request.addRequestHeader("User-Agent",userAgent);
            String filename="ImageStudio-"+uri.getLastPathSegment().substring(0,8)+"-"+System.currentTimeMillis()+".png";
            request.setTitle(filename).setMimeType("image/png").setAllowedOverMetered(true);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,filename);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this,"已开始保存到下载目录",Toast.LENGTH_SHORT).show();
        }catch(Exception e){Toast.makeText(this,"无法保存，请检查系统下载管理器",Toast.LENGTH_SHORT).show();}
    }
    private void showOffline(String message) {
        if(offline!=null)root.removeView(offline);
        offline=new LinearLayout(this);offline.setOrientation(LinearLayout.VERTICAL);offline.setGravity(android.view.Gravity.CENTER);offline.setPadding(50,50,50,50);offline.setBackgroundColor(Color.rgb(250,249,246));
        TextView title=new TextView(this);title.setText("Image Studio");title.setTextSize(24);title.setTextColor(Color.rgb(48,55,43));offline.addView(title);
        TextView text=new TextView(this);text.setText(message);text.setTextSize(15);text.setPadding(0,28,0,28);text.setGravity(android.view.Gravity.CENTER);offline.addView(text);
        Button retry=new Button(this);retry.setText("重新连接");retry.setOnClickListener(v->{root.removeView(offline);offline=null;web.loadUrl(HOME);});offline.addView(retry);
        root.addView(offline,new FrameLayout.LayoutParams(-1,-1));
    }
    private void goBack(){
        if(offline!=null){moveTaskToBack(true);return;}
        if(!trusted(Uri.parse(web.getUrl()==null?"":web.getUrl()))){moveTaskToBack(true);return;}
        web.evaluateJavascript("Boolean(window.studioBack && window.studioBack())",handled->{if(!"true".equals(handled))moveTaskToBack(true);});
    }
    @Override public void onBackPressed(){goBack();}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=FILE_REQUEST || fileCallback==null)return;
        ArrayList<Uri> items=new ArrayList<>();
        if(result==RESULT_OK && data!=null){
            ClipData clips=data.getClipData();
            if(clips!=null){for(int i=0;i<Math.min(8,clips.getItemCount());i++){Uri uri=clips.getItemAt(i).getUri();if("content".equals(uri.getScheme()))items.add(uri);}}
            else if(data.getData()!=null && "content".equals(data.getData().getScheme()))items.add(data.getData());
        }
        fileCallback.onReceiveValue(items.isEmpty()?null:items.toArray(new Uri[0]));fileCallback=null;
    }
    @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);}
    @Override protected void onPause(){CookieManager.getInstance().flush();web.onPause();super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);root.removeView(web);web.destroy();super.onDestroy();}
}
