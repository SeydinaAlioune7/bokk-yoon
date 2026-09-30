// Page d'impression : facture / avoir, étiquette colis, relevé chauffeur.
import { api, setSpace } from './api.js';
import { renderInvoice, renderLabel, renderStatement, PRINT_CSS, esc } from './invoice.js';

const p = Object.fromEntries(new URLSearchParams(location.search));
const space = ['client', 'driver', 'admin'].includes(p.s) ? p.s : 'client';
setSpace(space);
document.getElementById('print-css').textContent = PRINT_CSS;
const doc = document.getElementById('doc');
document.getElementById('print').onclick = () => window.print();

(async () => {
  try {
    if (p.doc === 'facture') {
      const inv = await api('GET', '/invoices/' + encodeURIComponent(p.id));
      document.title = `${inv.kind === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'} ${inv.number}`;
      doc.innerHTML = await renderInvoice(inv, inv.company, { verifyUrl: `${location.origin} · ${inv.number}` });
    } else if (p.doc === 'etiquette') {
      const b = await api('GET', '/client/bookings/' + encodeURIComponent(p.id));
      if (!b.package || !b.trackToken) throw new Error('L\'étiquette est disponible une fois l\'envoi payé.');
      const company = await api('GET', '/company');
      document.getElementById('page-size').textContent = '@page { size: 100mm 150mm; margin: 0; }';
      document.title = `Étiquette ${b.package.ref}`;
      const trackUrl = new URL(`../app/#/suivi/${b.trackToken}`, location.href).href;
      doc.innerHTML = await renderLabel({ ref: b.package.ref, bookingRef: b.ref, from: b.from, to: b.to, recipientName: b.package.recipientName, recipientPhone: b.package.recipientPhone,
        typeLabel: b.typeLabel?.label, idCheck: !!b.typeLabel?.id_check, fragile: b.package.fragile, weight: b.package.type === 'COLIS' ? String(b.package.weightKg).replace('.', ',') + ' kg' : '',
        departure: new Date(b.trip.departureAt).toLocaleString('fr-FR', { timeZone: 'Africa/Dakar', dateStyle: 'medium', timeStyle: 'short' }), trackUrl }, company);
      document.getElementById('hint').textContent = 'Format 10 × 15 cm (imprimante d\'étiquettes ou feuille A4).';
    } else if (p.doc === 'releve') {
      const s = await api('GET', '/driver/statement?month=' + encodeURIComponent(p.month || ''));
      document.title = `Relevé ${s.month}`;
      doc.innerHTML = renderStatement(s);
    } else throw new Error('Document inconnu.');
  } catch (e) {
    doc.innerHTML = `<div class="empty card" style="max-width:520px;margin:40px auto"><h2>Document indisponible</h2><p>${esc(e.message)}</p><p class="small muted">Connectez-vous d'abord à votre espace, puis rouvrez le document.</p></div>`;
  }
})();
