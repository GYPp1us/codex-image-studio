package site.arcol.imagestudio;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

/** Exact-origin, one-chunk-at-a-time cached bytes to a pending MediaStore download.
 * No URL fetching, file paths, credentials, or arbitrary native methods are exposed. */
final class CacheDownloads {
    private final WebView web;
    private final ContentResolver resolver;
    private final SharedPreferences journal;
    private final String packageName;
    private final BooleanSupplier trusted;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private WebMessagePort port;
    private volatile long generation;
    private boolean busy;
    private String requestId;
    private Runnable watchdog;
    private volatile Transfer transfer;
    private static final int CHUNK=65536;
    private static final long MAX_SAFE_SIZE=9007199254740991L;
    private static final int WRITING=0,ABORTED=1,PUBLISHING=2,COMPLETE=3;
    private static final class Transfer {
        String id,name,mime;long size,written,generation;int sequence;Uri uri;OutputStream output;
        final AtomicInteger state=new AtomicInteger(WRITING);
    }

    CacheDownloads(Context context,WebView web,BooleanSupplier trusted){
        this.web=web;this.resolver=context.getContentResolver();this.trusted=trusted;this.packageName=context.getPackageName();
        journal=context.getSharedPreferences("pending-cached-download",Context.MODE_PRIVATE);
        worker.execute(this::recover);
    }
    void connect(){
        close();final long epoch=generation;
        WebMessagePort[] channel=web.createWebMessageChannel();port=channel[0];final WebMessagePort expected=port;
        expected.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){
            @Override public void onMessage(WebMessagePort sender,WebMessage message){
                if(sender!=port||generation!=epoch||!trusted.getAsBoolean())return;
                String raw=message.getData();
                if(raw==null||raw.length()>90000){reject(expected,epoch,"","消息过大");return;}
                try{
                    JSONObject input=new JSONObject(raw);String id=input.getString("id"),type=input.getString("type");
                    if(!id.matches("[a-f0-9]{32}"))return;
                    if("cancel".equals(type)){
                        if(!id.equals(requestId))return;requestId=null;
                        Transfer current=transfer;
                        if(current!=null&&current.id.equals(id)&&current.generation==epoch)current.state.compareAndSet(WRITING,ABORTED);
                        worker.execute(()->{if(transfer!=null&&transfer.id.equals(id)&&transfer.generation==epoch)cleanup();});
                        return;
                    }
                    if(busy){reply(expected,epoch,id,"error",-1,"请等待上一段写入完成",false);return;}
                    busy=true;
                    if("begin".equals(type))requestId=id;
                    worker.execute(()->{
                        try{if(generation==epoch)consume(input,expected,epoch);}
                        catch(Exception error){cleanup();reply(expected,epoch,id,"error",-1,error.getMessage()==null?"无法保存到下载文件夹":error.getMessage());}
                    });
                }catch(Exception ignored){reject(expected,epoch,"","保存消息无效");}
            }
        });
        web.postWebMessage(new WebMessage("IMAGE_STUDIO_DOWNLOAD_PORT_V1",new WebMessagePort[]{channel[1]}),Uri.parse("https://image.arcol.site"));
    }
    private void consume(JSONObject input,WebMessagePort target,long epoch)throws Exception{
        String id=input.getString("id"),type=input.getString("type");
        if("begin".equals(type)){
            if(transfer!=null)throw new IllegalStateException("另一张图片仍在保存");
            long length=input.getLong("size");String mime=input.getString("mime");
            if(length<=0||length>MAX_SAFE_SIZE||!input.get("size").toString().matches("[0-9]+"))throw new IllegalArgumentException("图片大小无效");
            requireSpace(length);
            String extension="image/png".equals(mime)?".png":"image/jpeg".equals(mime)?".jpg":"image/webp".equals(mime)?".webp":null;
            if(extension==null)throw new IllegalArgumentException("不支持的图片格式");
            String name=input.optString("name","ImageStudio").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
            if(name.length()>100)name=name.substring(0,100);
            name=name.replaceAll("(?i)\\.(png|jpe?g|webp)$","");if(name.trim().isEmpty())name="ImageStudio";
            Transfer next=new Transfer();next.id=id;next.generation=epoch;next.size=length;next.mime=mime;next.name="ImageStudio-"+id.substring(0,8)+"-"+name+extension;transfer=next;
            ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,next.name);values.put(MediaStore.MediaColumns.MIME_TYPE,mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/ImageStudio");values.put(MediaStore.MediaColumns.IS_PENDING,1);
            next.uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
            if(next.uri==null)throw new IllegalStateException("无法创建下载文件");
            if(!remember(next.uri))throw new IllegalStateException("无法记录保存状态");
            next.output=resolver.openOutputStream(next.uri,"w");if(next.output==null)throw new IllegalStateException("无法写入下载文件夹");
            reply(target,epoch,id,"ready",0,null);timeout(next,target,0);return;
        }
        Transfer current=transfer;
        if(current==null||current.generation!=epoch||!current.id.equals(id))throw new IllegalStateException("保存会话已结束，请重试");
        if(current.state.get()!=WRITING)throw new IllegalStateException("保存已取消");
        if("chunk".equals(type)){
            int sequence=input.getInt("seq");String encoded=input.getString("data");
            if(sequence!=current.sequence||encoded.length()>87384||encoded.length()%4!=0||!encoded.matches("[A-Za-z0-9+/]*={0,2}"))throw new IllegalArgumentException("图片分段顺序或内容无效");
            byte[] bytes=Base64.decode(encoded,Base64.NO_WRAP);
            if(bytes.length==0||bytes.length>CHUNK||bytes.length>current.size-current.written)throw new IllegalArgumentException("图片分段大小无效");
            if(current.written==0&&!imageHeader(bytes,current.mime))throw new IllegalArgumentException("图片格式与内容不一致");
            if(current.written/1048576!=(current.written+bytes.length)/1048576)requireSpace(current.size-current.written);
            current.output.write(bytes);current.written+=bytes.length;current.sequence++;
            reply(target,epoch,id,"ack",sequence,null);timeout(current,target,current.sequence);return;
        }
        if("end".equals(type)){
            if(current.written!=current.size)throw new IllegalStateException("图片尚未保存完整");
            current.output.flush();current.output.close();current.output=null;
            // The CAS is the commit boundary: a cancel/navigation that wins first
            // prevents publication. Once publication wins, the finished download
            // is retained even if the page subsequently leaves.
            if(generation!=epoch||!current.state.compareAndSet(WRITING,PUBLISHING)){cleanup();return;}
            ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.IS_PENDING,0);
            if(resolver.update(current.uri,values,null,null)!=1)throw new IllegalStateException("无法完成下载文件保存");
            current.state.set(COMPLETE);transfer=null;forget(current.uri);reply(target,epoch,id,"complete",current.sequence,current.name);return;
        }
        throw new IllegalArgumentException("未知保存操作");
    }
    private static boolean imageHeader(byte[] bytes,String mime){
        if("image/png".equals(mime))return bytes.length>=8&&(bytes[0]&255)==137&&bytes[1]==80&&bytes[2]==78&&bytes[3]==71&&bytes[4]==13&&bytes[5]==10&&bytes[6]==26&&bytes[7]==10;
        if("image/jpeg".equals(mime))return bytes.length>=3&&(bytes[0]&255)==255&&(bytes[1]&255)==216&&(bytes[2]&255)==255;
        return bytes.length>=12&&bytes[0]==82&&bytes[1]==73&&bytes[2]==70&&bytes[3]==70&&bytes[8]==87&&bytes[9]==69&&bytes[10]==66&&bytes[11]==80;
    }
    private static void requireSpace(long bytes){
        long available=new StatFs(Environment.getExternalStorageDirectory().getAbsolutePath()).getAvailableBytes();
        if(bytes>Math.max(0,available-16L*1024*1024))throw new IllegalStateException("设备可用空间不足，请释放空间后重试");
    }
    private void timeout(Transfer current,WebMessagePort target,int sequence){
        main.post(()->{
            if(watchdog!=null)main.removeCallbacks(watchdog);
            if(generation!=current.generation)return;
            watchdog=()->{if(generation==current.generation)worker.execute(()->{if(transfer==current&&current.sequence==sequence){cleanup();reply(target,current.generation,current.id,"error",-1,"保存等待超时，请重试");}});};
            main.postDelayed(watchdog,30000);
        });
    }
    private void reject(WebMessagePort target,long epoch,String id,String reason){if(busy)return;busy=true;worker.execute(()->{cleanup();reply(target,epoch,id,"error",-1,reason);});}
    private void reply(WebMessagePort target,long epoch,String id,String type,int sequence,String detail){
        reply(target,epoch,id,type,sequence,detail,true);
    }
    private void reply(WebMessagePort target,long epoch,String id,String type,int sequence,String detail,boolean release){
        main.post(()->{if(port!=target||generation!=epoch||!trusted.getAsBoolean())return;try{
            if(release)busy=false;
            if(("complete".equals(type)||"error".equals(type))&&id.equals(requestId))requestId=null;
            JSONObject value=new JSONObject();value.put("id",id);value.put("type",type);value.put("seq",sequence);if(detail!=null)value.put("detail",detail);target.postMessage(new WebMessage(value.toString()));
        }catch(Exception ignored){}});
    }
    private void cleanup(){
        Transfer current=transfer;transfer=null;if(current==null)return;
        try{if(current.output!=null)current.output.close();}catch(Exception ignored){}
        if(current.uri!=null&&current.state.get()!=COMPLETE)removePending(current.uri);
    }
    private boolean remember(Uri uri){Set<String> entries=new HashSet<>(journal.getStringSet("uris",new HashSet<>()));entries.add(uri.toString());return journal.edit().putStringSet("uris",entries).commit();}
    private void forget(Uri uri){Set<String> entries=new HashSet<>(journal.getStringSet("uris",new HashSet<>()));entries.remove(uri.toString());journal.edit().putStringSet("uris",entries).commit();}
    private void removePending(Uri uri){
        try{
            resolver.delete(uri,MediaStore.MediaColumns.IS_PENDING+"=1",null);
            try(Cursor cursor=queryPending(uri,new String[]{MediaStore.MediaColumns.IS_PENDING},null,null)){
                if(cursor==null)return;
                if(!cursor.moveToFirst()||cursor.getInt(0)==0)forget(uri);else remember(uri);
            }
        }catch(Exception ignored){remember(uri);}
    }
    private Cursor queryPending(Uri uri,String[] projection,String selection,String[] arguments){
        if(Build.VERSION.SDK_INT>=30){
            Bundle options=new Bundle();options.putInt(MediaStore.QUERY_ARG_MATCH_PENDING,MediaStore.MATCH_INCLUDE);
            if(selection!=null)options.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,selection);
            if(arguments!=null)options.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,arguments);
            return resolver.query(uri,projection,options,null);
        }
        return resolver.query(MediaStore.setIncludePending(uri),projection,selection,arguments,null);
    }
    private void recover(){
        Set<String> entries=new HashSet<>(journal.getStringSet("uris",new HashSet<>()));
        // Scan provider-owned metadata as well as the journal: this also finds a
        // crash between insert() and the first successful journal commit.
        String selection=MediaStore.MediaColumns.IS_PENDING+"=1 AND "+MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND "+MediaStore.MediaColumns.RELATIVE_PATH+"=? AND "+MediaStore.MediaColumns.DISPLAY_NAME+" LIKE ?";
        try(Cursor cursor=queryPending(MediaStore.Downloads.EXTERNAL_CONTENT_URI,new String[]{MediaStore.MediaColumns._ID},selection,new String[]{packageName,Environment.DIRECTORY_DOWNLOADS+"/ImageStudio/","ImageStudio-%"})){
            if(cursor!=null)while(cursor.moveToNext())entries.add(ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)).toString());
        }catch(Exception ignored){}
        for(String entry:entries){Uri uri=Uri.parse(entry);remember(uri);removePending(uri);}
    }
    void close(){Transfer current=transfer;if(current!=null)current.state.compareAndSet(WRITING,ABORTED);generation++;busy=false;requestId=null;if(watchdog!=null){main.removeCallbacks(watchdog);watchdog=null;}if(port!=null){port.close();port=null;}worker.execute(this::cleanup);}
    void destroy(){close();worker.shutdown();}
}
