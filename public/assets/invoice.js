// Démando — rendu imprimable : factures et avoirs (3 modèles), étiquettes colis avec QR code, relevés chauffeur.
const base = new URL('./', import.meta.url);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')}`;
const dateLong = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar', day: 'numeric', month: 'long', year: 'numeric' });

// ---------- Montant en lettres (« Arrêtée la présente facture à la somme de… ») ----------
const U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const T = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function below100(n) {
  if (n < 17) return U[n];
  if (n < 20) return 'dix-' + U[n - 10];
  const t = Math.floor(n / 10), u = n % 10;
  if (t === 7) return u === 1 ? 'soixante et onze' : 'soixante-' + below100(10 + u);
  if (t === 9) return 'quatre-vingt-' + below100(10 + u);
  if (t === 8) return u === 0 ? 'quatre-vingts' : 'quatre-vingt-' + U[u];
  return T[t] + (u === 0 ? '' : u === 1 ? ' et un' : '-' + U[u]);
}
function below1000(n, invariable = false) {
  const h = Math.floor(n / 100), r = n % 100;
  const hs = h === 0 ? '' : h === 1 ? 'cent' : U[h] + ' cent' + (r === 0 && !invariable ? 's' : '');
  let rs = r ? below100(r) : '';
  if (invariable && rs === 'quatre-vingts') rs = 'quatre-vingt';
  return [hs, rs].filter(Boolean).join(' ');
}
export function amountInWords(n) {
  n = Math.abs(Math.round(n));
  if (n === 0) return 'zéro';
  const parts = [], bil = Math.floor(n / 1e9), mil = Math.floor((n % 1e9) / 1e6), th = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (bil) parts.push(below1000(bil) + (bil > 1 ? ' milliards' : ' milliard').replace(/^un milliard/, 'un milliard'));
  if (mil) parts.push(below1000(mil) + (mil > 1 ? ' millions' : ' million'));
  if (th) parts.push(th === 1 ? 'mille' : below1000(th, true) + ' mille');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

// ---------- QR code (bibliothèque fournie localement) ----------
let qrPromise = null;
function loadQr() {
  qrPromise ??= new Promise((res, rej) => { if (window.qrcode) return res(window.qrcode); const s = document.createElement('script'); s.src = new URL('vendor/qrcode.js', base).href; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.appendChild(s); });
  return qrPromise;
}
export async function qrSvg(text, cell = 3) {
  try { const qrcode = await loadQr(); const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: cell, margin: 0, scalable: true }); }
  catch { return ''; }
}

