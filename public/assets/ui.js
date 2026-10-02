// Bokk Yoon — briques d'interface partagées par les trois espaces (client, chauffeur, équipe).
import { api, mode, token, setSpace, resetDemo } from './api.js';
import { CITIES, REGIONS, CATEGORIES, nearestCity } from './core.js';
export { api, mode, token, resetDemo };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'Africa/Dakar';
export const fmtDay = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);
export const fmtDT = (iso) => (iso ? `${fmtDay(iso)} · ${fmtTime(iso)}` : '—');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }) : '—');
export const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
export const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
export const catLabel = (c) => CATEGORIES.find((x) => x.code === c)?.label || c;
export const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
export const go = (hash, render) => { if (location.hash === hash) render?.(); else location.hash = hash; };
export const stars = (avg, n) => (n ? `★ ${String(avg).replace('.', ',')} <span class="muted">(${n})</span>` : '<span class="muted">Nouveau</span>');
export const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
export const cityOptions = (sel, { any = false } = {}) => `<option value="">${any ? 'Toutes' : 'Choisir…'}</option>` +
  REGIONS.map((r) => `<optgroup label="Région de ${esc(r)}">${CITIES.filter((c) => c.region === r).map((c) => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');

export function toast(msg, ms = 2800) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
export function sheet(html, bind) {
  const bd = document.createElement('div'); bd.className = 'sheet-backdrop';
  bd.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bd.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  bd.addEventListener('click', (e) => { if (e.target === bd || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bd);
  bind?.(bd.querySelector('.sheet'), close);
  bd.querySelector('input,select,textarea,button')?.focus();
  return close;
}
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value.trim();
  }
  return o;
}
export const errBox = '<div class="error form-error" role="alert" hidden></div>';
export async function submitting(form, fn) {
  const btn = form.querySelector('[type=submit]'), box = form.querySelector('.form-error');
  if (box) { box.hidden = true; box.textContent = ''; }
  if (btn) { btn.disabled = true; btn.dataset.label ??= btn.textContent; btn.textContent = 'Un instant…'; }
  try { await fn(formData(form)); }
  catch (e) { if (box) { box.textContent = e.message; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); } else toast(e.message); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}
export const on = (root, sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));
export async function act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(e.message, 4000); return false; } }

export const BOOKING = {
  PENDING_PAYMENT: ['À payer', 'b-sun'], PAID: ['Confirmée', 'b-green'], IN_PROGRESS: ['En route', 'b-sky'], COMPLETED: ['Terminée', 'b-green'],
  CANCELLED: ['Annulée', ''], EXPIRED: ['Expirée', ''], DISPUTED: ['Réclamation', 'b-terra'], REFUNDED: ['Remboursée', ''],
};
export const PACKAGE = { CREATED: ['Recherche de trajet', 'b-sun'], BOOKED: ['À payer', 'b-sun'], PAID: ['Confirmé', 'b-green'], PICKED_UP: ['En transport', 'b-sky'], DELIVERED: ['Livré', 'b-green'], CANCELLED: ['Annulé', ''], DISPUTED: ['Réclamation', 'b-terra'] };
export const TRIP = { PUBLISHED: ['Publié', 'b-green'], FULL: ['Complet', 'b-sun'], IN_PROGRESS: ['En route', 'b-sky'], COMPLETED: ['Terminé', ''], CANCELLED: ['Annulé', ''], SUSPENDED: ['Retiré', 'b-terra'] };
export const PAYOUT = { NONE: ['—', ''], DUE: ['À verser', 'b-sun'], PAID: ['Versé', 'b-green'], HELD: ['Bloqué (réclamation)', 'b-terra'], CANCELLED: ['Annulé', ''] };
export const PROVIDERS = { WAVE: 'Wave', ORANGE_MONEY: 'Orange Money', FREE_MONEY: 'Free Money', CARD: 'Carte bancaire', PARTNER: 'Compte partenaire' };
export const badge = (map, s) => `<span class="badge ${map[s]?.[1] || ''}">${esc(map[s]?.[0] || s)}</span>`;

export const routeHtml = (a, b, ta, tb) => `<div class="route"><span class="dot"></span><div><strong>${esc(a)}</strong>${ta ? ` <span class="muted small">${esc(ta)}</span>` : ''}</div>
  <span class="line"></span><span></span><span class="dot end"></span><div><strong>${esc(b)}</strong>${tb ? ` <span class="muted small">${esc(tb)}</span>` : ''}</div></div>`;
export const personHtml = (p, extra = '', href = null) => p ? `<${href ? `a href="${href}"` : 'div'} class="card-link" style="display:flex;align-items:center;gap:12px"><span class="avatar">${esc(initials(p.name))}</span>
  <span style="min-width:0"><strong>${esc(p.name)}</strong> ${p.verified && p.role === 'driver' ? '<span class="badge b-green">Chauffeur vérifié</span>' : ''}<br>
  <span class="small">${stars(p.stats.ratingAvg, p.stats.ratingCount)}${p.role === 'driver' ? ` · ${p.stats.trips} trajet(s)` : ''}${p.vehicle ? ` · ${esc(p.vehicle.label)}` : ''}</span>${extra}</span></${href ? 'a' : 'div'}>` : '';

export function confirmSheet(title, text, fn, cta = 'Confirmer', { danger = true, withReason = false, reasonLabel = 'Motif' } = {}) {
  sheet(`<form novalidate><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>${errBox}
    ${withReason ? `<div class="field"><label for="cs-r">${esc(reasonLabel)}</label><textarea id="cs-r" name="reason" required></textarea></div>` : ''}
    <div class="row"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(cta)}</button><button class="btn btn-ghost" type="button" data-close>Retour</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await fn(d); close(); }); }));
}

