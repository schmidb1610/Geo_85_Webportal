/* ================================================================
   Green-Water-Portal · Palouse / Columbia-Basin — app.js (Stufe 1)
   Datengetrieben aus data/portal_data.json + data/cells.geojson.
   KEINE synthetischen Werte. 25-m-Raster-Layer folgen in Stufe 2.
   ================================================================ */
"use strict";
console.log('%c[Portal] app.js v57 aktiv - Interpretation-Overlays: hoher zIndex (Sichtbarkeit ueber Basiskarte)','color:#1a9850;font-weight:bold');

/* ---- Konstanten -------------------------------------------------- */
const PB = 12.4;          // globale planetare Grenze (Virkki et al. 2026)
const AXIS_MAX = 70;      // Skalenmaximum des Status-Instruments (Ende der Skala)
let   year = 2019;        // Jahr-Schieber (steuert Marker im cv-Diagramm)
let   selected = null;    // cell_nr der gewählten Zelle
let   Y_MIN = 1911, Y_MAX = 2019;
// Zell-Zuordnung (Name + Chip-Hintergrund) nach Region
const CELL_NAMES={
  19:['Columbia Basin (SW)','#e5f2f9'],20:['Columbia Basin (SE)','#e5f2f9'],25:['Columbia Basin (NW)','#e5f2f9'],26:['Columbia Basin (NE)','#e5f2f9'],
  21:['Columbia Plateau (SW)','#cdcdcd'],22:['Columbia Plateau (SE)','#cdcdcd'],27:['Columbia Plateau (NW)','#cdcdcd'],28:['Columbia Plateau (NE)','#cdcdcd'],
  23:['Palouse (SW)','#fff8e4'],24:['Palouse (SE)','#fff8e4'],29:['Palouse (NW)','#fff8e4'],30:['Palouse (NE)','#fff8e4'],
};

/* ---- Risiko-Farbverlauf (Zellfärbung nach Überschreitungsanteil) - */
const rgb = a => `rgb(${a[0]},${a[1]},${a[2]})`;
const RISK = [
  [ 5,[ 26,152, 80]], [12.4,[166,217,106]], [20,[254,224,139]],
  [28,[244,109, 67]], [37,[215, 48, 39]],   [47,[118, 42,131]]
];
function riskColor(v){
  if(v==null||isNaN(v)) return '#9a9a9a';
  if(v<=RISK[0][0]) return rgb(RISK[0][1]);
  if(v>=RISK[RISK.length-1][0]) return rgb(RISK[RISK.length-1][1]);
  for(let i=0;i<RISK.length-1;i++){
    const [a,ca]=RISK[i],[b,cb]=RISK[i+1];
    if(v>=a&&v<=b){ const t=(v-a)/(b-a);
      return rgb(ca.map((x,k)=>Math.round(x+(cb[k]-x)*t))); }
  }
}

/* ---- Formatierung (deutsche Dezimalkommas) ---------------------- */
const nf = (x,d=1)=> (x==null||isNaN(x)) ? '—'
  : Number(x).toLocaleString('de-DE',{minimumFractionDigits:d,maximumFractionDigits:d});
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ---- Daten laden ------------------------------------------------- */
let DATA=null, GEO=null, AOI=null;
let currentCell=null;
let SCAN_ST=null, SCAN_SER=null, SCAN_MON=null, scanLayer=null, scanOn=false;
const cellByNr = {};

Promise.all([
  fetch('data/portal_data.json').then(r=>r.json()),
  fetch('data/cells.geojson').then(r=>r.json()),
  fetch('data/aoi.json').then(r=>r.json()).catch(()=>null),
  fetch('data/scan_stations.geojson').then(r=>r.json()).catch(()=>null),
  fetch('data/scan_series.json').then(r=>r.json()).catch(()=>null),
  fetch('data/scan_series_monthly.json').then(r=>r.json()).catch(()=>null)
]).then(([portal,geo,aoi,scanst,scanser,scanmon])=>{
  DATA=portal; GEO=geo; AOI=aoi; SCAN_ST=scanst; SCAN_SER=scanser; SCAN_MON=scanmon;
  DATA.cells.forEach(c=>cellByNr[c.cell_nr]=c);
  // Charakter-Attribute (Höhe, AWC, Niederschlag, Temp …) aus der GeoJSON anhängen
  GEO.features.forEach(f=>{
    const c=cellByNr[f.properties.cell_nr];
    if(c){ c.props=f.properties; }
  });
  // globalen Jahresbereich aus den cv-Zeitreihen ableiten
  let mn=9999,mx=-9999;
  DATA.cells.forEach(c=>Object.values(c.cv||{}).forEach(ser=>ser.forEach(([y])=>{if(y<mn)mn=y;if(y>mx)mx=y;})));
  if(mn<9999){ Y_MIN=mn; Y_MAX=mx; year=mx; }
  initMap();
}).catch(err=>{
  document.getElementById('panel').innerHTML =
    `<div class="panel-empty"><div class="lead">Daten konnten nicht geladen werden.</div>`+
    `Bitte über einen lokalen Server öffnen (nicht per file://).<br><br><code>${esc(err.message)}</code></div>`;
  console.error(err);
});

/* ---- Karte + Basiskarten ---------------------------------------- */
let map, cellLayers={}, selBorder=null;
let gridLayer=null, gridRenderer=null;
const bm = {};
let curBm='sat', ctxMode='global', yrMode='real';

function initMap(){
  // Maszstabsleiste um 4er-Stufe erweitern (Standard: 1/2/3/5); so kann 4 km angezeigt werden
  L.Control.Scale.prototype._getRoundNum=function(num){
    var pow10=Math.pow(10,(Math.floor(num)+'').length-1), d=num/pow10;
    d = d>=10?10 : d>=5?5 : d>=4?4 : d>=3?3 : d>=2?2 : 1;
    return pow10*d;
  };
  map = L.map('map',{minZoom:2,maxZoom:13,zoomSnap:1,zoomDelta:1,attributionControl:true,zoomControl:true})
         .setView([46.9,-118.4],8);

  bm.sat   = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              {maxZoom:17, attribution:'Imagery © Esri, Maxar, USGS'});
  bm.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
              {maxZoom:19, attribution:'© OpenStreetMap · © CARTO'});
  bm.osm   = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              {maxZoom:18, attribution:'© OpenStreetMap'});
  bm.sat.addTo(map);
  L.control.scale({position:'bottomleft',imperial:false,metric:true,maxWidth:200,updateWhenIdle:false}).addTo(map);
  // Generischer Handler: Klick auf ein "?" (.q) blendet das folgende .q-pop ein/aus
  document.addEventListener('click',e=>{ const q=e.target.closest('.q'); if(!q) return;
    const pop = (q.nextElementSibling && q.nextElementSibling.classList.contains('q-pop'))
      ? q.nextElementSibling
      : q.closest('h3')?.nextElementSibling;
    if(pop&&pop.classList.contains('q-pop')) pop.hidden=!pop.hidden; });

  // Fallback-Hinweis, falls Kacheln (offline) nicht laden
  let tilesOK=false;
  Object.values(bm).forEach(l=>l.on('tileload',()=>{tilesOK=true;}));
  setTimeout(()=>{ if(!tilesOK){ const h=document.getElementById('tilesHint'); if(h) h.style.display='block'; } },3500);

  // Zellen als GeoJSON
  map.createPane('gridPane'); map.getPane('gridPane').style.zIndex='250'; map.getPane('gridPane').style.pointerEvents='none';
  gridRenderer = L.canvas({pane:'gridPane',padding:.5});
  const gj = L.geoJSON(GEO,{
    style: f => cellStyle(cellByNr[f.properties.cell_nr]),
    onEachFeature: (f,layer)=>{
      const c=cellByNr[f.properties.cell_nr];
      cellLayers[c.cell_nr]=layer;
      // Zellnummer dauerhaft in der Mitte (schwarz, weißer Halo via CSS)
      layer.bindTooltip(String(c.cell_nr),{permanent:true,direction:'center',className:'cell-num'});
      layer.on('mouseover',()=>{ if(selected!==c.cell_nr) layer.setStyle({weight:4.2}); });
      layer.on('mouseout', ()=>{ if(selected!==c.cell_nr) layer.setStyle(cellStyle(c)); });
      layer.on('click',()=>selectCell(c));
    }
  }).addTo(map);
  map._gj=gj;
  map.on('moveend zoomend', updateGrid);

  wireControls();
  // Header-Tag ehrlich halten: Kennwerte sind real, nur die 25-m-Raster fehlen noch
  const pt=document.querySelector('.proto-tag'); if(pt) pt.style.display='none';
  const aoiHint=document.createElement('div');
  aoiHint.className='ctx-hint aoi-hint'; aoiHint.id='aoiHint'; aoiHint.style.display='none';
  aoiHint.innerHTML='<b>Klick auf eine Zelle</b> öffnet ihre Einzelwerte, 25-m-Layer &amp; Downloads.';
  (document.querySelector('.map-wrap')||document.body).appendChild(aoiHint);
  // Start IMMER global: Startansicht + Projekt-Panel ZUERST setzen, damit ein evtl.
  // Fehler in den Zusatzmodulen die Global-Startansicht nicht mehr verhindern kann.
  ctxMode='global';
  map.setView([42,13],6);
  const _ch=document.getElementById('ctxHint'); if(_ch) _ch.style.display='block';
  updateGrid();
  showProjectOverview();
  // Zusatzmodule einzeln absichern: ein Fehler darf weder die Startansicht noch die
  // anderen Module abbrechen (Ursache landet in der Browser-Konsole).
  try{ initFallstudie(); }catch(e){ console.error('initFallstudie:',e); }
  try{ initScan(); }catch(e){ console.error('initScan:',e); }
  try{ initInterp(); }catch(e){ console.error('initInterp:',e); }
}

function cellStyle(c){
  // Transparente Füllung + Rand. Rand schwarz; wenn eine ANDERE Zelle gewählt ist → grau (Auswahl hervorheben).
  const other = selected!=null && selected!==c.cell_nr;
  return {color: other?'#8a8f88':'#111', weight: other?1.7:2.6, opacity:.95, fill:true, fillColor:'#000', fillOpacity:0};
}
// Dynamisches 0,5°-ISIMIP-Gitter (umliegende/verfügbare Zellen, grau) für den aktuellen Ausschnitt.
function updateGrid(){
  if(!map) return;
  if(gridLayer){ map.removeLayer(gridLayer); gridLayer=null; }
  if(ctxMode!=='global') return;                // Gitter NUR in der Global-Übersicht
  if(map.getZoom() < 5) return;                 // 0,5°-Zellen erst ab Regional-Zoom sinnvoll sichtbar
  const b=map.getBounds(), s=0.5;
  const x0=Math.floor(b.getWest()/s)*s, x1=Math.ceil(b.getEast()/s)*s;
  const y0=Math.floor(b.getSouth()/s)*s, y1=Math.ceil(b.getNorth()/s)*s;
  if(((x1-x0)/s)*((y1-y0)/s) > 3000) return;    // Sicherheitskappe gegen zu viele Polygone
  const polys=[];
  for(let x=x0; x<x1-1e-9; x+=s) for(let y=y0; y<y1-1e-9; y+=s){
    polys.push(L.polygon([[y,x],[y,x+s],[y+s,x+s],[y+s,x]],
      {renderer:gridRenderer,color:'#7c827b',weight:.7,opacity:.7,fill:true,fillColor:'#000',fillOpacity:0,interactive:false}));
  }
  gridLayer=L.layerGroup(polys).addTo(map);
}

// Feine Zoomstufen (0,25) nur in den reingezoomten Ansichten (Fallstudie/Zelle);
// im Global-/AOI-Ueberblick ganze Stufen -> sofort scharf, kein Fraktal-Zoom-Blur.
function setZoomGranularity(fine){ map.options.zoomSnap=fine?0.25:1; map.options.zoomDelta=fine?0.25:1; }
function fitAOI(){
  if(map._gj) map.fitBounds(map._gj.getBounds(),{padding:[24,24]});
}

