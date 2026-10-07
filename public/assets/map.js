// Carte Démando : Leaflet (fourni localement) + fond OpenStreetMap + découpage administratif officiel du Sénégal
// (régions, départements, arrondissements — Gouvernement du Sénégal / OCHA, CC BY 3.0 IGO).
import { CITIES } from './core.js';

const base = new URL('./', import.meta.url);
let leafletPromise = null;
function loadLeaflet() {
  leafletPromise ??= new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('vendor/leaflet/leaflet.css', base).href; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = new URL('vendor/leaflet/leaflet.js', base).href;
    s.onload = () => resolve(window.L); s.onerror = () => reject(new Error('Carte indisponible'));
    document.head.appendChild(s);
  });
  return leafletPromise;
}
const geoCache = {};
export function loadGeo(level) {
  geoCache[level] ??= fetch(new URL(`geo/${level}.json`, base)).then((r) => { if (!r.ok) throw new Error('geo'); return r.json(); });
  return geoCache[level];
}

// Une teinte douce par région, choisie pour que deux régions voisines ne se ressemblent pas.
export const REGION_COLORS = {
  Dakar: '#E8A93B', Thiès: '#6FB39A', Diourbel: '#E3BE8F', Louga: '#BFD37E', 'Saint-Louis': '#86B2DB', Matam: '#E39B7F', Tambacounda: '#9CCB86',
  Kédougou: '#D38FAB', Kolda: '#E6C45F', Sédhiou: '#8FC4C0', Ziguinchor: '#E59AA2', Fatick: '#97AEE0', Kaolack: '#E29E68', Kaffrine: '#B3A2D8',
};
const SEQ = ['#E3F1EB', '#B9DECB', '#86C7A8', '#4FA884', '#1F8A63', '#0B6E4F'];
export const seqColor = (v, max) => (max > 0 && v > 0 ? SEQ[Math.min(SEQ.length - 1, 1 + Math.floor((v / max) * (SEQ.length - 2) + 0.0001))] : SEQ[0]);

const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
const pin = (L, kind, label) => L.divIcon({ className: 'by-pin-wrap', html: `<span class="by-pin by-${kind}">${label || ''}</span>`, iconSize: null, iconAnchor: [14, 14] });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * options : height, cities ('major'|'all'|'none'), interactive,
 *   admin : 'regions' | 'departements' | 'arrondissements' | false (niveau affiché au départ),
 *   switcher : true pour proposer les trois niveaux, values : { Région: nombre } pour colorer selon l'activité,
 *   valueLabel : texte de l'infobulle (ex. « réservations »).
 */