// ---------- Routeur ----------
export function createRouter(view, routes, { onRoute } = {}) {
  let cleanups = [];
  const ctx = { cleanup: (f) => cleanups.push(f), render: () => render() };
  async function render() {
    setTimeout(() => { render.retried = false; }, 0);
    cleanups.forEach((f) => { try { f(); } catch { /* ignore */ } }); cleanups = [];
    const raw = location.hash.slice(1) || '/';
    const [path, query] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    const found = routes.find(([re]) => re.test(path));
    onRoute?.(found?.[2] || '');
    view.innerHTML = '<div class="stack"><div class="skeleton"></div><div class="skeleton"></div></div>';
    window.scrollTo(0, 0);
    try {
      if (!found) { view.innerHTML = '<div class="empty"><h2>Page introuvable</h2><a class="btn btn-primary" href="#/">Accueil</a></div>'; return; }
      await found[1]({ ...ctx, params, set: (html) => { view.innerHTML = html; return view; } }, ...path.match(found[0]).slice(1));
    } catch (e) {
      if (e.status === 401 && !render.retried) { render.retried = true; token.clear(); return render(); }
      console.error(e);
      view.innerHTML = `<div class="empty"><h2>Oups</h2><p>${esc(e.message || 'Erreur')}</p><button class="btn btn-primary" id="retry">Réessayer</button></div>`;
      view.querySelector('#retry').onclick = render;
    }
    view.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', render);
  return { render, ctx };
}

// ---------- Connexion OTP (par espace) ----------
const SPACE_TEXT = {
  client: { title: 'Connexion', lead: 'Réservez vos trajets et envoyez vos colis. Un code vous est envoyé par SMS, sans mot de passe.' },
  driver: { title: 'Espace chauffeur', lead: 'Publiez vos trajets, transportez passagers et colis, recevez vos gains sur Wave ou Orange Money.' },
  admin: { title: 'Espace équipe', lead: 'Accès réservé à l\'équipe Bokk Yoon.' },
};
export function loginScreen(set, space, { demoHint = '', onDone }) {
  const t = SPACE_TEXT[space];
  const root = set(`<div class="narrow" style="padding:0">
    <h2>${t.title}</h2><p class="muted">${t.lead}</p>
    <form id="f1" class="card" novalidate>${errBox}
      <div class="field"><label for="phone">Numéro de téléphone</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="77 123 45 67" required></div>
      <div class="field"><label for="email">Adresse e-mail</label><input id="email" name="email" type="email" autocomplete="email" placeholder="votre@email.com" required></div>
      <button class="btn btn-primary btn-block" type="submit">Recevoir le code</button>
      <p class="hint" id="demo-hint" hidden style="margin-top:12px">${demoHint}</p>
    </form><div id="step2"></div></div>`);
  api('GET', '/config').then((c) => { if (c.mode === 'demo' && demoHint) root.querySelector('#demo-hint').hidden = false; }).catch(() => {});
  root.querySelector('#f1').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => {
    const r = await api('POST', '/auth/otp/request', { phone: d.phone, email: d.email, space });
    const s2 = root.querySelector('#step2');
    s2.innerHTML = `<form id="f2" class="card" style="margin-top:12px" novalidate>${errBox}
      
      ${space === 'admin' ? '<div class="field"><label for="pwd">Mot de passe équipe</label><input id="pwd" name="password" type="password" required></div>' : ''}
      <div class="field"><label for="code">Code reçu au ${esc(r.phone)}</label><input id="code" name="code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>
      ${r.isNew && space !== 'driver' ? `<div class="field"><label for="nm">Prénom et nom</label><input id="nm" name="name" autocomplete="name" required maxlength="60" placeholder="Awa Diop"></div>
        <label class="check small"><input type="checkbox" name="cgu"> J'accepte les conditions d'utilisation et la politique de confidentialité.</label>` : ''}
      ${r.isNew && space === 'driver' ? '<p class="small muted">Nouveau chauffeur : après validation du code, vous compléterez votre dossier (pièce, permis, véhicule).</p><label class="check small"><input type="checkbox" name="cgu"> J\'accepte la charte chauffeur et les conditions d\'utilisation.</label>' : ''}
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Valider</button></form>`;
    const f2 = s2.querySelector('#f2'); f2.querySelector('input').focus();
    f2.addEventListener('submit', (ev) => { ev.preventDefault(); submitting(f2, async (d2) => {
      if (r.isNew && space !== 'admin' && !d2.cgu) throw new Error('Veuillez accepter les conditions.');
      if (r.isNew && space !== 'driver' && (d2.name || '').split(/\s+/).length < 2) throw new Error('Indiquez votre prénom et votre nom.');
      const v = await api('POST', '/auth/otp/verify', { phone: r.phone, email: d.email, code: d2.code, space, name: d2.name, password: d2.password });
      token.set(v.token);
      toast('Connecté'); onDone(v);
    }); });
  }); });
}

