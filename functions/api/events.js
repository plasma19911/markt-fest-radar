const DAY = 86400;
const BERLIN_HEADERS = {
  'Accept': 'application/json, application/geo+json;q=0.9, text/html;q=0.7',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
  'User-Agent': 'Markt-Fest-Radar/1.1 (+https://github.com/plasma19911/markt-fest-radar)'
};

const SOURCES = [
  {
    key: 'weekly',
    label: 'Berlin Open Data – Berliner und Brandenburger Wochen- und Trödelmärkte',
    base: 'https://www.berlin.de/sen/web/service/maerkte-feste/wochen-troedelmaerkte/index.php',
    fallbackGeoJson: 'https://raw.githubusercontent.com/wo-ist-markt/wo-ist-markt.github.io/master/preprocessing/berlin/raw/markets-berlin.json'
  },
  {
    key: 'festivals',
    label: 'Berlin Open Data – Berliner und Brandenburger Straßen- und Volksfeste',
    base: 'https://www.berlin.de/sen/web/service/maerkte-feste/strassen-volksfeste/index.php'
  },
  {
    key: 'christmas',
    label: 'Berlin Open Data – Berliner und Brandenburger Weihnachtsmärkte',
    base: 'https://www.berlin.de/sen/web/service/maerkte-feste/weihnachtsmaerkte/index.php'
  }
];

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=120, s-maxage=900, stale-while-revalidate=3600',
  'Access-Control-Allow-Origin': '*'
};

