// Bokk Yoon — espace chauffeur.
import {
  fmtDur, api, token, esc, fmtDay, fmtTime, fmtDT, fmtDate, ago, today, addDays, initials, catLabel, qs, stars, fcfa, cityOptions,
  toast, sheet, errBox, submitting, on, act, BOOKING, TRIP, PAYOUT, PROVIDERS, badge, routeHtml, confirmSheet,
  createRouter, loginScreen, mountBell, renderNews, articlePage, renderAlerts, bootSpace, toggleTheme, accountBlocked,
  helpPage, ticketPage, printUrl, refTag, getCompany, waLink, ICONS, deleteAccountSheet,
} from './ui.js';
import { CATEGORIES } from './core.js';
import { createMap } from './map.js';

const view = document.getElementById('view');
let me = null;
const go = (h) => { if (location.hash === h) router.render(); else location.hash = h; };

async function loadMe(force) {
  if (!token.get()) return (me = null);
  if (me && !force) return me;
  try { me = await api('GET', '/me'); } catch { me = null; }
  return me;
}
/** Renvoie le chauffeur validé, sinon affiche l'écran adapté (connexion, dossier, attente). */
async function needDriver(ctx) {
  const u = await loadMe(true);
  if (!u) { loginScreen(ctx.set, 'driver', { demoHint: 'Démo : chauffeur validé 70 000 00 01, ou un nouveau numéro pour tester la candidature.', onDone: async () => { await loadMe(true); bell.refresh(); ctx.render(); } }); return null; }
  if (!u.driver || u.driver.status === 'REJECTED') { await applicationForm(ctx, u); return null; }
  if (u.driver.status === 'PENDING') {
    ctx.set(`<div class="welcome driver"><p class="small" style="margin:0;font-weight:700">Dossier envoyé le ${fmtDate(u.driver.submitted_at)}</p><h1>Merci ${esc(u.name.split(' ')[0])} !</h1>
      <p class="small muted" style="margin:6px 0 0">L'équipe Bokk Yoon vérifie votre pièce, votre permis et votre véhicule. Vous serez prévenu par notification et SMS, en général sous 48 h.</p></div>
      <div class="card" style="margin-top:16px"><h3>Pendant ce temps</h3><ul class="small" style="padding-left:18px;margin:0"><li>Préparez l'original de votre permis et de votre carte grise.</li><li>Vérifiez que votre assurance couvre le transport de passagers.</li><li>Lisez la charte : ponctualité, courtoisie, aucun paiement hors application.</li></ul></div>
      <div id="news" class="stack" style="margin-top:16px"></div>`);
    renderNews(view.querySelector('#news'), { audience: 'DRIVERS', limit: 2 });
    return null;
  }
  return u;
}

async function applicationForm(ctx, u) {
  const rejected = u.driver?.status === 'REJECTED';
  const root = ctx.set(`<div class="welcome driver"><p class="small" style="margin:0;font-weight:700">Devenir chauffeur partenaire</p><h1>Roulez, transportez, gagnez.</h1>
      <p class="small muted" style="margin:6px 0 0">Bokk Yoon fixe les prix et vous verse votre part après chaque mission, sur Wave ou Orange Money. Vous n'avez rien à encaisser.</p></div>
    ${rejected ? `<div class="error" style="margin-top:12px">Votre dossier est à compléter : ${esc(u.driver.review_note || '')}</div>` : ''}
    <form class="card" id="af" style="margin-top:16px" novalidate>${errBox}
      <h3>Vous</h3>
      <div class="grid grid-2">
        <div class="field"><label for="nm">Prénom et nom (comme sur la pièce)</label><input id="nm" name="name" value="${esc(u.name)}" required></div>
        <div class="field"><label for="hc">Ville</label><select id="hc" name="homeCity">${cityOptions(u.city)}</select></div>
        <div class="field"><label for="dt">Pièce d'identité</label><select id="dt" name="idDocType"><option value="CNI">Carte nationale d'identité</option><option value="CARTE_CEDEAO">Carte CEDEAO</option><option value="PASSEPORT">Passeport</option></select></div>
        <div class="field"><label for="d4">4 derniers caractères de la pièce</label><input id="d4" name="idDocLast4" maxlength="4" required></div>
        <div class="field"><label for="l4">4 derniers caractères du permis</label><input id="l4" name="licenseLast4" maxlength="4" required></div>
        <div class="field"><label for="ls">Permis obtenu en</label><input id="ls" name="licenseSince" type="number" min="1970" max="${new Date().getFullYear()}" placeholder="2015" inputmode="numeric" required></div>
      </div>
      <div class="grid grid-2"><div class="field"><label for="p1">Photo de la pièce</label><input id="p1" type="file" accept="image/*" capture="environment"></div><div class="field"><label for="p2">Photo du permis</label><input id="p2" type="file" accept="image/*" capture="environment"></div></div>
      <p class="hint" style="margin-top:-6px">Prototype : les photos restent sur votre téléphone. En production, elles sont chiffrées et vues uniquement par l'équipe de vérification.</p>
      <h3 style="margin-top:16px">Votre véhicule</h3>
      <div class="grid grid-2">
        <div class="field"><label for="vl">Marque, modèle, couleur</label><input id="vl" name="v_label" placeholder="Peugeot 7 places grise" required></div>
        <div class="field"><label for="vp">Plaque d'immatriculation</label><input id="vp" name="v_plate" placeholder="DK-1234-AB" required></div>
        <div class="field"><label for="vt">Type</label><select id="vt" name="v_type"><option value="citadine">Citadine</option><option value="berline" selected>Berline</option><option value="7places">7 places</option><option value="minibus">Minibus (8 places max)</option><option value="pickup">Pick-up</option></select></div>
        <div class="field"><label for="iu">Assurance valable jusqu'au</label><input id="iu" name="insuranceUntil" type="date" min="${today()}" required></div>
        <div class="field"><label for="vs">Places passagers</label><input id="vs" name="v_seats" type="number" min="1" max="8" value="3" inputmode="numeric"></div>
        <div class="field"><label for="vk">Capacité colis (kg)</label><input id="vk" name="v_kg" type="number" min="0" max="200" value="20" inputmode="numeric"></div>
      </div>
      <h3 style="margin-top:16px">Où recevoir vos gains</h3>
      <div class="grid grid-2">
        <div class="field"><label for="pv">Moyen de paiement</label><select id="pv" name="payoutProvider"><option value="WAVE">Wave</option><option value="ORANGE_MONEY">Orange Money</option><option value="FREE_MONEY">Free Money</option></select></div>
        <div class="field"><label for="pp">Numéro</label><input id="pp" name="payoutPhone" type="tel" value="${esc(u.phone)}"></div>
      </div>
      <label class="check small"><input type="checkbox" name="charter"> Je m'engage à respecter la charte Bokk Yoon : ponctualité, sécurité, courtoisie, aucun paiement en dehors de l'application. Je sais que l'équipe peut suspendre mon compte en cas de manquement.</label>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px">Envoyer mon dossier</button>
    </form>`);
  root.querySelector('#af').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => {
    if (!d.charter) throw new Error('Acceptez la charte chauffeur pour continuer.');
    const r = await api('POST', '/driver/application', { ...d, licenseSince: Number(d.licenseSince), vehicle: { label: d.v_label, plate: d.v_plate, type: d.v_type, seats: Number(d.v_seats), cargoKg: Number(d.v_kg) } });
    toast(r.status === 'APPROVED' ? 'Dossier validé' : 'Dossier envoyé'); await loadMe(true); ctx.render();
  }); });
}

