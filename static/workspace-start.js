"use strict";
/* This hint only chooses the public waiting message. The server authorizes every launch. */
globalThis.StudioStartup = (() => {
  const version = document.querySelector('meta[name="studio-shell-version"]').content;
  const key = 'studio-session-hint-v1';
  let returning = false;
  try { returning = Number(localStorage.getItem(key)) > Date.now(); } catch {}
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let pending = fetch('/api/workspace/bootstrap', {
    cache: 'no-store', credentials: 'same-origin', signal: controller.signal
  }).then(async response => {
    if (response.status === 404) return {legacy: true};
    if (!response.ok) throw new Error('暂时无法验证登录，请重试');
    return {value: await response.json()};
  }).catch(() => ({error: '暂时无法验证登录，请重试'}))
    .finally(() => clearTimeout(timeout));
  function take() { const request = pending; pending = null; return request; }
  function cancel() { controller.abort(); pending = null; }
  function remember(authenticated) {
    try {
      if (authenticated) localStorage.setItem(key, String(Date.now() + 7 * 86400000));
      else localStorage.removeItem(key);
    } catch {}
  }
  return {version, returning, take, cancel, remember};
})();
