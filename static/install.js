"use strict";
let installPrompt = null;
const nativeApp = /ImageStudioAndroid\//.test(navigator.userAgent);
const standaloneApp = () => nativeApp || matchMedia("(display-mode: standalone)").matches || navigator.standalone;
document.documentElement.classList.toggle("standalone-app", Boolean(standaloneApp()));
document.documentElement.classList.toggle("native-app", nativeApp);
if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", {scope:"/",updateViaCache:"none"}).catch(() => {});
window.addEventListener("beforeinstallprompt", event => {event.preventDefault();installPrompt=event;});
window.addEventListener("appinstalled", () => {installPrompt=null;document.documentElement.classList.add("standalone-app");toast("已安装到主屏幕");});
window.addEventListener("offline", () => {document.body.classList.add("offline");toast("当前离线，已提交任务仍在服务器运行");});
window.addEventListener("online", () => {document.body.classList.remove("offline");toast("已恢复连接");poll();});
async function installStudio(){
  if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}
  modal("安装 Image Studio", `<div class="install-guide"><img src="/static/icons/icon-192.png" width="64" height="64" alt="Image Studio"><p>${standaloneApp()?"你正在使用独立应用。":"在浏览器菜单中选择「安装应用」或「添加到主屏幕」。iPhone 请使用 Safari 的分享菜单，选择「添加到主屏幕」。"}</p><a class="btn primary" href="/downloads/image-studio.apk">${icon("download")}下载 Android 安装包</a><p class="muted small">任务与图库使用同一个服务器账户。首次打开 Android 应用需要登录工作台。</p></div>`);
}
// The visual viewport follows the iOS keyboard; Android resizes the WebView itself.
function updateKeyboard(){
  const viewport=window.visualViewport;
  const editing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||"");
  const offset=viewport?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;
  const open=editing && (offset>120 || innerHeight<window.studioRestHeight-120);
  document.body.classList.toggle("keyboard-open",open);
  document.documentElement.style.setProperty("--keyboard-offset",open?`${offset}px`:"0px");
  if(!editing)window.studioRestHeight=innerHeight;
}
window.studioRestHeight=innerHeight;
window.visualViewport?.addEventListener("resize",updateKeyboard);
window.visualViewport?.addEventListener("scroll",updateKeyboard);
window.addEventListener("resize",updateKeyboard);
document.addEventListener("focusin",updateKeyboard);
document.addEventListener("focusout",()=>requestAnimationFrame(updateKeyboard));
document.body.classList.toggle("offline",!navigator.onLine);