// ---------- Partage de position (continue d'une page à l'autre) ----------
const gps = { tripId: null, watchId: null, last: null, error: null };
function startSharing(tripId) {
  stopSharing();
  gps.tripId = tripId; gps.error = null;
  if (!navigator.geolocation) { gps.error = 'Localisation indisponible : la position est estimée selon l\'horaire.'; updatePill(); return; }
  let lastSent = 0;
  gps.watchId = navigator.geolocation.watchPosition(async (p) => {
    if (Date.now() - lastSent < 20000) return;
    lastSent = Date.now();
    try { await api('POST', `/driver/trips/${tripId}/position`, { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed }); gps.last = new Date().toISOString(); gps.error = null; }
    catch (e) { gps.error = e.message; }
    updatePill();
  }, () => { gps.error = 'Autorisez la localisation : sinon vos clients voient une position estimée.'; updatePill(); }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  updatePill();
}
function stopSharing() { if (gps.watchId != null) navigator.geolocation.clearWatch(gps.watchId); gps.tripId = null; gps.watchId = null; updatePill(); }
function updatePill() {
  const p = document.getElementById('gps-pill'); if (!p) return;
  p.hidden = !gps.tripId;
  p.className = 'badge ' + (gps.error ? 'b-terra' : 'b-green');
  p.textContent = gps.error ? 'Position estimée' : gps.last ? 'Position partagée' : 'Localisation…';
  p.title = gps.error || (gps.last ? 'Dernier envoi ' + ago(gps.last) : '');
}

// ---------- Accueil ----------
async function home(ctx) {
  const u = await needDriver(ctx); if (!u) return;
  const d = await api('GET', '/driver/dashboard');
  const e = d.earnings;
  const root = ctx.set(`<div class="welcome driver"><p class="small" style="margin:0;font-weight:700">Na nga def, ${esc(u.name.split(' ')[0])} !</p><h1>Votre tableau de bord</h1>
      <p class="small muted" style="margin:6px 0 0">Matricule ${refTag(u.ref)} · ${stars(d.stats.ratingAvg, d.stats.ratingCount)} · ${d.stats.trips} trajet(s) · ${d.stats.parcels} colis livré(s)</p></div>
    ${u.warnings ? `<div class="notice" style="margin-top:12px">Vous avez reçu ${u.warnings} avertissement(s) de l'équipe. Respectez la charte pour éviter une suspension.</div>` : ''}
    <div id="alerts" class="stack" style="margin-top:12px" hidden></div>
    <div class="grid grid-2" style="margin-top:14px">
      <a class="card card-link" href="#/gains"><div class="xs muted">Disponible, en attente de versement</div><div class="kpi tnum money-in">${fcfa(e.available)}</div><div class="xs muted">+ ${fcfa(e.pending)} après le délai de 24 h</div></a>
      <a class="card card-link" href="#/gains"><div class="xs muted">Missions confirmées à venir</div><div class="kpi tnum">${fcfa(e.upcoming)}</div><div class="xs muted">Déjà versé : ${fcfa(e.paid)}</div></a>
    </div>
    <a class="btn btn-sun btn-block btn-lg" href="#/publier" style="margin-top:14px">Publier un trajet</a>
    <div class="row" style="margin-top:10px;gap:8px"><a class="btn btn-ghost btn-sm" href="#/gains">Relevé du mois</a><a class="btn btn-ghost btn-sm" href="#/aide">Écrire au propriétaire</a></div>
    <h3 style="margin-top:22px">Prochains trajets</h3>
    ${d.upcoming.length ? `<div class="stack">${d.upcoming.map((t) => `<a class="card card-link" href="#/trajet/${t.id}"><div class="row between"><strong>${esc(t.origin)} → ${esc(t.dest)}</strong>${badge(TRIP, t.status)}</div>
      <div class="small muted">${fmtDT(t.departureAt)} · ${t.confirmed} réservation(s) confirmée(s) · ${t.seatsLeft}/${t.seatsTotal} places · ${t.parcelKgLeft}/${t.parcelKgTotal} kg libres</div></a>`).join('')}</div>` : '<div class="card empty"><strong>Aucun trajet prévu</strong><p class="small">Publiez les trajets que vous faites déjà : Bokk Yoon vous envoie passagers et colis.</p></div>'}
    <div class="row between" style="margin-top:22px"><h3 style="margin:0">Infos chauffeurs</h3><a class="small" href="#/actualites">Tout voir</a></div>
    <div id="news" class="stack" style="margin-top:10px"></div>`);
  renderAlerts(root.querySelector('#alerts'), u.city ? [u.city] : null);
  renderNews(root.querySelector('#news'), { audience: 'DRIVERS', limit: 3 });
}

// ---------- Publier ----------
async function publish(ctx) {
  const u = await needDriver(ctx); if (!u) return;
  const tomorrow = addDays(today(), 1);
  const root = ctx.set(`<h2>Publier un trajet</h2><p class="muted small">Le prix payé par les clients est fixé par Bokk Yoon. Voici ce que vous recevez.</p>
    <form class="card" id="tf" novalidate>${errBox}
      <div class="grid grid-2">
        <div class="field"><label for="o">Départ</label><select id="o" name="origin" required>${cityOptions(u.city || 'Dakar')}</select></div>
        <div class="field"><label for="d">Arrivée</label><select id="d" name="dest" required>${cityOptions(u.city === 'Dakar' || !u.city ? 'Thiès' : 'Dakar')}</select></div>
        <div class="field"><label for="dt">Date et heure de départ</label><input id="dt" type="datetime-local" name="departureAt" value="${tomorrow}T07:30" min="${today()}T00:00" required><div class="hint">Heure du Sénégal (GMT)</div></div>
        <div class="field"><label for="v">Véhicule</label><select id="v" name="vehicleId">${u.vehicles.map((v) => `<option value="${v.id}" data-seats="${v.seats}" data-kg="${v.cargo_kg}">${esc(v.label)} · ${esc(v.plate)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="mp">Point de rendez-vous</label><input id="mp" name="meetingPoint" placeholder="Gare routière, station, rond-point…" maxlength="120"></div>
      <div class="grid grid-2">
        <div class="field"><label for="se">Places passagers</label><input id="se" type="number" name="seats" min="0" max="8" value="3" inputmode="numeric"></div>
        <div class="field"><label for="kg">Place pour colis (kg)</label><input id="kg" type="number" name="parcelKg" min="0" max="200" value="15" inputmode="numeric"></div>
      </div>
      <div class="card" id="earn" style="background:var(--sun-soft);border-color:transparent;box-shadow:none;margin-bottom:14px">…</div>
      <div class="field"><label for="dk">Détour accepté pour un colis : <span id="dk-v">5</span> km</label><input id="dk" type="range" name="maxDetourKm" min="0" max="20" value="5"></div>
      <fieldset class="field" style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:700;font-size:.9rem;margin-bottom:6px">Colis acceptés</legend>
        <div class="grid grid-2">${CATEGORIES.map((c) => `<label class="check small"><input type="checkbox" name="categories" data-multi="1" value="${c.code}" ${c.code !== 'electronique' ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div></fieldset>
      <div class="field"><label for="n">Infos pour les voyageurs</label><textarea id="n" name="notes" maxlength="300" placeholder="Climatisation, bagages, pauses…"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Publier le trajet</button>
    </form>`);
  const f = root.querySelector('#tf');
  let pay = null;
  const draw = () => {
    const box = root.querySelector('#earn'); if (!pay) { box.textContent = 'Choisissez deux villes différentes.'; return; }
    const s = Number(f.seats.value) || 0, kg = Number(f.parcelKg.value) || 0, parcels = Math.floor(kg / 5);
    box.innerHTML = `<div class="row between"><span>Par place</span><strong>${fcfa(pay.perSeat)}</strong></div><div class="row between"><span>Par colis (jusqu'à 5 kg)</span><strong>${fcfa(pay.perParcel)}</strong></div>
      <div class="row between" style="margin-top:6px;border-top:1px solid rgb(0 0 0 / .08);padding-top:6px"><span>Si tout est réservé</span><strong class="money-in">jusqu'à ${fcfa(s * pay.perSeat + parcels * pay.perParcel)}</strong></div>
      <p class="xs" style="margin:6px 0 0;opacity:.75">${pay.distanceKm} km · environ ${fmtDur(pay.durationMin)} de route. Versé 24 h après la mission.</p>`;
  };
  const refresh = async () => {
    const v = f.vehicleId.selectedOptions[0]; if (v) { f.seats.max = v.dataset.seats; f.parcelKg.max = v.dataset.kg; }
    pay = null;
    if (f.origin.value && f.dest.value && f.origin.value !== f.dest.value) { try { pay = await api('GET', '/driver/quote?' + qs({ from: f.origin.value, to: f.dest.value })); } catch { /* ignore */ } }
    draw();
  };
  ['origin', 'dest', 'vehicleId'].forEach((n) => f[n].addEventListener('change', refresh)); ['seats', 'parcelKg'].forEach((n) => f[n].addEventListener('input', draw)); refresh();
  f.maxDetourKm.addEventListener('input', () => { root.querySelector('#dk-v').textContent = f.maxDetourKm.value; });
  f.addEventListener('submit', (e) => { e.preventDefault(); submitting(f, async (d) => {
    const r = await api('POST', '/driver/trips', { ...d, departureAt: d.departureAt + ':00.000Z', seats: Number(d.seats), parcelKg: Number(d.parcelKg), maxDetourKm: Number(d.maxDetourKm) });
    toast('Trajet publié'); go('#/trajet/' + r.id);
  }); });
}

// ---------- Mes trajets ----------
async function trips(ctx) {
  const u = await needDriver(ctx); if (!u) return;
  const r = await api('GET', '/driver/trips');
  ctx.set(`<div class="row between"><h2 style="margin:0">Mes trajets</h2><a class="btn btn-sun btn-sm" href="#/publier">Publier</a></div>
    <div class="stack" style="margin-top:14px">${r.results.length ? r.results.map((t) => `<a class="card card-link" href="#/trajet/${t.id}"><div class="row between"><strong>${esc(t.origin)} → ${esc(t.dest)}</strong>${badge(TRIP, t.status)}</div>
      <div class="small muted">${refTag(t.ref)} · ${fmtDT(t.departureAt)} · ${t.confirmed} réservation(s) · gains ${fcfa(t.gains)}</div></a>`).join('') : '<div class="card empty">Aucun trajet publié.</div>'}</div>`);
}

async function tripPage(ctx, id) {
  const u = await needDriver(ctx); if (!u) return;
  const t = await api('GET', '/driver/trips/' + id);
  const active = t.bookings.filter((b) => ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(b.status));
  const gains = active.reduce((s, b) => s + b.driverPay, 0);
  if (t.status === 'IN_PROGRESS' && gps.tripId !== t.id) startSharing(t.id);
  const root = ctx.set(`<a href="#/trajets" class="small">← Mes trajets</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${esc(t.origin)} → ${esc(t.dest)}</h2>${badge(TRIP, t.status)}</div>
    <p class="muted small">${refTag(t.ref)} · ${fmtDT(t.departureAt)} · ${t.distanceKm} km · ${esc(t.vehicle)}${t.meetingPoint ? ' · RDV ' + esc(t.meetingPoint) : ''}</p>
    <div id="map"></div><p class="xs muted" id="cap" style="margin-top:6px"></p>
    <div class="grid grid-2" style="margin-top:12px">
      <div class="card"><div class="xs muted">Vos gains sur ce trajet</div><div class="kpi tnum money-in">${fcfa(gains)}</div><div class="xs muted">${fcfa(t.payPerSeat)} / place · ${fcfa(t.payPerParcel)} / colis ≤ 5 kg</div></div>
      <div class="card"><div class="xs muted">Occupation</div><div class="kpi-sm">${t.seatsTotal - t.seatsLeft}/${t.seatsTotal} places · ${Math.round((t.parcelKgTotal - t.parcelKgLeft) * 10) / 10}/${t.parcelKgTotal} kg</div></div>
    </div>
    <div class="row" style="margin-top:14px" id="tact"></div>
    <h3 style="margin-top:20px">Passagers et colis (${active.length})</h3>
    <div class="stack">${active.length ? active.map((b) => `<a class="card card-link" href="#/mission/${b.id}"><div class="row between"><strong>${b.kind === 'PARCEL' ? 'Colis' : b.seats + ' passager(s)'} · ${esc(b.customerName)}</strong>${badge(BOOKING, b.status)}</div>
      <div class="small muted">${refTag(b.ref)} · ${esc(b.from)} → ${esc(b.to)}${b.parcel ? ` · ${String(b.parcel.weightKg).replace('.', ',')} kg ${esc(catLabel(b.parcel.category))}${b.parcel.fragile ? ' · fragile' : ''}` : ''} · vous recevez ${fcfa(b.driverPay)}</div></a>`).join('') : '<div class="card empty small">Aucune réservation confirmée pour le moment.</div>'}</div>`);
  const tact = root.querySelector('#tact');
  if (['PUBLISHED', 'FULL'].includes(t.status)) tact.innerHTML = '<button class="btn btn-primary" id="start">Démarrer le trajet</button><button class="btn btn-danger" id="cancel">Annuler le trajet</button>';
  if (t.status === 'IN_PROGRESS') tact.innerHTML = '<button class="btn btn-primary" id="done">Terminer le trajet</button>';
  tact.querySelector('#start')?.addEventListener('click', async () => { if (await act(() => api('POST', `/driver/trips/${id}/start`), 'Bonne route ! Votre position est partagée avec vos clients.')) { startSharing(id); ctx.render(); } });
  tact.querySelector('#done')?.addEventListener('click', async () => { if (await act(() => api('POST', `/driver/trips/${id}/complete`), 'Trajet terminé')) { stopSharing(); ctx.render(); } });
  tact.querySelector('#cancel')?.addEventListener('click', () => confirmSheet('Annuler ce trajet ?', `${active.length} client(s) seront remboursés intégralement. Une annulation est signalée à l'équipe et pèse sur votre fiabilité.`,
    async (d) => { await api('POST', `/driver/trips/${id}/cancel`, { reason: d.reason }); toast('Trajet annulé'); ctx.render(); }, 'Annuler le trajet', { withReason: true }));
  const mp = await createMap(root.querySelector('#map'), { height: 240 });
  if (mp) {
    ctx.cleanup(() => mp.destroy());
    mp.route(t.originPos, t.destPos, { dashed: false }); mp.marker(t.originPos, 'start', esc(t.origin)); mp.marker(t.destPos, 'end', esc(t.dest));
    if (t.live) { mp.marker(t.live, 'car', 'Vous'); root.querySelector('#cap').textContent = `${t.live.source === 'gps' ? 'Position GPS ' + ago(t.live.at) : 'Position estimée (GPS non reçu)'} · arrivée dans ~${t.live.etaMin} min`; mp.fit([t.originPos, t.destPos, t.live]); }
    else mp.fit([t.originPos, t.destPos]);
  }
}

// ---------- Mission (une réservation) ----------
async function mission(ctx, id) {
  const u = await needDriver(ctx); if (!u) return;
  const b = await api('GET', '/driver/bookings/' + id);
  const parcel = b.kind === 'PARCEL';
  const root = ctx.set(`<a href="#/trajet/${b.tripId}" class="small">← Trajet</a>
    <div class="row between" style="margin-top:8px"><h2 style="margin:0">${parcel ? 'Colis' : b.seats + ' passager(s)'}</h2>${badge(BOOKING, b.status)}</div>
    <p class="muted small">${refTag(b.ref)}${b.package?.ref ? ' · colis ' + refTag(b.package.ref) : ''} · ${esc(b.from)} → ${esc(b.to)} · ${fmtDT(b.trip.departureAt)}</p>
    <div id="main"></div>
    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><h3>Vous recevez</h3><div class="kpi tnum money-in">${fcfa(b.driverPay)}</div><p class="small" style="margin:6px 0 0">${badge(PAYOUT, b.payoutStatus)} ${b.payoutStatus === 'DUE' ? 'disponible le ' + fmtDT(b.payoutDueAt) : ''}</p></div>
      <div class="card"><h3>Client</h3><div style="display:flex;gap:10px;align-items:center"><span class="avatar">${esc(initials(b.customer.name))}</span><span><strong>${esc(b.customer.name)}</strong><br><span class="small">${stars(b.customer.stats.ratingAvg, b.customer.stats.ratingCount)}</span></span></div></div>
    </div>
    ${b.package ? `<div class="card" style="margin-top:16px"><h3>Colis à transporter</h3>${b.package.type && b.package.type !== 'COLIS' ? `<div class="notice small" style="margin-bottom:8px"><strong>Envoi forfaitaire (${esc(b.package.type.toLowerCase())})</strong> : enveloppe fermée, à remettre en main propre au destinataire. ${b.package.type === 'PASSEPORT' ? 'Vérifiez sa pièce d\'identité avant de demander le code.' : ''}</div>` : ''}<p class="small" style="margin:0">${String(b.package.weightKg).replace('.', ',')} kg · ${b.package.dims.join(' × ')} cm · ${esc(catLabel(b.package.category))}${b.package.fragile ? ' · <span class="badge b-sun">Fragile</span>' : ''}<br>${esc(b.package.description) || '<span class="muted">Sans description</span>'}<br>Destinataire : ${esc(b.package.recipientName)}</p>
      <p class="xs muted" style="margin:8px 0 0">Vérifiez le contenu à l'enlèvement. S'il ne correspond pas ou contient un objet interdit, refusez la mission.</p></div>` : ''}
    <div class="card" style="margin-top:16px"><h3>Messages</h3><div class="chat" id="chat"></div>
      <form id="mf" class="row" style="margin-top:10px;flex-wrap:nowrap"><input name="body" placeholder="Écrire au client…" aria-label="Message" maxlength="1000" autocomplete="off"><button class="btn btn-primary btn-sm" type="submit">Envoyer</button></form></div>
    <div id="after" style="margin-top:16px"></div>
    <div class="row" style="margin-top:16px">${b.status === 'PAID' ? '<button class="btn btn-danger btn-sm" id="decline">Refuser la mission</button>' : ''}<button class="btn btn-ghost btn-sm" id="report">Signaler le client</button>
      <a class="btn btn-ghost btn-sm" href="#/aide?${new URLSearchParams({ ref: b.ref || '', subject: 'Mission ' + (b.ref || '') })}">Contacter le propriétaire</a></div>`);
  const main = root.querySelector('#main');
  if (b.status === 'PAID' || (b.status === 'IN_PROGRESS' && parcel)) {
    const pick = b.status === 'PAID';
    main.innerHTML = `<form class="card" id="cf" style="border-color:var(--primary)" novalidate>${errBox}<h3>${pick ? (parcel ? 'Prendre en charge le colis' : 'Embarquer le passager') : 'Livrer le colis'}</h3>
      <p class="small">${pick ? (parcel ? 'Vérifiez le colis, puis saisissez le code que vous donne l\'expéditeur.' : 'Saisissez le code que vous donne le passager.') : 'Saisissez le code du destinataire. Sans ce code, la livraison n\'est pas validée et vous n\'êtes pas payé.'}</p>
      <input name="code" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="Code à 6 chiffres" required>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">Valider</button></form>`;
    main.querySelector('#cf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => {
      const pos = await quickGps();
      await api('POST', `/driver/bookings/${id}/${pick ? 'pickup' : 'deliver'}`, { code: d.code, gps: pos, offline: !navigator.onLine });
      toast(pick ? 'Pris en charge ✓' : 'Livraison validée ✓'); ctx.render();
    }); });
  }
  if (b.status === 'IN_PROGRESS' && !parcel) main.innerHTML = `<div class="success">Passager à bord. Terminez le trajet depuis <a href="#/trajet/${b.tripId}">la page du trajet</a> à l'arrivée.</div>`;
  const after = root.querySelector('#after');
  if (b.status === 'COMPLETED' && !b.myReview) {
    after.innerHTML = `<form class="card" id="rf" novalidate>${errBox}<h3>Votre avis sur ${esc(b.customer.name)}</h3>
      <div class="row" role="radiogroup" aria-label="Note">${[1, 2, 3, 4, 5].map((n) => `<label class="check" style="font-size:1.2rem"><input type="radio" name="rating" value="${n}" ${n === 5 ? 'checked' : ''}> ${n}★</label>`).join('')}</div>
      <textarea name="comment" placeholder="Ponctualité, respect, colis bien emballé…" maxlength="500" style="margin-top:10px"></textarea><button class="btn btn-primary btn-block" type="submit" style="margin-top:10px">Publier</button></form>`;
    after.querySelector('#rf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', `/driver/bookings/${id}/review`, { rating: Number(d.rating), comment: d.comment }); toast('Merci'); ctx.render(); }); });
  }
  root.querySelector('#decline')?.addEventListener('click', () => confirmSheet('Refuser cette mission ?', 'Le client sera remboursé intégralement. Chaque refus est signalé à l\'équipe et pèse sur votre fiabilité.',
    async (d) => { await api('POST', `/driver/bookings/${id}/decline`, { reason: d.reason }); toast('Mission refusée'); go('#/trajet/' + b.tripId); }, 'Refuser la mission', { withReason: true, reasonLabel: 'Motif (ex. contenu non conforme)' }));
  root.querySelector('#report').addEventListener('click', () => sheet(`<form novalidate>${errBox}<h3>Signaler le client</h3>
      <div class="field"><label for="rc">Motif</label><select id="rc" name="category"><option value="COMPORTEMENT">Comportement irrespectueux</option><option value="RETARD">Retard ou absence</option><option value="FRAUDE">Contenu suspect ou fraude</option><option value="PAIEMENT_HORS_APP">Proposition de paiement hors application</option><option value="AUTRE">Autre</option></select></div>
      <div class="field"><label for="rd">Ce qui s'est passé</label><textarea id="rd" name="details" required></textarea></div>
      <div class="row"><button class="btn btn-danger" type="submit">Envoyer</button><button class="btn btn-ghost" type="button" data-close>Annuler</button></div></form>`,
    (s, close) => s.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', `/bookings/${id}/report`, d); close(); toast('Signalement transmis à l\'équipe'); }); })));
  // Messagerie
  const box = root.querySelector('#chat');
  const load = async () => { try { const m = await api('GET', `/bookings/${id}/messages`); box.innerHTML = m.results.length ? m.results.map((x) => `<div class="msg ${x.mine ? 'mine' : ''}"><span class="xs" style="opacity:.75">${x.mine ? 'Vous' : esc(x.sender_name)} · ${fmtTime(x.created_at)}</span><br>${esc(x.body)}</div>`).join('') : '<p class="xs muted">Aucun message.</p>'; box.scrollTop = box.scrollHeight; } catch { /* hors ligne */ } };
  await load(); const tm = setInterval(load, 10000); ctx.cleanup(() => clearInterval(tm));
  root.querySelector('#mf').addEventListener('submit', async (e) => { e.preventDefault(); const i = e.target.body; if (!i.value.trim()) return; try { await api('POST', `/bookings/${id}/messages`, { body: i.value }); i.value = ''; load(); } catch (er) { toast(er.message); } });
}
function quickGps() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    const t = setTimeout(() => res(null), 4000);
    navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }); }, () => { clearTimeout(t); res(null); }, { timeout: 3500, maximumAge: 60000 });
  });
}

