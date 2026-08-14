(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const fallbackSources = [
    {
      key: 'weekly',
      label: 'Berlin Open Data – Wochen- und Trödelmärkte',
      url: 'https://www.berlin.de/sen/web/service/maerkte-feste/wochen-troedelmaerkte/index.php/index/all.geojson?q=',
      backup: 'https://raw.githubusercontent.com/wo-ist-markt/wo-ist-markt.github.io/master/preprocessing/berlin/raw/markets-berlin.json'
    },
    {
      key: 'festivals',
      label: 'Berlin Open Data – Straßen- und Volksfeste',
      url: 'https://www.berlin.de/sen/web/service/maerkte-feste/strassen-volksfeste/index.php/index/all.geojson?q='
    },
    {
      key: 'christmas',
      label: 'Berlin Open Data – Weihnachtsmärkte',
      url: 'https://www.berlin.de/sen/web/service/maerkte-feste/weihnachtsmaerkte/index.php/index/all.geojson?q='
    }
  ];

  const first = (obj, keys, fallback = '') => {
    for (const key of keys) {
      if (obj && obj[key] != null && String(obj[key]).trim() !== '') return obj[key];
    }
    return fallback;
  };

  const number = value => {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  function normalizeFeature(feature, source, index) {
    const meta = feature?.properties || {};
    const data = meta.data && typeof meta.data === 'object' ? meta.data : meta;
    const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lon = number(coords[0] ?? first(data, ['longitude', 'lng', 'lon'], null));
    const lat = number(coords[1] ?? first(data, ['latitude', 'lat'], null));
    const rawId = String(first(meta, ['id', 'href'], index));
    const idMatch = rawId.match(/\/detail\/(\d+)/);
    const id = idMatch ? idMatch[1] : String(first(data, ['id'], index));
    const days = String(first(data, ['tage'], '') || '');
    const period = String(first(data, ['zeitraum'], '') || '');
    const exact = days.match(/^\s*(\d{1,2}\.\d{1,2}\.\d{4})\s*$/)?.[1] || '';

    return {
      id: `${source.key}-${id}`,
      sourceKey: source.key,
      sourceType: source.key,
      sourceLabel: source.label,
      title: String(first(data, ['bezeichnung', 'veranstaltungsname', 'name', 'titel'], meta.title || 'Veranstaltung')),
      address: String(first(data, ['strasse', 'straße', 'adresse'], '') || ''),
      zip: String(first(data, ['plz'], '') || ''),
      district: String(first(data, ['bezirk'], '') || ''),
      place: String(first(data, ['ort', 'stadt', 'gemeinde'], '') || ''),
      from: String(first(data, ['von', 'beginn', 'start'], exact) || ''),
      to: String(first(data, ['bis', 'ende', 'end'], '') || ''),
      scheduleText: [days, period].filter(Boolean).join(' · '),
      timeText: String(first(data, ['oeffnungszeiten', 'öffnungszeiten', 'zeiten', 'zeit'], '') || ''),
      organizer: String(first(data, ['veranstalter', 'betreiber'], '') || ''),
      url: String(first(data, ['internet', 'www', 'url'], '') || ''),
      notes: String(first(data, ['bemerkungen', 'beschreibung'], '') || ''),
      lat,
      lon
    };
  }

  async function fetchGeo(source, url) {
    const response = await nativeFetch(url, { cache: 'no-store', mode: 'cors' });
    if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status}`);
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    if (!features.length) throw new Error(`${source.key}: 0 Features`);
    return features.map((feature, index) => normalizeFeature(feature, source, index));
  }

  async function loadBrowserFallback() {
    const results = [];
    const diagnostics = [];
    for (const source of fallbackSources) {
      try {
        const events = await fetchGeo(source, source.url);
        results.push(...events);
        diagnostics.push({ key: source.key, count: events.length, method: 'browser-geojson' });
        continue;
      } catch (error) {
        if (!source.backup) {
          diagnostics.push({ key: source.key, count: 0, method: 'failed', error: String(error.message || error) });
          continue;
        }
      }
      try {
        const events = await fetchGeo(source, source.backup);
        results.push(...events);
        diagnostics.push({ key: source.key, count: events.length, method: 'github-browser-fallback' });
      } catch (error) {
        diagnostics.push({ key: source.key, count: 0, method: 'failed', error: String(error.message || error) });
      }
    }
    return { events: results, sources: diagnostics };
  }

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!/^\/api\/events(?:\?|$)/.test(url)) return nativeFetch(input, init);

    try {
      const response = await nativeFetch(input, init);
      const type = response.headers.get('content-type') || '';
      if (response.ok && type.includes('application/json')) {
        const clone = response.clone();
        const data = await clone.json();
        if (Array.isArray(data?.events) && data.events.length) return response;
      }
    } catch (error) {
      console.warn('Cloudflare API nicht verfügbar, nutze Browser-Fallback:', error);
    }

    const fallback = await loadBrowserFallback();
    return new Response(JSON.stringify({
      updatedAt: new Date().toISOString(),
      refreshIntervalHours: 24,
      events: fallback.events,
      sources: fallback.sources,
      partial: true,
      errors: ['Cloudflare-API-Fallback aktiv']
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  };

  window.addEventListener('load', () => {
    setTimeout(() => {
      const allButton = document.querySelector('[data-preset="all"]');
      if (allButton && !allButton.classList.contains('active')) allButton.click();
    }, 50);
  });
})();
