// Bokk Yoon - Cloudflare Worker
import { handleApi } from '../public/assets/server.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const MAX_BODY = 1_500_000;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

async function api(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type,x-api-key,authorization',
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS',
      },
    });
  }
  let body = {};
  if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY)
      return json({ error: { code: 'TOO_LARGE', message: 'Requete trop volumineuse.' } }, 413);
    try { body = await request.json(); } catch { body = {}; }
  }
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  const res = await handleApi(
    { method: request.method, path: url.pathname.replace(/^\/api/, ''), query: Object.fromEntries(url.searchParams), body, headers },
    { ...env, MODE: 'cloud', APP_URL: env.APP_URL || url.origin }
  );
  return json(res.body, res.status, url.pathname.startsWith('/api/partner/') ? { 'access-control-allow-origin': '*' } : {});
}

// Force charset=utf-8 sur les reponses HTML et manifest
async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  const ct = res.headers.get('content-type') || '';
  const { pathname } = new URL(request.url);

  // Manifest PWA : forcer application/manifest+json
  if (pathname === '/manifest.webmanifest') {
    const h = new Headers(res.headers);
    h.set('content-type', 'application/manifest+json; charset=utf-8');
    return new Response(res.body, { status: res.status, headers: h });
  }

  // HTML : forcer text/html; charset=utf-8
  if (ct.includes('text/html') && !ct.includes('charset')) {
    const h = new Headers(res.headers);
    h.set('content-type', 'text/html; charset=utf-8');
    return new Response(res.body, { status: res.status, headers: h });
  }

  // CSS/JS : forcer charset=utf-8 aussi
  if ((ct.includes('text/css') || ct.includes('javascript')) && !ct.includes('charset')) {
    const h = new Headers(res.headers);
    h.set('content-type', ct + '; charset=utf-8');
    return new Response(res.body, { status: res.status, headers: h });
  }

  return res;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return api(request, env);
    return serveAsset(request, env);
  },
};
