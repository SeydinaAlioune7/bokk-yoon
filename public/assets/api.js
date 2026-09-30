// Client API : utilise l'API Cloudflare si elle répond, sinon bascule en mode démo
// (même code serveur exécuté dans le navigateur sur SQLite WebAssembly, données gardées sur l'appareil).

let SPACE = 'client';
export const setSpace = (s) => { SPACE = s; };
const DB_KEY = 'bokkyoon-demo-db-v4';
const base = new URL('./', import.meta.url);
let modePromise = null;
let local = null;

const safe = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};
export const token = { get: () => safe.get('bokkyoon-token-' + SPACE), set: (t) => safe.set('bokkyoon-token-' + SPACE, t), clear: () => safe.del('bokkyoon-token-' + SPACE) };

export function mode() {
  modePromise ??= (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(new URL('../api/health', base), { signal: ctrl.signal });
      clearTimeout(timer);
      const j = await res.json();
      if (res.ok && j.ok && j.mode === 'cloud') return 'cloud';
    } catch { /* pas d'API : mode démo */ }
    return 'demo';
  })();
  return modePromise;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Chargement impossible : ' + src));
    document.head.appendChild(s);
  });
}
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

async function initLocal() {
  if (local) return local;
  local = (async () => {
    if (!window.initSqlJs) await loadScript(new URL('vendor/sql-wasm.js', base).href);
    const SQL = await window.initSqlJs({ locateFile: (f) => new URL('vendor/' + f, base).href });
    const [{ handleApi, seed }, { d1Adapter }] = await Promise.all([import('./server.js'), import('./localdb.js')]);
    const schema = await (await fetch(new URL('schema.sql', base))).text();
    const saved = safe.get(DB_KEY);
    let db;
    try { db = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database(); } catch { db = new SQL.Database(); }
    db.exec(schema);
    let timer = null;
    const persist = () => { clearTimeout(timer); timer = setTimeout(() => safe.set(DB_KEY, toB64(db.export())), 250); };
    const env = { DB: d1Adapter(db, persist), MODE: 'demo', DEMO_OTP: 'true', ADMIN_PHONES: '+221770000000', APP_URL: location.origin };
    if (!saved) { await seed(env); persist(); }
    return { handleApi, env };
  })();
  return local;
}

export async function resetDemo() {
  safe.del(DB_KEY); ['client', 'driver', 'admin'].forEach((k) => safe.del('bokkyoon-token-' + k)); location.reload();
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function api(method, path, body, extraHeaders = {}) {
  const m = await mode();
  const t = token.get();
  const headers = { ...(t ? { authorization: 'Bearer ' + t } : {}), ...extraHeaders };
  let status, data;
  if (m === 'cloud') {
    let res;
    try {
      res = await fetch(new URL('../api' + path, base), {
        method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Connexion impossible. Vérifiez votre réseau et réessayez.');
    }
    status = res.status;
    data = await res.json().catch(() => ({}));
  } else {
    const { handleApi, env } = await initLocal();
    const [p, qs] = path.split('?');
    const res = await handleApi({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body: body || {}, headers }, env);
    status = res.status; data = JSON.parse(JSON.stringify(res.body));
  }
  if (status === 401 && data?.error?.code === 'AUTH_REQUIRED') token.clear();
  if (status === 403 && data?.error?.code === 'WRONG_SPACE' && !path.startsWith('/auth')) token.clear();
  if (status >= 400) throw new ApiError(status, data?.error?.code || 'ERROR', data?.error?.message || 'Erreur inattendue.');
  return data;
}
