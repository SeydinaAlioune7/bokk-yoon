// Tests de bout en bout de l'API (même code que Cloudflare), sur SQLite en mémoire. Lancer : npm test
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { handleApi, seed } from '../public/assets/server.js';
import { d1Adapter } from '../public/assets/localdb.js';

const SQL = await initSqlJs();
const sqlDb = new SQL.Database();
sqlDb.exec(readFileSync(new URL('../public/assets/schema.sql', import.meta.url), 'utf8'));
const env = { DB: d1Adapter(sqlDb), DEMO_OTP: 'true', ADMIN_PHONES: '+221770000000', MODE: 'test' };
const sql1 = (s) => sqlDb.exec(s)[0]?.values[0][0];

let passed = 0;
const call = async (method, path, body = {}, token, extra = {}) => {
  const [p, qs] = path.split('?');
  return handleApi({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs || '')), body, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra } }, env);
};
const okCall = async (...a) => { const r = await call(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
const test = async (name, fn) => { await fn(); passed++; console.log('✓', name); };
async function login(phone, space, name) {
  const { demoCode } = await okCall('POST', '/auth/otp/request', { phone, space });
  const { token } = await okCall('POST', '/auth/otp/verify', { phone, code: demoCode, space });
  if (name) await okCall('PATCH', '/me', { name }, token);
  return token;
}

await seed(env);
const in5 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
let owner, staff, client, driver, driverId, tripId, pkgId, bookingId;

await test('Espaces séparés : un chauffeur ne peut pas se connecter côté client, ni l\'inverse', async () => {
  const r = await call('POST', '/auth/otp/request', { phone: '+221700000001', space: 'client' });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'WRONG_SPACE');
  client = await login('771110000', 'client', 'Awa Diop');
  const r2 = await call('POST', '/auth/otp/request', { phone: '771110000', space: 'driver' });
  assert.equal(r2.body.error.code, 'WRONG_SPACE');
  assert.equal((await call('GET', '/driver/trips', {}, client)).status, 403);
});
await test('Espace équipe fermé au public, propriétaire créé depuis ADMIN_PHONES', async () => {
  assert.equal((await call('POST', '/auth/otp/request', { phone: '775550000', space: 'admin' })).body.error.code, 'TEAM_ONLY');
  owner = await login('770000000', 'admin', 'Alioune (propriétaire)');
  assert.equal((await okCall('GET', '/me', {}, owner)).role, 'superadmin');
  assert.equal((await call('GET', '/admin/stats', {}, client)).status, 403);
  staff = await login('+221700000099', 'admin');
  assert.equal((await okCall('GET', '/me', {}, staff)).role, 'admin');
});
await test('Chauffeur : candidature, validation par l\'équipe, puis accès à son espace', async () => {
  driver = await login('773330000', 'driver');
  assert.equal((await call('POST', '/driver/trips', {}, driver)).body.error.code, 'DRIVER_NOT_APPROVED');
  const bad = await call('POST', '/driver/application', { name: 'Cheikh', idDocType: 'CNI', idDocLast4: '1234', licenseLast4: '5678', licenseSince: 2015, insuranceUntil: in5, homeCity: 'Dakar', vehicle: { label: 'Logan', type: 'berline', seats: 3, cargoKg: 20, plate: 'DK-1' } }, driver);
  assert.equal(bad.body.error.code, 'NAME_REQUIRED');
  await okCall('POST', '/driver/application', { name: 'Cheikh Ndiaye', idDocType: 'CNI', idDocLast4: '1234', licenseLast4: '5678', licenseSince: 2015, insuranceUntil: in5, homeCity: 'Dakar', payoutProvider: 'WAVE', vehicle: { label: 'Renault Logan grise', type: 'berline', seats: 3, cargoKg: 20, plate: 'DK-1234-A' } }, driver);
  driverId = (await okCall('GET', '/me', {}, driver)).id;
  const reject = await call('POST', `/admin/drivers/${driverId}/review`, { decision: 'REJECTED' }, staff);
  assert.equal(reject.body.error.code, 'REASON_REQUIRED');
  await okCall('POST', `/admin/drivers/${driverId}/review`, { decision: 'APPROVED' }, staff);
  const n = await okCall('GET', '/me/notifications', {}, driver);
  assert.ok(n.results.some((x) => x.title.includes('validé')));
});
await test('Prix fixés par le propriétaire : le chauffeur ne fixe pas de prix et ne voit pas le prix client', async () => {
  await okCall('POST', '/admin/tariffs', { origin: 'Dakar', dest: 'Thiès', clientSeat: 2000, driverSeat: 1500, clientParcel: 1500, driverParcel: 1000 }, owner);
  assert.equal((await call('POST', '/admin/tariffs', { origin: 'Dakar', dest: 'Thiès', clientSeat: 1000, driverSeat: 1500, clientParcel: 1500, driverParcel: 1000 }, owner)).body.error.code, 'NEGATIVE_MARGIN');
  assert.equal((await call('POST', '/admin/tariffs', { origin: 'Dakar', dest: 'Mbour', clientSeat: 1, driverSeat: 1, clientParcel: 1, driverParcel: 1 }, staff)).status, 403);
  const qd = await okCall('GET', '/driver/quote?from=Thiès&to=Dakar', {}, driver);
  assert.equal(qd.perSeat, 1500); assert.equal(qd.perSeat, 1500);
  assert.equal(qd.clientSeat, undefined);
  const me = await okCall('GET', '/me', {}, driver);
  const dep = new Date(Date.now() + 26 * 3600000).toISOString();
  ({ id: tripId } = await okCall('POST', '/driver/trips', { vehicleId: me.vehicles[0].id, origin: 'Dakar', dest: 'Thiès', departureAt: dep, seats: 3, parcelKg: 12, maxDetourKm: 8 }, driver));
  const s = await okCall('GET', '/trips/search?from=Dakar&to=Thiès&seats=1');
  const mine = s.results.find((t) => t.id === tripId);
  assert.equal(mine.pricePerSeat, 2000);
});
await test('Réservation d\'une place : paiement immédiat, le chauffeur voit sa part seulement', async () => {
  const { id } = await okCall('POST', '/client/bookings', { kind: 'SEAT', tripId, seats: 2 }, client);
  const b = await okCall('GET', '/client/bookings/' + id, {}, client);
  assert.equal(b.status, 'PENDING_PAYMENT'); assert.equal(b.price, 4000); assert.equal(b.driverPay, undefined);
  await okCall('POST', `/client/bookings/${id}/pay`, { provider: 'WAVE', idempotencyKey: 'x1' }, client);
  const again = await okCall('POST', `/client/bookings/${id}/pay`, { provider: 'WAVE', idempotencyKey: 'x1' }, client);
  assert.equal(again.idempotent, true);
  const m = await okCall('GET', '/driver/bookings/' + id, {}, driver);
  assert.equal(m.price, undefined); assert.equal(m.driverPay, 3000); assert.equal(m.pickupCode, null);
  assert.equal((await call('GET', '/client/bookings/' + id, {}, driver)).status, 403);
});
await test('Places : pas de survente, réservation non payée expirée et libérée', async () => {
  const c2 = await login('774440000', 'client', 'Bineta Sy');
  const r = await call('POST', '/client/bookings', { kind: 'SEAT', tripId, seats: 2 }, c2);
  assert.equal(r.body.error.code, 'TRIP_FULL');
  const { id } = await okCall('POST', '/client/bookings', { kind: 'SEAT', tripId, seats: 1 }, c2);
  sqlDb.run(`UPDATE bookings SET expires_at = '2000-01-01' WHERE id = '${id}'`);
  await okCall('GET', '/health');
  assert.equal(sql1(`SELECT status FROM bookings WHERE id = '${id}'`), 'EXPIRED');
  assert.equal(sql1(`SELECT seats_left FROM trips WHERE id = '${tripId}'`), 1);
});
await test('Colis : matching, paiement, enlèvement, livraison, part chauffeur due', async () => {
  ({ id: pkgId } = await okCall('POST', '/client/packages', { origin: 'Dakar', dest: 'Thiès', dateFrom: today, dateTo: in5, weightKg: 4, lengthCm: 30, widthCm: 20, heightCm: 15, category: 'vetements', recipientName: 'Mame', recipientPhone: '775555555', acceptRules: true }, client));
  const m = await okCall('GET', `/client/packages/${pkgId}/matches`, {}, client);
  assert.equal(m.price, 1500);
  const all = [...m.top, ...m.alternatives];
  assert.ok(all.some((x) => x.trip.id === tripId));
  ({ id: bookingId } = await okCall('POST', '/client/bookings', { kind: 'PARCEL', tripId, packageId: pkgId }, client));
  await okCall('POST', `/client/bookings/${bookingId}/pay`, { provider: 'ORANGE_MONEY' }, client);
  const b = await okCall('GET', '/client/bookings/' + bookingId, {}, client);
  assert.equal((await call('POST', `/driver/bookings/${bookingId}/pickup`, { code: '000000' === b.pickupCode ? '111111' : '000000' }, driver)).status, 400);
  await okCall('POST', `/driver/bookings/${bookingId}/pickup`, { code: b.pickupCode }, driver);
  const track = await okCall('GET', '/track/' + b.trackToken);
  await okCall('POST', `/driver/bookings/${bookingId}/deliver`, { code: track.deliveryCode }, driver);
  const d = await okCall('GET', '/driver/bookings/' + bookingId, {}, driver);
  assert.equal(d.status, 'COMPLETED'); assert.equal(d.payoutStatus, 'DUE'); assert.equal(d.driverPay, 1000);
});
await test('Trajet en cours : position GPS du chauffeur visible par le client et l\'équipe', async () => {
  sqlDb.run(`UPDATE trips SET departure_at = '${new Date(Date.now() + 3600000).toISOString()}' WHERE id = '${tripId}'`);
  await okCall('POST', `/driver/trips/${tripId}/start`, {}, driver);
  await okCall('POST', `/driver/trips/${tripId}/position`, { lat: 14.75, lng: -17.2, accuracy: 15 }, driver);
  assert.equal((await call('POST', `/driver/trips/${tripId}/position`, { lat: 48.8, lng: 2.3 }, driver)).status, 400);
  const seatB = sql1(`SELECT id FROM bookings WHERE trip_id = '${tripId}' AND kind = 'SEAT' AND status = 'PAID'`);
  const cb = await okCall('GET', '/client/bookings/' + seatB, {}, client);
  assert.equal(cb.live.source, 'gps');
  const live = await okCall('GET', '/admin/live', {}, staff);
  assert.ok(live.live.some((t) => t.id === tripId));
  await okCall('POST', `/driver/bookings/${seatB}/pickup`, { code: cb.pickupCode }, driver);
  await okCall('POST', `/driver/trips/${tripId}/complete`, {}, driver);
  await okCall('POST', `/client/bookings/${seatB}/review`, { rating: 5, comment: 'Parfait' }, client);
});
await test('Reversement : seul le propriétaire paie le chauffeur, après le délai', async () => {
  sqlDb.run(`UPDATE bookings SET payout_due_at = '2000-01-01' WHERE driver_id = '${driverId}' AND payout_status = 'DUE'`);
  const p = await okCall('GET', '/admin/payouts', {}, owner);
  const row = p.owed.find((x) => x.driver_id === driverId);
  assert.equal(row.available, 3000 + 1000);
  assert.equal((await call('POST', '/admin/payouts', { driverId, reference: 'WV-1' }, staff)).status, 403);
  const r = await okCall('POST', '/admin/payouts', { driverId, reference: 'WV-TEST-1' }, owner);
  assert.equal(r.amount, 4000);
  const e = await okCall('GET', '/driver/earnings', {}, driver);
  assert.equal(e.totals.paid, 4000);
});
await test('Contrôle : suspension d\'un chauffeur (trajets retirés, clients remboursés), puis réactivation', async () => {
  const me = await okCall('GET', '/me', {}, driver);
  const dep = new Date(Date.now() + 50 * 3600000).toISOString();
  const { id: t2 } = await okCall('POST', '/driver/trips', { vehicleId: me.vehicles[0].id, origin: 'Thiès', dest: 'Dakar', departureAt: dep, seats: 3, parcelKg: 0 }, driver);
  const { id: bk } = await okCall('POST', '/client/bookings', { kind: 'SEAT', tripId: t2, seats: 1 }, client);
  await okCall('POST', `/client/bookings/${bk}/pay`, { provider: 'WAVE' }, client);
  assert.equal((await call('POST', `/admin/users/${driverId}/suspend`, { days: 7 }, staff)).body.error.code, 'REASON_REQUIRED');
  await okCall('POST', `/admin/users/${driverId}/suspend`, { days: 7, reason: 'Retards répétés signalés par les clients' }, staff);
  assert.equal((await call('GET', '/me', {}, driver)).status, 401);
  const r = await call('POST', '/auth/otp/request', { phone: '773330000', space: 'driver' });
  assert.equal(r.body.error.code, 'ACCOUNT_SUSPENDED'); assert.match(r.body.error.message, /Retards/);
  assert.equal(sql1(`SELECT status FROM trips WHERE id = '${t2}'`), 'SUSPENDED');
  const cb = await okCall('GET', '/client/bookings/' + bk, {}, client);
  assert.equal(cb.status, 'REFUNDED'); assert.equal(cb.refundAmount, 2000);
  assert.equal((await call('POST', `/admin/users/${driverId}/block`, { reason: 'x' }, staff)).body.error.code, 'SUPER_ONLY');
  await okCall('POST', `/admin/users/${driverId}/reactivate`, { reason: 'Engagement de ponctualité' }, owner);
  driver = await login('773330000', 'driver');
  const detail = await okCall('GET', `/admin/users/${driverId}`, {}, owner);
  assert.deepEqual(detail.sanctions.map((s) => s.type).sort(), ['REACTIVATION', 'SUSPENSION']);
});
await test('Signalement client → chauffeur, clos avec avertissement', async () => {
  await okCall('POST', `/bookings/${bookingId}/report`, { category: 'COMPORTEMENT', details: 'Ton désagréable au moment de la remise.' }, client);
  const list = await okCall('GET', '/admin/incidents', {}, staff);
  const inc = list.results.find((i) => i.target_id === driverId && i.status === 'OPEN' && i.category === 'COMPORTEMENT');
  await okCall('POST', `/admin/incidents/${inc.id}/close`, { action: 'WARN', reason: 'Rappel des règles de courtoisie' }, staff);
  assert.equal(sql1(`SELECT warnings FROM users WHERE id = '${driverId}'`), 1);
});
await test('Messagerie : numéros toujours masqués', async () => {
  const r = await okCall('POST', `/bookings/${bookingId}/messages`, { body: 'Appelle-moi au 77 123 45 67' }, client);
  assert.equal(r.masked, true);
});
await test('Actualités et alertes : publiées par l\'équipe, visibles par tous', async () => {
  await okCall('POST', '/admin/news', { title: 'Ouverture de l\'axe Dakar – Mbour', summary: 'Nouveaux trajets.', body: 'Texte', category: 'ANNONCE', publish: true, notify: true }, staff);
  const n = await okCall('GET', '/news');
  assert.ok(n.results.some((x) => x.title.includes('Mbour')));
  await okCall('POST', '/admin/alerts', { area: 'Thiès', level: 'ATTENTION', message: 'Travaux à l\'entrée de Thiès', hours: 12 }, staff);
  assert.ok((await okCall('GET', '/alerts')).results.some((a) => a.area === 'Thiès'));
  const nc = await okCall('GET', '/me/notifications', {}, client);
  assert.ok(nc.results.some((x) => x.kind === 'news'));
});
await test('Équipe : le propriétaire ajoute puis retire un membre', async () => {
  const { id } = await okCall('POST', '/admin/team', { phone: '776660000', name: 'Fatou (support)' }, owner);
  assert.equal((await call('POST', '/admin/team', { phone: '776660001', name: 'X' }, staff)).status, 403);
  await login('776660000', 'admin');
  await okCall('POST', `/admin/team/${id}/revoke`, {}, owner);
  assert.equal((await call('POST', '/auth/otp/request', { phone: '776660000', space: 'admin' })).status, 403);
});
await test('Tableau de bord : chiffre d\'affaires, marge, dû aux chauffeurs', async () => {
  const s = await okCall('GET', '/admin/stats', {}, owner);
  assert.ok(s.revenue > 0 && s.margin > 0 && s.days.length === 14);
  assert.ok(s.margin < s.revenue);
});
await test('API partenaire : éligibilité au prix du propriétaire, envoi confirmé, webhooks', async () => {
  const { apiKey } = await okCall('POST', '/client/partner', { name: 'Keur Mode' }, client);
  const H = { 'x-api-key': apiKey };
  const me = await okCall('GET', '/me', {}, driver);
  await okCall('POST', '/driver/trips', { vehicleId: me.vehicles[0].id, origin: 'Dakar', dest: 'Thiès', departureAt: new Date(Date.now() + 30 * 3600000).toISOString(), seats: 3, parcelKg: 15 }, driver);
  const el = await okCall('POST', '/partner/v1/eligibility', { from: 'Dakar', to: 'Thiès', weightKg: 2, dateTo: in5 }, null, H);
  assert.equal(el.eligible, true); assert.equal(el.price, 1500);
  const sh = await okCall('POST', '/partner/v1/shipments', { from: 'Dakar', to: 'Thiès', weightKg: 2, category: 'vetements', recipientName: 'Client', recipientPhone: '779999999', dateTo: in5, externalRef: 'CMD-42' }, null, H);
  const st = await okCall('GET', '/partner/v1/shipments/' + sh.shipmentId, {}, null, H);
  assert.equal(st.bookingStatus, 'PAID'); assert.ok(st.pickupCode);
  assert.ok((await okCall('GET', '/client/partner', {}, client)).events.some((e) => e.event === 'shipment.confirmed'));
});

await test('Références uniques et lisibles : client, chauffeur, trajet, colis, réservation', async () => {
  const me = await okCall('GET', '/me', {}, client); assert.match(me.ref, /^CL-\d{5}$/);
  const d = await okCall('GET', '/me', {}, driver); assert.match(d.ref, /^CH-\d{4}$/);
  const b = await okCall('GET', '/client/bookings/' + bookingId, {}, client); assert.match(b.ref, /^RES-\d{2}-\d{5}$/);
  assert.match(b.trip.ref, /^TR-\d{2}-\d{5}$/); assert.match(b.package.ref, /^COL-\d{2}-\d{5}$/);
  const refs = sqlDb.exec('SELECT ref FROM bookings')[0].values.map((r) => r[0]);
  assert.equal(new Set(refs).size, refs.length);
});
await test('Types d\'envoi : passeport au forfait sans poids, type ajouté par le propriétaire', async () => {
  const types = await okCall('GET', '/parcel-types');
  assert.ok(types.results.some((t) => t.code === 'PASSEPORT' && t.mode === 'FLAT'));
  await okCall('POST', '/admin/parcel-types', { code: 'CNI', label: 'Carte d\'identité', mode: 'FLAT', clientBase: 2500, driverBase: 1500, idCheck: true }, owner);
  assert.equal((await call('POST', '/admin/parcel-types', { code: 'X1', label: 'X', mode: 'FLAT', clientBase: 1000, driverBase: 2000 }, owner)).body.error.code, 'NEGATIVE_MARGIN');
  const q = await okCall('GET', '/quote?from=Dakar&to=Ziguinchor&type=CNI');
  assert.equal(q.parcel, 2500); assert.equal(q.weightKg, null);
  const { id, ref } = await okCall('POST', '/client/packages', { type: 'PASSEPORT', origin: 'Dakar', dest: 'Thiès', dateFrom: today, dateTo: in5, recipientName: 'Fatou Sarr', recipientPhone: '776665544', acceptRules: true }, client);
  assert.match(ref, /^COL-/);
  const pk = await okCall('GET', '/client/packages/' + id, {}, client);
  assert.equal(pk.type, 'PASSEPORT'); assert.ok(pk.idCheck); assert.ok(pk.price >= 3000);
});
await test('Code promo : remise sur la marge, part chauffeur intacte, facture puis avoir', async () => {
  await okCall('POST', '/admin/promos', { code: 'TABASKI', kind: 'PERCENT', value: 10, applies: 'SEAT', maxUses: 10 }, owner);
  const me = await okCall('GET', '/me', {}, driver);
  const { id: tid } = await okCall('POST', '/driver/trips', { vehicleId: me.vehicles[0].id, origin: 'Dakar', dest: 'Thiès', departureAt: new Date(Date.now() + 60 * 3600000).toISOString(), seats: 3, parcelKg: 5 }, driver);
  const { id } = await okCall('POST', '/client/bookings', { kind: 'SEAT', tripId: tid, seats: 1 }, client);
  assert.equal((await call('POST', `/client/bookings/${id}/promo`, { code: 'FAUX' }, client)).body.error.code, 'PROMO_INVALID');
  const pr = await okCall('POST', `/client/bookings/${id}/promo`, { code: 'tabaski' }, client);
  assert.equal(pr.discount, 200); assert.equal(pr.price, 1800);
  await okCall('POST', `/client/bookings/${id}/pay`, { provider: 'WAVE' }, client);
  const d = await okCall('GET', '/driver/bookings/' + id, {}, driver); assert.equal(d.driverPay, 1500);
  const b = await okCall('GET', '/client/bookings/' + id, {}, client);
  assert.equal(b.invoices.length, 1); assert.match(b.invoices[0].number, /^FAC-\d{4}-\d{5}$/);
  const inv = await okCall('GET', '/invoices/' + b.invoices[0].id, {}, client);
  assert.equal(inv.total, 1800); assert.equal(inv.lines.length, 2); assert.equal(inv.company.name, 'Bokk Yoon');
  assert.equal((await call('GET', '/invoices/' + b.invoices[0].id, {}, driver)).status, 404);
  await okCall('POST', `/client/bookings/${id}/cancel`, {}, client);
  const after = await okCall('GET', '/client/bookings/' + id, {}, client);
  const av = after.invoices.find((i) => i.kind === 'CREDIT_NOTE'); assert.ok(av); assert.equal(av.total, -1800); assert.match(av.number, /^AV-/);
});
await test('Facture manuelle professionnelle et designer (TVA, logo, couleur)', async () => {
  await okCall('PUT', '/admin/company', { name: 'Bokk Yoon', legalName: 'Bokk Yoon SARL', ninea: '0123456789', vatEnabled: true, vatRate: 18, accent: '#1F5F99', template: 'classique', whatsapp: '771234567', email: 'contact@bokkyoon.sn' }, owner);
  assert.equal((await call('PUT', '/admin/company', { name: 'X' }, staff)).status, 403);
  const { id, number } = await okCall('POST', '/admin/invoices', { customer: { name: 'Keur Mode SARL', ninea: '999' }, lines: [{ label: 'Livraisons de septembre', qty: 12, unit: 1500 }], status: 'DUE' }, staff);
  const inv = await okCall('GET', '/invoices/' + id, {}, owner);
  assert.equal(inv.total, 18000); assert.equal(inv.vat_amount, 2746); assert.equal(inv.company.template, 'classique');
  assert.match(number, /^FAC-/);
});
await test('Contact : formulaire public, e-mail au propriétaire, réponse de l\'équipe, suivi par le client', async () => {
  const pub = await okCall('POST', '/contact', { name: 'Ndeye Fall', phone: '775554433', category: 'PARTENARIAT', subject: 'Boutique à Thiès', message: 'Je voudrais livrer mes clients à Dakar chaque semaine.' });
  assert.match(pub.ref, /^SUP-\d{2}-\d{4}$/); assert.equal(pub.emailForward, 'NOT_CONFIGURED');
  const mine = await okCall('POST', '/contact', { category: 'QUESTION', subject: 'Facture', message: 'Puis-je avoir la facture au nom de ma société ?' }, null, { authorization: 'Bearer ' + client });
  const list = await okCall('GET', '/admin/tickets?status=OPEN', {}, staff);
  assert.ok(list.results.length >= 2);
  await okCall('POST', `/admin/tickets/${mine.id}/reply`, { body: 'Oui, envoyez-nous le nom et le NINEA de votre société.' }, staff);
  const t = await okCall('GET', '/me/tickets/' + mine.id, {}, client);
  assert.equal(t.status, 'ANSWERED'); assert.equal(t.messages.length, 2); assert.equal(t.messages[1].from_team, 1);
});
await test('Formulaire de retour (0 à 10), recherche par référence, exports, relevé chauffeur, régions', async () => {
  await okCall('POST', `/client/bookings/${bookingId}/feedback`, { score: 9, liked: 'Rapide' }, client);
  const s = await okCall('GET', '/admin/stats', {}, owner); assert.ok(s.nps.count >= 1);
  const me = await okCall('GET', '/me', {}, client);
  const sr = await okCall('GET', '/admin/search?q=' + me.ref, {}, staff); assert.ok(sr.results.some((r) => r.ref === me.ref));
  const ex = await okCall('GET', '/admin/export/reservations', {}, owner); assert.match(ex.csv, /reference;type;statut/);
  const st = await okCall('GET', '/driver/statement', {}, driver); assert.ok(st.totals.earned > 0); assert.match(st.driver.ref, /^CH-/);
  const rg = await okCall('GET', '/admin/regions', {}, owner); assert.equal(rg.results.length, 14); assert.ok(rg.results.find((r) => r.region === 'Dakar').bookings > 0);
});

await test('Paiement par QR code Wave du propriétaire : déclaration, vérification, confirmation, refus', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await call('PUT', '/admin/payment', { mode: 'QR', wave: { enabled: true } }, owner)).body.error.code, 'QR_REQUIRED');
  assert.equal((await call('PUT', '/admin/payment', { mode: 'QR', wave: { enabled: true, qr: png } }, staff)).status, 403);
  await okCall('PUT', '/admin/payment', { mode: 'QR', wave: { enabled: true, qr: png, number: '77 000 00 00', name: 'Bokk Yoon' }, orange: { enabled: false } }, owner);
  const pm = await okCall('GET', '/payment-methods'); assert.equal(pm.mode, 'QR'); assert.ok(pm.wave.qr); assert.equal(pm.orange, null);
  const c3 = await login('775550001', 'client', 'Binta Sarr');
  const s = await okCall('GET', '/trips/search?from=Dakar&to=Thiès&seats=1');
  const { id } = await okCall('POST', '/client/bookings', { kind: 'SEAT', tripId: s.results[0].id, seats: 1 }, c3);
  assert.equal((await call('POST', `/client/bookings/${id}/pay`, { provider: 'WAVE' }, c3)).body.error.code, 'MANUAL_PAYMENT');
  assert.equal((await call('POST', `/client/bookings/${id}/payment-claim`, { provider: 'ORANGE_MONEY', transactionRef: 'OM123456' }, c3)).status, 400);
  const cl = await okCall('POST', `/client/bookings/${id}/payment-claim`, { provider: 'WAVE', transactionRef: 't_abc 12345' }, c3);
  assert.match(cl.ref, /^PAI-/);
  assert.equal((await call('POST', `/client/bookings/${id}/payment-claim`, { provider: 'WAVE', transactionRef: 'T_OTHER999' }, c3)).body.error.code, 'ALREADY');
  assert.equal((await call('POST', `/client/bookings/${id}/cancel`, {}, c3)).body.error.code, 'CLAIM_PENDING');
  // L'expiration ne libère pas une réservation dont le paiement est en vérification
  sqlDb.run("UPDATE bookings SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", [id]);
  const st = await okCall('GET', '/admin/stats', {}, staff); assert.ok(st.claimsPending >= 1);
  const list = await okCall('GET', '/admin/payment-claims?status=PENDING', {}, staff);
  const claim = list.results.find((x) => x.booking_id === id); assert.equal(claim.transaction_ref, 'T_ABC12345');
  await okCall('POST', `/admin/payment-claims/${claim.id}/approve`, {}, staff);
  const b = await okCall('GET', `/client/bookings/${id}`, {}, c3);
  assert.equal(b.status, 'PAID'); assert.ok(b.pickupCode); assert.equal(b.payment.provider_ref, 'T_ABC12345'); assert.ok(b.invoices.length);
  // Refus : ID réutilisé interdit, refus avec motif rouvre 30 min
  const { id: id2 } = await okCall('POST', '/client/bookings', { kind: 'SEAT', tripId: s.results[1]?.id || s.results[0].id, seats: 1 }, c3);
  assert.equal((await call('POST', `/client/bookings/${id2}/payment-claim`, { provider: 'WAVE', transactionRef: 'T_ABC12345' }, c3)).body.error.code, 'TXN_USED');
  await okCall('POST', `/client/bookings/${id2}/payment-claim`, { provider: 'WAVE', transactionRef: 'T_FAUX0001' }, c3);
  const c2 = (await okCall('GET', '/admin/payment-claims?status=PENDING', {}, owner)).results.find((x) => x.booking_id === id2);
  assert.equal((await call('POST', `/admin/payment-claims/${c2.id}/reject`, {}, owner)).status, 400);
  await okCall('POST', `/admin/payment-claims/${c2.id}/reject`, { reason: 'Transaction introuvable' }, owner);
  const b2 = await okCall('GET', `/client/bookings/${id2}`, {}, c3); assert.equal(b2.status, 'PENDING_PAYMENT'); assert.equal(b2.claim.status, 'REJECTED');
  await okCall('PUT', '/admin/payment', { mode: 'SIMULATION', wave: { enabled: true, qr: png }, orange: { enabled: false } }, owner);
});

console.log(`\n${passed} tests réussis.`);
