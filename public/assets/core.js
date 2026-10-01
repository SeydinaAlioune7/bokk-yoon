// Bokk Yoon — règles métier partagées (API Cloudflare + mode démo navigateur).
// Modèle opérateur : Bokk Yoon fixe le prix client, encaisse à la réservation et reverse sa part au chauffeur.

export const REGIONS = ['Dakar', 'Thiès', 'Diourbel', 'Fatick', 'Kaolack', 'Kaffrine', 'Louga', 'Saint-Louis', 'Matam', 'Tambacounda', 'Kédougou', 'Kolda', 'Sédhiou', 'Ziguinchor'];

// Coordonnées approximatives des centres-villes (WGS84). Région et département : découpage officiel (Gouvernement du Sénégal / OCHA, CC BY 3.0 IGO).
export const CITIES = [
  ['Dakar', 'Dakar', 'Dakar', 14.6928, -17.4467],
  ['Pikine', 'Dakar', 'Pikine', 14.7549, -17.3906],
  ['Guédiawaye', 'Dakar', 'Guédiawaye', 14.7790, -17.3930],
  ['Keur Massar', 'Dakar', 'Pikine', 14.7830, -17.3110],
  ['Rufisque', 'Dakar', 'Rufisque', 14.7167, -17.2667],
  ['Diamniadio', 'Dakar', 'Rufisque', 14.7275, -17.1829],
  ['Thiès', 'Thiès', 'Thiès', 14.7910, -16.9359],
  ['Tivaouane', 'Thiès', 'Tivaouane', 14.9500, -16.8167],
  ['Mboro', 'Thiès', 'Tivaouane', 15.1500, -16.8900],
  ['Mbour', 'Thiès', 'Mbour', 14.4200, -16.9640],
  ['Saly', 'Thiès', 'Mbour', 14.4470, -17.0140],
  ['Joal-Fadiouth', 'Thiès', 'Mbour', 14.1667, -16.8333],
  ['Diourbel', 'Diourbel', 'Diourbel', 14.6550, -16.2314],
  ['Bambey', 'Diourbel', 'Bambey', 14.7000, -16.4500],
  ['Mbacké', 'Diourbel', 'Mbacké', 14.7906, -15.9082],
  ['Touba', 'Diourbel', 'Mbacké', 14.8500, -15.8833],
  ['Fatick', 'Fatick', 'Fatick', 14.3390, -16.4111],
  ['Foundiougne', 'Fatick', 'Foundiougne', 14.1330, -16.4670],
  ['Sokone', 'Fatick', 'Foundiougne', 13.8830, -16.3700],
  ['Gossas', 'Fatick', 'Gossas', 14.4900, -16.0700],
  ['Kaolack', 'Kaolack', 'Kaolack', 14.1520, -16.0726],
  ['Nioro du Rip', 'Kaolack', 'Nioro du Rip', 13.7500, -15.7800],
  ['Guinguinéo', 'Kaolack', 'Guinguinéo', 14.2700, -15.9500],
  ['Kaffrine', 'Kaffrine', 'Kaffrine', 14.1059, -15.5508],
  ['Koungheul', 'Kaffrine', 'Koungheul', 13.9800, -14.8000],
  ['Birkelane', 'Kaffrine', 'Birkelane', 14.1300, -15.7500],
  ['Malem Hodar', 'Kaffrine', 'Malem Hodar', 14.0900, -15.3000],
  ['Louga', 'Louga', 'Louga', 15.6187, -16.2244],
  ['Kébémer', 'Louga', 'Kébémer', 15.3700, -16.4400],
  ['Linguère', 'Louga', 'Linguère', 15.3900, -15.1200],
  ['Dahra', 'Louga', 'Linguère', 15.3500, -15.4800],
  ['Saint-Louis', 'Saint-Louis', 'Saint-Louis', 16.0179, -16.4896],
  ['Richard-Toll', 'Saint-Louis', 'Dagana', 16.4625, -15.7003],
  ['Dagana', 'Saint-Louis', 'Dagana', 16.5200, -15.5000],
  ['Podor', 'Saint-Louis', 'Podor', 16.6500, -14.9600],
  ['Matam', 'Matam', 'Matam', 15.6559, -13.2554],
  ['Kanel', 'Matam', 'Kanel', 15.4900, -13.1800],
  ['Ranérou', 'Matam', 'Ranérou', 15.3000, -13.9600],
  ['Tambacounda', 'Tambacounda', 'Tambacounda', 13.7700, -13.6672],
  ['Bakel', 'Tambacounda', 'Bakel', 14.9000, -12.4600],
  ['Goudiry', 'Tambacounda', 'Goudiry', 14.1800, -12.7200],
  ['Koumpentoum', 'Tambacounda', 'Koumpentoum', 13.9800, -14.5500],
  ['Kédougou', 'Kédougou', 'Kédougou', 12.5570, -12.1747],
  ['Salémata', 'Kédougou', 'Salémata', 12.6300, -12.8300],
  ['Saraya', 'Kédougou', 'Saraya', 12.8300, -11.7500],
  ['Kolda', 'Kolda', 'Kolda', 12.8983, -14.9412],
  ['Vélingara', 'Kolda', 'Vélingara', 13.1500, -14.1100],
  ['Médina Yoro Foulah', 'Kolda', 'Médina Yoro Foulah', 13.2900, -14.7200],
  ['Sédhiou', 'Sédhiou', 'Sédhiou', 12.7081, -15.5569],
  ['Goudomp', 'Sédhiou', 'Goudomp', 12.5800, -15.8800],
  ['Bounkiling', 'Sédhiou', 'Bounkiling', 13.0400, -15.7000],
  ['Ziguinchor', 'Ziguinchor', 'Ziguinchor', 12.5833, -16.2667],
  ['Bignona', 'Ziguinchor', 'Bignona', 12.8100, -16.2300],
  ['Oussouye', 'Ziguinchor', 'Oussouye', 12.4850, -16.5470]
].map(([name, region, departement, lat, lng]) => ({ name, region, departement, lat, lng }));

