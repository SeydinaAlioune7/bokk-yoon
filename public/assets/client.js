// Bokk Yoon — espace client (voyageurs et expéditeurs).
import {
  fmtDur, api, token, resetDemo, esc, fmtDay, fmtTime, fmtDT, fmtDate, ago, today, addDays, initials, catLabel, qs, stars, fcfa, cityOptions,
  toast, sheet, formData, errBox, submitting, on, act, BOOKING, PACKAGE, TRIP, PROVIDERS, badge, routeHtml, personHtml, confirmSheet,
  createRouter, loginScreen, mountBell, renderNews, articlePage, renderAlerts, locateMe, bootSpace, toggleTheme, newsCat,
  helpPage, ticketPage, contactButtons, printUrl, refTag, getCompany, waLink, ICONS, qrSrc,
} from './ui.js';
import { CATEGORIES, FORBIDDEN, LIMITS, cityByName } from './core.js';
import { createMap } from './map.js';

const view = document.getElementById('view');
const CALC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2"/></svg>';
let me = null;
const go = (h) => { if (location.hash === h) router.render(); else location.hash = h; };

async function loadMe(force) {
  if (!token.get()) return (me = null);
  if (me && !force) return me;
  try { me = await api('GET', '/me'); } catch { me = null; }
  return me;
}
async function needLogin(ctx) {
  const u = await loadMe(true);
  if (u) return u;
  loginScreen(ctx.set, 'client', { demoHint: 'Démo : essayez un nouveau numéro, ou le client de démonstration 70 000 00 11.', onDone: async () => { await loadMe(true); bell.refresh(); ctx.render(); } });
  return null;
}

// ---------- Accueil ----------
async function home(ctx) {
  const u = await loadMe();
  const root = ctx.set(`
    <div class="welcome"><p class="small" style="margin:0;font-weight:700;color:var(--primary)">${u ? 'Na nga def, ' + esc(u.name.split(' ')[0]) + ' !' : 'Dalal ak jàmm · Bienvenue'}</p>
      <h1>Où allez-vous aujourd'hui ?</h1><p class="small muted" style="margin:6px 0 0">Prix fixe annoncé avant de payer. Chauffeurs vérifiés par Bokk Yoon.</p></div>
    <div id="alerts" class="stack" style="margin-top:12px" hidden></div>
    <div class="tiles" style="margin-top:14px">
      <a class="tile t1" href="#/recherche"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14l-1.5-6a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/></svg><strong>Je voyage</strong><span class="small">Réserver une place</span></a>
      <a class="tile t2" href="#/colis/nouveau"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg><strong>J'envoie un colis</strong><span class="small">Colis, passeport, enveloppe…</span></a>
    </div>
    <div class="row" style="margin-top:10px;gap:10px;flex-wrap:nowrap">
      <a class="card card-link row" href="#/calculer" style="flex:1;gap:10px;flex-wrap:nowrap;padding:12px 14px"><span class="mini-ico">${CALC_ICON}</span><span><strong>Calculer un prix</strong><br><span class="xs muted">Place, colis, passeport</span></span></a>
      <a class="card card-link row" href="#/aide" style="flex:1;gap:10px;flex-wrap:nowrap;padding:12px 14px"><span class="mini-ico">${ICONS.wa}</span><span><strong>Aide et contact</strong><br><span class="xs muted">WhatsApp, e-mail</span></span></a>
    </div>
    <div id="todo"></div>
    <h3 style="margin-top:24px">Trajets ouverts cette semaine</h3>
    <div id="netmap"></div><p class="xs muted" id="netcap" style="margin-top:6px"></p>
    <div class="row between" style="margin-top:24px"><h3 style="margin:0">Actualités</h3><a class="small" href="#/actualites">Tout voir</a></div>
    <div id="news" class="stack" style="margin-top:10px"></div>
    <a class="card card-link row between" href="../chauffeur/" style="margin-top:24px"><span><strong>Vous avez une voiture ?</strong><br><span class="small muted">Devenez chauffeur partenaire et gagnez sur vos trajets.</span></span><span class="badge b-sun">Espace chauffeur →</span></a>`);
  renderAlerts(root.querySelector('#alerts'), u?.city ? [u.city, 'Dakar'] : null);
  renderNews(root.querySelector('#news'), { audience: 'CLIENTS', limit: 3 });
  if (u) {
    const [bk, pk] = await Promise.all([api('GET', '/client/bookings'), api('GET', '/client/packages')]);
    const items = [];
    for (const b of bk.results) {
      if (b.status === 'PENDING_PAYMENT') items.push(['Paiement en attente', `${esc(b.from)} → ${esc(b.to)} · ${fcfa(b.price)} · expire ${ago(b.expiresAt).replace('il y a', 'dans')}`, '#/reservation/' + b.id, 'b-sun', 'Payer']);
      if (b.status === 'PAID') items.push([b.kind === 'PARCEL' ? 'Code à donner au chauffeur' : 'Votre code d\'embarquement', `${esc(b.from)} → ${esc(b.to)} · ${fmtDT(b.departureAt)}`, '#/reservation/' + b.id, 'b-green', 'Voir']);
      if (b.status === 'IN_PROGRESS') items.push([b.kind === 'PARCEL' ? 'Colis en route' : 'Trajet en cours', `${esc(b.from)} → ${esc(b.to)} · suivre en direct`, '#/reservation/' + b.id, 'b-sky', 'Suivre']);
      if (b.status === 'COMPLETED' && Date.now() - new Date(b.updatedAt) < 3 * 86400000) items.push(['Donnez votre avis', `${esc(b.from)} → ${esc(b.to)} avec ${esc(b.driverName)}`, '#/reservation/' + b.id, '', 'Noter']);
    }
    for (const p of pk.results.filter((x) => x.status === 'CREATED').slice(0, 2)) items.push([`Colis ${esc(p.origin)} → ${esc(p.dest)}`, 'Choisissez un trajet compatible', '#/colis/' + p.id, 'b-sun', 'Trouver']);
    if (items.length) root.querySelector('#todo').innerHTML = `<h3 style="margin-top:24px">À faire</h3><div class="stack">${items.slice(0, 6).map(([t, s, h, c, cta]) =>
      `<a class="card card-link row between" href="${h}" style="flex-wrap:nowrap"><span style="min-width:0"><strong>${t}</strong><br><span class="small muted">${s}</span></span><span class="badge ${c}">${cta}</span></a>`).join('')}</div>`;
  }
  const cov = await api('GET', '/coverage');
  const m = await createMap(root.querySelector('#netmap'), { height: 300 });
  if (m) {
    ctx.cleanup(() => m.destroy());
    for (const c of cov.corridors) { const a = cityByName(c.origin), b = cityByName(c.dest); if (a && b) m.route(a, b, { weight: 2 + Math.min(4, c.n) }); }
    root.querySelector('#netcap').textContent = `${cov.tripsOpen} trajet(s) ouverts sur ${cov.corridors.length} axe(s). Tracés à vol d'oiseau.`;
  }
}