function first(obj, keys, fallback = '') {
  for (const key of keys) {
    if (obj && obj[key] != null && String(obj[key]).trim() !== '') return obj[key];
  }
  return fallback;
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function validPoint(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 47 && lat <= 56 && lon >= 5 && lon <= 16;
}

function detailIdFrom(feature, data, index) {
  const direct = first(data, ['id', 'ID', 'nr', 'nummer'], '');
  if (direct !== '') return String(direct);
  const meta = feature?.properties || {};
  const raw = String(first(meta, ['id', 'href'], '') || '');
  const match = raw.match(/\/detail\/(\d+)/);
  return match ? match[1] : String(index);
}

function pointFrom(feature, data) {
  const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
  if (Array.isArray(coords)) {
    const lon = num(coords[0]);
    const lat = num(coords[1]);
    if (validPoint(lat, lon)) return { lat, lon };
  }
  const lat = num(first(data, ['latitude', 'lat', 'breitengrad', 'geo_lat', 'y'], null));
  const lon = num(first(data, ['longitude', 'lng', 'lon', 'laengengrad', 'längengrad', 'geo_lon', 'x'], null));
  return validPoint(lat, lon) ? { lat, lon } : { lat: null, lon: null };
}

function exactDateFromSchedule(text) {
  const matches = String(text || '').match(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/g);
  return matches && matches.length === 1 ? matches[0] : '';
}

function normalize(feature, source, index) {
  const meta = feature?.properties || {};
  const data = meta.data && typeof meta.data === 'object' ? meta.data : (feature?.properties || feature || {});
  const id = detailIdFrom(feature, data, index);
  const point = pointFrom(feature, data);

  const weeklyDays = String(first(data, ['tage', 'wochentage', 'days'], '') || '');
  const weeklyPeriod = String(first(data, ['zeitraum', 'periode', 'period'], '') || '');
  const weeklyTime = String(first(data, ['zeiten', 'zeit', 'uhrzeit', 'oeffnungszeiten', 'öffnungszeiten', 'time'], '') || '');
  const from = String(first(data, ['von', 'beginn', 'start', 'datum_von', 'start_date', 'date_from'], '') || '') || exactDateFromSchedule(weeklyDays);
  const to = String(first(data, ['bis', 'ende', 'end', 'datum_bis', 'end_date', 'date_to'], '') || '');

  return {
    id: `${source.key}-${id}`,
    detailId: id,
    sourceKey: source.key,
    sourceType: source.key,
    sourceLabel: source.label,
    title: String(first(data, ['bezeichnung', 'veranstaltungsname', 'name', 'titel', 'title', 'marktname'], meta.title || 'Unbenannte Veranstaltung')),
    address: String(first(data, ['strasse', 'straße', 'adresse', 'address'], '') || ''),
    zip: String(first(data, ['plz', 'postleitzahl', 'zip'], '') || ''),
    district: String(first(data, ['bezirk', 'bezirk_ort', 'district', 'region', 'landkreis'], '') || ''),
    place: String(first(data, ['ort', 'stadt', 'gemeinde', 'place'], '') || ''),
    from,
    to,
    scheduleText: [weeklyDays, weeklyPeriod].filter(Boolean).join(' · '),
    timeText: String(first(data, ['oeffnungszeiten', 'öffnungszeiten', 'zeiten', 'zeit', 'uhrzeit', 'time'], weeklyTime) || ''),
    organizer: String(first(data, ['veranstalter', 'betreiber', 'anbieter', 'organizer'], '') || ''),
    url: String(first(data, ['internet', 'www', 'website', 'url', 'link'], '') || ''),
    notes: String(first(data, ['bemerkungen', 'beschreibung', 'description', 'hinweis'], '') || ''),
    lat: point.lat,
    lon: point.lon
  };
}

async function fetchCached(url, accept = BERLIN_HEADERS.Accept) {
  return fetch(url, {
    headers: { ...BERLIN_HEADERS, Accept: accept },
    redirect: 'follow',
    cf: { cacheTtl: DAY, cacheEverything: true }
  });
}

async function tryGeoJson(source, url) {
  const response = await fetchCached(url, 'application/geo+json, application/json;q=0.9');
  if (!response.ok) throw new Error(`GeoJSON HTTP ${response.status}`);
  const data = await response.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  if (!features.length) throw new Error('GeoJSON ohne Einträge');
  return features.map((feature, i) => normalize(feature, source, i));
}

async function tryJson(source) {
  const response = await fetchCached(`${source.base}/index/all.json?q=`, 'application/json');
  if (!response.ok) throw new Error(`JSON HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data?.index) ? data.index : [];
  if (!rows.length) throw new Error(`JSON ohne Einträge${data?.messages?.success === false ? ': API meldet Fehler' : ''}`);
  return rows.map((row, i) => normalize(row, source, i));
}

async function fetchSource(source) {
  const attempts = [];
  try {
    const events = await tryGeoJson(source, `${source.base}/index/all.geojson?q=`);
    return { events, method: 'geojson', attempts };
  } catch (error) {
    attempts.push(String(error?.message || error));
  }

  try {
    const events = await tryJson(source);
    return { events, method: 'json', attempts };
  } catch (error) {
    attempts.push(String(error?.message || error));
  }

  if (source.fallbackGeoJson) {
    try {
      const events = await tryGeoJson(source, source.fallbackGeoJson);
      return { events, method: 'github-fallback', attempts };
    } catch (error) {
      attempts.push(`Fallback: ${String(error?.message || error)}`);
    }
  }

  return { events: [], method: 'failed', attempts };
}

function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHavelblick() {
  const url = 'https://spd-ohv.de/';
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'text/html', 'User-Agent': BERLIN_HEADERS['User-Agent'] },
      cf: { cacheTtl: DAY, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const pdf = [...html.matchAll(/href=["']([^"']*havelblick[^"']*\.pdf[^"']*)["']/gi)][0]?.[1]
      || [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)][0]?.[1]
      || '';
    const latestIssueUrl = pdf ? new URL(pdf, url).href : '';
    const text = cleanHtml(html);
    const terms = /flohmarkt|trödelmarkt|troedelmarkt|erntefest|hoffest|dorffest|stadtfest|weihnachtsmarkt|handwerkermarkt|bauernmarkt|volksfest/ig;
    const mentions = [];
    let match;
    while ((match = terms.exec(text)) && mentions.length < 12) {
      const snippet = text.slice(Math.max(0, match.index - 120), Math.min(text.length, match.index + 260)).trim();
      if (!mentions.some(item => item.snippet === snippet)) mentions.push({ snippet, url });
    }
    return { label: 'Havelblick – SPD Oberhavel', homepage: url, latestIssueUrl, mentions };
  } catch (error) {
    return { label: 'Havelblick – SPD Oberhavel', homepage: url, latestIssueUrl: '', mentions: [], error: String(error?.message || error) };
  }
}

function dedupe(events) {
  const seen = new Set();
  return events.filter(event => {
    const key = [event.sourceKey, event.title, event.address, event.from, event.scheduleText].join('|').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function onRequestGet() {
  const [sourceResults, havelblick] = await Promise.all([
    Promise.all(SOURCES.map(fetchSource)),
    fetchHavelblick()
  ]);

  const events = dedupe(sourceResults.flatMap(result => result.events));
  const diagnostics = SOURCES.map((source, i) => ({
    key: source.key,
    label: source.label,
    count: sourceResults[i].events.length,
    method: sourceResults[i].method,
    attempts: sourceResults[i].attempts
  }));
  const errors = diagnostics
    .filter(item => item.method === 'failed')
    .map(item => `${item.key}: ${item.attempts.join(' | ')}`);

  const payload = {
    updatedAt: new Date().toISOString(),
    refreshIntervalHours: 24,
    events,
    sources: diagnostics,
    havelblick,
    partial: errors.length > 0,
    errors
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: RESPONSE_HEADERS
  });
}