export const cityByName = (name) => CITIES.find((c) => c.name.toLowerCase() === String(name || '').trim().toLowerCase()) || null;
export function nearestCity(lat, lng) {
  let best = null, d = Infinity;
  for (const c of CITIES) { const k = haversineKm({ lat, lng }, c); if (k < d) { d = k; best = c; } }
  return { city: best, distanceKm: d };
}

export const CATEGORIES = [
  { code: 'documents', label: 'Documents', risk: 0.05, maxKg: 2 },
  { code: 'vetements', label: 'Vêtements, tissus', risk: 0.1, maxKg: 10 },
  { code: 'electronique', label: 'Petit électronique (emballé)', risk: 0.45, maxKg: 5 },
  { code: 'alimentaire_sec', label: 'Alimentaire sec emballé', risk: 0.2, maxKg: 10 },
  { code: 'cosmetiques', label: 'Cosmétiques (non inflammables)', risk: 0.25, maxKg: 5 },
  { code: 'pieces', label: 'Pièces détachées', risk: 0.2, maxKg: 10 },
  { code: 'autre', label: 'Autre objet autorisé', risk: 0.3, maxKg: 10 },
];
export const FORBIDDEN = ['Argent liquide', 'Médicaments', 'Produits inflammables ou gaz', 'Armes, munitions', 'Stupéfiants', 'Animaux vivants', 'Denrées périssables non emballées', 'Bijoux et métaux précieux', 'Pièces d\'identité hors type « Passeport et documents officiels » (remise contrôlée)'];