// ---------- Recherche ----------
async function search(ctx) {
  const p = ctx.params;
  const root = ctx.set(`<h2>Trouver un trajet</h2>
    <form class="card" id="sf"><div class="grid grid-2">
      <div class="field"><label for="from">Départ</label><select id="from" name="from" required>${cityOptions(p.from || 'Dakar')}</select>
        <button type="button" class="btn btn-ghost btn-sm" id="loc" style="margin-top:8px">Me localiser</button></div>
      <div class="field"><label for="to">Arrivée</label><select id="to" name="to" required>${cityOptions(p.to || 'Thiès')}</select></div>
      <div class="field"><label for="date">Date</label><input id="date" type="date" name="date" min="${today()}" value="${esc(p.date || '')}"><div class="hint">Laisser vide : toutes les dates</div></div>
      <div class="field"><label for="seats">Places</label><select id="seats" name="seats">${[1, 2, 3, 4].map((n) => `<option ${String(n) === (p.seats || '1') ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div><button class="btn btn-primary btn-block" type="submit">Rechercher</button></form>
    <div id="alerts" class="stack" style="margin-top:12px" hidden></div>
    <div id="results" style="margin-top:16px"></div>`);
  const f = root.querySelector('#sf');
  root.querySelector('#loc').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = 'Localisation…';
    try { const r = await locateMe(); f.from.value = r.city.name; toast(`Ville la plus proche : ${r.city.name} (${Math.round(r.distanceKm)} km)`); }
    catch (er) { toast(er.message, 4000); } finally { e.target.disabled = false; e.target.textContent = 'Me localiser'; }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); go('#/recherche?' + qs({ ...formData(f), run: 1 })); });
  const out = root.querySelector('#results');
  if (!p.run) { out.innerHTML = '<p class="muted small">Un trajet Dakar → Saint-Louis passe par Thiès et Louga : il apparaît aussi si vous cherchez Thiès → Louga.</p>'; return; }
  renderAlerts(root.querySelector('#alerts'), [p.from, p.to]);
  try {
    const r = await api('GET', '/trips/search?' + qs({ from: p.from, to: p.to, date: p.date, seats: p.seats }));
    out.innerHTML = `<div class="row between"><p class="muted small" style="margin:0">${r.results.length} trajet(s)</p><span class="small">Prix fixe : <strong>${fcfa(r.pricePerSeat)}</strong> / place</span></div>` +
      (r.results.length ? `<div class="stack" style="margin-top:10px">${r.results.map((t) => `
      <a class="card card-link" href="#/trajet/${t.id}?${qs({ from: p.from, to: p.to, seats: p.seats })}">
        <div class="row between"><strong style="font-size:1.25rem">${fmtTime(t.exact ? t.departureAt : t.passAt)}</strong><strong>${fcfa(t.price)}</strong></div>
        <div class="small muted">${fmtDay(t.departureAt)} · ${t.seatsLeft} place(s) libre(s)${t.exact ? '' : ` · passe par ${esc(p.from)} vers ${fmtTime(t.passAt)}`}</div>
        <div style="margin:10px 0">${routeHtml(t.origin, t.dest)}</div>
        <div class="row small" style="gap:8px"><span class="avatar" style="width:30px;height:30px;font-size:.75rem">${esc(initials(t.driver.name))}</span>${esc(t.driver.name)} · ${stars(t.driver.stats.ratingAvg, t.driver.stats.ratingCount)}${t.driver.verified ? ' · <span class="badge b-green">Vérifié</span>' : ''}</div>
      </a>`).join('')}</div>` : `<div class="empty card" style="margin-top:10px"><strong>Aucun trajet pour l'instant</strong><p class="small">Envoyez un colis quand même : il sera proposé dès qu'un chauffeur publie un trajet sur votre axe.</p><a class="btn btn-ghost" href="#/colis/nouveau?${qs({ from: p.from, to: p.to })}">Publier un colis</a></div>`);
  } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
}

// ---------- Détail d'un trajet ----------
async function tripPage(ctx, id) {
  const p = ctx.params;
  const t = await api('GET', `/trips/${id}?${qs({ from: p.from, to: p.to })}`);
  const u = await loadMe();
  const canBook = t.status === 'PUBLISHED' && t.seatsLeft > 0 && new Date(t.departureAt) > new Date();
  const root = ctx.set(`<a href="javascript:history.back()" class="small">← Retour</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${esc(t.from)} → ${esc(t.to)}</h2>${badge(TRIP, t.status)}</div>
    <p class="muted">${fmtDay(t.departureAt)} · départ de ${esc(t.origin)} à ${fmtTime(t.departureAt)} · ${t.distanceKm} km · ~${fmtDur(t.durationMin)}</p>
    <div id="map"></div>
    <div class="card stack" style="margin-top:12px">
      ${routeHtml(t.origin, t.dest, fmtTime(t.departureAt), fmtTime(new Date(new Date(t.departureAt).getTime() + t.durationMin * 60000).toISOString()))}
      ${t.meetingPoint ? `<p class="small" style="margin:0"><strong>Rendez-vous :</strong> ${esc(t.meetingPoint)}</p>` : ''}
      <div class="grid grid-2 small"><div><strong class="kpi-sm">${fcfa(t.pricePerSeat)}</strong> / place<br><span class="muted">${t.seatsLeft} sur ${t.seatsTotal} disponibles</span></div>
        <div><strong class="kpi-sm">dès ${fcfa(t.parcelFrom)}</strong> / colis<br><span class="muted">${t.parcelKgLeft} kg disponibles</span></div></div>
      <p class="small muted" style="margin:0">Véhicule : ${esc(t.vehicle)} · colis acceptés : ${t.categories.map(catLabel).map(esc).join(', ')}</p>
      ${t.notes ? `<p class="small" style="margin:0">« ${esc(t.notes)} »</p>` : ''}
    </div>
    <h3 style="margin-top:20px">Chauffeur</h3><div class="card">${personHtml(t.driver, '', '#/membre/' + t.driver.id)}</div>
    <div id="actions" style="margin-top:20px"></div>`);
  const m = await createMap(root.querySelector('#map'), { height: 240, interactive: true });
  if (m) { ctx.cleanup(() => m.destroy()); m.route(t.originPos, t.destPos, { dashed: false }); m.marker(t.originPos, 'start', esc(t.origin)); m.marker(t.destPos, 'end', esc(t.dest)); m.fit([t.originPos, t.destPos]); }
  const act_ = root.querySelector('#actions');
  if (!canBook) { act_.innerHTML = '<div class="notice">Ce trajet n\'accepte plus de réservation.</div>'; return; }
  act_.innerHTML = `<form class="card" id="bf" novalidate>${errBox}<div class="row between"><label for="s" style="margin:0">Nombre de places</label>
    <select id="s" name="seats" style="width:100px">${Array.from({ length: Math.min(4, t.seatsLeft) }, (_, i) => `<option ${String(i + 1) === (p.seats || '1') ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
    <p class="small" id="price-line" style="margin:12px 0"></p>
    <button class="btn btn-primary btn-block" type="submit">${u ? 'Réserver et payer' : 'Se connecter pour réserver'}</button>
    <a class="btn btn-ghost btn-block" style="margin-top:8px" href="#/colis/nouveau?${qs({ from: t.from, to: t.to })}">Envoyer un colis sur cet axe</a></form>`;
  const f = act_.querySelector('#bf');
  const upd = () => { f.querySelector('#price-line').innerHTML = `Total : <strong>${fcfa(t.pricePerSeat * Number(f.seats.value))}</strong>. Paiement immédiat par Wave, Orange Money, Free Money ou carte. Remboursé si le chauffeur annule.`; };
  f.seats.addEventListener('change', upd); upd();
  f.addEventListener('submit', (e) => { e.preventDefault(); if (!u) return go('#/connexion?next=' + encodeURIComponent(location.hash));
    submitting(f, async (d) => { const r = await api('POST', '/client/bookings', { kind: 'SEAT', tripId: t.id, seats: Number(d.seats), from: t.from, to: t.to }); go('#/reservation/' + r.id + '?pay=1'); }); });
}

// ---------- Colis ----------
async function newPackage(ctx) {
  const u = await needLogin(ctx); if (!u) return;
  const p = ctx.params, t0 = today();
  const types = (await api('GET', '/parcel-types')).results;
  const t1 = types.find((x) => x.code === p.type) || types[0];
  const root = ctx.set(`<h2>Envoyer un colis</h2><p class="muted small">Colis au poids jusqu'à ${LIMITS.parcelMaxKg} kg, ou envoi à prix forfaitaire (passeport, enveloppe, clés…). Prix fixe affiché avant paiement.</p>
    <form class="card" id="pf" novalidate>${errBox}
      <fieldset class="type-cards" style="border:0;padding:0;margin:0 0 14px"><legend class="small" style="font-weight:700;margin-bottom:8px">Que voulez-vous envoyer ?</legend>
        ${types.map((x) => `<label class="type-card"><input type="radio" name="type" value="${esc(x.code)}" ${x.code === t1.code ? 'checked' : ''}><span><strong>${esc(x.label)}</strong><span class="xs muted">${x.mode === 'FLAT' ? 'Prix forfaitaire · sans pesée' : 'Prix selon le poids'}</span>${x.description ? `<span class="xs">${esc(x.description)}</span>` : ''}</span></label>`).join('')}
      </fieldset>
      <div class="notice small" id="idnote" hidden style="margin-bottom:14px"><strong>Document d'identité :</strong> le chauffeur vérifie l'enveloppe fermée et le destinataire présente une pièce au nom indiqué avant de donner son code. Envoyez uniquement vos propres documents ou ceux d'un proche qui vous l'a demandé.</div>
      <div class="grid grid-2">
        <div class="field"><label for="o">Ville de départ</label><select id="o" name="origin" required>${cityOptions(p.from || u.city || 'Dakar')}</select></div>
        <div class="field"><label for="d">Ville d'arrivée</label><select id="d" name="dest" required>${cityOptions(p.to || 'Thiès')}</select></div>
        <div class="field"><label for="df">Disponible à partir du</label><input id="df" type="date" name="dateFrom" value="${t0}" min="${t0}"></div>
        <div class="field"><label for="dt">À livrer au plus tard le</label><input id="dt" type="date" name="dateTo" value="${addDays(t0, 5)}" min="${t0}"></div>
      </div>
      <div id="weightbox">
      <div class="field"><label for="c">Contenu</label><select id="c" name="category">${CATEGORIES.map((c) => `<option value="${c.code}" ${c.code === 'vetements' ? 'selected' : ''}>${esc(c.label)} (max ${c.maxKg} kg)</option>`).join('')}</select></div>
      <div class="grid grid-4">
        <div class="field"><label for="w">Poids (kg)</label><input id="w" type="number" name="weightKg" step="0.1" min="0.1" max="${LIMITS.parcelMaxKg}" value="3" inputmode="decimal"></div>
        <div class="field"><label for="l">Long. (cm)</label><input id="l" type="number" name="lengthCm" value="40" min="1" inputmode="numeric"></div>
        <div class="field"><label for="la">Larg. (cm)</label><input id="la" type="number" name="widthCm" value="30" min="1" inputmode="numeric"></div>
        <div class="field"><label for="h">Haut. (cm)</label><input id="h" type="number" name="heightCm" value="20" min="1" inputmode="numeric"></div>
      </div></div>
      <div class="notice small" id="est" style="margin-bottom:14px">Calcul du prix…</div>
      <div class="grid grid-2">
        <div class="field"><label for="val">Valeur déclarée (FCFA)</label><input id="val" type="number" name="declaredValue" min="0" max="${LIMITS.parcelMaxValue}" value="10000" inputmode="numeric"><div class="hint">Base d'indemnisation en cas de litige.</div></div>
        <div class="field"><label for="ph">Photo du colis</label><input id="ph" type="file" accept="image/*" capture="environment"><div class="hint">Le chauffeur la voit avant l'enlèvement.</div></div>
      </div>
      <div class="field"><label for="desc">Description</label><input id="desc" name="description" maxlength="300" placeholder="Ex. 2 boubous dans un sac fermé"></div>
      <div class="row small" style="margin-bottom:14px"><label class="check"><input type="checkbox" name="fragile"> Fragile</label><label class="check"><input type="checkbox" name="urgent"> Urgent</label></div>
      <h3>Destinataire</h3>
      <div class="grid grid-2">
        <div class="field"><label for="rn">Nom</label><input id="rn" name="recipientName" required maxlength="60"></div>
        <div class="field"><label for="rp">Téléphone</label><input id="rp" name="recipientPhone" type="tel" inputmode="tel" placeholder="77 123 45 67" required><div class="hint">Il reçoit par SMS le suivi et son code de réception.</div></div>
      </div>
      <details class="notice small" style="margin-bottom:12px"><summary><strong>Objets interdits</strong></summary><ul style="margin:8px 0 0;padding-left:18px">${FORBIDDEN.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
      <label class="check small"><input type="checkbox" name="acceptRules"> Je certifie que le colis ne contient aucun objet interdit et j'accepte que le chauffeur le vérifie à l'enlèvement.</label>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px">Voir les trajets compatibles</button>
    </form>`);
  const f = root.querySelector('#pf');
  const curType = () => types.find((x) => x.code === f.type.value) || t1;
  const syncType = () => {
    const ty = curType(), flat = ty.mode === 'FLAT';
    root.querySelector('#weightbox').hidden = flat;
    root.querySelector('#idnote').hidden = !ty.idCheck;
    f.fragile.closest('.row').hidden = flat;
    if (flat && !f.description.value) f.description.placeholder = `Ex. ${ty.label.toLowerCase()} dans une enveloppe fermée`;
  };
  const est = async () => {
    if (!f.origin.value || !f.dest.value || f.origin.value === f.dest.value) { root.querySelector('#est').textContent = 'Choisissez deux villes différentes.'; return; }
    try {
      const q = await api('GET', '/quote?' + qs({ from: f.origin.value, to: f.dest.value, weightKg: f.weightKg.value, type: f.type.value }));
      root.querySelector('#est').innerHTML = q.type.mode === 'FLAT' ? `Prix forfaitaire « ${esc(q.type.label)} » : <strong>${fcfa(q.parcel)}</strong> (${q.distanceKm} km, sans pesée).` : `Prix fixe Bokk Yoon : <strong>${fcfa(q.parcel)}</strong> pour ${String(q.weightKg).replace('.', ',')} kg (${q.distanceKm} km).`;
    } catch { /* ignore */ }
  };
  ['origin', 'dest', 'weightKg'].forEach((n) => f[n].addEventListener('change', est));
  f.querySelectorAll('[name=type]').forEach((r) => r.addEventListener('change', () => { syncType(); est(); }));
  syncType(); est();
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async (d) => {
    const r = await api('POST', '/client/packages', { ...d, weightKg: Number(d.weightKg), lengthCm: Number(d.lengthCm), widthCm: Number(d.widthCm), heightCm: Number(d.heightCm), declaredValue: Number(d.declaredValue) });
    go('#/colis/' + r.id);
  }); });
}

async function packagePage(ctx, id) {
  const u = await needLogin(ctx); if (!u) return;
  const pk = await api('GET', '/client/packages/' + id);
  const root = ctx.set(`<a href="#/activite?tab=colis" class="small">← Mes colis</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${esc(pk.typeLabel || 'Colis')} ${esc(pk.origin)} → ${esc(pk.dest)}</h2>${badge(PACKAGE, pk.status)}</div>
    <p class="muted small">${refTag(pk.ref)} · ${pk.typeMode === 'FLAT' ? 'forfait sans pesée' : `${String(pk.weightKg).replace('.', ',')} kg · ${pk.dims.join(' × ')} cm · ${esc(catLabel(pk.category))}`} · avant le ${fmtDate(pk.dateTo + 'T12:00:00Z')} · pour ${esc(pk.recipientName)} (${esc(pk.recipientPhone)})</p>
    <div class="card row between"><span>Prix fixe du transport</span><strong class="kpi-sm">${fcfa(pk.price)}</strong></div>
    ${pk.bookingId ? `<a class="btn btn-primary btn-block" style="margin-top:12px" href="#/reservation/${pk.bookingId}">Voir la réservation</a>` : ''}
    <div id="matches" style="margin-top:16px"></div>
    ${pk.status === 'CREATED' ? '<button class="btn btn-danger btn-sm" id="cx" style="margin-top:16px">Annuler ce colis</button>' : ''}`);
  root.querySelector('#cx')?.addEventListener('click', () => confirmSheet('Annuler ce colis ?', 'Il ne sera plus proposé aux chauffeurs.', async () => { await api('POST', `/client/packages/${id}/cancel`); toast('Colis annulé'); go('#/activite?tab=colis'); }));
  if (pk.status !== 'CREATED') return;
  const box = root.querySelector('#matches'); box.innerHTML = '<div class="skeleton"></div>';
  const m = await api('GET', `/client/packages/${id}/matches`);
  const labels = { geographic: 'Proximité de l\'axe', temporal: 'Horaire', capacity: 'Place disponible', detour: 'Détour faible', reliability: 'Fiabilité', reputation: 'Réputation', urgency: 'Urgence', risk: 'Risque (soustrait)' };
  const card = (c) => `<div class="card">
    <div class="row between"><span class="badge ${c.level === 'Très compatible' ? 'b-green' : c.level === 'Compatible' ? 'b-sky' : 'b-sun'}">${c.level}</span><span class="small muted">départ ${fmtDT(c.trip.departureAt)}</span></div>
    <div style="margin:10px 0">${routeHtml(c.trip.origin, c.trip.dest)}</div>
    <p class="small" style="margin:0 0 10px">Passe par ${esc(pk.origin)} vers <strong>${fmtTime(c.passAt)}</strong> · arrivée estimée ${fmtDT(c.arriveAt)} · détour ${String(c.detourKm).replace('.', ',')} km</p>
    ${personHtml(c.driver)}
    <details class="small" style="margin-top:10px"><summary>Pourquoi ce classement ? (score ${Math.round(c.score * 100)} %)</summary>
      <p class="xs muted" style="margin:8px 0">Recommandation algorithmique, pas une garantie.</p>
      ${Object.entries(c.breakdown).map(([k, v]) => `<div class="row between xs" style="gap:8px;flex-wrap:nowrap"><span style="width:130px;flex:none">${labels[k]}</span><span class="meter" style="flex:1"><span style="width:${Math.round(v * 100)}%;${k === 'risk' ? 'background:var(--terra)' : ''}"></span></span></div>`).join('')}
    </details>
    <button class="btn btn-primary btn-block" data-book="${c.trip.id}" style="margin-top:12px">Choisir ce trajet · ${fcfa(m.price)}</button></div>`;
  box.innerHTML = `<h3>Trajets compatibles</h3><p class="xs muted">${m.evaluated} trajet(s) analysé(s) · ${m.rejected} écarté(s) (sens, capacité, dates, détour)</p>
    <div id="mmap" style="margin-bottom:12px"></div>
    ${m.top.length ? `<div class="stack">${m.top.map(card).join('')}</div>` : '<div class="card empty"><strong>Pas encore de trajet très compatible</strong><p class="small">Vous serez prévenu dès qu\'un chauffeur publie un trajet sur votre axe.</p></div>'}
    ${m.alternatives.length ? `<h3 style="margin-top:20px">Alternatives</h3><div class="stack">${m.alternatives.map(card).join('')}</div>` : ''}`;
  const all = [...m.top, ...m.alternatives];
  const mp = await createMap(box.querySelector('#mmap'), { height: 220 });
  if (mp) {
    ctx.cleanup(() => mp.destroy());
    const A = cityByName(pk.origin), B = cityByName(pk.dest);
    all.forEach((c) => mp.route(c.trip.originPos, c.trip.destPos, { color: '#8a9a94', weight: 2 }));
    mp.route(A, B, { dashed: false, weight: 4 }); mp.marker(A, 'start', esc(pk.origin)); mp.marker(B, 'end', esc(pk.dest)); mp.fit([A, B, ...all.flatMap((c) => [c.trip.originPos, c.trip.destPos])]);
  }
  on(box, '[data-book]', 'click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('POST', '/client/bookings', { kind: 'PARCEL', tripId: e.target.dataset.book, packageId: id }); go('#/reservation/' + r.id + '?pay=1'); }
    catch (er) { toast(er.message); e.target.disabled = false; }
  });
}

