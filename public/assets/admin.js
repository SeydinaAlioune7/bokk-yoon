// Bokk Yoon — espace équipe (propriétaire = super-admin, membres de l'équipe = admin).
import {
  fmtDur, api, token, esc, fmtDay, fmtTime, fmtDT, fmtDate, ago, qs, stars, fcfa, cityOptions, initials,
  toast, sheet, errBox, submitting, on, act, BOOKING, TRIP, PAYOUT, PROVIDERS, badge, confirmSheet,
  createRouter, loginScreen, bootSpace, toggleTheme, newsCat, printUrl, refTag, downloadCsv, waLink, ICONS, formData, qrSrc,
} from './ui.js';
import { REGIONS, cityByName } from './core.js';
import { createMap, REGION_COLORS } from './map.js';
import { renderInvoice, PRINT_CSS } from './invoice.js';

const view = document.getElementById('view');
let me = null;
const go = (h) => { if (location.hash === h) router.render(); else location.hash = h; };
const isSuper = () => me?.role === 'superadmin';
const STATUS = { active: ['Actif', 'b-green'], suspended: ['Suspendu', 'b-sun'], blocked: ['Bloqué', 'b-terra'] };
const DRV = { PENDING: ['Candidature', 'b-sky'], APPROVED: ['Validé', 'b-green'], REJECTED: ['Refusé', 'b-terra'] };
const INC = { COMPORTEMENT: 'Comportement', RETARD: 'Retard', CONDUITE: 'Conduite dangereuse', PAIEMENT_HORS_APP: 'Paiement hors appli', FRAUDE: 'Fraude', ANNULATION: 'Annulation chauffeur', AUTRE: 'Autre' };
const DISP = { LOST: 'Colis perdu', DAMAGED: 'Colis endommagé', NOT_DELIVERED: 'Non livré', NO_SHOW: 'Absence', PAYMENT: 'Paiement', OTHER: 'Autre' };

const NAV = [
  [null, null, 'Pilotage'], ['dash', '#/', 'Tableau de bord'], ['live', '#/direct', 'Carte en direct'], ['map', '#/territoire', 'Carte du Sénégal'],
  [null, null, 'Opérations'], ['bookings', '#/reservations', 'Réservations'], ['trips', '#/trajets', 'Trajets'], ['issues', '#/litiges', 'Litiges et signalements'], ['msg', '#/messages', 'Messages reçus'],
  [null, null, 'Membres'], ['drivers', '#/chauffeurs', 'Chauffeurs'], ['clients', '#/clients', 'Clients'], ['fb', '#/retours', 'Retours clients'],
  [null, null, 'Finances'], ['cash', '#/encaissements', 'Encaissements Wave / OM'], ['payouts', '#/paiements', 'Paiements chauffeurs'], ['inv', '#/factures', 'Factures'], ['pricing', '#/tarifs', 'Tarifs et types d\'envoi'], ['promo', '#/promotions', 'Codes promo'], ['calc', '#/calculatrice', 'Calculatrice'],
  [null, null, 'Communication'], ['news', '#/actualites', 'Actualités et alertes'],
  [null, null, 'Administration'], ['company', '#/entreprise', 'Entreprise et facture'], ['team', '#/equipe', 'Équipe'], ['log', '#/journal', 'Journal'],
];
let openTickets = 0, pendingClaims = 0;

async function loadMe() {
  if (!token.get()) return (me = null);
  try { me = await api('GET', '/me'); } catch { me = null; }
  return me;
}
async function guard(ctx) {
  if (!token.get()) me = null;
  const u = me || await loadMe();
  document.body.classList.toggle('signed-in', !!u);
  if (!u) { loginScreen(ctx.set, 'admin', { demoHint: 'Démo : propriétaire 77 000 00 00 · membre de l\'équipe 70 000 00 99.', onDone: async () => { await loadMe(); renderNav(); ctx.render(); } }); return null; }
  renderNav();
  return u;
}
function renderNav(active) {
  const nav = document.getElementById('side');
  if (!me) { nav.innerHTML = ''; return; }
  nav.innerHTML = `<div class="side-user"><span class="avatar">${esc(initials(me.name))}</span><span><strong>${esc(me.name)}</strong><br><span class="xs">${me.role === 'superadmin' ? 'Propriétaire' : 'Équipe'}</span></span></div>
    <form class="side-search" id="gs" role="search"><input name="q" type="search" placeholder="Réf., nom, téléphone…" aria-label="Recherche globale"></form>
    ${NAV.map(([k, h, l]) => (k ? `<a href="${h}" data-k="${k}" class="${k === (active || nav.dataset.active) ? 'on' : ''}">${l}${k === 'msg' && openTickets ? `<span class="side-count">${openTickets}</span>` : ''}${k === 'cash' && pendingClaims ? `<span class="side-count">${pendingClaims}</span>` : ''}</a>` : `<span class="side-group">${l}</span>`)).join('')}
    <div class="side-foot"><button class="btn btn-ghost btn-sm" id="th">Thème</button><button class="btn btn-ghost btn-sm" id="lo">Déconnexion</button></div>`;
  nav.querySelector('#th').onclick = toggleTheme;
  nav.querySelector('#gs').addEventListener('submit', (e) => { e.preventDefault(); const v = e.target.q.value.trim(); if (v) go('#/recherche?' + qs({ q: v })); });
  nav.querySelector('#lo').onclick = async () => { try { await api('POST', '/auth/logout'); } catch { /* ignore */ } token.clear(); me = null; renderNav(); go('#/'); };
}
const kpi = (label, value, sub = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="card ${href ? 'card-link' : ''}"><div class="xs muted">${label}</div><div class="kpi tnum">${value}</div>${sub ? `<div class="xs muted">${sub}</div>` : ''}</${href ? 'a' : 'div'}>`;
function reasonSheet(title, fn, { extra = '', cta = 'Valider', label = 'Motif (obligatoire, visible dans le journal)' } = {}) {
  sheet(`<form novalidate>${errBox}<h3>${esc(title)}</h3>${extra}<div class="field"><label for="rs">${label}</label><textarea id="rs" name="reason" required></textarea></div>
    <div class="row"><button class="btn btn-primary" type="submit">${esc(cta)}</button><button type="button" class="btn btn-ghost" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await fn(d); close(); toast('Action enregistrée'); router.render(); }); }));
}