export async function createMap(el, { height = 320, cities = 'major', interactive = true, admin = 'regions', switcher = false, values = null, valueLabel = '' } = {}) {
  el.classList.add('by-map'); el.style.height = typeof height === 'number' ? height + 'px' : height;
  let L;
  try { L = await loadLeaflet(); } catch { el.innerHTML = '<div class="by-map-off">Carte indisponible sur cette connexion.</div>'; return null; }
  const map = L.map(el, { zoomControl: interactive, dragging: interactive, scrollWheelZoom: false, touchZoom: interactive, doubleClickZoom: interactive, attributionControl: true, zoomSnap: 0.25 });
  map.fitBounds([[12.25, -17.6], [16.75, -11.3]]);
  map.attributionControl.addAttribution('Limites : Gouv. du Sénégal / OCHA');
  let loaded = 0, errors = 0;
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap', className: 'by-tiles', opacity: 0.55 })
    .on('tileload', () => { loaded++; el.classList.remove('by-map-notiles'); })
    .on('tileerror', () => { errors++; if (!loaded && errors > 2) el.classList.add('by-map-notiles'); })
    .addTo(map);
  const primary = css('--primary', '#0B6E4F');
  const adminLayer = L.layerGroup().addTo(map), labelLayer = L.layerGroup().addTo(map);
  const cityLayer = L.layerGroup().addTo(map), layer = L.layerGroup().addTo(map);
  let level = admin, currentValues = values;
  const max = () => Math.max(0, ...Object.values(currentValues || {}));

  async function drawAdmin() {
    adminLayer.clearLayers(); labelLayer.clearLayers();
    if (!level) return;
    let regions;
    try { regions = await loadGeo('regions'); } catch { return; }
    const fillFor = (name) => (currentValues ? seqColor(currentValues[name] || 0, max()) : REGION_COLORS[name] || '#ccc');
    // Régions toujours dessinées (couleur), niveaux fins en traits par-dessus
    L.geoJSON(regions, {
      style: (f) => ({ color: '#ffffff', weight: 1.6, fillColor: fillFor(f.properties.name), fillOpacity: level === 'regions' ? 0.72 : 0.5 }),
      onEachFeature: (f, lyr) => {
        const n = f.properties.name, v = currentValues ? currentValues[n] || 0 : null;
        lyr.bindTooltip(`<strong>Région de ${esc(n)}</strong>${v !== null ? `<br>${v.toLocaleString('fr-FR')} ${esc(valueLabel)}` : ''}`, { sticky: true, className: 'by-tip' });
        lyr.on('mouseover', () => lyr.setStyle({ weight: 3, fillOpacity: 0.85 })); lyr.on('mouseout', () => lyr.setStyle({ weight: 1.6, fillOpacity: level === 'regions' ? 0.72 : 0.5 }));
      },
    }).addTo(adminLayer);
    if (level !== 'regions') {
      try {
        const g = await loadGeo(level);
        L.geoJSON(g, {
          style: () => ({ color: level === 'departements' ? '#13201C' : '#3b4a45', weight: level === 'departements' ? 1 : 0.6, opacity: 0.55, fill: true, fillOpacity: 0, dashArray: level === 'arrondissements' ? '2 3' : null }),
          onEachFeature: (f, lyr) => {
            const p = f.properties;
            lyr.bindTooltip(level === 'departements' ? `<strong>Département de ${esc(p.name)}</strong><br>Région de ${esc(p.region)}` : `<strong>Arrondissement de ${esc(p.name)}</strong><br>Département de ${esc(p.departement)} · ${esc(p.region)}`, { sticky: true, className: 'by-tip' });
            lyr.on('mouseover', () => lyr.setStyle({ weight: 2.4, opacity: 1, fillOpacity: 0.15, fillColor: '#fff' })); lyr.on('mouseout', () => lyr.setStyle({ weight: level === 'departements' ? 1 : 0.6, opacity: 0.55, fillOpacity: 0 }));
          },
        }).addTo(adminLayer);
      } catch { /* niveau indisponible */ }
    }
    const labels = level === 'departements' ? (await loadGeo('departements').catch(() => null)) : regions;
    if (labels && (level !== 'arrondissements')) {
      for (const f of labels.features) L.marker([f.properties.ly, f.properties.lx], { icon: L.divIcon({ className: 'by-label-wrap', html: `<span class="by-label ${level === 'departements' ? 'sm' : ''}">${esc(f.properties.name)}</span>`, iconSize: null }), interactive: false, keyboard: false }).addTo(labelLayer);
    }
  }
  const refreshLabels = () => { const z = map.getZoom(); el.classList.toggle('by-z-low', z < 7); };
  map.on('zoomend', refreshLabels); refreshLabels();
  await drawAdmin();

  const list = cities === 'none' ? [] : cities === 'all' ? CITIES : CITIES.filter((c) => ['Dakar', 'Thiès', 'Saint-Louis', 'Touba', 'Kaolack', 'Ziguinchor', 'Tambacounda', 'Louga', 'Mbour', 'Kolda', 'Matam', 'Kédougou', 'Fatick', 'Diourbel', 'Kaffrine', 'Sédhiou'].includes(c.name));
  for (const c of list) L.circleMarker([c.lat, c.lng], { radius: 3.5, color: '#13201C', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindTooltip(`${esc(c.name)} · ${esc(c.departement)}`, { direction: 'top', className: 'by-tip' }).addTo(cityLayer);

  if (switcher) {
    const Ctl = L.Control.extend({
      onAdd() {
        const d = L.DomUtil.create('div', 'by-switch');
        d.innerHTML = [['regions', 'Régions'], ['departements', 'Départements'], ['arrondissements', 'Arrondissements']].map(([k, l]) => `<button type="button" data-l="${k}" class="${k === level ? 'on' : ''}">${l}</button>`).join('');
        L.DomEvent.disableClickPropagation(d);
        d.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => { level = b.dataset.l; d.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); await drawAdmin(); }));
        return d;
      },
    });
    new Ctl({ position: 'topright' }).addTo(map);
  }
  const api = {
    map, L, layer, tiles, legend: null,
    route(a, b, { color = primary, dashed = true, weight = 3 } = {}) { return L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color, weight, opacity: 0.9, dashArray: dashed ? '8 8' : null }).addTo(layer); },
    marker(p, kind = 'city', label = '', popup = '') { const m = L.marker([p.lat, p.lng], { icon: pin(L, kind, label), keyboard: false }).addTo(layer); if (popup) m.bindPopup(popup); return m; },
    fit(points, pad = 40) { if (points.length) map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [pad, pad], maxZoom: 11, animate: false }); },
    clear() { layer.clearLayers(); },
    async setValues(v, label = valueLabel) { currentValues = v; valueLabel = label; await drawAdmin(); api.drawLegend(); },
    drawLegend() { if (!api.legend) return; if (!currentValues) { api.legend.hidden = true; return; } api.legend.hidden = false; const m = max();
      api.legend.innerHTML = `<strong>${esc(valueLabel)}</strong><div class="by-legend-scale">${SEQ.map((c) => `<span style="background:${c}"></span>`).join('')}</div><div class="by-legend-ends"><span>0</span><span>${m.toLocaleString('fr-FR')}</span></div>`; },
    destroy() { map.remove(); },
  };
  if (values) {
    const Leg = L.Control.extend({ onAdd() { const d = L.DomUtil.create('div', 'by-legend'); api.legend = d; return d; } });
    new Leg({ position: 'bottomleft' }).addTo(map);
  }
  api.drawLegend();
  setTimeout(() => { try { map.invalidateSize(); } catch { /* carte détruite */ } }, 60);
  return api;
}