// ---------- Notifications ----------
export function mountBell(btn, onOpenLink) {
  const refresh = async () => {
    if (!token.get()) { btn.hidden = true; return; }
    try { const me = await api('GET', '/me'); btn.hidden = false; btn.querySelector('.dot').hidden = !me.unread; btn.querySelector('.dot').textContent = me.unread > 9 ? '9+' : me.unread; } catch { btn.hidden = true; }
  };
  btn.addEventListener('click', async () => {
    const r = await api('GET', '/me/notifications');
    sheet(`<div class="row between"><h3 style="margin:0">Notifications</h3><button class="btn btn-ghost btn-sm" data-close>Fermer</button></div>
      <div class="stack" style="margin-top:12px">${r.results.length ? r.results.map((n) => `<a class="card card-link" data-link="${esc(n.link)}" href="${n.link ? esc(n.link) : 'javascript:void 0'}" style="${n.read_at ? '' : 'border-color:var(--primary)'}">
        <div class="row between"><strong>${esc(n.title)}</strong><span class="xs muted">${ago(n.created_at)}</span></div>${n.body ? `<p class="small muted" style="margin:4px 0 0">${esc(n.body)}</p>` : ''}</a>`).join('') : '<p class="muted">Aucune notification.</p>'}</div>`,
    (s, close) => on(s, '[data-link]', 'click', () => { close(); onOpenLink?.(); }));
    await api('POST', '/me/notifications/read'); refresh();
  });
  refresh();
  const t = setInterval(refresh, 30000);
  return { refresh, stop: () => clearInterval(t) };
}