// ---------- Gains ----------
async function gains(ctx) {
  const u = await needDriver(ctx); if (!u) return;
  const e = await api('GET', '/driver/earnings');
  const T = e.totals;
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });
  const root = ctx.set(`<div class="row between"><h2 style="margin:0">Mes gains</h2><span class="small">Matricule ${refTag(u.ref)}</span></div><p class="muted small">Bokk Yoon encaisse le paiement des clients et vous verse votre part sur ${esc(PROVIDERS[u.driver.payout_provider])} (${esc(u.driver.payout_phone)}).</p>
    <div class="grid grid-2">
      <div class="card"><div class="xs muted">Disponible</div><div class="kpi tnum money-in">${fcfa(T.available)}</div><div class="xs muted">Versé par l'équipe lors du prochain paiement</div></div>
      <div class="card"><div class="xs muted">En attente (24 h après la mission)</div><div class="kpi tnum">${fcfa(T.pending)}</div>${T.held ? `<div class="xs" style="color:var(--terra)">${fcfa(T.held)} bloqués par une réclamation</div>` : ''}</div>
      <div class="card"><div class="xs muted">Missions confirmées à venir</div><div class="kpi tnum">${fcfa(T.upcoming)}</div></div>
      <div class="card"><div class="xs muted">Total déjà versé</div><div class="kpi tnum">${fcfa(T.paid)}</div></div>
    </div>
    <div class="card row between" style="margin-top:14px"><div><strong>Relevé mensuel imprimable</strong><br><span class="xs muted">Missions, montants dus et versements du mois, au format A4.</span></div>
      <div class="row" style="flex-wrap:nowrap"><select id="mo" aria-label="Mois" style="width:auto">${months.map((m) => `<option value="${m}">${new Date(m + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</option>`).join('')}</select><a class="btn btn-primary btn-sm" id="stmt" target="_blank" rel="noopener" href="${printUrl('releve', { month: months[0] }, 'driver')}">Imprimer</a></div></div>
    <h3 style="margin-top:22px">Versements reçus</h3>
    ${e.payouts.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Montant</th><th>Missions</th><th>Moyen</th><th>Référence</th></tr></thead><tbody>${e.payouts.map((p) => `<tr><td>${fmtDT(p.created_at)}${p.ref ? '<br>' + refTag(p.ref) : ''}</td><td class="tnum"><strong>${fcfa(p.amount)}</strong></td><td>${p.bookings_count}</td><td>${esc(PROVIDERS[p.provider] || p.provider)}</td><td><code>${esc(p.reference)}</code></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Aucun versement pour le moment.</p>'}
    <h3 style="margin-top:22px">Détail par mission</h3>
    ${e.missions.length ? `<div class="table-wrap"><table><thead><tr><th>Départ</th><th>Mission</th><th>Montant</th><th>Paiement</th></tr></thead><tbody>${e.missions.map((m) => `<tr><td>${fmtDT(m.departure_at)}</td><td>${m.ref ? refTag(m.ref) + ' ' : ''}${m.kind === 'PARCEL' ? 'Colis' : 'Place'} ${esc(m.from_city)} → ${esc(m.to_city)}</td><td class="tnum">${fcfa(m.driver_pay)}</td><td>${m.payout_status === 'NONE' ? badge(BOOKING, m.status) : badge(PAYOUT, m.payout_status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Aucune mission.</p>'}`);
  root.querySelector('#mo').addEventListener('change', (ev) => { root.querySelector('#stmt').href = printUrl('releve', { month: ev.target.value }, 'driver'); });
}

// ---------- Profil ----------
async function profile(ctx) {
  const u = await loadMe(true);
  if (!u) return needDriver(ctx);
  const root = ctx.set(`<div class="row" style="gap:14px;flex-wrap:nowrap"><span class="avatar" style="width:64px;height:64px;font-size:1.4rem;background:var(--sun-soft);color:#8A5A00">${esc(initials(u.name))}</span>
      <div><h2 style="margin:0">${esc(u.name || 'Nouveau chauffeur')}</h2><span class="small muted">${u.ref ? 'Matricule ' + refTag(u.ref) + ' · ' : ''}Chauffeur · ${esc(u.city || '—')} · ${esc(u.phone)}</span></div></div>
    <div class="row" style="margin-top:12px">${u.driver?.status === 'APPROVED' ? '<span class="badge b-green">Dossier validé</span>' : u.driver?.status === 'PENDING' ? '<span class="badge b-sky">Dossier en vérification</span>' : '<span class="badge b-sun">Dossier à compléter</span>'}${u.warnings ? `<span class="badge b-terra">${u.warnings} avertissement(s)</span>` : ''}</div>
    ${u.driver?.status === 'APPROVED' ? `<form class="card" id="pf" style="margin-top:16px" novalidate>${errBox}<h3>Présentation</h3>
      <div class="field"><label for="b">Ce que voient les clients</label><textarea id="b" name="bio" maxlength="300" placeholder="Trajets réguliers, véhicule climatisé…">${esc(u.bio)}</textarea></div>
      <button class="btn btn-primary" type="submit">Enregistrer</button></form>
    <div class="card" style="margin-top:16px"><h3>Véhicules</h3>${(u.vehicles || []).map((v) => `<p class="small" style="margin:0 0 6px"><strong>${esc(v.label)}</strong> · ${esc(v.plate)} · ${v.seats} places · ${v.cargo_kg} kg</p>`).join('')}
      <button class="btn btn-ghost btn-sm" id="addv">Ajouter un véhicule</button><div id="vbox"></div></div>
    <div class="card" style="margin-top:16px"><h3>Paiement de vos gains</h3><p class="small" style="margin:0">${esc(PROVIDERS[u.driver.payout_provider])} · ${esc(u.driver.payout_phone)}</p><p class="xs muted" style="margin:6px 0 0">Pour changer de numéro, contactez l'équipe (vérification anti-fraude).</p></div>
    <a class="btn btn-ghost btn-block" href="../app/#/membre/${u.id}" style="margin-top:16px">Voir mon profil public</a>` : ''}
    <div class="card" style="margin-top:16px"><h3>Application</h3><div class="row"><a class="btn btn-ghost btn-sm" href="#/aide">Aide et contact</a><button class="btn btn-ghost btn-sm" id="theme">Thème clair / sombre</button><button class="btn btn-danger btn-sm" id="logout">Se déconnecter</button></div>
      <p class="xs muted" style="margin:14px 0 0"><button class="linklike" id="delacc" type="button">Supprimer mon compte chauffeur</button></p></div>`);
  root.querySelector('#delacc').onclick = () => deleteAccountSheet(() => { stopSharing(); me = null; bell.refresh(); go('#/'); });
  root.querySelector('#pf')?.addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('PATCH', '/me', d); toast('Enregistré'); }); });
  root.querySelector('#addv')?.addEventListener('click', () => {
    const box = root.querySelector('#vbox');
    box.innerHTML = `<form id="vf" style="margin-top:12px" novalidate>${errBox}<div class="grid grid-2"><div class="field"><label for="a1">Marque, modèle, couleur</label><input id="a1" name="label" required></div><div class="field"><label for="a2">Plaque</label><input id="a2" name="plate" required></div>
      <div class="field"><label for="a3">Type</label><select id="a3" name="type"><option value="citadine">Citadine</option><option value="berline" selected>Berline</option><option value="7places">7 places</option><option value="minibus">Minibus</option><option value="pickup">Pick-up</option></select></div>
      <div class="field"><label for="a4">Places</label><input id="a4" name="seats" type="number" min="1" max="8" value="3"></div><div class="field"><label for="a5">Colis (kg)</label><input id="a5" name="cargoKg" type="number" min="0" max="200" value="20"></div></div>
      <button class="btn btn-primary btn-sm" type="submit">Ajouter</button></form>`;
    box.querySelector('#vf').addEventListener('submit', (e) => { e.preventDefault(); submitting(e.target, async (d) => { await api('POST', '/driver/vehicles', { ...d, seats: Number(d.seats), cargoKg: Number(d.cargoKg) }); toast('Véhicule ajouté'); ctx.render(); }); });
  });
  root.querySelector('#theme').onclick = toggleTheme;
  root.querySelector('#logout').onclick = async () => { stopSharing(); try { await api('POST', '/auth/logout'); } catch { /* ignore */ } token.clear(); me = null; bell.refresh(); go('#/'); };
}

async function newsIndex(ctx) {
  const root = ctx.set('<h2>Infos chauffeurs</h2><div id="alerts" class="stack" hidden></div><div id="n" class="stack" style="margin-top:12px"></div>');
  renderAlerts(root.querySelector('#alerts')); renderNews(root.querySelector('#n'), { audience: 'DRIVERS', limit: 30 });
}

const router = createRouter(view, [
  [/^\/?$/, home, 'home'],
  [/^\/publier$/, publish, 'publish'],
  [/^\/trajets$/, trips, 'trips'],
  [/^\/trajet\/([\w-]+)$/, tripPage, 'trips'],
  [/^\/mission\/([\w-]+)$/, mission, 'trips'],
  [/^\/gains$/, gains, 'gains'],
  [/^\/profil$/, profile, 'profile'],
  [/^\/actualites$/, newsIndex, 'home'],
  [/^\/aide$/, async (ctx) => { const u = await loadMe(true); if (!u) return needDriver(ctx); return helpPage(ctx, { me: u, bookingRefs: [] }); }, 'profile'],
  [/^\/aide\/([\w-]+)$/, async (ctx, id) => { const u = await loadMe(true); if (!u) return needDriver(ctx); return ticketPage(ctx, id); }, 'profile'],
  [/^\/actualites\/([\w-]+)$/, (ctx, s) => articlePage(ctx, s, '#/actualites'), 'home'],
], { onRoute: (tab) => document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab)) });
let bell = { refresh() {} };
(async () => {
  await bootSpace('driver');
  bell = mountBell(document.getElementById('bell'), () => {});
  router.render();
  const c = await getCompany();
  if (c.whatsapp) { const a = document.createElement('a'); a.className = 'wa-float'; a.href = waLink(c.whatsapp, 'Bonjour, je suis chauffeur Bokk Yoon. '); a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Écrire au propriétaire sur WhatsApp'); a.innerHTML = ICONS.wa; document.body.appendChild(a); }
})();