// ---------- Tableau de bord ----------
function revenueChart(days) {
  const W = 720, H = 220, L = 56, B = 28, T = 16, R = 8, n = days.length;
  const max = Math.max(1, ...days.map((d) => d.revenue));
  const step = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / step) * step;
  const y = (v) => T + (H - T - B) * (1 - v / top), bw = (W - L - R) / n, w = Math.max(6, bw - 8);
  const ticks = [0, top / 2, top];
  const peak = days.reduce((a, d, i) => (d.revenue > days[a].revenue ? i : a), 0);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chiffre d'affaires par jour sur 14 jours" class="chart">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="ax">${t >= 1000 ? Math.round(t / 1000) + ' k' : t}</text>`).join('')}
    ${days.map((d, i) => { const x = L + i * bw + (bw - w) / 2, h = (H - T - B) - (y(d.revenue) - T); return `<g class="bar" tabindex="0" data-i="${i}">
      <rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>
      ${d.revenue ? `<path d="M${x},${H - B} V${y(d.revenue) + 4} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H - B} Z" class="mark"/>` : ''}
      ${i % 2 === (n - 1) % 2 ? `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="ax">${new Date(d.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</text>` : ''}
      ${i === peak && d.revenue ? `<text x="${x + w / 2}" y="${y(d.revenue) - 6}" text-anchor="middle" class="lbl">${String(Math.round(d.revenue / 100) / 10).replace('.', ',')} k</text>` : ''}</g>`; }).join('')}
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="base"/></svg>`;
}
async function dash(ctx) {
  const u = await guard(ctx); if (!u) return;
  const s = await api('GET', '/admin/stats');
  const sum14 = s.days.reduce((a, d) => a + d.revenue, 0), m14 = s.days.reduce((a, d) => a + d.margin, 0);
  const root = ctx.set(`<h2>Tableau de bord</h2><p class="muted small">Bokk Yoon encaisse chaque réservation, garde sa marge et reverse la part des chauffeurs.</p>
    <div class="grid grid-4">
      ${kpi('Encaissé (net des remboursements)', fcfa(s.revenue))}
      ${kpi('Marge Bokk Yoon', fcfa(s.margin), s.revenue ? Math.round((s.margin / s.revenue) * 100) + ' % du chiffre d\'affaires' : '')}
      ${kpi('À verser maintenant', fcfa(s.availableToPay), `sur ${fcfa(s.owedDrivers)} dus aux chauffeurs`, '#/paiements')}
      ${kpi('Déjà versé aux chauffeurs', fcfa(s.paidDrivers))}
    </div>
    <div class="grid grid-4" style="margin-top:12px">
      ${kpi('Trajets en cours', s.tripsLive, `${s.tripsOpen} trajets ouverts à venir`, '#/direct')}
      ${kpi('Candidatures chauffeur', s.applications, `${s.drivers} chauffeurs validés`, '#/chauffeurs?tab=PENDING')}
      ${kpi('Signalements ouverts', s.incidentsOpen, `${s.disputesOpen} réclamation(s) ouverte(s)`, '#/litiges')}
      ${kpi('Comptes suspendus ou bloqués', s.suspended, `${s.clients} clients inscrits`, '#/clients?status=suspended')}
    </div>
    <div class="grid grid-4" style="margin-top:12px">
      ${kpi('Paiements à vérifier', s.claimsPending, 'QR code Wave / Orange Money', '#/encaissements')}
      ${kpi('Messages en attente', s.ticketsOpen, 'WhatsApp, e-mail et formulaire', '#/messages')}
      ${kpi('Satisfaction (NPS)', s.nps?.score === null || s.nps?.score === undefined ? '—' : (s.nps.score > 0 ? '+' : '') + s.nps.score, `${s.nps?.count || 0} retour(s) client`, '#/retours')}
      ${kpi('Factures', 'Voir', 'factures, avoirs, factures manuelles', '#/factures')}
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><h3 style="margin:0">Chiffre d'affaires par jour</h3><span class="small muted">14 jours · ${fcfa(sum14)} · marge ${fcfa(m14)}</span></div>
      <div class="chart-wrap" style="position:relative;margin-top:10px">${revenueChart(s.days)}<div class="tip" hidden></div></div>
      <details class="small" style="margin-top:8px"><summary>Voir les données</summary><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Jour</th><th>Réservations</th><th>Chiffre d'affaires</th><th>Marge</th></tr></thead><tbody>
        ${s.days.map((d) => `<tr><td>${fmtDate(d.date + 'T12:00:00Z')}</td><td class="tnum">${d.bookings}</td><td class="tnum">${fcfa(d.revenue)}</td><td class="tnum">${fcfa(d.margin)}</td></tr>`).join('')}</tbody></table></div></details></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>Axes les plus rentables</h3><div class="table-wrap"><table><thead><tr><th>Axe</th><th>Réserv.</th><th>CA</th><th>Marge</th></tr></thead><tbody>${s.corridors.map((c) => `<tr><td>${esc(c.corridor)}</td><td class="tnum">${c.bookings}</td><td class="tnum">${fcfa(c.revenue)}</td><td class="tnum">${fcfa(c.margin)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3>Moyens de paiement</h3>${s.providers.map((p) => `<div class="row between small" style="margin-bottom:6px"><span>${PROVIDERS[p.provider] || p.provider}</span><span class="tnum"><strong>${fcfa(p.amount)}</strong> · ${p.n}</span></div>`).join('') || '<p class="muted small">Aucun paiement.</p>'}
        <p class="xs muted" style="margin-top:10px">Taux de matching colis : ${s.matchRate} % des colis publiés ont trouvé un trajet.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><h3 style="margin:0">Activité par région</h3><a class="small" href="#/territoire">Carte détaillée →</a></div><div id="rmap" style="margin-top:10px"></div></div>
    <div class="card" style="margin-top:16px"><h3>Exports (CSV, ouvrables dans Excel)</h3>${exportButtons(['reservations', 'factures', 'versements', 'chauffeurs', 'clients', 'messages'])}</div>`);
  bindExports(root);
  api('GET', '/admin/regions').then(async (rg) => {
    const m = await createMap(root.querySelector('#rmap'), { height: 340, cities: 'none', values: Object.fromEntries(rg.results.map((x) => [x.region, x.bookings])), valueLabel: 'réservations payées' });
    if (m) ctx.cleanup(() => m.destroy());
  }).catch(() => {});
  const wrap = root.querySelector('.chart-wrap'), tip = wrap.querySelector('.tip');
  on(wrap, '.bar', 'mouseenter', (e) => { const d = s.days[e.currentTarget.dataset.i]; tip.hidden = false; tip.innerHTML = `<strong>${fmtDate(d.date + 'T12:00:00Z')}</strong><br>${fcfa(d.revenue)} · ${d.bookings} réservation(s)<br>Marge ${fcfa(d.margin)}`;
    const r = e.currentTarget.getBoundingClientRect(), w = wrap.getBoundingClientRect(); tip.style.left = Math.min(w.width - 180, Math.max(0, r.left - w.left + r.width / 2 - 90)) + 'px'; tip.style.top = '0px'; });
  on(wrap, '.bar', 'focus', (e) => e.currentTarget.dispatchEvent(new Event('mouseenter')));
  wrap.addEventListener('mouseleave', () => { tip.hidden = true; });
}

// ---------- Carte en direct ----------
async function live(ctx) {
  const u = await guard(ctx); if (!u) return;
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Carte en direct</h2><span class="small muted" id="upd"></span></div>
    <div id="map" style="margin-top:12px"></div><div class="grid grid-2" style="margin-top:16px"><div class="card"><h3>En route</h3><div id="lv"></div></div><div class="card"><h3>Départs dans les 24 h</h3><div id="sn"></div></div></div>`);
  const mp = await createMap(root.querySelector('#map'), { height: 460, cities: 'all', switcher: true });
  if (mp) ctx.cleanup(() => mp.destroy());
  const draw = async () => {
    const r = await api('GET', '/admin/live');
    root.querySelector('#upd').textContent = 'Mis à jour ' + fmtTime(new Date().toISOString());
    if (mp) {
      mp.clear();
      for (const t of r.live) { mp.route(t.originPos, t.destPos, { weight: 2 }); if (t.live) mp.marker(t.live, 'car', esc(t.driverName.split(' ')[0]), `<strong>${esc(t.driverName)}</strong><br>${esc(t.origin)} → ${esc(t.dest)}<br>${t.passengers} passager(s), ${t.parcels} colis<br>${t.live.source === 'gps' ? 'GPS ' + ago(t.live.at) : 'Position estimée'} · arrivée ~${t.live.etaMin} min`); }
      for (const t of r.soon) mp.route(t.originPos, t.destPos, { color: '#8a9a94', weight: 1.5 });
    }
    root.querySelector('#lv').innerHTML = r.live.length ? r.live.map((t) => `<div class="row between small" style="margin-bottom:8px;flex-wrap:nowrap"><span><strong>${esc(t.driverName)}</strong> · ${esc(t.origin)} → ${esc(t.dest)}<br><span class="muted">${t.passengers} passager(s), ${t.parcels} colis · ${t.live?.source === 'gps' ? 'GPS ' + ago(t.live.at) : 'estimé'}</span></span><span class="badge b-sky">${Math.round((t.live?.progress || 0) * 100)} %</span></div>`).join('') : '<p class="muted small">Aucun trajet en cours.</p>';
    root.querySelector('#sn').innerHTML = r.soon.length ? r.soon.map((t) => `<div class="small" style="margin-bottom:8px"><strong>${fmtTime(t.departureAt)}</strong> · ${esc(t.origin)} → ${esc(t.dest)} · ${esc(t.driverName)}</div>`).join('') : '<p class="muted small">Aucun départ prévu.</p>';
  };
  await draw(); const tm = setInterval(draw, 20000); ctx.cleanup(() => clearInterval(tm));
}

// ---------- Membres ----------
async function members(ctx, role) {
  const u = await guard(ctx); if (!u) return;
  const p = ctx.params, tab = p.tab || '';
  const r = await api('GET', '/admin/users?' + qs({ role, status: p.status, q: p.q }));
  let rows = r.results;
  if (role === 'driver' && tab) rows = rows.filter((x) => x.driver_status === tab);
  const root = ctx.set(`<h2>${role === 'driver' ? 'Chauffeurs' : 'Clients'}</h2>
    <div class="row" style="margin:10px 0">${role === 'driver' ? [['', 'Tous'], ['PENDING', 'Candidatures'], ['APPROVED', 'Validés'], ['REJECTED', 'Refusés']].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === tab ? 'on' : ''}" href="#/chauffeurs?${qs({ tab: k, status: p.status, q: p.q })}">${l}</a>`).join('') : ''}
      ${[['', 'Tous statuts'], ['active', 'Actifs'], ['suspended', 'Suspendus'], ['blocked', 'Bloqués']].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === (p.status || '') ? 'on' : ''}" href="#/${role === 'driver' ? 'chauffeurs' : 'clients'}?${qs({ tab, status: k, q: p.q })}">${l}</a>`).join('')}</div>
    <form id="sf" class="row" style="flex-wrap:nowrap;max-width:480px"><input name="q" placeholder="Nom ou téléphone" value="${esc(p.q || '')}" aria-label="Rechercher"><button class="btn btn-primary btn-sm" type="submit">Chercher</button></form>
    <div class="row between" style="margin-top:12px"><span class="small muted">${rows.length} membre(s)</span>${exportButtons([role === 'driver' ? 'chauffeurs' : 'clients'])}</div>
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Réf.</th><th>Membre</th><th>Téléphone</th><th>Ville</th>${role === 'driver' ? '<th>Dossier</th>' : ''}<th>Note</th><th>Terminés</th><th>Signalements</th><th>Avert.</th><th>Statut</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td>${refTag(x.ref)}</td><td><a href="#/membre/${x.id}"><strong>${esc(x.name || '—')}</strong></a></td><td>${esc(x.phone)}</td><td>${esc(x.city || '—')}</td>${role === 'driver' ? `<td>${badge(DRV, x.driver_status || 'PENDING')}</td>` : ''}
        <td>${x.rating ? '★ ' + String(x.rating).replace('.', ',') : '—'}</td><td class="tnum">${x.done}</td><td>${x.open_incidents ? `<span class="badge b-terra">${x.open_incidents} ouvert(s)</span>` : '—'}</td><td class="tnum">${x.warnings || '—'}</td>
        <td>${badge(STATUS, x.status)}${x.suspended_until ? `<br><span class="xs muted">jusqu'au ${fmtDate(x.suspended_until)}</span>` : ''}</td></tr>`).join('') || `<tr><td colspan="10" class="muted">Aucun résultat.</td></tr>`}
    </tbody></table></div>`);
  root.querySelector('#sf').addEventListener('submit', (e) => { e.preventDefault(); go(`#/${role === 'driver' ? 'chauffeurs' : 'clients'}?` + qs({ tab, status: p.status, q: e.target.q.value })); });
  bindExports(root);
}

async function member(ctx, id) {
  const u = await guard(ctx); if (!u) return;
  const d = await api('GET', '/admin/users/' + id);
  const x = d.user, drv = d.driver, isTeam = ['admin', 'superadmin'].includes(x.role);
  const canAct = x.role !== 'superadmin' && (!isTeam || isSuper()) && x.id !== me.id;
  const root = ctx.set(`<a href="javascript:history.back()" class="small">← Retour</a>
    <div class="row between" style="margin-top:8px"><div class="row" style="gap:12px;flex-wrap:nowrap"><span class="avatar" style="width:56px;height:56px">${esc(initials(x.name))}</span>
      <div><h2 style="margin:0">${esc(x.name || '—')}</h2><span class="small muted">${x.ref ? refTag(x.ref) + ' · ' : ''}${{ client: 'Client', driver: 'Chauffeur', admin: 'Équipe', superadmin: 'Propriétaire' }[x.role]} · ${esc(x.phone)} · inscrit le ${fmtDate(x.createdAt)}${x.lastLoginAt ? ' · vu ' + ago(x.lastLoginAt) : ''}</span></div></div>
      <div>${badge(STATUS, x.status)}${drv ? ' ' + badge(DRV, drv.status) : ''}</div></div>
    ${x.status !== 'active' ? `<div class="notice" style="margin-top:12px"><strong>${x.status === 'blocked' ? 'Bloqué' : 'Suspendu' + (x.suspendedUntil ? ' jusqu\'au ' + fmtDate(x.suspendedUntil) : '')}</strong> · ${esc(x.statusReason || '')}</div>` : ''}
    ${canAct ? `<div class="row" style="margin-top:14px">
      <button class="btn btn-ghost btn-sm" data-a="warn">Avertir</button>
      ${x.status === 'active' ? '<button class="btn btn-ghost btn-sm" data-a="suspend">Suspendre</button>' : '<button class="btn btn-primary btn-sm" data-a="reactivate">Réactiver</button>'}
      ${x.status !== 'blocked' && isSuper() ? '<button class="btn btn-danger btn-sm" data-a="block">Bloquer définitivement</button>' : ''}
      <button class="btn btn-ghost btn-sm" data-a="note">Ajouter une note</button>
      ${isSuper() && ['client', 'driver'].includes(x.role) && x.status !== 'blocked' ? '<button class="btn btn-ghost btn-sm" data-a="delete" style="color:var(--terra)">Supprimer le compte</button>' : ''}
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${waLink(x.phone, `Bonjour ${(x.name || '').split(' ')[0]}, ici l'équipe Bokk Yoon. `)}">WhatsApp</a>${x.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(x.email)}">E-mail</a>` : ''}</div>` : ''}
    <div class="grid grid-4" style="margin-top:16px">
      ${kpi('Note', d.stats.ratingCount ? '★ ' + String(d.stats.ratingAvg).replace('.', ',') : '—', d.stats.ratingCount + ' avis')}
      ${kpi(x.role === 'driver' ? 'Trajets terminés' : 'Trajets et envois', x.role === 'driver' ? d.stats.trips : d.stats.asClient, x.role === 'driver' ? d.stats.parcels + ' colis livrés' : '')}
      ${kpi('Annulations', d.stats.cancels, x.role === 'driver' ? d.stats.cancelRate + ' % des trajets' : '')}
      ${kpi('Avertissements', x.warnings, d.incidentsAbout.length + ' signalement(s) reçu(s)')}
    </div>
    ${drv ? `<div class="card" style="margin-top:16px"><div class="row between"><h3 style="margin:0">Dossier chauffeur</h3>${badge(DRV, drv.status)}</div>
      <div class="grid grid-2 small" style="margin-top:10px"><div>Pièce : ${esc(drv.id_doc_type)} ••••${esc(drv.id_doc_last4)}<br>Permis ••••${esc(drv.license_last4)} depuis ${drv.license_since}<br>Assurance jusqu'au ${fmtDate(drv.insurance_until + 'T12:00:00Z')}</div>
      <div>Gains versés sur ${esc(PROVIDERS[drv.payout_provider])} · ${esc(drv.payout_phone)}<br>Ville : ${esc(drv.home_city)}<br>Envoyé le ${fmtDate(drv.submitted_at)}${drv.review_note ? '<br>Note : ' + esc(drv.review_note) : ''}</div></div>
      <p class="small" style="margin:10px 0 0">${d.vehicles.map((v) => `<strong>${esc(v.label)}</strong> · ${esc(v.plate)} · ${v.seats} places · ${v.cargo_kg} kg`).join('<br>')}</p>
      ${drv.status !== 'APPROVED' ? '<div class="row" style="margin-top:12px"><button class="btn btn-primary btn-sm" id="appr">Valider le dossier</button><button class="btn btn-ghost btn-sm" id="rej">Demander des corrections</button></div>' : ''}</div>` : ''}
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>Signalements reçus</h3>${d.incidentsAbout.map((i) => `<div class="small" style="margin-bottom:10px"><strong>${INC[i.category]}</strong> ${i.status === 'OPEN' ? '<span class="badge b-terra">ouvert</span>' : '<span class="badge">clos</span>'} · ${ago(i.created_at)} par ${esc(i.reporter_name)}<br>${esc(i.details)}${i.action_taken ? `<br><span class="muted">Suite : ${esc(i.action_taken)}</span>` : ''}</div>`).join('') || '<p class="muted small">Aucun.</p>'}</div>
      <div class="card"><h3>Historique des sanctions</h3>${d.sanctions.map((s) => `<div class="small" style="margin-bottom:10px"><strong>${{ WARNING: 'Avertissement', SUSPENSION: 'Suspension', BLOCK: 'Blocage', REACTIVATION: 'Réactivation' }[s.type]}</strong> · ${fmtDT(s.created_at)} par ${esc(s.by_name)}${s.until ? ` · jusqu'au ${fmtDate(s.until)}` : ''}<br>${esc(s.reason)}</div>`).join('') || '<p class="muted small">Aucune.</p>'}
        <h3 style="margin-top:14px">Notes internes</h3>${d.notes.map((n) => `<div class="small" style="margin-bottom:8px">${esc(n.body)}<br><span class="xs muted">${esc(n.author_name)} · ${ago(n.created_at)}</span></div>`).join('') || '<p class="muted small">Aucune.</p>'}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Dernières réservations</h3><div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Départ</th><th>Type</th><th>Trajet</th><th>Prix client</th><th>Part chauffeur</th><th>Statut</th></tr></thead><tbody>
      ${d.bookings.map((b) => `<tr><td>${refTag(b.ref)}</td><td>${fmtDT(b.departure_at)}</td><td>${b.kind === 'PARCEL' ? 'Colis' : 'Place'}</td><td>${esc(b.from_city)} → ${esc(b.to_city)}</td><td class="tnum">${fcfa(b.price)}</td><td class="tnum">${fcfa(b.driver_pay)}</td><td>${badge(BOOKING, b.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune.</td></tr>'}</tbody></table></div></div>
    ${d.reviews.length ? `<div class="card" style="margin-top:16px"><h3>Avis reçus</h3>${d.reviews.map((r) => `<div class="row between small" style="margin-bottom:8px;flex-wrap:nowrap"><span>${'★'.repeat(r.rating)} <strong>${esc(r.author)}</strong> ${esc(r.comment)} ${r.hidden ? '<span class="badge">masqué</span>' : ''}</span>${r.hidden ? '' : `<button class="btn btn-ghost btn-sm" data-hide="${r.id}">Masquer</button>`}</div>`).join('')}</div>` : ''}`);
  const days = '<div class="field"><label for="dy">Durée de la suspension</label><select id="dy" name="days"><option value="1">1 jour</option><option value="3">3 jours</option><option value="7" selected>7 jours</option><option value="30">30 jours</option>' + (isSuper() ? '<option value="90">90 jours</option><option value="365">1 an</option>' : '') + '</select></div>';
  const consequences = x.role === 'driver' ? '<p class="small muted">Ses trajets à venir sont retirés et ses clients remboursés intégralement. Il ne peut plus se connecter.</p>' : '<p class="small muted">Ses réservations à venir sont annulées et remboursées. Il ne peut plus se connecter.</p>';
  on(root, '[data-a]', 'click', (e) => {
    const a = e.target.dataset.a;
    if (a === 'warn') reasonSheet(`Avertir ${x.name}`, (f) => api('POST', `/admin/users/${id}/warn`, f), { label: 'Message envoyé au membre (et journalisé)', cta: 'Envoyer l\'avertissement' });
    if (a === 'suspend') reasonSheet(`Suspendre ${x.name}`, (f) => api('POST', `/admin/users/${id}/suspend`, { ...f, days: Number(f.days) }), { extra: days + consequences, cta: 'Suspendre' });
    if (a === 'block') reasonSheet(`Bloquer ${x.name} définitivement`, (f) => api('POST', `/admin/users/${id}/block`, f), { extra: consequences, cta: 'Bloquer' });
    if (a === 'reactivate') reasonSheet(`Réactiver ${x.name}`, (f) => api('POST', `/admin/users/${id}/reactivate`, f), { cta: 'Réactiver' });
    if (a === 'delete') reasonSheet(`Supprimer le compte de ${x.name}`, (f) => api('POST', `/admin/users/${id}/delete`, f), { extra: '<p class="small muted">À utiliser à la demande du membre. Ses données personnelles sont effacées et son numéro est libéré ; factures et historique sont conservés de façon anonyme. Pour écarter un fraudeur, utilisez plutôt « Bloquer » : son numéro reste interdit.</p>', label: 'Motif (ex. demande du client par WhatsApp)', cta: 'Supprimer définitivement' });
    if (a === 'note') reasonSheet('Note interne', (f) => api('POST', `/admin/users/${id}/note`, { body: f.reason }), { label: 'Note (visible par l\'équipe uniquement)', cta: 'Ajouter' });
  });
  root.querySelector('#appr')?.addEventListener('click', async () => { if (await act(() => api('POST', `/admin/drivers/${id}/review`, { decision: 'APPROVED' }), 'Dossier validé')) ctx.render(); });
  root.querySelector('#rej')?.addEventListener('click', () => reasonSheet('Demander des corrections', (f) => api('POST', `/admin/drivers/${id}/review`, { decision: 'REJECTED', note: f.reason }), { label: 'Ce que le chauffeur doit corriger', cta: 'Envoyer' }));
  on(root, '[data-hide]', 'click', (e) => reasonSheet('Masquer cet avis', (f) => api('POST', `/admin/reviews/${e.target.dataset.hide}/hide`, f), { cta: 'Masquer' }));
}

// ---------- Réservations et trajets ----------
async function bookings(ctx) {
  const u = await guard(ctx); if (!u) return;
  const st = ctx.params.status || '', sq = ctx.params.q || '';
  const r = await api('GET', '/admin/bookings?' + qs({ status: st, q: sq }));
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Réservations</h2>${exportButtons(['reservations'])}</div>${sq ? `<p class="small">Filtre : ${refTag(sq)} <a href="#/reservations">effacer</a></p>` : ''}<div class="row" style="margin:10px 0">${[['', 'Toutes'], ...Object.entries(BOOKING).map(([k, v]) => [k, v[0]])].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === st ? 'on' : ''}" href="#/reservations?status=${k}">${l}</a>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Créée</th><th>Départ</th><th>Type</th><th>Trajet</th><th>Client</th><th>Chauffeur</th><th>Prix client</th><th>Part chauffeur</th><th>Marge</th><th>Paiement</th><th>Statut</th><th>Versement</th><th></th></tr></thead><tbody>
    ${r.results.map((b) => `<tr><td>${refTag(b.ref)}${b.promo_code ? `<br><span class="xs muted">${esc(b.promo_code)} −${fcfa(b.discount)}</span>` : ''}</td><td>${fmtDT(b.created_at)}</td><td>${fmtDT(b.departure_at)}</td><td>${b.kind === 'PARCEL' ? 'Colis' : 'Place'}</td><td>${esc(b.from_city)} → ${esc(b.to_city)}</td>
      <td><a href="#/membre/${b.customer_id}">${esc(b.customer_name)}</a></td><td><a href="#/membre/${b.driver_id}">${esc(b.driver_name)}</a></td>
      <td class="tnum">${fcfa(b.price)}</td><td class="tnum">${fcfa(b.driver_pay)}</td><td class="tnum">${fcfa(b.price - b.driver_pay - b.refund_amount)}</td><td>${esc(PROVIDERS[b.provider] || '—')}</td>
      <td>${badge(BOOKING, b.status)}</td><td>${badge(PAYOUT, b.payout_status)}</td><td>${['PENDING_PAYMENT', 'PAID'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-c="${b.id}">Annuler</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="14" class="muted">Aucune.</td></tr>'}</tbody></table></div>`);
  bindExports(root);
  on(root, '[data-c]', 'click', (e) => reasonSheet('Annuler et rembourser', (f) => api('POST', `/admin/bookings/${e.target.dataset.c}/cancel`, f), { extra: '<p class="small muted">Le client est remboursé intégralement et prévenu.</p>', cta: 'Annuler la réservation' }));
}
async function trips(ctx) {
  const u = await guard(ctx); if (!u) return;
  const st = ctx.params.status || '';
  const r = await api('GET', '/admin/trips?' + qs({ status: st, q: ctx.params.q || '' }));
  const root = ctx.set(`<h2>Trajets</h2>${ctx.params.q ? `<p class="small">Filtre : ${refTag(ctx.params.q)} <a href="#/trajets">effacer</a></p>` : ''}<div class="row" style="margin:10px 0">${[['', 'Tous'], ...Object.entries(TRIP).map(([k, v]) => [k, v[0]])].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === st ? 'on' : ''}" href="#/trajets?status=${k}">${l}</a>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Départ</th><th>Trajet</th><th>Chauffeur</th><th>Places</th><th>Colis</th><th>Réservations</th><th>Statut</th><th></th></tr></thead><tbody>
    ${r.results.map((t) => `<tr><td>${refTag(t.ref)}</td><td>${fmtDT(t.departure_at)}</td><td>${esc(t.origin)} → ${esc(t.dest)}</td><td><a href="#/membre/${t.driver_id}">${esc(t.driver_name)}</a></td>
      <td class="tnum">${t.seats_total - t.seats_left}/${t.seats_total}</td><td class="tnum">${Math.round((t.parcel_kg_total - t.parcel_kg_left) * 10) / 10}/${t.parcel_kg_total} kg</td><td class="tnum">${t.bookings}</td>
      <td>${badge(TRIP, t.status)}</td><td>${['PUBLISHED', 'FULL', 'SUSPENDED'].includes(t.status) ? `<button class="btn btn-ghost btn-sm" data-c="${t.id}">Retirer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Aucun.</td></tr>'}</tbody></table></div>`);
  on(root, '[data-c]', 'click', (e) => reasonSheet('Retirer ce trajet', (f) => api('POST', `/admin/trips/${e.target.dataset.c}/cancel`, f), { extra: '<p class="small muted">Les clients sont remboursés intégralement, le chauffeur est prévenu.</p>', cta: 'Retirer le trajet' }));
}

// ---------- Litiges et signalements ----------
async function issues(ctx) {
  const u = await guard(ctx); if (!u) return;
  const [inc, dis] = await Promise.all([api('GET', '/admin/incidents'), api('GET', '/admin/disputes')]);
  const root = ctx.set(`<h2>Litiges et signalements</h2>
    <h3 style="margin-top:14px">Signalements de comportement</h3><div class="stack">
    ${inc.results.map((i) => `<div class="card"><div class="row between"><strong>${refTag(i.ref)} ${INC[i.category]} · <a href="#/membre/${i.target_id}">${esc(i.target_name)}</a> <span class="small muted">(${i.target_role === 'driver' ? 'chauffeur' : 'client'}, ${i.target_total} signalement(s), ${i.target_warnings} avert.)</span></strong>${i.status === 'OPEN' ? '<span class="badge b-terra">Ouvert</span>' : '<span class="badge">Clos</span>'}</div>
      <p class="small" style="margin:6px 0">« ${esc(i.details)} »</p><p class="xs muted" style="margin:0">Signalé par ${i.reporter_id === i.target_id ? 'le système' : esc(i.reporter_name)} · ${fmtDT(i.created_at)}${i.action_taken ? ' · Suite : ' + esc(i.action_taken) : ''}</p>
      ${i.status === 'OPEN' ? `<div class="row" style="margin-top:10px"><button class="btn btn-ghost btn-sm" data-i="${i.id}" data-act="NONE">Classer sans suite</button><button class="btn btn-ghost btn-sm" data-i="${i.id}" data-act="WARN">Avertir</button><button class="btn btn-ghost btn-sm" data-i="${i.id}" data-act="SUSPEND">Suspendre</button>${isSuper() ? `<button class="btn btn-danger btn-sm" data-i="${i.id}" data-act="BLOCK">Bloquer</button>` : ''}</div>` : ''}</div>`).join('') || '<div class="card empty">Aucun signalement.</div>'}</div>
    <h3 style="margin-top:22px">Réclamations (remboursements)</h3><div class="stack">
    ${dis.results.map((d) => `<div class="card"><div class="row between"><strong>${refTag(d.ref)} ${DISP[d.reason]} · ${esc(d.from_city)} → ${esc(d.to_city)}</strong>${d.status === 'OPEN' ? '<span class="badge b-terra">Ouverte</span>' : '<span class="badge">Close</span>'}</div>
      <p class="small" style="margin:6px 0">« ${esc(d.details)} »</p><p class="xs muted" style="margin:0">Par ${esc(d.opened_by_name)} · chauffeur <a href="#/membre/${d.driver_id}">${esc(d.driver_name)}</a> · payé ${fcfa(d.price)} · ${d.messages} message(s) · ${fmtDT(d.created_at)}${d.decision ? ' · ' + esc(d.decision) : ''}</p>
      ${d.status === 'OPEN' ? `<div class="row" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-ref="${d.id}" data-p="${d.price}">Rembourser le client</button><button class="btn btn-ghost btn-sm" data-rej="${d.id}">Rejeter (payer le chauffeur)</button></div>` : ''}</div>`).join('') || '<div class="card empty">Aucune réclamation.</div>'}</div>`);
  on(root, '[data-i]', 'click', (e) => {
    const a = e.target.dataset.act;
    reasonSheet({ NONE: 'Classer sans suite', WARN: 'Avertir le membre', SUSPEND: 'Suspendre le membre', BLOCK: 'Bloquer définitivement' }[a],
      (f) => api('POST', `/admin/incidents/${e.target.dataset.i}/close`, { action: a, reason: f.reason, days: Number(f.days) || 7 }),
      { extra: a === 'SUSPEND' ? '<div class="field"><label for="dy2">Durée</label><select id="dy2" name="days"><option value="3">3 jours</option><option value="7" selected>7 jours</option><option value="30">30 jours</option></select></div>' : '', cta: 'Valider' });
  });
  on(root, '[data-ref]', 'click', (e) => reasonSheet('Rembourser le client', (f) => api('POST', `/admin/disputes/${e.target.dataset.ref}/resolve`, { decision: 'REFUND', amount: Number(f.amount), payDriver: f.payDriver, reason: f.reason }),
    { extra: `<div class="field"><label for="am">Montant remboursé (FCFA)</label><input id="am" name="amount" type="number" value="${e.target.dataset.p}"></div><label class="check small" style="margin-bottom:12px"><input type="checkbox" name="payDriver"> Payer quand même le chauffeur (il n'est pas en faute)</label>`, cta: 'Rembourser' }));
  on(root, '[data-rej]', 'click', (e) => reasonSheet('Rejeter la réclamation', (f) => api('POST', `/admin/disputes/${e.target.dataset.rej}/resolve`, { decision: 'REJECT', reason: f.reason }), { cta: 'Rejeter' }));
}

// ---------- Paiements chauffeurs ----------
async function payouts(ctx) {
  const u = await guard(ctx); if (!u) return;
  const r = await api('GET', '/admin/payouts');
  const total = r.owed.reduce((s, x) => s + x.available, 0);
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Paiements chauffeurs</h2>${exportButtons(['versements'])}</div><p class="muted small">Vous encaissez les clients, puis vous versez à chaque chauffeur sa part, disponible ${'24 h'} après la mission sans réclamation. ${isSuper() ? '' : 'Seul le propriétaire peut enregistrer un versement.'}</p>
    <div class="grid grid-2">${kpi('À verser maintenant', fcfa(total), r.owed.filter((x) => x.available).length + ' chauffeur(s)')}${kpi('En attente du délai ou bloqué', fcfa(r.owed.reduce((s, x) => s + x.pending + x.held, 0)))}</div>
    <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Chauffeur</th><th>Compte</th><th>Disponible</th><th>Missions</th><th>En attente</th><th>Bloqué</th><th></th></tr></thead><tbody>
      ${r.owed.map((x) => `<tr><td><a href="#/membre/${x.driver_id}">${esc(x.name)}</a></td><td>${esc(PROVIDERS[x.payout_provider])} · ${esc(x.payout_phone)}</td><td class="tnum"><strong>${fcfa(x.available)}</strong></td><td class="tnum">${x.count}</td><td class="tnum">${fcfa(x.pending)}</td><td class="tnum">${fcfa(x.held)}</td>
        <td>${isSuper() && x.available ? `<button class="btn btn-primary btn-sm" data-pay="${x.driver_id}" data-amt="${x.available}" data-name="${esc(x.name)}" data-prov="${x.payout_provider}" data-phone="${esc(x.payout_phone)}">Payer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Rien à verser.</td></tr>'}</tbody></table></div>
    <h3 style="margin-top:22px">Historique des versements</h3>
    <div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Date</th><th>Chauffeur</th><th>Montant</th><th>Missions</th><th>Moyen</th><th>Transaction</th><th>Par</th></tr></thead><tbody>
      ${r.history.map((p) => `<tr><td>${refTag(p.ref)}</td><td>${fmtDT(p.created_at)}</td><td><a href="#/membre/${p.driver_id}">${esc(p.driver_name)}</a></td><td class="tnum">${fcfa(p.amount)}</td><td class="tnum">${p.bookings_count}</td><td>${esc(PROVIDERS[p.provider] || p.provider)}</td><td><code>${esc(p.reference)}</code></td><td>${esc(p.paid_by_name)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun versement.</td></tr>'}</tbody></table></div>`);
  bindExports(root);
  on(root, '[data-pay]', 'click', (e) => { const b = e.target.dataset;
    sheet(`<form novalidate>${errBox}<h3>Verser ${fcfa(b.amt)} à ${esc(b.name)}</h3><p class="small">1. Envoyez le montant depuis votre compte marchand ${esc(PROVIDERS[b.prov])} au <strong>${esc(b.phone)}</strong>.<br>2. Saisissez ici la référence de la transaction.</p>
      <div class="field"><label for="ref">Référence de la transaction</label><input id="ref" name="reference" required placeholder="Ex. WV-8H2K91"></div>
      <div class="field"><label for="nt">Note (facultative)</label><input id="nt" name="note"></div>
      <div class="row"><button class="btn btn-primary" type="submit">Enregistrer le versement</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
    (s, close) => s.querySelector('form').addEventListener('submit', (ev) => { ev.preventDefault(); submitting(ev.target, async (f) => { await api('POST', '/admin/payouts', { driverId: b.pay, reference: f.reference, note: f.note, provider: b.prov }); close(); toast('Versement enregistré, chauffeur prévenu'); ctx.render(); }); })); });
}

// ---------- Tarifs ----------
async function pricing(ctx) {
  const u = await guard(ctx); if (!u) return;
  const r = await api('GET', '/admin/settings');
  const P = r.settings.pricing, K = r.settings.booking, ro = isSuper() ? '' : 'disabled';
  const root = ctx.set(`<h2>Tarifs</h2><p class="muted small">Vous fixez le prix payé par les clients et la part reversée aux chauffeurs. La grille par axe est prioritaire sur la formule au kilomètre. ${isSuper() ? '' : 'Lecture seule : seul le propriétaire modifie les tarifs.'}</p>
    <div class="grid grid-2">
    <form class="card" id="sf" novalidate>${errBox}<h3>Formule au kilomètre</h3>
      <div class="grid grid-2">
        <div class="field"><label for="a">Place : FCFA par km</label><input id="a" name="seatPerKm" type="number" value="${P.seatPerKm}" ${ro}></div>
        <div class="field"><label for="b">Place : prix minimum</label><input id="b" name="seatMin" type="number" value="${P.seatMin}" ${ro}></div>
        <div class="field"><label for="c">Colis ≤ 5 kg : FCFA par km</label><input id="c" name="parcelPerKm" type="number" value="${P.parcelPerKm}" ${ro}></div>
        <div class="field"><label for="d">Colis : prix minimum</label><input id="d" name="parcelMin" type="number" value="${P.parcelMin}" ${ro}></div>
        <div class="field"><label for="e">Colis : + % par kg au-delà de 5 kg</label><input id="e" name="parcelExtraKgPct" type="number" value="${P.parcelExtraKgPct}" ${ro}></div>
        <div class="field"><label for="f">Part reversée au chauffeur (%)</label><input id="f" name="driverSharePct" type="number" min="30" max="100" value="${P.driverSharePct}" ${ro}></div>
        <div class="field"><label for="g">Arrondi (FCFA)</label><select id="g" name="rounding" ${ro}>${[50, 100, 250, 500].map((x) => `<option ${x === P.rounding ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      </div>
      <h3 style="margin-top:6px">Règles de réservation</h3>
      <div class="grid grid-2">
        <div class="field"><label for="h">Délai pour payer (min)</label><input id="h" name="paymentWindowMin" type="number" value="${K.paymentWindowMin}" ${ro}></div>
        <div class="field"><label for="i">Versement chauffeur après (h)</label><input id="i" name="payoutDelayHours" type="number" value="${K.payoutDelayHours}" ${ro}></div>
        <div class="field"><label for="j">Remboursement intégral si annulé plus de (h) avant</label><input id="j" name="clientCancelFullRefundHours" type="number" value="${K.clientCancelFullRefundHours}" ${ro}></div>
      </div>
      <label class="check small"><input type="checkbox" name="driverAutoApprove" ${K.driverAutoApprove ? 'checked' : ''} ${ro}> Valider automatiquement les nouveaux chauffeurs (déconseillé)</label>
      ${isSuper() ? '<button class="btn btn-primary" type="submit" style="margin-top:12px">Enregistrer</button>' : ''}</form>
    <div class="card"><h3>Simulateur</h3><div class="grid grid-2"><div class="field"><label for="qa">De</label><select id="qa">${cityOptions('Dakar')}</select></div><div class="field"><label for="qb">À</label><select id="qb">${cityOptions('Touba')}</select></div></div><div id="sim"></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><h3 style="margin:0">Grille par axe</h3>${isSuper() ? '<button class="btn btn-primary btn-sm" id="add">Ajouter un axe</button>' : ''}</div>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Axe (aller et retour)</th><th>Place client</th><th>Place chauffeur</th><th>Marge place</th><th>Colis client</th><th>Colis chauffeur</th><th>Marge colis</th><th></th></tr></thead><tbody>
      ${r.tariffs.map((t) => `<tr><td>${esc(t.origin)} ↔ ${esc(t.dest)}</td><td class="tnum">${fcfa(t.client_seat)}</td><td class="tnum">${fcfa(t.driver_seat)}</td><td class="tnum money-in">${fcfa(t.client_seat - t.driver_seat)}</td><td class="tnum">${fcfa(t.client_parcel)}</td><td class="tnum">${fcfa(t.driver_parcel)}</td><td class="tnum money-in">${fcfa(t.client_parcel - t.driver_parcel)}</td>
        <td>${isSuper() ? `<button class="btn btn-ghost btn-sm" data-edit='${esc(JSON.stringify(t))}'>Modifier</button><button class="btn btn-ghost btn-sm" data-del="${t.id}">Supprimer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun axe spécifique : la formule s\'applique partout.</td></tr>'}</tbody></table></div></div>
    <div class="card" style="margin-top:16px" id="ptypes"></div>`);
  parcelTypesBox(root.querySelector('#ptypes'), ctx);
  const sim = async () => {
    const a = root.querySelector('#qa').value, b = root.querySelector('#qb').value, box = root.querySelector('#sim');
    if (!a || !b || a === b) { box.innerHTML = '<p class="small muted">Choisissez deux villes.</p>'; return; }
    const q = await api('GET', '/admin/quote?' + qs({ from: a, to: b }));
    box.innerHTML = `<p class="small muted">${q.distanceKm} km · ~${fmtDur(q.durationMin)} · source : ${q.source === 'grille' ? 'grille par axe' : 'formule au km'}</p>
      <div class="table-wrap"><table><thead><tr><th></th><th>Client paie</th><th>Chauffeur reçoit</th><th>Marge</th></tr></thead><tbody>
      <tr><td>Place</td><td class="tnum">${fcfa(q.clientSeat)}</td><td class="tnum">${fcfa(q.driverSeat)}</td><td class="tnum money-in">${fcfa(q.clientSeat - q.driverSeat)}</td></tr>
      <tr><td>Colis ≤ 5 kg</td><td class="tnum">${fcfa(q.clientParcel)}</td><td class="tnum">${fcfa(q.driverParcel)}</td><td class="tnum money-in">${fcfa(q.clientParcel - q.driverParcel)}</td></tr></tbody></table></div>`;
  };
  ['#qa', '#qb'].forEach((s) => root.querySelector(s).addEventListener('change', sim)); sim();
  root.querySelector('#sf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => {
    await api('PUT', '/admin/settings', { pricing: { seatPerKm: +d.seatPerKm, seatMin: +d.seatMin, parcelPerKm: +d.parcelPerKm, parcelMin: +d.parcelMin, parcelExtraKgPct: +d.parcelExtraKgPct, driverSharePct: +d.driverSharePct, rounding: +d.rounding },
      booking: { paymentWindowMin: +d.paymentWindowMin, payoutDelayHours: +d.payoutDelayHours, clientCancelFullRefundHours: +d.clientCancelFullRefundHours, driverAutoApprove: d.driverAutoApprove } });
    toast('Tarifs enregistrés'); sim();
  }); });
  const edit = (t = {}) => sheet(`<form novalidate>${errBox}<h3>${t.id ? 'Modifier' : 'Ajouter'} un axe</h3>
    <div class="grid grid-2"><div class="field"><label for="to">De</label><select id="to" name="origin">${cityOptions(t.origin || 'Dakar')}</select></div><div class="field"><label for="td">À</label><select id="td" name="dest">${cityOptions(t.dest || 'Thiès')}</select></div>
      <div class="field"><label for="t1">Place : prix client</label><input id="t1" name="clientSeat" type="number" value="${t.client_seat ?? ''}" required></div><div class="field"><label for="t2">Place : part chauffeur</label><input id="t2" name="driverSeat" type="number" value="${t.driver_seat ?? ''}" required></div>
      <div class="field"><label for="t3">Colis ≤ 5 kg : prix client</label><input id="t3" name="clientParcel" type="number" value="${t.client_parcel ?? ''}" required></div><div class="field"><label for="t4">Colis : part chauffeur</label><input id="t4" name="driverParcel" type="number" value="${t.driver_parcel ?? ''}" required></div></div>
    <p class="xs muted">Valable dans les deux sens. S'applique aux nouvelles réservations.</p>
    <div class="row"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', '/admin/tariffs', { ...d, clientSeat: +d.clientSeat, driverSeat: +d.driverSeat, clientParcel: +d.clientParcel, driverParcel: +d.driverParcel }); close(); toast('Axe enregistré'); ctx.render(); }); }));
  root.querySelector('#add')?.addEventListener('click', () => edit());
  on(root, '[data-edit]', 'click', (e) => edit(JSON.parse(e.target.dataset.edit)));
  on(root, '[data-del]', 'click', (e) => confirmSheet('Supprimer cet axe ?', 'La formule au kilomètre s\'appliquera de nouveau.', async () => { await api('POST', `/admin/tariffs/${e.target.dataset.del}/delete`); ctx.render(); }, 'Supprimer'));
}

// ---------- Actualités, alertes, messages ----------
async function news(ctx) {
  const u = await guard(ctx); if (!u) return;
  const [n, a] = await Promise.all([api('GET', '/admin/news'), api('GET', '/admin/alerts')]);
  const AUD = { ALL: 'Tous', CLIENTS: 'Clients', DRIVERS: 'Chauffeurs' };
  const root = ctx.set(`<h2>Actualités et alertes</h2>
    <div class="row" style="margin:10px 0"><button class="btn btn-primary btn-sm" id="nw">Nouvel article</button><button class="btn btn-sun btn-sm" id="al">Nouvelle alerte route</button><button class="btn btn-ghost btn-sm" id="bc">Message à tous</button></div>
    <h3 style="margin-top:14px">Alertes route</h3><div class="stack">
    ${a.results.map((x) => { const on_ = new Date(x.ends_at) > new Date(); return `<div class="alert-strip ${x.level}" style="${on_ ? '' : 'opacity:.55'}"><strong>${esc(x.area)}</strong><span style="flex:1">${esc(x.message)}<br><span class="xs">${on_ ? 'jusqu\'au ' + fmtDT(x.ends_at) : 'terminée'}</span></span>${on_ ? `<button class="btn btn-ghost btn-sm" data-end="${x.id}">Terminer</button>` : ''}</div>`; }).join('') || '<p class="muted small">Aucune alerte.</p>'}</div>
    <h3 style="margin-top:20px">Articles</h3><div class="table-wrap"><table><thead><tr><th>Titre</th><th>Rubrique</th><th>Public</th><th>Statut</th><th>Date</th><th></th></tr></thead><tbody>
      ${n.results.map((x) => `<tr><td><strong>${esc(x.title)}</strong></td><td>${newsCat(x.category)}</td><td>${AUD[x.audience]}</td><td>${x.status === 'PUBLISHED' ? '<span class="badge b-green">Publié</span>' : '<span class="badge">Brouillon</span>'}</td><td>${fmtDate(x.published_at || x.created_at)}</td>
      <td><button class="btn btn-ghost btn-sm" data-ed="${x.id}">Modifier</button>${x.status === 'PUBLISHED' ? `<button class="btn btn-ghost btn-sm" data-un="${x.id}">Dépublier</button>` : ''}<button class="btn btn-ghost btn-sm" data-dl="${x.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>`);
  const editor = (x = {}) => sheet(`<form novalidate>${errBox}<h3>${x.id ? 'Modifier l\'article' : 'Nouvel article'}</h3>
    <div class="field"><label for="nt">Titre</label><input id="nt" name="title" value="${esc(x.title || '')}" required maxlength="140"></div>
    <div class="field"><label for="ns">Résumé (une phrase)</label><input id="ns" name="summary" value="${esc(x.summary || '')}" required maxlength="300"></div>
    <div class="grid grid-2"><div class="field"><label for="nc">Rubrique</label><select id="nc" name="category">${['ANNONCE', 'SECURITE', 'CONSEIL', 'ROUTE', 'PROMO'].map((c) => `<option value="${c}" ${c === x.category ? 'selected' : ''}>${{ ANNONCE: 'Annonce', SECURITE: 'Sécurité', CONSEIL: 'Conseil', ROUTE: 'Info route', PROMO: 'Offre' }[c]}</option>`).join('')}</select></div>
      <div class="field"><label for="na">Public</label><select id="na" name="audience">${Object.entries(AUD).map(([k, l]) => `<option value="${k}" ${k === x.audience ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label for="nb">Texte (une ligne vide entre les paragraphes)</label><textarea id="nb" name="body" rows="8" required>${esc(x.body || '')}</textarea></div>\n    <div class="field"><label for="nimg">Image (optionnelle, JPEG/PNG/WebP)</label><input type="file" id="nimg" accept="image/png, image/jpeg, image/webp">${x.image_url ? `<img src="${x.image_url}" style="max-height:100px;display:block;margin-top:8px;border-radius:4px">` : ''}</div>
    <label class="check small"><input type="checkbox" name="publish" ${x.status === 'PUBLISHED' ? 'checked' : ''}> Publier</label>
    <label class="check small" style="margin-top:6px"><input type="checkbox" name="notify"> Envoyer une notification au public choisi</label>
    <div class="row" style="margin-top:12px"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => { s.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); const btn = e.target.querySelector('[type=submit]'); if (btn) btn.disabled = true; try { const fd = new FormData(e.target); const d = {}; fd.forEach((v, k) => d[k] = v); d.publish = !!e.target.querySelector('[name=publish]')?.checked; d.notify = !!e.target.querySelector('[name=notify]')?.checked; const imgFile = s.querySelector('#nimg')?.files[0]; if (imgFile) { d.imageUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(imgFile); }); } await api('POST', '/admin/news', { ...d, id: x.id }); close(); toast(d.publish ? 'Article publié' : 'Brouillon enregistré'); ctx.render(); } catch(err) { toast(err.message || 'Erreur'); } finally { if (btn) btn.disabled = false; } }); }
  root.querySelector('#nw').onclick = () => editor();
  on(root, '[data-ed]', 'click', (e) => editor(n.results.find((x) => x.id === e.target.dataset.ed)));
  on(root, '[data-un]', 'click', async (e) => { if (await act(() => api('POST', `/admin/news/${e.target.dataset.un}/unpublish`), 'Article dépublié')) ctx.render(); });
  on(root, '[data-dl]', 'click', (e) => confirmSheet('Supprimer cet article ?', 'Cette action est définitive.', async () => { await api('POST', `/admin/news/${e.target.dataset.dl}/delete`); ctx.render(); }, 'Supprimer'));
  on(root, '[data-end]', 'click', async (e) => { if (await act(() => api('POST', `/admin/alerts/${e.target.dataset.end}/end`), 'Alerte terminée')) ctx.render(); });
  root.querySelector('#al').onclick = () => sheet(`<form novalidate>${errBox}<h3>Nouvelle alerte route</h3>
    <div class="field"><label for="aa">Zone</label><select id="aa" name="area"><option>National</option><optgroup label="Régions">${REGIONS.map((r) => `<option>${esc(r)}</option>`).join('')}</optgroup>${cityOptions('').replace('<option value="">Choisir…</option>', '')}</select></div>
    <div class="grid grid-2"><div class="field"><label for="lv">Niveau</label><select id="lv" name="level"><option value="INFO">Information</option><option value="ATTENTION">Attention</option><option value="DANGER">Danger</option></select></div>
      <div class="field"><label for="hr">Durée</label><select id="hr" name="hours"><option value="6">6 h</option><option value="24" selected>24 h</option><option value="72">3 jours</option><option value="168">7 jours</option></select></div></div>
    <div class="field"><label for="ms">Message</label><textarea id="ms" name="message" required maxlength="300" placeholder="Ex. Travaux à la sortie de Thiès, prévoir 30 minutes de plus."></textarea></div>
    <div class="row"><button class="btn btn-primary" type="submit">Publier l'alerte</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', '/admin/alerts', { ...d, hours: +d.hours }); close(); toast('Alerte publiée'); ctx.render(); }); }));
  root.querySelector('#bc').onclick = () => sheet(`<form novalidate>${errBox}<h3>Message à tous</h3>
    <div class="field"><label for="ba">Destinataires</label><select id="ba" name="audience"><option value="ALL">Clients et chauffeurs</option><option value="CLIENTS">Clients</option><option value="DRIVERS">Chauffeurs</option></select></div>
    <div class="field"><label for="bt">Titre</label><input id="bt" name="title" required maxlength="120"></div>
    <div class="field"><label for="bb">Message</label><textarea id="bb" name="body" maxlength="500"></textarea></div>
    <div class="row"><button class="btn btn-primary" type="submit">Envoyer la notification</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { const r = await api('POST', '/admin/broadcast', d); close(); toast(`Envoyé à ${r.sent} membre(s)`); }); }));
}

// ---------- Équipe, journal ----------
async function team(ctx) {
  const u = await guard(ctx); if (!u) return;
  const r = await api('GET', '/admin/team');
  const root = ctx.set(`<h2>Équipe</h2><p class="muted small">Les membres de l'équipe valident les chauffeurs, traitent les signalements et suspendent jusqu'à 30 jours. Seul le propriétaire bloque définitivement, fixe les tarifs et paie les chauffeurs.</p>
    ${isSuper() ? '<button class="btn btn-primary btn-sm" id="add">Ajouter un membre</button>' : ''}
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Nom</th><th>Téléphone</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead><tbody>
    ${r.results.map((x) => `<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.phone)}</td><td>${x.role === 'superadmin' ? '<span class="badge b-sun">Propriétaire</span>' : 'Équipe'}</td><td>${badge(STATUS, x.status)}</td><td>${x.last_login_at ? ago(x.last_login_at) : 'jamais'}</td>
      <td>${isSuper() && x.role === 'admin' ? (x.status === 'active' ? `<button class="btn btn-danger btn-sm" data-rv="${x.id}">Retirer l'accès</button>` : `<button class="btn btn-ghost btn-sm" data-rs="${x.id}">Rétablir</button>`) : ''}</td></tr>`).join('')}</tbody></table></div>`);
  root.querySelector('#add')?.addEventListener('click', () => sheet(`<form novalidate>${errBox}<h3>Ajouter un membre de l'équipe</h3>
    <div class="field"><label for="tn">Nom</label><input id="tn" name="name" required></div><div class="field"><label for="tp">Téléphone (dédié, sans compte client ou chauffeur)</label><input id="tp" name="phone" type="tel" required></div>
    <div class="row"><button class="btn btn-primary" type="submit">Ajouter</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', '/admin/team', d); close(); toast('Membre ajouté : il se connecte avec son numéro'); ctx.render(); }); })));
  on(root, '[data-rv]', 'click', (e) => confirmSheet('Retirer l\'accès ?', 'Ce membre sera déconnecté immédiatement.', async () => { await api('POST', `/admin/team/${e.target.dataset.rv}/revoke`); ctx.render(); }, 'Retirer'));
  on(root, '[data-rs]', 'click', async (e) => { if (await act(() => api('POST', `/admin/team/${e.target.dataset.rs}/restore`), 'Accès rétabli')) ctx.render(); });
}
async function journal(ctx) {
  const u = await guard(ctx); if (!u) return;
  const tab = ctx.params.tab || 'audit';
  const root = ctx.set(`<h2>Journal</h2><div class="row" style="margin:10px 0"><a class="btn btn-ghost btn-sm ${tab === 'audit' ? 'on' : ''}" href="#/journal">Actions</a><a class="btn btn-ghost btn-sm ${tab === 'wait' ? 'on' : ''}" href="#/journal?tab=wait">Liste d'attente</a>${isSuper() ? '<button class="btn btn-ghost btn-sm" id="seed">Ajouter les données de démo</button>' : ''}</div><div id="b"></div>`);
  const b = root.querySelector('#b');
  if (tab === 'wait') { const r = await api('GET', '/admin/waitlist'); b.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Nom</th><th>Téléphone</th><th>Profil</th><th>Ville</th></tr></thead><tbody>${r.results.map((w) => `<tr><td>${fmtDT(w.created_at)}</td><td>${esc(w.name)}</td><td>${esc(w.phone)}</td><td>${esc(w.role)}</td><td>${esc(w.city)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Personne.</td></tr>'}</tbody></table></div>`; }
  else { const r = await api('GET', '/admin/audit'); b.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Objet</th><th>Détails</th></tr></thead><tbody>${r.results.map((l) => `<tr><td>${fmtDT(l.created_at)}</td><td>${esc(l.actor_name || 'système')}</td><td><code>${esc(l.action)}</code></td><td>${esc(l.entity_type)} ${esc(String(l.entity_id).slice(0, 8))}</td><td class="xs" style="white-space:normal;min-width:240px">${esc(l.details)}</td></tr>`).join('')}</tbody></table></div>`; }
  root.querySelector('#seed')?.addEventListener('click', async () => { const r = await api('POST', '/admin/seed'); toast(r.created ? 'Données de démo ajoutées' : 'Déjà présentes'); });
}


// ---------- Outils communs v3 ----------
const EXPORTS = { reservations: 'Réservations', factures: 'Factures', versements: 'Versements', chauffeurs: 'Chauffeurs', clients: 'Clients', messages: 'Messages' };
const exportButtons = (keys) => `<div class="row" style="gap:6px">${keys.map((k) => `<button type="button" class="btn btn-ghost btn-sm" data-export="${k}">⤓ ${EXPORTS[k]} (CSV)</button>`).join('')}</div>`;
function bindExports(root) {
  on(root, '[data-export]', 'click', async (e) => { const b = e.target.closest('[data-export]'); b.disabled = true;
    try { const r = await api('GET', '/admin/export/' + b.dataset.export); downloadCsv(r.filename, r.csv); } catch (er) { toast(er.message); } finally { b.disabled = false; } });
}

// ---------- Types d'envoi (passeport, enveloppe…) ----------
async function parcelTypesBox(box, ctx) {
  const r = await api('GET', '/admin/parcel-types');
  const q = await api('GET', '/admin/quote?' + qs({ from: 'Dakar', to: 'Saint-Louis' }));
  const km = q.distanceKm;
  const priceAt = (t, k) => ({ c: Math.round(t.client_base + t.client_per_km * k), d: Math.round(t.driver_base + t.driver_per_km * k) });
  box.innerHTML = `<div class="row between"><h3 style="margin:0">Types d'envoi et forfaits</h3>${isSuper() ? '<button class="btn btn-primary btn-sm" id="addt">Nouveau type d\'envoi</button>' : ''}</div>
    <p class="small muted">Créez des envois <strong>sans pesée à prix forfaitaire</strong> (passeport, enveloppe, clés, carte grise…). Prix = forfait de base + montant par km. Exemple calculé sur Dakar → Saint-Louis (${km} km), avant arrondi.</p>
    <div class="table-wrap"><table><thead><tr><th>Type</th><th>Mode</th><th>Client : base + /km</th><th>Chauffeur : base + /km</th><th>Ex. client</th><th>Ex. chauffeur</th><th>Marge</th><th>Statut</th><th></th></tr></thead><tbody>
    ${r.results.map((t) => { const x = priceAt(t, km); return `<tr style="${t.active ? '' : 'opacity:.55'}"><td><strong>${esc(t.label)}</strong><br><code class="xs">${esc(t.code)}</code>${t.id_check ? ' <span class="badge b-sky">pièce vérifiée</span>' : ''}</td>
      <td>${t.mode === 'FLAT' ? 'Forfait, sans poids' : 'Au poids (formule)'}</td>
      ${t.mode === 'FLAT' ? `<td class="tnum">${fcfa(t.client_base)} + ${t.client_per_km}/km</td><td class="tnum">${fcfa(t.driver_base)} + ${t.driver_per_km}/km</td><td class="tnum">${fcfa(x.c)}</td><td class="tnum">${fcfa(x.d)}</td><td class="tnum money-in">${fcfa(x.c - x.d)}</td>` : '<td colspan="5" class="small muted">Formule au kilomètre et grille par axe ci-dessus</td>'}
      <td>${t.active ? '<span class="badge b-green">Actif</span>' : '<span class="badge">Masqué</span>'}</td>
      <td>${isSuper() ? `${t.mode === 'FLAT' ? `<button class="btn btn-ghost btn-sm" data-te='${esc(JSON.stringify(t))}'>Modifier</button>` : ''}${t.code !== 'COLIS' ? `<button class="btn btn-ghost btn-sm" data-tt="${t.id}">${t.active ? 'Masquer' : 'Activer'}</button>` : ''}` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  const editT = (t = { mode: 'FLAT', client_base: 2000, driver_base: 1500, client_per_km: 3, driver_per_km: 2, nominal_kg: 0.2, sort: 50 }) => sheet(`<form novalidate>${errBox}<h3>${t.id ? 'Modifier' : 'Nouveau'} type d'envoi</h3>
    <div class="grid grid-2"><div class="field"><label for="pl">Nom affiché</label><input id="pl" name="label" value="${esc(t.label || '')}" required placeholder="Ex. Carte grise"></div>
      <div class="field"><label for="pc">Code (unique)</label><input id="pc" name="code" value="${esc(t.code || '')}" ${t.id ? 'readonly' : ''} required placeholder="CARTE_GRISE"></div></div>
    <div class="field"><label for="pd">Description pour le client</label><input id="pd" name="description" value="${esc(t.description || '')}" maxlength="300" placeholder="Ex. Document officiel dans une enveloppe fermée"></div>
    <div class="grid grid-2">
      <div class="field"><label for="p1">Prix client : forfait de base</label><input id="p1" name="clientBase" type="number" min="0" value="${t.client_base}"></div>
      <div class="field"><label for="p2">Prix client : + FCFA par km</label><input id="p2" name="clientPerKm" type="number" min="0" step="0.5" value="${t.client_per_km}"></div>
      <div class="field"><label for="p3">Part chauffeur : base</label><input id="p3" name="driverBase" type="number" min="0" value="${t.driver_base}"></div>
      <div class="field"><label for="p4">Part chauffeur : + FCFA par km</label><input id="p4" name="driverPerKm" type="number" min="0" step="0.5" value="${t.driver_per_km}"></div>
      <div class="field"><label for="p5">Poids retenu pour la place (kg)</label><input id="p5" name="nominalKg" type="number" min="0.05" step="0.05" value="${t.nominal_kg}"></div>
      <div class="field"><label for="p6">Ordre d'affichage</label><input id="p6" name="sort" type="number" value="${t.sort}"></div></div>
    <label class="check small"><input type="checkbox" name="idCheck" ${t.id_check ? 'checked' : ''}> Vérification de pièce d'identité du destinataire à la remise</label>
    <div class="notice small" id="pv" style="margin-top:12px"></div>
    <div class="row" style="margin-top:12px"><button class="btn btn-primary" type="submit">Enregistrer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => {
    const f = s.querySelector('form');
    const pv = () => { const d = formData(f); const ex = [50, 100, km, 450].map((k) => { const c = Math.round(+d.clientBase + +d.clientPerKm * k), dr = Math.round(+d.driverBase + +d.driverPerKm * k); return `<tr><td>${Math.round(k)} km</td><td class="tnum">${fcfa(c)}</td><td class="tnum">${fcfa(dr)}</td><td class="tnum money-in">${fcfa(c - dr)}</td></tr>`; }).join('');
      s.querySelector('#pv').innerHTML = `<strong>Aperçu (avant arrondi)</strong><table style="margin-top:6px"><thead><tr><th>Distance</th><th>Client</th><th>Chauffeur</th><th>Marge</th></tr></thead><tbody>${ex}</tbody></table>`; };
    f.addEventListener('input', pv); pv();
    f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async (d) => { await api('POST', '/admin/parcel-types', { ...d, mode: 'FLAT' }); close(); toast('Type d\'envoi enregistré'); ctx.render(); }); });
  });
  box.querySelector('#addt')?.addEventListener('click', () => editT());
  on(box, '[data-te]', 'click', (e) => editT(JSON.parse(e.target.dataset.te)));
  on(box, '[data-tt]', 'click', async (e) => { if (await act(() => api('POST', `/admin/parcel-types/${e.target.dataset.tt}/toggle`), 'Type mis à jour')) ctx.render(); });
}

// ---------- Recherche globale ----------
async function searchPage(ctx) {
  const u = await guard(ctx); if (!u) return;
  const term = ctx.params.q || '';
  const r = term ? await api('GET', '/admin/search?' + qs({ q: term })) : { results: [] };
  const root = ctx.set(`<h2>Recherche</h2><form id="sq" class="row" style="flex-wrap:nowrap;max-width:560px"><input name="q" value="${esc(term)}" placeholder="CL00012, RES-2026-00031, COL-…, FAC-…, nom, téléphone" aria-label="Recherche"><button class="btn btn-primary btn-sm">Chercher</button></form>
    <p class="xs muted" style="margin-top:8px">Préfixes : CL client · CH chauffeur · EQ équipe · TR trajet · COL colis · RES réservation · VER versement · LIT réclamation · SIG signalement · SUP message · FAC facture · AV avoir.</p>
    <div class="stack" style="margin-top:12px">${r.results.map((x) => `<a class="card card-link row between" href="${x.link}" ${x.link.startsWith('..') ? 'target="_blank" rel="noopener"' : ''} style="flex-wrap:nowrap"><span><span class="badge">${esc(x.kind)}</span> ${refTag(x.ref)}<br><span class="small">${esc(x.label)}</span></span><span>→</span></a>`).join('') || (term ? '<div class="card empty">Aucun résultat.</div>' : '')}</div>`);
  root.querySelector('#sq').addEventListener('submit', (e) => { e.preventDefault(); go('#/recherche?' + qs({ q: e.target.q.value.trim() })); });
}

// ---------- Messages reçus (formulaire, WhatsApp, e-mail) ----------
const TK = { OPEN: ['À traiter', 'b-sun'], ANSWERED: ['Répondu', 'b-green'], CLOSED: ['Clos', ''] };
const TKCAT = { QUESTION: 'Question', RECLAMATION: 'Réclamation', SUGGESTION: 'Suggestion', PARTENARIAT: 'Partenariat', CHAUFFEUR: 'Devenir chauffeur', AUTRE: 'Autre' };
const SRC = { site: 'Site public', app: 'Espace client', chauffeur: 'Espace chauffeur' };
async function inbox(ctx) {
  const u = await guard(ctx); if (!u) return;
  const st = ctx.params.status || '';
  const r = await api('GET', '/admin/tickets?' + qs({ status: st }));
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Messages reçus</h2>${exportButtons(['messages'])}</div>
    <p class="muted small">Formulaires du site et des espaces client et chauffeur. Répondez ici (le membre est notifié, le visiteur reçoit un e-mail et un SMS), ou directement par WhatsApp ou e-mail.</p>
    <div class="row" style="margin:10px 0">${[['', 'Tous'], ['OPEN', 'À traiter'], ['ANSWERED', 'Répondus'], ['CLOSED', 'Clos']].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === st ? 'on' : ''}" href="#/messages?status=${k}">${l}</a>`).join('')}</div>
    <div class="stack">${r.results.map((t) => `<a class="card card-link" href="#/messages/${t.id}"><div class="row between"><span>${refTag(t.ref)} <strong>${esc(t.subject)}</strong></span>${badge(TK, t.status)}</div>
      <div class="small muted">${esc(t.name)}${t.user_ref ? ' · ' + esc(t.user_ref) : ''} · ${TKCAT[t.category]} · ${SRC[t.source] || esc(t.source)} · ${ago(t.updated_at)} · ${t.n} message(s)</div>
      <div class="small" style="margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.last || '')}</div></a>`).join('') || '<div class="card empty">Aucun message.</div>'}</div>`);
  bindExports(root);
}
async function ticketAdmin(ctx, id) {
  const u = await guard(ctx); if (!u) return;
  const t = await api('GET', '/admin/tickets/' + id);
  const first = t.name.split(' ')[0];
  const root = ctx.set(`<a href="#/messages" class="small">← Messages reçus</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${esc(t.subject)}</h2>${badge(TK, t.status)}</div>
    <p class="small muted">${refTag(t.ref)} · ${TKCAT[t.category]} · ${SRC[t.source] || esc(t.source)} · reçu ${fmtDT(t.created_at)}${t.booking_ref ? ` · réservation <a href="#/reservations?q=${esc(t.booking_ref)}">${esc(t.booking_ref)}</a>` : ''}</p>
    <div class="grid grid-2">
      <div class="card"><h3>Expéditeur</h3><p class="small" style="margin:0"><strong>${esc(t.name)}</strong>${t.user_ref ? ` · <a href="#/membre/${t.user_id}">${esc(t.user_ref)}</a>` : ' · visiteur du site'}<br>${t.phone ? 'Tél. ' + esc(t.phone) + '<br>' : ''}${t.email ? esc(t.email) : ''}</p></div>
      <div class="card"><h3>Répondre directement</h3><div class="row">
        ${t.phone ? `<a class="btn btn-sm" style="background:#25D366;color:#fff" target="_blank" rel="noopener" href="${waLink(t.phone, `Bonjour ${first}, ici Bokk Yoon au sujet de votre message ${t.ref} (${t.subject}). `)}">${ICONS.wa.replace('<svg', '<svg width="16" height="16"')} WhatsApp</a>` : ''}
        ${t.email ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(t.email)}?subject=${encodeURIComponent(`Re: ${t.subject} [${t.ref}]`)}&body=${encodeURIComponent(`Bonjour ${first},\n\n\n\nL'équipe Bokk Yoon`)}">E-mail</a>` : ''}
        ${t.phone ? `<a class="btn btn-ghost btn-sm" href="tel:${esc(t.phone)}">Appeler</a>` : ''}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Conversation</h3><div class="chat" style="max-height:none">${t.messages.map((m) => `<div class="msg ${m.from_team ? 'mine' : ''}"><span class="xs" style="opacity:.75">${m.from_team ? esc(m.author || 'Équipe') : esc(t.name)} · ${fmtDT(m.created_at)}</span><br>${esc(m.body).replace(/\n/g, '<br>')}</div>`).join('')}</div>
      ${t.status !== 'CLOSED' ? `<form id="rf" style="margin-top:12px" novalidate>${errBox}<div class="field"><label for="rb">Votre réponse</label><textarea id="rb" name="body" rows="4" required>Bonjour ${esc(first)},\n\n</textarea></div>
        <div class="row"><button class="btn btn-primary" type="submit">Envoyer la réponse</button><button class="btn btn-ghost" type="button" id="cl">Clore</button></div></form>` : '<p class="small muted">Conversation close.</p>'}</div>`);
  root.querySelector('#rf')?.addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { const r = await api('POST', `/admin/tickets/${id}/reply`, d); toast(r.channel === 'in-app' ? 'Réponse envoyée dans l\'application' : r.channel.includes('NOT_CONFIGURED') ? 'Réponse enregistrée (e-mail non configuré : SMS envoyé)' : 'Réponse envoyée par e-mail et SMS'); ctx.render(); }); });
  root.querySelector('#cl')?.addEventListener('click', async () => { if (await act(() => api('POST', `/admin/tickets/${id}/close`), 'Conversation close')) ctx.render(); });
}

// ---------- Retours clients (NPS) ----------
async function feedbackPage(ctx) {
  const u = await guard(ctx); if (!u) return;
  const r = await api('GET', '/admin/feedback');
  const n = r.results.length, pro = r.results.filter((x) => x.score >= 9).length, det = r.results.filter((x) => x.score <= 6).length;
  const nps = n ? Math.round(((pro - det) / n) * 100) : null;
  const dist = Array.from({ length: 11 }, (_, i) => r.results.filter((x) => x.score === i).length), mx = Math.max(1, ...dist);
  const root = ctx.set(`<h2>Retours clients</h2><p class="muted small">Formulaire envoyé au client à la fin de chaque trajet : « Recommanderiez-vous Bokk Yoon ? » (0 à 10). Une note de 6 ou moins vous est signalée.</p>
    <div class="grid grid-4">${kpi('NPS', nps === null ? '—' : (nps > 0 ? '+' : '') + nps, 'promoteurs − détracteurs')}${kpi('Promoteurs (9-10)', pro, n ? Math.round((pro / n) * 100) + ' %' : '')}${kpi('Passifs (7-8)', n - pro - det)}${kpi('Détracteurs (0-6)', det, n ? Math.round((det / n) * 100) + ' %' : '')}</div>
    <div class="card" style="margin-top:16px"><h3>Répartition des notes</h3><div style="display:grid;grid-template-columns:repeat(11,1fr);gap:6px;align-items:end;height:140px">${dist.map((v, i) => `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${v} retour(s) à ${i}/10"><span class="xs tnum">${v || ''}</span><span style="width:100%;height:${Math.round((v / mx) * 100)}%;min-height:${v ? 4 : 0}px;border-radius:4px 4px 0 0;background:${i >= 9 ? 'var(--primary)' : i >= 7 ? 'var(--sun)' : 'var(--terra)'}"></span><span class="xs muted">${i}</span></div>`).join('')}</div>
      <p class="xs muted" style="margin:8px 0 0">Vert : promoteurs · jaune : passifs · rouge : détracteurs.</p></div>
    <div class="stack" style="margin-top:16px">${r.results.map((f) => `<div class="card"><div class="row between"><span><span class="badge ${f.score >= 9 ? 'b-green' : f.score >= 7 ? 'b-sun' : 'b-terra'}">${f.score}/10</span> <a href="#/membre/${f.client_id}"><strong>${esc(f.client)}</strong></a> · ${esc(f.from_city)} → ${esc(f.to_city)} avec <a href="#/membre/${f.driver_id}">${esc(f.driver)}</a></span><span class="xs muted">${refTag(f.booking_ref)} · ${fmtDate(f.created_at)}</span></div>
      ${f.liked ? `<p class="small" style="margin:8px 0 0"><strong>Aimé :</strong> ${esc(f.liked)}</p>` : ''}${f.improve ? `<p class="small" style="margin:4px 0 0"><strong>À améliorer :</strong> ${esc(f.improve)}</p>` : ''}</div>`).join('') || '<div class="card empty">Aucun retour pour le moment.</div>'}</div>`);
}

// ---------- Codes promo ----------
async function promos(ctx) {
  const u = await guard(ctx); if (!u) return;
  const r = await api('GET', '/admin/promos');
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Codes promo</h2>${isSuper() ? '<button class="btn btn-primary btn-sm" id="np">Nouveau code</button>' : ''}</div>
    <p class="muted small">La remise est prise sur votre marge : la part du chauffeur ne change pas. Un code s'utilise une fois par client.</p>
    <div class="table-wrap"><table><thead><tr><th>Code</th><th>Libellé</th><th>Remise</th><th>S'applique à</th><th>Utilisations</th><th>Expire</th><th>Statut</th><th></th></tr></thead><tbody>
    ${r.results.map((x) => `<tr><td><code><strong>${esc(x.code)}</strong></code></td><td>${esc(x.label)}</td><td>${x.kind === 'PERCENT' ? x.value + ' %' : fcfa(x.value)}</td><td>${{ ALL: 'Tout', SEAT: 'Places', PARCEL: 'Colis' }[x.applies]}</td>
      <td class="tnum">${x.used}${x.max_uses ? ' / ' + x.max_uses : ''}</td><td>${x.expires_at ? fmtDate(x.expires_at) : '—'}</td><td>${x.active ? '<span class="badge b-green">Actif</span>' : '<span class="badge">Inactif</span>'}</td>
      <td>${isSuper() ? `<button class="btn btn-ghost btn-sm" data-tg="${x.id}">${x.active ? 'Désactiver' : 'Activer'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun code.</td></tr>'}</tbody></table></div>`);
  root.querySelector('#np')?.addEventListener('click', () => sheet(`<form novalidate>${errBox}<h3>Nouveau code promo</h3>
    <div class="grid grid-2"><div class="field"><label for="c1">Code</label><input id="c1" name="code" required placeholder="TABASKI26" style="text-transform:uppercase"></div><div class="field"><label for="c2">Libellé</label><input id="c2" name="label" placeholder="Offre Tabaski"></div>
      <div class="field"><label for="c3">Type</label><select id="c3" name="kind"><option value="PERCENT">Pourcentage</option><option value="FIXED">Montant fixe (FCFA)</option></select></div><div class="field"><label for="c4">Valeur</label><input id="c4" name="value" type="number" min="1" required value="10"></div>
      <div class="field"><label for="c5">S'applique à</label><select id="c5" name="applies"><option value="ALL">Places et colis</option><option value="SEAT">Places</option><option value="PARCEL">Colis</option></select></div><div class="field"><label for="c6">Utilisations max (vide = illimité)</label><input id="c6" name="maxUses" type="number" min="1"></div>
      <div class="field"><label for="c7">Date de fin</label><input id="c7" name="expiresAt" type="date"></div></div>
    <div class="row"><button class="btn btn-primary" type="submit">Créer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', '/admin/promos', { ...d, value: +d.value, maxUses: d.maxUses ? +d.maxUses : null }); close(); toast('Code créé'); ctx.render(); }); })));
  on(root, '[data-tg]', 'click', async (e) => { if (await act(() => api('POST', `/admin/promos/${e.target.dataset.tg}/toggle`), 'Code mis à jour')) ctx.render(); });
}

// ---------- Encaissements : QR code Wave / Orange Money du propriétaire ----------
const CLAIM = { PENDING: ['À vérifier', 'b-sun'], APPROVED: ['Confirmé', 'b-green'], REJECTED: ['Refusé', 'b-terra'], REFUND: ['À rembourser', 'b-terra'] };
const PROV_NAME = { WAVE: 'Wave', ORANGE_MONEY: 'Orange Money' };
let jsqrPromise = null;
const loadJsQR = () => (jsqrPromise ??= new Promise((res, rej) => { if (window.jsQR) return res(window.jsQR); const s = document.createElement('script'); s.src = new URL('vendor/jsqr.js', import.meta.url).href; s.onload = () => res(window.jsQR); s.onerror = () => rej(new Error('Lecteur QR indisponible')); document.head.appendChild(s); }));
/** Charge l'image du QR code : lit son contenu (lien de paiement) et produit une image nette et légère. */
function readQrImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = async () => {
      const big = Math.min(1, 1400 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * big); cv.height = Math.round(img.height * big);
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      let text = '';
      try { const jsQR = await loadJsQR(); const d = cx.getImageData(0, 0, cv.width, cv.height); text = jsQR(d.data, cv.width, cv.height)?.data || ''; } catch { /* lecture facultative */ }
      const k = Math.min(1, 720 / Math.max(cv.width, cv.height)), out = document.createElement('canvas');
      out.width = Math.round(cv.width * k); out.height = Math.round(cv.height * k);
      out.getContext('2d').drawImage(cv, 0, 0, out.width, out.height); URL.revokeObjectURL(url);
      let data = out.toDataURL('image/png'); if (data.length > 650000) data = out.toDataURL('image/jpeg', 0.9);
      resolve({ data, text });
    };
    img.onerror = () => reject(new Error('Image illisible.')); img.src = url;
  });
}
async function cashPage(ctx) {
  const u = await guard(ctx); if (!u) return;
  const st = ctx.params.status || 'PENDING';
  const [ps, cl] = await Promise.all([api('GET', '/admin/payment'), api('GET', '/admin/payment-claims?' + qs({ status: st === 'ALL' ? '' : st }))]);
  pendingClaims = st === 'PENDING' ? cl.results.length : pendingClaims;
  const ro = isSuper() ? '' : 'disabled';
  const methodCard = (key, label, color, m) => `<div class="card pay-method" data-m="${key}" style="border-top:4px solid ${color}">
    <div class="row between"><h3 style="margin:0">${label}</h3><label class="check small"><input type="checkbox" name="${key}_enabled" ${m.enabled ? 'checked' : ''} ${ro}> Proposer aux clients</label></div>
    <div class="qr-drop" style="margin-top:12px">${m.qr ? `<img src="${esc(qrSrc(m.qr))}" alt="QR code ${label}" class="qr-img">` : `<div class="qr-empty">Aucun QR code<br><span class="xs">Ajoutez une capture de votre QR code Wave</span></div>`}</div>
    <div class="row" style="margin-top:10px"><label class="btn btn-ghost btn-sm" ${ro ? 'aria-disabled="true"' : ''}>Choisir l'image du QR code<input type="file" accept="image/*" data-up="${key}" hidden ${ro}></label>${m.qr ? `<button type="button" class="btn btn-ghost btn-sm" data-rmqr="${key}" ${ro}>Retirer</button>` : ''}</div>
    <p class="xs muted" data-read="${key}" style="margin:6px 0 0"></p>
    <div class="grid grid-2" style="margin-top:10px">
      <div class="field"><label for="${key}-num">Numéro ${label}</label><input id="${key}-num" name="${key}_number" value="${esc(m.number)}" placeholder="77 000 00 00" ${ro}></div>
      <div class="field"><label for="${key}-name">Nom affiché au client</label><input id="${key}-name" name="${key}_name" value="${esc(m.name)}" placeholder="Bokk Yoon" ${ro}></div></div>
    <div class="field"><label for="${key}-link">Lien de paiement (rempli automatiquement si le QR en contient un)</label><input id="${key}-link" name="${key}_link" value="${esc(m.link)}" placeholder="${key === 'wave' ? 'https://pay.wave.com/m/…' : 'https://…'}" ${ro}><div class="hint">Sur téléphone, le client ne peut pas scanner l'écran qu'il regarde : ce lien ouvre directement l'application.</div></div>
  </div>`;
  const root = ctx.set(`<h2>Encaissements Wave / Orange Money</h2>
    <p class="muted small">Les clients paient sur <strong>votre QR code Wave</strong> (compte personnel ou marchand), puis déclarent l'ID de la transaction. Vous vérifiez dans votre application Wave ou Orange Money, puis vous confirmez ici : la réservation passe en « payée », le client reçoit son code, la facture est émise et le chauffeur est prévenu.</p>
    <form id="pf" novalidate>${errBox}
      <div class="card" style="margin-bottom:16px"><div class="row between"><div><h3 style="margin:0">Mode d'encaissement</h3><p class="small muted" style="margin:4px 0 0">${ps.mode === 'QR' ? 'Actif : les clients paient sur vos QR codes.' : 'Démonstration : les paiements sont simulés (aucun argent réel).'}</p></div>
        <div class="pill-nav" id="mode">${[['SIMULATION', 'Simulation (démo)'], ['QR', 'QR code réel']].map(([k, l]) => `<button type="button" class="btn btn-ghost btn-sm ${k === ps.mode ? 'on' : ''}" data-mode="${k}" ${ro}>${l}</button>`).join('')}</div></div></div>
      <div class="grid grid-2">${methodCard('wave', 'Wave', '#1DC4FF', ps.wave)}${methodCard('orange', 'Orange Money', '#FF7900', ps.orange)}</div>
      <div class="card" style="margin-top:16px"><div class="grid grid-2"><div class="field"><label for="ins">Consigne affichée au client</label><textarea id="ins" name="instructions" rows="2" ${ro}>${esc(ps.instructions)}</textarea></div>
        <div class="field"><label for="rv">Délai de vérification annoncé (minutes)</label><input id="rv" name="reviewMinutes" type="number" min="5" max="1440" value="${ps.reviewMinutes}" ${ro}></div></div>
        ${isSuper() ? '<button class="btn btn-primary" type="submit">Enregistrer</button>' : '<p class="small muted">Seul le propriétaire modifie ces réglages. L\'équipe peut vérifier les paiements.</p>'}</div>
    </form>
    <div class="row between" style="margin-top:26px"><h3 style="margin:0">Paiements déclarés</h3>
      <div class="row" style="gap:6px">${[['PENDING', 'À vérifier'], ['REFUND', 'À rembourser'], ['APPROVED', 'Confirmés'], ['REJECTED', 'Refusés'], ['ALL', 'Tous']].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === st ? 'on' : ''}" href="#/encaissements?status=${k}">${l}</a>`).join('')}</div></div>
    <div class="stack" style="margin-top:12px">${cl.results.map((c) => `<div class="card"><div class="row between"><span>${refTag(c.ref)} <strong class="tnum" style="font-size:1.15rem">${fcfa(c.amount)}</strong> · ${PROV_NAME[c.provider] || esc(c.provider)}</span>${badge(CLAIM, c.status)}</div>
      <div class="grid grid-2 small" style="margin-top:8px"><div>ID de transaction : <code style="font-size:1rem;user-select:all">${esc(c.transaction_ref)}</code><br>Payeur : ${esc(c.payer_name)} · ${esc(c.payer_phone)}<br>Déclaré ${ago(c.created_at)}</div>
        <div>Réservation ${refTag(c.booking_ref)} · ${esc(c.from_city)} → ${esc(c.to_city)}<br>Client <a href="#/membre/${c.customer_id}">${esc(c.customer_name)}</a> ${refTag(c.customer_ref)}<br>${c.amount !== c.booking_price ? `<span style="color:var(--terra)">Montant attendu aujourd'hui : ${fcfa(c.booking_price)}</span>` : 'Montant exact attendu'}${c.reason ? '<br>Motif : ' + esc(c.reason) : ''}${c.reviewer ? `<br><span class="muted">Traité par ${esc(c.reviewer)}</span>` : ''}</div></div>
      ${c.status === 'PENDING' ? `<div class="row" style="margin-top:12px"><button class="btn btn-primary btn-sm" data-ok="${c.id}" data-amt="${c.amount}">Je l'ai reçu : confirmer</button><button class="btn btn-ghost btn-sm" data-no="${c.id}">Introuvable : refuser</button><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${waLink(c.customer_phone, `Bonjour ${(c.customer_name || '').split(' ')[0]}, au sujet de votre paiement ${c.ref} (réservation ${c.booking_ref}) : `)}">WhatsApp</a></div>` : ''}
      ${c.status === 'REFUND' ? `<div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-rf="${c.id}">Client remboursé</button></div>` : ''}</div>`).join('') || '<div class="card empty">Rien ici.</div>'}</div>`);
  const f = root.querySelector('#pf'); let mode = ps.mode; const qrs = { wave: ps.wave.qr, orange: ps.orange.qr };
  root.querySelector('#mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b || ro) return; mode = b.dataset.mode; root.querySelectorAll('#mode [data-mode]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(root, '[data-up]', 'change', async (e) => { const key = e.target.dataset.up, file = e.target.files[0]; if (!file) return;
    const info = root.querySelector(`[data-read="${key}"]`); info.textContent = 'Lecture du QR code…';
    try { const r = await readQrImage(file); qrs[key] = r.data; root.querySelector(`[data-m="${key}"] .qr-drop`).innerHTML = `<img src="${r.data}" alt="QR code" class="qr-img">`; f[key + '_enabled'].checked = true;
      if (r.text && /^https:\/\//.test(r.text)) { f[key + '_link'].value = r.text; info.innerHTML = `QR code lu ✓ Lien détecté : <code>${esc(r.text.slice(0, 60))}${r.text.length > 60 ? '…' : ''}</code>`; }
      else info.textContent = r.text ? `QR code lu ✓ (contenu : ${r.text.slice(0, 40)})` : 'Image chargée. Contenu du QR non lu : vérifiez qu\'il est net et bien cadré (l\'image sera quand même affichée).';
      toast('QR code chargé : pensez à enregistrer'); } catch (er) { info.textContent = er.message; } });
  on(root, '[data-rmqr]', 'click', (e) => { const k = e.target.dataset.rmqr; qrs[k] = ''; root.querySelector(`[data-m="${k}"] .qr-drop`).innerHTML = '<div class="qr-empty">QR retiré (enregistrez)</div>'; });
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async (d) => {
    const m = (k) => ({ enabled: d[k + '_enabled'], qr: qrs[k], link: d[k + '_link'], number: d[k + '_number'], name: d[k + '_name'] });
    await api('PUT', '/admin/payment', { mode, wave: m('wave'), orange: m('orange'), instructions: d.instructions, reviewMinutes: +d.reviewMinutes });
    toast(mode === 'QR' ? 'Enregistré : les clients paient maintenant sur vos QR codes' : 'Enregistré (mode démonstration)'); ctx.render(); }); });
  on(root, '[data-ok]', 'click', (e) => confirmSheet('Confirmer ce paiement ?', `Vérifiez d'abord dans votre application que vous avez bien reçu ${fcfa(e.target.dataset.amt)} avec cet ID de transaction. La réservation sera confirmée et la facture émise.`,
    async () => { const r = await api('POST', `/admin/payment-claims/${e.target.dataset.ok}/approve`); toast(r.message || 'Paiement confirmé, client prévenu'); ctx.render(); }, 'Confirmer le paiement', { danger: false }));
  on(root, '[data-no]', 'click', (e) => reasonSheet('Refuser la déclaration', (x) => api('POST', `/admin/payment-claims/${e.target.dataset.no}/reject`, x), { label: 'Motif envoyé au client (ex. transaction introuvable, montant incorrect)', cta: 'Refuser' }));
  on(root, '[data-rf]', 'click', async (e) => { if (await act(() => api('POST', `/admin/payment-claims/${e.target.dataset.rf}/refunded`), 'Remboursement noté')) ctx.render(); });
}

// ---------- Factures ----------
const INVK = { INVOICE: 'Facture', CREDIT_NOTE: 'Avoir', MANUAL: 'Facture manuelle' };
const INVS = { PAID: ['Payée', 'b-green'], DUE: ['À payer', 'b-sun'], CANCELLED: ['Annulée', ''] };
async function invoices(ctx) {
  const u = await guard(ctx); if (!u) return;
  const p = ctx.params;
  const r = await api('GET', '/admin/invoices?' + qs({ kind: p.kind, q: p.q }));
  const T = r.totals;
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Factures</h2><div class="row" style="gap:6px">${exportButtons(['factures'])}<button class="btn btn-primary btn-sm" id="ni">Nouvelle facture</button></div></div>
    <p class="muted small">Chaque paiement génère automatiquement une facture numérotée (FAC-année-n°), chaque remboursement un avoir (AV-…). Vous pouvez aussi établir des factures manuelles (entreprise, transport groupé…). Mise en page : <a href="#/entreprise">Entreprise et facture</a>.</p>
    <div class="grid grid-4">${kpi('Total facturé', fcfa(T.billed))}${kpi('Avoirs', fcfa(Math.abs(T.credited)))}${kpi('Net', fcfa(T.billed + T.credited))}${kpi('À encaisser', fcfa(T.due), 'factures manuelles non payées')}</div>
    <div class="row" style="margin:14px 0 10px">${[['', 'Toutes'], ['INVOICE', 'Réservations'], ['CREDIT_NOTE', 'Avoirs'], ['MANUAL', 'Manuelles']].map(([k, l]) => `<a class="btn btn-ghost btn-sm ${k === (p.kind || '') ? 'on' : ''}" href="#/factures?${qs({ kind: k, q: p.q })}">${l}</a>`).join('')}
      <form id="fq" class="row" style="flex-wrap:nowrap;margin-left:auto"><input name="q" value="${esc(p.q || '')}" placeholder="N°, client, réservation" aria-label="Chercher une facture"><button class="btn btn-ghost btn-sm">OK</button></form></div>
    <div class="table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Type</th><th>Client</th><th>Réservation</th><th>Montant</th><th>TVA</th><th>Statut</th><th></th></tr></thead><tbody>
    ${r.results.map((i) => `<tr><td><strong>${esc(i.number)}</strong></td><td>${fmtDate(i.issued_at)}</td><td>${INVK[i.kind]}</td><td>${esc(i.customer_name || '')}</td><td>${i.booking_ref ? refTag(i.booking_ref) : '—'}</td>
      <td class="tnum ${i.total < 0 ? '' : 'money-in'}">${i.total < 0 ? '− ' : ''}${fcfa(Math.abs(i.total))}</td><td class="tnum">${i.vat_amount ? fcfa(Math.abs(i.vat_amount)) : '—'}</td><td>${i.kind === 'CREDIT_NOTE' ? '<span class="badge b-sky">Avoir</span>' : badge(INVS, i.status)}</td>
      <td style="white-space:nowrap"><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${printUrl('facture', { id: i.id }, 'admin')}">Imprimer</a>${i.kind === 'MANUAL' ? `<select data-st="${i.id}" aria-label="Statut" style="width:auto;display:inline-block;padding:6px 8px;margin-left:4px">${Object.entries(INVS).map(([k, v]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Aucune facture.</td></tr>'}</tbody></table></div>`);
  bindExports(root);
  root.querySelector('#fq').addEventListener('submit', (e) => { e.preventDefault(); go('#/factures?' + qs({ kind: p.kind, q: e.target.q.value })); });
  on(root, '[data-st]', 'change', async (e) => { if (await act(() => api('POST', `/admin/invoices/${e.target.dataset.st}/status`, { status: e.target.value }), 'Statut mis à jour')) ctx.render(); });
  root.querySelector('#ni').onclick = () => manualInvoice(ctx);
}
function manualInvoice(ctx) {
  const lineRow = (l = {}) => `<tr><td><input name="label" value="${esc(l.label || '')}" placeholder="Ex. Transport groupé Dakar → Touba (Magal)" aria-label="Désignation"></td><td style="width:80px"><input name="qty" type="number" min="0" step="0.5" value="${l.qty ?? 1}" aria-label="Quantité"></td><td style="width:130px"><input name="unit" type="number" min="0" value="${l.unit ?? ''}" aria-label="Prix unitaire"></td><td class="tnum lt" style="width:110px"></td><td><button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="Supprimer la ligne">✕</button></td></tr>`;
  sheet(`<form novalidate>${errBox}<h3>Nouvelle facture manuelle</h3>
    <div class="grid grid-2"><div class="field"><label for="m1">Nom du client</label><input id="m1" name="c_name" required></div><div class="field"><label for="m2">Entreprise (facultatif)</label><input id="m2" name="c_company"></div>
      <div class="field"><label for="m3">Téléphone</label><input id="m3" name="c_phone" type="tel"></div><div class="field"><label for="m4">E-mail</label><input id="m4" name="c_email" type="email"></div>
      <div class="field"><label for="m5">Adresse</label><input id="m5" name="c_address"></div><div class="field"><label for="m6">NINEA du client</label><input id="m6" name="c_ninea"></div></div>
    <div class="table-wrap lines-ed"><table><thead><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire</th><th>Montant</th><th></th></tr></thead><tbody id="ln">${lineRow()}</tbody></table></div>
    <div class="row between" style="margin:8px 0 12px"><button type="button" class="btn btn-ghost btn-sm" id="al">+ Ajouter une ligne</button><strong id="tt"></strong></div>
    <div class="grid grid-2"><div class="field"><label for="m7">Statut</label><select id="m7" name="status"><option value="PAID">Payée</option><option value="DUE">À payer</option></select></div><div class="field"><label for="m8">Note sur la facture</label><input id="m8" name="notes" maxlength="500"></div></div>
    <div class="row"><button class="btn btn-primary" type="submit">Créer et imprimer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => {
    const tb = s.querySelector('#ln');
    const lines = () => [...tb.querySelectorAll('tr')].map((tr) => ({ label: tr.querySelector('[name=label]').value.trim(), qty: +tr.querySelector('[name=qty]').value || 0, unit: +tr.querySelector('[name=unit]').value || 0, tr }));
    const upd = () => { let t = 0; for (const l of lines()) { const v = Math.round(l.qty * l.unit); t += v; l.tr.querySelector('.lt').textContent = v ? fcfa(v) : ''; } s.querySelector('#tt').textContent = 'Total : ' + fcfa(t); };
    tb.addEventListener('input', upd); upd();
    s.querySelector('#al').onclick = () => { tb.insertAdjacentHTML('beforeend', lineRow()); upd(); };
    on(tb, '[data-rm]', 'click', (e) => { if (tb.children.length > 1) e.target.closest('tr').remove(); upd(); });
    s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target, d = formData(f);
      submitting(f, async () => {
        const r = await api('POST', '/admin/invoices', { customer: { name: d.c_name, company: d.c_company, phone: d.c_phone, email: d.c_email, address: d.c_address, ninea: d.c_ninea }, lines: lines().map(({ tr, ...l }) => l), status: d.status, notes: d.notes });
        close(); toast(`Facture ${r.number} créée`); window.open(printUrl('facture', { id: r.id }, 'admin'), '_blank'); ctx.render();
      }); });
  });
}

// ---------- Entreprise et designer de facture ----------
const ACCENTS = ['#0B6E4F', '#1F5F99', '#B9472F', '#8A5A00', '#6B3FA0', '#13201C', '#C2185B', '#00838F'];
async function company(ctx) {
  const u = await guard(ctx); if (!u) return;
  const st = await api('GET', '/admin/settings');
  const c = { ...st.settings.company }, ro = isSuper() ? '' : 'disabled';
  const sample = { number: `FAC-${new Date().getFullYear()}-00042`, kind: 'INVOICE', status: 'PAID', issued_at: new Date().toISOString(), total: 12500, vat_amount: 0, vat_rate: 0, notes: '',
    customer: { name: 'Awa Diallo', phone: '+221 77 123 45 67', email: 'awa@exemple.sn' }, booking: { ref: 'RES-2026-00031', provider: 'WAVE', provider_ref: 'SIM-8F2A91' },
    lines: [{ label: 'Transport de passager Dakar → Saint-Louis · 2 place(s) · départ le 12 oct. 2026 à 07:30', qty: 2, unit: 5000, total: 10000 }, { label: 'Envoi « Passeport » Dakar → Saint-Louis · réf. COL-2026-00018', qty: 1, unit: 2500, total: 2500 }] };
  const f = (n, l, v, ph = '', type = 'text') => `<div class="field"><label for="co-${n}">${l}</label><input id="co-${n}" name="${n}" type="${type}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" ${ro}></div>`;
  const root = ctx.set(`<h2>Entreprise et facture</h2><p class="muted small">Ces informations apparaissent sur les factures, avoirs, étiquettes, relevés chauffeurs, et dans les boutons WhatsApp / e-mail des espaces. ${isSuper() ? 'L\'aperçu se met à jour en direct.' : 'Lecture seule : seul le propriétaire modifie ces réglages.'}</p>
    <div class="designer">
      <form class="card" id="cf" novalidate>${errBox}
        <h3>Identité</h3>
        ${f('name', 'Nom commercial', c.name)}${f('legalName', 'Raison sociale', c.legalName, 'Bokk Yoon SARL')}
        <div class="grid grid-2">${f('ninea', 'NINEA', c.ninea)}${f('rccm', 'RCCM', c.rccm, 'SN-DKR-2026-B-…')}</div>
        ${f('address', 'Adresse', c.address, 'Sacré-Cœur 3, Dakar')}
        <h3 style="margin-top:8px">Contact (WhatsApp, e-mail)</h3>
        <div class="grid grid-2">${f('whatsapp', 'Numéro WhatsApp', c.whatsapp, '+221 77 …', 'tel')}${f('phone', 'Téléphone', c.phone, '', 'tel')}</div>
        <div class="grid grid-2">${f('email', 'E-mail', c.email, 'contact@…', 'email')}${f('website', 'Site web', c.website)}</div>
        ${f('hours', 'Horaires du service client', c.hours, 'Tous les jours, 7 h – 22 h')}
        <h3 style="margin-top:8px">Mise en page</h3>
        <div class="field"><label>Modèle</label><div class="pill-nav" id="tpl">${['moderne', 'classique', 'minimal'].map((t) => `<button type="button" class="btn btn-ghost btn-sm ${t === c.template ? 'on' : ''}" data-t="${t}" ${ro}>${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="field"><label>Couleur principale</label><div class="swatches" id="sw">${ACCENTS.map((a) => `<button type="button" style="background:${a}" data-a="${a}" class="${a === c.accent ? 'on' : ''}" aria-label="Couleur ${a}" ${ro}></button>`).join('')}<input type="color" id="acc" value="${esc(c.accent || '#0B6E4F')}" aria-label="Couleur personnalisée" style="width:40px;height:32px;padding:0;border:0" ${ro}></div></div>
        <div class="field"><label for="lg">Logo (PNG, JPEG, SVG · réduit automatiquement)</label><input id="lg" type="file" accept="image/*" ${ro}><div class="row" style="margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" id="rmlogo" ${ro}>Retirer le logo</button></div></div>
        <h3 style="margin-top:8px">Mentions</h3>
        <label class="check small"><input type="checkbox" name="vatEnabled" ${c.vatEnabled ? 'checked' : ''} ${ro}> Appliquer la TVA (prix TTC, TVA incluse)</label>
        <div class="field" style="margin-top:8px"><label for="co-vat">Taux de TVA (%)</label><input id="co-vat" name="vatRate" type="number" min="0" max="30" value="${c.vatRate ?? 18}" ${ro}></div>
        <div class="field"><label for="co-pay">Modalités de paiement</label><input id="co-pay" name="payInfo" value="${esc(c.payInfo || '')}" placeholder="Wave, Orange Money, virement…" ${ro}></div>
        <div class="field"><label for="co-foot">Pied de page</label><textarea id="co-foot" name="footer" rows="2" ${ro}>${esc(c.footer || '')}</textarea></div>
        ${isSuper() ? '<button class="btn btn-primary btn-block" type="submit">Enregistrer</button>' : ''}
      </form>
      <div><div class="row between" style="margin-bottom:8px"><strong>Aperçu</strong><div class="row" style="gap:6px"><button class="btn btn-ghost btn-sm" id="pvp">Imprimer l'aperçu</button><button class="btn btn-ghost btn-sm" id="pvv">Avec TVA / sans TVA</button></div></div>
        <div class="inv-preview"><iframe id="pv" title="Aperçu de la facture" style="width:100%;border:0;display:block;background:transparent"></iframe></div>
        <p class="xs muted" style="margin-top:6px">Facture fictive. Les vraies factures sont numérotées sans trou, par année.</p></div>
    </div>`);
  const form = root.querySelector('#cf'), frame = root.querySelector('#pv');
  let showVat = null;
  const current = () => { const d = formData(form); return { ...c, ...d, vatEnabled: !!d.vatEnabled, vatRate: Number(d.vatRate) || 0 }; };
  const draw = async () => {
    const co = current(), vat = showVat ?? co.vatEnabled, rate = co.vatRate || 18;
    const inv = { ...sample, vat_rate: vat ? rate : 0, vat_amount: vat ? Math.round(sample.total * rate / (100 + rate)) : 0 };
    const html = await renderInvoice(inv, co, {});
    const w = frame.clientWidth || 600, z = Math.min(1, (w - 8) / 800);
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap"><style>${PRINT_CSS} html,body{margin:0;background:transparent} body{zoom:${z}} .inv{box-shadow:0 6px 30px rgb(0 0 0 / .15)} @media print{body{zoom:1}}</style></head><body>${html}</body></html>`;
    frame.style.height = Math.ceil(1125 * z) + 'px';
  };
  let tmr; const soon = () => { clearTimeout(tmr); tmr = setTimeout(draw, 150); };
  form.addEventListener('input', soon);
  root.querySelector('#tpl').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; c.template = b.dataset.t; root.querySelectorAll('#tpl [data-t]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  root.querySelector('#sw').addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; c.accent = b.dataset.a; root.querySelector('#acc').value = c.accent; root.querySelectorAll('#sw [data-a]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  root.querySelector('#acc').addEventListener('input', (e) => { c.accent = e.target.value; root.querySelectorAll('#sw [data-a]').forEach((x) => x.classList.remove('on')); soon(); });
  root.querySelector('#lg').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return;
    try { c.logo = await shrinkImage(file, 480, 180); draw(); toast('Logo chargé : pensez à enregistrer'); } catch (er) { toast(er.message); } });
  root.querySelector('#rmlogo').onclick = () => { c.logo = ''; draw(); };
  root.querySelector('#pvv').onclick = () => { showVat = !(showVat ?? current().vatEnabled); draw(); };
  root.querySelector('#pvp').onclick = () => frame.contentWindow?.print();
  form.addEventListener('submit', (e) => { e.preventDefault(); submitting(form, async () => { await api('PUT', '/admin/company', current()); toast('Entreprise et facture enregistrées'); }); });
  await draw();
}
function shrinkImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') { if (file.size > 150000) return reject(new Error('SVG trop lourd (150 Ko max).')); const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Lecture impossible.')); r.readAsDataURL(file); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { const k = Math.min(1, maxW / img.width, maxH / img.height), cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url); const out = cv.toDataURL('image/png'); if (out.length > 270000) return resolve(cv.toDataURL('image/jpeg', 0.85)); resolve(out); };
    img.onerror = () => reject(new Error('Image illisible.')); img.src = url;
  });
}

// ---------- Calculatrice ----------
function evalExpr(src) {
  const toks = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.').match(/\d+(?:\.\d+)?%?|[-+*/]/g) || [];
  const nums = [], ops = [], prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const apply = () => { const b = nums.pop(), a = nums.pop(), o = ops.pop(); nums.push(o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : a / b); };
  let expectNum = true;
  for (const t of toks) {
    if (/\d/.test(t)) { let v = parseFloat(t); if (t.endsWith('%')) v = ops.length && ['+', '-'].includes(ops[ops.length - 1]) && nums.length ? nums[nums.length - 1] * v / 100 : v / 100; nums.push(v); expectNum = false; }
    else if (expectNum && t === '-') nums.push(0), ops.push('-');
    else { while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) apply(); ops.push(t); expectNum = true; }
  }
  if (expectNum && ops.length) ops.pop();
  while (ops.length) apply();
  const r = nums.pop(); return Number.isFinite(r) ? Math.round(r * 1e6) / 1e6 : NaN;
}
async function calculator(ctx) {
  const u = await guard(ctx); if (!u) return;
  const st = await api('GET', '/admin/settings');
  const P = st.settings.pricing, C = st.settings.company;
  const root = ctx.set(`<h2>Calculatrice</h2><p class="muted small">Simulez un trajet complet, votre marge sur un prix, la TVA, ou faites un calcul rapide.</p>
    <div class="grid grid-2">
      <div class="card"><h3>Rentabilité d'un trajet</h3>
        <div class="grid grid-2"><div class="field"><label for="k1">De</label><select id="k1">${cityOptions('Dakar')}</select></div><div class="field"><label for="k2">À</label><select id="k2">${cityOptions('Touba')}</select></div>
          <div class="field"><label for="k3">Passagers</label><input id="k3" type="number" min="0" max="8" value="3"></div><div class="field"><label for="k4">Colis (≤ 5 kg)</label><input id="k4" type="number" min="0" max="30" value="2"></div></div>
        <div id="trip"></div></div>
      <div class="card"><h3>Marge sur un prix</h3>
        <div class="grid grid-2"><div class="field"><label for="m1">Prix payé par le client</label><input id="m1" type="number" min="0" value="5000"></div><div class="field"><label for="m2">Part chauffeur (%)</label><input id="m2" type="number" min="0" max="100" value="${P.driverSharePct}"></div>
          <div class="field"><label for="m3">Remise promo (%)</label><input id="m3" type="number" min="0" max="100" value="0"></div><div class="field"><label for="m4">Frais de paiement (%)</label><input id="m4" type="number" min="0" max="10" step="0.1" value="1"><div class="hint">Ex. commission Wave / Orange Money</div></div></div>
        <div id="mg"></div></div>
      <div class="card"><h3>TVA</h3><div class="grid grid-2"><div class="field"><label for="v1">Montant</label><input id="v1" type="number" min="0" value="10000"></div><div class="field"><label for="v2">Taux (%)</label><input id="v2" type="number" min="0" max="30" value="${C.vatRate || 18}"></div></div>
        <div class="field"><label for="v3">Le montant est</label><select id="v3"><option value="TTC">TTC (TVA incluse)</option><option value="HT">HT (hors taxe)</option></select></div><div id="vat"></div></div>
      <div class="card"><h3>Calcul rapide</h3>
        <div class="kscreen"><div class="expr" id="ke"></div><div class="val tnum" id="kv">0</div></div>
        <div class="kpad" id="kp">${['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '00', '0', ',', '='].map((k) => `<button type="button" class="${'÷×−+%'.includes(k) ? 'op' : k === '=' ? 'eq' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
        <p class="xs muted" style="margin:8px 0 0">Clavier accepté. « 5000 + 10 % » ajoute 10 % de 5000.</p></div>
    </div>`);
  const $ = (id) => root.querySelector(id), num = (id) => Number($(id).value) || 0;
  const tripCalc = async () => {
    const a = $('#k1').value, b = $('#k2').value, box = $('#trip');
    if (!a || !b || a === b) { box.innerHTML = '<p class="small muted">Choisissez deux villes.</p>'; return; }
    const q = await api('GET', '/admin/quote?' + qs({ from: a, to: b })), s = num('#k3'), p = num('#k4');
    const ca = s * q.clientSeat + p * q.clientParcel, dr = s * q.driverSeat + p * q.driverParcel;
    box.innerHTML = `<p class="small muted">${q.distanceKm} km · ~${fmtDur(q.durationMin)} · ${q.source === 'grille' ? 'grille par axe' : 'formule au km'}</p>
      <div class="table-wrap"><table><tbody><tr><td>Encaissé auprès des clients</td><td class="tnum" style="text-align:right"><strong>${fcfa(ca)}</strong></td></tr><tr><td>À verser au chauffeur</td><td class="tnum" style="text-align:right">${fcfa(dr)}</td></tr>
      <tr><td><strong>Marge Bokk Yoon</strong></td><td class="tnum money-in" style="text-align:right"><strong>${fcfa(ca - dr)}</strong></td></tr><tr><td class="small muted">Taux de marge</td><td class="small muted" style="text-align:right">${ca ? Math.round(((ca - dr) / ca) * 100) : 0} %</td></tr></tbody></table></div>`;
  };
  const marginCalc = () => {
    const price = num('#m1'), paid = Math.round(price * (1 - num('#m3') / 100)), drv = Math.round(price * num('#m2') / 100), fee = Math.round(paid * num('#m4') / 100), mg = paid - drv - fee;
    $('#mg').innerHTML = `<div class="table-wrap"><table><tbody><tr><td>Le client paie</td><td class="tnum" style="text-align:right">${fcfa(paid)}</td></tr><tr><td>Part chauffeur (sur le prix catalogue)</td><td class="tnum" style="text-align:right">− ${fcfa(drv)}</td></tr>
      <tr><td>Frais de paiement</td><td class="tnum" style="text-align:right">− ${fcfa(fee)}</td></tr><tr><td><strong>Votre marge nette</strong></td><td class="tnum ${mg >= 0 ? 'money-in' : ''}" style="text-align:right;${mg < 0 ? 'color:var(--terra)' : ''}"><strong>${fcfa(mg)}</strong></td></tr></tbody></table></div>${mg < 0 ? '<div class="error small" style="margin-top:8px">Marge négative : baissez la remise ou la part chauffeur.</div>' : ''}`;
  };
  const vatCalc = () => { const v = num('#v1'), r = num('#v2'), ttc = $('#v3').value === 'TTC' ? v : Math.round(v * (1 + r / 100)), ht = $('#v3').value === 'TTC' ? Math.round(v / (1 + r / 100)) : v;
    $('#vat').innerHTML = `<div class="row between small"><span>HT</span><strong class="tnum">${fcfa(ht)}</strong></div><div class="row between small"><span>TVA ${r} %</span><strong class="tnum">${fcfa(ttc - ht)}</strong></div><div class="row between"><span>TTC</span><strong class="tnum">${fcfa(ttc)}</strong></div>`; };
  ['#k1', '#k2', '#k3', '#k4'].forEach((i) => $(i).addEventListener('input', tripCalc));
  ['#m1', '#m2', '#m3', '#m4'].forEach((i) => $(i).addEventListener('input', marginCalc));
  ['#v1', '#v2', '#v3'].forEach((i) => $(i).addEventListener('input', vatCalc));
  tripCalc(); marginCalc(); vatCalc();
  let expr = '';
  const show = () => { $('#ke').textContent = expr; const r = evalExpr(expr); $('#kv').textContent = expr ? (Number.isNaN(r) ? '…' : r.toLocaleString('fr-FR', { maximumFractionDigits: 4 })) : '0'; };
  const press = (k) => {
    if (k === 'C') expr = ''; else if (k === '⌫') expr = expr.slice(0, -1);
    else if (k === '=') { const r = evalExpr(expr); if (!Number.isNaN(r)) expr = String(r).replace('.', ','); }
    else if ('÷×−+'.includes(k)) { expr = expr.replace(/[÷×−+]$/, '') + k; } else expr += k;
    show();
  };
  $('#kp').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  const keymap = { '*': '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', '.': ',', ',': ',', '%': '%' };
  const kh = (e) => { if (e.target.matches('input, select, textarea')) return; const k = /^\d$/.test(e.key) ? e.key : keymap[e.key]; if (k) { e.preventDefault(); press(k); } };
  document.addEventListener('keydown', kh); ctx.cleanup(() => document.removeEventListener('keydown', kh));
}

// ---------- Carte du Sénégal (régions, départements, arrondissements) ----------
async function territory(ctx) {
  const u = await guard(ctx); if (!u) return;
  const rg = (await api('GET', '/admin/regions')).results;
  const METRICS = { none: ['Couleurs des régions', null], bookings: ['Réservations payées', 'réservations'], revenue: ['Chiffre d\'affaires (FCFA)', 'FCFA encaissés'], trips: ['Trajets ouverts (départ)', 'trajets ouverts'], drivers: ['Chauffeurs validés', 'chauffeurs'] };
  const mk = ctx.params.m && METRICS[ctx.params.m] ? ctx.params.m : 'none';
  const root = ctx.set(`<h2>Carte du Sénégal</h2><p class="muted small">14 régions, 45 départements et 121 arrondissements (limites officielles, Gouvernement du Sénégal / OCHA). Choisissez le découpage en haut à droite de la carte, et l'indicateur ci-dessous.</p>
    <div class="row" style="margin:10px 0">${Object.entries(METRICS).map(([k, [l]]) => `<a class="btn btn-ghost btn-sm ${k === mk ? 'on' : ''}" href="#/territoire?m=${k}">${l}</a>`).join('')}</div>
    <div id="tmap"></div>
    <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Région</th><th>Réservations</th><th>Chiffre d'affaires</th><th>Trajets ouverts</th><th>Chauffeurs</th></tr></thead><tbody>
      ${rg.sort((a, b) => b.bookings - a.bookings || a.region.localeCompare(b.region)).map((x) => `<tr><td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${REGION_COLORS[x.region]};margin-right:8px;vertical-align:-1px"></span><strong>${esc(x.region)}</strong></td><td class="tnum">${x.bookings}</td><td class="tnum">${fcfa(x.revenue)}</td><td class="tnum">${x.trips}</td><td class="tnum">${x.drivers}</td></tr>`).join('')}</tbody></table></div>`);
  const values = METRICS[mk][1] ? Object.fromEntries(rg.map((x) => [x.region, x[mk]])) : null;
  const m = await createMap(root.querySelector('#tmap'), { height: 560, cities: 'all', switcher: true, values, valueLabel: METRICS[mk][1] || '' });
  if (m) ctx.cleanup(() => m.destroy());
}

const router = createRouter(view, [
  [/^\/?$/, dash, 'dash'], [/^\/direct$/, live, 'live'],
  [/^\/chauffeurs$/, (c) => members(c, 'driver'), 'drivers'], [/^\/clients$/, (c) => members(c, 'client'), 'clients'], [/^\/membre\/([\w-]+)$/, member, 'drivers'],
  [/^\/reservations$/, bookings, 'bookings'], [/^\/trajets$/, trips, 'trips'], [/^\/litiges$/, issues, 'issues'], [/^\/paiements$/, payouts, 'payouts'],
  [/^\/tarifs$/, pricing, 'pricing'], [/^\/actualites$/, news, 'news'], [/^\/equipe$/, team, 'team'], [/^\/journal$/, journal, 'log'],
  [/^\/recherche$/, searchPage, ''], [/^\/messages$/, inbox, 'msg'], [/^\/messages\/([\w-]+)$/, ticketAdmin, 'msg'], [/^\/retours$/, feedbackPage, 'fb'],
  [/^\/factures$/, invoices, 'inv'], [/^\/entreprise$/, company, 'company'], [/^\/promotions$/, promos, 'promo'], [/^\/calculatrice$/, calculator, 'calc'], [/^\/territoire$/, territory, 'map'], [/^\/encaissements$/, cashPage, 'cash'],
], { onRoute: (k) => { const n = document.getElementById('side'); n.dataset.active = k; n.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.k === k)); } });
(async () => {
  await bootSpace('admin'); router.render();
  const poll = async () => { if (!me) return; try {
    const [r, c] = await Promise.all([api('GET', '/admin/tickets?status=OPEN'), api('GET', '/admin/payment-claims?status=PENDING')]);
    if (r.results.length !== openTickets || c.results.length !== pendingClaims) { openTickets = r.results.length; pendingClaims = c.results.length; renderNav(); }
  } catch { /* hors ligne */ } };
  setTimeout(poll, 1500); setInterval(poll, 60000);
})();