// Types d'envoi par défaut. Le propriétaire en ajoute d'autres dans l'espace équipe (table parcel_types).
// mode WEIGHT : prix selon l'axe et le poids. mode FLAT : forfait (+ éventuellement un montant au km), sans poids à saisir.
export const DEFAULT_PARCEL_TYPES = [
  { code: 'COLIS', label: 'Colis', description: 'Sac, carton ou paquet jusqu\'à 10 kg. Prix selon l\'axe et le poids.', mode: 'WEIGHT', client_base: 0, driver_base: 0, client_per_km: 0, driver_per_km: 0, nominal_kg: 0, id_check: 0, sort: 1 },
  { code: 'PASSEPORT', label: 'Passeport et documents officiels', description: 'Remis en main propre au destinataire nommé, sur présentation de sa pièce d\'identité.', mode: 'FLAT', client_base: 3000, driver_base: 2000, client_per_km: 5, driver_per_km: 3, nominal_kg: 0.2, id_check: 1, sort: 2 },
  { code: 'ENVELOPPE', label: 'Enveloppe, documents', description: 'Courrier, dossier, contrat : jusqu\'à 500 g, sous enveloppe fermée.', mode: 'FLAT', client_base: 1500, driver_base: 1000, client_per_km: 3, driver_per_km: 2, nominal_kg: 0.5, id_check: 0, sort: 3 },
  { code: 'CLES', label: 'Clés, carte SIM, petit objet', description: 'Objet de poche dans une pochette fermée.', mode: 'FLAT', client_base: 1500, driver_base: 1000, client_per_km: 2, driver_per_km: 1, nominal_kg: 0.2, id_check: 0, sort: 4 },
];
export function flatAmounts(type, km, rounding = 250) {
  const r = (x) => Math.max(rounding, Math.round(x / rounding) * rounding);
  return { client: r(type.client_base + type.client_per_km * km), driver: Math.round((type.driver_base + type.driver_per_km * km) / 50) * 50 };
}

export const LIMITS = { parcelMaxKg: 10, parcelMaxCm: 60, parcelMaxSumCm: 140, parcelMaxValue: 150000 };

// Réglages modifiables par le super-admin (table settings). Valeurs par défaut.
export const DEFAULT_SETTINGS = {
  pricing: {
    seatPerKm: 18, seatMin: 1000,          // prix client d'une place
    parcelPerKm: 12, parcelMin: 1000,      // prix client d'un colis jusqu'à 5 kg
    parcelExtraKgPct: 10,                  // +10 % par kg au-delà de 5 kg
    driverSharePct: 75,                    // part reversée au chauffeur
    rounding: 250,
  },
  booking: { paymentWindowMin: 30, payoutDelayHours: 24, clientCancelFullRefundHours: 24, driverAutoApprove: false },
  // Identité de l'entreprise : factures, contact, WhatsApp. Modifiable par le propriétaire.
  company: {
    name: 'Bokk Yoon', legalName: 'Bokk Yoon SARL (à compléter)', ninea: '', rccm: '', address: 'Dakar, Sénégal', phone: '+221 77 000 00 00',
    whatsapp: '+221770000000', email: 'contact@bokkyoon.sn', website: 'bokkyoon.sn', hours: 'Tous les jours, 7 h – 21 h',
    payInfo: 'Wave et Orange Money acceptés', footer: 'Merci d\'avoir voyagé avec Bokk Yoon.', vatEnabled: false, vatRate: 18,
    accent: '#0B6E4F', template: 'moderne', logo: '',
  },
  // Encaissement. SIMULATION : paiement fictif (démo). QR : le client paie sur le QR code marchand du propriétaire
  // puis déclare l'ID de transaction ; l'équipe vérifie et confirme. (API Wave Business : voir README.)
  payment: {
    mode: 'AUTO', // AUTO : QR code réel une fois déployé sur Cloudflare, simulation en démo
    wave: { enabled: true, qr: 'assets/pay/wave-qr.png', link: 'https://qr.wave.com/iVVNfc25fa0c0VTRCd3hEV1hQ/BqvVGl/An40gh/p', number: '', name: 'Bokk Yoon' },
    orange: { enabled: false, qr: '', link: '', number: '', name: '' },
    reviewMinutes: 30, instructions: 'Payez le montant exact, puis indiquez l\'ID de la transaction. Votre réservation est confirmée dès vérification.',
  },
};

export const WEIGHTS = { geographic: 0.15, temporal: 0.20, capacity: 0.05, detour: 0.20, reliability: 0.20, reputation: 0.15, urgency: 0.05, risk: 0.20 };
export const ALGO_VERSION = 'v2-operateur';

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
export const ROAD_FACTOR = 1.25; // vol d'oiseau → route (OSRM en production)
export const roadKm = (a, b) => haversineKm(a, b) * ROAD_FACTOR;
export const durationMin = (km) => Math.round((km / 62) * 60 + 10);

export function projectOnSegment(p, a, b) {
  const k = Math.cos(rad((a.lat + b.lat) / 2));
  const ax = a.lng * k, ay = a.lat, bx = b.lng * k, by = b.lat, px = p.lng * k, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const q = { lat: ay + tc * dy, lng: (ax + tc * dx) / k };
  return { t, distKm: haversineKm(p, q) };
}