// ---------- Actualités et alertes ----------
const NEWS_CAT = { ANNONCE: 'Annonce', SECURITE: 'Sécurité', CONSEIL: 'Conseil', ROUTE: 'Info route', PROMO: 'Offre' };
export const newsCat = (c) => `<span class="news-cat ${c}">${NEWS_CAT[c] || c}</span>`;
export async function renderNews(el, { audience, limit = 4, hrefBase = '#/actualites/' } = {}) {
  try {
    const r = await api('GET', '/news?' + qs({ audience, limit }));
    el.innerHTML = r.results.length ? r.results.map((n) => `<a class="card card-link news-card" href="${hrefBase}${esc(n.slug)}">${n.image_url ? `<img src="${n.image_url}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:8px">` : ''}${newsCat(n.category)}<strong>${esc(n.title)}</strong><span class="small muted">${esc(n.summary)}</span><span class="xs muted">${fmtDate(n.published_at)}</span></a>`).join('') : '<p class="muted small">Pas d\'actualité pour le moment.</p>';
  } catch { el.innerHTML = ''; }
}
export async function articlePage({ set }, slug, back = '#/') {
  const n = await api('GET', '/news/' + slug);
  set(`<a href="${back}" class="small">← Retour</a><article style="margin-top:10px">${newsCat(n.category)}<h1 style="font-family:'Fraunces',Georgia,serif;font-size:clamp(1.7rem,6vw,2.4rem);margin-top:6px">${esc(n.title)}</h1>
    <p class="muted">${fmtDate(n.published_at)}</p><p class="lead" style="font-size:1.1rem">${esc(n.summary)}</p>
    <div class="article-body">${n.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div></article>`);
}
export async function renderAlerts(el, cities = null) {
  try {
    const r = await api('GET', '/alerts');
    const list = cities ? r.results.filter((a) => a.area === 'National' || cities.some((c) => c === a.area || CITIES.find((x) => x.name === c)?.region === a.area)) : r.results;
    el.innerHTML = list.map((a) => `<div class="alert-strip ${a.level}" role="note"><strong>${esc(a.area)}</strong><span>${esc(a.message)}</span></div>`).join('');
    el.hidden = !list.length;
  } catch { el.hidden = true; }
}

// ---------- Géolocalisation ----------
export function locateMe() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Localisation indisponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, ...nearestCity(p.coords.latitude, p.coords.longitude) }),
      () => reject(new Error('Autorisez la localisation pour trouver votre ville automatiquement.')), { timeout: 8000, maximumAge: 120000 });
  });
}

// ---------- Démarrage d'un espace ----------
export async function bootSpace(space) {
  setSpace(space);
  document.documentElement.dataset.theme = 'light';
  const m = await mode();
  const mb = document.getElementById('mode-badge');
  if (mb && m === 'demo') { mb.hidden = false; mb.className = 'badge b-sun'; mb.textContent = 'Démo'; mb.title = 'Données de démonstration stockées sur cet appareil'; }
  if ('serviceWorker' in navigator && m === 'cloud') navigator.serviceWorker.register('/sw.js').catch(() => {});
  return m;
}
export function toggleTheme() {
  const cur = 'light'; document.documentElement.dataset.theme = 'light';
  const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next;
  try { localStorage.setItem('bokkyoon-theme', next); } catch { /* ignore */ }
}
export function accountBlocked(set, message, space) {
  set(`<div class="empty card"><h2>Accès impossible</h2><p>${esc(message)}</p><p class="small muted">Pour toute question, contactez le support Bokk Yoon.</p>
    <button class="btn btn-ghost" id="lo">Changer de compte</button></div>`).querySelector('#lo').onclick = () => { token.clear(); location.hash = '#/'; location.reload(); };
}