/* ---- Steuerung (Header, Schieber, Resizer) ---------------------- */
function wireControls(){
  const bmT=document.getElementById('bmToggle');
  if(bmT) bmT.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    bmT.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    map.removeLayer(bm[curBm]); curBm=b.dataset.bm; bm[curBm].addTo(map);
  });

  const ctxT=document.getElementById('ctxToggle');
  const ctxHint=document.getElementById('ctxHint');
  if(ctxT) ctxT.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    ctxT.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    ctxMode=b.dataset.ctx;
    if(b.dataset.ctx==='global'){ map.setView([42,13],6); if(ctxHint) ctxHint.style.display='block'; const ah=document.getElementById('aoiHint'); if(ah) ah.style.display='none'; showProjectOverview(); }
    else { fitAOI(); if(ctxHint) ctxHint.style.display='none'; const ah=document.getElementById('aoiHint'); if(ah) ah.style.display='block'; showAOI(); }
    updateGrid();
  });
  const jump=document.getElementById('ctxJump');
  if(jump) jump.addEventListener('click',()=>{ fitAOI(); if(ctxHint) ctxHint.style.display='none'; const ah=document.getElementById('aoiHint'); if(ah) ah.style.display='block'; showAOI(); ctxMode='aoi'; updateGrid();
    const b=ctxT.querySelector('[data-ctx="aoi"]'); ctxT.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); });

  const png=document.getElementById('pngBtn');
  if(png) png.addEventListener('click',exportPNG);

  // Jahr-Schieber wird jetzt PRO ZELLE im rechten Panel gerendert (wirePanelSlider, in renderPanel).

  // Code-Modal defensiv schließbar (in Stufe 1 nicht geöffnet)
  const cb=document.getElementById('codeBack');
  const close=()=>cb&&cb.classList.remove('open');
  ['codeClose'].forEach(id=>{const el=document.getElementById(id); if(el) el.addEventListener('click',close);});
  if(cb) cb.addEventListener('click',e=>{ if(e.target.id==='codeBack') close(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });

  wireResizer();
}

/* ---- Zelle wählen + Panel --------------------------------------- */
function selectCell(c){
  if(typeof czActive!=='undefined' && czActive && c.cell_nr!==czCellNr) czExit();
  selected=c.cell_nr;
  const gj=map._gj;
  Object.entries(cellLayers).forEach(([nr,l])=>{
    if(+nr===c.cell_nr) l.setStyle({weight:0,opacity:0,fillOpacity:0});
    else l.setStyle(cellStyle(cellByNr[+nr]));
  });
  const b=cellLayers[c.cell_nr].getBounds();
  if(!selBorder){ selBorder=L.rectangle(b,{color:'#1a1e1c',weight:3,fill:false}).addTo(map); }
  else { selBorder.setBounds(b); selBorder.addTo(map); }
  renderPanel(c);
}

function regionMeta(c){
  const r=(c.props&&c.props.region)||'';
  const irr = /Columbia Basin/i.test(r);            // West-Zellen bewässert
  let cls='dry';
  if(/Columbia Basin/i.test(r)) cls='cbp';
  else if(/Plateau|Übergang/i.test(r)) cls='mix';
  return {name:r||c.lage, cls, irr};
}

function mean9019(c){
  const obs=Object.fromEntries((c.cv&&c.cv.obsclim)||[]);
  const rec=Object.entries(obs).filter(([y])=>+y>=1990).map(([,v])=>v);
  return rec.length ? rec.reduce((a,b)=>a+b,0)/rec.length : c.grenzen.obsclim_mittel_pct;
}

function statusOf(c){
  const g=c.grenzen, v=mean9019(c);
  if(v>g.obere_pct) return {key:'above', name:'über Zell-Korridor', col:'#c1462b'};
  if(v<g.untere_pct) return {key:'below', name:'unter Zell-Korridor', col:'#4a90c2'};
  return {key:'within', name:'im natürlichen Korridor', col:'#1a9850'};
}
// Jahreswert der Exceedance: lineare Trend-Schaetzung (kein jahresaufgeloester Datensatz vorhanden)
function estExceedance(c,yr){
  if(yrMode==='real'){                                   // echter ISIMIP-Jahreswert (obsclim, Ensemble)
    const obs=Object.fromEntries((c.cv&&c.cv.obsclim)||[]);
    if(obs[yr]!=null) return Math.max(0,Math.min(AXIS_MAX,obs[yr]));
    return c.grenzen.obsclim_mittel_pct;
  }
  // flaches 30-Jahr-Mittel 1990–2019 (aus obsclim, konsistent zum 'real'-Zweig) — KEINE Steigung
  return Math.max(0,Math.min(AXIS_MAX, mean9019(c)));
}
function statusOfVal(g,v){
  if(v>g.obere_pct) return {name:'über Zell-Korridor', col:'#c1462b'};
  if(v<g.untere_pct) return {name:'unter Zell-Korridor', col:'#4a90c2'};
  return {name:'im natürlichen Korridor', col:'#1a9850'};
}
function updateStatusYear(){
  const c=currentCell; if(!c) return;
  const needle=document.getElementById('gaugeNeedle'); if(!needle) return;
  const g=c.grenzen, v=estExceedance(c,year);
  needle.style.left=Math.max(0,Math.min(100,v/AXIS_MAX*100))+'%';
  needle.title=`${yrMode==='real'?'ISIMIP-Jahreswert':'Mittel 1990–2019'} ${year}: ${nf(v,1)} %`;
  const st=statusOfVal(g,v);
  const dot=document.getElementById('stDot'), lab=document.getElementById('stLabel'), fac=document.getElementById('stFactor');
  if(dot) dot.style.background=st.col;
  if(lab){ lab.style.color=st.col; lab.textContent=st.name; }
  if(fac){ const m=g.obere_pct-v; fac.textContent = (m>=0) ? `${nf(m,1)} pp bis zur oberen Grenze (${nf(g.obere_pct,1)} %)` : `${nf(-m,1)} pp über der oberen Grenze`; }
  const hv=document.getElementById('hdrVal'); if(hv) hv.textContent=nf(v,1);
  const pm=document.getElementById('popMode'); if(pm) pm.textContent=yrMode==='real'?'(ISIMIP-Jahreswert, obsclim)':'(Mittel 1990–2019)';
  const y=document.getElementById('popYear'), yv=document.getElementById('popYearVal');
  if(y) y.textContent=year; if(yv) yv.textContent=nf(v,1);
}

