(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

  const TYPES = {
    flea: { label: 'Floh-/Trödelmarkt', icon: '🧺', color: '#f6c85f' },
    harvest: { label: 'Ernte-/Hoffest', icon: '🎃', color: '#e99043' },
    festival: { label: 'Dorf-/Stadtfest', icon: '🎉', color: '#7f8cff' },
    christmas: { label: 'Weihnachtsmarkt', icon: '🎄', color: '#55c28d' },
    market: { label: 'Markt', icon: '🛍️', color: '#d97adf' },
    other: { label: 'Veranstaltung', icon: '🎪', color: '#73b8ef' }
  };

  const S = { events: [], filtered: [], preset: 'all', loc: null, map: null, layer: null, fitted: false };

  function parseDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  function iso(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function addDays(date, amount) {
    const d = new Date(date);
    d.setDate(d.getDate() + amount);
    return d;
  }

  function classify(event) {
    const text = norm([event.title, event.notes, event.scheduleText, event.sourceType].join(' '));
    if (/weihnacht|advent/.test(text)) return 'christmas';
    if (/floh|trodel|trödel|antik|sammler/.test(text)) return 'flea';
    if (/ernte|hoffest|kurbis|bauern|landpartie|kartoffel|apfel/.test(text)) return 'harvest';
    if (/dorf|stadtfest|straßenfest|strassenfest|volksfest|festival|hafenfest|fest/.test(text)) return 'festival';
    if (/markt|handwerk|basar/.test(text)) return 'market';
    return 'other';
  }

  function storageKey(event) {
    const base = event.groupId || [event.title, event.address, event.zip, event.place].join('|');
    return `eventmark:${norm(base).slice(0,220)}`;
  }

  function marks(event) {
    try { return JSON.parse(localStorage.getItem(storageKey(event)) || '{}'); }
    catch { return {}; }
  }

  function saveMarks(event, value) {
    localStorage.setItem(storageKey(event), JSON.stringify({
      visited: !!value.visited,
      favorite: !!value.favorite,
      groupId: event.groupId || '',
      title: event.title,
      address: event.address,
      zip: event.zip,
      place: event.place,
      updatedAt: new Date().toISOString()
    }));
  }

  function allMarks() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('eventmark:')) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key));
        if (value.visited || value.favorite) out.push(value);
      } catch {}
    }
    return out.sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function distanceKm(a, b) {
    const rad = x => x * Math.PI / 180;
    const R = 6371;
    const dLat = rad(b[0] - a[0]);
    const dLon = rad(b[1] - a[1]);
    const q = Math.sin(dLat/2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
  }

  function eventDistance(event) {
    return S.loc && Number.isFinite(event.lat) && Number.isFinite(event.lon) ? distanceKm(S.loc, [event.lat, event.lon]) : null;
  }

  function selectedRange() {
    if ($('date').value) {
      const d = new Date(`${$('date').value}T00:00:00`);
      return [d, d];
    }
    const now = today();
    if (S.preset === 'today') return [now, now];
    if (S.preset === 'tomorrow') return [addDays(now,1), addDays(now,1)];
    if (S.preset === 'weekend' || S.preset === 'nextWeekend') {
      let offset = (6 - now.getDay() + 7) % 7;
      if (S.preset === 'nextWeekend') offset += 7;
      const sat = addDays(now, offset);
      return [sat, addDays(sat, 1)];
    }
    return null;
  }

  function isUpcoming(event) {
    const from = parseDate(event.from);
    const to = parseDate(event.to) || from;
    if (!from && !to) return true;
    return (to || from) >= today();
  }

  function occursInRange(event, range) {
    if (!range) return isUpcoming(event);
    const from = parseDate(event.from);
    const to = parseDate(event.to) || from;
    if (!from) return false;
    return to >= range[0] && from <= range[1];
  }

  function formatDate(event) {
    const from = parseDate(event.from);
    const to = parseDate(event.to);
    if (!from) return event.scheduleText || 'regelmäßig';
    const opts = { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' };
    if (to && iso(to) !== iso(from)) return `${from.toLocaleDateString('de-DE', opts)} – ${to.toLocaleDateString('de-DE', opts)}`;
    return from.toLocaleDateString('de-DE', opts);
  }

  function normalizeEvent(event, index) {
    const lat = Number(event.lat);
    const lon = Number(event.lon ?? event.lng);
    const normalized = {
      ...event,
      id: String(event.id || `event-${index}`),
      title: String(event.title || event.bezeichnung || 'Veranstaltung'),
      address: String(event.address || event.strasse || ''),
      zip: String(event.zip || event.plz || ''),
      place: String(event.place || event.ort || event.district || ''),
      from: String(event.from || event.von || ''),
      to: String(event.to || event.bis || ''),
      timeText: String(event.timeText || event.zeiten || event.zeit || ''),
      notes: String(event.notes || event.bemerkungen || ''),
      sourceLabel: String(event.sourceLabel || 'Quelle'),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null
    };
    normalized.type = classify(normalized);
    return normalized;
  }

  function dedupe(events) {
    const seen = new Set();
    return events.filter(event => {
      const key = norm([event.title, event.address, event.zip, event.place, event.from].join('|'));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function applyFilter() {
    const query = norm($('search').value);
    const range = selectedRange();
    const radius = Number($('radius').value || 999);

    S.filtered = S.events.filter(event => {
      const m = marks(event);
      if (!occursInRange(event, range)) return false;
      if (query && !norm([event.title, event.place, event.address, event.notes, event.sourceLabel].join(' ')).includes(query)) return false;
      const dist = eventDistance(event);
      if (S.loc && radius < 999 && dist != null && dist > radius) return false;
      if ($('favorites').checked && !m.favorite) return false;
      if ($('visited').checked && !m.visited) return false;
      return true;
    });

    const sort = $('sort').value;
    S.filtered.sort((a,b) => {
      if (sort === 'distance') return (eventDistance(a) ?? 1e9) - (eventDistance(b) ?? 1e9);
      return (parseDate(a.from)?.getTime() ?? 9e15) - (parseDate(b.from)?.getTime() ?? 9e15);
    });
    render();
  }

  function createCard(event) {
    const type = TYPES[event.type] || TYPES.other;
    const m = marks(event);
    const dist = eventDistance(event);
    const article = document.createElement('article');
    article.className = 'event-card';
    article.innerHTML = `<div class="event-icon">${type.icon}</div><div class="event-main"><div class="event-title">${esc(event.title)}</div><div class="event-meta"><b>${esc(formatDate(event))}</b>${event.timeText ? ` · ${esc(event.timeText)}` : ''}</div><div class="event-meta">📍 ${esc([event.address,event.zip,event.place].filter(Boolean).join(', ') || 'Ort siehe Quelle')}</div><div class="badges"><span class="badge">${esc(type.label)}</span>${event.groupId ? '<span class="badge">wiederkehrend</span>' : ''}${m.visited ? '<span class="badge good">✓ besucht</span>' : ''}${m.favorite ? '<span class="badge good">★ Favorit</span>' : ''}</div></div><div class="distance">${dist == null ? '' : `${dist.toFixed(1)} km`}</div>`;
    article.addEventListener('click', () => openDetail(event));
    return article;
  }

  function render() {
    const host = $('events');
    host.innerHTML = '';
    S.filtered.forEach(event => host.appendChild(createCard(event)));
    if (!S.filtered.length) host.innerHTML = '<div class="empty">Keine Termine für diesen Filter. „Alle kommenden“ zeigt wieder alles.</div>';
    $('count').textContent = S.filtered.length;
    const now = today();
    $('todayCount').textContent = S.events.filter(event => occursInRange(event,[now,now])).length;
    $('visitedCount').textContent = allMarks().filter(item => item.visited).length;
    $('subline').textContent = `${S.filtered.length} Termine · alle Arten von Märkten und Festen`;
    renderMap();
  }

  function groupedMarkers() {
    const groups = new Map();
    for (const event of S.filtered) {
      if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;
      const key = event.groupId || `${event.lat.toFixed(4)}|${event.lon.toFixed(4)}|${norm(event.title)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    return groups;
  }

  function renderMap() {
    if (!S.map || !S.layer || typeof L === 'undefined') return;
    S.layer.clearLayers();
    const bounds = [];

    for (const events of groupedMarkers().values()) {
      events.sort((a,b) => (parseDate(a.from)?.getTime() ?? 9e15) - (parseDate(b.from)?.getTime() ?? 9e15));
      const event = events[0];
      const type = TYPES[event.type] || TYPES.other;
      const count = events.length;
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin" style="--cat:${type.color}"><span>${type.icon}</span>${count > 1 ? `<b>${count}</b>` : ''}</div>`,
        iconSize: [34,38],
        iconAnchor: [17,36]
      });
      const marker = L.marker([event.lat,event.lon], { icon }).addTo(S.layer);
      marker.bindTooltip(`${event.title} · ${formatDate(event)}${count > 1 ? ` · ${count} Termine` : ''}`);
      marker.on('click', () => openDetail(event));
      bounds.push([event.lat,event.lon]);
    }

    if (!S.fitted && bounds.length) {
      S.fitted = true;
      if (bounds.length === 1) S.map.setView(bounds[0],11,{animate:false});
      else S.map.fitBounds(bounds,{padding:[25,25],maxZoom:10,animate:false});
    }
  }

  function openDrawer(id, backdrop) {
    $(id).classList.add('open');
    $(backdrop).classList.remove('hidden');
  }

  function closeDrawer(id, backdrop) {
    $(id).classList.remove('open');
    $(backdrop).classList.add('hidden');
  }

  function openDetail(event) {
    const type = TYPES[event.type] || TYPES.other;
    const m = marks(event);
    const location = [event.address,event.zip,event.place].filter(Boolean).join(', ');
    const routeUrl = Number.isFinite(event.lat) && Number.isFinite(event.lon) ? `https://www.openstreetmap.org/directions?to=${encodeURIComponent(`${event.lat},${event.lon}`)}` : '';

    $('detail').innerHTML = `<div class="detail-kicker">${type.icon} ${esc(type.label)}</div><h2>${esc(event.title)}</h2><dl class="detail-grid"><dt>Datum</dt><dd>${esc(formatDate(event))}</dd><dt>Uhrzeit</dt><dd>${esc(event.timeText || 'siehe Quelle')}</dd><dt>Ort</dt><dd>${esc(location || 'siehe Quelle')}</dd><dt>Quelle</dt><dd>${esc(event.sourceLabel || 'Quelle')}</dd></dl>${event.notes ? `<p class="detail-note">${esc(event.notes)}</p>` : ''}<div class="actions">${event.url ? `<a href="${esc(event.url)}" target="_blank" rel="noopener">Quelle öffnen</a>` : '<span></span>'}${routeUrl ? `<a href="${routeUrl}" target="_blank" rel="noopener">Route öffnen</a>` : ''}</div><section class="personal"><h3>Merken</h3><label class="check"><input id="dVisited" type="checkbox" ${m.visited ? 'checked' : ''}> Ich war hier</label><label class="check"><input id="dFavorite" type="checkbox" ${m.favorite ? 'checked' : ''}> Favorit / wieder hin</label><button id="saveMarks" class="save" type="button">Speichern</button></section>`;

    $('saveMarks').addEventListener('click', () => {
      saveMarks(event,{visited:$('dVisited').checked,favorite:$('dFavorite').checked});
      applyFilter();
      openDetail(event);
    });
    openDrawer('drawer','backdrop');
  }

  function showHistory() {
    const host = $('historyList');
    host.innerHTML = '';
    for (const item of allMarks()) {
      const card = document.createElement('article');
      card.className = 'event-card history-card';
      card.innerHTML = `<div class="event-main"><div class="event-title">${esc(item.title || 'Veranstaltung')}</div><div class="event-meta">${esc([item.address,item.zip,item.place].filter(Boolean).join(', '))}</div><div class="badges">${item.visited ? '<span class="badge good">✓ besucht</span>' : ''}${item.favorite ? '<span class="badge good">★ Favorit</span>' : ''}</div></div>`;
      host.appendChild(card);
    }
    if (!host.children.length) host.innerHTML = '<div class="empty">Noch keine Besuche oder Favoriten gespeichert.</div>';
    openDrawer('history','historyBackdrop');
  }

  function initMap() {
    if (typeof L === 'undefined') {
      $('map').innerHTML = '<div class="map-error">Karte konnte nicht geladen werden. Die Terminliste funktioniert trotzdem.</div>';
      return;
    }
    S.map = L.map('map',{zoomControl:true}).setView([52.43,13.05],8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende'}).addTo(S.map);
    S.layer = L.layerGroup().addTo(S.map);
  }

  function setup() {
    document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
      S.preset = button.dataset.preset;
      $('date').value = '';
      document.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('active',x === button));
      applyFilter();
    }));

    $('search').addEventListener('input',applyFilter);
    $('date').addEventListener('change',() => {
      if ($('date').value) document.querySelectorAll('[data-preset]').forEach(x => x.classList.remove('active'));
      applyFilter();
    });
    ['favorites','visited','radius','sort'].forEach(id => $(id).addEventListener('change',applyFilter));

    $('locate').addEventListener('click',() => {
      if (!navigator.geolocation) {
        $('locationState').textContent = 'Standort wird nicht unterstützt.';
        return;
      }
      $('locationState').textContent = 'Standort wird ermittelt …';
      navigator.geolocation.getCurrentPosition(position => {
        S.loc = [position.coords.latitude,position.coords.longitude];
        $('radius').disabled = false;
        $('locationState').textContent = 'Standort aktiv';
        if (S.map) S.map.setView(S.loc,10,{animate:false});
        applyFilter();
      },() => {
        $('locationState').textContent = 'Standort nicht freigegeben.';
      },{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
    });

    $('historyBtn').addEventListener('click',showHistory);
    $('closeDrawer').addEventListener('click',() => closeDrawer('drawer','backdrop'));
    $('backdrop').addEventListener('click',() => closeDrawer('drawer','backdrop'));
    $('closeHistory').addEventListener('click',() => closeDrawer('history','historyBackdrop'));
    $('historyBackdrop').addEventListener('click',() => closeDrawer('history','historyBackdrop'));
  }

  async function fetchJson(url) {
    const response = await fetch(url,{cache:'no-store'});
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error(`${url}: keine JSON-Antwort`);
    return response.json();
  }

  async function load() {
    $('status').textContent = 'Lade aktuelle Termine …';
    const [apiResult,seedResult] = await Promise.allSettled([
      fetchJson(`/api/events?v=6&t=${Date.now()}`),
      fetchJson('/data/seed-events.json?v=6')
    ]);

    const raw = [];
    let liveCount = 0;
    let seedCount = 0;
    if (apiResult.status === 'fulfilled' && Array.isArray(apiResult.value.events)) {
      raw.push(...apiResult.value.events);
      liveCount = apiResult.value.events.length;
    }
    if (seedResult.status === 'fulfilled' && Array.isArray(seedResult.value.events)) {
      raw.push(...seedResult.value.events);
      seedCount = seedResult.value.events.length;
    }

    S.events = dedupe(raw.map(normalizeEvent));
    if (!S.events.length) {
      $('status').textContent = 'Keine Daten geladen – Cloudflare/API prüfen.';
      $('events').innerHTML = '<div class="empty">Es konnten keine Termine geladen werden.</div>';
      return;
    }

    $('status').textContent = `${S.events.length} Termine geladen · ${liveCount} live + ${seedCount} verifiziert · täglich aktualisiert`;
    applyFilter();
  }

  initMap();
  setup();
  load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=6').catch(() => {});
})();
