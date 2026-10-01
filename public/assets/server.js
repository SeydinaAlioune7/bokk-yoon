// Bokk Yoon â€” API mÃ©tier (modÃ¨le opÃ©rateur, espaces sÃ©parÃ©s client / chauffeur / Ã©quipe).
// ExÃ©cutÃ©e par le Worker Cloudflare (src/worker.js) (env.DB = D1) et par le mode dÃ©mo navigateur (sql.js imitant D1).

import {
  CITIES, REGIONS, cityByName, CATEGORIES, FORBIDDEN, LIMITS, WEIGHTS, ALGO_VERSION, DEFAULT_SETTINGS, DEFAULT_PARCEL_TYPES,
  quote, parcelAmounts, flatAmounts, roadKm, validatePackage, matchPackageTrip, rankMatches, projectOnSegment, estimatePosition,
} from './core.js';

class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const ok = (body, status = 200) => ({ status, body });

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (t) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const randomDigits = (n) => { const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map((x) => x % 10).join(''); };
const randomHex = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); };
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : NaN; };
const addHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const slugify = (s) => str(s, 80).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'article';

export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s.\-()]/g, '');
  if (/^00\d+/.test(p)) p = '+' + p.slice(2);
  if (/^[7]\d{8}$/.test(p)) p = '+221' + p;
  if (!/^\+\d{8,15}$/.test(p)) fail(400, 'PHONE_INVALID', 'NumÃ©ro de tÃ©lÃ©phone invalide (ex. 77 123 45 67).');
  return p;
}
const maskPhone = (p) => (p ? p.slice(0, 4) + ' â€¢â€¢ â€¢â€¢â€¢ ' + p.slice(-2) : '');
const firstName = (n) => String(n || 'Membre').split(/\s+/).slice(0, 2).join(' ');

function db(env) {
  const D = env.DB;
  return {
    all: async (sql, ...p) => (await D.prepare(sql).bind(...p).all()).results || [],
    first: async (sql, ...p) => (await D.prepare(sql).bind(...p).first()) || null,
    run: async (sql, ...p) => { const r = await D.prepare(sql).bind(...p).run(); return r.meta?.changes ?? r.changes ?? 0; },
  };
}
const audit = (q, actor, action, type, id, details = {}) => q.run('INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, details, created_at) VALUES (?,?,?,?,?,?,?)', uid(), actor || null, action, type, id, JSON.stringify(details), nowIso());
const notify = (q, userId, title, body = '', link = '', kind = 'info') => q.run('INSERT INTO notifications (id, user_id, title, body, link, kind, created_at) VALUES (?,?,?,?,?,?,?)', uid(), userId, title, body, link, kind, nowIso());

// ---------- RÃ©fÃ©rences lisibles ----------
const REF = { client: ['CL', 5, false], driver: ['CH', 4, false], admin: ['EQ', 2, false], superadmin: ['EQ', 2, false], trips: ['TR', 5, true], packages: ['COL', 5, true],
  bookings: ['RES', 5, true], payouts: ['VER', 4, true], disputes: ['LIT', 4, true], incidents: ['SIG', 4, true], tickets: ['SUP', 4, true], payment_claims: ['PAI', 4, true] };
async function nextNumber(q, key) { return (await q.first('INSERT INTO counters (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value', key)).value; }
async function makeRef(q, kind) {
  const [p, w, yearly] = REF[kind]; const key = yearly ? `${p}-${String(new Date().getUTCFullYear()).slice(2)}` : p;
  return `${key}-${String(await nextNumber(q, key)).padStart(w, '0')}`;
}
async function setRef(q, table, id, kind) { const ref = await makeRef(q, kind || table); await q.run(`UPDATE ${table} SET ref = ? WHERE id = ?`, ref, id); return ref; }
async function backfillRefs(q) {
  for (const u of await q.all('SELECT id, role FROM users WHERE ref IS NULL ORDER BY created_at')) await setRef(q, 'users', u.id, u.role);
  for (const t of ['trips', 'packages', 'bookings', 'payouts', 'disputes', 'incidents', 'tickets']) for (const r of await q.all(`SELECT id FROM ${t} WHERE ref IS NULL ORDER BY created_at`)) await setRef(q, t, r.id, t);
}

// ---------- E-mail (propriÃ©taire, rÃ©ponses aux messages) ----------
async function sendEmail(env, to, subject, text) {
  if (!to) return 'NO_RECIPIENT';
  try {
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM || 'Bokk Yoon <notifications@bokkyoon.sn>', to: [to], subject, text }) });
      return 'HTTP_' + r.status;
    }
    if (env.EMAIL_WEBHOOK_URL) { const r = await fetch(env.EMAIL_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, subject, text }) }); return 'HTTP_' + r.status; }
  } catch { return 'FAILED'; }
  return 'NOT_CONFIGURED';
}
async function notifyTeam(q, title, body, link) {
  for (const a of await q.all("SELECT id FROM users WHERE role IN ('admin','superadmin') AND status = 'active'")) await notify(q, a.id, title, body, link, 'message');
}