function renderPanel(c,isAOI){
  currentCell=c;
  const g=c.grenzen, p=c.props||{}, reg=regionMeta(c), st=statusOf(c);
  const v=mean9019(c);
  const marg = g.obere_pct - v;
  const vsPB = (marg >= 0)
    ? `${nf(marg,1)} pp bis zur oberen Grenze (${nf(g.obere_pct,1)} %)`
    : `${nf(-marg,1)} pp über der oberen Grenze`;

  document.getElementById('panel').innerHTML = `
    <div class="cell-head">
      <div class="cid">${isAOI?`${esc(c.lage)} · ${c.n_pixel.toLocaleString('de-DE')} Pixel`:`Zelle ${c.cell_nr} · Zentrum ${nf(c.center_lat,2)}°, ${nf(c.center_lon,2)}° · ${c.n_pixel.toLocaleString('de-DE')} Pixel`}</div>
      <div class="metric-box"><div class="metric-kicker">Kontrollvariable</div>
      <h2><span id="hdrVal">${nf(v,1)}</span><span> % abweichende Fläche</span></h2></div>
      <div class="chips">
        <span class="chip" style="background:${isAOI?'#e8eef0':(CELL_NAMES[c.cell_nr]||['','#ececec'])[1]};color:#1a1e1c;border:1px solid rgba(0,0,0,.08)">${isAOI?'Gesamtergebnis · 12 Zellen':esc((CELL_NAMES[c.cell_nr]||[reg.name])[0])}</span>
      </div>
    </div>

    <div class="section">
      <h3>Status im Zell-Korridor <span class="q" id="statusQ" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" id="statusPop" hidden>
        <p><b>Wie entsteht dieser Wert?</b> Es ist der Anteil der Zellfläche, deren Green-Water-Variabilität außerhalb des natürlichen Zell-Korridors (5.–95. Perzentil, Baseline 1911–2019) liegt. Die globale Grenze 12,4 % dient als globale PB-Referenz, nicht als lokale Messlatte.</p>
        <p>Zell-Korridor <b>${nf(g.untere_pct,1)}–${nf(g.obere_pct,1)} %</b> (5.–95. Perzentil; 95-%-KI der oberen Grenze ${nf(g.obere_ci[0],1)}–${nf(g.obere_ci[1],1)} pp).</p>
        <p>Für <b id="popYear">${year}</b>: <b id="popYearVal">${nf(v,1)}</b> % <span id="popMode">(ISIMIP-Jahreswert, obsclim)</span>. Zustand (Mittel 1990–2019): <b>${nf(mean9019(c),1)}</b> %.</p>
        <p><b>Merke:</b> Jahreswerte = Klimavariabilität (Rauschen) · 30-J-Mittel = Zustand · Trend = geprüfte Richtung (hier meist nicht signifikant).</p>
        <p class="src">Kippschalter „ISIMIP real / Mittel" (bei „Zeitreihe · Jahr") wechselt zwischen echtem Jahreswert und dem 30-Jahr-Mittel 1990–2019.</p>
      </div>
      <div class="status-line">
        <span class="st-dot" id="stDot" style="background:${st.col}"></span>
        <span class="st-label" id="stLabel" style="color:${st.col}">${st.name}</span>
        <span class="st-anchor" id="stFactor">${vsPB}</span>
      </div>
      ${gauge(g, v)}
      <div class="threshold-note"><span class="th-tag">Grenzwert</span>
        <span class="q" title="Wie entsteht der Grenzwert?">?</span>
        <div class="q-pop" hidden><p>So entsteht der Grenzwert: Er kommt aus dem
        <b>Referenzzustand (counterclim)</b> — dem Naturzustand ohne menschlichen Einfluss. Dort
        misst man je Zelle die natürliche Schwankung der abweichenden Fläche über die Jahre und
        leitet daraus den natürlichen Korridor ab: der <b>Median (P50)</b> als Normalzustand-Mittellinie
        und das <b>95. Perzentil (P95) als Grenze</b> — ein Zustand, der natürlich nur ~1× in 20 Jahren
        auftrat. Ein beobachteter (<b>obsclim</b>) Wert über P95 = Überschreitung. Die globale
        Planetare Grenze (12,4 %) ist nur eine <b>globale Referenz, nicht 1:1</b> mit dem lokalen
        Wert vergleichbar.</p></div>
      </div>
    </div>

    <div class="section yr-sec">
      <h3>Zeitreihe · Jahr <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Der Schieber wählt ein Jahr (1911–2019) und setzt den Marker in der Zeitreihe unten. Über den Kippschalter zeigt der Jahreswert entweder den echten ISIMIP-Wert (obsclim, Ensemble) oder das konstante 30-Jahr-Mittel (1990–2019) als Referenzniveau. So sieht man die einzelnen Jahre um ein stabiles Mittel schwanken.</p></div>
      <div class="yr-row">
        <div class="yr-track">
          <input type="range" id="yrSlider" min="${Y_MIN}" max="${Y_MAX}" step="1" value="${year}">
          <div class="anchors" id="anchors">
            <button data-yr="${Y_MIN}">${Y_MIN}</button>
            <button data-yr="${Math.round((Y_MIN+Y_MAX)/2)}">${Math.round((Y_MIN+Y_MAX)/2)}</button>
            <button data-yr="${Y_MAX}" class="on">${Y_MAX}</button>
          </div>
        </div>
        <span class="yr-out" id="yrOut">${year}</span>
        <span class="yr-step"><button type="button" id="yrUp" title="Jahr +1">▲</button><button type="button" id="yrDown" title="Jahr −1">▼</button></span>
      </div>
      <div class="seg yr-mode" id="yrModeToggle" title="Anzeigewert am Zeitschieber">
        <button data-mode="real">ISIMIP real</button>
        <button data-mode="mean">Mittel (1990–2019)</button>
      </div>
    </div>

    <div class="section">
      <h3>Variabilität über die Zeit <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Jährlicher Flächenanteil außerhalb des Korridors für baseline (vorindustriell) vs. obsclim (beobachtet), Ensemble-Median über 4 GHM. Der Jahr-Schieber setzt den Marker. Hinweis: die y-Achse meint den Flächenanteil außerhalb [%] (Virkki-Metrik), keinen klassischen Variationskoeffizienten.</p></div>
      ${cvChart(c)}
    </div>

    <div class="section">
      <h3>Trend des Überschreitungsanteils <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Theil-Sen-Steigung + Mann-Kendall je Zeitfenster auf der jährlichen Reihe des Flächenanteils außerhalb (Ensemble-Median). p_ess = autokorrelationskorrigierter p-Wert (effektive Stichprobe statt n). Die Reihe ist ein Buckel (Peak 1970er): Vollreihe (+) und 1990–2019 (−) sind gegenläufig → kein säkularer Trend; die meisten Fenster sind nicht signifikant.</p></div>
      ${trendTable(c.trends)}
    </div>

    <div class="section">
      <h3>${isAOI?'AOI-Kennwerte (Mittel)':'Zell-Kennwerte'} <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Flächenmittel über die ~0,5°-Zelle: Höhe aus USGS 3DEP, AWC (0–100 cm) aus NRCS SSURGO, Niederschlag &amp; Temperatur aus regionalen Klimanormalen (PRISM 1991–2020). Die reale Spanne innerhalb der Zelle ist deutlich größer als der Mittelwert (siehe Min/Max der 25-m-Raster).</p></div>
      <div class="kv"><span class="k">Mittlere Höhe</span><span class="v">${nf(p.hoehe_m,0)} m</span></div>
      <div class="kv"><span class="k">Nutzbare Feldkapazität (AWC)</span><span class="v">${nf(p.awc_mean,1)} %</span></div>
      <div class="kv"><span class="k">Jahresniederschlag</span><span class="v">${p.niederschl_mm!=null?p.niederschl_mm+' mm':'—'}</span></div>
      <div class="kv"><span class="k">Jahresmitteltemperatur</span><span class="v">${nf(p.temp_c,1)} °C</span></div>
    </div>

    <div class="section">
      <h3>Attribution (Zerlegung) <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Aus vier faktoriellen ISIMIP-Szenarien (obsclim/counterclim × histsoc/1901soc): DHF = direkter menschlicher Einfluss (Landnutzung/Bewässerung), CRF = Klima, historical = Gesamtsignal — je 30-J-Mittel-Differenz 1990–2019 zur Baseline (Wilcoxon-getestet). Werte sind zellspezifisch (teils negativ) und nicht direkt mit dem AOI-Wert (DHF +8,3 / CRF +4,6 pp) vergleichbar. Der DHF-Beitrag ist eine obere Schranke.</p></div>
      ${attribution(c.attribution)}
    </div>

    ${isAOI?`<div class="section aoi-note"><p class="note-p"><b>Warum in einzelne Zellen zoomen?</b> Diese 12-Zellen-Ansicht ist ein <b>0,5°-Aggregat</b> — jede Zelle mischt sehr unterschiedliche Standorte (Hänge/Täler, Böden, bewässert vs. Trockenland). Der Zellwert verdeckt diese Heterogenität. Für belastbare Aussagen auf eine Zelle klicken: die <b>25-m-Auflösung</b> zeigt, <i>wo innerhalb</i> der Zelle die Überschreitung entsteht.</p></div>`:''}

    ${isAOI?'':`
    <div class="section stage2">
      <h3>25-m-Raster dieser Zelle <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Disaggregierte 25-m-Layer (Gewichtung aus TWI/AWC). Legenden pro Zelle skaliert: DEM/AWC/RZSM/exceed = echtes Min/Max, TWI/Slope = P2/P98 (Artefaktdämpfung). Sie zeigen topografisch-edaphische Prädisposition, keine gemessene 25-m-Grenzüberschreitung (Validierung nur an 2 SCAN-Stationen).</p><p>Die <b>„Anteil der Zeit"-Layer</b> geben den Anteil der Monate <b>1990–2019</b> an, in denen der Pixel außerhalb seines Korridors lag (Ensemble-Median). <b>0,9 = 90 % der Zeit.</b> „zu trocken" = unter P5, „zu feucht" = über P95.</p></div>
      <button class="cz-open" onclick="czEnter(${c.cell_nr})">25-m-Raster über Zelle ${c.cell_nr} anzeigen</button>
      <p class="note-p" style="margin-top:9px">Öffnet den 25-m-Umschalter über der Zelle (AWC, exceed_*, RZSM). „× Zelle" schließt wieder.</p>
    </div>
    `}


    ${isAOI?'':`
    <div class="section">
      <h3>Download <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Die Download-Buttons sind hier zur Veranschaulichung, was ein Geodatenportal bereitstellen könnte (Zellgeometrie + Kennwerte, cv-Zeitreihe je Jahr, 25-m-Raster). Für den Zugriff auf die Original- oder Ergebnisdaten bitte den Autor kontaktieren.</p></div>
      <div class="dl-grid">
        <button class="dl json" onclick="dlContact()">
          <span class="ico">GEOJSON</span>
          <span class="txt"><b>Zellgeometrie + Kennwerte</b><small>Demonstration · Kontakt</small></span>
        </button>
        <button class="dl csv" onclick="dlContact()">
          <span class="ico">CSV</span>
          <span class="txt"><b>cv-Zeitreihe (alle Szenarien)</b><small>Demonstration · Kontakt</small></span>
        </button>
        <button class="dl tif" onclick="dlContact()">
          <span class="ico">TIF</span>
          <span class="txt"><b>25-m-Raster (COG)</b><small>Demonstration · Kontakt</small></span>
        </button>
      </div>
    </div>
    `}

    <div class="section" style="border-bottom:none">
      <h3>Wissenschaftliche Ehrlichkeit <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Der Zell-/AOI-Korridor (obere Grenze) hat bei nur 12 Zellen ein breites Konfidenzintervall (statistisch instabil). Die globale Grenze 12,4 % dient als Referenz, nicht als lokale Messlatte (nicht 1:1 vergleichbar). Zeittrends sind ensemble-fragil; robust sind Größenordnung der Grenzen, die DHF&gt;CRF-Struktur und der Skalenbefund.</p></div>
      <p class="note-p">Alle Werte stammen aus den Ergebnisdateien (Disagg_v6). Der Zell-/AOI-Korridor ist statistisch unsicher (breites KI der oberen Grenze, nur 12 Zellen). Die globale Grenze (12,4 %) dient als konzeptioneller Bezug — nicht als lokale Messlatte (ein einzelner %-Wert ist nicht 1:1 vergleichbar). Die 25-m-Raster (Stufe 2) zeigen topografisch-edaphische Prädisposition, keine gemessene 25-m-Grenzüberschreitung.</p>
    </div>`;
  refreshYearMarker(); wirePanelSlider(); syncInterpButtons();
}
function showAOI(){
  if(typeof czActive!=='undefined' && czActive) czExit();
  selected=null;
  if(selBorder){ map.removeLayer(selBorder); selBorder=null; }
  Object.keys(cellLayers).forEach(nr=>cellLayers[nr].setStyle(cellStyle(cellByNr[+nr])));
  if(AOI) renderPanel(AOI, true);
}
function showProjectOverview(){
  if(typeof czActive!=='undefined' && czActive) czExit();
  selected=null; currentCell=null;
  if(selBorder){ map.removeLayer(selBorder); selBorder=null; }
  Object.keys(cellLayers).forEach(nr=>cellLayers[nr].setStyle(cellStyle(cellByNr[+nr])));
  document.getElementById('panel').innerHTML=`
    <div class="cell-head">
      <div class="cid">Projekt-Übersicht · Green-Water-Portal</div>
      <h2>Planetare Süßwassergrenze<span> · Green Water (lokal)</span></h2>
      <div class="chips"><span class="chip" style="background:#e8eef0;color:#1a1e1c;border:1px solid rgba(0,0,0,.08)">ISIMIP3a · Virkki et al. 2026</span></div>
    </div>
    <div class="section">
      <h3>Worum geht es?</h3>
      <p class="note-p">Demonstrator für die <b>planetare Süßwassergrenze (Green Water)</b>, lokal angewandt auf das <b>Palouse / Columbia-Basin</b> (USA). „Green Water" = pflanzenverfügbare Wurzelzonenfeuchte. Eine Fläche gilt als <b>außerhalb des Korridors</b>, wenn ihre Variabilität den natürlichen (vorindustriellen) Bereich verlässt — Bezug ist die globale Grenze <b>12,4 %</b>.</p>
    </div>
    <div class="section">
      <h3>Aufbau</h3>
      <p class="note-p"><b>Global:</b> das 0,5°-ISIMIP-Gitter (grau) — die Methode gilt weltweit. <b>Palouse:</b> die 12 untersuchten 0,5°-Zellen mit dem Gesamtergebnis; Klick auf eine Zelle öffnet ihre Werte, Zeitreihen, 25-m-Layer &amp; Downloads. <b>Fallstudie (Zelle 23):</b> auf 25 m disaggregiert — Endergebnis sind Schutzflächen-Kandidaten.</p>
    </div>
    <div class="section">
      <h3>Datenbasis</h3>
      <div class="kv"><span class="k">Forcing</span><span class="v">ISIMIP3a · obsclim/counterclim</span></div>
      <div class="kv"><span class="k">Ensemble</span><span class="v">4 GHM (HydroPy, WEB-DHM-SG, MIROC×2)</span></div>
      <div class="kv"><span class="k">Zeitraum</span><span class="v">1911–2019</span></div>
      <div class="kv"><span class="k">Disaggregation</span><span class="v">0,5° → 25 m (DEM/TWI/AWC)</span></div>
      <div class="kv"><span class="k">Boden / DEM</span><span class="v">NRCS SSURGO · USGS 3DEP</span></div>
    </div>
    <div class="section">
      <h3>Datenquellen &amp; Attribution</h3>
      <p class="note-p"><b>Bodenfeuchte/Klima:</b> ISIMIP3a (rootmoist), vier globale Hydrologiemodelle — HydroPy, WEB-DHM-SG, MIROC-INTEG-LAND (20CRv3-ERA5 &amp; -W5E5); Simulationsprotokoll Frieler et al. (2024). <b>Relief:</b> USGS 3DEP (Public Domain). <b>Boden:</b> NRCS SSURGO. <b>In-situ:</b> NRCS SCAN. <b>Interpretation:</b> PRISM Climate Group (Niederschlag/Temperatur, 1991–2020), LANID (Bewässerung), NLCD 2019 (MRLC). <b>Basiskarte „Karte":</b> © OpenStreetMap-Mitwirkende (ODbL). <b>Physiogr. Provinzen:</b> Fenneman (1946).</p>
      <p class="note-p"><b>Methodik:</b> Virkki et al. (2026); Wang-Erlandsson et al. (2022); Porkka et al. (2024); Richardson et al. (2023). Vollständige Versions- und Lizenzangaben auf Anfrage beim Autor.</p>
    </div>
    <div class="section" style="border-bottom:none">
      <h3>Loslegen</h3>
      <p class="note-p">Oben auf <b>„Palouse"</b> wechseln für die 12-Zellen-Übersicht mit Gesamtergebnis — und von dort in einzelne Zellen zoomen.</p>
    </div>`;
}

/* ---- Status-Gauge (Zell-Korridor + CI + globale Grenze) --------- */
function gauge(g,val){
  const pos=x=>Math.max(0,Math.min(100,x/AXIS_MAX*100));
  const v=pos(val), lo=pos(g.untere_pct), hi=pos(g.obere_pct), pb=pos(PB);
  return `<div class="gauge">
    <div class="corridor" style="left:${lo}%;width:${Math.max(0,hi-lo)}%" title="Zell-Korridor ${nf(g.untere_pct,1)}–${nf(g.obere_pct,1)} %"></div>
    <div class="pb anchor" style="left:${pb}%" title="globale PB · 12,4 %"></div>
    <div class="needle" id="gaugeNeedle" style="left:${v}%" title="Zustand ${nf(val,1)} %"></div>
    <span class="bound lo" style="left:${lo}%">${nf(g.untere_pct,1)} %</span>
    <div class="pbound" style="left:${hi}%" title="Zell-Grenze (P95) · ${nf(g.obere_pct,1)} %"><span>Grenze ${nf(g.obere_pct,1)} %</span></div>
    <span class="scale s0">0 %</span><span class="scale s1">${AXIS_MAX} %</span>
  </div>
  <div class="zonebar">
    <span class="zb below" style="flex:${lo}">unter Korridor</span>
    <span class="zb within" style="flex:${Math.max(0,hi-lo)}">natürlicher Zell-Korridor</span>
    <span class="zb above" style="flex:${100-hi}">über Korridor</span>
  </div>`;
}

