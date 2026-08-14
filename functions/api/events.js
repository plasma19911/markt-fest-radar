const DAY = 86400;

const SOURCES = [
  {
    key: 'weekly',
    label: 'Berlin Open Data – Berliner und Brandenburger Wochen- und Trödelmärkte',
    base: 'https://www.berlin.de/sen/web/service/maerkte-feste/wochen-troedelmaerkte/index.php'
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

const HEAD = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=3600',
  'Access-Control-Allow-Origin': '*'
};

function first(o, keys, fallback = '') {
  for (const key of keys) {
    if (o && o[key] != null && String(o[key]).trim() !== '') return o[key];
  }
  return fallback;
}

function number(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function coordsFromObject(o) {
  const lat = number(first(o, ['latitude', 'lat', 'breitengrad', 'geo_lat', 'y'], null));
  const lon = number(first(o, ['longitude', 'lon', 'lng', 'laengengrad', 'längengrad', 'geo_lon', 'x'], null));
  if (lat != null && lon != null && lat >= 47 && lat <= 56 && lon >= 5 && lon <= 16) return { lat, lon };
  return { lat: null, lon: null };
}

function normalize(item, source, index) {
  const p = item?.properties || item || {};
  const id = String(first(p, ['id', 'ID', 'nr', 'nummer'], index));
  const point = item?.geometry?.type === 'Point' && Array.isArray(item.geometry.coordinates)
    ? { lon: number(item.geometry.coordinates[0]), lat: number(item.geometry.coordinates[1]) }
    : coordsFromObject(p);

  return {
    id: `${source.key}-${id}`,
    detailId: id,
    sourceKey: source.key,
    sourceType: source.key,
    sourceLabel: source.label,
    title: String(first(p, ['bezeichnung', 'veranstaltungsname', 'name', 'titel', 'title', 'marktname'], 'Unbenannte Veranstaltung')),
    address: String(first(p, ['strasse', 'straße', 'adresse', 'address'], '') || ''),
    zip: String(first(p, ['plz', 'postleitzahl', 'zip'], '') || ''),
    district: String(first(p, ['bezirk', 'bezirk_ort', 'district', 'region', 'landkreis'], '') || ''),
    place: String(first(p, ['ort', 'stadt', 'gemeinde', 'place'], '') || ''),
    from: String(first(p, ['von', 'beginn', 'start', 'datum_von', 'start_date', 'date_from'], '') || ''),
    to: String(first(p, ['bis', 'ende', 'end', 'datum_bis', 'end_date', 'date_to'], '') || ''),
    timeText: String(first(p, ['zeit', 'zeiten', 'uhrzeit', 'oeffnungszeiten', 'öffnungszeiten', 'time'], '') || ''),
    organizer: String(first(p, ['veranstalter', 'anbieter', 'organizer'], '') || ''),
    url: String(first(p, ['www', 'internet', 'website', 'url', 'link'], '') || ''),
    notes: String(first(p, ['bemerkungen', 'beschreibung', 'description', 'hinweis'], '') || ''),
    lat: point.lat,
    lon: point.lon
  };
}

async function fetchSource(source) {
  const url = `${source.base}/index/all.json?q=`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: DAY, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`${source.key}: HTTP ${response.status}`);
  const data = await response.json();
  const rows = Array.isArray(data?.index) ? data.index : [];
  return rows.map((row, i) => normalize(row, source, i));
}

function parseGermanDate(value) {
  const m = String(value || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function priority(event) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const from = parseGermanDate(event.from);
  const to = parseGermanDate(event.to) || from;
  if (from && to && from <= now && to >= now) return 0;
  if (from) {
    const days = Math.round((from - now) / 86400000);
    if (days >= 0 && days <= 14) return 1;
    if (days >= 0 && days <= 90) return 2;
    if (days >= 0) return 3;
    return 8;
  }
  if (event.sourceKey === 'weekly') return 4;
  return 6;
}

async function enrichOne(event) {
  if (Number.isFinite(event.lat) && Number.isFinite(event.lon)) return event;
  const source = SOURCES.find(s => s.key === event.sourceKey);
  if (!source || !event.detailId) return event;
  try {
    const response = await fetch(`${source.base}/detail/${encodeURIComponent(event.detailId)}.json`, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: DAY, cacheEverything: true }
    });
    if (!response.ok) return event;
    const data = await response.json();
    const item = data?.item || data;
    const point = coordsFromObject(item);
    if (point.lat != null && point.lon != null) {
      event.lat = point.lat;
      event.lon = point.lon;
    }
  } catch (_) {}
  return event;
}

async function enrichCoordinates(events) {
  const candidates = events
    .filter(e => !Number.isFinite(e.lat) || !Number.isFinite(e.lon))
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, 36);

  for (let i = 0; i < candidates.length; i += 6) {
    await Promise.all(candidates.slice(i, i + 6).map(enrichOne));
  }
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
      headers: { Accept: 'text/html' },
      cf: { cacheTtl: DAY, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const pdf = [...html.matchAll(/href=["']([^"']*havelblick[^"']*\.pdf[^"']*)["']/gi)][0]?.[1]
      || [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)][0]?.[1]
      || '';
    const issue = pdf ? new URL(pdf, url).href : '';
    const text = cleanHtml(html);
    const terms = /flohmarkt|trödelmarkt|troedelmarkt|erntefest|hoffest|dorffest|stadtfest|weihnachtsmarkt|handwerkermarkt|bauernmarkt|volksfest/ig;
    const mentions = [];
    let match;
    while ((match = terms.exec(text)) && mentions.length < 12) {
      const snippet = text.slice(Math.max(0, match.index - 120), Math.min(text.length, match.index + 260)).trim();
      if (!mentions.some(x => x.snippet === snippet)) mentions.push({ snippet, url });
    }
    return { label: 'Havelblick – SPD Oberhavel', homepage: url, latestIssueUrl: issue, mentions };
  } catch (error) {
    return { label: 'Havelblick – SPD Oberhavel', homepage: url, latestIssueUrl: '', mentions: [], error: String(error?.message || error) };
  }
}

export async function onRequestGet() {
  const [settled, havelblick] = await Promise.all([
    Promise.allSettled(SOURCES.map(fetchSource)),
    fetchHavelblick()
  ]);

  const events = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  const errors = settled
    .map((result, i) => result.status === 'rejected' ? `${SOURCES[i].key}: ${result.reason?.message || 'Fehler'}` : null)
    .filter(Boolean);

  if (events.length) await enrichCoordinates(events);

  const payload = {
    updatedAt: new Date().toISOString(),
    refreshIntervalHours: 24,
    events,
    sources: SOURCES.map(s => ({ key: s.key, label: s.label })),
    havelblick,
    partial: errors.length > 0,
    errors
  };

  return new Response(JSON.stringify(payload), {
    status: events.length ? 200 : 502,
    headers: HEAD
  });
}
