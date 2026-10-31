// Offline support for the caretaker app (and the website).
//  * Reads: answers to a few GET requests are saved on the phone and shown when there is no signal.
//  * Writes: payments, maintenance requests and updates, meter readings and utility payments that
//    fail for lack of signal are saved in a queue and uploaded later, in order. Each carries a unique
//    id (X-Client-Op-Id) so the server never records the same one twice, even if the first try did arrive.
const QKEY = 'rf_queue';
const CPREFIX = 'rf_cache:';
const MAX_CACHE_CHARS = 1500000;

const CACHEABLE = ['/auth/me', '/auth/my-plot-permissions', '/plots', '/houses', '/tenants', '/maintenance', '/payments', '/meters', '/vendors', '/utilities', '/expenses'];
const QUEUEABLE = [
  { method: 'post',  re: /^\/payments$/,            label: 'Payment' },
  { method: 'post',  re: /^\/maintenance$/,         label: 'Maintenance request' },
  { method: 'patch', re: /^\/maintenance\/\d+$/,    label: 'Maintenance update' },
  { method: 'post',  re: /^\/meters\/readings$/,    label: 'Meter readings' },
  { method: 'post',  re: /^\/utilities$/,           label: 'Utility payment' },
];

let API = null;
let netDown = typeof navigator !== 'undefined' && navigator.onLine === false;
let syncing = false;
let snapshot = null;
const listeners = new Set();

const path = (url) => String(url || '').split('?')[0];
const userId = () => {
  try { return JSON.parse(atob(localStorage.getItem('token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).id || 0; } catch { return 0; }
};
const newId = () => {
  try { if (window.crypto?.randomUUID) return window.crypto.randomUUID(); } catch { /* fall through */ }
  return `op-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 12)}-${Math.random().toString(16).slice(2, 10)}`;
};
const readQ = () => { try { const q = JSON.parse(localStorage.getItem(QKEY) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; } };
const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch { /* storage full: nothing more we can do */ } notify(); };

function notify() { snapshot = null; listeners.forEach(f => { try { f(); } catch { /* ignore */ } }); }

export function getState() {
  if (snapshot) return snapshot;
  const me = userId();
  const mine = readQ().filter(o => o.user_id === me);
  snapshot = { offline: netDown, pending: mine.filter(o => !o.failed), failed: mine.filter(o => o.failed), syncing };
  return snapshot;
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const cacheKey = (config) => `${CACHEPREFIX_USER()}${API.getUri(config)}`;
const CACHEPREFIX_USER = () => `${CPREFIX}${userId()}:`;
const cacheable = (config) => (config.method || 'get').toLowerCase() === 'get' && CACHEABLE.some(p => path(config.url) === p || path(config.url).startsWith(p + '/'));
const queueable = (config) => {
  const m = (config.method || '').toLowerCase();
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) return null;
  return QUEUEABLE.find(q => q.method === m && q.re.test(path(config.url))) || null;
};

export function clearCache() {
  try { Object.keys(localStorage).filter(k => k.startsWith(CPREFIX)).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
}

// Called for every request: give queueable writes an id so a retry can be recognised.
export function prepare(config) {
  if (queueable(config) && !config.headers['X-Client-Op-Id']) config.headers['X-Client-Op-Id'] = newId();
  return config;
}

export function onSuccess(res) {
  if (netDown) { netDown = false; notify(); }
  try {
    if (cacheable(res.config)) {
      const s = JSON.stringify({ t: Date.now(), data: res.data });
      if (s.length < MAX_CACHE_CHARS) localStorage.setItem(cacheKey(res.config), s);
    }
  } catch { /* storage full: skip caching */ }
  if (readQ().length) setTimeout(() => syncNow(), 1500);
  return res;
}

function readCache(config) {
  try { const s = localStorage.getItem(cacheKey(config)); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function onError(err) {
  const config = err.config;
  if (err.response || !config || err.code === 'ERR_CANCELED') return Promise.reject(err);
  // No answer from the server at all: offline, or the signal is too weak.
  if (!netDown) { netDown = true; notify(); }
  if (cacheable(config)) {
    const c = readCache(config);
    if (c) return Promise.resolve({ data: c.data, status: 200, statusText: 'Saved copy', headers: {}, config, fromCache: true, cachedAt: c.t });
  }
  const q = !config.__noQueue && queueable(config);
  if (q) {
    let data = config.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch { /* keep as is */ }
    const ops = readQ();
    const id = config.headers['X-Client-Op-Id'] || newId();
    if (!ops.some(o => o.id === id)) {
      ops.push({ id, user_id: userId(), method: config.method.toLowerCase(), url: path(config.url) + (String(config.url).includes('?') ? '?' + String(config.url).split('?')[1] : ''), data, label: q.label, queued_at: new Date().toISOString(), attempts: 0 });
      writeQ(ops);
    }
    return Promise.resolve({ data: { success: true, queued: true, message: 'Saved on this phone. It will upload when you are back online.', data: {} }, status: 202, statusText: 'Queued', headers: {}, config });
  }
  return Promise.reject(err);
}

export async function syncNow() {
  if (!API || syncing) return;
  const me = userId(); if (!me) return;
  if (!readQ().some(o => o.user_id === me && !o.failed)) return;
  syncing = true; notify();
  try {
    for (;;) {
      const op = readQ().find(o => o.user_id === me && !o.failed);
      if (!op) break;
      try {
        await API.request({ method: op.method, url: op.url, data: op.data, headers: { 'X-Client-Op-Id': op.id }, __noQueue: true });
        writeQ(readQ().filter(o => o.id !== op.id));
      } catch (e) {
        const st = e.response?.status;
        if (!e.response) { netDown = true; break; }                       // still offline
        if (st === 401 || st === 429 || st >= 500 || e.response.data?.in_progress) {   // try again later
          writeQ(readQ().map(o => o.id === op.id ? { ...o, attempts: (o.attempts || 0) + 1 } : o)); break;
        }
        // The server refused it (for example the tenant was removed): keep it for the user to review.
        writeQ(readQ().map(o => o.id === op.id ? { ...o, failed: true, error: e.response.data?.error || `Rejected (${st})` } : o));
      }
    }
  } finally { syncing = false; notify(); }
}

export function discard(id) { writeQ(readQ().filter(o => o.id !== id)); }
export function retry(id) { writeQ(readQ().map(o => o.id === id ? { ...o, failed: false, error: undefined } : o)); syncNow(); }

export function attach(api) {
  API = api;
  if (typeof window === 'undefined' || window.__rfOfflineAttached) return;
  window.__rfOfflineAttached = true;
  window.addEventListener('online', () => { netDown = false; notify(); syncNow(); });
  window.addEventListener('offline', () => { netDown = true; notify(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(syncNow, 30000);
  setTimeout(syncNow, 3000);
}