// ---------- Réservation ----------
async function bookingPage(ctx, id) {
  const u = await needLogin(ctx); if (!u) return;
  const b = await api('GET', '/client/bookings/' + id);
  const parcel = b.kind === 'PARCEL', t = b.trip;
  const order = ['PENDING_PAYMENT', 'PAID', 'IN_PROGRESS', 'COMPLETED'];
  const steps = parcel ? ['Réservé', 'Payé et confirmé', 'Pris en charge', 'Livré'] : ['Réservé', 'Payé et confirmé', 'À bord', 'Arrivé'];
  const idx = order.indexOf(b.status);
  const root = ctx.set(`<a href="#/activite" class="small">← Mes réservations</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${parcel ? esc(b.typeLabel?.label || 'Envoi de colis') : 'Voyage'}</h2>${badge(BOOKING, b.status)}</div>
    <p class="small" style="margin:6px 0 0">Réservation ${refTag(b.ref)}${b.package?.ref ? ' · colis ' + refTag(b.package.ref) : ''}${t.ref ? ' · trajet ' + refTag(t.ref) : ''}</p>
    <p class="muted small">${esc(b.from)} → ${esc(b.to)} · départ de ${esc(t.origin)} ${fmtDT(t.departureAt)}${t.meetingPoint ? ' · RDV ' + esc(t.meetingPoint) : ''}</p>
    <div id="main"></div>
    <div id="live" style="margin-top:12px"></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>Suivi</h3>${idx >= 0 ? `<ol class="timeline">${steps.map((s, i) => `<li class="${idx >= i && !(b.status === 'PENDING_PAYMENT' && i === 0 && false) ? 'done' : idx + 1 === i ? 'now' : ''}">${s}</li>`).join('')}</ol>` : `<p>${badge(BOOKING, b.status)}${b.refundAmount ? ` · remboursé ${fcfa(b.refundAmount)}` : ''}</p>`}</div>
      <div class="card"><h3>Paiement</h3>${b.discount ? `<div class="row between small"><span>Prix catalogue</span><span>${fcfa(b.listPrice)}</span></div><div class="row between small"><span>Code ${esc(b.promoCode)}</span><span>− ${fcfa(b.discount)}</span></div>` : ''}<div class="row between"><span>${parcel ? 'Transport du colis' : `${b.seats} place(s)`}</span><strong>${fcfa(b.price)}</strong></div>
        ${b.payment ? `<p class="xs muted" style="margin:8px 0 0">Payé par ${PROVIDERS[b.payment.provider]} · réf. ${esc(b.payment.provider_ref)}${b.refundAmount ? ` · remboursé ${fcfa(b.refundAmount)}` : ''}</p>` : '<p class="xs muted" style="margin:8px 0 0">Non payé</p>'}
        ${b.invoices?.length ? `<div class="row" style="margin-top:10px;gap:6px">${b.invoices.map((i) => `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${printUrl('facture', { id: i.id }, 'client')}">${i.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'} ${esc(i.number)}</a>`).join('')}</div>` : ''}
        ${parcel && ['PAID', 'IN_PROGRESS'].includes(b.status) ? `<a class="btn btn-ghost btn-sm" style="margin-top:6px" target="_blank" rel="noopener" href="${printUrl('etiquette', { id: b.id }, 'client')}">Imprimer l'étiquette du colis</a>` : ''}</div>
    </div>
    ${b.package ? `<div class="card" style="margin-top:16px"><h3>Colis</h3><p class="small" style="margin:0">${b.package.type && b.package.type !== 'COLIS' ? `${esc(b.typeLabel?.label || b.package.type)} · forfait sans pesée, enveloppe fermée` : `${String(b.package.weightKg).replace('.', ',')} kg · ${b.package.dims.join(' × ')} cm · ${esc(catLabel(b.package.category))}`}${b.package.fragile ? ' · <span class="badge b-sun">Fragile</span>' : ''}<br>${esc(b.package.description)}<br>Destinataire : ${esc(b.package.recipientName)} (${esc(b.package.recipientPhone)})</p></div>` : ''}
    <h3 style="margin-top:20px">Votre chauffeur</h3><div class="card">${personHtml(b.driver, t.plate ? `<br><span class="small">Plaque <strong>${esc(t.plate)}</strong></span>` : '', '#/membre/' + b.driver.id)}</div>
    <div class="card" style="margin-top:16px"><h3>Messages</h3><div class="chat" id="chat"></div>
      <form id="mf" class="row" style="margin-top:10px;flex-wrap:nowrap"><input name="body" placeholder="Écrire au chauffeur…" aria-label="Message" maxlength="1000" autocomplete="off"><button class="btn btn-primary btn-sm" type="submit">Envoyer</button></form>
      <p class="xs muted" style="margin:6px 0 0">Les numéros de téléphone sont masqués. Ne payez jamais en dehors de l'application.</p></div>
    <div id="after" style="margin-top:16px"></div>
    <div class="row" style="margin-top:16px">
      ${['PENDING_PAYMENT', 'PAID'].includes(b.status) ? '<button class="btn btn-danger btn-sm" id="cancel">Annuler</button>' : ''}
      ${['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(b.status) && !b.dispute ? '<button class="btn btn-ghost btn-sm" id="dispute">Réclamation</button>' : ''}
      ${['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(b.status) ? '<button class="btn btn-ghost btn-sm" id="report">Signaler le chauffeur</button>' : ''}
      <a class="btn btn-ghost btn-sm" href="#/aide?${qs({ ref: b.ref, subject: 'Réservation ' + b.ref })}">Écrire à Bokk Yoon</a>
    </div>
    <div class="card" style="margin-top:16px"><h3>Besoin d'aide sur cette réservation ?</h3><div id="contact"></div></div>`);
  contactButtons(`au sujet de ma réservation ${b.ref}`).then((h) => { root.querySelector('#contact').innerHTML = h; });
  const main = root.querySelector('#main');
  if (b.status === 'PENDING_PAYMENT' && b.claim?.status === 'PENDING') {
    main.innerHTML = `<div class="card" style="border-color:var(--sky)"><h3>Paiement en cours de vérification</h3>
      <p class="small">Vous avez déclaré un paiement ${b.claim.provider === 'WAVE' ? 'Wave' : 'Orange Money'} de <strong>${fcfa(b.claim.amount)}</strong> (ID <code>${esc(b.claim.transaction_ref)}</code>, réf. ${refTag(b.claim.ref)}). Votre place est gardée pendant la vérification. Vous recevrez une notification dès la confirmation.</p></div>`;
    const tm = setInterval(async () => { try { const x = await api('GET', '/client/bookings/' + id); if (x.status !== b.status || x.claim?.status !== 'PENDING') ctx.render(); } catch { /* hors ligne */ } }, 15000);
    ctx.cleanup(() => clearInterval(tm));
  } else if (b.status === 'PENDING_PAYMENT') {
    main.innerHTML = `<div class="card" style="border-color:var(--sun)">${b.claim?.status === 'REJECTED' ? `<div class="error small" style="margin-bottom:10px">Paiement ${esc(b.claim.transaction_ref)} non retrouvé : ${esc(b.claim.reason)}. Vérifiez l'ID dans votre application et déclarez-le à nouveau.</div>` : ''}<h3>Finalisez votre paiement</h3><p class="small">Votre ${parcel ? 'place dans le coffre' : 'place'} est bloquée jusqu'à <strong>${fmtTime(b.expiresAt)}</strong>. Sans paiement, elle sera libérée.</p>
      <button class="btn btn-primary btn-block" id="pay">Payer ${fcfa(b.price)}</button></div>`;
    main.querySelector('#pay').onclick = () => paySheet(b, ctx);
    if (ctx.params.pay) paySheet(b, ctx);
  }
  if (b.status === 'PAID') {
    main.innerHTML = `<div class="card" style="border-color:var(--primary)"><h3>${parcel ? 'Code de remise au chauffeur' : 'Votre code d\'embarquement'}</h3>
      <p class="small">${parcel ? 'Donnez ce code au chauffeur quand il prend le colis, après vérification.' : 'Donnez ce code au chauffeur en montant à bord.'}</p>
      <div class="code-box">${esc(b.pickupCode)}</div>${parcel ? trackShare(b) : ''}</div>`;
    bindShare(main);
  }
  if (b.status === 'IN_PROGRESS' && parcel) { main.innerHTML = `<div class="card"><h3>Colis en route</h3><p class="small">Le destinataire donnera son code au chauffeur à la livraison.</p>${trackShare(b)}</div>`; bindShare(main); }
  // Carte en direct
  if (['PAID', 'IN_PROGRESS'].includes(b.status)) {
    const live = root.querySelector('#live');
    const mapEl = document.createElement('div'); live.appendChild(mapEl);
    const mp = await createMap(mapEl, { height: 260 });
    if (mp) {
      ctx.cleanup(() => mp.destroy());
      mp.route(t.originPos, t.destPos, { dashed: false }); mp.marker(t.originPos, 'start', esc(t.origin)); mp.marker(t.destPos, 'end', esc(t.dest));
      let car = null; const cap = document.createElement('p'); cap.className = 'xs muted'; cap.style.marginTop = '6px'; live.appendChild(cap);
      const draw = (l) => {
        if (!l) { cap.textContent = 'La position du chauffeur s\'affichera dès qu\'il démarre le trajet.'; mp.fit([t.originPos, t.destPos]); return; }
        car?.remove(); car = mp.marker(l, 'car', 'Chauffeur');
        cap.textContent = `${l.source === 'gps' ? 'Position GPS ' + ago(l.at) : 'Position estimée selon l\'horaire'} · arrivée dans ~${l.etaMin} min`;
        mp.fit([t.originPos, t.destPos, l]);
      };
      draw(b.live);
      const timer = setInterval(async () => { try { const x = await api('GET', '/client/bookings/' + id); draw(x.live); if (x.status !== b.status) ctx.render(); } catch { /* hors ligne */ } }, 20000);
      ctx.cleanup(() => clearInterval(timer));
    }
  }
  const after = root.querySelector('#after');
  if (b.dispute) after.innerHTML = `<div class="notice"><strong>Réclamation ${b.dispute.status === 'OPEN' ? 'en cours d\'examen (réponse sous 72 h)' : 'traitée'}</strong>${b.dispute.decision ? '<br>' + esc(b.dispute.decision) : ''}</div>`;
  else if (b.status === 'COMPLETED' && !b.myReview) {
    after.innerHTML = `<form class="card" id="rf" novalidate>${errBox}<h3>Votre avis sur ${esc(b.driver.name)}</h3>
      <div class="row" role="radiogroup" aria-label="Note">${[1, 2, 3, 4, 5].map((n) => `<label class="check" style="font-size:1.2rem"><input type="radio" name="rating" value="${n}" ${n === 5 ? 'checked' : ''}> ${n}★</label>`).join('')}</div>
      <textarea name="comment" placeholder="Ponctualité, conduite, soin du colis…" maxlength="500" style="margin-top:10px"></textarea>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:10px">Publier l'avis</button></form>`;
    after.querySelector('#rf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', `/client/bookings/${id}/review`, { rating: Number(d.rating), comment: d.comment }); toast('Merci pour votre avis'); ctx.render(); }); });
  } else if (b.myReview) after.innerHTML = `<p class="small muted">Votre avis : ${'★'.repeat(b.myReview.rating)} ${esc(b.myReview.comment)}</p>`;
  if (b.status === 'COMPLETED') {
    const fb = document.createElement('div'); fb.style.marginTop = '16px'; after.after(fb);
    if (b.feedback) fb.innerHTML = `<div class="success small">Merci pour votre retour sur Bokk Yoon (${b.feedback.score}/10).</div>`;
    else {
      fb.innerHTML = `<form class="card" id="nps" novalidate>${errBox}<h3>Votre retour sur Bokk Yoon</h3>
        <p class="small">Recommanderiez-vous Bokk Yoon à un proche ? <span class="muted">(0 = pas du tout, 10 = certainement)</span></p>
        <div class="nps" role="radiogroup" aria-label="Note de 0 à 10">${Array.from({ length: 11 }, (_, n) => `<label><input type="radio" name="score" value="${n}"><span>${n}</span></label>`).join('')}</div>
        <div class="field" style="margin-top:12px"><label for="lk">Ce que vous avez aimé</label><textarea id="lk" name="liked" rows="2" maxlength="1000"></textarea></div>
        <div class="field"><label for="im">Ce que nous devons améliorer</label><textarea id="im" name="improve" rows="2" maxlength="1000"></textarea></div>
        <p class="xs muted">Ce formulaire va directement au propriétaire de Bokk Yoon, pas au chauffeur.</p>
        <button class="btn btn-primary btn-block" type="submit">Envoyer mon retour</button></form>`;
      fb.querySelector('#nps').addEventListener('submit', (e) => { e.preventDefault(); const d = formData(e.target);
        if (d.score === undefined || d.score === '') { toast('Choisissez une note de 0 à 10'); return; }
        submitting(e.target, async (x) => { await api('POST', `/client/bookings/${id}/feedback`, { ...x, score: Number(x.score) }); toast('Merci, votre retour a été transmis'); ctx.render(); }); });
    }
  }

  root.querySelector('#cancel')?.addEventListener('click', () => {
    const hours = (new Date(t.departureAt) - Date.now()) / 3600000;
    const policy = b.status !== 'PAID' ? 'Aucun frais : la réservation n\'est pas payée.' : hours > 24 ? `Remboursement intégral : ${fcfa(b.price)}.` : `Moins de 24 h avant le départ : remboursement de 50 %, soit ${fcfa(Math.round(b.price / 100) * 50)}.`;
    confirmSheet('Annuler la réservation ?', policy, async () => { const r = await api('POST', `/client/bookings/${id}/cancel`, { reason: 'client' }); toast(r.refund ? `Remboursement de ${fcfa(r.refund)} en cours` : 'Réservation annulée'); ctx.render(); }, 'Annuler la réservation');
  });
  root.querySelector('#dispute')?.addEventListener('click', () => sheet(`<form novalidate>${errBox}<h3>Réclamation</h3>
      <div class="field"><label for="r">Motif</label><select id="r" name="reason">${parcel ? '<option value="DAMAGED">Colis endommagé</option><option value="LOST">Colis perdu</option><option value="NOT_DELIVERED">Colis non livré</option>' : ''}<option value="NO_SHOW">Chauffeur absent</option><option value="PAYMENT">Problème de paiement</option><option value="OTHER">Autre</option></select></div>
      <div class="field"><label for="dd">Détails</label><textarea id="dd" name="details" required placeholder="Que s'est-il passé ?"></textarea></div>
      <p class="xs muted">L'équipe Bokk Yoon examine votre demande sous 72 h. Le paiement du chauffeur est bloqué pendant l'examen.</p>
      <div class="row"><button class="btn btn-primary" type="submit">Envoyer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
    (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', `/client/bookings/${id}/dispute`, d); close(); toast('Réclamation envoyée'); ctx.render(); }); })));
  root.querySelector('#report')?.addEventListener('click', () => reportSheet(id));
  chat(root, id, ctx);
}
export function reportSheet(id) {
  sheet(`<form novalidate>${errBox}<h3>Signaler un comportement</h3><p class="small muted">Votre signalement est confidentiel et traité par l'équipe Bokk Yoon, qui peut avertir, suspendre ou bloquer le compte concerné.</p>
    <div class="field"><label for="rc">Motif</label><select id="rc" name="category"><option value="COMPORTEMENT">Comportement irrespectueux</option><option value="RETARD">Retard important</option><option value="CONDUITE">Conduite dangereuse</option><option value="PAIEMENT_HORS_APP">Demande de paiement hors application</option><option value="FRAUDE">Fraude ou tentative d'arnaque</option><option value="AUTRE">Autre</option></select></div>
    <div class="field"><label for="rd">Ce qui s'est passé</label><textarea id="rd" name="details" required minlength="10"></textarea></div>
    <div class="row"><button class="btn btn-danger" type="submit">Envoyer le signalement</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
  (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', `/bookings/${id}/report`, d); close(); toast('Signalement transmis à l\'équipe'); }); }));
}
export async function chat(root, id, ctx) {
  const box = root.querySelector('#chat');
  const load = async () => {
    try {
      const m = await api('GET', `/bookings/${id}/messages`);
      box.innerHTML = m.results.length ? m.results.map((x) => `<div class="msg ${x.mine ? 'mine' : ''}"><span class="xs" style="opacity:.75">${x.mine ? 'Vous' : esc(x.sender_name)} · ${fmtTime(x.created_at)}</span><br>${esc(x.body)}</div>`).join('') : '<p class="xs muted">Aucun message. Précisez le point de rendez-vous.</p>';
      box.scrollTop = box.scrollHeight;
    } catch { /* hors ligne */ }
  };
  await load();
  const timer = setInterval(load, 10000); ctx.cleanup(() => clearInterval(timer));
  root.querySelector('#mf')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const inp = e.target.body; if (!inp.value.trim()) return;
    try { const r = await api('POST', `/bookings/${id}/messages`, { body: inp.value }); inp.value = ''; if (r.masked) toast('Numéro masqué : restez dans la messagerie Bokk Yoon'); load(); } catch (er) { toast(er.message); }
  });
}
const trackUrl = (b) => new URL(`#/suivi/${b.trackToken}`, location.href.split('#')[0]).href;
const trackShare = (b) => `<div style="margin-top:14px"><p class="small"><strong>Pour le destinataire :</strong> il a reçu un SMS. Vous pouvez aussi lui envoyer ce lien (suivi en direct et code de réception).</p>
  <div class="row"><a class="btn btn-sun btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Ton colis Bokk Yoon arrive. Suivi et code de réception : ' + trackUrl(b))}">Partager sur WhatsApp</a>
  <button class="btn btn-ghost btn-sm" data-copy="${esc(trackUrl(b))}">Copier le lien</button></div></div>`;