/* ---- Trend-Tabelle ---------------------------------------------- */
function trendTable(trends){
  if(!trends||!trends.length) return '<p class="note-p">Keine Trenddaten.</p>';
  const rows=trends.map(t=>{
    const sig = (t.p_ess!=null && t.p_ess<0.05);
    const focus = t.fenster==='1990-2019';
    return `<div class="kv${focus?' focus':''}">
      <span class="k">${t.fenster}</span>
      <span class="v">${t.slope_pp_j>=0?'+':''}${nf(t.slope_pp_j,3)} pp/J
        <small style="color:${sig?'#1a9850':'#9a9a9a'}"> · p<sub>ess</sub>=${nf(t.p_ess,2)}${sig?' *':''}</small></span>
    </div>`;
  }).join('');
  return rows+`<p class="note-p" style="margin-top:6px">* p&lt;0,05 (autokorrelationskorrigiert). Fokusfenster 1990–2019 hervorgehoben.</p>`;
}

/* ---- Attribution-Balken ----------------------------------------- */
function attribution(a){
  if(!a) return '<p class="note-p">Keine Attributionsdaten.</p>';
  const items=[['DHF (menschlich)',a.DHF_pp,'#c1462b'],['CRF (klimatisch)',a.CRF_pp,'#4a90c2'],['historical (gesamt)',a.historical_pp,'#6b726c']];
  const mx=Math.max(1,...items.map(i=>Math.abs(i[1]||0)));
  const bars=items.map(([n,v,col])=>{
    const w=Math.abs(v||0)/mx*100, neg=(v||0)<0;
    return `<div class="attr-row">
      <span class="attr-k">${n}</span>
      <span class="attr-bar"><i style="width:${w}%;background:${col};${neg?'margin-left:auto;opacity:.6':''}"></i></span>
      <span class="attr-v">${v>=0?'+':''}${nf(v,2)} pp</span></div>`;
  }).join('');
  return `<div class="attr">${bars}</div>
    <p class="note-p" style="margin-top:6px">DHF/CRF-Verhältnis: <b>${nf(a.ratio,2)}</b> ${a.ratio>1?'(menschlich dominiert)':a.ratio<0?'(gegenläufig)':'(klimatisch dominiert)'}.</p>`;
}

/* ---- cv-Zeitreihe als SVG --------------------------------------- */
const CV_STYLE={baseline:['#9a9a9a','baseline (vorind.)',3,'4 3'],obsclim:['#1a9850','obsclim (beob.)',2.4,''],
                crf:['#4a90c2','crf',1.4,'2 2'],dhf:['#c1462b','dhf',1.4,'2 2']};
function cvChart(c){
  const cv=c.cv||{}; const keys=['baseline','obsclim'].filter(k=>cv[k]&&cv[k].length);
  if(!keys.length) return '<p class="note-p">Keine Zeitreihe.</p>';
  const W=300,H=110,mL=30,mR=8,mT=8,mB=18;
  let vmn=1e9,vmx=-1e9;
  keys.forEach(k=>cv[k].forEach(([,val])=>{if(val<vmn)vmn=val;if(val>vmx)vmx=val;}));
  const gb=(c.grenzen&&c.grenzen.obere_pct); if(gb!=null){ if(gb<vmn)vmn=gb; if(gb>vmx)vmx=gb; }
  const pad=(vmx-vmn)*0.1||1; vmn-=pad; vmx+=pad;
  const X=y=>mL+(y-Y_MIN)/((Y_MAX-Y_MIN)||1)*(W-mL-mR);
  const Y=v=>mT+(1-(v-vmn)/((vmx-vmn)||1))*(H-mT-mB);
  const paths=keys.map(k=>{
    const [col,,sw,dash]=CV_STYLE[k];
    const d=cv[k].map(([y,v],i)=>`${i?'L':'M'}${X(y).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
  }).join('');
  const yticks=[vmn,(vmn+vmx)/2,vmx].map(v=>`<text x="2" y="${(Y(v)+3).toFixed(1)}" class="cvt">${nf(v,0)}</text>
     <line x1="${mL}" y1="${Y(v).toFixed(1)}" x2="${W-mR}" y2="${Y(v).toFixed(1)}" class="cvg"/>`).join('');
  const xt=[Y_MIN,Math.round((Y_MIN+Y_MAX)/2),Y_MAX].map(y=>`<text x="${X(y).toFixed(1)}" y="${H-4}" class="cvt" text-anchor="middle">${y}</text>`).join('');
  const gline = gb!=null
    ? `<line x1="${mL}" y1="${Y(gb).toFixed(1)}" x2="${W-mR}" y2="${Y(gb).toFixed(1)}" class="cvbound"/>`
    : '';
  const leg=keys.map(k=>`<span><i style="background:${CV_STYLE[k][0]}"></i>${CV_STYLE[k][1]}</span>`).join('');
  return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" class="cvsvg" preserveAspectRatio="xMidYMid meet">
      ${yticks}${gline}<line class="cvmark" id="cvMark" x1="0" y1="${mT}" x2="0" y2="${H-mB}"/>${paths}${xt}
    </svg></div>
    <div class="spark-legend">${leg}</div>
    <div class="cvunit">Flächenanteil außerhalb Korridor (%) · x = Jahr</div>`;
}
function refreshYearMarker(){
  const m=document.getElementById('cvMark'); if(!m) return;
  const W=300,mL=30,mR=8;
  const x=mL+(Math.max(Y_MIN,Math.min(Y_MAX,year))-Y_MIN)/((Y_MAX-Y_MIN)||1)*(W-mL-mR);
  m.setAttribute('x1',x.toFixed(1)); m.setAttribute('x2',x.toFixed(1));
}
function wirePanelSlider(){
  const sl=document.getElementById('yrSlider'), out=document.getElementById('yrOut'), anc=document.getElementById('anchors');
  const upd=()=>{ if(out) out.textContent=year; if(sl) sl.value=year;
    if(anc) anc.querySelectorAll('button').forEach(x=>x.classList.toggle('on',+x.dataset.yr===year));
    refreshYearMarker(); updateStatusYear(); };
  if(sl) sl.addEventListener('input',()=>{ year=+sl.value; upd(); });
  if(anc) anc.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; year=+b.dataset.yr; upd(); });
  const up=document.getElementById('yrUp'), dn=document.getElementById('yrDown');
  if(up) up.addEventListener('click',()=>{ if(year<Y_MAX){ year=year+1; upd(); } });
  if(dn) dn.addEventListener('click',()=>{ if(year>Y_MIN){ year=year-1; upd(); } });
  const mt=document.getElementById('yrModeToggle');
  if(mt){
    mt.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x.dataset.mode===yrMode));
    mt.addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return;
      mt.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
      yrMode=b.dataset.mode; updateStatusYear(); });
  }
  updateStatusYear();
}

/* ---- Downloads (echte Exporte) ---------------------------------- */
function saveBlob(name,content,type){
  const b=new Blob([content],{type}), u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}
function dlCellGeoJSON(nr){
  const f=GEO.features.find(f=>f.properties.cell_nr===nr);
  saveBlob(`zelle_${nr}.geojson`,JSON.stringify({type:'FeatureCollection',features:[f]},null,2),'application/geo+json');
}
function dlCellCSV(nr){
  const c=cellByNr[nr], cv=c.cv||{}, sz=Object.keys(cv);
  const years=[...new Set(sz.flatMap(k=>cv[k].map(([y])=>y)))].sort((a,b)=>a-b);
  const idx={}; sz.forEach(k=>{idx[k]={}; cv[k].forEach(([y,v])=>idx[k][y]=v);});
  const rows=['jahr,'+sz.join(',')];
  years.forEach(y=>rows.push(y+','+sz.map(k=>idx[k][y]!=null?idx[k][y]:'').join(',')));
  saveBlob(`zelle_${nr}_cv_zeitreihe.csv`,rows.join('\n'),'text/csv');
}
window.dlCellGeoJSON=dlCellGeoJSON; window.dlCellCSV=dlCellCSV;

// Oeffentliche Version: Download-Buttons zeigen ein Kontakt-Popup statt echter Exporte (Demonstrationscharakter).
function dlContact(){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(20,25,20,.55);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML=`<div style="background:#fff;max-width:430px;border-radius:10px;padding:22px 24px;box-shadow:0 8px 40px rgba(0,0,0,.3);font:14px/1.55 system-ui,-apple-system,sans-serif;color:#1a1e1c">`
    +`<h3 style="margin:0 0 8px;font-size:16px">Download — Demonstration</h3>`
    +`<p style="margin:0 0 10px">Die Download-Funktionen zeigen hier nur, was ein Geodatenportal leisten könnte. Für den Zugriff auf die Original- oder Ergebnisdaten bitte den Autor kontaktieren:</p>`
    +`<p style="margin:0 0 16px"><b>Ben Schmidt</b><br><a href="mailto:ben-jonas.schmidt@student.uni-tuebingen.de">ben-jonas.schmidt@student.uni-tuebingen.de</a></p>`
    +`<button type="button" style="border:0;background:#1a9850;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;font:14px system-ui">Schließen</button></div>`;
  ov.addEventListener('click',e=>{ if(e.target===ov||e.target.tagName==='BUTTON') ov.remove(); });
  document.body.appendChild(ov);
}
window.dlContact=dlContact;

/* ---- PNG-Export der Zellübersicht ------------------------------- */
function exportPNG(){
  if(!DATA) return;
  const s=2,W=980,H=430;
  const cv=document.createElement('canvas'); cv.width=W*s; cv.height=H*s;
  const x=cv.getContext('2d'); x.scale(s,s);
  x.fillStyle='#fbfaf6'; x.fillRect(0,0,W,H);
  x.fillStyle='#1a1e1c'; x.font='600 20px system-ui,sans-serif';
  x.fillText('Green-Water-Status — Palouse / Columbia-Basin',36,40);
  x.fillStyle='#838b84'; x.font='11px ui-monospace,monospace';
  x.fillText('Anteil Fläche außerhalb Korridor (%) · Mittel 1990–2019 je Zelle · vgl. globale Grenze 12,4 %',36,58);
  // 2×6-Gitter aus center_lat/lon
  const cells=DATA.cells.slice().sort((a,b)=>(b.center_lat-a.center_lat)||(a.center_lon-b.center_lon));
  const lons=[...new Set(cells.map(c=>c.center_lon))].sort((a,b)=>a-b);
  const lats=[...new Set(cells.map(c=>c.center_lat))].sort((a,b)=>b-a);
  const gx=36,gy=78,cw=150,ch=140,gap=4;
  cells.forEach(c=>{
    const ci=lons.indexOf(c.center_lon), ri=lats.indexOf(c.center_lat);
    const px=gx+ci*(cw+gap), py=gy+ri*(ch+gap), v=mean9019(c);
    x.fillStyle=riskColor(v); x.fillRect(px,py,cw,ch);
    x.strokeStyle='#fbfaf6'; x.lineWidth=2; x.strokeRect(px,py,cw,ch);
    x.fillStyle='#fff'; x.font='600 19px ui-monospace,monospace'; x.textAlign='center';
    x.fillText(`${nf(v,1)} %`,px+cw/2,py+ch/2+2);
    x.font='11px ui-monospace,monospace'; x.fillStyle='rgba(255,255,255,.9)';
    x.fillText('Zelle '+c.cell_nr,px+cw/2,py+ch/2+22); x.textAlign='left';
  });
  x.fillStyle='#838b84'; x.font='9.5px ui-monospace,monospace';
  x.fillText('ISIMIP3a obsclim · Disagg_v6_virkki_soilonly · Grenze n. Virkki et al. 2026 · Prototyp',36,H-14);
  saveBlob('greenwater_palouse_uebersicht.png',cv.toDataURL('image/png'));
}

