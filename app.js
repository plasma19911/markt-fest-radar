(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const TYPES = {
    flea:{icon:'🧺',label:'Floh-/Trödelmarkt',color:'#f6c85f'},
    harvest:{icon:'🎃',label:'Ernte-/Hoffest',color:'#e99043'},
    fest:{icon:'🎉',label:'Fest',color:'#7f8cff'},
    market:{icon:'🛍️',label:'Markt',color:'#d97adf'},
    christmas:{icon:'🎄',label:'Weihnachtsmarkt',color:'#55c28d'},
    weekly:{icon:'🥕',label:'Wochenmarkt',color:'#6bc5a4'},
    other:{icon:'🎪',label:'Veranstaltung',color:'#73b8ef'}
  };
  const S = { events:[], filtered:[], preset:'all', loc:null, map:null, layer:null, fitted:false };

  function parseDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return new Date(`${text.slice(0,10)}T00:00:00`);
    const m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2]-1, +m[1]) : null;
  }
  const start = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const add = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  function eventType(e) {
    const t = norm([e.title,e.notes,e.sourceType].join(' '));
    if (/weihnacht|advent/.test(t)) return 'christmas';
    if (/floh|trodel|antik|sammler/.test(t)) return 'flea';
    if (/ernte|kurbis|hoffest|bauern|apfel|kartoffel/.test(t)) return 'harvest';
    if (/stadtfest|dorffest|dorf fest|volksfest|strassenfest|festival|fest /.test(`${t} `)) return 'fest';
    if (/wochenmarkt/.test(t)) return 'weekly';
    if (/markt|handwerk|basar/.test(t)) return 'market';
    return 'other';
  }

  function distanceKm(e) {
    if (!S.loc || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return null;
    const [lat1,lon1] = S.loc, lat2=e.lat, lon2=e.lon, R=6371, rad=x=>x*Math.PI/180;
    const dLat=rad(lat2-lat1), dLon=rad(lon2-lon1);
    const a=Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }

  function dateRange() {
    if ($('date').value) { const d=new Date(`${$('date').value}T00:00:00`); return [d,d]; }
    if (S.preset === 'all') return null;
    const n = start(new Date());
    if (S.preset === 'today') return [n,n];
    if (S.preset === 'tomorrow') return [add(n,1),add(n,1)];
    let daysToSat=(6-n.getDay()+7)%7;
    if (S.preset === 'nextWeekend') daysToSat += 7;
    const sat=add(n,daysToSat), sun=add(sat,1);
    return [sat,sun];
  }

  function occurs(e, range) {
    const from=parseDate(e.from), to=parseDate(e.to)||from;
    const today=start(new Date());
    if (!range) {
      if (!from && !to) return true;
      return start(to||from) >= today;
    }
    if (!from) return false;
    return start(to||from) >= start(range[0]) && start(from) <= start(range[1]);
  }

  function normalizeEvent(e,i) {
    const latRaw=e.lat, lonRaw=e.lon;
    const lat=(latRaw==null||latRaw==='')?null:Number(latRaw);
    const lon=(lonRaw==null||lonRaw==='')?null:Number(lonRaw);
    return {
      ...e,
      id:String(e.id || `event-${i}`),
      title:String(e.title || 'Veranstaltung'),
      address:String(e.address || ''), zip:String(e.zip || ''), place:String(e.place || ''),
      from:String(e.from || ''), to:String(e.to || ''), timeText:String(e.timeText || ''), notes:String(e.notes || ''),
      sourceLabel:String(e.sourceLabel || 'Quelle'), url:String(e.url || ''), groupId:String(e.groupId || ''),
      lat:Number.isFinite(lat)&&lat>=47&&lat<=56?lat:null,
      lon:Number.isFinite(lon)&&lon>=5&&lon<=16?lon:null
    };
  }

  function dedupe(events) {
    const seen=new Set();
    return events.filter(e=>{
      const k=norm([e.title,e.from,e.address,e.place].join('|'));
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  async function readJson(url) {
    const r=await fetch(url,{cache:'no-store'});
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  async function loadData() {
    const [seedResult, apiResult] = await Promise.allSettled([
      readJson('/data/seed-events.json?v=8'),
      readJson('/api/events?v=8')
    ]);
    const combined=[];
    if (seedResult.status==='fulfilled') combined.push(...(seedResult.value.events||[]));
    if (apiResult.status==='fulfilled') combined.push(...(apiResult.value.events||[]));
    S.events=dedupe(combined.map(normalizeEvent));
    $('status').textContent = S.events.length ? `${S.events.length} Termine geladen · v8` : 'Keine Termindaten geladen · v8';
    doFilter();
  }

  function formatDate(e) {
    const from=parseDate(e.from), to=parseDate(e.to);
    if (!from) return e.scheduleText || 'Termin siehe Quelle';
    const o={weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'};
    if (to && iso(to)!==iso(from)) return `${from.toLocaleDateString('de-DE',o)} – ${to.toLocaleDateString('de-DE',o)}`;
    return from.toLocaleDateString('de-DE',o);
  }

  function doFilter() {
    const q=norm($('search').value), range=dateRange(), radius=+$('radius').value;
    S.filtered=S.events.filter(e=>{
      if (!occurs(e,range)) return false;
      if (q && !norm([e.title,e.address,e.place,e.notes,e.sourceLabel].join(' ')).includes(q)) return false;
      const d=distanceKm(e);
      if (S.loc && radius<999 && d!=null && d>radius) return false;
      return true;
    });
    const sort=$('sort').value;
    S.filtered.sort((a,b)=> sort==='distance' ? (distanceKm(a)??1e9)-(distanceKm(b)??1e9) : (parseDate(a.from)?.getTime()??9e15)-(parseDate(b.from)?.getTime()??9e15));
    render();
  }

  function render() {
    const host=$('events'); host.innerHTML='';
    for (const e of S.filtered) {
      const type=TYPES[eventType(e)], d=distanceKm(e);
      const card=document.createElement('article'); card.className='event-card';
      card.innerHTML=`<div class="event-icon">${type.icon}</div><div class="event-main"><div class="event-title">${esc(e.title)}</div><div class="event-meta"><b>${esc(formatDate(e))}</b>${e.timeText?` · ${esc(e.timeText)}`:''}</div><div class="event-meta">📍 ${esc([e.address,e.zip,e.place].filter(Boolean).join(', ')||'Ort siehe Quelle')}</div><div class="badges"><span class="badge">${esc(type.label)}</span>${e.groupId?'<span class="badge">wiederkehrend</span>':''}</div></div><div class="distance">${d==null?'':`${d.toFixed(1)} km`}</div>`;
      card.addEventListener('click',()=>openDetail(e)); host.appendChild(card);
    }
    if (!S.filtered.length) host.innerHTML='<div class="empty">Keine Termine für diesen Filter. „Alle kommenden“ zeigt wieder alles.</div>';
    $('count').textContent=S.filtered.length;
    const t=start(new Date()); $('todayCount').textContent=S.events.filter(e=>occurs(e,[t,t])).length;
    $('subline').textContent=`${S.filtered.length} Termine · Märkte und Feste gemeinsam`;
    renderMap();
  }

  function renderMap() {
    if (!S.map || !S.layer || typeof L==='undefined') return;
    S.layer.clearLayers(); const bounds=[], groups=new Map();
    for (const e of S.filtered) {
      if (!Number.isFinite(e.lat)||!Number.isFinite(e.lon)) continue;
      const key=e.groupId || `${e.lat.toFixed(4)}|${e.lon.toFixed(4)}|${norm(e.title)}`;
      if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(e);
    }
    for (const events of groups.values()) {
      events.sort((a,b)=>(parseDate(a.from)?.getTime()??9e15)-(parseDate(b.from)?.getTime()??9e15));
      const e=events[0], type=TYPES[eventType(e)], count=events.length;
      const icon=L.divIcon({className:'',html:`<div class="pin" style="--cat:${type.color}"><span>${type.icon}</span>${count>1?`<b>${count}</b>`:''}</div>`,iconSize:[34,38],iconAnchor:[17,36]});
      const m=L.marker([e.lat,e.lon],{icon}).addTo(S.layer).bindTooltip(`${e.title} · ${formatDate(e)}${count>1?` · ${count} Termine`:''}`);
      m.on('click',()=>openDetail(e)); bounds.push([e.lat,e.lon]);
    }
    if (!S.fitted && bounds.length) { S.fitted=true; bounds.length===1 ? S.map.setView(bounds[0],11,{animate:false}) : S.map.fitBounds(bounds,{padding:[25,25],maxZoom:10,animate:false}); }
  }

  function openDetail(e) {
    const type=TYPES[eventType(e)], location=[e.address,e.zip,e.place].filter(Boolean).join(', ');
    const route=Number.isFinite(e.lat)&&Number.isFinite(e.lon)?`https://www.openstreetmap.org/directions?to=${encodeURIComponent(`${e.lat},${e.lon}`)}`:'';
    $('detail').innerHTML=`<div class="detail-kicker">${type.icon} ${esc(type.label)}</div><h2>${esc(e.title)}</h2><dl class="detail-grid"><dt>Datum</dt><dd>${esc(formatDate(e))}</dd><dt>Uhrzeit</dt><dd>${esc(e.timeText||'siehe Quelle')}</dd><dt>Ort</dt><dd>${esc(location||'siehe Quelle')}</dd><dt>Quelle</dt><dd>${esc(e.sourceLabel)}</dd></dl>${e.notes?`<p class="detail-note">${esc(e.notes)}</p>`:''}<div class="actions">${e.url?`<a href="${esc(e.url)}" target="_blank" rel="noopener">Quelle öffnen</a>`:'<span></span>'}${route?`<a href="${route}" target="_blank" rel="noopener">Route öffnen</a>`:''}</div>`;
    $('drawer').classList.add('open'); $('backdrop').classList.remove('hidden');
  }

  function initMap() {
    if (typeof L==='undefined') { $('map').innerHTML='<div class="map-error">Karte konnte nicht geladen werden. Die Terminliste funktioniert trotzdem.</div>'; return; }
    S.map=L.map('map').setView([52.43,13.05],8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap-Mitwirkende'}).addTo(S.map);
    S.layer=L.layerGroup().addTo(S.map);
  }

  function setup() {
    document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{S.preset=b.dataset.preset;$('date').value='';document.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x===b));doFilter();}));
    $('search').addEventListener('input',doFilter);
    $('date').addEventListener('change',()=>{if($('date').value)document.querySelectorAll('[data-preset]').forEach(x=>x.classList.remove('active'));doFilter();});
    $('radius').addEventListener('change',doFilter); $('sort').addEventListener('change',doFilter);
    $('locate').addEventListener('click',()=>{
      if (!navigator.geolocation) return $('locationState').textContent='Standort nicht unterstützt.';
      $('locationState').textContent='Standort wird ermittelt …';
      navigator.geolocation.getCurrentPosition(p=>{S.loc=[p.coords.latitude,p.coords.longitude];$('radius').disabled=false;$('locationState').textContent='Standort aktiv';if(S.map)S.map.setView(S.loc,10,{animate:false});doFilter();},()=>{$('locationState').textContent='Standort nicht freigegeben.';},{timeout:10000,maximumAge:300000});
    });
    $('closeDrawer').addEventListener('click',()=>{$('drawer').classList.remove('open');$('backdrop').classList.add('hidden');});
    $('backdrop').addEventListener('click',()=>{$('drawer').classList.remove('open');$('backdrop').classList.add('hidden');});
  }

  initMap(); setup(); loadData();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=8').catch(()=>{});
})();
