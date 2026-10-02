

window.kiosqueImages = [];
window.showGallery = function(idx) {
  if (document.getElementById('k-lightbox')) document.getElementById('k-lightbox').remove();
  if (!window.kiosqueImages || !window.kiosqueImages.length) return;
  idx = (idx + window.kiosqueImages.length) % window.kiosqueImages.length;
  const src = window.kiosqueImages[idx].image_data;
  const d = document.createElement('div');
  d.id = 'k-lightbox';
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;align-items:center;justify-content:center;';
  
  const closeBtn = '<button style="position:absolute;top:20px;right:20px;background:none;border:none;color:#fff;font-size:40px;cursor:pointer;line-height:1;z-index:10000" onclick="document.getElementById(\'k-lightbox\').remove()">&times;</button>';
  
  let navBtns = '';
  if (window.kiosqueImages.length > 1) {
    navBtns += '<button style="position:absolute;left:20px;background:rgba(0,0,0,0.5);border-radius:50%;border:none;color:#fff;font-size:30px;width:50px;height:50px;cursor:pointer;z-index:10000;display:flex;align-items:center;justify-content:center" onclick="event.stopPropagation(); showGallery(' + (idx - 1) + ')">&#10094;</button>';
    navBtns += '<button style="position:absolute;right:20px;background:rgba(0,0,0,0.5);border-radius:50%;border:none;color:#fff;font-size:30px;width:50px;height:50px;cursor:pointer;z-index:10000;display:flex;align-items:center;justify-content:center" onclick="event.stopPropagation(); showGallery(' + (idx + 1) + ')">&#10095;</button>';
  }
  
  d.innerHTML = closeBtn + navBtns + '<img src="' + esc(src) + '" style="max-width:80vw;max-height:90vh;object-fit:contain;border-radius:8px" onclick="event.stopPropagation()">';
  d.onclick = () => d.remove();
  document.body.appendChild(d);
};

﻿import { cityByName, quote, DEFAULT_SETTINGS, CITIES, REGIONS, fcfa } from './core.js';
import { api } from './api.js';
import { createMap, REGION_COLORS } from './map.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
document.getElementById('yr').textContent = new Date().getFullYear();

// Axes de lancement : prix fixes Bokk Yoon (grille du propriétaire si l'API répond, sinon formule par défaut)
const icon = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M10 90 C 40 60, 70 80, 60 40 S 80 10, 95 5" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/></svg>';
const card = (a, b, q) => { const h = Math.floor(q.durationMin / 60), m = q.durationMin % 60;
  return `<article class="corridor">${icon}<div><p class="xs" style="margin:0;opacity:.85;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Aller et retour</p><h3>${a} ↔ ${b}</h3></div>
  <div class="cmeta"><span><b>${q.distanceKm} km</b>distance</span><span><b>${h ? h + ' h ' : ''}${String(m).padStart(2, '0')}</b>environ</span><span><b>${fcfa(q.seat)}</b>la place</span><span><b>${fcfa(q.parcel)}</b>le colis</span></div></article>`; };

// Couverture nationale
(async () => {
  const regions = document.getElementById('regions');
  regions.innerHTML = REGIONS.map((r) => `<span data-r="${esc(r)}"><i style="background:${REGION_COLORS[r]}"></i>${esc(r)}</span>`).join('');
  let cov = null;
  try { cov = await api('GET', '/coverage'); } catch { /* hors ligne */ }
  if (cov) {
    document.getElementById('nat-trips').textContent = cov.tripsOpen;
    document.getElementById('nat-axes').textContent = cov.corridors.length;
    for (const r of cov.regions) if (r.cities.some((c) => c.served)) regions.querySelector(`[data-r="${CSS.escape(r.name)}"]`)?.classList.add('on');
  }
  const m = await createMap(document.getElementById('natmap'), { height: 480, cities: 'all', switcher: true });
  if (m && cov) for (const c of cov.corridors) { const a = cityByName(c.origin), b = cityByName(c.dest); if (a && b) m.route(a, b, { weight: 2 + Math.min(4, c.n), dashed: false }); }
})();