/* ---- Resizer Karte ↔ Panel (aus dem Prototyp) ------------------- */
function wireResizer(){
  const mainEl=document.querySelector('.main');
  const rz=document.getElementById('resizer');
  if(!mainEl||!rz) return;
  const MIN=300, MAXf=()=>Math.min(820,window.innerWidth-380);
  function setW(w){ const cw=Math.max(MIN,Math.min(MAXf(),w));
    mainEl.style.setProperty('--panel-w',cw+'px'); requestAnimationFrame(()=>map.invalidateSize({animate:false})); }
  rz.addEventListener('pointerdown',e=>{
    if(window.innerWidth<=900) return; e.preventDefault(); rz.classList.add('drag');
    try{rz.setPointerCapture(e.pointerId);}catch(_){}
    const mv=ev=>{const r=mainEl.getBoundingClientRect(); setW(r.right-ev.clientX-3);};
    const up=()=>{rz.classList.remove('drag'); document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up);};
    document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);
  });
  rz.addEventListener('dblclick',()=>setW(400));
}

/* ================================================================
   STUFE 2 · Fallstudie Zelle 23 (10 km) — 25-m-Raster via COG
   Hillshade-Unterlage + Fach-Layer (70 %) mit QML-Farbrampen.
   ================================================================ */
// Farbrampen 1:1 aus den QGIS-QMLs (Farbschematas/*_10km.qml, DEM: Backup_DEM.qml)
const RAMPS = {
  dem:        {unit:'m',        dec:0, stops:[[415,'#050603'],[428,'#373724'],[441,'#183e29'],[454,'#346945'],[467,'#3e8a59'],[480,'#6ca363'],[493,'#a5ba6f'],[506,'#e7d57a'],[519,'#c7a75c'],[532,'#b0783a'],[545,'#d77f3f']]},
  slope:      {unit:'°',        dec:1, stops:[[0.2008,'#fff5f0'],[4.0035,'#fcae91'],[7.8063,'#fb6a4a'],[11.6091,'#cb181d'],[15.4119,'#67000d']]},
  twi:        {unit:'ln(a/tanβ)',dec:1,stops:[[5.2476,'#f7fbff'],[7.3683,'#c6dbef'],[9.4889,'#6baed6'],[11.6096,'#2171b5'],[13.7302,'#08306b']]},
  awc:        {unit:'%',     dec:1, stops:[[7.26,'#ffffd4'],[10.93,'#fed98e'],[14.60,'#fe9929'],[18.27,'#cc4c02'],[21.94,'#8c2d04']]},
  rzsm:       {unit:'mm',       dec:0, stops:[[201.13,'#ffffcc'],[326.51,'#a1dab4'],[451.90,'#41b6c4'],[577.28,'#2c7fb8'],[702.66,'#253494']]},
  exceed_frac:{unit:'Anteil',   dec:2, stops:[[0.115,'#ffffb2'],[0.1542,'#fecc5c'],[0.1934,'#fd8d3c'],[0.2326,'#f03b20'],[0.2719,'#bd0026']]},
  exceed_dry: {unit:'Anteil',   dec:2, stops:[[0.0218,'#fff7ec'],[0.0788,'#fdbb84'],[0.1359,'#fc8d59'],[0.1929,'#e34a33'],[0.25,'#b30000']]},
  exceed_wet: {unit:'Anteil',   dec:2, stops:[[0.0139,'#fff7fb'],[0.0328,'#d0d1e6'],[0.0518,'#74a9cf'],[0.0707,'#2b8cbe'],[0.0897,'#023858']]},
  rzsm_relchange:{unit:'%', dec:0, stops:[[-0.1199,'#8c510a'],[-0.0799,'#d8b365'],[-0.0400,'#f6e8c3'],[0,'#f5f5f5'],[0.0400,'#c7eae5'],[0.0799,'#5ab4ac'],[0.1199,'#01665e']]},
};
const FS_LAYERS = [
  {key:'dem',name:'Höhe (DEM)'},{key:'slope',name:'Hangneigung'},
  {key:'twi',name:'TWI (Feuchteindex)'},{key:'awc',name:'AWC (nutzbare Feldkapazität)'},
  {key:'rzsm',name:'Wurzelzonenfeuchte (mm)'},{key:'rzsm_relchange',name:'RZSM rel. Änderung [%]'},
  {key:'exceed_frac',name:'Anteil der Zeit außerhalb (gesamt)'},{key:'exceed_dry',name:'Anteil der Zeit zu trocken (unter P5)'},{key:'exceed_wet',name:'Anteil der Zeit zu feucht (über P95)'},
];
// --- Zellenebene (Stufe 2b): AOI-weite Disagg-Layer pro Zelle, Rampen an AOI-Wertebereich skaliert ---
const rampStops=(cols,mn,mx)=>cols.map((c,i)=>[mn+(mx-mn)*i/(cols.length-1),c]);
const PCT_KEYS = new Set(['rzsm_relchange','exceed_frac','exceed_dry','exceed_wet']);  // als % (×100) anzeigen
// Einheitliche Farbschemata (identisch zur Fallstudie, wo geteilt). Domain kommt PRO ZELLE aus cell_stats (2/98).
const COLORS_CELL = {
  dem:        {unit:'m',   dec:0, cols:['#050603','#183e29','#3e8a59','#a5ba6f','#e7d57a','#c7a75c','#d77f3f']},
  slope:      {unit:'°',   dec:1, cols:['#fff5f0','#fcae91','#fb6a4a','#cb181d','#67000d']},
  twi:        {unit:'',    dec:1, cols:['#f7fbff','#c6dbef','#6baed6','#2171b5','#08306b']},
  awc:        {unit:'%',dec:1, cols:['#ffffd4','#fed98e','#fe9929','#cc4c02','#8c2d04']},
  rzsm_mm:    {unit:'mm',  dec:0, cols:['#ffffcc','#a1dab4','#41b6c4','#2c7fb8','#253494']},
  rzsm_zanom: {unit:'σ',   dec:1, cols:['#8c510a','#d8b365','#f6e8c3','#f5f5f5','#c7eae5','#5ab4ac','#01665e']},
  rzsm_zanom_1911_1930:{unit:'σ',dec:1, cols:['#8c510a','#d8b365','#f6e8c3','#f5f5f5','#c7eae5','#5ab4ac','#01665e']},
  rzsm_zanom_1951_1980:{unit:'σ',dec:1, cols:['#8c510a','#d8b365','#f6e8c3','#f5f5f5','#c7eae5','#5ab4ac','#01665e']},
  rzsm_relchange:{unit:'', dec:2, cols:['#8c510a','#d8b365','#f6e8c3','#f5f5f5','#c7eae5','#5ab4ac','#01665e']},
  exceed_frac:{unit:'',    dec:2, cols:['#ffffb2','#fecc5c','#fd8d3c','#f03b20','#bd0026']},
  exceed_dry: {unit:'',    dec:2, cols:['#fff7ec','#fdbb84','#fc8d59','#e34a33','#b30000']},
  exceed_wet: {unit:'',    dec:2, cols:['#fff7fb','#d0d1e6','#74a9cf','#2b8cbe','#023858']},
};
const CELL_LAYERS = [
  {key:'dem',name:'Höhe (DEM)'},{key:'slope',name:'Hangneigung'},{key:'twi',name:'TWI (Feuchteindex)'},
  {key:'awc',name:'AWC (nutzbare Feldkapazität)'},{key:'rzsm_mm',name:'Wurzelzonenfeuchte (mm)'},
  {key:'rzsm_relchange',name:'RZSM rel. Änderung [%]'},
  {key:'exceed_frac',name:'Anteil der Zeit außerhalb (gesamt)'},{key:'exceed_dry',name:'Anteil der Zeit zu trocken (unter P5)'},{key:'exceed_wet',name:'Anteil der Zeit zu feucht (über P95)'},
];
let CELL_STATS=null;   // data/cell_stats.json: pro Zelle+Variable [min,max] (2/98-Perzentil)
function cellDomain(key,nr){
  const s=CELL_STATS&&CELL_STATS[String(nr)]&&CELL_STATS[String(nr)][key];
  if(s && s[1]>s[0]) return s;
  return COLORS_CELL[key].cols[0]==='#8c510a'?[-1,1]:[0,1];
}
function cellRamp(key,nr){ const C=COLORS_CELL[key],d=cellDomain(key,nr);
  return {unit:C.unit,dec:C.dec,stops:rampStops(C.cols,d[0],d[1])}; }
function cellColorFn(key,nr){ return makeColorFn(key,{[key]:cellRamp(key,nr)}); }
const hex2rgb = h => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
function makeColorFn(key,R){
  R=R||RAMPS;
  const st = R[key].stops.map(s=>[s[0],hex2rgb(s[1])]);
  const lo=st[0], hi=st[st.length-1];
  return v=>{
    if(v==null||isNaN(v)||v<=-9998) return null;      // NoData -> transparent
    if(v<=lo[0]) return `rgb(${lo[1].join(',')})`;
    if(v>=hi[0]) return `rgb(${hi[1].join(',')})`;
    for(let i=0;i<st.length-1;i++){
      const [a,ca]=st[i],[b,cb]=st[i+1];
      if(v>=a&&v<=b){ const t=(v-a)/(b-a);
        return `rgb(${ca.map((x,k)=>Math.round(x+(cb[k]-x)*t)).join(',')})`; }
    }
  };
}
function rampGradient(key,R){
  R=R||RAMPS;
  const r=R[key], mn=r.stops[0][0], mx=r.stops[r.stops.length-1][0];
  return 'linear-gradient(90deg,'+r.stops.map(s=>`${s[1]} ${((s[0]-mn)/(mx-mn)*100).toFixed(1)}%`).join(',')+')';
}

// Hillshade-Unterlage: false = nur Fach-Layer opak (einfach, robust). true = Relief + 70% (Uebersicht §5).
const FS_HILLSHADE=false;
let fsActive=false, fsHillshade=null, fsLayer=null, fsCurrentKey='dem',
    fsBounds=null, fsLegendSaved=null;
const fsLayers={};
let FS_STATS=null;   // Fallstudie: Slope/TWI=P2/P98, Rest=Min/Max              // key -> GeoRasterLayer: alle einmal hinzugefuegt, Umschalten nur per Deckkraft
const fsVisOpacity=()=>FS_HILLSHADE?0.7:1;
let fsFrame=null;   // schwarzer Rahmen um den Fallstudie-Bereich
const grCache={};
function loadGeoraster(url){
  if(grCache[url]) return Promise.resolve(grCache[url]);
  // COG komplett in den Speicher laden statt lazy per URL/Range (Worker-Fetch scheitert
  // in Safari an relativen Pfaden: 'URL is not valid or contains user credentials').
  // Dateien sind klein (<=700 KB) -> kein Nachteil, dafuer browseruebergreifend robust.
  return fetch(url)
    .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' '+r.statusText+' bei '+url); return r.arrayBuffer(); })
    .then(ab=>parseGeoraster(ab))
    .then(g=>{ grCache[url]=g; return g; });
}