const roundTo = (x, step) => Math.max(step, Math.round(x / step) * step);

/**
 * Prix client et rémunération chauffeur pour un trajet A → B.
 * overrides : lignes de la table tariffs (grille fixée par le propriétaire), prioritaires sur la formule.
 */
export function quote(settings, overrides, A, B) {
  const p = { ...DEFAULT_SETTINGS.pricing, ...(settings?.pricing || {}) };
  const km = roadKm(A, B);
  const o = (overrides || []).find((t) => t.active && ((t.origin === A.name && t.dest === B.name) || (t.origin === B.name && t.dest === A.name)));
  const seat = o?.client_seat ?? Math.max(p.seatMin, roundTo(km * p.seatPerKm, p.rounding));
  const parcel = o?.client_parcel ?? Math.max(p.parcelMin, roundTo(km * p.parcelPerKm, p.rounding));
  const share = p.driverSharePct / 100;
  return {
    distanceKm: Math.round(km), durationMin: durationMin(km), source: o ? 'grille' : 'formule',
    clientSeat: seat, clientParcel: parcel,
    driverSeat: o?.driver_seat ?? Math.round((seat * share) / 50) * 50,
    driverParcel: o?.driver_parcel ?? Math.round((parcel * share) / 50) * 50,
    extraKgPct: p.parcelExtraKgPct,
  };
}
export function parcelAmounts(q, weightKg) {
  const factor = 1 + (q.extraKgPct / 100) * Math.max(0, Math.ceil(weightKg) - 5);
  const r = (x) => Math.round((x * factor) / 50) * 50;
  return { client: r(q.clientParcel), driver: r(q.driverParcel) };
}