const bindShare = (r) => on(r, '[data-copy]', 'click', async (e) => { try { await navigator.clipboard.writeText(e.target.dataset.copy); toast('Copié'); } catch { toast(e.target.dataset.copy, 6000); } });
async function paySheet(b, ctx) {
  let pm = null; try { pm = await api('GET', '/payment-methods'); } catch { /* hors ligne */ }
  if (pm?.mode === 'QR') return qrPaySheet(b, ctx, pm);
  sheet(`<h3>Paiement sécurisé</h3><p class="small muted">Montant : <strong id="amt">${fcfa(b.price)}</strong>, encaissé par Bokk Yoon. Remboursé si le trajet est annulé par le chauffeur.</p>
    <form id="promo" class="row" style="flex-wrap:nowrap;margin-bottom:12px"><input name="code" placeholder="Code promo" aria-label="Code promo" value="${esc(b.promoCode || '')}" style="text-transform:uppercase" autocomplete="off"><button class="btn btn-ghost btn-sm" type="submit">Appliquer</button></form>
    <p class="xs" id="promo-msg" style="margin:-6px 0 12px">${b.discount ? `Code ${esc(b.promoCode)} : − ${fcfa(b.discount)}` : ''}</p>
    <div class="stack" id="prov">${[['WAVE', 'Wave', '#1DC4FF'], ['ORANGE_MONEY', 'Orange Money', '#FF7900'], ['FREE_MONEY', 'Free Money', '#E3001B'], ['CARD', 'Carte bancaire', '#1F5F99']].map(([k, n, c]) =>
      `<button class="btn btn-ghost btn-block" data-p="${k}" style="justify-content:flex-start"><span style="width:14px;height:14px;border-radius:4px;background:${c}"></span>${n}</button>`).join('')}</div>
    <div id="step"></div><p class="xs muted" style="margin-top:12px">Prototype : paiement simulé, aucun argent réel n'est débité.</p>`, (s, close) => {
    s.querySelector('#promo').addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = s.querySelector('#promo-msg');
      try { const r = await api('POST', `/client/bookings/${b.id}/promo`, { code: e.target.code.value.trim() }); b.price = r.price; s.querySelector('#amt').textContent = fcfa(r.price);
        msg.className = 'xs'; msg.style.color = 'var(--primary)'; msg.textContent = r.discount ? `${r.label || 'Code ' + r.code} : − ${fcfa(r.discount)}. Nouveau total ${fcfa(r.price)}.` : 'Code retiré.'; }
      catch (er) { msg.style.color = 'var(--terra)'; msg.textContent = er.message; }
    });
    on(s, '[data-p]', 'click', (e) => {
      const prov = e.target.closest('[data-p]').dataset.p;
      s.querySelector('#prov').hidden = true;
      s.querySelector('#step').innerHTML = `<div class="card" style="text-align:center"><p><strong>${PROVIDERS[prov]}</strong></p><p class="small">${prov === 'CARD' ? 'Saisie de la carte sur la page sécurisée du prestataire (3-D Secure).' : 'Confirmez le paiement dans votre application ' + PROVIDERS[prov] + '.'}</p>
        <button class="btn btn-primary btn-block" id="confirm">J'ai confirmé le paiement</button></div>${errBox}`;
      s.querySelector('#confirm').addEventListener('click', async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'Vérification…';
        try { await api('POST', `/client/bookings/${b.id}/pay`, { provider: prov, idempotencyKey: b.id + '-' + prov }); close(); toast('Paiement reçu ✓ Réservation confirmée'); if (location.hash === '#/reservation/' + b.id) ctx.render(); else location.hash = '#/reservation/' + b.id; }
        catch (er) { const x = s.querySelector('.form-error'); x.textContent = er.message; x.hidden = false; ev.target.disabled = false; ev.target.textContent = 'Réessayer'; }
      });
    });
  });
}