/* ===== Interpretation-Overlays (AOI-weit, COG, halbtransparent) ===== */
const INTERP = {
  prism_ppt:{ name:'Klima · Jahresniederschlag', unit:'mm', file:'cog/aoi/prism_ppt.tif?v=2',
    kind:'ramp', dmn:[180,560], stops:['#ffffcc','#a1dab4','#41b6c4','#2c7fb8','#253494'],
    note:'PRISM 30-J-Normal 1991–2020 · 800 m' },
  lanid:{ name:'Bewässerung · Jahre bewässert', unit:'J', file:'cog/aoi/lanid_irrfreq.tif?v=2',
    kind:'ramp', dmn:[1,21], stops:['#c6dbef','#6baed6','#2171b5','#08306b'], mask0:true,
    note:'LANID 1997–2017 · 0 = nicht bewässert (transparent)' },
  nlcd:{ name:'Landnutzung (NLCD 2019)', file:'cog/aoi/nlcd2019.tif?v=2', kind:'class',
    classes:{11:['#476BA0','Wasser'],21:['#DDC9C9','bebaut (offen)'],22:['#D89382','bebaut (gering)'],
      23:['#ED0000','bebaut (mittel)'],24:['#AA0000','bebaut (hoch)'],31:['#B2ADA3','Fels/kahl'],
      41:['#68AA63','Laubwald'],42:['#1C6330','Nadelwald'],43:['#B5C98E','Mischwald'],52:['#CCBA7C','Strauch'],
      71:['#E2E2C1','Grasland'],81:['#DBD83D','Weide/Heu'],82:['#AA7028','Ackerland'],
      90:['#BAD8EA','Wald-Feuchtgeb.'],95:['#70A3BA','Feuchtgeb.']},
    note:'NLCD trennt nicht bewässert/Dryland (dafür LANID)' },
};
const _h2r = h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
function interpColorFn(key){
  const L=INTERP[key];
  if(L.kind==='class'){
    const m={}; for(const k in L.classes) m[+k]=_h2r(L.classes[k][0]);
    return v=>{ let x=v[0]; if(x==null||isNaN(x)) return null; x=Math.round(x); return (x in m)?`rgb(${m[x].join(',')})`:null; };
  }
  const st=L.stops.map(_h2r), lo=L.dmn[0], hi=L.dmn[1];
  return v=>{ v=v[0];
    if(v==null||isNaN(v)||v<=-9998) return null;
    if(L.mask0 && (v<lo || v>=22)) return null;                 // Bewässerungs-Maske: nur 1..21
    const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo))), f=t*(st.length-1),
          i=Math.min(st.length-2,Math.floor(f)), r=f-i;
    const c=st[i].map((x,k)=>Math.round(x+(st[i+1][k]-x)*r));
    return `rgb(${c.join(',')})`; };
}
// Es ist immer nur GENAU EINE Interpretation-Ebene auf der Karte: beim Umschalten
// wird die bisherige entfernt und die neue SICHTBAR (opacity 0.6) hinzugefuegt.
// Ein frisch hinzugefuegter sichtbarer GeoRasterLayer zeichnet zuverlaessig; das
// Vorladen mehrerer Ebenen mit opacity 0 zeichnete ohne View-Wechsel nicht (die
// Fallstudie/Zellen umgehen das per fitBounds/setView, das es hier nicht gibt).
const interpLayers={};    // key -> GeoRasterLayer (Cache; nur die aktive haengt an der Karte)
let interpCurrent=null;   // sichtbares Overlay (oder null)
let interpTopKey=null;    // fuer Legende (=interpCurrent)
function syncInterpButtons(){
  document.querySelectorAll('#interpControl .ip-lyr').forEach(b=>b.classList.toggle('on',interpCurrent===b.dataset.k));
}
async function interpGetLayer(key){
  if(interpLayers[key]) return interpLayers[key];
  const gr=await loadGeoraster(INTERP[key].file);
  // zIndex bewusst hoch: innerhalb der tile-pane sicher ÜBER der Basiskarte,
  // aber weiterhin UNTER den Zell-Vektoren/-Beschriftungen (die in höheren Panes liegen).
  interpLayers[key]=new GeoRasterLayer({georaster:gr, opacity:0.6, resolution:128, zIndex:5000, keepBuffer:8,
    pixelValuesToColorFn:interpColorFn(key)});
  return interpLayers[key];
}
async function interpToggle(key){
  const next=(interpCurrent===key)?null:key;   // erneuter Klick blendet aus
  if(interpCurrent && interpLayers[interpCurrent]) map.removeLayer(interpLayers[interpCurrent]);
  interpCurrent=next; interpTopKey=next;
  if(next){
    try{
      const l=await interpGetLayer(next);
      l.setOpacity(0.6); l.addTo(map);
      if(typeof l.redraw==='function') l.redraw();   // Zeichnen erzwingen (kein View-Wechsel noetig)
    }catch(e){ console.error('Interpretation-COG konnte nicht geladen werden:',next,e);
      interpCurrent=null; interpTopKey=null; }
  }
  interpRenderLegend(); syncInterpButtons();
}
function interpClear(){
  if(interpCurrent && interpLayers[interpCurrent]) map.removeLayer(interpLayers[interpCurrent]);
  interpCurrent=null; interpTopKey=null;
  interpRenderLegend(); syncInterpButtons();
}
function interpRenderLegend(){
  const leg=document.getElementById('interpLegend'); if(!leg) return;
  if(!interpTopKey){ leg.hidden=true; leg.innerHTML=''; return; }
  const L=INTERP[interpTopKey];
  if(L.kind==='class'){
    const rows=Object.values(L.classes).map(([c,lab])=>`<div class="lg-row"><span class="lg-sw" style="background:${c}"></span>${lab}</div>`).join('');
    leg.innerHTML=`<h4><span>${L.name}</span></h4><div class="lg-classes">${rows}</div><div class="note">${L.note}</div>`;
  }else{
    const grad='linear-gradient(90deg,'+L.stops.join(',')+')';
    leg.innerHTML=`<h4><span>${L.name}</span></h4><div class="ramp-lbl"><span>${L.dmn[0]} ${L.unit}</span><span>${L.dmn[1]} ${L.unit}${interpTopKey==='lanid'?'+':''}</span></div>`
      +`<div class="ramp" style="background:${grad}"></div><div class="note">${L.note}</div>`;
  }
  leg.hidden=false;
}
window.interpToggle=interpToggle;

// Alle Fach-Layer einmalig laden und (unsichtbar, opacity 0) zur Karte hinzufuegen.
// Gerendert werden sie durch das fitBounds beim Eintritt (das nachweislich zeichnet).
async function fsEnsureLayers(){
  if(!FS_STATS){ try{ FS_STATS=await fetch('data/fallstudie_stats.json').then(r=>r.json()); }catch(_){ FS_STATS={}; } }
  if(FS_HILLSHADE && !fsHillshade){
    const hg=await loadGeoraster('cog/fallstudie/hillshade.tif');
    fsHillshade=new GeoRasterLayer({georaster:hg, opacity:1, resolution:256, zIndex:400,
      pixelValuesToColorFn:v=>(v[0]==null||v[0]===0)?null:`rgb(${v[0]},${v[0]},${v[0]})`});
    fsHillshade.addTo(map); fsBounds=fsHillshade.getBounds();
  }
  await Promise.all(FS_LAYERS.map(async l=>{
    if(fsLayers[l.key]) return;
    const gr=await loadGeoraster('cog/fallstudie/'+l.key+'.tif');
    const gl=new GeoRasterLayer({georaster:gr, opacity:0, resolution:256, zIndex:450,
      pixelValuesToColorFn:fsColorFn(l.key)});
    fsLayers[l.key]=gl; gl.addTo(map);
  }));
  if(!fsBounds && fsLayers[fsCurrentKey]) fsBounds=fsLayers[fsCurrentKey].getBounds();
}
// Umschalten = nur Deckkraft setzen (kein Neu-Rendern, das in Safari scheitern koennte).
async function fsShowLayer(key){
  fsCurrentKey=key;
  await fsEnsureLayers();
  Object.keys(fsLayers).forEach(k=>fsLayers[k].setOpacity(k===key?fsVisOpacity():0));
  updateRasterLegend(key); updateFsButtons(key);
}
async function fsEnter(){
  const ctrl=document.getElementById('fsControl');
  fsCurrentKey='dem';   // beim Öffnen immer mit DEM starten
  setZoomGranularity(true);   // feine Zoomstufen in der Fallstudie
  try{
    ctrl.classList.add('on','loading');
    if(typeof czActive!=='undefined' && czActive) czExit();
    await fsEnsureLayers();
    if(fsBounds){   // fixer Zoom 12 (= 5 km) + Fallstudie mittig im Kartenpanel; View-Wechsel rendert alle Layer
      map.setView(fsBounds.getCenter(), 12, {animate:false});
    }
    if(fsFrame) map.removeLayer(fsFrame);
    if(fsBounds) fsFrame=L.rectangle(fsBounds,{color:'#1a1e1c',weight:3,fill:false,interactive:false}).addTo(map);
    Object.keys(fsLayers).forEach(k=>fsLayers[k].setOpacity(k===fsCurrentKey?fsVisOpacity():0));
    updateRasterLegend(fsCurrentKey); updateFsButtons(fsCurrentKey);
    fsActive=true;
    document.getElementById('fsBtn').classList.add('active');
    if(selBorder){ map.removeLayer(selBorder); }
    ctrl.classList.remove('loading');
  }catch(e){
    ctrl.classList.remove('on','loading');
    alert('Fallstudie-COGs noch nicht gefunden.\n\nBitte zuerst das Skript ausführen:\n'+
          'bash ".../Webportal/tools/make_cogs_fallstudie.sh"\n\n('+e.message+')');
  }
}
function fsExit(){
  fsActive=false;
  fsClearVectors();
  Object.keys(fsLayers).forEach(k=>{ map.removeLayer(fsLayers[k]); delete fsLayers[k]; });
  fsLayer=null;
  if(fsFrame){ map.removeLayer(fsFrame); fsFrame=null; }
  if(fsHillshade){ map.removeLayer(fsHillshade); fsHillshade=null; }
  document.getElementById('fsControl').classList.remove('on');
  document.getElementById('fsBtn').classList.remove('active');
  if(fsLegendSaved!=null){ const l=document.getElementById('legend'); if(l) l.innerHTML=fsLegendSaved; }
  fsBounds=null;
  setZoomGranularity(false);   // zurueck zu ganzen Zoomstufen
  fitAOI();
}
function updateFsButtons(key){
  document.querySelectorAll('#fsControl .fs-lyr').forEach(b=>b.classList.toggle('on',b.dataset.k===key));
}
// Fallstudie-Rampe: QML-Farben, aber Domain datengetrieben (Slope/TWI=P2/P98, sonst Min/Max)
function fsRamp(key){
  const R=RAMPS[key], cols=R.stops.map(x=>x[1]);
  let d=(FS_STATS&&FS_STATS[key]&&FS_STATS[key][1]>FS_STATS[key][0]) ? FS_STATS[key] : [R.stops[0][0],R.stops[R.stops.length-1][0]];
  if(cols[0]==='#8c510a'){ const M=Math.max(Math.abs(d[0]),Math.abs(d[1])); d=[-M,M]; }  // divergierend → symmetrisch um 0
  return {unit:R.unit, dec:R.dec, stops:rampStops(cols,d[0],d[1])};
}
function fsColorFn(key){ return makeColorFn(key,{[key]:fsRamp(key)}); }
function updateRasterLegend(key){
  const leg=document.getElementById('legend'); if(!leg) return;
  if(fsLegendSaved==null) fsLegendSaved=leg.innerHTML;
  const r=fsRamp(key), L=FS_LAYERS.find(l=>l.key===key);
  const mn=r.stops[0][0], mx=r.stops[r.stops.length-1][0];
  const u=v=> PCT_KEYS.has(key) ? nf(v*100,0)+' %' : nf(v,r.dec)+(r.unit==='Anteil'?'':' '+r.unit);
  const scaleNote=['twi','slope'].includes(key)?'P2/P98 (Artefaktdämpfung)':key==='rzsm_relchange'?'symmetrisch um 0 (±P98)':'Min/Max';
  leg.innerHTML=`<h4><span>${L.name}</span></h4>
    <div class="ramp-lbl"><span>${u(mn)}</span><span>${u(mx)}</span></div>
    <div class="ramp" style="background:${rampGradient(key,{[key]:r})}"></div>
    <div class="note">Fallstudie Zelle 23 · 25 m · Skala = ${scaleNote}.</div>`;
}
// ------ Kontext-Text der Fallstudie (bei Bedarf hier anpassen) ------
const FS_CONTEXT_HTML = `
  <h4>Vom Zell-Signal zum räumlichen Mehrwert</h4>
  <ul>
    <li>Auf <b>Zellebene (0,5°)</b> kennen wir die Entwicklung von Green Water über die Zeit.</li>
    <li>Durch die <b>Disaggregation</b> sehen wir die räumliche Textur/Tendenzen innerhalb der Zelle → räumlicher Informationsgewinn.</li>
    <li>Was kann man damit praktisch anfangen? → ein hypothetisches Szenario.</li>
  </ul>
  <h4>Das Szenario (frei erfunden)</h4>
  <ul>
    <li>Eine Gemeinde will <b>10 %</b> der hier gezeigten Fläche (10×10 km) als <b>Green-Water-Schutzgebiet</b> ausweisen.</li>
    <li>Ausgewählt werden sollen die schützenswertesten Flächen — festgemacht an der größten Abweichung, also dem <b>höchsten Überschreitungsanteil</b> (am häufigsten außerhalb des natürlichen Korridors).</li>
  </ul>
  <h4>Die Kriterien</h4>
  <ul>
    <li><b>Umfang:</b> 10 % der betrachteten Fläche (Budget)</li>
    <li><b>Priorität:</b> höchster Überschreitungsanteil [%] — von der stärksten Abweichung abwärts</li>
    <li><b>Mindestgröße:</b> &gt; 5 ha pro Parzelle (kompakt, praktikabel)</li>
    <li><b>Hang &gt; 1°:</b> schließt flache Artefaktflächen aus</li>
  </ul>
  <h4>→ Ergebnis: der Schutzlayer</h4>
  <ul>
    <li>Die <b>Vektormaske</b> zeigt die vorgeschlagenen Flächen → Fläche (ha) + deren Überschreitungsanteil (%).</li>
  </ul>`;