// ---------- Contact, aide, documents ----------
let companyPromise = null;
export const getCompany = () => (companyPromise ??= api('GET', '/company').catch(() => ({ name: 'Bokk Yoon', whatsapp: '', email: '', phone: '', hours: '' })));
export const waLink = (number, text) => `https://wa.me/${String(number || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(text || '')}`;
export const printUrl = (doc, params, space) => `../imprimer/?${new URLSearchParams({ doc, ...params, s: space }).toString()}`;
export const qrSrc = (x) => (x && x.startsWith('assets/') ? '../' + x : x || '');
export const refTag = (r) => (r ? `<span class="ref">${esc(r)}</span>` : '');
export function downloadCsv(filename, csv) {
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Export téléchargé : ' + filename);
  } catch { toast('Téléchargement impossible sur cet appareil.'); }
}
const ICON_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';
export const ICONS = {
  wa: ICON_WA,
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
};
export async function contactButtons(context = '') {
  const c = await getCompany();
  const text = `Bonjour ${c.name || 'Bokk Yoon'}${context ? ', ' + context : ''}.`;
  return `<div class="contact-btns">
    ${c.whatsapp ? `<a class="wa" href="${waLink(c.whatsapp, text)}" target="_blank" rel="noopener">${ICON_WA}WhatsApp</a>` : ''}
    ${c.email ? `<a href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Bokk Yoon · ' + (context || 'Question'))}">${ICONS.mail}E-mail</a>` : ''}
    ${c.phone ? `<a href="tel:${esc(String(c.phone).replace(/\s/g, ''))}">${ICONS.phone}Appeler</a>` : ''}
  </div><p class="xs muted" style="margin:8px 0 0">${esc(c.hours || '')}${c.email ? ' · ' + esc(c.email) : ''}${c.whatsapp ? ' · WhatsApp ' + esc(c.whatsapp) : ''}</p>`;
}
const TICKET_STATUS = { OPEN: ['En attente de réponse', 'b-sun'], ANSWERED: ['Répondu', 'b-green'], CLOSED: ['Clos', ''] };
const TICKET_CAT = { QUESTION: 'Question', RECLAMATION: 'Réclamation', SUGGESTION: 'Suggestion ou avis', PARTENARIAT: 'Partenariat', CHAUFFEUR: 'Devenir chauffeur', AUTRE: 'Autre' };
/** Page « Aide et contact » : boutons WhatsApp / e-mail / appel, formulaire, historique des messages. */
export async function helpPage(ctx, { me, bookingRefs = [] }) {
  const p = ctx.params;
  const [mine, buttons] = await Promise.all([api('GET', '/me/tickets'), contactButtons(me.ref ? `je suis ${me.name} (${me.ref})` : '')]);
  const root = ctx.set(`<h2>Aide et contact</h2><p class="muted small">Écrivez directement au propriétaire de Bokk Yoon : par WhatsApp, par e-mail, ou via le formulaire ci-dessous (réponse dans l'application).</p>
    ${buttons}
    <form class="card" id="cf" style="margin-top:16px" novalidate>${errBox}<h3>Nous écrire</h3>
      <div class="grid grid-2"><div class="field"><label for="cat">Sujet</label><select id="cat" name="category">${Object.entries(TICKET_CAT).map(([k, l]) => `<option value="${k}" ${k === (p.cat || 'QUESTION') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="br">Réservation concernée</label><select id="br" name="bookingRef"><option value="">Aucune</option>${bookingRefs.map((r) => `<option ${r === p.ref ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div></div>
      <div class="field"><label for="sj">Objet</label><input id="sj" name="subject" maxlength="140" required value="${esc(p.subject || '')}"></div>
      <div class="field"><label for="ms">Message</label><textarea id="ms" name="message" rows="5" required minlength="10"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Envoyer au propriétaire</button></form>
    <h3 style="margin-top:22px">Mes messages</h3>
    <div class="stack">${mine.results.length ? mine.results.map((t) => `<a class="card card-link" href="#/aide/${t.id}"><div class="row between"><strong>${esc(t.subject)}</strong>${badge(TICKET_STATUS, t.status)}</div><div class="small muted">${refTag(t.ref)} · ${TICKET_CAT[t.category]} · ${ago(t.updated_at)}</div></a>`).join('') : '<p class="muted small">Aucun message envoyé.</p>'}</div>`);
  root.querySelector('#cf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { const r = await api('POST', '/contact', d); toast(`Message ${r.ref} envoyé`); location.hash = '#/aide/' + r.id; }); });
}
export async function ticketPage(ctx, id) {
  const t = await api('GET', '/me/tickets/' + id);
  const c = await getCompany();
  const root = ctx.set(`<a href="#/aide" class="small">← Aide et contact</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${esc(t.subject)}</h2>${badge(TICKET_STATUS, t.status)}</div>
    <p class="small muted">${refTag(t.ref)} · ${TICKET_CAT[t.category]}${t.booking_ref ? ' · réservation ' + esc(t.booking_ref) : ''}</p>
    <div class="card"><div class="chat" style="max-height:none">${t.messages.map((m) => `<div class="msg ${m.from_team ? '' : 'mine'}"><span class="xs" style="opacity:.75">${m.from_team ? esc(c.name || 'Bokk Yoon') : 'Vous'} · ${fmtDT(m.created_at)}</span><br>${esc(m.body).replace(/\n/g, '<br>')}</div>`).join('')}</div>
      ${t.status !== 'CLOSED' ? `<form id="rf" class="row" style="margin-top:12px;flex-wrap:nowrap"><input name="body" placeholder="Répondre…" aria-label="Réponse" autocomplete="off"><button class="btn btn-primary btn-sm" type="submit">Envoyer</button></form>` : '<p class="small muted">Conversation close.</p>'}</div>
    ${c.whatsapp ? `<a class="btn btn-ghost btn-block" style="margin-top:12px" target="_blank" rel="noopener" href="${waLink(c.whatsapp, `Bonjour, au sujet de mon message ${t.ref} : `)}">Continuer sur WhatsApp</a>` : ''}`);
  root.querySelector('#rf')?.addEventListener('submit', async (e) => { e.preventDefault(); const i = e.target.body; if (!i.value.trim()) return; try { await api('POST', `/me/tickets/${id}/messages`, { body: i.value }); ctx.render(); } catch (er) { toast(er.message); } });
}

/** Suppression du compte par le membre lui-même (client ou chauffeur). */
export async function deleteAccountSheet(onDone) {
  let bl = [];
  try { bl = (await api('GET', '/me/delete')).blockers; } catch { /* hors ligne */ }
  sheet(`<form novalidate>${errBox}<h3>Supprimer mon compte</h3>
    ${bl.length ? `<div class="error small">Suppression impossible pour le moment :<ul style="margin:6px 0 0;padding-left:18px">${bl.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <p class="small muted" style="margin-top:10px">Terminez ou annulez ces opérations, ou écrivez-nous depuis « Aide et contact ».</p>
      <button class="btn btn-ghost btn-block" type="button" data-close>Fermer</button>` : `
    <p class="small">Votre nom, votre numéro et vos informations personnelles seront effacés et vous serez déconnecté. Votre numéro pourra ensuite servir à créer un nouveau compte.</p>
    <p class="small muted">Les factures et l'historique des paiements sont conservés de façon anonyme, comme l'exige la comptabilité. Cette action est définitive.</p>
    <div class="field"><label for="dr">Pourquoi partez-vous ? (facultatif)</label><input id="dr" name="reason" maxlength="300"></div>
    <div class="field"><label for="dc">Tapez <strong>SUPPRIMER</strong> pour confirmer</label><input id="dc" name="confirm" autocomplete="off" required></div>
    <div class="row"><button class="btn btn-danger" type="submit">Supprimer définitivement</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div>`}</form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => {
    await api('POST', '/me/delete', d); token.clear(); close(); toast('Votre compte a été supprimé'); onDone?.();
  }); }));
}
