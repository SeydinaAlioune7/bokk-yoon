// Bokk Yoon - Cloudflare Worker : sert le site (dossier public/) et l'API /api/* (base D1).
import { handleApi } from '../public/assets/server.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const MAX_BODY = 1_500_000;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

async function api(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-api-key,authorization', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS' } });
  }
  let body = {};
  if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return json({ error: { code: 'TOO_LARGE', message: 'Requete trop volumineuse.' } }, 413);
    try { body = await request.json(); } catch { body = {}; }
  }
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  const res = await handleApi({ method: request.method, path: url.pathname.replace(/^\/api/, ''), query: Object.fromEntries(url.searchParams), body, headers },
    { ...env, MODE: 'cloud', APP_URL: env.APP_URL || url.origin });
  return json(res.body, res.status, url.pathname.startsWith('/api/partner/') ? { 'access-control-allow-origin': '*' } : {});
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return api(request, env);
    if (pathname === '/manifest.webmanifest') {
      const res = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(res.headers);
      newHeaders.set('content-type', 'application/manifest+json; charset=utf-8');
      return new Response(res.body, { status: res.status, headers: newHeaders });
    }
    return env.ASSETS.fetch(request);
  },
};