function initFallstudie(){
  const toolset=document.querySelector('.toolset');
  if(!toolset) return;
  // Fallstudie + zugehöriger Info-Button als EINE verbundene Gruppe, damit
  // erkennbar ist, dass die Info zur Fallstudie gehört.
  const grp=document.createElement('span');
  grp.className='btn-group'; grp.id='fsGroup';
  const btn=document.createElement('button');
  btn.className='btn'; btn.id='fsBtn'; btn.title='Fallstudie Zelle 23 · 25-m-Raster';
  btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13"/></svg>Fallstudie';
  grp.appendChild(btn);

  // Info-Button (Kontext & Hintergrund) — sichtbar an die Fallstudie angedockt
  const infoBtn=document.createElement('button');
  infoBtn.className='btn btn-linked'; infoBtn.id='fsInfoBtn'; infoBtn.title='Kontext & Hintergrund zur Fallstudie';
  infoBtn.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.4v.2"/></svg>Info';
  grp.appendChild(infoBtn);
  toolset.insertBefore(grp, toolset.querySelector('.proto-tag'));
  const iBack=document.createElement('div');
  iBack.className='modal-back'; iBack.id='fsInfoBack';
  iBack.innerHTML=`<div class="modal info-modal">
    <div class="modal-bar"><span class="mtitle">Fallstudie Zelle 23 — Kontext & Szenario</span><span class="mspacer"></span>
      <button class="mini" id="fsInfoClose"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Schließen</button></div>
    <div class="info-body">${FS_CONTEXT_HTML}</div></div>`;
  document.body.appendChild(iBack);
  infoBtn.addEventListener('click',()=>iBack.classList.add('open'));
  document.getElementById('fsInfoClose').addEventListener('click',()=>iBack.classList.remove('open'));
  iBack.addEventListener('click',e=>{ if(e.target.id==='fsInfoBack') iBack.classList.remove('open'); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') iBack.classList.remove('open'); });

  const ctrl=document.createElement('div');
  ctrl.className='fs-control'; ctrl.id='fsControl';
  ctrl.innerHTML=`<div class="fs-head"><b>Fallstudie · 25-m-Layer</b>
      <button class="fs-close" id="fsClose" title="zurück zur AOI">× AOI</button></div>
    <div class="fs-layers">${FS_LAYERS.map(l=>
      `<button class="fs-lyr${l.key===fsCurrentKey?' on':''}${['twi','awc'].includes(l.key)?' static':''}" data-k="${l.key}">${l.name}</button>`).join('')}</div>
    <div class="fs-vec">
      <button class="fs-vlyr" data-v="boden">Bodentypen</button>
      <button class="fs-vlyr" data-v="schutz">Schutzflächen</button>
    </div>`;
  (document.querySelector('.map-wrap')||document.body).appendChild(ctrl);

  btn.addEventListener('click',()=>{ fsActive?fsExit():fsEnter(); });
  document.getElementById('fsClose').addEventListener('click',fsExit);
  ctrl.querySelectorAll('.fs-lyr').forEach(b=>b.addEventListener('click',()=>{
    if(ctrl.classList.contains('loading')) return;
    ctrl.classList.add('loading');
    fsShowLayer(b.dataset.k)
      .catch(e=>{ console.error('[Fallstudie]',b.dataset.k,e); alert('Layer "'+b.dataset.k+'" konnte nicht geladen werden:\n'+e.message); })
      .finally(()=>ctrl.classList.remove('loading'));
  }));
  ctrl.querySelectorAll('.fs-vlyr').forEach(b=>b.addEventListener('click',()=>{
    fsToggleVec(b.dataset.v,b).catch(e=>alert('Vektor "'+b.dataset.v+'": '+e.message));
  }));
}


/* ================================================================
   STUFE 2b · Zellenebene — 25-m-Disagg-Layer pro Zelle (opak)
   Trigger: Button im Zell-Panel (czEnter). Rahmen = bestehender Auswahl-Rand.
   ================================================================ */
let czActive=false, czCellNr=null, czCurrentKey='dem', czBounds=null, czLegendSaved=null;
const czLayers={};
function czInit(){
  if(document.getElementById('czControl')) return;
  const ctrl=document.createElement('div');
  ctrl.className='fs-control'; ctrl.id='czControl';
  ctrl.innerHTML=`<div class="fs-head"><b id="czTitle">Zelle · 25-m-Raster</b>
      <button class="fs-close" id="czClose" title="Raster schließen">× Zelle</button></div>
    <div class="fs-layers">${CELL_LAYERS.map(l=>
      `<button class="fs-lyr${['twi','awc'].includes(l.key)?' static':''}" data-k="${l.key}">${l.name}</button>`).join('')}</div>`;
  (document.querySelector('.map-wrap')||document.body).appendChild(ctrl);
  document.getElementById('czClose').addEventListener('click',czExit);
  ctrl.querySelectorAll('.fs-lyr').forEach(b=>b.addEventListener('click',()=>{
    if(ctrl.classList.contains('loading')) return;
    ctrl.classList.add('loading');
    czShowLayer(b.dataset.k)
      .catch(e=>{ console.error('[Zelle]',b.dataset.k,e); alert('Layer "'+b.dataset.k+'" konnte nicht geladen werden:\n'+e.message); })
      .finally(()=>ctrl.classList.remove('loading'));
  }));
}
async function czEnsureLayers(nr){
  if(!CELL_STATS){ try{ CELL_STATS=await fetch('data/cell_stats.json').then(r=>r.json()); }catch(_){ CELL_STATS={}; } }
  await Promise.all(CELL_LAYERS.map(async l=>{
    if(czLayers[l.key]) return;
    const gr=await loadGeoraster(`cog/zellen/${nr}/${l.key}.tif`);
    const gl=new GeoRasterLayer({georaster:gr, opacity:0, resolution:256, zIndex:455,
      pixelValuesToColorFn:cellColorFn(l.key,nr)});
    czLayers[l.key]=gl; gl.addTo(map);
  }));
}
async function czShowLayer(key){
  czCurrentKey=key;
  await czEnsureLayers(czCellNr);
  Object.keys(czLayers).forEach(k=>czLayers[k].setOpacity(k===key?1:0));
  czUpdateLegend(key); czUpdateButtons(key);
}
async function czEnter(nr){
  czInit();
  if(fsActive) fsExit();
  Object.keys(czLayers).forEach(k=>{ map.removeLayer(czLayers[k]); delete czLayers[k]; });
  czCellNr=nr;
  czCurrentKey='dem';   // Zellenebene startet immer mit DEM
  setZoomGranularity(true);   // feine Zoomstufen in der Zell-25-m-Ansicht
  const ctrl=document.getElementById('czControl');
  const layer=cellLayers[nr]; if(!layer) return;
  czBounds=layer.getBounds();
  document.getElementById('czTitle').textContent=`Zelle ${nr} · 25-m-Raster`;
  try{
    ctrl.classList.add('on','loading');
    await czEnsureLayers(nr);
    map.fitBounds(czBounds,{padding:[12,12]});
    Object.keys(czLayers).forEach(k=>czLayers[k].setOpacity(k===czCurrentKey?1:0));
    czUpdateLegend(czCurrentKey); czUpdateButtons(czCurrentKey);
    czActive=true;
    ctrl.classList.remove('loading');
  }catch(e){
    ctrl.classList.remove('on','loading');
    alert('25-m-Raster für Zelle '+nr+' nicht gefunden.\n('+e.message+')');
  }
}
function czExit(){
  czActive=false;
  Object.keys(czLayers).forEach(k=>{ map.removeLayer(czLayers[k]); delete czLayers[k]; });
  const c=document.getElementById('czControl'); if(c) c.classList.remove('on');
  if(czLegendSaved!=null){ const l=document.getElementById('legend'); if(l) l.innerHTML=czLegendSaved; czLegendSaved=null; }
  setZoomGranularity(false);   // zurueck zu ganzen Zoomstufen
}
function czUpdateButtons(key){
  document.querySelectorAll('#czControl .fs-lyr').forEach(b=>b.classList.toggle('on',b.dataset.k===key));
}
function czUpdateLegend(key){
  const leg=document.getElementById('legend'); if(!leg) return;
  if(czLegendSaved==null) czLegendSaved=leg.innerHTML;
  const r=cellRamp(key,czCellNr), L=CELL_LAYERS.find(l=>l.key===key);
  const mn=r.stops[0][0], mx=r.stops[r.stops.length-1][0];
  const fmt=v=> PCT_KEYS.has(key) ? nf(v*100,0)+' %' : nf(v,r.dec)+(r.unit?' '+r.unit:'');
  const scaleNote = ['twi','slope'].includes(key) ? 'Zell-P2/P98 (Artefaktdämpfung)'
    : ['rzsm_zanom','rzsm_relchange','rzsm_zanom_1911_1930','rzsm_zanom_1951_1980'].includes(key) ? 'symmetrisch um 0 (±P98)'
    : 'Zell-Min/Max';
  leg.innerHTML=`<h4><span>${L.name}</span></h4>
    <div class="ramp-lbl"><span>${fmt(mn)}</span><span>${fmt(mx)}</span></div>
    <div class="ramp" style="background:${rampGradient(key,{[key]:r})}"></div>
    <div class="note">Zelle ${czCellNr} · 25 m · Skala = ${scaleNote}.</div>`;
}
window.czEnter=czEnter;


/* ---- Fallstudie-Vektoren: Bodentypen (kategorial) + Schutzflächen (interaktiv, oben) ---- */
let fsBoden=null, fsSchutz=null;
const BODEN_CATS=[
  ['Löss, flach (0–15 %)','#f6e8c3'],['Löss, mittel (15–30 %)','#dfc27d'],['Löss, steil (>30 %)','#bf812d'],
  ['Talboden (tiefgründig)','#80cdc1'],['Auenkies / Fluss','#4393c3'],['Wasser','#2166ac'],
];
const BODEN_COL=Object.fromEntries(BODEN_CATS);
function bodenColor(name){ const t=(name||'').toLowerCase();
  if(t.includes('flach')) return '#f6e8c3';
  if(t.includes('mittel')) return '#dfc27d';
  if(t.includes('steil')) return '#bf812d';
  if(t.includes('talboden')) return '#80cdc1';
  if(t.includes('auenkies')||t.includes('fluss')) return '#4393c3';
  if(t.includes('wasser')) return '#2166ac';
  return '#9a9a9a'; }
async function fsToggleVec(kind,btn){
  if(kind==='boden'){
    if(fsBoden){ map.removeLayer(fsBoden); fsBoden=null; btn.classList.remove('on'); if(fsActive) updateRasterLegend(fsCurrentKey); return; }
    const gj=await fetch('vector/boden.geojson').then(r=>r.json());
    fsBoden=L.geoJSON(gj,{
      style:f=>({color:'#5a4a2a',weight:.4,fillColor:bodenColor(f.properties.boden_de),fillOpacity:.85}),
      onEachFeature:(f,l)=>{ const p=f.properties; l.bindPopup(`<b>${p.boden_de||'—'}</b>`+(p.muname?`<br><small>${p.muname}</small>`:'')); }
    }).addTo(map);
    if(fsSchutz) fsSchutz.bringToFront();
    btn.classList.add('on'); showBodenLegend();
  } else {
    if(fsSchutz){ map.removeLayer(fsSchutz); fsSchutz=null; btn.classList.remove('on'); return; }
    const gj=await fetch('vector/schutzflaechen.geojson').then(r=>r.json());
    const base={color:'#1a1a1a',weight:1.2,fillColor:'#ffd23f',fillOpacity:.35};
    const hov ={color:'#000000',weight:3.4,fillColor:'#ffe066',fillOpacity:.62};
    fsSchutz=L.geoJSON(gj,{ style:()=>base,
      onEachFeature:(f,l)=>{ const p=f.properties;
        l.bindPopup(`<b>Parzelle ${p.parzelle}</b><br>Fläche: <b>${nf(p.flaeche_ha,2)} ha</b><br>Überschreitungsanteil: ${nf(p.exceed_pct,1)} %`);
        l.on('mouseover',()=>{ l.setStyle(hov); l.bringToFront(); });
        l.on('mouseout', ()=>{ l.setStyle(base); });
      }}).addTo(map);
    btn.classList.add('on');
  }
}
function showBodenLegend(){
  const leg=document.getElementById('legend'); if(!leg) return;
  leg.innerHTML=`<h4><span>Bodentypen (vereinfacht)</span></h4>
    <div class="cat-legend">${BODEN_CATS.map(([n,c])=>`<div class="cat-row"><span class="cat-sw" style="background:${c}"></span>${n}</div>`).join('')}</div>
    <div class="note">Vereinfachte Bodentypen (NRCS SSURGO). Klick auf Fläche zeigt Details.</div>`;
}
function fsClearVectors(){
  if(fsBoden){ map.removeLayer(fsBoden); fsBoden=null; }
  if(fsSchutz){ map.removeLayer(fsSchutz); fsSchutz=null; }
  document.querySelectorAll('#fsControl .fs-vlyr').forEach(b=>b.classList.remove('on'));
}


/* ================================================================
   SCAN-Bodenfeuchte-Stationen (USDA NRCS) — Validierungs-Layer
   ================================================================ */
function initScan(){
  if(!SCAN_ST) return;
  scanLayer=L.geoJSON(SCAN_ST,{
    pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:7,color:'#111',weight:2,fillColor:'#2f7ab8',fillOpacity:.92}),
    onEachFeature:(f,l)=>{ l.bindTooltip('SCAN · '+f.properties.name,{direction:'top'});
      l.on('click',e=>{ if(e&&e.originalEvent) L.DomEvent.stop(e.originalEvent); renderStationPanel(f.properties); }); }
  });
  const toolset=document.querySelector('.toolset'); if(!toolset) return;
  const b=document.createElement('button'); b.className='btn'; b.id='scanBtn'; b.title='SCAN-Bodenfeuchte-Stationen ein/aus';
  b.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 2C8 6 6 9 6 13a6 6 0 0012 0c0-4-2-7-6-11z"/></svg>SCAN';
  toolset.insertBefore(b, document.getElementById('fsGroup')||toolset.querySelector('.proto-tag'));
  b.addEventListener('click',()=>{ scanOn=!scanOn; b.classList.toggle('active',scanOn);
    if(scanOn){ scanLayer.addTo(map); } else { map.removeLayer(scanLayer); } });
}
function initInterp(){
  const toolset=document.querySelector('.toolset'); if(!toolset) return;
  const btn=document.createElement('button'); btn.className='btn'; btn.id='interpBtn';
  btn.title='Interpretation-Overlays (Klima/Bewässerung/Landnutzung) über alle 12 Zellen';
  btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16.5l9 5 9-5"/></svg>Interpretation';
  toolset.insertBefore(btn, document.getElementById('scanBtn')||document.getElementById('fsGroup')||toolset.querySelector('.proto-tag'));
  const panel=document.createElement('div'); panel.id='interpPanel';
  panel.innerHTML=`<div class="ip-head"><b>Interpretation · Overlays</b><button class="ip-x" id="interpClose" title="schließen">×</button></div>
    <div id="interpControl">
      <button class="ip-lyr" data-k="prism_ppt">Klima · Niederschlag</button>
      <button class="ip-lyr" data-k="lanid">Bewässerung</button>
      <button class="ip-lyr" data-k="nlcd">Landnutzung</button>
    </div>
    <p class="note-p" style="margin:8px 0 0;font-size:11px">AOI-weite Overlays über alle 12 Zellen, halbtransparent — unabhängig von der Zellauswahl. Ein Overlay zur Zeit; erneuter Klick blendet aus. Legende oben rechts.</p>`;
  (document.querySelector('.map-wrap')||document.body).appendChild(panel);
  const setOpen=o=>{ panel.style.display=o?'block':'none'; btn.classList.toggle('active',o); };
  btn.addEventListener('click',()=>{ const o=panel.style.display!=='block'; setOpen(o); if(!o) interpClear(); });
  document.getElementById('interpClose').addEventListener('click',()=>{ setOpen(false); interpClear(); });
  panel.querySelectorAll('.ip-lyr').forEach(b=>b.addEventListener('click',()=>interpToggle(b.dataset.k)));
}
// Monatsreihe (z-Anomalie) aus SCAN_MON; Station per scan_id gesucht.
function scanMonById(id){
  if(!SCAN_MON||!SCAN_MON.stations) return null;
  return Object.values(SCAN_MON.stations).find(st=>String(st.scan_id)===String(id))||null;
}
function scanChart(id){
  const s=scanMonById(id);
  if(!s||!s.months||!s.months.length) return '<p class="note-p">Keine Monatsreihe vorhanden.</p>';
  const n=s.months.length, W=300,H=120,mL=26,mR=8,mT=8,mB=18;
  const vmn=-3.4,vmx=3.4;
  const tv=m=>{const q=m.split('-'); return (+q[0])+((+q[1])-1)/12;};
  const T=s.months.map(tv), t0=T[0], t1=T[n-1];
  const X=i=>mL+((T[i]-t0)/((t1-t0)||1))*(W-mL-mR);
  const Y=v=>mT+(1-(Math.max(vmn,Math.min(vmx,v))-vmn)/((vmx-vmn)||1))*(H-mT-mB);
  const lines=[['scan_z','#2f7ab8','SCAN gemessen (z-Anom.)',1.3],['isimip_z','#1a9850','ISIMIP RZSM (z-Anom.)',1.3]];
  const paths=lines.map(([k,col,,sw])=>{
    const arr=s[k]||[]; let d='',go=false;
    arr.forEach((v,i)=>{ if(v==null){go=false;return;} d+=`${go?'L':'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; go=true; });
    return d?`<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}"/>`:'';
  }).join('');
  const zero=`<line x1="${mL}" y1="${Y(0).toFixed(1)}" x2="${W-mR}" y2="${Y(0).toFixed(1)}" class="cvg"/>`;
  const ti=[0,Math.floor((n-1)/2),n-1];
  const xt=ti.map(i=>`<text x="${X(i).toFixed(1)}" y="${H-4}" class="cvt" text-anchor="middle">${s.months[i].slice(0,4)}</text>`).join('');
  const leg=lines.map(([,col,name])=>`<span><i style="background:${col}"></i>${name}</span>`).join('');
  return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" class="cvsvg" preserveAspectRatio="xMidYMid meet">${zero}${paths}${xt}</svg></div>
    <div class="spark-legend">${leg}</div>
    <div class="cvunit">Monats-Anomalie (Jahresgang entfernt), z-standardisiert · x = Monat (n=${n})</div>`;
}
function renderStationPanel(pr){
  if(typeof czActive!=='undefined' && czActive) czExit();
  currentCell=null;
  const s=(SCAN_SER&&SCAN_SER[String(pr.scan_id)])||null;
  const sm=scanMonById(pr.scan_id);
  const kj=s&&s.korrelation_jaehrlich;
  const pfmt=v=>(v!=null&&v<0.001)?'<0,001':nf(v,3);
  const county=(pr.county||'').replace(/\s*\[pruefen\]/,'');
  document.getElementById('panel').innerHTML=`
    <div class="cell-head">
      <div class="cid">SCAN-Station · ${esc(pr.network||'SCAN')} · #${pr.scan_id} · Zelle ${pr.cell_nr}</div>
      <h2>${esc(pr.name)}<span> · Bodenfeuchte-Validierung</span></h2>
      <div class="chips"><span class="chip" style="background:#dcebf5;color:#1a1e1c;border:1px solid rgba(0,0,0,.08)">SCAN · USDA NRCS</span>${s?`<span class="chip" style="background:#eef1ee;color:#1a1e1c;border:1px solid rgba(0,0,0,.08)">${esc(s.guete)}</span>`:''}</div>
    </div>
    <div class="section">
      <h3>SCAN vs. ISIMIP-RZSM · Monats-Anomalie ${sm?`(n=${sm.n_monate})`:''} <span class="q" title="Erklärung ein-/ausblenden">?</span></h3>
      <div class="q-pop" hidden><p>Zwei z-standardisierte <b>Monats-Anomalie-Reihen</b> (Jahresgang entfernt): <b>gemessene</b> SCAN-Bodenfeuchte (0–1 m, tiefengewichtet) vs. <b>modellierte</b> ISIMIP-RZSM (obsclim, 4-GHM-Ensemble-Median). Verglichen wird die <b>zeitliche Dynamik</b> (nasse/trockene Phasen laufen mit) — <b>kein Absolutvergleich</b> (unterschiedliche Größen/Einheiten, darum z-standardisiert) und <b>kein Trend</b>. Die Monats-Anomalie ist belastbarer als die kurze Jahresreihe.</p></div>
      ${scanChart(pr.scan_id)}
    </div>
    ${sm?`<div class="section">
      <h3>Übereinstimmung (Korrelation)</h3>
      <div class="kv focus"><span class="k">Monats-Anomalie · Spearman ρ</span><span class="v">${nf(sm.rho_ens,2)} (p ${pfmt(sm.p)}, n ${sm.n_monate})</span></div>
      ${kj?`<div class="kv"><span class="k">Jährlich · Pearson r <small>(illustrativ)</small></span><span class="v">${nf(kj.pearson_r,2)} (p ${pfmt(kj.pearson_p)}, n ${kj.n})</span></div>`:''}
      <div class="aoi-note"><p class="note-p"><b>Lesart:</b> Belastbar ist die <b>Monats-Anomalie</b> (Jahresgang entfernt, n=${sm.n_monate}); die Jahresreihe${kj?` (n=${kj.n})`:''} ist bei kurzem Overlap nur illustrativ. Die Reihen <b>plausibilisieren</b> den modellierten Verlauf, beweisen ihn nicht — in-situ-Punktmessung ≠ Zell-Modell. Bewusst <b>kein Trend</b>.</p></div>
    </div>`:''}
    <div class="section" style="border-bottom:none">
      <h3>Herkunft & Zweck</h3>
      <p class="note-p">USDA NRCS <b>SCAN</b> (Soil Climate Analysis Network), Station #${pr.scan_id}${county?', '+esc(county):''}. Bodenfeuchte in 5 Tiefen (${esc(pr.depths_cm||'')} cm), tiefengewichtet zu 0–1 m. Diese Stationen waren <b>ein Grund für die Regionswahl</b>: reale Bodenfeuchte-Referenz im Palouse, um die Modellverläufe in überlappenden Jahren zu plausibilisieren (nicht zu beweisen).</p>
    </div>`;
}