// ---------- Types d'envoi (forfaits dÃ©finis par le propriÃ©taire) ----------
async function getParcelTypes(q, all = false) {
  let rows = await q.all('SELECT * FROM parcel_types ORDER BY sort, label');
  if (!rows.length) {
    for (const t of DEFAULT_PARCEL_TYPES) await q.run('INSERT INTO parcel_types (id, code, label, description, mode, client_base, driver_base, client_per_km, driver_per_km, nominal_kg, id_check, sort, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid(), t.code, t.label, t.description, t.mode, t.client_base, t.driver_base, t.client_per_km, t.driver_per_km, t.nominal_kg, t.id_check, t.sort, nowIso());
    rows = await q.all('SELECT * FROM parcel_types ORDER BY sort, label');
  }
  return all ? rows : rows.filter((r) => r.active);
}
async function parcelPrice(q, typeCode, A, B, weightKg) {
  const t = (await getParcelTypes(q, true)).find((x) => x.code === typeCode);
  if (!t || !t.active) fail(400, 'TYPE_INVALID', 'Type d\'envoi indisponible.');
  if (t.mode === 'WEIGHT') return { ...parcelAmounts(await quoteFor(q, A, B), weightKg), type: t };
  const s = await getSettings(q);
  return { ...flatAmounts(t, roadKm(A, B), s.pricing.rounding), type: t };
}

// ---------- Codes promo ----------
async function checkPromo(q, code, kind, amount, customerId) {
  const p = await q.first('SELECT * FROM promo_codes WHERE code = ?', str(code, 30).toUpperCase());
  if (!p || !p.active) fail(400, 'PROMO_INVALID', 'Code promo inconnu ou dÃ©sactivÃ©.');
  if (p.expires_at && p.expires_at < nowIso()) fail(400, 'PROMO_EXPIRED', 'Ce code promo a expirÃ©.');
  if (p.max_uses && p.used >= p.max_uses) fail(400, 'PROMO_USED_UP', 'Ce code promo n\'est plus disponible.');
  if (p.applies !== 'ALL' && p.applies !== kind) fail(400, 'PROMO_NOT_APPLICABLE', p.applies === 'SEAT' ? 'Ce code est valable sur les places uniquement.' : 'Ce code est valable sur les colis uniquement.');
  if (await q.first("SELECT id FROM bookings WHERE customer_id = ? AND promo_code = ? AND status IN ('PAID','IN_PROGRESS','COMPLETED')", customerId, p.code)) fail(400, 'PROMO_ALREADY', 'Vous avez dÃ©jÃ  utilisÃ© ce code.');
  const discount = Math.min(amount, p.kind === 'PERCENT' ? Math.round((amount * p.value) / 100 / 50) * 50 : p.value);
  return { code: p.code, discount, label: p.label };
}

// ---------- Factures et avoirs ----------
async function nextInvoiceNumber(q, prefix) { const y = new Date().getUTCFullYear(); return `${prefix}-${y}-${String(await nextNumber(q, `${prefix}-${y}`)).padStart(5, '0')}`; }
function vatOf(total, company) { if (!company.vatEnabled) return { rate: 0, amount: 0 }; const rate = Number(company.vatRate) || 0; return { rate, amount: Math.round(total - total / (1 + rate / 100)) }; }
async function invoiceForBooking(q, b, status = 'PAID') {
  if (await q.first("SELECT id FROM invoices WHERE booking_id = ? AND kind = 'INVOICE'", b.id)) return;
  const s = await getSettings(q), c = await q.first('SELECT name, phone, email FROM users WHERE id = ?', b.customer_id);
  const t = await q.first('SELECT ref, departure_at FROM trips WHERE id = ?', b.trip_id);
  const p = b.package_id ? await q.first('SELECT p.ref, p.type_code, pt.label type_label, p.weight_kg FROM packages p LEFT JOIN parcel_types pt ON pt.code = p.type_code WHERE p.id = ?', b.package_id) : null;
  const dep = new Date(t.departure_at).toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar', day: 'numeric', month: 'long', year: 'numeric' });
  const list = b.list_price ?? b.price;
  const lines = b.kind === 'SEAT'
    ? [{ label: `Transport de voyageur ${b.from_city} â†’ ${b.to_city}, dÃ©part le ${dep} (trajet ${t.ref || ''}, rÃ©servation ${b.ref || ''})`, qty: b.seats, unit: Math.round(list / b.seats) }]
    : [{ label: `${p?.type_label || 'Colis'} ${p?.type_code === 'COLIS' ? String(p.weight_kg).replace('.', ',') + ' kg ' : ''}${b.from_city} â†’ ${b.to_city}, dÃ©part le ${dep} (envoi ${p?.ref || ''}, rÃ©servation ${b.ref || ''})`, qty: 1, unit: list }];
  if (b.discount) lines.push({ label: `Remise code promo ${b.promo_code}`, qty: 1, unit: -b.discount });
  lines.forEach((l) => { l.total = l.qty * l.unit; });
  const vat = vatOf(b.price, s.company);
  await q.run('INSERT INTO invoices (id, number, kind, booking_id, customer_id, customer, lines, total, vat_rate, vat_amount, status, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    uid(), await nextInvoiceNumber(q, 'FAC'), 'INVOICE', b.id, b.customer_id, JSON.stringify({ name: c.name, phone: c.phone, email: c.email }), JSON.stringify(lines), b.price, vat.rate, vat.amount, status, nowIso());
}
async function creditNoteForBooking(q, b, amount, reason) {
  if (!amount) return;
  const s = await getSettings(q), inv = await q.first("SELECT number, customer FROM invoices WHERE booking_id = ? AND kind = 'INVOICE'", b.id);
  const vat = vatOf(amount, s.company);
  await q.run('INSERT INTO invoices (id, number, kind, booking_id, customer_id, customer, lines, total, vat_rate, vat_amount, status, issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    uid(), await nextInvoiceNumber(q, 'AV'), 'CREDIT_NOTE', b.id, b.customer_id, inv?.customer || '{}',
    JSON.stringify([{ label: `Remboursement ${inv ? 'sur la facture ' + inv.number : ''} (rÃ©servation ${b.ref || ''}) : ${reason}`, qty: 1, unit: -amount, total: -amount }]), -amount, vat.rate, -vat.amount, 'PAID', nowIso());
}
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]); const cell = (v) => { const x = v == null ? '' : String(v); return /[";\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  return '\ufeff' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\n');
}

async function sendSms(env, phone, text) {
  // Brancher ici le fournisseur SMS (API Orange SMS, etc.) via env.SMS_WEBHOOK_URL.
  if (env.SMS_WEBHOOK_URL) {
    try { await fetch(env.SMS_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SMS_TOKEN || ''}` }, body: JSON.stringify({ to: phone, text }) }); } catch { /* journaliser en production */ }
  }
}

// ---------- RÃ©glages et tarifs (fixÃ©s par le propriÃ©taire) ----------
async function getSettings(q) {
  const rows = await q.all('SELECT key, value FROM settings');
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) { try { s[r.key] = { ...(s[r.key] || {}), ...JSON.parse(r.value) }; } catch { /* valeur corrompue ignorÃ©e */ } }
  return s;
}
const getTariffs = (q) => q.all('SELECT * FROM tariffs ORDER BY origin, dest');
async function quoteFor(q, A, B) { return quote(await getSettings(q), await getTariffs(q), A, B); }

const payMode = (ps, env) => (ps.mode === 'AUTO' ? (env.MODE === 'cloud' ? 'QR' : 'SIMULATION') : ps.mode);
const fmtAmount = (n) => Math.round(n).toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ');
/** Encaissement confirmÃ© (simulation, QR vÃ©rifiÃ© par l'Ã©quipe, ou webhook du prestataire) : codes, facture, notifications. */
async function capturePayment(q, env, b, t, provider, providerRef, actorId, { simulated = false, idempotencyKey = null, verifiedBy = null } = {}) {
  const now = nowIso(), pid = uid();
  await q.run("INSERT INTO payments (id, booking_id, provider, provider_ref, amount, status, idempotency_key, created_at) VALUES (?,?,?,?,?,'CAPTURED',?,?)", pid, b.id, provider, providerRef, b.price, idempotencyKey, now);
  const track = b.kind === 'PARCEL' ? randomHex(12) : null;
  await q.run("UPDATE bookings SET status = 'PAID', pickup_code = ?, delivery_code = ?, track_token = ?, expires_at = NULL, updated_at = ? WHERE id = ?", randomDigits(6), b.kind === 'PARCEL' ? randomDigits(6) : null, track, now, b.id);
  if (b.promo_code) await q.run('UPDATE promo_codes SET used = used + 1 WHERE code = ?', b.promo_code);
  await invoiceForBooking(q, { ...b, status: 'PAID' });
  if (b.package_id) {
    await q.run("UPDATE packages SET status = 'PAID' WHERE id = ?", b.package_id);
    const p = await q.first('SELECT recipient_phone FROM packages WHERE id = ?', b.package_id);
    await sendSms(env, p.recipient_phone, `Bokk Yoon : un colis arrive pour vous. Suivi et code de rÃ©ception : ${env.APP_URL || ''}/app/#/suivi/${track}`);
  }
  await notify(q, b.driver_id, b.kind === 'PARCEL' ? 'Nouveau colis confirmÃ©' : 'Nouvelle rÃ©servation confirmÃ©e', `${b.from_city} â†’ ${b.to_city} Â· ${fmtDay(t.departure_at)} Â· vous recevrez ${b.driver_pay.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA`, `#/mission/${b.id}`, 'success');
  await audit(q, actorId, 'payment.captured', 'booking', b.id, { provider, amount: b.price, simulated, verifiedBy });
  return pid;
}

// ---------- TÃ¢ches de fond lÃ©gÃ¨res (exÃ©cutÃ©es Ã  chaque requÃªte) ----------
async function housekeeping(q) {
  const now = nowIso();
  const expired = await q.all("SELECT * FROM bookings WHERE status = 'PENDING_PAYMENT' AND expires_at < ? AND NOT EXISTS (SELECT 1 FROM payment_claims c WHERE c.booking_id = bookings.id AND c.status = 'PENDING')", now);
  for (const b of expired) {
    await q.run("UPDATE bookings SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = 'PENDING_PAYMENT'", now, b.id);
    await releaseCapacity(q, b);
    if (b.package_id) await q.run("UPDATE packages SET status = 'CREATED' WHERE id = ? AND status = 'BOOKED'", b.package_id);
  }
  const back = await q.all("SELECT id FROM users WHERE status = 'suspended' AND suspended_until IS NOT NULL AND suspended_until < ?", now);
  for (const u of back) {
    await q.run("UPDATE users SET status = 'active', suspended_until = NULL WHERE id = ?", u.id);
    await q.run("INSERT INTO sanctions (id, user_id, type, reason, by_id, created_at) VALUES (?,?,'REACTIVATION','Fin de suspension automatique',?,?)", uid(), u.id, u.id, now);
  }
}
async function releaseCapacity(q, b) {
  if (b.kind === 'SEAT') await q.run("UPDATE trips SET seats_left = seats_left + ?, status = CASE WHEN status = 'FULL' THEN 'PUBLISHED' ELSE status END WHERE id = ?", b.seats, b.trip_id);
  else { const p = await q.first('SELECT weight_kg FROM packages WHERE id = ?', b.package_id); if (p) await q.run('UPDATE trips SET parcel_kg_left = parcel_kg_left + ? WHERE id = ?', p.weight_kg, b.trip_id); }
}

// ---------- Profils, statistiques ----------
async function userStats(q, userId) {
  const u = await q.first('SELECT created_at, status, warnings, role FROM users WHERE id = ?', userId);
  const r = await q.first('SELECT COUNT(*) n, AVG(rating) avg FROM reviews WHERE target_id = ? AND hidden = 0', userId);
  const dp = await q.first('SELECT status FROM driver_profiles WHERE user_id = ?', userId);
  const trips = await q.first("SELECT COUNT(*) n FROM trips WHERE driver_id = ? AND status = 'COMPLETED'", userId);
  const parcels = await q.first("SELECT COUNT(*) n FROM bookings WHERE driver_id = ? AND kind = 'PARCEL' AND status = 'COMPLETED'", userId);
  const declines = await q.first("SELECT COUNT(*) n FROM bookings WHERE driver_id = ? AND cancel_reason LIKE 'driver:%'", userId);
  const tripCancels = await q.first("SELECT COUNT(*) n FROM trips WHERE driver_id = ? AND status = 'CANCELLED'", userId);
  const asClient = await q.first("SELECT COUNT(*) n FROM bookings WHERE customer_id = ? AND status = 'COMPLETED'", userId);
  const cancels = (declines?.n || 0) + (tripCancels?.n || 0), done = trips?.n || 0;
  return {
    ratingAvg: r?.avg ? Math.round(r.avg * 10) / 10 : 0, ratingCount: r?.n || 0,
    trips: done, parcels: parcels?.n || 0, asClient: asClient?.n || 0, cancels,
    cancelRate: done + cancels ? Math.round((cancels / (done + cancels)) * 100) : 0,
    accountDays: u ? Math.floor((Date.now() - new Date(u.created_at)) / 86400000) : 0,
    approved: dp?.status === 'APPROVED', active: u?.status === 'active', warnings: u?.warnings || 0,
  };
}
async function publicUser(q, userId) {
  const u = await q.first('SELECT id, ref, name, bio, role, city, created_at FROM users WHERE id = ?', userId);
  if (!u || !['client', 'driver'].includes(u.role)) return null;
  const stats = await userStats(q, userId);
  const v = u.role === 'driver' ? await q.first('SELECT label, type FROM vehicles WHERE owner_id = ? ORDER BY created_at LIMIT 1', userId) : null;
  return { id: u.id, ref: u.ref, name: firstName(u.name), bio: u.bio, role: u.role, city: u.city, memberSince: u.created_at, stats, vehicle: v, verified: u.role === 'driver' ? stats.approved : true };
}

// ---------- Authentification et espaces ----------
const SPACE_ROLES = { client: ['client', 'admin', 'superadmin'], driver: ['driver', 'admin', 'superadmin'], admin: ['admin', 'superadmin'] };
const SPACE_LABEL = { client: 'l\'espace client', driver: 'l\'espace chauffeur', admin: 'l\'espace Ã©quipe' };
const roleSpace = (role) => (role === 'client' ? 'client' : role === 'driver' ? 'driver' : 'admin');

async function currentUser(q, headers) {
  const auth = headers.authorization || headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const s = await q.first('SELECT user_id, space, expires_at FROM sessions WHERE token_hash = ?', await sha256(token));
  if (!s || s.expires_at < nowIso()) return null;
  const u = await q.first('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!u || u.status !== 'active') return null;
  u.space = s.space;
  return u;
}

/** Suppression de compte (client ou chauffeur) : l'historique comptable (rÃ©servations, factures, versements) est conservÃ©
 *  mais anonymisÃ© ; le numÃ©ro est libÃ©rÃ©. RefusÃ©e tant qu'il reste une rÃ©servation, une mission, un versement ou un litige en cours. */
async function accountBlockers(q, u) {
  const out = [];
  const act = await q.first(`SELECT COUNT(*) n FROM bookings WHERE (customer_id = ? OR driver_id = ?) AND (status IN ('PAID','IN_PROGRESS','DISPUTED')
    OR (status = 'PENDING_PAYMENT' AND EXISTS (SELECT 1 FROM payment_claims c WHERE c.booking_id = bookings.id AND c.status = 'PENDING')))`, u.id, u.id);
  if (act.n) out.push(`${act.n} rÃ©servation(s) ou mission(s) en cours (payÃ©e, en route ou en rÃ©clamation)`);
  if (u.role === 'driver') {
    const due = await q.first("SELECT COUNT(*) n, COALESCE(SUM(driver_pay),0) s FROM bookings WHERE driver_id = ? AND payout_status IN ('DUE','HELD')", u.id);
    if (due.n) out.push(`${due.s.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA de gains pas encore versÃ©s (attendez le versement)`);
    const live = await q.first("SELECT COUNT(*) n FROM trips WHERE driver_id = ? AND status = 'IN_PROGRESS'", u.id);
    if (live.n) out.push('un trajet en cours');
  }
  const refund = await q.first("SELECT COUNT(*) n FROM payment_claims WHERE customer_id = ? AND status = 'REFUND'", u.id);
  if (refund.n) out.push('un remboursement en attente');
  return out;
}
async function deleteAccount(q, env, u, actorId, reason) {
  const now = nowIso();
  for (const b of await q.all("SELECT * FROM bookings WHERE customer_id = ? AND status = 'PENDING_PAYMENT'", u.id)) await cancelBooking(q, env, b, 'client', 'compte supprimÃ©', actorId);
  if (u.role === 'driver') {
    for (const t of await q.all("SELECT id FROM trips WHERE driver_id = ? AND status IN ('PUBLISHED','FULL','SUSPENDED')", u.id)) {
      for (const b of await q.all("SELECT * FROM bookings WHERE trip_id = ? AND status = 'PENDING_PAYMENT'", t.id)) await cancelBooking(q, env, b, 'driver', 'chauffeur parti', actorId);
      await q.run("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", t.id);
    }
    await q.run("UPDATE driver_profiles SET payout_phone = '', id_doc_last4 = '****', license_last4 = '****' WHERE user_id = ?", u.id);
  }
  await q.run("UPDATE packages SET status = 'CANCELLED' WHERE sender_id = ? AND status = 'CREATED'", u.id);
  await q.run("UPDATE users SET phone = ?, name = 'Compte supprimÃ©', email = '', bio = '', city = '', status = 'blocked', status_reason = ? WHERE id = ?", 'supprime:' + u.id, 'Compte supprimÃ© Â· ' + reason, u.id);
  await q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
  await q.run('DELETE FROM otps WHERE phone = ?', u.phone);
  await q.run('DELETE FROM notifications WHERE user_id = ?', u.id);
  await q.run("UPDATE partners SET api_key_hash = ?, webhook_url = '' WHERE owner_id = ?", 'revoque:' + uid(), u.id);
  await audit(q, actorId, 'user.deleted', 'user', u.id, { ref: u.ref, role: u.role, reason, by: actorId === u.id ? 'lui-mÃªme' : 'Ã©quipe' });
}
function statusMessage(u) {
  if (u.status === 'blocked') return 'Ce compte est bloquÃ©. Contactez le support Bokk Yoon.';
  if (u.status === 'suspended') return `Ce compte est suspendu${u.suspended_until ? ' jusqu\'au ' + new Date(u.suspended_until).toLocaleDateString('fr-FR') : ''}. Motif : ${u.status_reason || 'non prÃ©cisÃ©'}.`;
  return null;
}
const need = (u, ...roles) => {
  if (!u) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
  if (!roles.includes(u.role)) fail(403, 'WRONG_SPACE', `Action rÃ©servÃ©e Ã  ${roles.includes('driver') ? 'l\'espace chauffeur' : roles.includes('client') ? 'l\'espace client' : 'l\'Ã©quipe Bokk Yoon'}.`);
  return u;
};
async function needApprovedDriver(q, u) {
  need(u, 'driver');
  const dp = await q.first('SELECT status FROM driver_profiles WHERE user_id = ?', u.id);
  if (dp?.status !== 'APPROVED') fail(403, 'DRIVER_NOT_APPROVED', 'Votre dossier chauffeur doit Ãªtre validÃ© par l\'Ã©quipe Bokk Yoon.');
  return u;
}
const needSuper = (u) => need(u, 'superadmin');

// ---------- Vues ----------
function tripView(t) {
  return {
    id: t.id, ref: t.ref, driverId: t.driver_id, origin: t.origin, dest: t.dest, meetingPoint: t.meeting_point,
    originPos: { lat: t.origin_lat, lng: t.origin_lng }, destPos: { lat: t.dest_lat, lng: t.dest_lng },
    departureAt: t.departure_at, distanceKm: t.distance_km, durationMin: t.duration_min,
    seatsTotal: t.seats_total, seatsLeft: t.seats_left, parcelKgTotal: t.parcel_kg_total, parcelKgLeft: t.parcel_kg_left,
    maxDetourKm: t.max_detour_km, categories: String(t.accepts_categories).split(','), notes: t.notes, status: t.status,
    vehicle: t.vehicle_label || null, startedAt: t.started_at, completedAt: t.completed_at,
  };
}
function packageView(p, forOwner = true) {
  return {
    id: p.id, ref: p.ref, type: p.type_code, origin: p.origin, dest: p.dest, dateFrom: p.date_from, dateTo: p.date_to, weightKg: p.weight_kg,
    dims: [p.length_cm, p.width_cm, p.height_cm], category: p.category, declaredValue: p.declared_value,
    fragile: !!p.fragile, urgent: !!p.urgent, description: p.description,
    recipientName: p.recipient_name, recipientPhone: forOwner ? maskPhone(p.recipient_phone) : null, status: p.status, createdAt: p.created_at,
    externalRef: p.external_ref || null,
  };
}
function bookingView(b, viewer) {
  const isClient = viewer === 'client', isDriver = viewer === 'driver', isAdmin = viewer === 'admin';
  return {
    id: b.id, ref: b.ref, kind: b.kind, tripId: b.trip_id, listPrice: isDriver ? undefined : b.list_price ?? b.price, discount: isDriver ? undefined : b.discount, promoCode: isDriver ? undefined : b.promo_code, packageId: b.package_id, seats: b.seats, from: b.from_city, to: b.to_city,
    status: b.status, expiresAt: b.expires_at, matchScore: b.match_score,
    price: isDriver ? undefined : b.price, driverPay: isClient ? undefined : b.driver_pay, margin: isAdmin ? b.price - b.driver_pay : undefined,
    refundAmount: isDriver ? undefined : b.refund_amount,
    pickupCode: isClient || isAdmin ? b.pickup_code : null, trackToken: (isClient || isAdmin) && b.kind === 'PARCEL' ? b.track_token : null,
    pickupAt: b.pickup_at, deliveredAt: b.delivered_at,
    payoutStatus: isClient ? undefined : b.payout_status, payoutDueAt: isClient ? undefined : b.payout_due_at,
    cancelReason: b.cancel_reason, createdAt: b.created_at, updatedAt: b.updated_at,
  };
}
async function livePosition(q, t) {
  if (!t || !['IN_PROGRESS'].includes(t.status)) return null;
  const fresh = t.last_pos_at && Date.now() - new Date(t.last_pos_at) < 5 * 60000;
  const est = estimatePosition(t);
  if (fresh) return { source: 'gps', lat: t.last_lat, lng: t.last_lng, accuracy: t.last_accuracy, at: t.last_pos_at, progress: est.progress, etaMin: est.etaMin };
  return { source: 'estimate', lat: est.lat, lng: est.lng, at: nowIso(), progress: est.progress, etaMin: est.etaMin };
}

// ---------- OpÃ©rations sur les rÃ©servations ----------
async function refundBooking(q, b, amount, reason, by) {
  const status = amount >= b.price ? 'REFUNDED' : amount > 0 ? 'PARTIALLY_REFUNDED' : 'CAPTURED';
  await q.run('UPDATE payments SET status = ? WHERE booking_id = ?', status, b.id);
  await q.run('UPDATE bookings SET refund_amount = ?, updated_at = ? WHERE id = ?', amount, nowIso(), b.id);
  await creditNoteForBooking(q, b, amount, reason);
  await audit(q, by, 'payment.refunded', 'booking', b.id, { amount, reason, simulated: true });
}
/** Annulation par le client, le chauffeur ou l'Ã©quipe. who: 'client' | 'driver' | 'admin'. */
async function cancelBooking(q, env, b, who, reason, actorId) {
  const t = await q.first('SELECT * FROM trips WHERE id = ?', b.trip_id);
  const s = await getSettings(q);
  let refund = 0, driverComp = 0;
  if (b.status === 'PAID') {
    const hoursLeft = (new Date(t.departure_at) - Date.now()) / 3600000;
    if (who === 'client' && hoursLeft < s.booking.clientCancelFullRefundHours) { refund = Math.round(b.price / 2 / 50) * 50; driverComp = Math.round(b.driver_pay / 2 / 50) * 50; }
    else refund = b.price;
    await refundBooking(q, b, refund, reason, actorId);
    await q.run(`UPDATE bookings SET status = 'REFUNDED', cancel_reason = ?, driver_pay = ?, payout_status = ?, payout_due_at = ?, updated_at = ? WHERE id = ?`,
      `${who}:${reason}`, driverComp, driverComp ? 'DUE' : 'CANCELLED', driverComp ? nowIso() : null, nowIso(), b.id);
  } else {
    await q.run("UPDATE bookings SET status = 'CANCELLED', cancel_reason = ?, updated_at = ? WHERE id = ?", `${who}:${reason}`, nowIso(), b.id);
  }
  await releaseCapacity(q, b);
  if (b.package_id) await q.run("UPDATE packages SET status = 'CREATED' WHERE id = ?", b.package_id);
  if (who !== 'client') await notify(q, b.customer_id, 'RÃ©servation annulÃ©e', `${b.from_city} â†’ ${b.to_city} : ${who === 'driver' ? 'le chauffeur a dÃ» annuler' : 'annulÃ©e par Bokk Yoon'}.${refund ? ' Remboursement : ' + refund.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ') + ' FCFA.' : ''}`, `#/reservation/${b.id}`, 'warning');
  if (who !== 'driver' && b.status === 'PAID') await notify(q, b.driver_id, 'RÃ©servation annulÃ©e', `${b.from_city} â†’ ${b.to_city} Â· ${b.kind === 'PARCEL' ? 'colis' : b.seats + ' place(s)'}`, `#/mission/${b.id}`, 'warning');
  if (b.package_id) await notifyPartner(q, env, b.id, 'shipment.cancelled');
  return { status: b.status === 'PAID' ? 'REFUNDED' : 'CANCELLED', refund, driverCompensation: driverComp };
}
/** Suspend ou bloque un compte : sessions coupÃ©es, trajets et rÃ©servations Ã  venir annulÃ©s et remboursÃ©s. */
async function applySanction(q, env, target, type, reason, actor, days) {
  const now = nowIso();
  if (type === 'WARNING') {
    await q.run('UPDATE users SET warnings = warnings + 1 WHERE id = ?', target.id);
    await notify(q, target.id, 'Avertissement de Bokk Yoon', reason, '', 'warning');
  } else if (type === 'SUSPENSION' || type === 'BLOCK') {
    const until = type === 'SUSPENSION' ? addHours(24 * Math.max(1, Math.min(365, days || 7))) : null;
    await q.run('UPDATE users SET status = ?, suspended_until = ?, status_reason = ? WHERE id = ?', type === 'BLOCK' ? 'blocked' : 'suspended', until, reason, target.id);
    await q.run('DELETE FROM sessions WHERE user_id = ?', target.id);
    if (target.role === 'driver') {
      const trips = await q.all("SELECT id FROM trips WHERE driver_id = ? AND status IN ('PUBLISHED','FULL')", target.id);
      for (const t of trips) {
        await q.run("UPDATE trips SET status = 'SUSPENDED' WHERE id = ?", t.id);
        const bs = await q.all("SELECT * FROM bookings WHERE trip_id = ? AND status IN ('PENDING_PAYMENT','PAID')", t.id);
        for (const b of bs) await cancelBooking(q, env, b, 'admin', 'chauffeur_indisponible', actor.id);
      }
    } else if (target.role === 'client') {
      const bs = await q.all("SELECT * FROM bookings WHERE customer_id = ? AND status IN ('PENDING_PAYMENT','PAID') AND pickup_at IS NULL", target.id);
      for (const b of bs) await cancelBooking(q, env, b, 'admin', 'compte_suspendu', actor.id);
    }
    await notify(q, target.id, type === 'BLOCK' ? 'Compte bloquÃ©' : 'Compte suspendu', reason, '', 'danger');
  } else if (type === 'REACTIVATION') {
    await q.run("UPDATE users SET status = 'active', suspended_until = NULL, status_reason = NULL WHERE id = ?", target.id);
    await q.run("UPDATE trips SET status = 'PUBLISHED' WHERE driver_id = ? AND status = 'SUSPENDED' AND departure_at > ?", target.id, now);
    await notify(q, target.id, 'Compte rÃ©activÃ©', reason, '', 'success');
  }
  const until = type === 'SUSPENSION' ? addHours(24 * Math.max(1, Math.min(365, days || 7))) : null;
  await q.run('INSERT INTO sanctions (id, user_id, type, reason, until, by_id, created_at) VALUES (?,?,?,?,?,?,?)', uid(), target.id, type, reason, until, actor.id, now);
  await audit(q, actor.id, 'sanction.' + type.toLowerCase(), 'user', target.id, { reason, days: days || null });
}

// ---------- Partenaires (boutiques en ligne) ----------
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}
async function notifyPartner(q, env, bookingId, event) {
  const row = await q.first(`SELECT b.status, b.pickup_at, b.delivered_at, b.price, p.id package_id, p.external_ref, p.partner_id, pa.webhook_url, pa.webhook_secret
    FROM bookings b JOIN packages p ON p.id = b.package_id JOIN partners pa ON pa.id = p.partner_id WHERE b.id = ?`, bookingId);
  if (!row) return;
  const payload = JSON.stringify({ event, shipmentId: row.package_id, externalRef: row.external_ref, bookingStatus: row.status, amount: row.price, pickedUpAt: row.pickup_at, deliveredAt: row.delivered_at, sentAt: nowIso() });
  let status = 'NO_URL';
  if (row.webhook_url) {
    try { const res = await fetch(row.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bokkyoon-signature': await hmacHex(row.webhook_secret, payload) }, body: payload }); status = 'HTTP_' + res.status; }
    catch { status = 'FAILED'; }
  }
  await q.run('INSERT INTO partner_events (id, partner_id, event, payload, delivery_status, created_at) VALUES (?,?,?,?,?,?)', uid(), row.partner_id, event, payload, status, nowIso());
}
async function offersFor(q, pkg) {
  const trips = await q.all("SELECT t.*, v.label vehicle_label FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status IN ('PUBLISHED','FULL') AND t.departure_at > ? AND t.departure_at <= ? AND t.parcel_kg_left >= ? LIMIT 300",
    nowIso(), pkg.date_to + 'T23:59:59Z', pkg.weight_kg);
  const cache = {}, cands = [];
  for (const t of trips) { cache[t.driver_id] ??= await userStats(q, t.driver_id); cands.push(matchPackageTrip(pkg, t, cache[t.driver_id])); }
  return { evaluated: cands.length, ...rankMatches(cands) };
}

// ---------- DonnÃ©es de dÃ©monstration ----------
export const seed = (env) => seedDemo(db(env));
async function seedDemo(q) {
  const exists = await q.first("SELECT COUNT(*) n FROM users WHERE phone LIKE '+2217000000%'");
  if (exists?.n) return { created: 0 };
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const created = iso(now - 120 * 86400000);
  const drivers = [
    ['Moussa Diop', '+221700000001', 'Navetteur Dakarâ€“ThiÃ¨s tous les jours, vÃ©hicule climatisÃ©.', 'ThiÃ¨s', '7places', 'Peugeot 7 places grise', 6, 40, 'DK-2317-B'],
    ['AÃ¯da Sow', '+221700000002', 'Je vais Ã  Touba chaque fin de semaine.', 'Dakar', 'berline', 'Toyota Corolla blanche', 3, 15, 'DK-8841-A'],
    ['Ibrahima Faye', '+221700000003', 'CommerÃ§ant, trajets rÃ©guliers vers le nord et le Saloum.', 'Kaolack', 'pickup', 'Pick-up Nissan bleu', 2, 80, 'KL-5520-C'],
    ['Fatou Ndiaye', '+221700000004', 'Enseignante, ThiÃ¨s â†” Dakar le week-end.', 'ThiÃ¨s', 'citadine', 'Hyundai i10 rouge', 3, 10, 'TH-1190-D'],
    ['Ousmane Ba', '+221700000005', 'Chauffeur depuis 12 ans, axe Dakar â€“ Ziguinchor.', 'Ziguinchor', 'minibus', 'Minibus Toyota Hiace', 8, 60, 'ZG-3304-A'],
  ];
  const D = [];
  for (const [name, phone, bio, city, type, label, seats, kg, plate] of drivers) {
    const id = uid(), vid = uid(); D.push({ id, vid, seats, kg });
    await q.run("INSERT INTO users (id, phone, name, bio, city, role, created_at) VALUES (?,?,?,?,?,'driver',?)", id, phone, name, bio, city, created);
    await q.run("INSERT INTO driver_profiles (user_id, status, id_doc_type, id_doc_last4, license_last4, license_since, insurance_until, payout_provider, payout_phone, home_city, submitted_at, reviewed_at) VALUES (?,'APPROVED','CNI',?,?,?,?,'WAVE',?,?,?,?)",
      id, phone.slice(-4), String(1000 + D.length * 731).slice(-4), 2010 + D.length, iso(now + 200 * 86400000).slice(0, 10), phone, city, created, created);
    await q.run('INSERT INTO vehicles (id, owner_id, label, type, seats, cargo_kg, plate, created_at) VALUES (?,?,?,?,?,?,?,?)', vid, id, label, type, seats, kg, plate, created);
  }
  // Candidature en attente (pour montrer la validation)
  const pend = uid();
  await q.run("INSERT INTO users (id, phone, name, city, role, created_at) VALUES (?,?,?,?,'driver',?)", pend, '+221700000009', 'Cheikh Mbaye', 'Mbour', iso(now - 86400000));
  await q.run("INSERT INTO driver_profiles (user_id, status, id_doc_type, id_doc_last4, license_last4, license_since, insurance_until, payout_provider, payout_phone, home_city, submitted_at) VALUES (?,'PENDING','CNI','4412','7781',2018,?,'ORANGE_MONEY','+221700000009','Mbour',?)", pend, iso(now + 90 * 86400000).slice(0, 10), iso(now - 86400000));
  await q.run('INSERT INTO vehicles (id, owner_id, label, type, seats, cargo_kg, plate, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), pend, 'Renault Logan grise', 'berline', 3, 20, 'TH-7741-B', iso(now - 86400000));
  const staff = uid();
  await q.run("INSERT INTO users (id, phone, name, role, created_at) VALUES (?,?,?,'admin',?)", staff, '+221700000099', 'Mariama (Ã©quipe dÃ©mo)', created);
  const clients = [];
  for (const [name, phone, city] of [['Awa Diallo', '+221700000011', 'Dakar'], ['Mamadou Sarr', '+221700000012', 'ThiÃ¨s'], ['Khady Fall', '+221700000013', 'Dakar'], ['Pape Gueye', '+221700000014', 'Saint-Louis']]) {
    const id = uid(); clients.push(id);
    await q.run("INSERT INTO users (id, phone, name, city, role, created_at) VALUES (?,?,?,?,'client',?)", id, phone, name, city, created);
  }
  const settings = DEFAULT_SETTINGS, tariffs = [];
  const tripAt = async (di, o, d, dep, status, meet) => {
    const A = cityByName(o), B = cityByName(d), qt = quote(settings, tariffs, A, B), drv = D[di], id = uid();
    await q.run(`INSERT INTO trips (id, driver_id, vehicle_id, origin, origin_lat, origin_lng, dest, dest_lat, dest_lng, meeting_point, departure_at, distance_km, duration_min,
      seats_total, seats_left, parcel_kg_total, parcel_kg_left, max_detour_km, notes, status, started_at, completed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, drv.id, drv.vid, A.name, A.lat, A.lng, B.name, B.lat, B.lng, meet, iso(dep), qt.distanceKm, qt.durationMin, drv.seats, drv.seats,
      Math.min(drv.kg, 20), Math.min(drv.kg, 20), 8, '', status, status !== 'PUBLISHED' ? iso(dep) : null, status === 'COMPLETED' ? iso(dep + qt.durationMin * 60000) : null, iso(dep - 3 * 86400000));
    return { id, qt, drv, A, B };
  };
  // Historique : 14 jours de trajets terminÃ©s avec rÃ©servations payÃ©es
  const corr = [['Dakar', 'ThiÃ¨s'], ['ThiÃ¨s', 'Dakar'], ['Dakar', 'Touba'], ['Dakar', 'Saint-Louis'], ['Dakar', 'Kaolack'], ['Dakar', 'Mbour']];
  let n = 0;
  for (let day = 13; day >= 1; day--) {
    for (let k = 0; k < 1 + (day % 3); k++) {
      const [o, d] = corr[(day + k) % corr.length], di = (day + k) % D.length;
      const dep = now - day * 86400000 + (7 + k * 3) * 3600000;
      const t = await tripAt(di, o, d, dep, 'COMPLETED', 'Point de rendez-vous habituel');
      const nb = 1 + ((day * 7 + k) % 3);
      for (let j = 0; j < nb; j++) {
        const parcel = (day + j) % 3 === 0, cust = clients[(day + j + k) % clients.length], bid = uid();
        let price, dpay, pkg = null;
        if (parcel) {
          const w = 2 + ((day + j) % 5), am = parcelAmounts(t.qt, w); price = am.client; dpay = am.driver; pkg = uid();
          await q.run(`INSERT INTO packages (id, sender_id, origin, origin_lat, origin_lng, dest, dest_lat, dest_lng, date_from, date_to, weight_kg, length_cm, width_cm, height_cm, category, declared_value, recipient_name, recipient_phone, status, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,40,30,20,'vetements',15000,'Destinataire','+221770000099','DELIVERED',?)`, pkg, cust, t.A.name, t.A.lat, t.A.lng, t.B.name, t.B.lat, t.B.lng, iso(dep).slice(0, 10), iso(dep + 2 * 86400000).slice(0, 10), w, iso(dep - 86400000));
        } else { price = t.qt.clientSeat; dpay = t.qt.driverSeat; }
        const paidOut = day > 4;
        await q.run(`INSERT INTO bookings (id, kind, trip_id, customer_id, driver_id, package_id, seats, from_city, to_city, price, driver_pay, status, pickup_code, delivery_code, track_token, pickup_at, delivered_at, payout_status, payout_due_at, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?,?,?,?,?,?,?,?)`, bid, parcel ? 'PARCEL' : 'SEAT', t.id, cust, t.drv.id, pkg, parcel ? null : 1, t.A.name, t.B.name, price, dpay,
          randomDigits(6), parcel ? randomDigits(6) : null, parcel ? randomHex(12) : null, iso(dep), parcel ? iso(dep + t.qt.durationMin * 60000) : null, paidOut ? 'PAID' : 'DUE', iso(dep + 30 * 3600000), iso(dep - 86400000), iso(dep + t.qt.durationMin * 60000));
        await q.run("INSERT INTO payments (id, booking_id, provider, provider_ref, amount, status, created_at) VALUES (?,?,?,?,?,'CAPTURED',?)", uid(), bid, ['WAVE', 'WAVE', 'ORANGE_MONEY', 'FREE_MONEY'][(day + j) % 4], 'SIM-' + randomHex(6).toUpperCase(), price, iso(dep - 86400000));
        if ((day + j) % 2 === 0) await q.run('INSERT INTO reviews (id, booking_id, author_id, target_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)', uid(), bid, cust, t.drv.id, 4 + ((day + j) % 2), ['TrÃ¨s ponctuel, voiture propre.', 'Colis bien arrivÃ©, merci.', 'Conduite prudente.', ''][(day + j) % 4], iso(dep + 86400000));
        n++;
      }
    }
  }
  // Un reversement dÃ©jÃ  effectuÃ© par le propriÃ©taire, par chauffeur
  for (const drv of D) {
    const s = await q.first("SELECT COALESCE(SUM(driver_pay),0) a, COUNT(*) n FROM bookings WHERE driver_id = ? AND payout_status = 'PAID' AND payout_id IS NULL", drv.id);
    if (s.a > 0) { const pid = uid(); await q.run("INSERT INTO payouts (id, driver_id, amount, bookings_count, provider, reference, paid_by, created_at) VALUES (?,?,?,?,'WAVE',?,?,?)", pid, drv.id, s.a, s.n, 'WV-' + randomHex(4).toUpperCase(), staff, iso(now - 4 * 86400000)); await q.run("UPDATE bookings SET payout_id = ? WHERE driver_id = ? AND payout_status = 'PAID' AND payout_id IS NULL", pid, drv.id); }
  }
  // Trajets Ã  venir
  const plan = [[0, 'Dakar', 'ThiÃ¨s', 1, 7, 'Gare routiÃ¨re des Baux maraÃ®chers'], [0, 'ThiÃ¨s', 'Dakar', 1, 18, 'Station Total, route de Dakar'], [0, 'Dakar', 'ThiÃ¨s', 2, 7, 'Gare routiÃ¨re des Baux maraÃ®chers'],
    [1, 'Dakar', 'Touba', 2, 9, 'Rond-point LibertÃ© 6'], [2, 'Dakar', 'Saint-Louis', 3, 6, 'Patte d\'Oie'], [3, 'ThiÃ¨s', 'Dakar', 2, 16, 'Place de France, ThiÃ¨s'],
    [1, 'Touba', 'Dakar', 4, 15, 'Grande mosquÃ©e, parking'], [2, 'Dakar', 'Kaolack', 1, 13, 'Colobane'], [4, 'Dakar', 'Ziguinchor', 3, 5, 'Gare de Pompiers'], [4, 'Ziguinchor', 'Dakar', 6, 6, 'Gare routiÃ¨re de Ziguinchor']];
  for (const [di, o, d, dayOffset, hour, meet] of plan) {
    const dep = new Date(); dep.setUTCDate(dep.getUTCDate() + dayOffset); dep.setUTCHours(hour, 0, 0, 0);
    await tripAt(di, o, d, dep.getTime(), 'PUBLISHED', meet);
  }
  // Un trajet en cours (pour la carte en direct)
  await tripAt(2, 'Dakar', 'Touba', now - 70 * 60000, 'IN_PROGRESS', 'Colobane');
  // Signalement ouvert
  await q.run("INSERT INTO incidents (id, reporter_id, target_id, category, details, created_at) VALUES (?,?,?,'RETARD',?,?)", uid(), clients[1], D[3].id, 'Le chauffeur est arrivÃ© 40 minutes aprÃ¨s l\'heure prÃ©vue sans prÃ©venir.', iso(now - 2 * 86400000));
  // ActualitÃ©s et alertes (contenu d'exemple, modifiable dans l'espace Ã©quipe)
  const news = [
    ['ANNONCE', 'ALL', 'Bokk Yoon ouvre son pilote sur l\'axe Dakar â€“ ThiÃ¨s', 'Premiers trajets, premiers colis : voici comment fonctionne le pilote et comment y participer.',
      'Bokk Yoon dÃ©marre sur l\'axe le plus frÃ©quentÃ© du pays. Les voyageurs rÃ©servent une place Ã  prix fixe, les expÃ©diteurs confient un colis Ã  un chauffeur vÃ©rifiÃ© qui fait dÃ©jÃ  la route.\n\nPendant le pilote, notre Ã©quipe accompagne chaque premier trajet par tÃ©lÃ©phone. Vos retours nous aident Ã  ouvrir les prochains axes : Touba, Saint-Louis, Kaolack et Ziguinchor.'],
    ['CONSEIL', 'CLIENTS', 'Bien emballer son colis : 6 rÃ¨gles simples', 'Carton rigide, poids exact, photo nette : ce qui Ã©vite 9 litiges sur 10.',
      '1. Utilisez un carton ou un sac rigide et fermÃ©.\n2. Pesez le colis : le poids dÃ©clarÃ© est vÃ©rifiÃ© Ã  l\'enlÃ¨vement.\n3. Prenez une photo nette avant de le remettre.\n4. ProtÃ©gez les objets fragiles et cochez Â« fragile Â».\n5. Ã‰crivez le nom et le numÃ©ro du destinataire sur le colis.\n6. Ne confiez jamais d\'objet interdit : le chauffeur peut refuser.'],
    ['SECURITE', 'ALL', 'Remise contre code : ne donnez jamais votre code trop tÃ´t', 'Le code Ã  6 chiffres est votre signature. Voici quand et Ã  qui le donner.',
      'L\'expÃ©diteur donne son code au chauffeur seulement aprÃ¨s avoir remis le colis. Le destinataire donne le sien seulement quand il a le colis en main et l\'a vÃ©rifiÃ©.\n\nL\'Ã©quipe Bokk Yoon ne vous demandera jamais votre code par tÃ©lÃ©phone.'],
    ['ROUTE', 'ALL', 'Grands Ã©vÃ©nements : rÃ©servez vos places Ã  l\'avance', 'Magal, Gamou, fÃªtes de fin d\'annÃ©e : la demande explose, les places partent vite.',
      'Lors des grands rassemblements, les trajets vers Touba, Tivaouane, Kaolack ou la Casamance se remplissent plusieurs jours avant. RÃ©servez tÃ´t et suivez les alertes route dans l\'application.'],
    ['CONSEIL', 'DRIVERS', 'Chauffeurs : comment sont calculÃ©s vos gains', 'Votre rÃ©munÃ©ration est affichÃ©e avant chaque trajet et versÃ©e sur Wave ou Orange Money.',
      'Pour chaque place ou colis, votre rÃ©munÃ©ration est fixÃ©e par Bokk Yoon et affichÃ©e avant que vous publiiez le trajet. Elle devient disponible 24 heures aprÃ¨s la remise, puis l\'Ã©quipe la verse sur votre compte Wave ou Orange Money.'],
  ];
  let i = 0;
  for (const [cat, aud, title, summary, body] of news) {
    const t = iso(now - (i++ * 3 + 1) * 86400000);
    await q.run("INSERT INTO news (id, slug, title, summary, body, category, audience, status, published_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'PUBLISHED',?,?,?)", uid(), slugify(title), title, summary, body, cat, aud, t, t, t);
  }
  await q.run("INSERT INTO route_alerts (id, area, level, message, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?)", uid(), 'Dakar', 'INFO', 'Sortie de Dakar chargÃ©e aux heures de pointe (7 h â€“ 10 h et 17 h â€“ 20 h) : prÃ©voyez une marge au point de rendez-vous.', iso(now - 86400000), iso(now + 30 * 86400000), iso(now));
  await q.run("INSERT INTO route_alerts (id, area, level, message, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?,?)", uid(), 'Touba', 'ATTENTION', 'Forte affluence attendue en fin de semaine sur l\'axe Dakar â€“ Touba : rÃ©servez tÃ´t.', iso(now - 86400000), iso(now + 5 * 86400000), iso(now));
  await backfillRefs(q);
  await getParcelTypes(q);
  for (const b of await q.all("SELECT * FROM bookings WHERE status IN ('PAID','IN_PROGRESS','COMPLETED') ORDER BY created_at")) await invoiceForBooking(q, b);
  await q.run('UPDATE invoices SET issued_at = (SELECT created_at FROM bookings WHERE bookings.id = invoices.booking_id) WHERE booking_id IS NOT NULL');
  await q.run("INSERT INTO promo_codes (id, code, label, kind, value, applies, max_uses, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)", uid(), 'BIENVENUE', 'Premier trajet : -20 %', 'PERCENT', 20, 'ALL', 500, iso(now + 60 * 86400000), iso(now));
  const tk = uid();
  await q.run("INSERT INTO tickets (id, user_id, name, phone, category, subject, source, created_at, updated_at) VALUES (?,?,?,?,'QUESTION',?,'app',?,?)", tk, clients[0], 'Awa Diallo', '+221700000011', 'Peut-on envoyer un passeport Ã  Ziguinchor ?', iso(now - 5 * 3600000), iso(now - 5 * 3600000));
  await q.run('INSERT INTO ticket_messages (id, ticket_id, author_id, body, created_at) VALUES (?,?,?,?,?)', uid(), tk, clients[0], 'Bonjour, ma sÅ“ur doit rÃ©cupÃ©rer son passeport Ã  Ziguinchor la semaine prochaine. Est-ce possible et quel est le prix ?', iso(now - 5 * 3600000));
  await setRef(q, 'tickets', tk);
  for (const [bi, score, liked, improve] of [[0, 10, 'Chauffeur ponctuel et poli.', ''], [1, 9, 'Suivi du colis trÃ¨s rassurant.', ''], [2, 7, 'Prix correct.', 'Plus de dÃ©parts le soir.'], [3, 4, '', 'Le chauffeur est arrivÃ© en retard.']]) {
    const b = (await q.all("SELECT id, customer_id FROM bookings WHERE status = 'COMPLETED' ORDER BY created_at DESC LIMIT 4"))[bi];
    if (b) await q.run('INSERT INTO feedback (id, booking_id, user_id, score, liked, improve, created_at) VALUES (?,?,?,?,?,?,?)', uid(), b.id, b.customer_id, score, liked, improve, iso(now - bi * 86400000));
  }
  return { created: n };
}

// ---------- Routeur ----------
export async function handleApi(req, env) {
  const { method, path, query = {}, body = {}, headers = {} } = req;
  const q = db(env);
  try {
    await housekeeping(q);
    const me = await currentUser(q, headers);
    const seg = path.replace(/^\/+|\/+$/g, '').split('/');
    const is = (m, ...parts) => method === m && seg.length === parts.length && parts.every((p, i) => p === '*' || p === seg[i]);
    const [r0, r1, r2, r3] = seg;
    const res = await (r0 === 'admin' ? adminRoutes : r0 === 'driver' ? driverRoutes : r0 === 'client' ? clientRoutes : r0 === 'partner' ? partnerRoutes : commonRoutes)({ q, env, me, method, seg, is, r0, r1, r2, r3, query, body, headers });
    if (res) return res;
    fail(404, 'ROUTE_NOT_FOUND', `Route inconnue : ${method} /${seg.join('/')}`);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
    console.error(e);
    return { status: 500, body: { error: { code: 'INTERNAL', message: 'Erreur interne. RÃ©essayez.' } } };
  }
}

// ======================= Routes publiques et communes =======================
async function commonRoutes({ q, env, me, method, seg, is, r1, query, body, headers }) {
  if (is('GET', 'health')) return ok({ ok: true, mode: env.MODE || 'cloud', time: nowIso() });
  if (is('GET', 'config')) return ok({ cities: CITIES, regions: REGIONS, categories: CATEGORIES, forbidden: FORBIDDEN, limits: LIMITS, algoVersion: ALGO_VERSION, demoOtp: env.DEMO_OTP !== 'false', mode: env.MODE || 'cloud' });
  if (is('GET', 'quote')) {
    const A = cityByName(query.from), B = cityByName(query.to);
    if (!A || !B || A === B) fail(400, 'CITY_INVALID', 'Villes invalides.');
    const qt = await quoteFor(q, A, B);
    const w = Math.min(LIMITS.parcelMaxKg, Number(query.weightKg) || 5), seats = Math.max(1, Math.min(8, int(query.seats) || 1));
    const typeCode = str(query.type, 20) || 'COLIS';
    const pp = await parcelPrice(q, typeCode, A, B, w);
    return ok({ from: A.name, to: B.name, distanceKm: qt.distanceKm, durationMin: qt.durationMin, seat: qt.clientSeat, seats, seatsTotal: qt.clientSeat * seats,
      parcel: pp.client, type: { code: pp.type.code, label: pp.type.label, mode: pp.type.mode }, weightKg: pp.type.mode === 'WEIGHT' ? w : null });
  }
  if (is('GET', 'parcel-types')) return ok({ results: (await getParcelTypes(q)).map((t) => ({ code: t.code, label: t.label, description: t.description, mode: t.mode, idCheck: !!t.id_check, nominalKg: t.nominal_kg })) });
  if (is('GET', 'payment-methods')) {
    const ps = (await getSettings(q)).payment;
    const pub = (m) => (m?.enabled ? { qr: m.qr, link: m.link, number: m.number, name: m.name } : null);
    return ok({ mode: payMode(ps, env), wave: pub(ps.wave), orange: pub(ps.orange), instructions: ps.instructions, reviewMinutes: ps.reviewMinutes });
  }
  if (is('GET', 'company')) {
    const c = (await getSettings(q)).company;
    return ok({ name: c.name, phone: c.phone, whatsapp: c.whatsapp, email: c.email, hours: c.hours, website: c.website, address: c.address });
  }
  if (is('POST', 'contact')) {
    const name = str(body.name || me?.name, 80), phone = body.phone ? normalizePhone(body.phone) : me?.phone || '', email = str(body.email || me?.email, 120).toLowerCase();
    const cat = ['QUESTION', 'RECLAMATION', 'SUGGESTION', 'PARTENARIAT', 'CHAUFFEUR', 'AUTRE'].includes(body.category) ? body.category : 'QUESTION';
    const subject = str(body.subject, 140), message = str(body.message, 3000);
    if (!name) fail(400, 'NAME_REQUIRED', 'Indiquez votre nom.');
    if (!phone && !email) fail(400, 'CONTACT_REQUIRED', 'Indiquez un tÃ©lÃ©phone ou un e-mail pour que nous puissions vous rÃ©pondre.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
    if (!subject || message.length < 10) fail(400, 'MESSAGE_REQUIRED', 'Indiquez un objet et un message (10 caractÃ¨res minimum).');
    const recent = await q.first("SELECT COUNT(*) n FROM tickets WHERE (phone = ? AND phone != '') AND created_at > ?", phone, new Date(Date.now() - 86400000).toISOString());
    if (recent.n >= 5) fail(429, 'TOO_MANY', 'Vous avez dÃ©jÃ  envoyÃ© plusieurs messages aujourd\'hui. Nous vous rÃ©pondons au plus vite.');
    const id = uid(), now = nowIso();
    await q.run('INSERT INTO tickets (id, user_id, name, phone, email, category, subject, booking_ref, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, me?.id || null, name, phone, email, cat, subject, str(body.bookingRef, 30).toUpperCase(), me ? (me.role === 'driver' ? 'chauffeur' : 'app') : 'site', now, now);
    await q.run('INSERT INTO ticket_messages (id, ticket_id, author_id, body, created_at) VALUES (?,?,?,?,?)', uid(), id, me?.id || null, message, now);
    const ref = await setRef(q, 'tickets', id);
    await notifyTeam(q, `Nouveau message ${ref}`, `${name} : ${subject}`, `#/messages/${id}`);
    const c = (await getSettings(q)).company;
    const mail = await sendEmail(env, env.OWNER_EMAIL || c.email, `[Bokk Yoon] ${ref} Â· ${subject}`, `${name} (${phone || ''} ${email || ''})\nCatÃ©gorie : ${cat}\n${body.bookingRef ? 'RÃ©servation : ' + body.bookingRef + '\n' : ''}\n${message}`);
    return ok({ ref, id, emailForward: mail }, 201);
  }
  if (is('GET', 'coverage')) {
    const rows = await q.all("SELECT origin, dest, COUNT(*) n FROM trips WHERE status IN ('PUBLISHED','FULL') AND departure_at > ? GROUP BY origin, dest", nowIso());
    const served = new Set(rows.flatMap((r) => [r.origin, r.dest]));
    return ok({ regions: REGIONS.map((r) => ({ name: r, cities: CITIES.filter((c) => c.region === r).map((c) => ({ ...c, served: served.has(c.name) })) })), corridors: rows, tripsOpen: rows.reduce((s, r) => s + r.n, 0) });
  }
  if (is('GET', 'news')) {
    const aud = ['CLIENTS', 'DRIVERS'].includes(query.audience) ? query.audience : null;
    const rows = await q.all(`SELECT id, slug, title, summary, category, audience, published_at FROM news WHERE status = 'PUBLISHED' ${aud ? "AND audience IN ('ALL', ?)" : ''} ORDER BY published_at DESC LIMIT ?`, ...(aud ? [aud] : []), Math.min(50, int(query.limit) || 12));
    return ok({ results: rows });
  }
  if (is('GET', 'news', '*')) {
    const n = await q.first("SELECT id, slug, title, summary, body, category, audience, published_at FROM news WHERE slug = ? AND status = 'PUBLISHED'", r1);
    if (!n) fail(404, 'NOT_FOUND', 'Article introuvable.');
    return ok(n);
  }
  if (is('GET', 'alerts')) return ok({ results: await q.all('SELECT id, area, level, message, ends_at FROM route_alerts WHERE starts_at <= ? AND ends_at >= ? ORDER BY CASE level WHEN \'DANGER\' THEN 0 WHEN \'ATTENTION\' THEN 1 ELSE 2 END', nowIso(), nowIso()) });
  if (is('POST', 'waitlist')) {
    const name = str(body.name, 80), phone = normalizePhone(body.phone), role = str(body.role, 20), city = str(body.city, 60);
    if (!name) fail(400, 'NAME_REQUIRED', 'Indiquez votre nom.');
    if (!['conducteur', 'expediteur', 'passager', 'partenaire'].includes(role)) fail(400, 'ROLE_INVALID', 'Profil invalide.');
    const dup = await q.first('SELECT id FROM waitlist WHERE phone = ?', phone);
    if (!dup) await q.run('INSERT INTO waitlist (id, name, phone, role, city, created_at) VALUES (?,?,?,?,?,?)', uid(), name, phone, role, city, nowIso());
    return ok({ joined: true, already: !!dup });
  }
  if (is('GET', 'trips', 'search')) {
    const A = cityByName(query.from), B = cityByName(query.to), seats = Math.max(1, int(query.seats) || 1);
    if (!A || !B || A === B) fail(400, 'CITY_INVALID', 'Choisissez deux villes diffÃ©rentes dans la liste.');
    const qt = await quoteFor(q, A, B);
    const params = [seats, nowIso()]; let dateSql = '';
    if (query.date) { dateSql = 'AND substr(t.departure_at, 1, 10) = ?'; params.push(str(query.date, 10)); }
    const rows = await q.all(`SELECT t.*, v.label vehicle_label FROM trips t JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = t.driver_id
      WHERE t.status = 'PUBLISHED' AND u.status = 'active' AND t.seats_left >= ? AND t.departure_at > ? ${dateSql} ORDER BY t.departure_at LIMIT 200`, ...params);
    const out = [];
    for (const t of rows) {
      const TA = { lat: t.origin_lat, lng: t.origin_lng }, TB = { lat: t.dest_lat, lng: t.dest_lng };
      const pA = projectOnSegment(A, TA, TB), pB = projectOnSegment(B, TA, TB);
      if (pA.distKm > 12 || pB.distKm > 12 || !(pA.t < pB.t)) continue;
      const pass = new Date(new Date(t.departure_at).getTime() + Math.max(0, pA.t) * t.duration_min * 60000).toISOString();
      out.push({ ...tripView(t), driver: await publicUser(q, t.driver_id), exact: t.origin === A.name && t.dest === B.name, passAt: pass, price: qt.clientSeat * seats, pricePerSeat: qt.clientSeat });
    }
    return ok({ from: A.name, to: B.name, pricePerSeat: qt.clientSeat, results: out.slice(0, 50) });
  }
  if (is('GET', 'trips', '*')) {
    const t = await q.first('SELECT t.*, v.label vehicle_label FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?', r1);
    if (!t) fail(404, 'NOT_FOUND', 'Trajet introuvable.');
    const A = cityByName(query.from) || cityByName(t.origin), B = cityByName(query.to) || cityByName(t.dest);
    const qt = await quoteFor(q, A, B);
    return ok({ ...tripView(t), driver: await publicUser(q, t.driver_id), from: A.name, to: B.name, pricePerSeat: qt.clientSeat, parcelFrom: qt.clientParcel });
  }
  if (is('GET', 'users', '*')) {
    const pu = await publicUser(q, r1); if (!pu) fail(404, 'NOT_FOUND', 'Membre introuvable.');
    const reviews = await q.all('SELECT r.rating, r.comment, r.created_at, u.name author FROM reviews r JOIN users u ON u.id = r.author_id WHERE r.target_id = ? AND r.hidden = 0 ORDER BY r.created_at DESC LIMIT 20', r1);
    return ok({ ...pu, reviews: reviews.map((r) => ({ ...r, author: firstName(r.author) })) });
  }
  if (is('GET', 'track', '*')) {
    const b = await q.first(`SELECT b.*, u.name driver_name, p.recipient_name, p.weight_kg, p.category FROM bookings b JOIN users u ON u.id = b.driver_id JOIN packages p ON p.id = b.package_id WHERE b.track_token = ?`, r1);
    if (!b) fail(404, 'NOT_FOUND', 'Lien de suivi invalide.');
    const t = await q.first('SELECT * FROM trips WHERE id = ?', b.trip_id);
    return ok({
      from: b.from_city, to: b.to_city, departureAt: t.departure_at, status: b.status, driverName: firstName(b.driver_name), recipientName: b.recipient_name,
      weightKg: b.weight_kg, category: b.category, pickupAt: b.pickup_at, deliveredAt: b.delivered_at,
      deliveryCode: ['PAID', 'IN_PROGRESS'].includes(b.status) ? b.delivery_code : null,
      route: { origin: { name: t.origin, lat: t.origin_lat, lng: t.origin_lng }, dest: { name: t.dest, lat: t.dest_lat, lng: t.dest_lng } },
      live: b.status === 'IN_PROGRESS' ? await livePosition(q, t) : null,
    });
  }

  // --- Authentification par espace ---
  if (is('POST', 'auth', 'otp', 'request') || is('POST', 'auth', 'otp', 'verify')) {
    const space = ['client', 'driver', 'admin'].includes(body.space) ? body.space : 'client';
    const phone = normalizePhone(body.phone);
    const existing = await q.first('SELECT * FROM users WHERE phone = ?', phone);
    const admins = String(env.ADMIN_PHONES || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (existing) {
      const msg = statusMessage(existing); if (msg) fail(403, 'ACCOUNT_' + existing.status.toUpperCase(), msg);
      // NumÃ©ro dÃ©clarÃ© propriÃ©taire (ADMIN_PHONES) : il peut toujours entrer dans l'espace Ã©quipe, mÃªme s'il a d'abord servi Ã  un compte client.
      const ownerTakeover = space === 'admin' && admins.includes(phone) && (existing.role === 'client' || existing.role === 'driver');
      if (!ownerTakeover && !SPACE_ROLES[space].includes(existing.role)) fail(403, 'WRONG_SPACE', `Ce numÃ©ro est rattachÃ© Ã  ${SPACE_LABEL[roleSpace(existing.role)]}. Chaque espace est sÃ©parÃ© : utilisez ${SPACE_LABEL[roleSpace(existing.role)]}${existing.role === 'client' ? ' ou un autre numÃ©ro pour devenir chauffeur' : ''}.`);
    } else if (space === 'admin' && !admins.includes(phone)) fail(403, 'TEAM_ONLY', 'AccÃ¨s rÃ©servÃ© Ã  l\'Ã©quipe Bokk Yoon.');
    if (seg[2] === 'request') {
      
    const row = await q.first('SELECT * FROM otps WHERE phone = ?', phone);
      const winStart = row && Date.now() - new Date(row.window_start) < 15 * 60000 ? row.window_start : nowIso();
      const sent = row && winStart === row.window_start ? row.sent_count + 1 : 1;
      if (sent > 3) fail(429, 'OTP_RATE_LIMIT', 'Trop de demandes. RÃ©essayez dans 15 minutes.');
      const code = randomDigits(6);
      await q.run('DELETE FROM otps WHERE phone = ?', phone);
      await q.run('INSERT INTO otps (phone, code_hash, attempts, expires_at, sent_count, window_start) VALUES (?,?,0,?,?,?)', phone, await sha256(phone + ':' + code), new Date(Date.now() + 5 * 60000).toISOString(), sent, winStart);
      await sendSms(env, phone, `Bokk Yoon : votre code est ${code}. Il expire dans 5 minutes. Ne le partagez avec personne.`);
      if (body.email) await sendEmail(env, str(body.email, 120).toLowerCase(), 'Code de validation Bokk Yoon', `Votre code de connexion est : ${code}\n\nIl expire dans 5 minutes.`);
      return ok({ sent: true, phone, isNew: !existing, demoCode: (env.DEMO_OTP !== 'false' && space !== 'admin') ? code : undefined });
    }
    if (space === 'admin' && env.ADMIN_PASSWORD && body.password !== env.ADMIN_PASSWORD) fail(403, 'WRONG_PASSWORD', 'Mot de passe équipe incorrect.');
    const row = await q.first('SELECT * FROM otps WHERE phone = ?', phone);
    if (!row || row.expires_at < nowIso()) fail(400, 'OTP_EXPIRED', 'Code expirÃ©. Demandez-en un nouveau.');
    if (row && row.attempts >= 5) fail(429, 'OTP_LOCKED', 'Trop d\'essais. Demandez un nouveau code.');
    if ((await sha256(phone + ':' + str(body.code, 6))) !== row?.code_hash) { await q.run('UPDATE otps SET attempts = attempts + 1 WHERE phone = ?', phone); fail(400, 'OTP_WRONG', 'Code incorrect.'); }
    await q.run('DELETE FROM otps WHERE phone = ?', phone);
    let u = existing;
    if (u && body.email && body.email !== u.email) { await q.run('UPDATE users SET email = ? WHERE id = ?', str(body.email, 120).toLowerCase(), u.id); }
    if (u && space === 'admin' && admins.includes(phone) && (u.role === 'client' || u.role === 'driver')) {
      await q.run("UPDATE users SET role = 'superadmin', ref = NULL WHERE id = ?", u.id);
      await setRef(q, 'users', u.id, 'superadmin');
      await q.run("DELETE FROM sessions WHERE user_id = ? AND space != 'admin'", u.id);
      await audit(q, u.id, 'user.promoted_owner', 'user', u.id, { from: 'client' });
      u = await q.first('SELECT * FROM users WHERE id = ?', u.id);
    }
    if (!u) {
      const id = uid(), role = space === 'admin' ? 'superadmin' : space;
      await q.run('INSERT INTO users (id, phone, name, email, role, created_at) VALUES (?,?,?,?,?,?)', id, phone, str(body.name, 60), str(body.email || '', 120).toLowerCase(), role, nowIso());
      await setRef(q, 'users', id, role);
      u = await q.first('SELECT * FROM users WHERE id = ?', id);
      await audit(q, id, 'user.created', 'user', id, { role });
    }
    await q.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), u.id);
    const token = randomHex(32);
    await q.run('INSERT INTO sessions (token_hash, user_id, space, expires_at, created_at) VALUES (?,?,?,?,?)', await sha256(token), u.id, space, new Date(Date.now() + 30 * 86400000).toISOString(), nowIso());
    return ok({ token, role: u.role, needsName: !u.name });
  }
  if (is('POST', 'auth', 'logout')) {
    const auth = headers.authorization || '';
    if (auth.startsWith('Bearer ')) await q.run('DELETE FROM sessions WHERE token_hash = ?', await sha256(auth.slice(7)));
    return ok({ ok: true });
  }

  // --- Compte (tous les rÃ´les) ---
  if (is('GET', 'me')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    const unread = await q.first('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL', me.id);
    const out = { id: me.id, ref: me.ref, email: me.email, phone: me.phone, name: me.name, bio: me.bio, city: me.city, role: me.role, createdAt: me.created_at, warnings: me.warnings, unread: unread.n, stats: await userStats(q, me.id) };
    if (me.role === 'driver') {
      out.driver = await q.first('SELECT status, payout_provider, payout_phone, home_city, review_note, submitted_at FROM driver_profiles WHERE user_id = ?', me.id);
      out.vehicles = await q.all('SELECT * FROM vehicles WHERE owner_id = ? ORDER BY created_at', me.id);
    }
    return ok(out);
  }
  if (is('GET', 'me', 'delete')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    return ok({ blockers: ['client', 'driver'].includes(me.role) ? await accountBlockers(q, me) : ['Le compte de l\'Ã©quipe se supprime depuis l\'espace Ã©quipe.'] });
  }
  if (is('POST', 'me', 'delete')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    if (!['client', 'driver'].includes(me.role)) fail(403, 'FORBIDDEN', 'Un compte de l\'Ã©quipe ne peut pas Ãªtre supprimÃ© ici.');
    if (str(body.confirm, 20).toUpperCase() !== 'SUPPRIMER') fail(400, 'CONFIRM_REQUIRED', 'Tapez SUPPRIMER pour confirmer.');
    const bl = await accountBlockers(q, me); if (bl.length) fail(409, 'ACCOUNT_BUSY', 'Suppression impossible pour le moment : ' + bl.join(' ; ') + '.');
    await deleteAccount(q, env, me, me.id, str(body.reason, 300) || 'Ã  la demande du membre');
    await notifyTeam(q, `Compte supprimÃ© ${me.ref}`, `${me.name} a supprimÃ© son compte ${me.role === 'driver' ? 'chauffeur' : 'client'}.`, '#/journal');
    return ok({ deleted: true });
  }
  if (is('PATCH', 'me')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    const name = body.name !== undefined ? str(body.name, 60) : me.name;
    if (!name) fail(400, 'NAME_REQUIRED', 'Indiquez votre prÃ©nom et votre nom.');
    const city = body.city !== undefined ? (cityByName(body.city)?.name || '') : me.city;
    const email = body.email !== undefined ? str(body.email, 120).toLowerCase() : me.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'EMAIL_INVALID', 'Adresse e-mail invalide.');
    await q.run('UPDATE users SET name = ?, bio = ?, city = ?, email = ? WHERE id = ?', name, body.bio !== undefined ? str(body.bio, 300) : me.bio, city, email, me.id);
    return ok({ ok: true });
  }
  if (is('GET', 'me', 'notifications')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    return ok({ results: await q.all('SELECT id, title, body, link, kind, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', me.id) });
  }
  if (is('POST', 'me', 'notifications', 'read')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    await q.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), me.id);
    return ok({ ok: true });
  }

  // --- Messages au propriÃ©taire (tickets) ---
  if (seg[0] === 'me' && seg[1] === 'tickets') {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    if (is('GET', 'me', 'tickets')) return ok({ results: await q.all('SELECT id, ref, category, subject, status, created_at, updated_at FROM tickets WHERE user_id = ? ORDER BY updated_at DESC', me.id) });
    const t = await q.first('SELECT * FROM tickets WHERE id = ? AND user_id = ?', seg[2], me.id); if (!t) fail(404, 'NOT_FOUND', 'Message introuvable.');
    if (method === 'GET' && seg.length === 3) return ok({ ...t, messages: await q.all('SELECT body, from_team, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at', t.id) });
    if (method === 'POST' && seg[3] === 'messages') {
      const text = str(body.body, 3000); if (!text) fail(400, 'EMPTY', 'Message vide.');
      await q.run('INSERT INTO ticket_messages (id, ticket_id, author_id, body, created_at) VALUES (?,?,?,?,?)', uid(), t.id, me.id, text, nowIso());
      await q.run("UPDATE tickets SET status = 'OPEN', updated_at = ? WHERE id = ?", nowIso(), t.id);
      await notifyTeam(q, `RÃ©ponse du client ${t.ref}`, text.slice(0, 80), `#/messages/${t.id}`);
      return ok({ ok: true }, 201);
    }
  }
  // --- Facture (client propriÃ©taire de la facture, ou Ã©quipe) ---
  if (is('GET', 'invoices', '*')) {
    if (!me) fail(401, 'AUTH_REQUIRED', 'Connectez-vous pour continuer.');
    const inv = await q.first('SELECT * FROM invoices WHERE id = ?', r1);
    if (!inv || (!['admin', 'superadmin'].includes(me.role) && inv.customer_id !== me.id)) fail(404, 'NOT_FOUND', 'Facture introuvable.');
    const b = inv.booking_id ? await q.first('SELECT b.ref, b.kind, (SELECT provider FROM payments p WHERE p.booking_id = b.id) provider, (SELECT provider_ref FROM payments p WHERE p.booking_id = b.id) provider_ref FROM bookings b WHERE b.id = ?', inv.booking_id) : null;
    const related = inv.booking_id ? await q.all('SELECT id, number, kind, total FROM invoices WHERE booking_id = ? AND id != ?', inv.booking_id, inv.id) : [];
    return ok({ ...inv, customer: JSON.parse(inv.customer), lines: JSON.parse(inv.lines), booking: b, related, company: (await getSettings(q)).company });
  }

  // --- Messagerie et signalements (client ou chauffeur de la rÃ©servation) ---
  if (seg[0] === 'bookings' && r1 && (seg[2] === 'messages' || seg[2] === 'report')) {
    const u = need(me, 'client', 'driver');
    const b = await q.first('SELECT * FROM bookings WHERE id = ?', r1);
    if (!b || (b.customer_id !== u.id && b.driver_id !== u.id)) fail(404, 'NOT_FOUND', 'RÃ©servation introuvable.');
    if (seg[2] === 'report' && method === 'POST') {
      const cat = str(body.category, 30);
      if (!['COMPORTEMENT', 'RETARD', 'CONDUITE', 'PAIEMENT_HORS_APP', 'FRAUDE', 'ANNULATION', 'AUTRE'].includes(cat)) fail(400, 'CATEGORY_INVALID', 'Motif invalide.');
      const details = str(body.details, 1000); if (details.length < 10) fail(400, 'DETAILS_REQUIRED', 'DÃ©crivez ce qui s\'est passÃ© (10 caractÃ¨res minimum).');
      const id = uid();
      await q.run('INSERT INTO incidents (id, reporter_id, target_id, booking_id, category, details, created_at) VALUES (?,?,?,?,?,?,?)', id, u.id, u.id === b.customer_id ? b.driver_id : b.customer_id, b.id, cat, details, nowIso());
      const iref = await setRef(q, 'incidents', id);
      await notifyTeam(q, `Signalement ${iref}`, `${INC_LABEL[cat] || cat} Â· rÃ©servation ${b.ref}`, '#/litiges');
      await audit(q, u.id, 'incident.reported', 'booking', b.id, { cat });
      return ok({ id }, 201);
    }
    if (method === 'GET') {
      const msgs = await q.all('SELECT m.id, m.body, m.created_at, m.sender_id, u.name sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.booking_id = ? ORDER BY m.created_at LIMIT 500', b.id);
      return ok({ results: msgs.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, sender_name: firstName(m.sender_name), mine: m.sender_id === u.id })) });
    }
    if (method === 'POST') {
      let text = str(body.body, 1000); if (!text) fail(400, 'EMPTY', 'Message vide.');
      const before = text;
      text = text.replace(/(\+?\d[\d\s.\-]{6,}\d)/g, '[numÃ©ro masquÃ©]');
      await q.run('INSERT INTO messages (id, booking_id, sender_id, body, masked, created_at) VALUES (?,?,?,?,?,?)', uid(), b.id, u.id, text, before !== text ? 1 : 0, nowIso());
      await notify(q, u.id === b.customer_id ? b.driver_id : b.customer_id, 'Nouveau message', text.slice(0, 80), u.id === b.customer_id ? `#/mission/${b.id}` : `#/reservation/${b.id}`, 'message');
      return ok({ masked: before !== text }, 201);
    }
  }
  return null;
}