export function validatePackage(p) {
  const errors = [];
  const cat = CATEGORIES.find((c) => c.code === p.category);
  if (!cat) errors.push('Catégorie non autorisée.');
  const w = Number(p.weight_kg);
  if (!(w > 0)) errors.push('Poids invalide.');
  if (w > LIMITS.parcelMaxKg) errors.push(`Poids maximum : ${LIMITS.parcelMaxKg} kg.`);
  if (cat && w > cat.maxKg) errors.push(`Pour « ${cat.label} », maximum ${cat.maxKg} kg.`);
  const dims = [p.length_cm, p.width_cm, p.height_cm].map(Number);
  if (dims.some((d) => !(d > 0))) errors.push('Dimensions invalides.');
  if (Math.max(...dims) > LIMITS.parcelMaxCm) errors.push(`Côté maximum : ${LIMITS.parcelMaxCm} cm.`);
  if (dims.reduce((s, d) => s + d, 0) > LIMITS.parcelMaxSumCm) errors.push(`Somme des côtés maximum : ${LIMITS.parcelMaxSumCm} cm.`);
  if (Number(p.declared_value) > LIMITS.parcelMaxValue) errors.push(`Valeur déclarée maximum : ${LIMITS.parcelMaxValue.toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA.`);
  return errors;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Correspondance colis ↔ trajet : filtres durs puis sous-scores. */
export function matchPackageTrip(pkg, trip, stats, now = new Date()) {
  const A = { lat: trip.origin_lat, lng: trip.origin_lng }, B = { lat: trip.dest_lat, lng: trip.dest_lng };
  const O = { lat: pkg.origin_lat, lng: pkg.origin_lng }, D = { lat: pkg.dest_lat, lng: pkg.dest_lng };
  if (!['PUBLISHED', 'FULL'].includes(trip.status)) return { ok: false, reason: 'Trajet fermé' };
  if (new Date(trip.departure_at) < now) return { ok: false, reason: 'Trajet déjà parti' };
  if (trip.parcel_kg_left < pkg.weight_kg) return { ok: false, reason: 'Capacité insuffisante' };
  if (!String(trip.accepts_categories).split(',').includes(pkg.category)) return { ok: false, reason: 'Catégorie refusée par le chauffeur' };
  if (!stats.approved || !stats.active) return { ok: false, reason: 'Chauffeur indisponible' };
  const pO = projectOnSegment(O, A, B), pD = projectOnSegment(D, A, B);
  const R = 12;
  if (pO.distKm > R || pD.distKm > R) return { ok: false, reason: 'Hors itinéraire' };
  if (!(pO.t < pD.t)) return { ok: false, reason: 'Sens opposé' };
  const dep = new Date(trip.departure_at);
  const passAt = new Date(dep.getTime() + Math.max(0, pO.t) * trip.duration_min * 60000);
  const arriveAt = new Date(dep.getTime() + Math.min(1, Math.max(0, pD.t)) * trip.duration_min * 60000 + 30 * 60000);
  const from = new Date(pkg.date_from + 'T00:00:00Z'), to = new Date(pkg.date_to + 'T23:59:59Z');
  if (passAt < from || arriveAt > to) return { ok: false, reason: 'Hors de vos dates' };
  const direct = roadKm(A, B);
  const detourKm = Math.max(0, roadKm(A, O) + roadKm(O, D) + roadKm(D, B) - direct);
  if (detourKm > trip.max_detour_km) return { ok: false, reason: `Détour ${detourKm.toFixed(1)} km > ${trip.max_detour_km} km` };
  const cat = CATEGORIES.find((c) => c.code === pkg.category) || { risk: 0.3 };
  const bayesRating = (5 * 4.2 + stats.ratingAvg * stats.ratingCount) / (5 + stats.ratingCount);
  const cancelRate = (stats.cancels + 1) / (stats.trips + 10);
  const valueRisk = clamp01(pkg.declared_value / (50000 + 20000 * Math.min(stats.trips, 10)));
  const hoursBeforeDeadline = (to - arriveAt) / 3600000;
  const b = {
    geographic: clamp01(1 - (pO.distKm + pD.distKm) / (2 * R)),
    temporal: 1,
    capacity: clamp01(1 - (pkg.weight_kg / Math.max(trip.parcel_kg_left, 0.1)) * 0.5),
    detour: clamp01(1 - detourKm / Math.max(trip.max_detour_km, 1)),
    reliability: clamp01(1 - cancelRate * 3),
    reputation: clamp01((bayesRating - 1) / 4),
    urgency: pkg.urgent ? clamp01(hoursBeforeDeadline / 72) : 0.5,
    risk: Math.max(cat.risk * 0.6, valueRisk * 0.7, stats.warnings ? 0.3 : 0),
  };
  const explore = stats.trips < 5 ? 0.05 : 0;
  return { ok: true, trip, detourKm, passAt: passAt.toISOString(), arriveAt: arriveAt.toISOString(), breakdown: b, explore };
}
export function scoreOf(b, explore = 0, w = WEIGHTS) {
  return clamp01(w.geographic * b.geographic + w.temporal * b.temporal + w.capacity * b.capacity + w.detour * b.detour +
    w.reliability * b.reliability + w.reputation * b.reputation + w.urgency * b.urgency - w.risk * b.risk + explore);
}
export function rankMatches(candidates) {
  const ok = candidates.filter((c) => c.ok);
  for (const c of ok) {
    c.score = Math.round(scoreOf(c.breakdown, c.explore) * 1000) / 1000;
    c.level = c.score >= 0.8 ? 'Très compatible' : c.score >= 0.6 ? 'Compatible' : 'Possible';
  }
  ok.sort((a, b) => b.score - a.score || new Date(a.trip.departure_at) - new Date(b.trip.departure_at));
  return { top: ok.filter((c) => c.score >= 0.6).slice(0, 5), alternatives: ok.filter((c) => c.score < 0.6).slice(0, 5), rejected: candidates.filter((c) => !c.ok).length };
}

/** Position estimée d'un trajet en cours d'après l'horaire (utilisée quand le GPS du chauffeur ne remonte pas). */
export function estimatePosition(trip, now = new Date()) {
  const start = new Date(trip.started_at || trip.departure_at).getTime();
  const progress = clamp01((now.getTime() - start) / (trip.duration_min * 60000));
  return {
    lat: trip.origin_lat + (trip.dest_lat - trip.origin_lat) * progress,
    lng: trip.origin_lng + (trip.dest_lng - trip.origin_lng) * progress,
    progress, etaMin: Math.max(0, Math.round((1 - progress) * trip.duration_min)),
  };
}

export const fcfa = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[\u202F\u00A0]/g, ' ')} FCFA`;