// ---------- Facture / avoir ----------
const KIND = { INVOICE: 'Facture', MANUAL: 'Facture', CREDIT_NOTE: 'Avoir' };
const STATUS = { PAID: ['Payée', '#0B6E4F'], DUE: ['À payer', '#B9472F'], CANCELLED: ['Annulée', '#5C6B66'] };
const PROV = { WAVE: 'Wave', ORANGE_MONEY: 'Orange Money', FREE_MONEY: 'Free Money', CARD: 'carte bancaire', PARTNER: 'compte partenaire' };
export async function renderInvoice(inv, company, { verifyUrl = '' } = {}) {
  const c = company || {}, acc = /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : '#0B6E4F', tpl = c.template || 'moderne';
  const credit = inv.kind === 'CREDIT_NOTE', total = inv.total, vatAmount = inv.vat_amount || 0, ht = total - vatAmount;
  const st = credit ? null : STATUS[inv.status] || STATUS.PAID;
  const cu = inv.customer || {};
  const qr = await qrSvg(verifyUrl || `${inv.number} · ${money(total)} FCFA · ${c.name || 'Démando'}`);
  const legal = [c.legalName, c.ninea && 'NINEA ' + c.ninea, c.rccm && 'RCCM ' + c.rccm].filter(Boolean).join(' · ');
  const logo = c.logo ? `<img class="inv-logo" src="${esc(c.logo)}" alt="">` : `<span class="inv-mark" style="background:${acc}">${esc((c.name || 'B').slice(0, 1))}</span>`;
  return `<article class="inv inv-${tpl}" style="--acc:${acc}">
    <header class="inv-head">
      <div class="inv-brand">${logo}<div><div class="inv-name">${esc(c.name || 'Démando')}</div><div class="inv-sub">${esc(c.address || '')}</div></div></div>
      <div class="inv-title"><div class="inv-kind">${KIND[inv.kind] || 'Facture'}</div><div class="inv-num">N° ${esc(inv.number)}</div><div class="inv-date">${dateLong(inv.issued_at)}</div></div>
    </header>
    ${st ? `<div class="inv-stamp" style="--st:${st[1]}">${st[0]}</div>` : ''}
    <section class="inv-parties">
      <div><div class="inv-lbl">Émise par</div><strong>${esc(c.legalName || c.name || '')}</strong><br>${esc(c.address || '')}${c.phone ? '<br>Tél. ' + esc(c.phone) : ''}${c.email ? '<br>' + esc(c.email) : ''}${c.ninea ? '<br>NINEA ' + esc(c.ninea) : ''}${c.rccm ? '<br>RCCM ' + esc(c.rccm) : ''}</div>
      <div><div class="inv-lbl">${credit ? 'Au bénéfice de' : 'Facturé à'}</div><strong>${esc(cu.company || cu.name || '')}</strong>${cu.company && cu.name ? '<br>' + esc(cu.name) : ''}${cu.address ? '<br>' + esc(cu.address) : ''}${cu.phone ? '<br>Tél. ' + esc(cu.phone) : ''}${cu.email ? '<br>' + esc(cu.email) : ''}${cu.ninea ? '<br>NINEA ' + esc(cu.ninea) : ''}</div>
    </section>
    ${inv.booking ? `<p class="inv-meta">Réservation <strong>${esc(inv.booking.ref || '')}</strong>${inv.booking.provider ? ` · réglée par ${PROV[inv.booking.provider] || inv.booking.provider}${inv.booking.provider_ref ? ' (réf. ' + esc(inv.booking.provider_ref) + ')' : ''}` : ''}</p>` : ''}
    <table class="inv-table"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead>
      <tbody>${inv.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${String(l.qty).replace('.', ',')}</td><td class="n">${money(l.unit)}</td><td class="n">${money(l.total ?? l.qty * l.unit)}</td></tr>`).join('')}</tbody></table>
    <section class="inv-bottom">
      <div class="inv-words">${credit ? 'Arrêté le présent avoir' : 'Arrêtée la présente facture'} à la somme de <strong>${amountInWords(total)} francs CFA</strong>${total < 0 ? ' (en faveur du client)' : ''}.${inv.notes ? `<p class="inv-notes">${esc(inv.notes)}</p>` : ''}</div>
      <table class="inv-totals">
        ${inv.vat_rate ? `<tr><td>Total HT</td><td class="n">${money(ht)} FCFA</td></tr><tr><td>TVA ${String(inv.vat_rate).replace('.', ',')} %</td><td class="n">${money(vatAmount)} FCFA</td></tr>` : ''}
        <tr class="grand"><td>${inv.vat_rate ? 'Total TTC' : 'Total'}</td><td class="n">${money(total)} FCFA</td></tr>
        ${inv.vat_rate ? '' : '<tr><td colspan="2" class="inv-novat">TVA non applicable</td></tr>'}
      </table>
    </section>
    <footer class="inv-foot">
      <div>${c.payInfo ? `<div><strong>Paiement :</strong> ${esc(c.payInfo)}</div>` : ''}${c.footer ? `<div>${esc(c.footer)}</div>` : ''}<div class="inv-legal">${esc(legal)}${c.website ? ' · ' + esc(c.website) : ''}</div></div>
      <div class="inv-qr">${qr}<span>${esc(inv.number)}</span></div>
    </footer>
  </article>`;
}

// ---------- Étiquette colis (10 × 15 cm) ----------
export async function renderLabel(d, company) {
  const acc = company?.accent || '#0B6E4F';
  const qr = await qrSvg(d.trackUrl, 4);
  return `<article class="lbl" style="--acc:${acc}">
    <header><span class="lbl-brand">${esc(company?.name || 'Démando')}</span><span class="lbl-type">${esc(d.typeLabel || 'Colis')}${d.fragile ? ' · FRAGILE' : ''}</span></header>
    <div class="lbl-ref">${esc(d.ref)}</div>
    <div class="lbl-route"><div><small>De</small><strong>${esc(d.from)}</strong></div><span>→</span><div><small>À</small><strong>${esc(d.to)}</strong></div></div>
    <div class="lbl-mid"><div class="lbl-qr">${qr}</div><div class="lbl-info">
      <small>Destinataire</small><strong>${esc(d.recipientName)}</strong><span>${esc(d.recipientPhone)}</span>
      <small>Départ</small><span>${esc(d.departure)}</span>
      ${d.weight ? `<small>Poids</small><span>${esc(d.weight)}</span>` : ''}
      <small>Réservation</small><span>${esc(d.bookingRef)}</span></div></div>
    <footer>${d.idCheck ? 'Remise en main propre au destinataire sur présentation de sa pièce d\'identité et de son code.' : 'Ne remettre qu\'au destinataire, contre son code de réception à 6 chiffres.'}<br>Suivi : scannez le QR code.</footer>
  </article>`;
}

// ---------- Relevé mensuel chauffeur ----------
export function renderStatement(s) {
  const c = s.company || {}, acc = c.accent || '#0B6E4F';
  const [y, m] = s.month.split('-').map(Number);
  const monthLabel = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `<article class="inv inv-${c.template || 'moderne'}" style="--acc:${acc}">
    <header class="inv-head"><div class="inv-brand">${c.logo ? `<img class="inv-logo" src="${esc(c.logo)}" alt="">` : `<span class="inv-mark" style="background:${acc}">${esc((c.name || 'B')[0])}</span>`}<div><div class="inv-name">${esc(c.name || 'Démando')}</div><div class="inv-sub">${esc(c.address || '')}</div></div></div>
      <div class="inv-title"><div class="inv-kind">Relevé de gains</div><div class="inv-num">${esc(monthLabel)}</div><div class="inv-date">édité le ${dateLong(new Date().toISOString())}</div></div></header>
    <section class="inv-parties"><div><div class="inv-lbl">Chauffeur partenaire</div><strong>${esc(s.driver.name)}</strong><br>Matricule ${esc(s.driver.ref)}<br>${esc(s.driver.phone)}${s.driver.city ? '<br>' + esc(s.driver.city) : ''}</div>
      <div><div class="inv-lbl">Versements sur</div><strong>${esc(PROV[s.driver.payoutProvider] || s.driver.payoutProvider)}</strong><br>${esc(s.driver.payoutPhone)}</div></section>
    <table class="inv-table"><thead><tr><th>Date</th><th>Mission</th><th>Trajet</th><th class="n">Montant</th></tr></thead><tbody>
      ${s.missions.map((x) => `<tr><td>${new Date(x.departure_at).toLocaleDateString('fr-FR', { timeZone: 'Africa/Dakar' })}</td><td>${esc(x.ref)}${x.pkg_ref ? ' · ' + esc(x.pkg_ref) : ''}<br><small>${x.kind === 'PARCEL' ? 'Colis' : x.seats + ' place(s)'}${x.status === 'REFUNDED' ? ' · indemnité d\'annulation' : ''}</small></td><td>${esc(x.from_city)} → ${esc(x.to_city)}<br><small>${esc(x.trip_ref || '')}</small></td><td class="n">${money(x.driver_pay)}</td></tr>`).join('') || '<tr><td colspan="4">Aucune mission ce mois-ci.</td></tr>'}</tbody></table>
    <section class="inv-bottom"><div class="inv-words">${s.payouts.length ? `<strong>Versements reçus :</strong><br>${s.payouts.map((p) => `${esc(p.ref)} · ${dateLong(p.created_at)} · ${money(p.amount)} FCFA (${esc(p.reference)})`).join('<br>')}` : 'Aucun versement ce mois-ci.'}</div>
      <table class="inv-totals"><tr><td>Missions</td><td class="n">${s.totals.count}</td></tr><tr><td>Gains du mois</td><td class="n">${money(s.totals.earned)} FCFA</td></tr><tr class="grand"><td>Versé ce mois</td><td class="n">${money(s.totals.paid)} FCFA</td></tr></table></section>
    <footer class="inv-foot"><div><div class="inv-legal">${esc([c.legalName, c.ninea && 'NINEA ' + c.ninea].filter(Boolean).join(' · '))}</div><div>Document récapitulatif, sans valeur de facture.</div></div></footer>
  </article>`;
}

export const PRINT_CSS = `
.inv { --acc: #0B6E4F; background: #fff; color: #1a1f1d; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 16mm 15mm 14mm; box-sizing: border-box; font: 10.5pt/1.45 'Plus Jakarta Sans', system-ui, sans-serif; position: relative; display: flex; flex-direction: column; gap: 7mm; box-shadow: 0 10px 40px rgb(0 0 0 / .12); }
.inv * { box-sizing: border-box; }
.inv-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; }
.inv-brand { display: flex; gap: 4mm; align-items: center; }
.inv-logo { max-height: 18mm; max-width: 45mm; object-fit: contain; }
.inv-mark { width: 14mm; height: 14mm; border-radius: 4mm; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 18pt; }
.inv-name { font-weight: 800; font-size: 15pt; letter-spacing: -.01em; }
.inv-sub { color: #5c6b66; font-size: 9pt; }
.inv-title { text-align: right; }
.inv-kind { font-size: 22pt; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; color: var(--acc); line-height: 1; }
.inv-num { font-weight: 700; margin-top: 2mm; font-family: ui-monospace, Menlo, monospace; }
.inv-date { color: #5c6b66; font-size: 9pt; }
.inv-stamp { position: absolute; top: 44mm; right: 16mm; transform: rotate(-8deg); border: 2.5px solid var(--st); color: var(--st); padding: 1.5mm 5mm; border-radius: 2mm; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; font-size: 12pt; opacity: .85; }
.inv-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.inv-parties > div { padding: 4mm 5mm; border-radius: 3mm; background: #f6f3ee; }
.inv-lbl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; color: var(--acc); font-weight: 800; margin-bottom: 1.5mm; }
.inv-meta { margin: 0; color: #3b4a45; font-size: 9.5pt; }
.inv-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.inv-table th:nth-child(2) { width: 14mm; } .inv-table th:nth-child(3), .inv-table th:nth-child(4) { width: 30mm; }
.inv-table td:first-child { white-space: normal; overflow-wrap: anywhere; }
.inv td, .inv th { white-space: normal; }
.inv .n { white-space: nowrap; }
.inv-table th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #fff; background: var(--acc); padding: 2.5mm 3mm; }
.inv-table td { padding: 3mm; border-bottom: 1px solid #e6ddcd; vertical-align: top; }
.inv-table small { color: #5c6b66; }
.inv .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.inv-bottom { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8mm; align-items: start; }
.inv-words { font-size: 9.5pt; color: #3b4a45; }
.inv-notes { margin: 3mm 0 0; }
.inv-totals { width: 100%; border-collapse: collapse; }
.inv-totals td { padding: 2mm 3mm; }
.inv-totals .grand td { background: var(--acc); color: #fff; font-weight: 800; font-size: 12pt; }
.inv-novat { font-size: 8pt; color: #5c6b66; text-align: right; }
.inv-foot { margin-top: auto; display: flex; justify-content: space-between; gap: 8mm; align-items: flex-end; border-top: 1px solid #e6ddcd; padding-top: 4mm; font-size: 8.5pt; color: #3b4a45; }
.inv-legal { color: #5c6b66; margin-top: 1mm; }
.inv-qr { width: 24mm; text-align: center; font: 7pt ui-monospace, Menlo, monospace; color: #5c6b66; }
.inv-qr svg { width: 22mm; height: 22mm; display: block; margin: 0 auto 1mm; }
/* Modèle moderne : bandeau de couleur */
.inv-moderne .inv-head { margin: -16mm -15mm 0; padding: 12mm 15mm 9mm; background: var(--acc); color: #fff; }
.inv-moderne .inv-sub, .inv-moderne .inv-date { color: rgb(255 255 255 / .8); }
.inv-moderne .inv-kind { color: #fff; }
.inv-moderne .inv-mark { background: rgb(255 255 255 / .2) !important; }
.inv-moderne .inv-logo { background: #fff; padding: 1.5mm; border-radius: 2mm; }
/* Modèle classique : serif, cadre */
.inv-classique { font-family: Georgia, 'Times New Roman', serif; border: 1.5px solid var(--acc); outline: 4px double var(--acc); outline-offset: -8mm; padding: 20mm 19mm 16mm; }
.inv-classique .inv-kind { font-family: Georgia, serif; font-weight: 700; text-transform: none; font-size: 26pt; }
.inv-classique .inv-parties > div { background: none; border: 1px solid #d8cfbf; }
.inv-classique .inv-table th { background: none; color: var(--acc); border-bottom: 2px solid var(--acc); }
.inv-classique .inv-totals .grand td { background: none; color: var(--acc); border-top: 2px solid var(--acc); }
/* Modèle minimal */
.inv-minimal .inv-kind { color: #1a1f1d; font-weight: 300; letter-spacing: .3em; }
.inv-minimal .inv-parties > div { background: none; padding: 0; }
.inv-minimal .inv-table th { background: none; color: #5c6b66; border-bottom: 1px solid #1a1f1d; }
.inv-minimal .inv-totals .grand td { background: none; color: var(--acc); border-top: 1px solid #1a1f1d; }
/* Étiquette */
.lbl { --acc: #0B6E4F; width: 100mm; min-height: 150mm; margin: 0 auto; background: #fff; color: #111; border: 2px solid #111; padding: 5mm; box-sizing: border-box; font: 10pt/1.35 'Plus Jakarta Sans', system-ui, sans-serif; display: flex; flex-direction: column; gap: 4mm; box-shadow: 0 10px 40px rgb(0 0 0 / .12); }
.lbl header { display: flex; justify-content: space-between; align-items: center; background: var(--acc); color: #fff; margin: -5mm -5mm 0; padding: 3mm 5mm; font-weight: 800; }
.lbl-type { font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; }
.lbl-ref { font: 800 20pt ui-monospace, Menlo, monospace; text-align: center; letter-spacing: .04em; border: 2px dashed #111; padding: 2mm; }
.lbl-route { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 3mm; text-align: center; }
.lbl-route strong { display: block; font-size: 15pt; line-height: 1.1; } .lbl-route span { font-size: 18pt; font-weight: 800; }
.lbl small { display: block; font-size: 7pt; text-transform: uppercase; letter-spacing: .1em; color: #555; margin-top: 1.5mm; }
.lbl-mid { display: grid; grid-template-columns: 40mm 1fr; gap: 4mm; align-items: start; }
.lbl-qr svg { width: 40mm; height: 40mm; display: block; }
.lbl-info strong { display: block; font-size: 11pt; } .lbl-info span { display: block; }
.lbl footer { margin-top: auto; font-size: 8pt; border-top: 1px solid #111; padding-top: 2mm; }
@media print {
  .no-print { display: none !important; }
  body { background: #fff !important; padding: 0 !important; }
  .inv, .lbl { box-shadow: none; margin: 0; }
  .inv, .lbl, .inv * , .lbl * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