// ============================== Espace client ==============================
async function clientRoutes({ q, env, me, method, is, r1, r2, r3, seg, query, body }) {
  const u = need(me, 'client');
  if (!u.name && !(is('GET', 'client', 'bookings'))) fail(400, 'NAME_REQUIRED', 'ComplÃ©tez votre profil (nom) avant de continuer.');
  const now = nowIso();

  if (is('POST', 'client', 'packages')) {
    const A = cityByName(body.origin), B = cityByName(body.dest);
    if (!A || !B) fail(400, 'CITY_INVALID', 'Choisissez les villes dans la liste.');
    if (A === B) fail(400, 'CITY_SAME', 'DÃ©part et arrivÃ©e identiques.');
    const ptype = (await getParcelTypes(q)).find((t) => t.code === (str(body.type, 20) || 'COLIS'));
    if (!ptype) fail(400, 'TYPE_INVALID', 'Type d\'envoi indisponible.');
    const p = ptype.mode === 'WEIGHT'
      ? { weight_kg: Number(body.weightKg), length_cm: int(body.lengthCm), width_cm: int(body.widthCm), height_cm: int(body.heightCm), category: str(body.category, 30), declared_value: Math.max(0, int(body.declaredValue) || 0) }
      : { weight_kg: ptype.nominal_kg || 0.2, length_cm: 35, width_cm: 25, height_cm: 3, category: 'documents', declared_value: Math.max(0, int(body.declaredValue) || 0) };
    const errs = validatePackage(p); if (errs.length) fail(400, 'PACKAGE_INVALID', errs.join(' '));
    if (!body.acceptRules) fail(400, 'RULES_REQUIRED', 'Confirmez que le colis ne contient aucun objet interdit.');
    const today = now.slice(0, 10), from = str(body.dateFrom, 10) || today, to = str(body.dateTo, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from || to < today) fail(400, 'DATE_INVALID', 'Dates invalides.');
    const rName = str(body.recipientName, 60); if (!rName) fail(400, 'RECIPIENT_REQUIRED', 'Nom du destinataire requis.');
    const rPhone = normalizePhone(body.recipientPhone), id = uid();
    await q.run(`INSERT INTO packages (id, type_code, sender_id, origin, origin_lat, origin_lng, dest, dest_lat, dest_lng, date_from, date_to, weight_kg, length_cm, width_cm, height_cm, category, declared_value, fragile, urgent, description, recipient_name, recipient_phone, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ptype.code, u.id, A.name, A.lat, A.lng, B.name, B.lat, B.lng, from, to, p.weight_kg, p.length_cm, p.width_cm, p.height_cm, p.category, p.declared_value, body.fragile ? 1 : 0, body.urgent ? 1 : 0, str(body.description, 300), rName, rPhone, now);
    const ref = await setRef(q, 'packages', id);
    return ok({ id, ref }, 201);
  }
  if (is('GET', 'client', 'packages')) return ok({ results: (await q.all('SELECT * FROM packages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 100', u.id)).map((p) => packageView(p)) });
  if (is('GET', 'client', 'packages', '*')) {
    const p = await q.first('SELECT * FROM packages WHERE id = ? AND sender_id = ?', r2, u.id); if (!p) fail(404, 'NOT_FOUND', 'Colis introuvable.');
    const b = await q.first("SELECT id FROM bookings WHERE package_id = ? AND status NOT IN ('CANCELLED','EXPIRED','REFUNDED') ORDER BY created_at DESC", p.id);
    const pp = await parcelPrice(q, p.type_code, cityByName(p.origin), cityByName(p.dest), p.weight_kg);
    return ok({ ...packageView(p), typeLabel: pp.type.label, typeMode: pp.type.mode, idCheck: !!pp.type.id_check, bookingId: b?.id || null, price: pp.client });
  }
  if (is('GET', 'client', 'packages', '*', 'matches')) {
    const p = await q.first('SELECT * FROM packages WHERE id = ? AND sender_id = ?', r2, u.id); if (!p) fail(404, 'NOT_FOUND', 'Colis introuvable.');
    const r = await offersFor(q, p);
    const price = (await parcelPrice(q, p.type_code, cityByName(p.origin), cityByName(p.dest), p.weight_kg)).client;
    const view = async (c) => ({ trip: tripView(c.trip), driver: await publicUser(q, c.trip.driver_id), score: c.score, level: c.level, breakdown: c.breakdown, detourKm: Math.round(c.detourKm * 10) / 10, passAt: c.passAt, arriveAt: c.arriveAt });
    return ok({ algoVersion: ALGO_VERSION, price, evaluated: r.evaluated, rejected: r.rejected, top: await Promise.all(r.top.map(view)), alternatives: await Promise.all(r.alternatives.map(view)) });
  }
  if (is('POST', 'client', 'packages', '*', 'cancel')) {
    const p = await q.first('SELECT * FROM packages WHERE id = ? AND sender_id = ?', r2, u.id); if (!p) fail(404, 'NOT_FOUND', 'Colis introuvable.');
    if (p.status !== 'CREATED') fail(409, 'STATE', 'Annulez d\'abord la rÃ©servation associÃ©e.');
    await q.run("UPDATE packages SET status = 'CANCELLED' WHERE id = ?", p.id);
    return ok({ status: 'CANCELLED' });
  }

  // RÃ©servation = paiement immÃ©diat (prix fixÃ© par Bokk Yoon)
  if (is('POST', 'client', 'bookings')) {
    const t = await q.first("SELECT t.* FROM trips t JOIN users d ON d.id = t.driver_id WHERE t.id = ? AND d.status = 'active'", str(body.tripId, 64));
    if (!t || !['PUBLISHED', 'FULL'].includes(t.status) || t.departure_at < now) fail(404, 'TRIP_UNAVAILABLE', 'Trajet indisponible.');
    const s = await getSettings(q), id = uid(), expires = new Date(Date.now() + s.booking.paymentWindowMin * 60000).toISOString();
    if (body.kind === 'SEAT') {
      const seats = int(body.seats) || 1;
      if (!(seats >= 1 && seats <= 4)) fail(400, 'SEATS_INVALID', '1 Ã  4 places par rÃ©servation.');
      const A = cityByName(body.from) || cityByName(t.origin), B = cityByName(body.to) || cityByName(t.dest);
      const pA = projectOnSegment(A, { lat: t.origin_lat, lng: t.origin_lng }, { lat: t.dest_lat, lng: t.dest_lng }), pB = projectOnSegment(B, { lat: t.origin_lat, lng: t.origin_lng }, { lat: t.dest_lat, lng: t.dest_lng });
      if (pA.distKm > 12 || pB.distKm > 12 || !(pA.t < pB.t)) fail(400, 'NOT_ON_ROUTE', 'Ces villes ne sont pas sur l\'itinÃ©raire de ce trajet.');
      const dup = await q.first("SELECT id FROM bookings WHERE trip_id = ? AND customer_id = ? AND kind = 'SEAT' AND status IN ('PENDING_PAYMENT','PAID')", t.id, u.id);
      if (dup) fail(409, 'ALREADY_BOOKED', 'Vous avez dÃ©jÃ  une rÃ©servation sur ce trajet.');
      if (!(await q.run("UPDATE trips SET seats_left = seats_left - ? WHERE id = ? AND seats_left >= ? AND status = 'PUBLISHED'", seats, t.id, seats))) fail(409, 'TRIP_FULL', 'Plus assez de places sur ce trajet.');
      await q.run("UPDATE trips SET status = 'FULL' WHERE id = ? AND seats_left = 0 AND parcel_kg_left < 0.5", t.id);
      const qt = await quoteFor(q, A, B);
      await q.run(`INSERT INTO bookings (id, kind, trip_id, customer_id, driver_id, seats, from_city, to_city, list_price, price, driver_pay, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, 'SEAT', t.id, u.id, t.driver_id, seats, A.name, B.name, qt.clientSeat * seats, qt.clientSeat * seats, qt.driverSeat * seats, expires, now, now);
    } else if (body.kind === 'PARCEL') {
      const p = await q.first('SELECT * FROM packages WHERE id = ? AND sender_id = ?', str(body.packageId, 64), u.id);
      if (!p) fail(404, 'NOT_FOUND', 'Colis introuvable.');
      if (p.status !== 'CREATED') fail(409, 'STATE', 'Ce colis a dÃ©jÃ  une rÃ©servation en cours.');
      const m = matchPackageTrip(p, t, await userStats(q, t.driver_id));
      if (!m.ok) fail(409, 'NOT_COMPATIBLE', `Trajet incompatible : ${m.reason}.`);
      if (!(await q.run('UPDATE trips SET parcel_kg_left = parcel_kg_left - ? WHERE id = ? AND parcel_kg_left >= ?', p.weight_kg, t.id, p.weight_kg))) fail(409, 'NO_CAPACITY', 'CapacitÃ© colis insuffisante.');
      await q.run("UPDATE packages SET status = 'BOOKED' WHERE id = ?", p.id);
      const am = await parcelPrice(q, p.type_code, cityByName(p.origin), cityByName(p.dest), p.weight_kg);
      const sc = rankMatches([m]); const score = (sc.top[0] || sc.alternatives[0])?.score ?? null;
      await q.run(`INSERT INTO bookings (id, kind, trip_id, customer_id, driver_id, package_id, from_city, to_city, match_score, list_price, price, driver_pay, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, 'PARCEL', t.id, u.id, t.driver_id, p.id, p.origin, p.dest, score, am.client, am.client, am.driver, expires, now, now);
    } else fail(400, 'KIND_INVALID', 'Type de rÃ©servation invalide.');
    const ref = await setRef(q, 'bookings', id);
    if (body.promoCode) {
      const bk = await q.first('SELECT * FROM bookings WHERE id = ?', id);
      try { const pr = await checkPromo(q, body.promoCode, bk.kind, bk.list_price, u.id); await q.run('UPDATE bookings SET promo_code = ?, discount = ?, price = ? WHERE id = ?', pr.code, pr.discount, bk.list_price - pr.discount, id); } catch { /* code invalide : ignorÃ©, le client peut le ressaisir au paiement */ }
    }
    await audit(q, u.id, 'booking.created', 'booking', id, { kind: body.kind });
    return ok({ id, ref, expiresAt: expires }, 201);
  }
  if (is('GET', 'client', 'bookings')) {
    const rows = await q.all(`SELECT b.*, t.departure_at, d.name driver_name, (SELECT id FROM invoices i WHERE i.booking_id = b.id AND i.kind = 'INVOICE') invoice_id FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN users d ON d.id = b.driver_id WHERE b.customer_id = ? ORDER BY b.updated_at DESC LIMIT 200`, u.id);
    return ok({ results: rows.map((b) => ({ ...bookingView(b, 'client'), departureAt: b.departure_at, driverName: firstName(b.driver_name), invoiceId: b.invoice_id })) });
  }
  if (is('GET', 'client', 'invoices')) return ok({ results: await q.all('SELECT id, number, kind, total, status, issued_at, booking_id FROM invoices WHERE customer_id = ? ORDER BY issued_at DESC', u.id) });
  if (seg[1] === 'bookings' && r2) {
    const b = await q.first('SELECT * FROM bookings WHERE id = ? AND customer_id = ?', r2, u.id);
    if (!b) fail(404, 'NOT_FOUND', 'RÃ©servation introuvable.');
    const t = await q.first('SELECT t.*, v.label vehicle_label, v.plate FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?', b.trip_id);
    if (method === 'GET' && seg.length === 3) {
      const p = b.package_id ? await q.first('SELECT * FROM packages WHERE id = ?', b.package_id) : null;
      return ok({
        ...bookingView(b, 'client'), trip: { ...tripView(t), plate: ['PAID', 'IN_PROGRESS'].includes(b.status) ? t.plate : null }, package: p ? packageView(p) : null,
        driver: await publicUser(q, b.driver_id),
        myReview: await q.first('SELECT rating, comment FROM reviews WHERE booking_id = ? AND author_id = ?', b.id, u.id),
        dispute: await q.first('SELECT reason, status, decision, refund_amount FROM disputes WHERE booking_id = ? ORDER BY created_at DESC', b.id),
        payment: await q.first('SELECT provider, provider_ref, amount, status, created_at FROM payments WHERE booking_id = ?', b.id),
        claim: await q.first('SELECT ref, provider, transaction_ref, amount, status, reason, created_at FROM payment_claims WHERE booking_id = ? ORDER BY created_at DESC', b.id),
        invoices: await q.all('SELECT id, number, kind, total FROM invoices WHERE booking_id = ? ORDER BY issued_at', b.id),
        feedback: await q.first('SELECT score FROM feedback WHERE booking_id = ? AND user_id = ?', b.id, u.id),
        typeLabel: b.package_id ? (await q.first('SELECT pt.label, pt.id_check FROM packages p LEFT JOIN parcel_types pt ON pt.code = p.type_code WHERE p.id = ?', b.package_id)) : null,
        live: ['PAID', 'IN_PROGRESS'].includes(b.status) ? await livePosition(q, t) : null,
      });
    }
    if (method === 'POST' && r3 === 'promo') {
      if (b.status !== 'PENDING_PAYMENT') fail(409, 'STATE', 'Le code promo s\'applique avant le paiement.');
      if (!str(body.code, 30)) { await q.run('UPDATE bookings SET promo_code = NULL, discount = 0, price = list_price WHERE id = ?', b.id); return ok({ price: b.list_price, discount: 0 }); }
      const pr = await checkPromo(q, body.code, b.kind, b.list_price, u.id);
      await q.run('UPDATE bookings SET promo_code = ?, discount = ?, price = ?, updated_at = ? WHERE id = ?', pr.code, pr.discount, b.list_price - pr.discount, now, b.id);
      return ok({ code: pr.code, discount: pr.discount, price: b.list_price - pr.discount, label: pr.label });
    }
    if (method === 'POST' && r3 === 'feedback') {
      if (b.status !== 'COMPLETED') fail(409, 'STATE', 'Le formulaire de retour s\'ouvre Ã  la fin du trajet.');
      const score = int(body.score); if (!(score >= 0 && score <= 10)) fail(400, 'SCORE_INVALID', 'Choisissez une note de 0 Ã  10.');
      if (await q.first('SELECT id FROM feedback WHERE booking_id = ? AND user_id = ?', b.id, u.id)) fail(409, 'ALREADY', 'Merci, votre retour est dÃ©jÃ  enregistrÃ©.');
      await q.run('INSERT INTO feedback (id, booking_id, user_id, score, liked, improve, created_at) VALUES (?,?,?,?,?,?,?)', uid(), b.id, u.id, score, str(body.liked, 1000), str(body.improve, 1000), now);
      if (score <= 6) await notifyTeam(q, `Retour client ${score}/10`, `${b.ref} : ${str(body.improve, 120) || 'sans commentaire'}`, '#/retours');
      return ok({ ok: true }, 201);
    }
    if (method === 'POST' && r3 === 'pay') {
      const existing = await q.first('SELECT id FROM payments WHERE booking_id = ?', b.id);
      if (existing) return ok({ status: b.status, paymentId: existing.id, idempotent: true });
      if (b.status === 'EXPIRED') fail(409, 'EXPIRED', 'Le dÃ©lai de paiement est dÃ©passÃ©. Refaites la rÃ©servation.');
      if (b.status !== 'PENDING_PAYMENT') fail(409, 'STATE', 'Cette rÃ©servation ne peut plus Ãªtre payÃ©e.');
      if (payMode((await getSettings(q)).payment, env) !== 'SIMULATION') fail(409, 'MANUAL_PAYMENT', 'Payez avec le QR code Wave ou Orange Money, puis indiquez l\'ID de la transaction.');
      const provider = str(body.provider, 20);
      if (!['WAVE', 'ORANGE_MONEY', 'FREE_MONEY', 'CARD'].includes(provider)) fail(400, 'PROVIDER_INVALID', 'Moyen de paiement invalide.');
      // Paiement SIMULÃ‰ : en production, session de paiement chez le prestataire puis validation sur webhook signÃ©.
      const pid = await capturePayment(q, env, b, t, provider, 'SIM-' + randomHex(6).toUpperCase(), u.id, { simulated: true, idempotencyKey: str(body.idempotencyKey, 80) || null });
      return ok({ status: 'PAID', paymentId: pid });
    }
    if (method === 'POST' && r3 === 'payment-claim') {
      const ps = (await getSettings(q)).payment;
      if (b.status !== 'PENDING_PAYMENT') fail(409, 'STATE', b.status === 'EXPIRED' ? 'Le dÃ©lai de paiement est dÃ©passÃ©. Si vous avez dÃ©jÃ  payÃ©, Ã©crivez-nous avec l\'ID de transaction.' : 'Cette rÃ©servation ne peut plus Ãªtre payÃ©e.');
      const provider = body.provider === 'ORANGE_MONEY' ? 'ORANGE_MONEY' : 'WAVE';
      const m = provider === 'WAVE' ? ps.wave : ps.orange;
      if (!m?.enabled) fail(400, 'PROVIDER_INVALID', 'Ce moyen de paiement n\'est pas disponible.');
      const txn = str(body.transactionRef, 60).replace(/\s+/g, '').toUpperCase();
      if (txn.length < 6) fail(400, 'TXN_REQUIRED', 'Indiquez l\'ID de la transaction (visible dans l\'historique de votre application).');
      if (await q.first("SELECT id FROM payment_claims WHERE booking_id = ? AND status = 'PENDING'", b.id)) fail(409, 'ALREADY', 'Votre paiement est dÃ©jÃ  en cours de vÃ©rification.');
      if (await q.first('SELECT id FROM payment_claims WHERE provider = ? AND transaction_ref = ?', provider, txn) || await q.first('SELECT id FROM payments WHERE provider = ? AND provider_ref = ?', provider, txn)) fail(409, 'TXN_USED', 'Cet ID de transaction a dÃ©jÃ  Ã©tÃ© utilisÃ©.');
      const id = uid(), now2 = nowIso();
      await q.run('INSERT INTO payment_claims (id, booking_id, customer_id, provider, transaction_ref, payer_phone, payer_name, amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        id, b.id, u.id, provider, txn, body.payerPhone ? normalizePhone(body.payerPhone) : u.phone, str(body.payerName, 80) || u.name, b.price, now2);
      const ref = await setRef(q, 'payment_claims', id);
      await notifyTeam(q, `Paiement Ã  vÃ©rifier ${ref}`, `${fmtAmount(b.price)} FCFA ${provider === 'WAVE' ? 'Wave' : 'Orange Money'} Â· ${b.ref} Â· ID ${txn}`, '#/encaissements');
      const c = (await getSettings(q)).company;
      await sendEmail(env, env.OWNER_EMAIL || c.email, `[Bokk Yoon] Paiement Ã  vÃ©rifier ${ref} Â· ${fmtAmount(b.price)} FCFA`, `RÃ©servation ${b.ref} (${b.from_city} â†’ ${b.to_city})\nClient : ${u.name} (${u.phone})\nMoyen : ${provider}\nID de transaction : ${txn}\nMontant attendu : ${fmtAmount(b.price)} FCFA\n\nVÃ©rifiez dans votre application ${provider === 'WAVE' ? 'Wave' : 'Orange Money'}, puis validez dans l'espace Ã©quipe â†’ Encaissements.`);
      await audit(q, u.id, 'payment.claimed', 'booking', b.id, { provider, txn, amount: b.price });
      return ok({ id, ref, status: 'PENDING' }, 201);
    }
    if (method === 'POST' && r3 === 'cancel') {
      if (!['PENDING_PAYMENT', 'PAID'].includes(b.status)) fail(409, 'STATE', 'Cette rÃ©servation ne peut plus Ãªtre annulÃ©e.');
      if (await q.first("SELECT id FROM payment_claims WHERE booking_id = ? AND status = 'PENDING'", b.id)) fail(409, 'CLAIM_PENDING', 'Votre paiement est en cours de vÃ©rification : Ã©crivez-nous pour annuler, nous vous rembourserons.');
      const r = await cancelBooking(q, env, b, 'client', str(body.reason, 100) || 'annulation', u.id);
      await audit(q, u.id, 'booking.cancelled', 'booking', b.id, r);
      return ok(r);
    }
    if (method === 'POST' && r3 === 'review') {
      if (b.status !== 'COMPLETED') fail(409, 'STATE', 'Vous pourrez noter une fois le trajet terminÃ©.');
      const rating = int(body.rating); if (!(rating >= 1 && rating <= 5)) fail(400, 'RATING_INVALID', 'Note de 1 Ã  5.');
      if (await q.first('SELECT id FROM reviews WHERE booking_id = ? AND author_id = ?', b.id, u.id)) fail(409, 'ALREADY_REVIEWED', 'Vous avez dÃ©jÃ  laissÃ© un avis.');
      await q.run('INSERT INTO reviews (id, booking_id, author_id, target_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)', uid(), b.id, u.id, b.driver_id, rating, str(body.comment, 500), now);
      if (rating <= 2) { const iid = uid(); await q.run("INSERT INTO incidents (id, reporter_id, target_id, booking_id, category, details, created_at) VALUES (?,?,?,?,'AUTRE',?,?)", iid, u.id, b.driver_id, b.id, 'Note basse (' + rating + '/5) : ' + (str(body.comment, 500) || 'sans commentaire'), now); await setRef(q, 'incidents', iid); }
      return ok({ ok: true }, 201);
    }
    if (method === 'POST' && r3 === 'dispute') {
      if (!['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(b.status)) fail(409, 'STATE', 'RÃ©clamation impossible Ã  ce stade.');
      if (b.status === 'COMPLETED' && Date.now() - new Date(b.delivered_at || b.updated_at) > 48 * 3600000) fail(409, 'TOO_LATE', 'DÃ©lai de 48 h dÃ©passÃ©.');
      const reason = str(body.reason, 20);
      if (!['LOST', 'DAMAGED', 'NOT_DELIVERED', 'NO_SHOW', 'PAYMENT', 'OTHER'].includes(reason)) fail(400, 'REASON_INVALID', 'Motif invalide.');
      if (await q.first("SELECT id FROM disputes WHERE booking_id = ? AND status = 'OPEN'", b.id)) fail(409, 'ALREADY_OPEN', 'Une rÃ©clamation est dÃ©jÃ  ouverte.');
      const did = uid();
      await q.run('INSERT INTO disputes (id, booking_id, opened_by, reason, details, created_at) VALUES (?,?,?,?,?,?)', did, b.id, u.id, reason, str(body.details, 1000), now);
      const dref = await setRef(q, 'disputes', did);
      await notifyTeam(q, `RÃ©clamation ${dref}`, `RÃ©servation ${b.ref}`, '#/litiges');
      await q.run("UPDATE bookings SET status = 'DISPUTED', payout_status = CASE WHEN payout_status = 'DUE' THEN 'HELD' ELSE payout_status END, updated_at = ? WHERE id = ?", now, b.id);
      if (b.package_id) await q.run("UPDATE packages SET status = 'DISPUTED' WHERE id = ?", b.package_id);
      await notify(q, b.driver_id, 'RÃ©clamation ouverte', `${b.from_city} â†’ ${b.to_city} : le versement est suspendu pendant l'examen par l'Ã©quipe.`, `#/mission/${b.id}`, 'warning');
      await audit(q, u.id, 'dispute.opened', 'booking', b.id, { reason });
      return ok({ id: did }, 201);
    }
  }

  // Espace boutique (API partenaires)
  if (is('GET', 'client', 'partner')) {
    const p = await q.first('SELECT id, name, api_key_prefix, webhook_url, created_at FROM partners WHERE owner_id = ?', u.id);
    if (!p) return ok({ partner: null });
    return ok({ partner: p, events: await q.all('SELECT event, delivery_status, created_at FROM partner_events WHERE partner_id = ? ORDER BY created_at DESC LIMIT 30', p.id),
      shipments: (await q.all('SELECT * FROM packages WHERE partner_id = ? ORDER BY created_at DESC LIMIT 50', p.id)).map((s) => packageView(s)) });
  }
  if (is('POST', 'client', 'partner')) {
    const name = str(body.name, 80); if (!name) fail(400, 'NAME_REQUIRED', 'Nom de la boutique requis.');
    const url = str(body.webhookUrl, 300); if (url && !/^https:\/\//.test(url)) fail(400, 'URL_INVALID', 'L\'URL doit commencer par https://');
    const apiKey = 'bk_live_' + randomHex(20), secret = 'whsec_' + randomHex(16);
    const ex = await q.first('SELECT id FROM partners WHERE owner_id = ?', u.id);
    if (ex) await q.run('UPDATE partners SET name = ?, webhook_url = ?, api_key_hash = ?, api_key_prefix = ?, webhook_secret = ? WHERE id = ?', name, url, await sha256(apiKey), apiKey.slice(0, 12), secret, ex.id);
    else await q.run('INSERT INTO partners (id, owner_id, name, api_key_hash, api_key_prefix, webhook_url, webhook_secret, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), u.id, name, await sha256(apiKey), apiKey.slice(0, 12), url, secret, now);
    return ok({ apiKey, webhookSecret: secret, note: 'Conservez ces clÃ©s : elles ne seront plus affichÃ©es.' }, 201);
  }
  return null;
}
const INC_LABEL = { COMPORTEMENT: 'Comportement', RETARD: 'Retard', CONDUITE: 'Conduite dangereuse', PAIEMENT_HORS_APP: 'Paiement hors application', FRAUDE: 'Fraude', ANNULATION: 'Annulation', AUTRE: 'Autre' };
const fmtDay = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ============================= Espace chauffeur =============================
async function driverRoutes({ q, env, me, method, is, r2, r3, seg, query, body }) {
  const u = need(me, 'driver');
  const now = nowIso();
  if (is('GET', 'driver', 'application')) {
    return ok({ profile: await q.first('SELECT * FROM driver_profiles WHERE user_id = ?', u.id), vehicles: await q.all('SELECT * FROM vehicles WHERE owner_id = ?', u.id) });
  }
  if (is('POST', 'driver', 'application')) {
    const cur = await q.first('SELECT status FROM driver_profiles WHERE user_id = ?', u.id);
    if (cur?.status === 'APPROVED') fail(409, 'ALREADY_APPROVED', 'Votre dossier est dÃ©jÃ  validÃ©.');
    const name = str(body.name, 60); if (!name || name.split(/\s+/).length < 2) fail(400, 'NAME_REQUIRED', 'Indiquez votre prÃ©nom et votre nom tels qu\'ils figurent sur votre piÃ¨ce.');
    const doc = str(body.idDocType, 20); if (!['CNI', 'PASSEPORT', 'CARTE_CEDEAO'].includes(doc)) fail(400, 'DOC_INVALID', 'Type de piÃ¨ce invalide.');
    const idLast4 = str(body.idDocLast4, 4), licLast4 = str(body.licenseLast4, 4);
    if (!/^\w{4}$/.test(idLast4) || !/^\w{4}$/.test(licLast4)) fail(400, 'DOC_NUMBERS', 'Indiquez les 4 derniers caractÃ¨res de votre piÃ¨ce et de votre permis.');
    const since = int(body.licenseSince); if (!(since >= 1970 && since <= new Date().getFullYear() - 2)) fail(400, 'LICENSE_TOO_RECENT', 'Le permis doit avoir au moins 2 ans.');
    const ins = str(body.insuranceUntil, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(ins) || ins < now.slice(0, 10)) fail(400, 'INSURANCE_INVALID', 'L\'assurance du vÃ©hicule doit Ãªtre en cours de validitÃ©.');
    const prov = ['WAVE', 'ORANGE_MONEY', 'FREE_MONEY'].includes(body.payoutProvider) ? body.payoutProvider : 'WAVE';
    const payPhone = normalizePhone(body.payoutPhone || u.phone), city = cityByName(body.homeCity)?.name || '';
    if (!city) fail(400, 'CITY_REQUIRED', 'Choisissez votre ville.');
    const v = body.vehicle || {};
    const type = str(v.type, 20), seats = int(v.seats), kg = int(v.cargoKg), label = str(v.label, 80), plate = str(v.plate, 15).toUpperCase();
    if (!label || !plate) fail(400, 'VEHICLE_REQUIRED', 'DÃ©crivez votre vÃ©hicule et sa plaque.');
    if (!['citadine', 'berline', '7places', 'minibus', 'pickup'].includes(type)) fail(400, 'TYPE_INVALID', 'Type de vÃ©hicule invalide.');
    if (!(seats >= 1 && seats <= 8) || !(kg >= 0 && kg <= 200)) fail(400, 'CAPACITY_INVALID', 'Places : 1 Ã  8 ; colis : 0 Ã  200 kg.');
    const s = await getSettings(q), status = s.booking.driverAutoApprove || env.AUTO_APPROVE_DRIVERS === 'true' ? 'APPROVED' : 'PENDING';
    await q.run('UPDATE users SET name = ?, city = ? WHERE id = ?', name, city, u.id);
    await q.run('DELETE FROM driver_profiles WHERE user_id = ?', u.id);
    await q.run(`INSERT INTO driver_profiles (user_id, status, id_doc_type, id_doc_last4, license_last4, license_since, insurance_until, payout_provider, payout_phone, home_city, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      u.id, status, doc, idLast4, licLast4, since, ins, prov, payPhone, city, now);
    await q.run('DELETE FROM vehicles WHERE owner_id = ? AND NOT EXISTS (SELECT 1 FROM trips WHERE vehicle_id = vehicles.id)', u.id);
    await q.run('INSERT INTO vehicles (id, owner_id, label, type, seats, cargo_kg, plate, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), u.id, label, type, seats, kg, plate, now);
    await audit(q, u.id, 'driver.application', 'user', u.id, { status });
    return ok({ status }, 201);
  }
  await needApprovedDriver(q, u);

  if (is('GET', 'driver', 'quote')) {
    const A = cityByName(query.from), B = cityByName(query.to);
    if (!A || !B || A === B) fail(400, 'CITY_INVALID', 'Villes invalides.');
    const qt = await quoteFor(q, A, B);
    return ok({ distanceKm: qt.distanceKm, durationMin: qt.durationMin, perSeat: qt.driverSeat, perParcel: qt.driverParcel });
  }
  if (is('GET', 'driver', 'dashboard')) {
    const upcoming = await q.all("SELECT t.*, v.label vehicle_label, (SELECT COUNT(*) FROM bookings b WHERE b.trip_id = t.id AND b.status = 'PAID') confirmed FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.driver_id = ? AND t.status IN ('PUBLISHED','FULL','IN_PROGRESS') ORDER BY t.departure_at LIMIT 10", u.id);
    const e = await earnings(q, u.id);
    return ok({ upcoming: upcoming.map((t) => ({ ...tripView(t), confirmed: t.confirmed })), earnings: e.totals, stats: await userStats(q, u.id) });
  }
  if (is('GET', 'driver', 'earnings')) return ok(await earnings(q, u.id));
  if (is('GET', 'driver', 'statement')) {
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : nowIso().slice(0, 7);
    const dp = await q.first('SELECT payout_provider, payout_phone FROM driver_profiles WHERE user_id = ?', u.id);
    const missions = await q.all(`SELECT b.ref, b.kind, b.seats, b.from_city, b.to_city, b.driver_pay, b.payout_status, b.status, t.ref trip_ref, t.departure_at, p.ref pkg_ref FROM bookings b JOIN trips t ON t.id = b.trip_id LEFT JOIN packages p ON p.id = b.package_id
      WHERE b.driver_id = ? AND b.status IN ('COMPLETED','REFUNDED') AND b.driver_pay > 0 AND substr(t.departure_at, 1, 7) = ? ORDER BY t.departure_at`, u.id, month);
    const payouts = await q.all('SELECT ref, amount, bookings_count, provider, reference, created_at FROM payouts WHERE driver_id = ? AND substr(created_at, 1, 7) = ? ORDER BY created_at', u.id, month);
    return ok({ month, driver: { ref: u.ref, name: u.name, phone: u.phone, city: u.city, payoutProvider: dp.payout_provider, payoutPhone: dp.payout_phone }, missions, payouts,
      totals: { earned: missions.reduce((a, m) => a + m.driver_pay, 0), paid: payouts.reduce((a, p) => a + p.amount, 0), count: missions.length }, company: (await getSettings(q)).company });
  }
  if (is('POST', 'driver', 'vehicles')) {
    const type = str(body.type, 20), seats = int(body.seats), kg = int(body.cargoKg), label = str(body.label, 80), plate = str(body.plate, 15).toUpperCase();
    if (!label || !plate) fail(400, 'VEHICLE_REQUIRED', 'DÃ©crivez le vÃ©hicule et sa plaque.');
    if (!['citadine', 'berline', '7places', 'minibus', 'pickup'].includes(type) || !(seats >= 1 && seats <= 8) || !(kg >= 0 && kg <= 200)) fail(400, 'VEHICLE_INVALID', 'VÃ©hicule invalide.');
    await q.run('INSERT INTO vehicles (id, owner_id, label, type, seats, cargo_kg, plate, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), u.id, label, type, seats, kg, plate, now);
    return ok({ ok: true }, 201);
  }
  if (is('POST', 'driver', 'trips')) {
    const v = await q.first('SELECT * FROM vehicles WHERE id = ? AND owner_id = ?', str(body.vehicleId, 64), u.id); if (!v) fail(400, 'VEHICLE_REQUIRED', 'Choisissez un vÃ©hicule.');
    const A = cityByName(body.origin), B = cityByName(body.dest);
    if (!A || !B) fail(400, 'CITY_INVALID', 'Choisissez les villes dans la liste.'); if (A === B) fail(400, 'CITY_SAME', 'DÃ©part et arrivÃ©e identiques.');
    const dep = new Date(body.departureAt); if (isNaN(dep) || dep < new Date(Date.now() + 15 * 60000)) fail(400, 'DATE_INVALID', 'Le dÃ©part doit Ãªtre dans au moins 15 minutes.');
    const seats = int(body.seats ?? v.seats), kg = Number(body.parcelKg ?? Math.min(v.cargo_kg, 20));
    if (!(seats >= 0 && seats <= v.seats)) fail(400, 'SEATS_INVALID', `Places : 0 Ã  ${v.seats} pour ce vÃ©hicule.`);
    if (!(kg >= 0 && kg <= v.cargo_kg)) fail(400, 'CARGO_INVALID', `Colis : 0 Ã  ${v.cargo_kg} kg pour ce vÃ©hicule.`);
    if (seats === 0 && kg === 0) fail(400, 'EMPTY_TRIP', 'Proposez au moins une place ou de la capacitÃ© colis.');
    const clash = await q.first("SELECT id FROM trips WHERE driver_id = ? AND status IN ('PUBLISHED','FULL','IN_PROGRESS') AND abs(julianday(departure_at) - julianday(?)) < 0.1", u.id, dep.toISOString());
    if (clash) fail(409, 'TRIP_CLASH', 'Vous avez dÃ©jÃ  un trajet Ã  moins de 2 h 30 de cet horaire.');
    const cats = (Array.isArray(body.categories) ? body.categories : CATEGORIES.map((c) => c.code)).filter((c) => CATEGORIES.some((x) => x.code === c));
    const qt = await quoteFor(q, A, B), id = uid();
    await q.run(`INSERT INTO trips (id, driver_id, vehicle_id, origin, origin_lat, origin_lng, dest, dest_lat, dest_lng, meeting_point, departure_at, distance_km, duration_min, seats_total, seats_left, parcel_kg_total, parcel_kg_left, max_detour_km, accepts_categories, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, u.id, v.id, A.name, A.lat, A.lng, B.name, B.lat, B.lng, str(body.meetingPoint, 120), dep.toISOString(), qt.distanceKm, qt.durationMin,
      seats, seats, kg, kg, Math.max(0, Math.min(20, int(body.maxDetourKm ?? 5))), cats.join(','), str(body.notes, 300), now);
    const ref = await setRef(q, 'trips', id);
    await audit(q, u.id, 'trip.published', 'trip', id);
    return ok({ id, ref }, 201);
  }
  if (is('GET', 'driver', 'trips')) {
    const rows = await q.all(`SELECT t.*, v.label vehicle_label, (SELECT COUNT(*) FROM bookings b WHERE b.trip_id = t.id AND b.status IN ('PAID','IN_PROGRESS','COMPLETED')) confirmed,
      (SELECT COALESCE(SUM(driver_pay),0) FROM bookings b WHERE b.trip_id = t.id AND b.status IN ('PAID','IN_PROGRESS','COMPLETED')) gains FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.driver_id = ? ORDER BY t.departure_at DESC LIMIT 100`, u.id);
    return ok({ results: rows.map((t) => ({ ...tripView(t), confirmed: t.confirmed, gains: t.gains })) });
  }
  if (seg[1] === 'trips' && r2) {
    const t = await q.first('SELECT t.*, v.label vehicle_label FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ? AND t.driver_id = ?', r2, u.id);
    if (!t) fail(404, 'NOT_FOUND', 'Trajet introuvable.');
    if (method === 'GET' && seg.length === 3) {
      const bs = await q.all(`SELECT b.*, c.name customer_name, p.weight_kg, p.category, p.description, p.fragile FROM bookings b JOIN users c ON c.id = b.customer_id LEFT JOIN packages p ON p.id = b.package_id
        WHERE b.trip_id = ? AND b.status NOT IN ('EXPIRED') ORDER BY b.created_at`, t.id);
      const qt = await quoteFor(q, cityByName(t.origin), cityByName(t.dest));
      return ok({ ...tripView(t), payPerSeat: qt.driverSeat, payPerParcel: qt.driverParcel, live: await livePosition(q, t),
        bookings: bs.map((b) => ({ ...bookingView(b, 'driver'), customerName: firstName(b.customer_name), parcel: b.package_id ? { weightKg: b.weight_kg, category: b.category, description: b.description, fragile: !!b.fragile } : null })) });
    }
    if (method === 'POST' && r3 === 'position') {
      if (t.status !== 'IN_PROGRESS') fail(409, 'STATE', 'Le partage de position est actif pendant le trajet uniquement.');
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!(lat > 12 && lat < 17 && lng > -18 && lng < -11)) fail(400, 'POSITION_INVALID', 'Position hors du SÃ©nÃ©gal.');
      await q.run('UPDATE trips SET last_lat = ?, last_lng = ?, last_accuracy = ?, last_pos_at = ? WHERE id = ?', lat, lng, Number(body.accuracy) || null, now, t.id);
      await q.run('INSERT INTO trip_positions (id, trip_id, lat, lng, accuracy, speed, created_at) VALUES (?,?,?,?,?,?,?)', uid(), t.id, lat, lng, Number(body.accuracy) || null, Number(body.speed) || null, now);
      return ok({ ok: true });
    }
    if (method === 'POST' && r3 === 'start') {
      if (!['PUBLISHED', 'FULL'].includes(t.status)) fail(409, 'STATE', 'Trajet dÃ©jÃ  dÃ©marrÃ© ou terminÃ©.');
      if (new Date(t.departure_at) - Date.now() > 3 * 3600000) fail(409, 'TOO_EARLY', 'Vous pourrez dÃ©marrer le trajet 3 h avant le dÃ©part.');
      await q.run("UPDATE trips SET status = 'IN_PROGRESS', started_at = ? WHERE id = ?", now, t.id);
      const pending = await q.all("SELECT * FROM bookings WHERE trip_id = ? AND status = 'PENDING_PAYMENT'", t.id);
      for (const b of pending) { await q.run("UPDATE bookings SET status = 'EXPIRED', updated_at = ? WHERE id = ?", now, b.id); await releaseCapacity(q, b); if (b.package_id) await q.run("UPDATE packages SET status = 'CREATED' WHERE id = ?", b.package_id); }
      const paid = await q.all("SELECT customer_id, id FROM bookings WHERE trip_id = ? AND status IN ('PAID','IN_PROGRESS')", t.id);
      for (const b of paid) await notify(q, b.customer_id, 'Votre chauffeur est en route', `${t.origin} â†’ ${t.dest} : suivez sa position en direct.`, `#/reservation/${b.id}`, 'info');
      return ok({ status: 'IN_PROGRESS' });
    }
    if (method === 'POST' && r3 === 'complete') {
      if (t.status !== 'IN_PROGRESS') fail(409, 'STATE', 'DÃ©marrez le trajet avant de le terminer.');
      const open = await q.first("SELECT COUNT(*) n FROM bookings WHERE trip_id = ? AND kind = 'PARCEL' AND status IN ('PAID','IN_PROGRESS')", t.id);
      if (open.n) fail(409, 'PARCELS_PENDING', `${open.n} colis non livrÃ©(s) : validez la livraison avec le code du destinataire.`);
      const s = await getSettings(q);
      await q.run("UPDATE trips SET status = 'COMPLETED', completed_at = ? WHERE id = ?", now, t.id);
      const done = await q.all("SELECT id, customer_id FROM bookings WHERE trip_id = ? AND kind = 'SEAT' AND status = 'IN_PROGRESS'", t.id);
      await q.run("UPDATE bookings SET status = 'COMPLETED', payout_status = 'DUE', payout_due_at = ?, updated_at = ? WHERE trip_id = ? AND kind = 'SEAT' AND status = 'IN_PROGRESS'", addHours(s.booking.payoutDelayHours), now, t.id);
      for (const b of done) await notify(q, b.customer_id, 'Bien arrivÃ© ?', 'Donnez votre avis sur le trajet.', `#/reservation/${b.id}`, 'info');
      const noShow = await q.all("SELECT * FROM bookings WHERE trip_id = ? AND kind = 'SEAT' AND status = 'PAID'", t.id);
      for (const b of noShow) await q.run("UPDATE bookings SET status = 'COMPLETED', cancel_reason = 'no_show', payout_status = 'DUE', payout_due_at = ?, updated_at = ? WHERE id = ?", addHours(s.booking.payoutDelayHours), now, b.id);
      return ok({ status: 'COMPLETED' });
    }
    if (method === 'POST' && r3 === 'cancel') {
      if (!['PUBLISHED', 'FULL'].includes(t.status)) fail(409, 'STATE', 'Ce trajet ne peut plus Ãªtre annulÃ©.');
      const reason = str(body.reason, 200); if (!reason) fail(400, 'REASON_REQUIRED', 'Indiquez le motif de l\'annulation.');
      await q.run("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", t.id);
      const bs = await q.all("SELECT * FROM bookings WHERE trip_id = ? AND status IN ('PENDING_PAYMENT','PAID')", t.id);
      for (const b of bs) await cancelBooking(q, env, b, 'driver', reason, u.id);
      if (bs.some((b) => b.status === 'PAID')) { const iid = uid(); await q.run("INSERT INTO incidents (id, reporter_id, target_id, category, details, created_at) VALUES (?,?,?,'ANNULATION',?,?)", iid, u.id, u.id, `Trajet ${t.ref} ${t.origin} â†’ ${t.dest} annulÃ© par le chauffeur avec ${bs.length} rÃ©servation(s) : ${reason}`, now); await setRef(q, 'incidents', iid); }
      await audit(q, u.id, 'trip.cancelled', 'trip', t.id, { reason, bookings: bs.length });
      return ok({ status: 'CANCELLED', affected: bs.length });
    }
  }
  if (seg[1] === 'bookings' && r2) {
    const b = await q.first('SELECT * FROM bookings WHERE id = ? AND driver_id = ?', r2, u.id);
    if (!b) fail(404, 'NOT_FOUND', 'Mission introuvable.');
    const t = await q.first('SELECT t.*, v.label vehicle_label FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = ?', b.trip_id);
    if (method === 'GET' && seg.length === 3) {
      const p = b.package_id ? await q.first('SELECT * FROM packages WHERE id = ?', b.package_id) : null;
      const c = await q.first('SELECT id, name FROM users WHERE id = ?', b.customer_id);
      return ok({ ...bookingView(b, 'driver'), trip: tripView(t), package: p ? packageView(p, false) : null, customer: { id: c.id, name: firstName(c.name), stats: await userStats(q, c.id) },
        myReview: await q.first('SELECT rating, comment FROM reviews WHERE booking_id = ? AND author_id = ?', b.id, u.id) });
    }
    if (method === 'POST' && r3 === 'pickup') {
      if (b.status !== 'PAID') fail(409, 'STATE', 'Cette mission n\'est pas prÃªte pour l\'enlÃ¨vement.');
      if (t.status !== 'IN_PROGRESS' && new Date(t.departure_at) - Date.now() > 36 * 3600000) fail(409, 'TOO_EARLY', 'EnlÃ¨vement possible la veille ou le jour du dÃ©part.');
      if (str(body.code, 6) !== b.pickup_code) fail(400, 'CODE_WRONG', 'Code incorrect. Demandez le code affichÃ© dans l\'application du client.');
      await q.run("UPDATE bookings SET status = 'IN_PROGRESS', pickup_at = ?, updated_at = ? WHERE id = ?", now, now, b.id);
      if (b.package_id) { await q.run("UPDATE packages SET status = 'PICKED_UP' WHERE id = ?", b.package_id); await notifyPartner(q, env, b.id, 'shipment.picked_up'); }
      await notify(q, b.customer_id, b.kind === 'PARCEL' ? 'Colis pris en charge' : 'Bon voyage !', `${b.from_city} â†’ ${b.to_city}`, `#/reservation/${b.id}`, 'success');
      await audit(q, u.id, b.kind === 'PARCEL' ? 'parcel.picked_up' : 'passenger.boarded', 'booking', b.id, { gps: body.gps || null });
      return ok({ status: 'IN_PROGRESS' });
    }
    if (method === 'POST' && r3 === 'deliver') {
      if (b.kind !== 'PARCEL' || b.status !== 'IN_PROGRESS') fail(409, 'STATE', 'Le colis doit avoir Ã©tÃ© pris en charge.');
      if (str(body.code, 6) !== b.delivery_code) fail(400, 'CODE_WRONG', 'Code destinataire incorrect.');
      const s = await getSettings(q);
      await q.run("UPDATE bookings SET status = 'COMPLETED', delivered_at = ?, payout_status = 'DUE', payout_due_at = ?, updated_at = ? WHERE id = ?", now, addHours(s.booking.payoutDelayHours), now, b.id);
      await q.run("UPDATE packages SET status = 'DELIVERED' WHERE id = ?", b.package_id);
      await notify(q, b.customer_id, 'Colis livrÃ© âœ“', `${b.from_city} â†’ ${b.to_city}. Donnez votre avis sur le chauffeur.`, `#/reservation/${b.id}`, 'success');
      await notifyPartner(q, env, b.id, 'shipment.delivered');
      await audit(q, u.id, 'parcel.delivered', 'booking', b.id, { gps: body.gps || null, offline: !!body.offline });
      return ok({ status: 'COMPLETED' });
    }
    if (method === 'POST' && r3 === 'decline') {
      if (b.status !== 'PAID') fail(409, 'STATE', 'Vous ne pouvez plus refuser cette mission.');
      const reason = str(body.reason, 200); if (!reason) fail(400, 'REASON_REQUIRED', 'Indiquez le motif du refus.');
      const r = await cancelBooking(q, env, b, 'driver', reason, u.id);
      const iid = uid(); await q.run("INSERT INTO incidents (id, reporter_id, target_id, booking_id, category, details, created_at) VALUES (?,?,?,?,'ANNULATION',?,?)", iid, u.id, u.id, b.id, `Mission ${b.ref} refusÃ©e par le chauffeur : ${reason}`, now); await setRef(q, 'incidents', iid);
      await audit(q, u.id, 'booking.declined', 'booking', b.id, { reason });
      return ok(r);
    }
    if (method === 'POST' && r3 === 'review') {
      if (b.status !== 'COMPLETED') fail(409, 'STATE', 'Vous pourrez noter une fois la mission terminÃ©e.');
      const rating = int(body.rating); if (!(rating >= 1 && rating <= 5)) fail(400, 'RATING_INVALID', 'Note de 1 Ã  5.');
      if (await q.first('SELECT id FROM reviews WHERE booking_id = ? AND author_id = ?', b.id, u.id)) fail(409, 'ALREADY_REVIEWED', 'Vous avez dÃ©jÃ  laissÃ© un avis.');
      await q.run('INSERT INTO reviews (id, booking_id, author_id, target_id, rating, comment, created_at) VALUES (?,?,?,?,?,?,?)', uid(), b.id, u.id, b.customer_id, rating, str(body.comment, 500), now);
      return ok({ ok: true }, 201);
    }
  }
  return null;
}
async function earnings(q, driverId) {
  const now = nowIso();
  const one = async (sql, ...p) => (await q.first(sql, ...p))?.n || 0;
  const totals = {
    upcoming: await one("SELECT COALESCE(SUM(driver_pay),0) n FROM bookings WHERE driver_id = ? AND status IN ('PAID','IN_PROGRESS')", driverId),
    pending: await one("SELECT COALESCE(SUM(driver_pay),0) n FROM bookings WHERE driver_id = ? AND payout_status = 'DUE' AND payout_due_at > ?", driverId, now),
    available: await one("SELECT COALESCE(SUM(driver_pay),0) n FROM bookings WHERE driver_id = ? AND payout_status = 'DUE' AND payout_due_at <= ?", driverId, now),
    held: await one("SELECT COALESCE(SUM(driver_pay),0) n FROM bookings WHERE driver_id = ? AND payout_status = 'HELD'", driverId),
    paid: await one('SELECT COALESCE(SUM(amount),0) n FROM payouts WHERE driver_id = ?', driverId),
  };
  const payouts = await q.all('SELECT ref, amount, bookings_count, provider, reference, created_at FROM payouts WHERE driver_id = ? ORDER BY created_at DESC LIMIT 30', driverId);
  const missions = await q.all("SELECT b.id, b.ref, b.kind, b.from_city, b.to_city, b.driver_pay, b.payout_status, b.payout_due_at, b.status, t.departure_at FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.driver_id = ? AND b.status NOT IN ('EXPIRED','CANCELLED') ORDER BY t.departure_at DESC LIMIT 50", driverId);
  return { totals, payouts, missions };
}

// ============================ Espace Ã©quipe (admin) ============================
async function adminRoutes({ q, env, me, method, is, r1, r2, r3, seg, query, body }) {
  const a = need(me, 'admin', 'superadmin');
  const isSuper = a.role === 'superadmin';
  const now = nowIso();
  const one = async (sql, ...p) => (await q.first(sql, ...p))?.n || 0;

  if (is('GET', 'admin', 'stats')) {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const r = await q.first("SELECT COUNT(*) n, COALESCE(SUM(price),0) rev, COALESCE(SUM(price - driver_pay),0) margin FROM bookings b WHERE substr(created_at, 1, 10) = ? AND status IN ('PAID','IN_PROGRESS','COMPLETED','DISPUTED')", d);
      days.push({ date: d, bookings: r.n, revenue: r.rev, margin: r.margin });
    }
    return ok({
      revenue: await one("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status IN ('CAPTURED','PARTIALLY_REFUNDED')") - await one("SELECT COALESCE(SUM(refund_amount),0) n FROM bookings"),
      margin: await one("SELECT COALESCE(SUM(price - driver_pay),0) n FROM bookings WHERE status IN ('PAID','IN_PROGRESS','COMPLETED','DISPUTED')"),
      owedDrivers: await one("SELECT COALESCE(SUM(driver_pay),0) n FROM bookings WHERE payout_status IN ('DUE','HELD')"),
      availableToPay: await one("SELECT COALESCE(SUM(driver_pay),0) n FROM bookings WHERE payout_status = 'DUE' AND payout_due_at <= ?", now),
      paidDrivers: await one('SELECT COALESCE(SUM(amount),0) n FROM payouts'),
      clients: await one("SELECT COUNT(*) n FROM users WHERE role = 'client'"), drivers: await one("SELECT COUNT(*) n FROM users u JOIN driver_profiles d ON d.user_id = u.id WHERE d.status = 'APPROVED'"),
      applications: await one("SELECT COUNT(*) n FROM driver_profiles WHERE status = 'PENDING'"),
      suspended: await one("SELECT COUNT(*) n FROM users WHERE status IN ('suspended','blocked')"),
      tripsOpen: await one("SELECT COUNT(*) n FROM trips WHERE status IN ('PUBLISHED','FULL') AND departure_at > ?", now),
      tripsLive: await one("SELECT COUNT(*) n FROM trips WHERE status = 'IN_PROGRESS'"),
      incidentsOpen: await one("SELECT COUNT(*) n FROM incidents WHERE status = 'OPEN'"), disputesOpen: await one("SELECT COUNT(*) n FROM disputes WHERE status = 'OPEN'"),
      ticketsOpen: await one("SELECT COUNT(*) n FROM tickets WHERE status = 'OPEN'"),
      claimsPending: await one("SELECT COUNT(*) n FROM payment_claims WHERE status = 'PENDING'"),
      nps: await (async () => { const f = await q.first('SELECT COUNT(*) n, SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END) pro, SUM(CASE WHEN score <= 6 THEN 1 ELSE 0 END) det FROM feedback'); return f.n ? { score: Math.round(((f.pro - f.det) / f.n) * 100), count: f.n } : { score: null, count: 0 }; })(),
      matchRate: await (async () => { const t = await one('SELECT COUNT(*) n FROM packages'); const m = await one("SELECT COUNT(*) n FROM packages WHERE status NOT IN ('CREATED','CANCELLED')"); return t ? Math.round((m / t) * 100) : 0; })(),
      days,
      providers: await q.all("SELECT provider, COUNT(*) n, SUM(amount) amount FROM payments WHERE status != 'REFUNDED' GROUP BY provider ORDER BY amount DESC"),
      corridors: await q.all("SELECT b.from_city || ' â†’ ' || b.to_city corridor, COUNT(*) bookings, SUM(b.price) revenue, SUM(b.price - b.driver_pay) margin FROM bookings b WHERE b.status IN ('PAID','IN_PROGRESS','COMPLETED') GROUP BY corridor ORDER BY revenue DESC LIMIT 8"),
    });
  }
  if (is('GET', 'admin', 'live')) {
    const live = await q.all("SELECT t.*, u.name driver_name, v.label vehicle_label FROM trips t JOIN users u ON u.id = t.driver_id JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status = 'IN_PROGRESS'");
    const soon = await q.all("SELECT t.*, u.name driver_name FROM trips t JOIN users u ON u.id = t.driver_id WHERE t.status IN ('PUBLISHED','FULL') AND t.departure_at BETWEEN ? AND ? ORDER BY t.departure_at", now, addHours(24));
    const out = [];
    for (const t of live) {
      const bs = await q.first("SELECT COUNT(*) n, SUM(CASE WHEN kind = 'PARCEL' THEN 1 ELSE 0 END) p FROM bookings WHERE trip_id = ? AND status IN ('PAID','IN_PROGRESS')", t.id);
      out.push({ ...tripView(t), driverName: t.driver_name, live: await livePosition(q, t), passengers: bs.n - (bs.p || 0), parcels: bs.p || 0 });
    }
    return ok({ live: out, soon: soon.map((t) => ({ ...tripView(t), driverName: t.driver_name })) });
  }

  // --- Membres ---
  if (is('GET', 'admin', 'users')) {
    const role = ['client', 'driver', 'admin'].includes(query.role) ? query.role : null;
    const st = ['active', 'suspended', 'blocked'].includes(query.status) ? query.status : null;
    const like = '%' + str(query.q, 40) + '%';
    const rows = await q.all(`SELECT u.id, u.ref, u.phone, u.name, u.role, u.city, u.status, u.suspended_until, u.warnings, u.created_at, u.last_login_at, d.status driver_status,
      (SELECT COUNT(*) FROM incidents i WHERE i.target_id = u.id AND i.status = 'OPEN') open_incidents,
      (SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.target_id = u.id AND r.hidden = 0) rating,
      (SELECT COUNT(*) FROM bookings b WHERE (b.customer_id = u.id OR b.driver_id = u.id) AND b.status = 'COMPLETED') done
      FROM users u LEFT JOIN driver_profiles d ON d.user_id = u.id
      WHERE (? IS NULL OR u.role = ? OR (? = 'admin' AND u.role = 'superadmin')) AND (? IS NULL OR u.status = ?) AND (? = '%%' OR u.phone LIKE ? OR u.name LIKE ? OR u.ref LIKE ?)
      ORDER BY open_incidents DESC, u.created_at DESC LIMIT 300`, role, role, role, st, st, like, like, like, like);
    return ok({ results: rows });
  }
  if (is('GET', 'admin', 'users', '*')) {
    const u = await q.first('SELECT * FROM users WHERE id = ?', r2); if (!u) fail(404, 'NOT_FOUND', 'Membre introuvable.');
    const bookings = await q.all(`SELECT b.id, b.ref, b.kind, b.status, b.price, b.driver_pay, b.from_city, b.to_city, b.created_at, t.departure_at FROM bookings b JOIN trips t ON t.id = b.trip_id WHERE b.customer_id = ? OR b.driver_id = ? ORDER BY b.created_at DESC LIMIT 30`, u.id, u.id);
    return ok({
      user: { id: u.id, ref: u.ref, email: u.email, phone: u.phone, name: u.name, bio: u.bio, city: u.city, role: u.role, status: u.status, suspendedUntil: u.suspended_until, statusReason: u.status_reason, warnings: u.warnings, createdAt: u.created_at, lastLoginAt: u.last_login_at },
      stats: await userStats(q, u.id),
      driver: await q.first('SELECT * FROM driver_profiles WHERE user_id = ?', u.id),
      vehicles: await q.all('SELECT * FROM vehicles WHERE owner_id = ?', u.id),
      trips: u.role === 'driver' ? await q.all('SELECT id, ref, origin, dest, departure_at, status FROM trips WHERE driver_id = ? ORDER BY departure_at DESC LIMIT 20', u.id) : [],
      bookings,
      incidentsAbout: await q.all('SELECT i.*, r.name reporter_name FROM incidents i JOIN users r ON r.id = i.reporter_id WHERE i.target_id = ? ORDER BY i.created_at DESC', u.id),
      incidentsBy: await q.all('SELECT i.*, t.name target_name FROM incidents i JOIN users t ON t.id = i.target_id WHERE i.reporter_id = ? AND i.target_id != i.reporter_id ORDER BY i.created_at DESC', u.id),
      sanctions: await q.all('SELECT s.*, b.name by_name FROM sanctions s JOIN users b ON b.id = s.by_id WHERE s.user_id = ? ORDER BY s.created_at DESC', u.id),
      notes: await q.all('SELECT n.*, a.name author_name FROM admin_notes n JOIN users a ON a.id = n.author_id WHERE n.user_id = ? ORDER BY n.created_at DESC', u.id),
      reviews: await q.all('SELECT r.id, r.rating, r.comment, r.hidden, r.created_at, a.name author FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.target_id = ? ORDER BY r.created_at DESC LIMIT 30', u.id),
    });
  }
  if (method === 'POST' && r1 === 'users' && r2 && r3 === 'delete') {
    if (!isSuper) fail(403, 'SUPER_ONLY', 'La suppression d\'un compte est rÃ©servÃ©e au propriÃ©taire.');
    const target = await q.first('SELECT * FROM users WHERE id = ?', r2); if (!target) fail(404, 'NOT_FOUND', 'Membre introuvable.');
    if (!['client', 'driver'].includes(target.role)) fail(403, 'FORBIDDEN', 'Pour un membre de l\'Ã©quipe, utilisez Â« Retirer l\'accÃ¨s Â».');
    if (String(target.phone).startsWith('supprime:')) fail(409, 'ALREADY', 'Ce compte est dÃ©jÃ  supprimÃ©.');
    if (target.status === 'blocked' && !body.force) fail(409, 'BLOCKED', 'Ce compte est bloquÃ© : le supprimer libÃ©rerait son numÃ©ro et lui permettrait de revenir. Laissez-le bloquÃ©.');
    const reason = str(body.reason, 300); if (!reason) fail(400, 'REASON_REQUIRED', 'Un motif est obligatoire.');
    const bl = await accountBlockers(q, target); if (bl.length) fail(409, 'ACCOUNT_BUSY', 'Suppression impossible pour le moment : ' + bl.join(' ; ') + '.');
    await deleteAccount(q, env, target, a.id, reason);
    return ok({ deleted: true });
  }
  if (method === 'POST' && r1 === 'users' && r2 && ['warn', 'suspend', 'block', 'reactivate', 'note'].includes(r3)) {
    const target = await q.first('SELECT * FROM users WHERE id = ?', r2); if (!target) fail(404, 'NOT_FOUND', 'Membre introuvable.');
    if (target.id === a.id) fail(400, 'SELF', 'Action impossible sur votre propre compte.');
    if (target.role === 'superadmin') fail(403, 'FORBIDDEN', 'Le propriÃ©taire ne peut pas Ãªtre sanctionnÃ©.');
    if (target.role === 'admin' && !isSuper) fail(403, 'FORBIDDEN', 'Seul le propriÃ©taire peut agir sur un membre de l\'Ã©quipe.');
    const reason = str(body.reason || body.body, 500); if (!reason) fail(400, 'REASON_REQUIRED', 'Un motif est obligatoire.');
    if (r3 === 'note') { await q.run('INSERT INTO admin_notes (id, user_id, author_id, body, created_at) VALUES (?,?,?,?,?)', uid(), target.id, a.id, reason, now); return ok({ ok: true }); }
    if (r3 === 'block' && !isSuper) fail(403, 'SUPER_ONLY', 'Le blocage dÃ©finitif est rÃ©servÃ© au propriÃ©taire.');
    if (r3 === 'suspend' && !isSuper && int(body.days) > 30) fail(403, 'SUPER_ONLY', 'Au-delÃ  de 30 jours, la suspension est rÃ©servÃ©e au propriÃ©taire.');
    if (r3 === 'reactivate' && target.status === 'active') fail(409, 'STATE', 'Ce compte est dÃ©jÃ  actif.');
    await applySanction(q, env, target, { warn: 'WARNING', suspend: 'SUSPENSION', block: 'BLOCK', reactivate: 'REACTIVATION' }[r3], reason, a, int(body.days) || 7);
    return ok({ ok: true });
  }
  if (is('POST', 'admin', 'drivers', '*', 'review')) {
    const dp = await q.first('SELECT * FROM driver_profiles WHERE user_id = ?', r2); if (!dp) fail(404, 'NOT_FOUND', 'Dossier introuvable.');
    const decision = body.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', note = str(body.note, 300);
    if (decision === 'REJECTED' && !note) fail(400, 'REASON_REQUIRED', 'Expliquez au chauffeur ce qu\'il doit corriger.');
    await q.run('UPDATE driver_profiles SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE user_id = ?', decision, a.id, now, note, r2);
    await notify(q, r2, decision === 'APPROVED' ? 'Dossier validÃ© : bienvenue !' : 'Dossier Ã  complÃ©ter', decision === 'APPROVED' ? 'Vous pouvez publier vos trajets.' : note, '#/', decision === 'APPROVED' ? 'success' : 'warning');
    await audit(q, a.id, 'driver.' + decision.toLowerCase(), 'user', r2, { note });
    return ok({ ok: true });
  }
  if (is('POST', 'admin', 'reviews', '*', 'hide')) {
    await q.run('UPDATE reviews SET hidden = 1 WHERE id = ?', r2); await audit(q, a.id, 'review.hidden', 'review', r2, { reason: str(body.reason, 200) }); return ok({ ok: true });
  }

  // --- Trajets et rÃ©servations ---
  if (is('GET', 'admin', 'trips')) {
    const st = str(query.status, 20);
    const rows = await q.all(`SELECT t.id, t.ref, t.origin, t.dest, t.departure_at, t.status, t.seats_total, t.seats_left, t.parcel_kg_total, t.parcel_kg_left, u.name driver_name, u.id driver_id,
      (SELECT COUNT(*) FROM bookings b WHERE b.trip_id = t.id AND b.status IN ('PAID','IN_PROGRESS','COMPLETED')) bookings FROM trips t JOIN users u ON u.id = t.driver_id
      WHERE (? = '' OR t.status = ?) AND (? = '' OR t.ref = ?) ORDER BY t.departure_at DESC LIMIT 200`, st, st, str(query.q, 30).toUpperCase(), str(query.q, 30).toUpperCase());
    return ok({ results: rows });
  }
  if (is('POST', 'admin', 'trips', '*', 'cancel')) {
    const t = await q.first('SELECT * FROM trips WHERE id = ?', r2); if (!t) fail(404, 'NOT_FOUND', 'Trajet introuvable.');
    if (!['PUBLISHED', 'FULL', 'SUSPENDED'].includes(t.status)) fail(409, 'STATE', 'Trajet dÃ©jÃ  dÃ©marrÃ© ou terminÃ©.');
    const reason = str(body.reason, 300); if (!reason) fail(400, 'REASON_REQUIRED', 'Un motif est obligatoire.');
    await q.run("UPDATE trips SET status = 'CANCELLED' WHERE id = ?", t.id);
    const bs = await q.all("SELECT * FROM bookings WHERE trip_id = ? AND status IN ('PENDING_PAYMENT','PAID')", t.id);
    for (const b of bs) await cancelBooking(q, env, b, 'admin', reason, a.id);
    await notify(q, t.driver_id, 'Trajet annulÃ© par Bokk Yoon', `${t.origin} â†’ ${t.dest} : ${reason}`, '', 'warning');
    await audit(q, a.id, 'admin.trip_cancelled', 'trip', t.id, { reason });
    return ok({ ok: true, affected: bs.length });
  }
  if (is('GET', 'admin', 'bookings')) {
    const st = str(query.status, 20);
    const rows = await q.all(`SELECT b.id, b.ref, b.discount, b.promo_code, b.kind, b.status, b.price, b.driver_pay, b.refund_amount, b.payout_status, b.match_score, b.from_city, b.to_city, b.created_at, t.departure_at,
      c.name customer_name, c.id customer_id, d.name driver_name, d.id driver_id, (SELECT provider FROM payments p WHERE p.booking_id = b.id) provider FROM bookings b
      JOIN trips t ON t.id = b.trip_id JOIN users c ON c.id = b.customer_id JOIN users d ON d.id = b.driver_id WHERE (? = '' OR b.status = ?) AND (? = '' OR b.ref = ? OR c.ref = ? OR d.ref = ?) ORDER BY b.created_at DESC LIMIT 300`, st, st, ...Array(4).fill(str(query.q, 30).toUpperCase()));
    return ok({ results: rows });
  }
  if (is('POST', 'admin', 'bookings', '*', 'cancel')) {
    const b = await q.first('SELECT * FROM bookings WHERE id = ?', r2); if (!b) fail(404, 'NOT_FOUND', 'RÃ©servation introuvable.');
    if (!['PENDING_PAYMENT', 'PAID'].includes(b.status)) fail(409, 'STATE', 'RÃ©servation dÃ©jÃ  en cours ou terminÃ©e.');
    const reason = str(body.reason, 300); if (!reason) fail(400, 'REASON_REQUIRED', 'Un motif est obligatoire.');
    return ok(await cancelBooking(q, env, b, 'admin', reason, a.id));
  }

  // --- Litiges et signalements ---
  if (is('GET', 'admin', 'disputes')) {
    return ok({ results: await q.all(`SELECT d.*, b.ref booking_ref, b.price, b.driver_pay, b.kind, b.from_city, b.to_city, b.status booking_status, o.name opened_by_name, dr.name driver_name, dr.id driver_id,
      (SELECT COUNT(*) FROM messages m WHERE m.booking_id = b.id) messages FROM disputes d JOIN bookings b ON b.id = d.booking_id JOIN users o ON o.id = d.opened_by JOIN users dr ON dr.id = b.driver_id
      ORDER BY CASE d.status WHEN 'OPEN' THEN 0 ELSE 1 END, d.created_at DESC LIMIT 200`) });
  }
  if (is('POST', 'admin', 'disputes', '*', 'resolve')) {
    const d = await q.first("SELECT * FROM disputes WHERE id = ? AND status = 'OPEN'", r2); if (!d) fail(404, 'NOT_FOUND', 'RÃ©clamation introuvable ou dÃ©jÃ  close.');
    const b = await q.first('SELECT * FROM bookings WHERE id = ?', d.booking_id);
    const decision = body.decision === 'REFUND' ? 'REFUND' : 'REJECT', reason = str(body.reason, 300);
    if (!reason) fail(400, 'REASON_REQUIRED', 'Un motif est obligatoire.');
    let amount = 0;
    if (decision === 'REFUND') {
      amount = Math.max(0, Math.min(b.price, int(body.amount) || b.price));
      if (amount > 50000 && !isSuper) fail(403, 'SUPER_ONLY', 'Au-delÃ  de 50 000 FCFA, le remboursement est validÃ© par le propriÃ©taire.');
      await refundBooking(q, b, amount, reason, a.id);
      const keepDriver = body.payDriver ? b.driver_pay : 0;
      await q.run("UPDATE bookings SET status = 'REFUNDED', payout_status = ?, driver_pay = ?, updated_at = ? WHERE id = ?", keepDriver ? 'DUE' : 'CANCELLED', keepDriver, now, b.id);
    } else {
      const back = b.delivered_at || (b.kind === 'SEAT' && b.pickup_at) ? 'COMPLETED' : b.pickup_at ? 'IN_PROGRESS' : 'PAID';
      await q.run("UPDATE bookings SET status = ?, payout_status = CASE WHEN payout_status = 'HELD' THEN 'DUE' ELSE payout_status END, updated_at = ? WHERE id = ?", back, now, b.id);
      if (b.package_id) await q.run('UPDATE packages SET status = ? WHERE id = ?', back === 'COMPLETED' ? 'DELIVERED' : back === 'IN_PROGRESS' ? 'PICKED_UP' : 'PAID', b.package_id);
    }
    await q.run("UPDATE disputes SET status = 'CLOSED', decision = ?, refund_amount = ?, handled_by = ?, closed_at = ? WHERE id = ?", decision + ' : ' + reason, amount, a.id, now, d.id);
    await notify(q, b.customer_id, 'RÃ©clamation traitÃ©e', decision === 'REFUND' ? `Remboursement de ${amount.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA.` : reason, `#/reservation/${b.id}`, 'info');
    await audit(q, a.id, 'dispute.' + decision.toLowerCase(), 'dispute', d.id, { amount, reason });
    return ok({ ok: true });
  }
  if (is('GET', 'admin', 'incidents')) {
    return ok({ results: await q.all(`SELECT i.*, (SELECT ref FROM bookings WHERE id = i.booking_id) booking_ref, r.name reporter_name, r.role reporter_role, t.name target_name, t.role target_role, t.status target_status, t.warnings target_warnings,
      (SELECT COUNT(*) FROM incidents x WHERE x.target_id = i.target_id) target_total FROM incidents i JOIN users r ON r.id = i.reporter_id JOIN users t ON t.id = i.target_id
      ORDER BY CASE i.status WHEN 'OPEN' THEN 0 ELSE 1 END, i.created_at DESC LIMIT 200`) });
  }
  if (is('POST', 'admin', 'incidents', '*', 'close')) {
    const i = await q.first("SELECT * FROM incidents WHERE id = ? AND status = 'OPEN'", r2); if (!i) fail(404, 'NOT_FOUND', 'Signalement introuvable ou dÃ©jÃ  clos.');
    const action = ['NONE', 'WARN', 'SUSPEND', 'BLOCK'].includes(body.action) ? body.action : 'NONE', reason = str(body.reason, 300);
    if (!reason) fail(400, 'REASON_REQUIRED', 'Un motif est obligatoire.');
    const target = await q.first('SELECT * FROM users WHERE id = ?', i.target_id);
    if (action !== 'NONE') {
      if (target.role === 'superadmin' || (target.role === 'admin' && !isSuper)) fail(403, 'FORBIDDEN', 'Action non autorisÃ©e sur ce compte.');
      if (action === 'BLOCK' && !isSuper) fail(403, 'SUPER_ONLY', 'Le blocage dÃ©finitif est rÃ©servÃ© au propriÃ©taire.');
      await applySanction(q, env, target, { WARN: 'WARNING', SUSPEND: 'SUSPENSION', BLOCK: 'BLOCK' }[action], reason, a, int(body.days) || 7);
    }
    await q.run("UPDATE incidents SET status = 'CLOSED', action_taken = ?, handled_by = ?, closed_at = ? WHERE id = ?", action + ' : ' + reason, a.id, now, i.id);
    return ok({ ok: true });
  }

  // --- Reversements aux chauffeurs (propriÃ©taire) ---
  if (is('GET', 'admin', 'payouts')) {
    const owed = await q.all(`SELECT u.id driver_id, u.ref, u.name, u.phone, d.payout_provider, d.payout_phone,
      SUM(CASE WHEN b.payout_status = 'DUE' AND b.payout_due_at <= ? THEN b.driver_pay ELSE 0 END) available,
      SUM(CASE WHEN b.payout_status = 'DUE' AND b.payout_due_at > ? THEN b.driver_pay ELSE 0 END) pending,
      SUM(CASE WHEN b.payout_status = 'HELD' THEN b.driver_pay ELSE 0 END) held,
      SUM(CASE WHEN b.payout_status = 'DUE' AND b.payout_due_at <= ? THEN 1 ELSE 0 END) count
      FROM bookings b JOIN users u ON u.id = b.driver_id JOIN driver_profiles d ON d.user_id = u.id WHERE b.payout_status IN ('DUE','HELD') GROUP BY u.id ORDER BY available DESC`, now, now, now);
    const history = await q.all('SELECT p.*, u.name driver_name, u.ref driver_ref, a.name paid_by_name FROM payouts p JOIN users u ON u.id = p.driver_id JOIN users a ON a.id = p.paid_by ORDER BY p.created_at DESC LIMIT 100');
    return ok({ owed, history });
  }
  if (is('POST', 'admin', 'payouts')) {
    needSuper(a);
    const driverId = str(body.driverId, 64), reference = str(body.reference, 80);
    if (!reference) fail(400, 'REFERENCE_REQUIRED', 'Indiquez la rÃ©fÃ©rence de la transaction Wave / Orange Money.');
    const dp = await q.first('SELECT payout_provider FROM driver_profiles WHERE user_id = ?', driverId); if (!dp) fail(404, 'NOT_FOUND', 'Chauffeur introuvable.');
    const due = await q.first("SELECT COALESCE(SUM(driver_pay),0) a, COUNT(*) n FROM bookings WHERE driver_id = ? AND payout_status = 'DUE' AND payout_due_at <= ?", driverId, now);
    if (!due.a) fail(409, 'NOTHING_DUE', 'Aucun montant disponible pour ce chauffeur.');
    const pid = uid();
    await q.run('INSERT INTO payouts (id, driver_id, amount, bookings_count, provider, reference, note, paid_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)', pid, driverId, due.a, due.n, str(body.provider, 20) || dp.payout_provider, reference, str(body.note, 200), a.id, now);
    const vref = await setRef(q, 'payouts', pid);
    await q.run("UPDATE bookings SET payout_status = 'PAID', payout_id = ?, updated_at = ? WHERE driver_id = ? AND payout_status = 'DUE' AND payout_due_at <= ?", pid, now, driverId, now);
    await notify(q, driverId, 'Paiement reÃ§u', `${due.a.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA versÃ©s pour ${due.n} mission(s). ${vref} Â· rÃ©f. ${reference}.`, '#/gains', 'success');
    await audit(q, a.id, 'payout.paid', 'user', driverId, { amount: due.a, reference });
    return ok({ amount: due.a, count: due.n });
  }

  // --- Tarifs et rÃ©glages (propriÃ©taire) ---
  if (is('GET', 'admin', 'settings')) return ok({ settings: await getSettings(q), tariffs: await getTariffs(q) });
  if (is('PUT', 'admin', 'settings')) {
    needSuper(a);
    const p = body.pricing || {}, bk = body.booking || {};
    const pricing = {
      seatPerKm: int(p.seatPerKm), seatMin: int(p.seatMin), parcelPerKm: int(p.parcelPerKm), parcelMin: int(p.parcelMin),
      parcelExtraKgPct: int(p.parcelExtraKgPct), driverSharePct: int(p.driverSharePct), rounding: [50, 100, 250, 500].includes(int(p.rounding)) ? int(p.rounding) : 250,
    };
    if (Object.values(pricing).some((v) => !(v >= 0))) fail(400, 'SETTINGS_INVALID', 'Valeurs de tarif invalides.');
    if (pricing.driverSharePct > 100 || pricing.driverSharePct < 30) fail(400, 'SHARE_INVALID', 'La part chauffeur doit Ãªtre comprise entre 30 et 100 %.');
    const booking = { paymentWindowMin: Math.max(5, Math.min(120, int(bk.paymentWindowMin) || 30)), payoutDelayHours: Math.max(0, Math.min(168, int(bk.payoutDelayHours) ?? 24)), clientCancelFullRefundHours: Math.max(0, Math.min(72, int(bk.clientCancelFullRefundHours) ?? 24)), driverAutoApprove: !!bk.driverAutoApprove };
    for (const [k, v] of [['pricing', pricing], ['booking', booking]]) {
      await q.run('DELETE FROM settings WHERE key = ?', k);
      await q.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', k, JSON.stringify(v), a.id, now);
    }
    await audit(q, a.id, 'settings.updated', 'system', 'settings', { pricing, booking });
    return ok({ ok: true });
  }
  if (is('GET', 'admin', 'quote')) {
    const A = cityByName(query.from), B = cityByName(query.to); if (!A || !B || A === B) fail(400, 'CITY_INVALID', 'Villes invalides.');
    return ok(await quoteFor(q, A, B));
  }
  if (is('POST', 'admin', 'tariffs')) {
    needSuper(a);
    const A = cityByName(body.origin), B = cityByName(body.dest); if (!A || !B || A === B) fail(400, 'CITY_INVALID', 'Villes invalides.');
    const v = { cs: int(body.clientSeat), ds: int(body.driverSeat), cp: int(body.clientParcel), dp: int(body.driverParcel) };
    if (Object.values(v).some((x) => !(x >= 0))) fail(400, 'TARIFF_INVALID', 'Montants invalides.');
    if (v.ds > v.cs || v.dp > v.cp) fail(400, 'NEGATIVE_MARGIN', 'La part chauffeur ne peut pas dÃ©passer le prix client.');
    await q.run('DELETE FROM tariffs WHERE (origin = ? AND dest = ?) OR (origin = ? AND dest = ?)', A.name, B.name, B.name, A.name);
    await q.run('INSERT INTO tariffs (id, origin, dest, client_seat, driver_seat, client_parcel, driver_parcel, active, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)', uid(), A.name, B.name, v.cs, v.ds, v.cp, v.dp, a.id, now);
    await audit(q, a.id, 'tariff.saved', 'tariff', `${A.name}-${B.name}`, v);
    return ok({ ok: true }, 201);
  }
  if (is('POST', 'admin', 'tariffs', '*', 'delete')) {
    needSuper(a); await q.run('DELETE FROM tariffs WHERE id = ?', r2); await audit(q, a.id, 'tariff.deleted', 'tariff', r2); return ok({ ok: true });
  }

  // --- ActualitÃ©s, alertes route, messages groupÃ©s ---
  if (is('GET', 'admin', 'news')) return ok({ results: await q.all('SELECT * FROM news ORDER BY created_at DESC LIMIT 100') });
  if (is('POST', 'admin', 'news')) {
    const title = str(body.title, 140), summary = str(body.summary, 300), text = str(body.body, 8000);
    if (!title || !summary || !text) fail(400, 'NEWS_INVALID', 'Titre, rÃ©sumÃ© et texte sont obligatoires.');
    const cat = ['ANNONCE', 'SECURITE', 'CONSEIL', 'ROUTE', 'PROMO'].includes(body.category) ? body.category : 'ANNONCE';
    const aud = ['ALL', 'CLIENTS', 'DRIVERS'].includes(body.audience) ? body.audience : 'ALL';
    const publish = !!body.publish;
    let id = str(body.id, 64);
    if (id && await q.first('SELECT id FROM news WHERE id = ?', id)) {
      await q.run('UPDATE news SET title = ?, summary = ?, body = ?, category = ?, audience = ?, status = CASE WHEN ? THEN \'PUBLISHED\' ELSE status END, published_at = CASE WHEN ? AND published_at IS NULL THEN ? ELSE published_at END, updated_at = ? WHERE id = ?', title, summary, text, cat, aud, publish ? 1 : 0, publish ? 1 : 0, now, now, id);
    } else {
      id = uid(); let slug = slugify(title);
      if (await q.first('SELECT id FROM news WHERE slug = ?', slug)) slug += '-' + randomHex(2);
      await q.run('INSERT INTO news (id, slug, title, summary, body, category, audience, status, published_at, author_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, slug, title, summary, text, cat, aud, publish ? 'PUBLISHED' : 'DRAFT', publish ? now : null, a.id, now, now);
    }
    if (publish && body.notify) {
      const users = await q.all(`SELECT id FROM users WHERE status = 'active' AND role IN (${aud === 'ALL' ? "'client','driver'" : aud === 'CLIENTS' ? "'client'" : "'driver'"})`);
      const n = await q.first('SELECT slug FROM news WHERE id = ?', id);
      for (const x of users) await notify(q, x.id, title, summary, `#/actualites/${n.slug}`, 'news');
    }
    await audit(q, a.id, publish ? 'news.published' : 'news.saved', 'news', id);
    return ok({ id }, 201);
  }
  if (method === 'POST' && r1 === 'news' && r2 && ['unpublish', 'delete'].includes(r3)) {
    if (r3 === 'delete') await q.run('DELETE FROM news WHERE id = ?', r2); else await q.run("UPDATE news SET status = 'DRAFT' WHERE id = ?", r2);
    await audit(q, a.id, 'news.' + r3, 'news', r2); return ok({ ok: true });
  }
  if (is('GET', 'admin', 'alerts')) return ok({ results: await q.all('SELECT * FROM route_alerts ORDER BY ends_at DESC LIMIT 100') });
  if (is('POST', 'admin', 'alerts')) {
    const area = cityByName(body.area)?.name || (REGIONS.includes(body.area) ? body.area : body.area === 'National' ? 'National' : null);
    if (!area) fail(400, 'AREA_INVALID', 'Choisissez une ville, une rÃ©gion ou Â« National Â».');
    const level = ['INFO', 'ATTENTION', 'DANGER'].includes(body.level) ? body.level : 'INFO', msg = str(body.message, 300);
    if (!msg) fail(400, 'MESSAGE_REQUIRED', 'Message obligatoire.');
    const hours = Math.max(1, Math.min(24 * 60, int(body.hours) || 24));
    await q.run('INSERT INTO route_alerts (id, area, level, message, starts_at, ends_at, author_id, created_at) VALUES (?,?,?,?,?,?,?,?)', uid(), area, level, msg, now, addHours(hours), a.id, now);
    await audit(q, a.id, 'alert.created', 'alert', area, { level, msg });
    return ok({ ok: true }, 201);
  }
  if (is('POST', 'admin', 'alerts', '*', 'end')) { await q.run('UPDATE route_alerts SET ends_at = ? WHERE id = ?', now, r2); return ok({ ok: true }); }
  if (is('POST', 'admin', 'broadcast')) {
    const title = str(body.title, 120), text = str(body.body, 500); if (!title) fail(400, 'TITLE_REQUIRED', 'Titre obligatoire.');
    const roles = body.audience === 'CLIENTS' ? ["'client'"] : body.audience === 'DRIVERS' ? ["'driver'"] : ["'client'", "'driver'"];
    const users = await q.all(`SELECT id FROM users WHERE status = 'active' AND role IN (${roles.join(',')})`);
    for (const x of users) await notify(q, x.id, title, text, '', 'info');
    await audit(q, a.id, 'broadcast.sent', 'system', 'broadcast', { audience: body.audience, count: users.length });
    return ok({ sent: users.length });
  }

  // --- Ã‰quipe (propriÃ©taire) ---
  if (is('GET', 'admin', 'team')) return ok({ results: await q.all("SELECT id, phone, name, role, status, created_at, last_login_at FROM users WHERE role IN ('admin','superadmin') ORDER BY role DESC, created_at") });
  if (is('POST', 'admin', 'team')) {
    needSuper(a);
    const phone = normalizePhone(body.phone), name = str(body.name, 60);
    if (!name) fail(400, 'NAME_REQUIRED', 'Nom obligatoire.');
    if (await q.first('SELECT id FROM users WHERE phone = ?', phone)) fail(409, 'PHONE_USED', 'Ce numÃ©ro a dÃ©jÃ  un compte. Utilisez un numÃ©ro dÃ©diÃ© Ã  l\'Ã©quipe.');
    const id = uid();
    await q.run("INSERT INTO users (id, phone, name, role, created_at) VALUES (?,?,?,'admin',?)", id, phone, name, now);
    await setRef(q, 'users', id, 'admin');
    await audit(q, a.id, 'team.added', 'user', id, { phone });
    return ok({ id }, 201);
  }
  if (method === 'POST' && r1 === 'team' && r2 && ['revoke', 'restore'].includes(r3)) {
    needSuper(a);
    const t = await q.first("SELECT * FROM users WHERE id = ? AND role = 'admin'", r2); if (!t) fail(404, 'NOT_FOUND', 'Membre de l\'Ã©quipe introuvable.');
    await q.run('UPDATE users SET status = ? WHERE id = ?', r3 === 'revoke' ? 'blocked' : 'active', t.id);
    if (r3 === 'revoke') await q.run('DELETE FROM sessions WHERE user_id = ?', t.id);
    await audit(q, a.id, 'team.' + r3, 'user', t.id); return ok({ ok: true });
  }
  // --- Recherche globale par rÃ©fÃ©rence, tÃ©lÃ©phone ou nom ---
  if (is('GET', 'admin', 'search')) {
    const t = str(query.q, 40); if (t.length < 2) return ok({ results: [] });
    const like = '%' + t + '%', out = [];
    for (const u of await q.all('SELECT id, ref, name, phone, role, status FROM users WHERE ref LIKE ? OR phone LIKE ? OR name LIKE ? LIMIT 8', like, like, like)) out.push({ kind: { client: 'Client', driver: 'Chauffeur', admin: 'Ã‰quipe', superadmin: 'PropriÃ©taire' }[u.role], ref: u.ref, label: `${u.name} Â· ${u.phone}`, link: `#/membre/${u.id}` });
    for (const b of await q.all('SELECT id, ref, from_city, to_city, status FROM bookings WHERE ref LIKE ? LIMIT 6', like)) out.push({ kind: 'RÃ©servation', ref: b.ref, label: `${b.from_city} â†’ ${b.to_city} Â· ${b.status}`, link: `#/reservations?q=${b.ref}` });
    for (const p of await q.all('SELECT p.id, p.ref, p.origin, p.dest, (SELECT id FROM bookings b WHERE b.package_id = p.id ORDER BY created_at DESC) bid, (SELECT ref FROM bookings b WHERE b.package_id = p.id ORDER BY created_at DESC) bref FROM packages p WHERE p.ref LIKE ? LIMIT 6', like)) out.push({ kind: 'Colis', ref: p.ref, label: `${p.origin} â†’ ${p.dest}${p.bref ? ' Â· ' + p.bref : ''}`, link: p.bref ? `#/reservations?q=${p.bref}` : '#/reservations' });
    for (const x of await q.all('SELECT id, ref, origin, dest FROM trips WHERE ref LIKE ? LIMIT 6', like)) out.push({ kind: 'Trajet', ref: x.ref, label: `${x.origin} â†’ ${x.dest}`, link: `#/trajets?q=${x.ref}` });
    for (const i of await q.all('SELECT id, number, total FROM invoices WHERE number LIKE ? LIMIT 6', like)) out.push({ kind: 'Facture', ref: i.number, label: `${i.total.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA`, link: `../imprimer/?doc=facture&id=${i.id}&s=admin` });
    for (const k of await q.all('SELECT id, ref, subject FROM tickets WHERE ref LIKE ? LIMIT 6', like)) out.push({ kind: 'Message', ref: k.ref, label: k.subject, link: `#/messages/${k.id}` });
    for (const v of await q.all('SELECT p.ref, p.amount, u.name FROM payouts p JOIN users u ON u.id = p.driver_id WHERE p.ref LIKE ? LIMIT 6', like)) out.push({ kind: 'Versement', ref: v.ref, label: `${v.name} Â· ${v.amount.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA`, link: '#/paiements' });
    return ok({ results: out });
  }
  // --- Exports CSV ---
  if (is('GET', 'admin', 'export', '*')) {
    const sets = {
      reservations: () => q.all(`SELECT b.ref reference, b.kind type, b.status statut, b.from_city depart, b.to_city arrivee, t.departure_at date_depart, c.ref client_ref, c.name client, d.ref chauffeur_ref, d.name chauffeur,
        b.list_price prix_catalogue, b.discount remise, b.promo_code code_promo, b.price prix_client, b.driver_pay part_chauffeur, b.price - b.driver_pay - b.refund_amount marge, b.refund_amount rembourse, b.payout_status versement, b.created_at cree_le
        FROM bookings b JOIN trips t ON t.id = b.trip_id JOIN users c ON c.id = b.customer_id JOIN users d ON d.id = b.driver_id ORDER BY b.created_at DESC`),
      factures: () => q.all("SELECT number numero, kind type, status statut, issued_at date, json_extract(customer, '$.name') client, total montant_ttc, vat_rate taux_tva, vat_amount tva FROM invoices ORDER BY issued_at DESC"),
      versements: () => q.all('SELECT p.ref reference, p.created_at date, u.ref chauffeur_ref, u.name chauffeur, p.amount montant, p.bookings_count missions, p.provider moyen, p.reference transaction FROM payouts p JOIN users u ON u.id = p.driver_id ORDER BY p.created_at DESC'),
      chauffeurs: () => q.all(`SELECT u.ref matricule, u.name nom, u.phone telephone, u.city ville, u.status statut, d.status dossier, d.payout_provider moyen_paiement, d.payout_phone numero_paiement, u.warnings avertissements, u.created_at inscrit_le
        FROM users u LEFT JOIN driver_profiles d ON d.user_id = u.id WHERE u.role = 'driver' ORDER BY u.created_at`),
      clients: () => q.all("SELECT ref reference, name nom, phone telephone, email, city ville, status statut, created_at inscrit_le FROM users WHERE role = 'client' ORDER BY created_at"),
      messages: () => q.all('SELECT ref reference, created_at date, name nom, phone telephone, email, category categorie, subject objet, status statut FROM tickets ORDER BY created_at DESC'),
    };
    if (!sets[r2]) fail(404, 'NOT_FOUND', 'Export inconnu.');
    await audit(q, a.id, 'export.' + r2, 'system', 'export');
    return ok({ filename: `bokk-yoon-${r2}-${nowIso().slice(0, 10)}.csv`, csv: toCsv(await sets[r2]()) });
  }
  // --- ActivitÃ© par rÃ©gion ---
  if (is('GET', 'admin', 'regions')) {
    const byCity = await q.all("SELECT from_city city, COUNT(*) n, SUM(price) revenue FROM bookings WHERE status IN ('PAID','IN_PROGRESS','COMPLETED') GROUP BY from_city");
    const trips = await q.all("SELECT origin city, COUNT(*) n FROM trips WHERE status IN ('PUBLISHED','FULL','IN_PROGRESS') GROUP BY origin");
    const drivers = await q.all("SELECT u.city, COUNT(*) n FROM users u JOIN driver_profiles d ON d.user_id = u.id WHERE d.status = 'APPROVED' GROUP BY u.city");
    const agg = Object.fromEntries(REGIONS.map((r) => [r, { region: r, bookings: 0, revenue: 0, trips: 0, drivers: 0 }]));
    const reg = (c) => cityByName(c)?.region;
    for (const x of byCity) if (reg(x.city)) { agg[reg(x.city)].bookings += x.n; agg[reg(x.city)].revenue += x.revenue; }
    for (const x of trips) if (reg(x.city)) agg[reg(x.city)].trips += x.n;
    for (const x of drivers) if (reg(x.city)) agg[reg(x.city)].drivers += x.n;
    return ok({ results: Object.values(agg) });
  }
  // --- IdentitÃ© de l'entreprise et designer de facture (propriÃ©taire) ---
  if (is('PUT', 'admin', 'company')) {
    needSuper(a);
    const c = body || {}, cur = (await getSettings(q)).company;
    const logo = str(c.logo, 300000);
    if (logo && !/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(logo)) fail(400, 'LOGO_INVALID', 'Logo : image PNG, JPEG, WebP ou SVG.');
    if (logo.length > 280000) fail(400, 'LOGO_TOO_BIG', 'Logo trop lourd (200 Ko maximum).');
    const accent = /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : cur.accent;
    const company = {
      name: str(c.name, 80) || cur.name, legalName: str(c.legalName, 120), ninea: str(c.ninea, 40), rccm: str(c.rccm, 60), address: str(c.address, 200),
      phone: str(c.phone, 30), whatsapp: c.whatsapp ? normalizePhone(c.whatsapp) : '', email: str(c.email, 120), website: str(c.website, 120), hours: str(c.hours, 120),
      payInfo: str(c.payInfo, 300), footer: str(c.footer, 400), vatEnabled: !!c.vatEnabled, vatRate: Math.max(0, Math.min(30, Number(c.vatRate) || 0)),
      accent, template: ['moderne', 'classique', 'minimal'].includes(c.template) ? c.template : 'moderne', logo,
    };
    await q.run('DELETE FROM settings WHERE key = ?', 'company');
    await q.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', 'company', JSON.stringify(company), a.id, nowIso());
    await audit(q, a.id, 'company.updated', 'system', 'company', { ...company, logo: logo ? '(image)' : '' });
    return ok({ ok: true });
  }
  // --- Encaissements par QR code (Wave / Orange Money du propriÃ©taire) ---
  if (is('GET', 'admin', 'payment')) { const ps = (await getSettings(q)).payment; return ok({ ...ps, mode: payMode(ps, env) }); }
  if (is('PUT', 'admin', 'payment')) {
    needSuper(a);
    const cur = (await getSettings(q)).payment, b0 = body || {};
    const meth = (m, c) => {
      const qr = str(m?.qr, 700000);
      if (qr && !/^data:image\/(png|jpeg|webp);base64,/.test(qr) && !/^assets\/pay\/[\w.-]+\.(png|jpe?g|webp)$/.test(qr)) fail(400, 'QR_INVALID', 'QR code : image PNG, JPEG ou WebP.');
      const link = str(m?.link, 300); if (link && !/^https:\/\//.test(link)) fail(400, 'LINK_INVALID', 'Le lien de paiement doit commencer par https://');
      return { enabled: !!m?.enabled, qr, link, number: str(m?.number, 30), name: str(m?.name, 80) || c.name || company.name };
    };
    const company = (await getSettings(q)).company;
    const pay = { mode: b0.mode === 'QR' ? 'QR' : 'SIMULATION', wave: meth(b0.wave, cur.wave), orange: meth(b0.orange, cur.orange),
      reviewMinutes: Math.max(5, Math.min(1440, int(b0.reviewMinutes) || 30)), instructions: str(b0.instructions, 400) || cur.instructions };
    if (pay.mode === 'QR' && !((pay.wave.enabled && (pay.wave.qr || pay.wave.link || pay.wave.number)) || (pay.orange.enabled && (pay.orange.qr || pay.orange.link || pay.orange.number)))) fail(400, 'QR_REQUIRED', 'Ajoutez au moins un QR code, un lien ou un numÃ©ro avant d\'activer le paiement par QR.');
    await q.run('DELETE FROM settings WHERE key = ?', 'payment');
    await q.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', 'payment', JSON.stringify(pay), a.id, nowIso());
    await audit(q, a.id, 'payment.settings', 'system', 'payment', { mode: pay.mode, wave: pay.wave.enabled, orange: pay.orange.enabled });
    return ok({ ok: true });
  }
  if (is('GET', 'admin', 'payment-claims')) {
    const st = ['PENDING', 'APPROVED', 'REJECTED', 'REFUND'].includes(query.status) ? query.status : null;
    return ok({ results: await q.all(`SELECT c.*, b.ref booking_ref, b.status booking_status, b.price booking_price, b.from_city, b.to_city, b.kind, u.name customer_name, u.ref customer_ref, u.phone customer_phone, r.name reviewer
      FROM payment_claims c JOIN bookings b ON b.id = c.booking_id JOIN users u ON u.id = c.customer_id LEFT JOIN users r ON r.id = c.reviewed_by
      WHERE (? IS NULL OR c.status = ?) ORDER BY CASE c.status WHEN 'PENDING' THEN 0 WHEN 'REFUND' THEN 1 ELSE 2 END, c.created_at DESC LIMIT 300`, st, st) });
  }
  if (seg[1] === 'payment-claims' && r2 && method === 'POST') {
    const c = await q.first('SELECT * FROM payment_claims WHERE id = ?', r2); if (!c) fail(404, 'NOT_FOUND', 'DÃ©claration introuvable.');
    if (c.status !== 'PENDING' && !(r3 === 'refunded' && c.status === 'REFUND')) fail(409, 'STATE', 'DÃ©jÃ  traitÃ©e.');
    const b = await q.first('SELECT * FROM bookings WHERE id = ?', c.booking_id), now = nowIso();
    if (r3 === 'approve') {
      if (b.status !== 'PENDING_PAYMENT') {
        await q.run("UPDATE payment_claims SET status = 'REFUND', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", 'RÃ©servation ' + b.status.toLowerCase() + ' entre-temps : rembourser le client', a.id, now, c.id);
        await notify(q, c.customer_id, 'Paiement reÃ§u, rÃ©servation indisponible', `La rÃ©servation ${b.ref} n'Ã©tait plus disponible. Nous vous remboursons ${fmtAmount(c.amount)} FCFA.`, `#/reservation/${b.id}`, 'warning');
        return ok({ status: 'REFUND', message: 'La rÃ©servation n\'est plus active : remboursez le client depuis votre application.' });
      }
      const t = await q.first('SELECT * FROM trips WHERE id = ?', b.trip_id);
      await capturePayment(q, env, b, t, c.provider, c.transaction_ref, a.id, { verifiedBy: a.id });
      await q.run("UPDATE payment_claims SET status = 'APPROVED', reviewed_by = ?, reviewed_at = ? WHERE id = ?", a.id, now, c.id);
      await notify(q, c.customer_id, 'Paiement confirmÃ© âœ“', `${b.from_city} â†’ ${b.to_city} : votre rÃ©servation ${b.ref} est confirmÃ©e. Votre code est disponible.`, `#/reservation/${b.id}`, 'success');
      return ok({ status: 'APPROVED' });
    }
    if (r3 === 'reject') {
      const reason = str(body.reason, 300); if (!reason) fail(400, 'REASON_REQUIRED', 'Indiquez le motif (ex. transaction introuvable, montant incorrect).');
      await q.run("UPDATE payment_claims SET status = 'REJECTED', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", reason, a.id, now, c.id);
      if (b.status === 'PENDING_PAYMENT') await q.run('UPDATE bookings SET expires_at = ?, updated_at = ? WHERE id = ?', new Date(Date.now() + 30 * 60000).toISOString(), now, b.id);
      await notify(q, c.customer_id, 'Paiement non retrouvÃ©', `RÃ©servation ${b.ref} : ${reason}. Vous avez 30 minutes pour corriger l'ID de transaction.`, `#/reservation/${b.id}`, 'warning');
      await audit(q, a.id, 'payment.claim_rejected', 'booking', b.id, { reason });
      return ok({ status: 'REJECTED' });
    }
    if (r3 === 'refunded') { await q.run("UPDATE payment_claims SET status = 'REJECTED', reason = reason || ' Â· client remboursÃ©', reviewed_by = ?, reviewed_at = ? WHERE id = ?", a.id, now, c.id); await audit(q, a.id, 'payment.claim_refunded', 'booking', b.id, { amount: c.amount }); return ok({ ok: true }); }
  }
  // --- Types d'envoi (propriÃ©taire) ---
  if (is('GET', 'admin', 'parcel-types')) return ok({ results: await getParcelTypes(q, true) });
  if (is('POST', 'admin', 'parcel-types')) {
    needSuper(a);
    const code = str(body.code, 20).toUpperCase().replace(/[^A-Z0-9_]/g, ''), label = str(body.label, 80);
    if (!code || !label) fail(400, 'TYPE_INVALID', 'Code et nom obligatoires.');
    const mode = body.mode === 'WEIGHT' ? 'WEIGHT' : 'FLAT';
    const v = { cb: int(body.clientBase) || 0, db: int(body.driverBase) || 0, ck: Number(body.clientPerKm) || 0, dk: Number(body.driverPerKm) || 0 };
    if (mode === 'FLAT' && !(v.cb > 0)) fail(400, 'PRICE_REQUIRED', 'Indiquez le prix client du forfait.');
    if (v.db > v.cb || v.dk > v.ck && v.ck > 0) fail(400, 'NEGATIVE_MARGIN', 'La part chauffeur ne peut pas dÃ©passer le prix client.');
    const ex = await q.first('SELECT id FROM parcel_types WHERE code = ?', code);
    if (ex) await q.run('UPDATE parcel_types SET label = ?, description = ?, mode = ?, client_base = ?, driver_base = ?, client_per_km = ?, driver_per_km = ?, nominal_kg = ?, id_check = ?, sort = ?, updated_at = ? WHERE id = ?',
      label, str(body.description, 300), mode, v.cb, v.db, v.ck, v.dk, Math.max(0.05, Math.min(10, Number(body.nominalKg) || 0.2)), body.idCheck ? 1 : 0, int(body.sort) || 10, nowIso(), ex.id);
    else await q.run('INSERT INTO parcel_types (id, code, label, description, mode, client_base, driver_base, client_per_km, driver_per_km, nominal_kg, id_check, sort, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid(), code, label, str(body.description, 300), mode, v.cb, v.db, v.ck, v.dk, Math.max(0.05, Math.min(10, Number(body.nominalKg) || 0.2)), body.idCheck ? 1 : 0, int(body.sort) || 10, nowIso());
    await audit(q, a.id, 'parcel_type.saved', 'parcel_type', code, v);
    return ok({ ok: true }, 201);
  }
  if (is('POST', 'admin', 'parcel-types', '*', 'toggle')) {
    needSuper(a);
    const t = await q.first('SELECT * FROM parcel_types WHERE id = ?', r2); if (!t) fail(404, 'NOT_FOUND', 'Type introuvable.');
    if (t.code === 'COLIS' && t.active) fail(400, 'REQUIRED', 'Le type Â« Colis Â» au poids reste toujours actif.');
    await q.run('UPDATE parcel_types SET active = ? WHERE id = ?', t.active ? 0 : 1, t.id); return ok({ ok: true });
  }
  // --- Codes promo ---
  if (is('GET', 'admin', 'promos')) return ok({ results: await q.all('SELECT * FROM promo_codes ORDER BY created_at DESC') });
  if (is('POST', 'admin', 'promos')) {
    needSuper(a);
    const code = str(body.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (code.length < 4) fail(400, 'CODE_INVALID', 'Code : 4 lettres ou chiffres minimum.');
    const kind = body.kind === 'FIXED' ? 'FIXED' : 'PERCENT', value = int(body.value);
    if (!(value > 0) || (kind === 'PERCENT' && value > 100)) fail(400, 'VALUE_INVALID', 'Valeur invalide.');
    if (await q.first('SELECT id FROM promo_codes WHERE code = ?', code)) fail(409, 'CODE_EXISTS', 'Ce code existe dÃ©jÃ .');
    await q.run('INSERT INTO promo_codes (id, code, label, kind, value, applies, max_uses, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)', uid(), code, str(body.label, 80), kind, value,
      ['SEAT', 'PARCEL'].includes(body.applies) ? body.applies : 'ALL', int(body.maxUses) || null, /^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt || '') ? body.expiresAt + 'T23:59:59Z' : null, nowIso());
    await audit(q, a.id, 'promo.created', 'promo', code, { kind, value });
    return ok({ ok: true }, 201);
  }
  if (is('POST', 'admin', 'promos', '*', 'toggle')) { needSuper(a); await q.run('UPDATE promo_codes SET active = 1 - active WHERE id = ?', r2); return ok({ ok: true }); }
  // --- Factures ---
  if (is('GET', 'admin', 'invoices')) {
    const like = '%' + str(query.q, 40) + '%', kind = ['INVOICE', 'CREDIT_NOTE', 'MANUAL'].includes(query.kind) ? query.kind : null;
    const rows = await q.all(`SELECT i.id, i.number, i.kind, i.status, i.total, i.vat_amount, i.issued_at, json_extract(i.customer, '$.name') customer_name, b.ref booking_ref FROM invoices i LEFT JOIN bookings b ON b.id = i.booking_id
      WHERE (? IS NULL OR i.kind = ?) AND (? = '%%' OR i.number LIKE ? OR json_extract(i.customer, '$.name') LIKE ? OR b.ref LIKE ?) ORDER BY i.issued_at DESC LIMIT 300`, kind, kind, like, like, like, like);
    const tot = await q.first("SELECT COALESCE(SUM(CASE WHEN kind != 'CREDIT_NOTE' AND status != 'CANCELLED' THEN total END),0) billed, COALESCE(SUM(CASE WHEN kind = 'CREDIT_NOTE' THEN total END),0) credited, COALESCE(SUM(CASE WHEN status = 'DUE' THEN total END),0) due FROM invoices");
    return ok({ results: rows, totals: tot });
  }
  if (is('POST', 'admin', 'invoices')) {
    const cu = body.customer || {}; const name = str(cu.name, 120); if (!name) fail(400, 'CUSTOMER_REQUIRED', 'Nom du client obligatoire.');
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => ({ label: str(l.label, 300), qty: Math.max(0, Number(l.qty) || 0), unit: int(l.unit) || 0 })).filter((l) => l.label && l.qty);
    if (!lines.length) fail(400, 'LINES_REQUIRED', 'Ajoutez au moins une ligne.');
    lines.forEach((l) => { l.total = Math.round(l.qty * l.unit); });
    const total = lines.reduce((x, l) => x + l.total, 0); if (total <= 0) fail(400, 'TOTAL_INVALID', 'Le total doit Ãªtre positif.');
    const vat = vatOf(total, (await getSettings(q)).company), id = uid(), number = await nextInvoiceNumber(q, 'FAC');
    await q.run('INSERT INTO invoices (id, number, kind, customer, lines, total, vat_rate, vat_amount, status, notes, issued_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, number, 'MANUAL',
      JSON.stringify({ name, company: str(cu.company, 120), address: str(cu.address, 200), phone: str(cu.phone, 30), email: str(cu.email, 120), ninea: str(cu.ninea, 40) }), JSON.stringify(lines), total, vat.rate, vat.amount,
      body.status === 'DUE' ? 'DUE' : 'PAID', str(body.notes, 500), nowIso(), a.id);
    await audit(q, a.id, 'invoice.created', 'invoice', number, { total });
    return ok({ id, number }, 201);
  }
  if (is('POST', 'admin', 'invoices', '*', 'status')) {
    const inv = await q.first("SELECT * FROM invoices WHERE id = ? AND kind = 'MANUAL'", r2); if (!inv) fail(404, 'NOT_FOUND', 'Seules les factures manuelles se modifient.');
    const st = ['PAID', 'DUE', 'CANCELLED'].includes(body.status) ? body.status : inv.status;
    await q.run('UPDATE invoices SET status = ? WHERE id = ?', st, inv.id); await audit(q, a.id, 'invoice.' + st.toLowerCase(), 'invoice', inv.number); return ok({ ok: true });
  }
  // --- Messages (tickets) ---
  if (is('GET', 'admin', 'tickets')) {
    const st = ['OPEN', 'ANSWERED', 'CLOSED'].includes(query.status) ? query.status : null;
    return ok({ results: await q.all(`SELECT t.*, u.ref user_ref, u.role user_role, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) n,
      (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY created_at DESC LIMIT 1) last FROM tickets t LEFT JOIN users u ON u.id = t.user_id
      WHERE (? IS NULL OR t.status = ?) ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'ANSWERED' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 300`, st, st) });
  }
  if (seg[1] === 'tickets' && r2) {
    const t = await q.first('SELECT t.*, u.ref user_ref, u.role user_role FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?', r2); if (!t) fail(404, 'NOT_FOUND', 'Message introuvable.');
    if (method === 'GET' && seg.length === 3) return ok({ ...t, messages: await q.all('SELECT m.body, m.from_team, m.created_at, u.name author FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at', t.id) });
    if (method === 'POST' && r3 === 'reply') {
      const text = str(body.body, 3000); if (!text) fail(400, 'EMPTY', 'RÃ©ponse vide.');
      await q.run('INSERT INTO ticket_messages (id, ticket_id, author_id, from_team, body, created_at) VALUES (?,?,?,1,?,?)', uid(), t.id, a.id, text, nowIso());
      await q.run("UPDATE tickets SET status = 'ANSWERED', updated_at = ? WHERE id = ?", nowIso(), t.id);
      let channel = 'in-app';
      if (t.user_id) await notify(q, t.user_id, `RÃ©ponse de Bokk Yoon Â· ${t.ref}`, text.slice(0, 120), t.user_role === 'driver' ? `#/aide/${t.id}` : `#/aide/${t.id}`, 'message');
      else { if (t.email) channel = 'email:' + await sendEmail(env, t.email, `Bokk Yoon Â· ${t.ref} Â· ${t.subject}`, text); if (t.phone) await sendSms(env, t.phone, `Bokk Yoon ${t.ref} : ${text.slice(0, 140)}`); }
      await audit(q, a.id, 'ticket.replied', 'ticket', t.ref, { channel });
      return ok({ ok: true, channel });
    }
    if (method === 'POST' && r3 === 'close') { await q.run("UPDATE tickets SET status = 'CLOSED', updated_at = ? WHERE id = ?", nowIso(), t.id); return ok({ ok: true }); }
  }
  if (is('GET', 'admin', 'feedback')) {
    return ok({ results: await q.all(`SELECT f.*, b.ref booking_ref, b.from_city, b.to_city, u.name client, u.id client_id, d.name driver, d.id driver_id FROM feedback f JOIN bookings b ON b.id = f.booking_id JOIN users u ON u.id = f.user_id JOIN users d ON d.id = b.driver_id ORDER BY f.created_at DESC LIMIT 200`) });
  }
  if (is('GET', 'admin', 'waitlist')) return ok({ results: await q.all('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 500') });
  if (is('GET', 'admin', 'audit')) return ok({ results: await q.all('SELECT l.*, u.name actor_name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.created_at DESC LIMIT 300') });
  if (is('POST', 'admin', 'seed')) { needSuper(a); const r = await seedDemo(q); await audit(q, a.id, 'admin.seed', 'system', 'seed', r); return ok(r); }
  return null;
}

// ============================ API partenaires v1 ============================
async function partnerRoutes({ q, env, is, r3, body, headers }) {
  const key = headers['x-api-key'] || '';
  if (!key) fail(401, 'API_KEY_REQUIRED', 'En-tÃªte x-api-key manquant.');
  const partner = await q.first('SELECT * FROM partners WHERE api_key_hash = ?', await sha256(key));
  if (!partner) fail(401, 'API_KEY_INVALID', 'ClÃ© API invalide.');
  const owner = await q.first('SELECT status FROM users WHERE id = ?', partner.owner_id);
  if (owner?.status !== 'active') fail(403, 'PARTNER_SUSPENDED', 'Compte partenaire suspendu.');
  const today = nowIso().slice(0, 10);
  const pkgFrom = (x) => {
    const A = cityByName(x.from), B = cityByName(x.to);
    if (!A || !B || A === B) fail(400, 'CITY_INVALID', 'Villes invalides (voir GET /api/config).');
    const side = x.volumeM3 ? Math.round(Math.cbrt(Number(x.volumeM3) * 1e6)) : null;
    return { sender_id: partner.owner_id, origin: A.name, dest: B.name, origin_lat: A.lat, origin_lng: A.lng, dest_lat: B.lat, dest_lng: B.lng, weight_kg: Number(x.weightKg),
      length_cm: int(x.lengthCm) || side || 30, width_cm: int(x.widthCm) || side || 20, height_cm: int(x.heightCm) || side || 20, category: str(x.category, 30) || 'autre',
      declared_value: Math.max(0, int(x.declaredValue) || 0), urgent: 0, date_from: str(x.dateFrom, 10) || today, date_to: str(x.dateTo, 10) || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) };
  };
  if (is('POST', 'partner', 'v1', 'eligibility')) {
    const p = pkgFrom(body); const errs = validatePackage(p); if (errs.length) return ok({ eligible: false, reasons: errs });
    const r = await offersFor(q, p); const all = [...r.top, ...r.alternatives];
    if (!all.length) return ok({ eligible: false, reasons: ['Aucun trajet compatible sur la pÃ©riode.'] });
    const price = (await parcelPrice(q, str(body.type, 20) || 'COLIS', cityByName(p.origin), cityByName(p.dest), p.weight_kg)).client;
    return ok({ eligible: true, price, currency: 'XOF', offers: all.length, earliestDepartureAt: all.map((c) => c.trip.departure_at).sort()[0] });
  }
  if (is('POST', 'partner', 'v1', 'shipments')) {
    const p = pkgFrom(body); const errs = validatePackage(p); if (errs.length) fail(400, 'PACKAGE_INVALID', errs.join(' '));
    const rName = str(body.recipientName, 60); if (!rName) fail(400, 'RECIPIENT_REQUIRED', 'recipientName requis.');
    const rPhone = normalizePhone(body.recipientPhone);
    const r = await offersFor(q, p); const best = r.top[0] || r.alternatives[0];
    if (!best) fail(422, 'NOT_ELIGIBLE', 'Aucun trajet compatible : testez d\'abord /eligibility.');
    const typeCode = str(body.type, 20) || 'COLIS';
    const am = await parcelPrice(q, typeCode, cityByName(p.origin), cityByName(p.dest), p.weight_kg);
    const id = uid(), bid = uid(), now = nowIso();
    if (!(await q.run('UPDATE trips SET parcel_kg_left = parcel_kg_left - ? WHERE id = ? AND parcel_kg_left >= ?', p.weight_kg, best.trip.id, p.weight_kg))) fail(409, 'NO_CAPACITY', 'CapacitÃ© prise entre-temps, rÃ©essayez.');
    await q.run(`INSERT INTO packages (id, type_code, sender_id, origin, origin_lat, origin_lng, dest, dest_lat, dest_lng, date_from, date_to, weight_kg, length_cm, width_cm, height_cm, category, declared_value, fragile, description, recipient_name, recipient_phone, partner_id, external_ref, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PAID',?)`, id, typeCode, partner.owner_id, p.origin, p.origin_lat, p.origin_lng, p.dest, p.dest_lat, p.dest_lng, p.date_from, p.date_to, p.weight_kg, p.length_cm, p.width_cm, p.height_cm, p.category, p.declared_value, body.fragile ? 1 : 0, str(body.description, 300), rName, rPhone, partner.id, str(body.externalRef, 80), now);
    await q.run(`INSERT INTO bookings (id, kind, trip_id, customer_id, driver_id, package_id, from_city, to_city, match_score, list_price, price, driver_pay, status, pickup_code, delivery_code, track_token, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'PAID',?,?,?,?,?)`, bid, 'PARCEL', best.trip.id, partner.owner_id, best.trip.driver_id, id, p.origin, p.dest, best.score, am.client, am.client, am.driver, randomDigits(6), randomDigits(6), randomHex(12), now, now);
    const ref = await setRef(q, 'packages', id); await setRef(q, 'bookings', bid);
    await invoiceForBooking(q, await q.first('SELECT * FROM bookings WHERE id = ?', bid), 'DUE');
    await q.run("INSERT INTO payments (id, booking_id, provider, provider_ref, amount, status, created_at) VALUES (?,?,'PARTNER',?,?,'CAPTURED',?)", uid(), bid, 'PRT-' + randomHex(6).toUpperCase(), am.client, now);
    await notify(q, best.trip.driver_id, 'Nouveau colis confirmÃ©', `${p.origin} â†’ ${p.dest} Â· vous recevrez ${am.driver.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA`, `#/mission/${bid}`, 'success');
    await notifyPartner(q, env, bid, 'shipment.confirmed');
    return ok({ shipmentId: id, reference: ref, status: 'CONFIRMED', price: am.client, currency: 'XOF', departureAt: best.trip.departure_at, note: 'Montant provisionnÃ© sur votre compte partenaire, facturÃ© Ã  la livraison.' }, 201);
  }
  if (is('GET', 'partner', 'v1', 'shipments', '*')) {
    const s = await q.first('SELECT * FROM packages WHERE id = ? AND partner_id = ?', r3, partner.id); if (!s) fail(404, 'NOT_FOUND', 'Envoi introuvable.');
    const b = await q.first('SELECT * FROM bookings WHERE package_id = ? ORDER BY created_at DESC', s.id);
    return ok({ shipmentId: s.id, reference: s.ref, externalRef: s.external_ref, packageStatus: s.status, bookingStatus: b?.status || null, price: b?.price || null,
      pickupCode: b?.status === 'PAID' ? b.pickup_code : null, trackingPath: b?.track_token ? `/app/#/suivi/${b.track_token}` : null, pickedUpAt: b?.pickup_at || null, deliveredAt: b?.delivered_at || null });
  }
  fail(404, 'ROUTE_NOT_FOUND', 'Route partenaire inconnue.');
}