// Paiement réel sur le QR code marchand du propriétaire, puis déclaration de l'ID de transaction.
function qrPaySheet(b, ctx, pm) {
  const methods = [['WAVE', 'Wave', '#1DC4FF', pm.wave], ['ORANGE_MONEY', 'Orange Money', '#FF7900', pm.orange]].filter((m) => m[3]);
  const mobile = matchMedia('(max-width: 820px)').matches;
  sheet(`<h3>Paiement</h3><p class="small muted" style="margin:0">Réservation ${refTag(b.ref)} · paiement encaissé par ${esc(methods[0]?.[3].name || 'Bokk Yoon')}.</p>
    <form id="promo" class="row" style="flex-wrap:nowrap;margin:12px 0"><input name="code" placeholder="Code promo" aria-label="Code promo" value="${esc(b.promoCode || '')}" style="text-transform:uppercase" autocomplete="off"><button class="btn btn-ghost btn-sm" type="submit">Appliquer</button></form>
    <p class="xs" id="promo-msg" style="margin:-6px 0 8px">${b.discount ? `Code ${esc(b.promoCode)} : − ${fcfa(b.discount)}` : ''}</p>
    <div class="pill-nav" id="pmt" style="margin-bottom:12px">${methods.map(([k, l, c], i) => `<button type="button" class="btn btn-ghost btn-sm ${i === 0 ? 'on' : ''}" data-k="${k}"><span style="width:12px;height:12px;border-radius:4px;background:${c};display:inline-block"></span>${l}</button>`).join('')}</div>
    <div id="pbody"></div>
    <form id="cf" novalidate style="margin-top:14px">${errBox}
      <div class="field"><label for="tx">ID de la transaction</label><input id="tx" name="transactionRef" required autocomplete="off" placeholder="Ex. T_AB12CD34EF" style="text-transform:uppercase"><div class="hint" id="txhint"></div></div>
      <div class="field"><label for="pp">Numéro qui a payé</label><input id="pp" name="payerPhone" type="tel" inputmode="tel" placeholder="77 123 45 67"></div>
      <button class="btn btn-primary btn-block" type="submit">J'ai payé : envoyer pour vérification</button></form>
    <p class="xs muted" style="margin-top:10px">${esc(pm.instructions || '')} Vérification en général sous ${pm.reviewMinutes} min.</p>`, (s, close) => {
    let prov = methods[0]?.[0];
    const draw = () => {
      const m = methods.find((x) => x[0] === prov), d = m[3], name = m[1];
      s.querySelector('#pbody').innerHTML = `<div class="pay-qr"><div class="small muted">Montant exact à payer</div><div class="pay-amount tnum" id="amt">${fcfa(b.price)}</div>
        ${d.qr ? `<img src="${esc(qrSrc(d.qr))}" alt="QR code ${name} de ${esc(d.name)}" style="margin-top:10px">` : ''}
        <div class="small" style="margin-top:8px"><strong>${esc(d.name)}</strong>${d.number ? ' · ' + esc(d.number) : ''}</div>
        <div class="row" style="justify-content:center;margin-top:10px">${d.link ? `<a class="btn btn-primary btn-sm" href="${esc(d.link)}" target="_blank" rel="noopener">Ouvrir ${name}</a>` : ''}${d.qr ? `<a class="btn btn-ghost btn-sm" href="${esc(qrSrc(d.qr))}" download="qr-${prov.toLowerCase()}-bokk-yoon.png">Enregistrer le QR</a>` : ''}${d.number ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${esc(String(d.number).replace(/\s/g, ''))}">Copier le numéro</button>` : ''}</div></div>
        <ol class="pay-steps small">${mobile && d.link ? `<li>Appuyez sur <strong>Ouvrir ${name}</strong>${d.qr ? ' (ou enregistrez le QR et scannez-le depuis votre galerie)' : ''}.</li>` : `<li>Ouvrez ${name} sur votre téléphone et scannez ce QR code.</li>`}
          <li>Payez exactement <strong>${fcfa(b.price)}</strong>${d.number ? ` à <strong>${esc(d.name)}</strong>` : ''}.</li><li>Copiez l'<strong>ID de la transaction</strong> depuis l'historique ${name} et collez-le ci-dessous.</li></ol>`;
      s.querySelector('#txhint').textContent = prov === 'WAVE' ? 'Dans Wave : touchez la transaction dans l\'historique, l\'ID commence souvent par T_.' : 'Dans Orange Money : l\'ID figure dans le SMS de confirmation.';
    };
    if (!methods.length) { s.querySelector('#pbody').innerHTML = '<div class="error">Aucun moyen de paiement n\'est configuré. Contactez Bokk Yoon.</div>'; s.querySelector('#cf').hidden = true; return; }
    draw();
    s.querySelector('#pmt').addEventListener('click', (e) => { const x = e.target.closest('[data-k]'); if (!x) return; prov = x.dataset.k; s.querySelectorAll('#pmt [data-k]').forEach((y) => y.classList.toggle('on', y === x)); draw(); });
    bindShare(s);
    s.querySelector('#promo').addEventListener('submit', async (e) => {
      e.preventDefault(); const msg = s.querySelector('#promo-msg');
      try { const r = await api('POST', `/client/bookings/${b.id}/promo`, { code: e.target.code.value.trim() }); b.price = r.price; draw();
        msg.style.color = 'var(--primary)'; msg.textContent = r.discount ? `${r.label || 'Code ' + r.code} : − ${fcfa(r.discount)}. Nouveau total ${fcfa(r.price)}.` : 'Code retiré.'; }
      catch (er) { msg.style.color = 'var(--terra)'; msg.textContent = er.message; }
    });
    s.querySelector('#cf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => {
      const r = await api('POST', `/client/bookings/${b.id}/payment-claim`, { provider: prov, ...d }); close(); toast(`Paiement déclaré (${r.ref}) : vérification en cours`); ctx.render(); }); });
  });
}

// ---------- Activité ----------
async function activity(ctx) {
  const u = await needLogin(ctx); if (!u) return;
  const tab = ctx.params.tab || 'reservations';
  const root = ctx.set(`<h2>Mes réservations</h2><div class="pill-nav" role="tablist">${[['reservations', 'Voyages et envois'], ['colis', 'Mes colis'], ['factures', 'Factures']].map(([k, l]) => `<a role="tab" class="btn btn-ghost btn-sm ${k === tab ? 'on' : ''}" href="#/activite?tab=${k}">${l}</a>`).join('')}</div><div id="list" style="margin-top:16px"></div>`);
  const list = root.querySelector('#list');
  const empty = (t, cta, href) => `<div class="empty card"><strong>${t}</strong><br><a class="btn btn-primary" style="margin-top:12px" href="${href}">${cta}</a></div>`;
  if (tab === 'reservations') {
    const r = await api('GET', '/client/bookings');
    list.innerHTML = r.results.length ? `<div class="stack">${r.results.map((b) => `<a class="card card-link" href="#/reservation/${b.id}"><div class="row between"><strong>${esc(b.from)} → ${esc(b.to)}</strong>${badge(BOOKING, b.status)}</div>
      <div class="small muted">${refTag(b.ref)} · ${fmtDT(b.departureAt)} · ${b.kind === 'PARCEL' ? 'colis' : `${b.seats} place(s)`} · ${esc(b.driverName)} · ${fcfa(b.price)}</div></a>`).join('')}</div>` : empty('Aucune réservation', 'Trouver un trajet', '#/recherche');
  } else if (tab === 'factures') {
    const r = await api('GET', '/client/invoices');
    list.innerHTML = r.results.length ? `<div class="table-wrap card" style="padding:0"><table><thead><tr><th>N°</th><th>Date</th><th>Montant</th><th></th></tr></thead><tbody>${r.results.map((i) => `<tr><td><strong>${esc(i.number)}</strong><br><span class="xs muted">${i.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'}</span></td><td>${fmtDate(i.issued_at)}</td><td>${i.kind === 'CREDIT_NOTE' ? '− ' : ''}${fcfa(Math.abs(i.total))}</td><td><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${printUrl('facture', { id: i.id }, 'client')}">Voir / imprimer</a></td></tr>`).join('')}</tbody></table></div>` : empty('Aucune facture', 'Trouver un trajet', '#/recherche');
  } else {
    const r = await api('GET', '/client/packages');
    list.innerHTML = r.results.length ? `<div class="stack">${r.results.map((x) => `<a class="card card-link" href="#/colis/${x.id}"><div class="row between"><strong>${esc(x.origin)} → ${esc(x.dest)}</strong>${badge(PACKAGE, x.status)}</div>
      <div class="small muted">${refTag(x.ref)} · ${x.type && x.type !== 'COLIS' ? esc(x.type.charAt(0) + x.type.slice(1).toLowerCase()) : `${String(x.weightKg).replace('.', ',')} kg · ${esc(catLabel(x.category))}`} · pour ${esc(x.recipientName)}</div></a>`).join('')}</div>` : empty('Aucun colis', 'Envoyer un colis', '#/colis/nouveau');
  }
}

// ---------- Profil ----------
async function profile(ctx) {
  const u = await needLogin(ctx); if (!u) return;
  const partner = await api('GET', '/client/partner');
  const root = ctx.set(`<div class="row" style="gap:14px;flex-wrap:nowrap"><span class="avatar" style="width:64px;height:64px;font-size:1.4rem">${esc(initials(u.name))}</span>
      <div><h2 style="margin:0">${esc(u.name)}</h2><span class="small muted">${refTag(u.ref)} · client depuis ${fmtDate(u.createdAt)} · ${u.stats.asClient} trajet(s) ou envoi(s)</span></div></div>
    ${u.warnings ? `<div class="notice" style="margin-top:12px">Vous avez reçu ${u.warnings} avertissement(s) de l'équipe. Au-delà, votre compte peut être suspendu.</div>` : ''}
    <form class="card" id="pf" style="margin-top:16px" novalidate>${errBox}<h3>Mon profil</h3>
      <div class="field"><label for="n">Prénom et nom</label><input id="n" name="name" value="${esc(u.name)}" maxlength="60"></div>
      <div class="grid grid-2"><div class="field"><label for="c">Ville</label><select id="c" name="city">${cityOptions(u.city)}</select></div>
      <div class="field"><label for="em">E-mail (factures, réponses)</label><input id="em" name="email" type="email" value="${esc(u.email || '')}" placeholder="vous@exemple.sn"></div></div>
      <p class="small muted">Téléphone : ${esc(u.phone)}</p>
      <button class="btn btn-primary" type="submit">Enregistrer</button></form>
    <div class="card" style="margin-top:16px" id="partner"></div>
    <div class="card" style="margin-top:16px"><h3>Application</h3>
      <div class="row"><button class="btn btn-ghost btn-sm" id="theme">Thème clair / sombre</button><a class="btn btn-ghost btn-sm" href="#/actualites">Actualités</a><a class="btn btn-ghost btn-sm" href="#/activite?tab=factures">Mes factures</a><a class="btn btn-ghost btn-sm" href="#/aide">Aide et contact</a><a class="btn btn-ghost btn-sm" href="#/calculer">Calculatrice</a>
      <button class="btn btn-danger btn-sm" id="logout">Se déconnecter</button><button class="btn btn-ghost btn-sm" id="reset" hidden>Réinitialiser la démo</button></div></div>`);
  root.querySelector('#pf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('PATCH', '/me', d); await loadMe(true); toast('Profil enregistré'); }); });
  root.querySelector('#theme').onclick = toggleTheme;
  root.querySelector('#logout').onclick = async () => { try { await api('POST', '/auth/logout'); } catch { /* déjà déconnecté */ } token.clear(); me = null; bell.refresh(); go('#/'); };
  api('GET', '/config').then((c) => { if (c.mode === 'demo') { const r = root.querySelector('#reset'); r.hidden = false; r.onclick = () => confirmSheet('Réinitialiser la démo ?', 'Toutes les données de démonstration de cet appareil seront effacées.', async () => resetDemo()); } });
  const pb = root.querySelector('#partner');
  if (!partner.partner) {
    pb.innerHTML = `<h3>Vous avez une boutique en ligne ?</h3><p class="small muted">Proposez la livraison Bokk Yoon à vos clients : prix en direct, création d'envoi, suivi par webhooks. <a href="#/partenaires">Documentation API</a></p>
      <form id="paf" novalidate>${errBox}<div class="grid grid-2"><div class="field"><label for="sn">Nom de la boutique</label><input id="sn" name="name" required></div>
      <div class="field"><label for="wh">Adresse de webhook (https, facultative)</label><input id="wh" name="webhookUrl" type="url" placeholder="https://maboutique.sn/webhooks/bokkyoon"></div></div>
      <button class="btn btn-ghost" type="submit">Créer mes clés API</button></form>`;
    pb.querySelector('#paf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => showKeys(await api('POST', '/client/partner', d))); });
  } else {
    const P = partner.partner;
    pb.innerHTML = `<div class="row between"><h3 style="margin:0">Boutique ${esc(P.name)}</h3><a class="small" href="#/partenaires">Documentation</a></div>
      <p class="small muted">Clé : <code>${esc(P.api_key_prefix)}…</code> · Webhook : ${P.webhook_url ? esc(P.webhook_url) : 'non configuré'}</p>
      <button class="btn btn-ghost btn-sm" id="rot">Régénérer les clés</button>
      <h3 style="margin-top:14px">Envois (${partner.shipments.length})</h3>
      ${partner.shipments.length ? `<div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Trajet</th><th>Poids</th><th>Statut</th></tr></thead><tbody>${partner.shipments.map((s) => `<tr><td>${esc(s.externalRef || s.id.slice(0, 8))}</td><td>${esc(s.origin)} → ${esc(s.dest)}</td><td>${s.weightKg} kg</td><td>${badge(PACKAGE, s.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Aucun envoi via l\'API.</p>'}
      <h3 style="margin-top:14px">Derniers webhooks</h3>${partner.events.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Événement</th><th>Livraison</th></tr></thead><tbody>${partner.events.map((e) => `<tr><td>${fmtDT(e.created_at)}</td><td><code>${esc(e.event)}</code></td><td>${esc(e.delivery_status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Aucun événement.</p>'}`;
    pb.querySelector('#rot').onclick = () => confirmSheet('Régénérer les clés ?', 'L\'ancienne clé cessera immédiatement de fonctionner.', async () => showKeys(await api('POST', '/client/partner', { name: P.name, webhookUrl: P.webhook_url })), 'Régénérer');
  }
  function showKeys(r) {
    sheet(`<h3>Vos clés API</h3><p class="small">${esc(r.note)}</p><label>Clé API (en-tête <code>x-api-key</code>)</label><div class="code-box" style="font-size:.85rem;letter-spacing:0;word-break:break-all">${esc(r.apiKey)}</div>
      <label style="margin-top:12px">Secret de signature des webhooks</label><div class="code-box" style="font-size:.85rem;letter-spacing:0;word-break:break-all">${esc(r.webhookSecret)}</div>
      <button class="btn btn-primary btn-block" data-close style="margin-top:14px">J'ai copié mes clés</button>`);
    ctx.render();
  }
}

async function memberPage(ctx, id) {
  const m = await api('GET', '/users/' + id);
  ctx.set(`<a href="javascript:history.back()" class="small">← Retour</a>
    <div class="row" style="gap:14px;margin-top:10px;flex-wrap:nowrap"><span class="avatar" style="width:64px;height:64px;font-size:1.4rem">${esc(initials(m.name))}</span>
      <div><h2 style="margin:0">${esc(m.name)}</h2><span class="small muted">${m.ref ? refTag(m.ref) + ' · ' : ''}${m.role === 'driver' ? 'Chauffeur' : 'Membre'} depuis ${fmtDate(m.memberSince)}${m.city ? ' · ' + esc(m.city) : ''}</span></div></div>
    <div class="row" style="margin-top:12px"><span class="badge b-green">Téléphone vérifié</span>${m.role === 'driver' && m.verified ? '<span class="badge b-green">Identité, permis et véhicule vérifiés par Bokk Yoon</span>' : ''}</div>
    ${m.bio ? `<p style="margin-top:12px">« ${esc(m.bio)} »</p>` : ''}${m.vehicle ? `<p class="small muted">Véhicule : ${esc(m.vehicle.label)}</p>` : ''}
    <div class="stat-row" style="margin-top:16px">
      <div class="card"><div class="kpi-sm">${m.stats.ratingCount ? String(m.stats.ratingAvg).replace('.', ',') + ' ★' : '—'}</div><div class="xs muted">${m.stats.ratingCount} avis</div></div>
      <div class="card"><div class="kpi-sm">${m.stats.trips}</div><div class="xs muted">trajets · ${m.stats.parcels} colis</div></div>
      <div class="card"><div class="kpi-sm">${m.stats.cancelRate} %</div><div class="xs muted">annulations</div></div></div>
    <h3 style="margin-top:20px">Avis</h3>
    ${m.reviews.length ? `<div class="stack">${m.reviews.map((r) => `<div class="card"><div class="row between"><strong>${esc(r.author)}</strong><span>${'★'.repeat(r.rating)}<span class="muted">${'★'.repeat(5 - r.rating)}</span></span></div>${r.comment ? `<p class="small" style="margin:6px 0 0">${esc(r.comment)}</p>` : ''}<p class="xs muted" style="margin:4px 0 0">${fmtDate(r.created_at)}</p></div>`).join('')}</div>` : '<p class="muted small">Pas encore d\'avis.</p>'}`);
}

export async function trackPage(ctx, tk) {
  const t = await api('GET', '/track/' + tk);
  const i = ['PAID', 'IN_PROGRESS', 'COMPLETED'].indexOf(t.status);
  const root = ctx.set(`<p class="small muted" style="margin:0">Suivi de colis Bokk Yoon</p><h2>Bonjour ${esc(t.recipientName)}, un colis arrive pour vous</h2>
    <div class="card">${routeHtml(t.from, t.to, 'départ ' + fmtDT(t.departureAt))}<p class="small muted" style="margin:10px 0 0">${String(t.weightKg).replace('.', ',')} kg · ${esc(catLabel(t.category))} · transporté par ${esc(t.driverName)}</p></div>
    <div id="map" style="margin-top:12px"></div><p class="xs muted" id="cap" style="margin-top:6px"></p>
    <div class="card" style="margin-top:16px"><ol class="timeline"><li class="${i >= 0 ? 'done' : ''}">Envoi confirmé et payé</li>
      <li class="${i >= 1 ? 'done' : i === 0 ? 'now' : ''}">Pris en charge par le chauffeur${t.pickupAt ? ' · ' + fmtDT(t.pickupAt) : ''}</li>
      <li class="${i >= 2 ? 'done' : i === 1 ? 'now' : ''}">Livré${t.deliveredAt ? ' · ' + fmtDT(t.deliveredAt) : ''}</li></ol></div>
    ${t.deliveryCode ? `<div class="card" style="margin-top:16px;border-color:var(--primary)"><h3>Votre code de réception</h3><p class="small">Donnez-le au chauffeur <strong>uniquement quand vous avez le colis en main</strong>, après l'avoir vérifié.</p><div class="code-box">${esc(t.deliveryCode)}</div></div>` : ''}
    ${t.status === 'COMPLETED' ? '<div class="success" style="margin-top:16px">Colis livré. Merci d\'avoir choisi Bokk Yoon !</div>' : ''}`);
  const mp = await createMap(root.querySelector('#map'), { height: 240 });
  if (mp) {
    ctx.cleanup(() => mp.destroy());
    const o = t.route.origin, d = t.route.dest;
    mp.route(o, d, { dashed: false }); mp.marker(o, 'start', esc(o.name)); mp.marker(d, 'end', esc(d.name));
    if (t.live) { mp.marker(t.live, 'car', 'Colis'); root.querySelector('#cap').textContent = `${t.live.source === 'gps' ? 'Position GPS ' + ago(t.live.at) : 'Position estimée'} · arrivée dans ~${t.live.etaMin} min`; mp.fit([o, d, t.live]); }
    else mp.fit([o, d]);
    if (t.status === 'IN_PROGRESS') { const tm = setInterval(() => ctx.render(), 30000); ctx.cleanup(() => clearInterval(tm)); }
  }
}

// ---------- Calculatrice de prix ----------
async function calculator(ctx) {
  const p = ctx.params;
  const types = (await api('GET', '/parcel-types')).results;
  const root = ctx.set(`<h2>Calculatrice de prix</h2><p class="muted small">Le prix affiché est celui que vous payez : fixé par Bokk Yoon, sans négociation, sans frais cachés.</p>
    <form class="card" id="cf" novalidate>
      <div class="grid grid-2">
        <div class="field"><label for="cfrom">Départ</label><select id="cfrom" name="from">${cityOptions(p.from || 'Dakar')}</select></div>
        <div class="field"><label for="cto">Arrivée</label><select id="cto" name="to">${cityOptions(p.to || 'Saint-Louis')}</select></div>
      </div>
      <div class="pill-nav" role="tablist" id="ctabs" style="margin-bottom:12px">${[['SEAT', 'Places'], ['COLIS', 'Colis au poids'], ['FLAT', 'Documents et petits objets']].map(([k, l], i) => `<button type="button" role="tab" class="btn btn-ghost btn-sm ${i === 0 ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
      <div data-pane="SEAT"><div class="field"><label for="cseats">Nombre de places</label><input id="cseats" type="range" name="seats" min="1" max="6" value="1"><div class="hint"><span id="cseatsv">1</span> place(s)</div></div></div>
      <div data-pane="COLIS" hidden><div class="field"><label for="ckg">Poids</label><input id="ckg" type="range" name="weightKg" min="0.5" max="${LIMITS.parcelMaxKg}" step="0.5" value="5"><div class="hint"><span id="ckgv">5</span> kg (max ${LIMITS.parcelMaxKg} kg)</div></div></div>
      <div data-pane="FLAT" hidden><div class="type-cards">${types.filter((x) => x.mode === 'FLAT').map((x, i) => `<label class="type-card"><input type="radio" name="flat" value="${esc(x.code)}" ${i === 0 ? 'checked' : ''}><span><strong>${esc(x.label)}</strong>${x.description ? `<span class="xs muted">${esc(x.description)}</span>` : ''}</span></label>`).join('')}</div></div>
    </form>
    <div class="calc-result" id="res" style="margin-top:14px;text-align:left" aria-live="polite"></div>
    <h3 style="margin-top:22px">Tous les tarifs pour ce trajet</h3><div id="all" class="table-wrap card" style="padding:0"></div>`);
  const f = root.querySelector('#cf'); let kind = 'SEAT';
  const run = async () => {
    root.querySelector('#cseatsv').textContent = f.seats.value; root.querySelector('#ckgv').textContent = String(f.weightKg.value).replace('.', ',');
    const res = root.querySelector('#res');
    if (f.from.value === f.to.value) { res.innerHTML = '<p class="small muted" style="margin:0">Choisissez deux villes différentes.</p>'; return; }
    const type = kind === 'FLAT' ? f.flat?.value || 'COLIS' : 'COLIS';
    try {
      const q = await api('GET', '/quote?' + qs({ from: f.from.value, to: f.to.value, seats: f.seats.value, weightKg: f.weightKg.value, type }));
      const main = kind === 'SEAT' ? q.seatsTotal : q.parcel;
      const label = kind === 'SEAT' ? `${q.seats} place(s) · ${fcfa(q.seat)} / place` : kind === 'COLIS' ? `Colis de ${String(q.weightKg).replace('.', ',')} kg` : `${esc(q.type.label)} · forfait sans pesée`;
      const cta = kind === 'SEAT' ? `#/recherche?${qs({ from: q.from, to: q.to, seats: q.seats, run: 1 })}` : `#/colis/nouveau?${qs({ from: q.from, to: q.to, type })}`;
      res.innerHTML = `<div class="row between" style="align-items:flex-end"><div><span class="small muted">${esc(q.from)} → ${esc(q.to)} · ${q.distanceKm} km · ~${fmtDur(q.durationMin)}</span><div class="calc-total">${fcfa(main)}</div><span class="small">${label}</span></div>
        <a class="btn btn-primary" href="${cta}">${kind === 'SEAT' ? 'Voir les trajets' : 'Envoyer maintenant'}</a></div>`;
      const rows = await Promise.all(types.map((x) => api('GET', '/quote?' + qs({ from: q.from, to: q.to, type: x.code, weightKg: 5 }))));
      root.querySelector('#all').innerHTML = `<table><thead><tr><th>Service</th><th>Détail</th><th style="text-align:right">Prix</th></tr></thead><tbody>
        <tr><td><strong>Place en voiture</strong></td><td class="small muted">par passager</td><td style="text-align:right"><strong>${fcfa(q.seat)}</strong></td></tr>
        ${rows.map((r, i) => `<tr><td><strong>${esc(types[i].label)}</strong></td><td class="small muted">${types[i].mode === 'FLAT' ? 'forfait' : 'exemple 5 kg'}</td><td style="text-align:right"><strong>${fcfa(r.parcel)}</strong></td></tr>`).join('')}</tbody></table>`;
    } catch (e) { res.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  root.querySelector('#ctabs').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k;
    root.querySelectorAll('#ctabs [data-k]').forEach((x) => x.classList.toggle('on', x === b)); root.querySelectorAll('[data-pane]').forEach((x) => { x.hidden = x.dataset.pane !== kind; }); run(); });
  f.addEventListener('input', run); f.addEventListener('change', run); run();
}

async function helpRoute(ctx) {
  const u = await needLogin(ctx); if (!u) return;
  const bk = await api('GET', '/client/bookings');
  return helpPage(ctx, { me: u, bookingRefs: bk.results.map((b) => b.ref).filter(Boolean).slice(0, 30) });
}

async function newsIndex(ctx) {
  const root = ctx.set('<h2>Actualités</h2><div id="alerts" class="stack" hidden></div><div id="n" class="stack" style="margin-top:12px"></div>');
  renderAlerts(root.querySelector('#alerts')); renderNews(root.querySelector('#n'), { audience: 'CLIENTS', limit: 30 });
}

async function partnersDoc(ctx) {
  const o = location.origin;
  ctx.set(`<h2>API partenaires</h2><p class="muted">Pour les boutiques en ligne : livrez vos clients entre villes, au prix fixé par Bokk Yoon.</p>
    <div class="card"><h3>Principe</h3><ol class="small" style="padding-left:18px;margin:0">
      <li><strong>Éligibilité</strong> : villes et poids → éligible ou non, avec le prix.</li>
      <li><strong>Création de l'envoi</strong> après la commande : attribué au meilleur trajet compatible.</li>
      <li><strong>Provisionnement</strong> sur votre compte partenaire, <strong>facturation à la livraison</strong>.</li>
      <li><strong>Transport</strong> contre code, suivi par webhooks à chaque étape.</li></ol></div>
    <div class="card" style="margin-top:16px"><h3>1. Éligibilité et prix</h3><pre style="overflow:auto;background:var(--surface-2);padding:12px;border-radius:10px;font-size:.8rem">curl -X POST ${esc(o)}/api/partner/v1/eligibility \\
  -H "x-api-key: bk_live_…" -H "content-type: application/json" \\
  -d '{"from":"Dakar","to":"Thiès","weightKg":2}'
→ {"eligible":true,"price":1500,"currency":"XOF","offers":3}</pre></div>
    <div class="card" style="margin-top:16px"><h3>2. Création de l'envoi</h3><pre style="overflow:auto;background:var(--surface-2);padding:12px;border-radius:10px;font-size:.8rem">POST /api/partner/v1/shipments
{"from":"Dakar","to":"Thiès","weightKg":2,"category":"vetements",
 "recipientName":"Moussa","recipientPhone":"771234567","externalRef":"CMD-1042"}
→ {"shipmentId":"…","status":"CONFIRMED","price":1500}</pre></div>
    <div class="card" style="margin-top:16px"><h3>3. Suivi</h3><pre style="overflow:auto;background:var(--surface-2);padding:12px;border-radius:10px;font-size:.8rem">GET /api/partner/v1/shipments/{shipmentId}
→ {"bookingStatus":"PAID","pickupCode":"482913","trackingPath":"/app/#/suivi/…"}</pre>
      <p class="small">Webhooks signés HMAC-SHA256 (<code>x-bokkyoon-signature</code>) : <code>shipment.confirmed</code>, <code>shipment.picked_up</code>, <code>shipment.delivered</code>, <code>shipment.cancelled</code>.</p></div>
    <a class="btn btn-primary btn-block" style="margin-top:16px" href="#/profil">Obtenir mes clés API</a>`);
}

// ---------- Démarrage ----------
const router = createRouter(view, [
  [/^\/?$/, home, 'home'],
  [/^\/connexion$/, async (ctx) => { if (await needLogin(ctx)) location.hash = decodeURIComponent(ctx.params.next || '#/'); }, 'profile'],
  [/^\/recherche$/, search, 'search'],
  [/^\/trajet\/([\w-]+)$/, tripPage, 'search'],
  [/^\/colis\/nouveau$/, newPackage, 'send'],
  [/^\/colis\/([\w-]+)$/, packagePage, 'activity'],
  [/^\/reservation\/([\w-]+)$/, bookingPage, 'activity'],
  [/^\/activite$/, activity, 'activity'],
  [/^\/profil$/, profile, 'profile'],
  [/^\/membre\/([\w-]+)$/, memberPage, 'search'],
  [/^\/suivi\/([\w-]+)$/, trackPage, 'home'],
  [/^\/actualites$/, newsIndex, 'home'],
  [/^\/actualites\/([\w-]+)$/, (ctx, s) => articlePage(ctx, s, '#/actualites'), 'home'],
  [/^\/partenaires$/, partnersDoc, 'profile'],
  [/^\/calculer$/, calculator, 'home'],
  [/^\/aide$/, helpRoute, 'profile'],
  [/^\/aide\/([\w-]+)$/, async (ctx, id) => { if (await needLogin(ctx)) return ticketPage(ctx, id); }, 'profile'],
], { onRoute: (tab) => document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab)) });
let bell = { refresh() {} };
(async () => {
  await bootSpace('client');
  bell = mountBell(document.getElementById('bell'), () => {});
  router.render();
  const c = await getCompany();
  if (c.whatsapp) { const a = document.createElement('a'); a.className = 'wa-float'; a.href = waLink(c.whatsapp, 'Bonjour Bokk Yoon, '); a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Écrire sur WhatsApp'); a.innerHTML = ICONS.wa; document.body.appendChild(a); }
})();