// Actualités et alertes
(async () => {
    const kgrid = document.getElementById('kiosque-grid');
  try {
    const p = await api('GET', '/press?limit=6');
    if (p.results && p.results.length) {
      window.kiosqueImages = p.results;
      document.getElementById('kiosque').style.display = 'block';
      kgrid.innerHTML = p.results.map((r, i) => `<div class="card card-link" style="padding:0;overflow:hidden;background:#fff;border:1px solid rgba(0,0,0,0.1);" onclick="showGallery(`+i+`)"><img src="`+esc(r.image_data)+`" style="width:100%;height:250px;object-fit:cover;border-bottom:1px solid rgba(0,0,0,0.1);"><div style="padding:12px;text-align:center"><strong style="color:#000;font-size:14px">`+esc(r.name)+`</strong><div class="xs muted">`+esc(r.publish_date)+`</div></div></div>`).join('');
    }
  } catch (e) { /* no press */ }
  const list = document.getElementById('news-list');
  try {
    const r = await api('GET', '/news?limit=3');
    const CAT = { ANNONCE: 'Annonce', SECURITE: 'Sécurité', CONSEIL: 'Conseil', ROUTE: 'Info route', PROMO: 'Offre' };
    list.innerHTML = r.results.map((n) => `<a class="card card-link news-card" href="app/#/actualites/${esc(n.slug)}"><span class="news-cat ${n.category}">${CAT[n.category]}</span><strong style="font-size:1.1rem">${esc(n.title)}</strong><span class="small muted">${esc(n.summary)}</span><span class="xs muted">${new Date(n.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</span></a>`).join('');
    const al = await api('GET', '/alerts'), ab = document.getElementById('alerts');
    ab.innerHTML = al.results.map((a) => `<div class="alert-strip ${a.level}"><strong>${esc(a.area)}</strong><span>${esc(a.message)}</span></div>`).join(''); ab.hidden = !al.results.length;
  } catch { list.innerHTML = ''; }
})();

// Onglets « comment ça marche »
document.querySelectorAll('[data-how]').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-how]').forEach((b) => { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', b === btn); });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== btn.dataset.how; });
}));

// Liste d'attente
const form = document.getElementById('wl');
form.city.innerHTML = CITIES.map((c) => `<option>${c.name}</option>`).join('');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = form.querySelector('.form-error'); err.hidden = true;
  const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Envoi…';
  const role = form.role.value;
  try {
    const r = await api('POST', '/waitlist', { name: form.name.value, phone: form.phone.value, role: form.role.value, city: form.city.value });
    form.innerHTML = `<div style="text-align:center;padding:20px 8px"><div style="font-size:2.4rem">🎉</div><h3>${r.already ? 'Vous êtes déjà inscrit' : 'Jërëjëf, c\'est noté !'}</h3>
      <p class="muted">Nous vous appelons avant l'ouverture. En attendant, découvrez l'application.</p><a class="btn btn-primary" href="${role === 'conducteur' ? 'chauffeur/' : 'app/'}">Ouvrir l'application</a></div>`;
  } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Je m\'inscris'; }
});

// Léger mouvement à l'apparition (les éléments restent visibles sans script)
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .12 }) : null;
document.querySelectorAll('.service, .steps li, .trust, .code-card, .join-card, .faq details, .space-card').forEach((el) => { if (io) { el.classList.add('reveal'); io.observe(el); } });

// Calculatrice de prix
const PICON = {
  COLIS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  PASSEPORT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 16h6"/></svg>',
  ENVELOPPE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  CLES: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>',
  SEAT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14l-1.5-6a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg>',
};
(async () => {
  const f = document.getElementById('lcalc'); if (!f) return;
  const opts = (sel) => REGIONS.map((r) => `<optgroup label="${esc(r)}">${CITIES.filter((c) => c.region === r).map((c) => `<option ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
  f.from.innerHTML = opts('Dakar'); f.to.innerHTML = opts('Saint-Louis');
  let types = [{ code: 'COLIS', label: 'Colis', mode: 'WEIGHT', description: 'Au poids, jusqu\'à 30 kg' }];
  try { types = (await api('GET', '/parcel-types')).results; } catch { /* hors ligne */ }
  f.what.innerHTML = '<option value="SEAT">Voyager (place en voiture)</option>' + types.map((t) => `<option value="${esc(t.code)}">Envoyer : ${esc(t.label)}${t.mode === 'FLAT' ? ' (forfait)' : ' (au poids)'}</option>`).join('');
  const pt = document.getElementById('ptypes');
  const cards = [{ code: 'SEAT', label: 'Place en voiture', description: 'Par passager' }, ...types];
  pt.innerHTML = cards.map((t) => `<button type="button" class="ptype" data-c="${esc(t.code)}"><span class="pi">${PICON[t.code] || PICON.ENVELOPPE}</span><strong>${esc(t.label)}</strong><span>${esc(t.description || (t.mode === 'FLAT' ? 'Forfait sans pesée' : ''))}</span><b data-p></b></button>`).join('');
  pt.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; f.what.value = b.dataset.c; run(); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  const $ = (id) => document.getElementById(id);
  async function run() {
    const what = f.what.value, a = f.from.value, b = f.to.value, isSeat = what === 'SEAT', t = types.find((x) => x.code === what);
    $('lc-seats-f').hidden = !isSeat; $('lc-kg-f').hidden = isSeat || t?.mode === 'FLAT';
    $('lc-seats-v').textContent = f.seats.value; $('lc-kg-v').textContent = String(f.kg.value).replace('.', ',');
    pt.querySelectorAll('.ptype').forEach((x) => x.classList.toggle('on', x.dataset.c === what));
    if (a === b) { $('lc-price').textContent = '—'; $('lc-meta').textContent = 'Choisissez deux villes différentes'; $('lc-sub').textContent = ''; return; }
    try {
      const q = await api('GET', `/quote?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&seats=${f.seats.value}&weightKg=${f.kg.value}&type=${isSeat ? 'COLIS' : what}`);
      $('lc-meta').textContent = `${q.from} → ${q.to} · ${q.distanceKm} km · ~${Math.floor(q.durationMin / 60)} h ${String(q.durationMin % 60).padStart(2, '0')}`;
      $('lc-price').textContent = fcfa(isSeat ? q.seatsTotal : q.parcel);
      $('lc-sub').textContent = isSeat ? `${q.seats} place(s) × ${fcfa(q.seat)}` : q.type.mode === 'FLAT' ? `${q.type.label} · forfait, sans pesée` : `Colis de ${String(q.weightKg).replace('.', ',')} kg`;
      $('lc-go').href = isSeat ? `app/#/recherche?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&seats=${f.seats.value}&run=1` : `app/#/colis/nouveau?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&type=${what}`;
      $('lc-go').textContent = isSeat ? 'Voir les trajets à ce prix' : 'Envoyer à ce prix';
      const all = await Promise.all(cards.map((c) => (c.code === 'SEAT' ? Promise.resolve(q.seat) : api('GET', `/quote?from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}&weightKg=5&type=${c.code}`).then((r) => r.parcel))));
      pt.querySelectorAll('[data-p]').forEach((el, i) => { el.textContent = (cards[i].mode === 'WEIGHT' ? '5 kg : ' : '') + fcfa(all[i]); });
    } catch { $('lc-meta').textContent = 'Calcul indisponible hors ligne'; }
  }
  f.addEventListener('input', run); f.addEventListener('change', run); run();
})();

// Contact : boutons WhatsApp / e-mail / téléphone + formulaire
const WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm4.5 12.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';
(async () => {
  let c = { name: 'Bokk Yoon' };
  try { c = await api('GET', '/company'); } catch { /* hors ligne */ }
  const wa = (t) => `https://wa.me/${String(c.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(t)}`;
  const box = document.getElementById('lc-contact');
    `<p class="small" style="margin-top:12px;opacity:.9">${esc(c.hours || '')}${c.email ? ' · ' + esc(c.email) : ''}${c.address ? '<br>' + esc(c.address) : ''}</p>`;
  if (c.whatsapp) { const a = document.createElement('a'); a.className = 'wa-float'; a.style.bottom = '20px'; a.href = wa('Bonjour Bokk Yoon, '); a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Écrire sur WhatsApp'); a.innerHTML = WA; document.body.appendChild(a); }
  const cf = document.getElementById('cform');
  cf.addEventListener('submit', async (e) => {
    e.preventDefault(); const err = cf.querySelector('.form-error'); err.hidden = true;
    const btn = cf.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Envoi…';
    const d = Object.fromEntries(new FormData(cf));
    try {
      const r = await api('POST', '/contact', d);
      cf.innerHTML = `<div style="text-align:center;padding:24px 8px"><h3>Message ${esc(r.ref)} bien reçu</h3><p class="muted">Nous vous répondons au plus vite${d.phone ? ' par WhatsApp ou SMS' : ' par e-mail'}. Gardez cette référence.</p>${c.whatsapp ? `<a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(`Bonjour, je vous ai écrit (réf. ${r.ref}). `)}">Continuer sur WhatsApp</a>` : ''}</div>`;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Envoyer le message'; }
  });
})();
