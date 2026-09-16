/*
 * Chassis 3D view engine � ported from the OpenDesign redesign prototype
 * (hpe-analyzer-redesign). Geometry + interaction engine unchanged; parts
 * and statuses are built at runtime from the real model hardware list.
 */
"use strict";

// -- injected state ---------------------------------------------
let DATA = null;
let COMPONENTS = [];
let HOST = null;

// -- shell utilities (ported) ----------------------------------
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SEV_TONE = {critical:'critical',warning:'warning',information:'info',info:'info',healthy:'healthy',failed:'critical'};
const sevTone = s => SEV_TONE[String(s).toLowerCase()] || 'info';
const sevLabel = s => String(s).charAt(0).toUpperCase()+String(s).slice(1);
function chip(sev,label){const t=sevTone(sev);return `<span class="chip" data-tone="${t}"><span class="dot" data-tone="${t}"></span>${esc(label||sevLabel(sev))}</span>`;}
const pad = n => String(n).padStart(2,'0');
const fmt = d => `${pad(d.getMonth()+1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parseD = s => {const [dd,tt]=s.split(' ');const [M,D,Y]=dd.split('/').map(Number);const [h,m,sec]=tt.split(':').map(Number);return new Date(Y,M-1,D,h,m,sec);};
const ICONS = {
  dashboard:'<path d="M2 2h5v5H2zM9 2h5v3H9zM9 7h5v7H9zM2 9h5v5H2z"/>',
  hardware:'<rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3"/>',
  firmware:'<path d="M2 4.5 8 1.5l6 3-6 3z"/><path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3"/>',
  iml:'<path d="M2 3h12M2 8h12M2 13h8"/>',
  events:'<path d="M1 8h3l2-5 3 10 2-5h4"/>',
  rca:'<path d="M8 2 1.5 13.5h13z"/><path d="M8 6.5v3.5M8 11.6v.1"/>',
  tips:'<path d="M6 12.5h4M6.5 15h3M8 1.5a4.5 4.5 0 0 0-2.6 8.2V11h5.2V9.7A4.5 4.5 0 0 0 8 1.5z"/>',
  cpu:'<rect x="3.5" y="3.5" width="9" height="9" rx="1"/><path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2"/>',
  mem:'<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><path d="M5 6h6M5 8.5h6M5.5 12.5v1M8 12.5v1M10.5 12.5v1"/>',
  net:'<rect x="1.5" y="4.5" width="13" height="7" rx="1"/><path d="M4 7h1.5M6.5 7H8M9 7h1.5"/>',
  video:'<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M6 5v6M10 5v6"/>',
  fan:'<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.6"/><path d="M8 6.4V2.2M9.4 8.8l3.6 2.1M6.6 8.8l-3.6 2.1"/>',
  psu:'<rect x="2.5" y="4" width="11" height="8" rx="1"/><path d="M5 6.5v3M7 6.5v3M9 6.5v3M11 6.5v3"/>',
  drive:'<rect x="2" y="5" width="12" height="6" rx="1"/><circle cx="11.5" cy="8" r="1"/>',
  board:'<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M4 6h5M4 9h3M10 9h2"/>',
  ilo:'<circle cx="8" cy="8" r="5.5"/><path d="M8 5v4M8 11.4v.2"/>',
  tpm:'<rect x="3" y="5.5" width="10" height="6" rx="1"/><path d="M5.5 5.5V4.2a2.5 2.5 0 0 1 5 0v1.3"/>'
};
const icon = (n,size=15) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]||ICONS.board}</svg>`;
const TYPE_ICON = {'cpu':'cpu','memory':'mem','network-controller':'net','video-controller':'video','fan':'fan','power-supply':'psu','hard-drive':'drive','system-board':'board','pci-device':'board','storage-controller':'drive'};
const typeIcon = t => TYPE_ICON[t] || 'board';
const $ = s => document.querySelector(s);
const byId = id => COMPONENTS.find(c=>c.id===id);
const FAULTS = () => COMPONENTS.filter(c=>c.health==='critical'||c.health==='warning');
const hwOf = (t,id,idx) => (idx!=null && DATA.hardware[idx]) ? DATA.hardware[idx] : DATA.hardware.find(h=>h.type===t && String(h.id==null?'':h.id)===String(id==null?'':id));
function hwFields(h){
  if(!h) return [];
  const f=[];
  if(h.slot!=null) f.push(['Slot',h.slot]);
  if(h.model!=null) f.push(['Model',h.model]);
  if(h.manufacturer!=null&&h.manufacturer!=='NA') f.push(['Manufacturer',h.manufacturer]);
  if(h.partNumber!=null) f.push(['Part number',h.partNumber]);
  if(h.sparePartNumber!=null) f.push(['Spare part number',h.sparePartNumber]);
  if(h.serialNumber!=null) f.push(['Serial number',h.serialNumber]);
  if(h.firmware!=null) f.push(['Firmware',h.firmware]);
  if(h.status!=null) f.push(['Status',h.status]);
  if(h.cores!=null) f.push(['Cores',h.cores]);
  if(h.speed!=null) f.push(['Speed',h.speed]);
  if(h.cache!=null) f.push(['Cache',h.cache]);
  if(h.stepping!=null) f.push(['Stepping',h.stepping]);
  if(h.family!=null) f.push(['Family',h.family]);
  if(h.memoryType!=null) f.push(['Memory type',h.memoryType]);
  if(h.moduleType!=null) f.push(['Module type',h.moduleType]);
  if(h.size!=null) f.push(['Size',h.size]);
  if(h.correctable!=null) f.push(['Correctable errors',h.correctable]);
  if(h.uncorrectable!=null) f.push(['Uncorrectable errors',h.uncorrectable]);
  if(h.capacity!=null) f.push(['Capacity',h.capacity]);
  if(h.driveType!=null) f.push(['Drive type',h.driveType]);
  if(h.controllerType!=null) f.push(['Controller',h.controllerType]);
  if(h.macAddress!=null) f.push(['MAC address',h.macAddress]);
  if(h.adapterType!=null) f.push(['Adapter type',h.adapterType]);
  if(h.interface!=null) f.push(['Interface',h.interface]);
  if(h.universalUniqueId!=null) f.push(['UUID',h.universalUniqueId]);
  if(h.orderNumber!=null) f.push(['Order number',h.orderNumber]);
  if(h.skuNumber!=null) f.push(['SKU',h.skuNumber]);
  if(h.source!=null) f.push(['Source',h.source]);
  return f;
}
const healthOf = hw => hw&&hw.status==='failed'?'critical':hw&&hw.status==='warning'?'warning':'healthy';

/* dynamic chassis parts built from the real hardware list (DL360 Gen11 layout) */
function buildComponents(hardware){
  const hw = (type,id) => hardware.find(h=>h.type===type && String(h.id ?? '')===String(id));
  const state = h => h&&h.status==='failed' ? 'critical' : h&&h.status==='warning' ? 'warning' : undefined;
  const health = h => h&&h.status==='failed' ? 'critical' : h&&h.status==='warning' ? 'warning' : 'healthy';
  const issuesNote = list => list&&list.length ? list.map(i=>esc(i.message)).join('<br>') : null;
  const parts=[];
  /* extra slot/cards (PCIe devices, storage controllers, additional NICs)
   * are exposed in the inventory panel only � no chassis geometry */
  const CARD_TYPES = new Set(['pci-device','storage-controller']);
  const usedNic = hardware.find(h=>h.type==='network-controller');
  const cardSeen = new Set();
  hardware.forEach((h, idx) => {
    const isCard = CARD_TYPES.has(h.type) || (h.type==='network-controller' && h!==usedNic);
    if (!isCard) return;
    const model = h.model || h.slot || 'PCI device';
    const norm = String(model).toLowerCase().replace(/[^a-z0-9]/g,'');
    if (cardSeen.has(norm)) return;
    cardSeen.add(norm);
    const empty = /^empty/i.test(String(h.model||''));
    parts.push({
id:`card-${idx}`, name: (/^(pcie|network)\s+controller$/i.test(String(h.model||'')) && h.slot) ? `${h.slot} — populated` : empty ? `${h.slot||'Slot'} — ${model}` : model, short: h.slot ? String(h.slot).replace(/^OCP 3\.0 /,'OCP ') : h.type==='storage-controller' ? 'Storage' : 'PCIe',
      health:health(h), state:state(h), mat:'card',
      match:{type:h.type, id:String(h.id ?? ''), idx},
      geo:null, label:null,
      iml:[], note: issuesNote(h.issues) || (empty ? 'Slot present but no card detected.' : 'Expansion card reported by iLO.')
    });
  });
  const cpus = hardware.filter(h=>h.type==='cpu');
  cpus.slice(0,2).forEach((c,i)=>{
    const others = cpus.filter(x=>x!==c);
    const fail = c.status&&c.status!=='healthy';
    parts.push({
      id:`cpu-${i}`,name:`Processor ${i}`,short:`CPU ${i}`,health:health(c),state:state(c),mat:'cpu',
      match:{type:'cpu',id:String(c.id ?? '')},
      geo:{t:'cpu',x:i===0?130:380,y:124,z:8,w:100,d:100,h:30},
      label:{t:`CPU ${i}`,s:c.model?String(c.model).replace('Intel(R) ','').replace('  ',' '):'CPU',side:i===0?'L':'R'},
      iml:[], note:issuesNote(c.issues)&&fail?issuesNote(c.issues):'No faults attributed to this processor.'
    });
    void others;
  });
  const mems = hardware.filter(h=>h.type==='memory');
  if(mems.length){
    for(let bank=0;bank<2;bank++){
      const dimms = mems.filter((_,j)=>j>=bank*12&&j<(bank+1)*12);
      if(!dimms.length) continue;
      const failing = dimms.find(d=>d.status&&d.status!=='healthy');
      const idx = failing? mems.indexOf(failing):-1;
      parts.push({
        id:`bank-p${bank+1}`,name:`Processor ${bank} Memory`,short:`P${bank} DIMM bank`,
        health:health(failing?{status:'warning'}:dimms), state:failing?'warning':undefined, mat:'dimm',
        match:{type:'memory',id:String(failing?idx:dimms[0].id ?? '')},
        geo:{t:'dimm',a:{x:bank===0?100:350,y:228},b:{x:bank===0?100:350,y:90},n:6,w:120,d:3,h:30,gap:5,z:8,flag: failing?{island:['a','b'][idx%2],i:Math.floor(idx/2)%6}:null},
        label:{t:`P${bank} DIMM`,s:dimms.length+' x DDR5',side:bank===0?'L':'R'},
        iml:[], note:issuesNote((failing?[failing]:[]).map(d=>d.issues).flat())
      });
    }
  }
  const nic = hardware.find(h=>h.type==='network-controller');
  if(nic) parts.push({
    id:'nic',name:nic.model||'Network adapter',short:'1GbE OCP3',health:health(nic),mat:'card',
    match:{type:'network-controller',id:String(nic.id ?? '')},
    geo:{t:'card',x:60,y:10,z:0,w:150,d:14,h:6},label:{t:'NIC',s:'x'+hardware.filter(h=>h.type==='network-controller').length+' ports',side:'L'},
    iml:[], note:'Network adapter present and healthy.'});
  const vid = hardware.find(h=>h.type==='video-controller');
  if(vid) parts.push({
    id:'video',name:'Video Controller',short:'Video',health:health(vid),mat:'card',
    match:{type:'video-controller',id:String(vid.id ?? '')},
    geo:{t:'card',x:540,y:100,z:8,w:60,d:22,h:6},label:{t:'VIDEO',s:'Embedded',side:'R'},
    iml:[], note:'Embedded Matrox video controller.'});
  const psus = hardware.filter(h=>h.type==='power-supply');
  psus.slice(0,2).forEach((p,i)=>{
    parts.push({
      id:`psu-${i}`,name:`Power Supply ${i}`,short:`PSU ${i}`,health:health(p),state:state(p),mat:'psu',
      match:{type:'power-supply',id:String(p.id ?? '')},
      geo:{t:'psu',x:i===0?430:555,y:4,z:0,w:110,d:72,h:40},
      label:{t:`PSU ${i}`,s:p.firmware?'fw '+p.firmware:health(p),side:'R'},
      iml:[], note:issuesNote(p.issues)||'Present and healthy.'});
  });
  const fans = hardware.filter(h=>h.type==='fan');
  if(fans.length) parts.push({
    id:'fans',name:'Dual Fan Cage',short:'Fan cage',health:health(fans.find(f=>f.status&&f.status!=='healthy')),state:undefined,mat:'fan',
    match:{type:'fan',id:'0'},
    geo:{t:'fans',rows:[[90,300],[240,300],[390,300],[540,300],[165,338],[315,338],[465,338]],size:66,z:0,h:16},
    label:{t:'FANS',s:fans.length+' fans',side:'L'},
    iml:[], note:fans.length+' hot-plug fans in the dual cage.'});
  const drives = hardware.filter(h=>h.type==='hard-drive');
  if(drives.length) parts.push({
    id:'drives',name:'Drive Backplane',short:'Drive bays',health:health(drives.find(d=>d.status&&d.status!=='healthy')),mat:'drive',
    match:{type:'hard-drive',id:'0'},
    geo:{t:'drives',x:40,y:402,z:0,n:8,w:74,gap:6,d:74,h:14,used:[Math.min(drives.length,8)-1]},
    label:{t:'DRIVES',s:'8 x SFF',side:'L'},
    iml:[], note:'Eight 2.5" SFF bays.'});
  const board = hardware.find(h=>h.type==='system-board');
  if(board) parts.push({
    id:'board',name:'System Board',short:'System board',health:health(board),mat:'pcb',
    match:{type:'system-board',id:''},
    geo:{t:'board',x:44,y:58,z:0,w:636,d:282,h:8},label:null,
    iml:[], note:'Product identification record: '+(board.model||'system board')+'.'});
  parts.push({
    id:'ilo',name:'iLO',short:'iLO',health:'healthy',mat:'chip',icon:'ilo',
    geo:{t:'chip',x:60,y:150,z:8,w:32,d:30,h:8},label:{t:'iLO',s:DATA.meta.iloVersion?',fw '+DATA.meta.iloVersion:'embedded',side:'L'},
    iml:[], fields:[['Firmware',String(DATA.meta.iloVersion||'embedded')],['State','Healthy']], note:'iLO management processor.'});
  parts.push({
    id:'tpm',name:'TPM',short:'TPM',health:'healthy',mat:'chip',icon:'tpm',
    geo:{t:'chip',x:300,y:100,z:8,w:30,d:20,h:12},label:{t:'TPM',s:'v1.512',side:'L'},
    iml:[], fields:[['Version','1.512'],['State','Healthy']], note:'Trusted Platform Module.'});
  return parts;
}


const footprint = c => {
  const g=c.geo;
  if(g.t==='fans'){let sx=0,sy=0;g.rows.forEach(([x,y])=>{sx+=x;sy+=y;});return [sx/g.rows.length, sy/g.rows.length];}
  if(g.t==='drives') return [g.x + (g.n*(g.w+g.gap))/2, g.y+g.d/2];
  if(g.t==='dimm'){const d=g.n*(g.d+g.gap)-g.gap;return [g.a.x+g.w/2, g.a.y+d/2];}
  return [g.x+g.w/2, g.y+g.d/2];
};
const topZ = c => c.geo.z + c.geo.h;
function imlFor(c){
  const kws=c.iml||[];
  const hw = c.match?hwOf(c.match.type,c.match.id,c.match.idx):null;
  const rows=[];
  if(hw&&hw.issues&&hw.issues.length) rows.push(...hw.issues.map(i=>({date:i.date,severity:i.severity,message:i.message})));
  if(kws.length&&DATA.imlSample) {
    const sample=DATA.imlSample.slice().sort((a,b)=>parseD(b.date)-parseD(a.date))
      .filter(r=>kws.some(k=>r.message.includes(k))).slice(0,4);
    rows.push(...sample);
  }
  return rows.slice(0,4);
}

/* ═══ projection engine � true perspective + orthographic service views ══ */
const CHVIEW = '3d';                                             // fixed perspective camera view
const ZS = 2.6;                                                  // 1U height exaggeration for the flat ortho views
const CAM = { pos:[1037,1430,1265], tgt:[350,240,27], f:1560 };  // upper-front-left of the open chassis
const CAMAX = (()=>{
  const [cx,cy,cz]=CAM.pos, [tx,ty,tz]=CAM.tgt;
  let zx=cx-tx, zy=cy-ty, zz=cz-tz; const zl=Math.hypot(zx,zy,zz); zx/=zl; zy/=zl; zz/=zl;
  let xx=-zy, xy=zx, xz=0; const xl=Math.hypot(xx,xy,xz); xx/=xl; xy/=xl; xz/=xl;
  return { x:[xx,xy,xz], y:[zy*xz-zz*xy, zz*xx-zx*xz, zx*xy-zy*xx], z:[zx,zy,zz] };
})();
function P(x,y,z=0){
  if(CHVIEW==='planta') return [x, y];
  if(CHVIEW==='alzado') return [x, -z*ZS];
  if(CHVIEW==='perfil') return [y, -z*ZS];
  const dx=x-CAM.pos[0], dy=y-CAM.pos[1], dz=z-CAM.pos[2], A=CAMAX;
  const vx=dx*A.x[0]+dy*A.x[1]+dz*A.x[2];
  const vy=dx*A.y[0]+dy*A.y[1]+dz*A.y[2];
  const vz=dx*A.z[0]+dy*A.z[1]+dz*A.z[2];
  const k=CAM.f/Math.max(-vz,1);
  return [vx*k, -vy*k];
}
/* painter's depth: larger = nearer the viewer for the active camera */
function depthKey(c){
  const [fx,fy]=footprint(c), fz=(c.geo.z||0)+(c.geo.h||0)/2;
  if(CHVIEW==='planta') return fz;
  if(CHVIEW==='alzado') return fy;
  if(CHVIEW==='perfil') return fx;
  const dx=fx-CAM.pos[0], dy=fy-CAM.pos[1], dz=fz-CAM.pos[2];
  return -(dx*dx+dy*dy+dz*dz);
}
let BB = {x0:1e9,y0:1e9,x1:-1e9,y1:-1e9};
const bbPush = p => {BB.x0=Math.min(BB.x0,p[0]);BB.y0=Math.min(BB.y0,p[1]);BB.x1=Math.max(BB.x1,p[0]);BB.y1=Math.max(BB.y1,p[1]);};
const pts = a => a.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
const f1 = n => n.toFixed(1);
function poly(a,cls){a.forEach(bbPush);return `<polygon class="${cls}" points="${pts(a)}"/>`;}
function bboxOf(list){const xs=list.map(p=>p[0]),ys=list.map(p=>p[1]);
  return {x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)};}
function cuboid(g){
  const {x,y,z,w,d,h}=g;
  return {top:[P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)],
          R:[P(x+w,y,z+h),P(x+w,y+d,z+h),P(x+w,y+d,z),P(x+w,y,z)],
          F:[P(x,y+d,z+h),P(x+w,y+d,z+h),P(x+w,y+d,z),P(x,y+d,z)]};
}
/* 3-tone solid + 1px top edge highlight + optional healthy sage wash */
function solid(g,tint){
  const c=cuboid(g);
  const eh=`<path class="edge-hi" d="M ${f1(c.top[0][0])} ${f1(c.top[0][1])} L ${f1(c.top[1][0])} ${f1(c.top[1][1])} M ${f1(c.top[0][0])} ${f1(c.top[0][1])} L ${f1(c.top[3][0])} ${f1(c.top[3][1])}"/>`;
  return poly(c.top,'f-top')+poly(c.R,'f-dark')+poly(c.F,'f-mid')+eh+(tint?poly(c.top,'ok-tint'):'');
}
function shadowRect(x,y,w,d){
  const q=bboxOf([P(x,y,0),P(x+w,y,0),P(x+w,y+d,0),P(x,y+d,0)]);
  const cx=(q.x0+q.x1)/2+9, cy=(q.y0+q.y1)/2+12;
  const rx=(q.x1-q.x0)/2*1.04, ry=Math.max((q.y1-q.y0)/2*0.5, rx*0.32);
  bbPush([cx+rx,cy+ry]);
  return `<ellipse class="shadow" cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(ry)}"/>`;
}
function shadowOf(c){
  const g=c.geo;
  if(g.t==='board') return '';
  if(g.t==='fans'){let s='';g.rows.forEach(([cx,cy])=>{const a=P(cx-g.size/2,cy-g.size/2,0);
    bbPush([a[0]+g.size+8,a[1]+g.size+10]);
    s+=`<ellipse class="shadow" cx="${f1(a[0]+9)}" cy="${f1(a[1]+11)}" rx="${f1(g.size*0.72)}" ry="${f1(g.size*0.4)}"/>`;});return s;}
  if(g.t==='dimm'){const d=g.n*(g.d+g.gap)-g.gap;return shadowRect(g.a.x-1,g.a.y-1,g.w+2,d+2)+shadowRect(g.b.x-1,g.b.y-1,g.w+2,d+2);}
  if(g.t==='drives'){const w=g.n*(g.w+g.gap)-g.gap;return shadowRect(g.x,g.y,w,g.d);}
  return shadowRect(g.x,g.y,g.w,g.d);
}
function dieGrid(cx,cy,z,ww,dd){
  const n=4,L=[];
  for(let j=0;j<n;j++) for(let i=0;i<n;i++) L[j*n+i]=P(cx-ww/2+i*ww/(n-1),cy-dd/2+j*dd/(n-1),z);
  let s='';
  for(let i=0;i<n;i++) s+=`<line class="die" x1="${f1(L[i][0])}" y1="${f1(L[i][1])}" x2="${f1(L[(n-1)*n+i][0])}" y2="${f1(L[(n-1)*n+i][1])}"/>`;
  for(let j=0;j<n;j++) s+=`<line class="die" x1="${f1(L[j*n][0])}" y1="${f1(L[j*n][1])}" x2="${f1(L[j*n+n-1][0])}" y2="${f1(L[j*n+n-1][1])}"/>`;
  return s;
}
function statusPin(c){
  const g=c.geo, cx=g.x+g.w/2, cy=g.y+g.d/2, z=g.z+g.h;
  const a=P(cx,cy,z), t=P(cx,cy,z+30);
  return `<path class="pin" d="M ${f1(a[0])} ${f1(a[1])} L ${f1(t[0])} ${f1(t[1]+2)}"/>`
    +`<path class="pin-head" d="M ${f1(t[0])} ${f1(t[1]-7.5)} L ${f1(t[0]-4.4)} ${f1(t[1]+2)} L ${f1(t[0]+4.4)} ${f1(t[1]+2)} Z"/>`
    +`<line class="pin-mark" x1="${f1(t[0])}" y1="${f1(t[1]-4.6)}" x2="${f1(t[0])}" y2="${f1(t[1]-1.6)}"/>`
    +`<line class="pin-mark" x1="${f1(t[0])}" y1="${f1(t[1]-0.2)}" x2="${f1(t[0])}" y2="${f1(t[1]+0.6)}"/>`;
}
function haloOf(c){
  const q=bboxOf(cuboid(c.geo).top), cx=(q.x0+q.x1)/2, cy=(q.y0+q.y1)/2;
  return `<ellipse class="halo" cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1((q.x1-q.x0)/2+7)}" ry="${f1((q.y1-q.y0)/2+7)}"/>`;
}
/* ── per-material component art ── */
function edgeHi(top){
  return `<path class="stroke-l" d="M ${f1(top[0][0])} ${f1(top[0][1])} L ${f1(top[1][0])} ${f1(top[1][1])} M ${f1(top[0][0])} ${f1(top[0][1])} L ${f1(top[3][0])} ${f1(top[3][1])}"/>`;
}
function partSolid(g,pal){
  const cb=cuboid(g);
  return poly(cb.top,pal+'-t')+poly(cb.R,pal+'-r')+poly(cb.F,pal+'-f');
}
/* CPU � socket + finned aluminium heatsink (9 parallel ribs in perspective) */
function finShape(x,y,z,w,d,h){
  const cb=cuboid({x,y,z,w,d,h});
  return poly(cb.top,'fin-t')+poly(cb.R,'fin-r')+poly(cb.F,'fin-f');
}
function cpuShape(c){
  const g=c.geo, z=g.z;
  let s=poly([P(g.x,g.y,z),P(g.x+g.w,g.y,z),P(g.x+g.w,g.y+g.d,z),P(g.x,g.y+g.d,z)],'socket');
  const hb={x:g.x-4,y:g.y-4,z:z+4,w:g.w+8,d:g.d+8,h:5};
  s+=partSolid(hb,'dark')+edgeHi(cuboid(hb).top);
  const nf=9, step=g.w/(nf+1), flen=g.d*0.82, finH=17;
  const fy=g.y+(g.d-flen)/2, fz=z+9;
  for(let i=0;i<nf;i++) s+=finShape(g.x+step*(i+1),fy,fz,3,flen,finH);
  s+=finShape(g.x-g.w*0.02,fy,fz,2.4,flen,finH)+finShape(g.x+g.w-g.w*0.02-2.4,fy,fz,2.4,flen,finH);
  if(c.state==='critical') s+=haloOf(c)+statusPin(c);
  return s;
}
/* DIMM � 2 mm × 30 mm stick, silver spreader, gold contacts, top gold edge */
function dimmStick(x,y,w,d,h,z){
  let s=solid({x,y,z,w,d,h},false);
  const yf=y+d;
  s+=poly([P(x,yf,z+5),P(x+w,yf,z+5),P(x+w,yf,z),P(x,yf,z)],'gold');
  [0.32,0.68].forEach(f=>{
    const a=P(x+w*f,yf,z+11), b=P(x+w*f,yf,z+19);
    s+=`<line class="dimm-slot" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
  });
  s+=poly([P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)],'gold-top');
  return s;
}
function dimmShape(c){
  const g=c.geo; let clean='', flagged='';
  const draw=(isl,off)=>{
    for(let i=0;i<g.n;i++){
      const y=isl.y+i*(g.d+g.gap), b=dimmStick(isl.x,y,g.w,g.d,g.h,g.z);
      const hit=g.flag&&g.flag.island===off&&g.flag.i===i;
      if(hit) flagged+=b; else clean+=b;
    }
  };
  draw(g.a,'a'); draw(g.b,'b');
  return clean+(flagged?`<g class="subg" data-state="warning">${flagged}</g>`:'');
}
/* Drive caddy � L-bracket sled, locking holes, label strip, SSD/HDD perforation */
function driveUnit(c,x,idx){
  const g=c.geo, yf=g.y+g.d, z=g.z, w=g.w, d=g.d, h=g.h;
  const used=g.used&&g.used.includes(idx);
  let s=solid({x,y:g.y,z,w,d,h},false);
  s+=poly([P(x,yf,z+h),P(x+w,yf,z+h),P(x+w,yf+5,z+h*0.3),P(x,yf+5,z+h*0.3)],'caddy-front');
  s+=poly([P(x,g.y+d*0.7,z+h),P(x+w,g.y+d*0.7,z+h),P(x+w,g.y+d*0.96,z+h),P(x,g.y+d*0.96,z+h)],'labelstrip');
  if(used){
    for(let iy=0;iy<3;iy++) for(let ix=0;ix<9;ix++){
      const a=P(x+w*(0.06+0.9*ix/9),g.y+d*(0.12+0.16*iy),z+h);
      s+=`<circle class="perf" cx="${f1(a[0])}" cy="${f1(a[1])}" r="0.7"/>`;
    }
  } else {
    s+=poly([P(x,g.y+d*0.1,z+h),P(x+w,g.y+d*0.1,z+h),P(x+w,g.y+d*0.6,z+h),P(x,g.y+d*0.6,z+h)],'empty-bay');
  }
  const lx=x+w;
  const b1=P(lx,g.y+d*0.28,z+h*0.72), b2=P(lx+w*0.05,g.y+d*0.28,z+h*0.72), b3=P(lx+w*0.05,g.y+d*0.72,z+h*0.72), b4=P(lx,g.y+d*0.72,z+h*0.72);
  s+=`<path class="bracket" d="M ${f1(b1[0])} ${f1(b1[1])} L ${f1(b2[0])} ${f1(b2[1])} L ${f1(b3[0])} ${f1(b3[1])} L ${f1(b4[0])} ${f1(b4[1])}"/>`;
  [d*0.42,d*0.58].forEach(hy=>{
    const q=P(lx,g.y+hy,z+h*0.6);
    s+=`<circle class="lockhole" cx="${f1(q[0])}" cy="${f1(q[1])}" r="1.6"/>`;
  });
  return s;
}
function drivesShape(c){const g=c.geo;let s='';for(let i=0;i<g.n;i++)s+=driveUnit(c,g.x+i*(g.w+g.gap),i);return s;}
/* Fan � square frame, round hub, 4 curved blades */
function fanUnit(cx,cy,g){
  const z=g.z, h=g.h, sz=g.size, top=z+h, half=sz/2;
  const at=(rr,a,zz)=>P(cx+rr*Math.cos(a),cy+rr*Math.sin(a),zz);
  const circ=(rr,n,zz)=>Array.from({length:n},(_,i)=>at(rr,i/n*Math.PI*2,zz));
  let s=solid({x:cx-half,y:cy-half,z,w:sz,d:sz,h:h*0.4},false);
  s+=poly([P(cx-half,cy-half,top),P(cx+half,cy-half,top),P(cx+half,cy+half,top),P(cx-half,cy+half,top)],'fan-frame');
  s+=poly(circ(half*0.9,28,top),'fan-hole');
  const rin=half*0.22, rout=half*0.88;
  s+=poly(circ(rin,14,top+0.4),'fan-hub');
  for(let k=0;k<4;k++){
    const a0=k*Math.PI/2, sw=Math.PI*0.34, pts=[];
    for(let t=0;t<=5;t++){const a=a0+sw*t/5;pts.push(at(rin,a,top+0.5));}
    for(let t=5;t>=0;t--){const a=a0+sw*t/5;pts.push(at(rout,a,top+0.5));}
    s+=poly(pts,'fan-blade');
  }
  return s;
}
function fansShape(c){const g=c.geo;let s='';g.rows.forEach(([cx,cy])=>s+=fanUnit(cx,cy,g));return s;}
function portBox(x,y,z,w,d,h){
  const cb=cuboid({x,y,z,w,d,h});
  return poly(cb.top,'rj45-t')+poly(cb.R,'rj45-s')+poly(cb.F,'rj45-s');
}
/* PSU � deep brick, hex grill side, blue socket tab + handle on the front */
function psuShape(c){
  const g=c.geo, yf=g.y+g.d, z=g.z, w=g.w, d=g.d, h=g.h, xr=g.x+g.w;
  let s=solid(g,false);
  for(let j=0;j<4;j++) for(let i=0;i<3;i++){
    const hy=yf-(d-8)*(0.28+i*0.3), hz=z+7+(h-16)*(0.26+j*0.26);
    const q=P(xr,hy,hz);
    s+=`<circle class="hex" cx="${f1(q[0])}" cy="${f1(q[1])}" r="2.1"/>`;
  }
  s+=poly([P(g.x+w*0.82,yf,z+11),P(g.x+w*0.95,yf,z+11),P(g.x+w*0.95,yf,z+3),P(g.x+w*0.82,yf,z+3)],'sock');
  const hb1=P(g.x+w*0.05,yf,z+h-8), hb2=P(g.x+w*0.42,yf,z+h-8);
  s+=`<line class="psu-handle" x1="${f1(hb1[0])}" y1="${f1(hb1[1])}" x2="${f1(hb2[0])}" y2="${f1(hb2[1])}"/>`;
  return s;
}
/* NIC (low-profile card + RJ45 ports at the rear edge) / video sub-card */
function cardShape(c){
  const g=c.geo, z=g.z+g.h;
  let s=solid(g,false);
  if(c.id==='nic'){
    [0.16,0.46].forEach(f=>{ s+=portBox(g.x+g.w*f,g.y-5,g.z,g.w*0.22,5,11); });
  } else {
    const cx=g.x+g.w/2, cy=g.y+g.d/2;
    s+=poly([P(cx-g.w*0.2,cy-g.d*0.24,z+1.5),P(cx+g.w*0.2,cy-g.d*0.24,z+1.5),P(cx+g.w*0.2,cy+g.d*0.24,z+1.5),P(cx-g.w*0.2,cy+g.d*0.24,z+1.5)],'chip-top');
  }
  return s;
}
function chipShape(c){
  const g=c.geo, z=g.z+g.h, cx=g.x+g.w/2, cy=g.y+g.d/2;
  let s=solid(g,false);
  s+=poly([P(cx-g.w*0.24,cy-g.d*0.24,z+1.6),P(cx+g.w*0.24,cy-g.d*0.24,z+1.6),P(cx+g.w*0.24,cy+g.d*0.24,z+1.6),P(cx-g.w*0.24,cy+g.d*0.24,z+1.6)],'chip-top');
  return s;
}
/* system board � green PCB, copper traces, vias, CPU socket outlines */
function boardShape(c){
  const g=c.geo, z=g.z+g.h, cb=cuboid(g);
  let s=poly(cb.top,'f-top')+poly(cb.R,'f-dark')+poly(cb.F,'f-mid');
  const lines=[[[44,70],[200,70],[200,300],[560,300],[560,70],[520,70],[520,120],[300,120],[300,70],[44,70]],
               [[44,120],[120,120],[120,200],[300,200],[300,120],[520,120],[520,180],[620,180],[620,120]],
               [[44,300],[300,300],[300,240],[520,240],[520,300],[620,300]]];
  lines.forEach(seg=>{for(let i=1;i<seg.length;i++){const a=P(seg[i-1][0],seg[i-1][1],z),b=P(seg[i][0],seg[i][1],z);
    s+=`<line class="trace" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;}});
  [[60,70],[200,70],[560,70],[300,120],[620,180],[300,240],[44,300],[520,300]].forEach(([tx,ty])=>{const q=P(tx,ty,z);
    s+=`<circle class="via" cx="${f1(q[0])}" cy="${f1(q[1])}" r="1.7"/>`;});
  [[130,124],[380,124]].forEach(([sx,sy])=>{
    s+=poly([P(sx-8,sy-8,z+0.2),P(sx+108,sy-8,z+0.2),P(sx+108,sy+108,z+0.2),P(sx-8,sy+108,z+0.2)],'socketline');
  });
  return s;
}
function shapeOf(c){
  switch(c.geo.t){
    case 'cpu': return cpuShape(c);
    case 'dimm': return dimmShape(c);
    case 'drives': return drivesShape(c);
    case 'fans': return fansShape(c);
    case 'psu': return psuShape(c);
    case 'card': return cardShape(c);
    case 'chip': return chipShape(c);
    case 'board': return boardShape(c);
    default: return '';
  }
}
function projPts(c){
  const g=c.geo, a=[];
  if(g.t==='dimm'){const d=g.n*(g.d+g.gap)-g.gap;
    return [P(g.a.x,g.a.y,g.z+g.h),P(g.a.x+g.w,g.a.y,g.z+g.h),P(g.a.x+g.w,g.a.y+d,g.z+g.h),P(g.a.x,g.a.y+d,g.z+g.h),P(g.a.x,g.a.y,g.z),P(g.a.x+g.w,g.a.y+d,g.z)];}
  if(g.t==='drives'){const w=g.n*(g.w+g.gap)-g.gap;
    return [P(g.x,g.y,g.z+g.h),P(g.x+w,g.y,g.z+g.h),P(g.x+w,g.y+g.d,g.z+g.h),P(g.x,g.y+g.d,g.z+g.h),P(g.x,g.y,g.z),P(g.x+w,g.y+g.d,g.z)];}
  if(g.t==='fans'){g.rows.forEach(([cx,cy])=>{a.push(P(cx-g.size/2,cy-g.size/2,g.z+g.h),P(cx+g.size/2,cy+g.size/2,g.z));});return a;}
  return [P(g.x,g.y,g.z+g.h),P(g.x+g.w,g.y,g.z+g.h),P(g.x+g.w,g.y+g.d,g.z+g.h),P(g.x,g.y+g.d,g.z+g.h),P(g.x,g.y,g.z),P(g.x+g.w,g.y+g.d,g.z)];
}
function focusRing(c){
  const q=bboxOf(projPts(c)), p=5;
  return `<rect class="focus-ring" x="${f1(q.x0-p)}" y="${f1(q.y0-p)}" width="${f1(q.x1-q.x0+p*2)}" height="${f1(q.y1-q.y0+p*2)}" rx="3"/>`;
}
function slotlineOf(c){
  const g=c.geo; let r=null;
  if(g.t==='cpu') r=[g.x-5,g.y-5,g.w+10,g.d+10];
  else if(g.t==='dimm'){const d=g.n*(g.d+g.gap)-g.gap; r=[g.a.x-4,g.a.y-4,g.w+8,d+8];}
  else if(g.t==='psu') r=[g.x-3,g.y-3,g.w+6,g.d+6];
  else if(g.t==='card'||g.t==='chip') r=[g.x-3,g.y-3,g.w+6,g.d+6];
  else if(g.t==='drives'){const w=g.n*(g.w+g.gap)-g.gap; r=[g.x-4,g.y-4,w+8,g.d+8];}
  else return '';
  const z=(g.z||0)-0.3;
  return poly([P(r[0],r[1],z),P(r[0]+r[2],r[1],z),P(r[0]+r[2],r[1]+r[3],z),P(r[0],r[1]+r[3],z)],'slotline');
}
function wallFaces(g){
  const c=cuboid(g);
  return poly(c.top,'wall wall-t')+poly(c.F,'wall wall-s')+poly(c.R,'wall wall-s');
}
function traySvg(){
  const Z=0;
  let s=poly([P(20,0,Z),P(700,0,Z),P(700,480,Z),P(20,480,Z)],'tray')
    +poly([P(20,480,Z),P(700,480,Z),P(700,480,-9),P(20,480,-9)],'tray-side')
    +poly([P(700,0,Z),P(700,480,Z),P(700,480,-9),P(700,0,-9)],'tray-side');
  // top-down shadow of the removed lid on the floor
  s+=`<path fill="url(#lidShade)" d="M ${f1(P(20,0,Z)[0])} ${f1(P(20,0,Z)[1])} L ${f1(P(700,0,Z)[0])} ${f1(P(700,0,Z)[1])} L ${f1(P(700,480,Z)[0])} ${f1(P(700,480,Z)[1])} L ${f1(P(20,480,Z)[0])} ${f1(P(20,480,Z)[1])} Z"/>`;
  // sheet-metal inner ribs (stiffeners) near the side walls
  [44,664].forEach(x=>{
    const a=P(x,0,Z+0.4), b=P(x,480,Z+0.4);
    s+=`<line class="rib" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
  });
  let silk='';
  for(let x=90;x<700;x+=90){const a=P(x,0,Z),b=P(x,480,Z);silk+=`<line class="silk" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;}
  for(let y=40;y<480;y+=70){const a=P(20,y,Z),b=P(700,y,Z);silk+=`<line class="silk" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;}
  s+=poly([P(20,0,Z),P(700,0,Z),P(700,480,Z),P(20,480,Z)],'bevel');
  return s+silk;
}
function rearIOSvg(){
  const x0=20,x1=680,y0=0,y1=14,h=24;
  let s=partSolid({x:x0,y:y0,z:0,w:x1-x0,d:y1,h},'dark');
  [[50,54],[120,22],[150,22],[200,38],[258,38],[320,52],[398,52]].forEach(([cx,cw])=>{
    const a=P(cx-cw/2,y0,h+0.3), b=P(cx+cw/2,y0,h+0.3), c=P(cx+cw/2,y1,h+0.3), d2=P(cx-cw/2,y1,h+0.3);
    s+=poly([a,b,c,d2],'io-cut');
  });
  return s;
}
function bezelSvg(){
  const x0=20,x1=680,y0=474,y1=500,h=20;
  let s=partSolid({x:x0,y:y0,z:0,w:x1-x0,d:y1-y0,h},'metal')+edgeHi(cuboid({x:x0,y:y0,z:0,w:x1-x0,d:y1-y0,h}).top);
  for(let i=1;i<7;i++){
    const x=x0+(x1-x0)*i/7, a=P(x,y1,4), b=P(x,y1,h-4);
    s+=`<line class="tray-guide" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
  }
  return s;
}
function backplaneSvg(){
  const x0=40,x1=680,y0=376,y1=398,h=24;
  let s=partSolid({x:x0,y:y0,z:0,w:x1-x0,d:y1-y0,h},'dark');
  for(let i=0;i<8;i++){
    const cx=x0+12+i*78;
    s+=poly([P(cx,y1,7),P(cx+40,y1,7),P(cx+40,y1,14),P(cx,y1,14)],'io-cut');
  }
  return s;
}
function riserSvg(x,w){
  let s=partSolid({x,y:26,z:0,w,d:20,h:28},'green')+edgeHi(cuboid({x,y:26,z:0,w,d:20,h:28}).top);
  [0.14,0.4,0.66].forEach(f=>{ s+=portBox(x+w*f,30,28,w*0.16,8,6); });
  return s;
}
function batterySvg(){
  const cx=265, cy=110, r=13, h=6;
  const at=(rr,a,zz)=>P(cx+rr*Math.cos(a),cy+rr*Math.sin(a),zz);
  const circ=(rr,n,zz)=>Array.from({length:n},(_,i)=>at(rr,i/n*Math.PI*2,zz));
  let s='';
  const t0=-Math.PI*0.75,t1=Math.PI*0.25,steps=10;
  for(let i=0;i<steps;i++){
    const a=t0+(t1-t0)*i/steps,b=t0+(t1-t0)*(i+1)/steps;
    s+=poly([at(r,a,8),at(r,b,8),at(r,b,8+h),at(r,a,8+h)],'silver-r');
  }
  s+=poly(circ(r,24,8+h),'batt')+poly(circ(r*0.5,14,8+h+0.3),'batt-rim');
  return s;
}
function usdSvg(){
  const x=60,y=100,w=22,d=20,h=3;
  let s=partSolid({x,y,z:8,w,d,h},'silver');
  s+=poly([P(x+4,y+5,11),P(x+18,y+5,11),P(x+18,y+15,11),P(x+4,y+15,11)],'usd-slot');
  return s;
}
function lidPairSvg(){
  const x=640, y=-46, w=78, d=18, z=10;
  let s=partSolid({x,y,z,w,d,h:3},'metal')+edgeHi(cuboid({x,y,z,w,d,h:3}).top);
  [[x+8,y+5],[x+w-8,y+d-5]].forEach(([sx,sy])=>{const q=P(sx,sy,z+3.4);s+=`<circle class="lid-screw" cx="${f1(q[0])}" cy="${f1(q[1])}" r="2"/>`;});
  const a=P(x+4,y+d/2,z+3), b=P(x+w-4,y+d/2,z+3);
  s+=`<line class="psu-handle" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`;
  s+=partSolid({x:x-18,y:y+4,z:z-4,w:10,d:12,h:8},'dark');
  s+=partSolid({x:x+w+8,y:y+4,z:z-4,w:10,d:12,h:8},'dark');
  return s;
}
function airflowSvg(){
  let s='';
  [190,350,510].forEach(x=>{
    const a=P(x,368,1), b=P(x,340,1);
    s+=`<path class="flow" d="M ${f1(a[0])} ${f1(a[1])} L ${f1(b[0])} ${f1(b[1])}"/>`
      +`<path class="flow" d="M ${f1(b[0]-4.6)} ${f1(b[1]+2.8)} L ${f1(b[0])} ${f1(b[1])} L ${f1(b[0]+4.6)} ${f1(b[1]+2.8)}"/>`;
  });
  const cap=P(60,466,1);
  s+=`<text class="flow-txt" x="${f1(cap[0])}" y="${f1(cap[1])}" text-anchor="end">AIR FLOW →</text>`;
  bbPush([cap[0]-86,cap[1]-9]);
  return s;
}
function dimLine(a,b,label,dx,dy,anchor){
  const t=6, L=Math.hypot(b[0]-a[0],b[1]-a[1]), px=-(b[1]-a[1])/L, py=(b[0]-a[0])/L;
  const tick=q=>`<line x1="${f1(q[0]-px*t)}" y1="${f1(q[1]-py*t)}" x2="${f1(q[0]+px*t)}" y2="${f1(q[1]+py*t)}" class="dim"/>`;
  const mx=(a[0]+b[0])/2+dx, my=(a[1]+b[1])/2+dy;
  bbPush(a);bbPush(b);bbPush([mx-26,my-9]);bbPush([mx+26,my+9]);
  return `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" class="dim"/>${tick(a)}${tick(b)}`
    +`<text class="dim-text" x="${f1(mx)}" y="${f1(my)}" text-anchor="${anchor||'middle'}">${esc(label)}</text>`;
}
const dotCls = c => {const st=c.state||c.health;return st==='critical'||st==='dual'?'dc':st==='warning'?'dw':st==='healthy'?'dh':'di';};
const rectArea = r => Math.max(0,r.x1-r.x0)*Math.max(0,r.y1-r.y0);
const rectOverlap = (a,b) => Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
let GROUNDPTS=[];
function groundShadowSvg(){
  const cx=350, cy=250, rx=440, ry=368, a=[];
  for(let i=0;i<40;i++){const t=i/40*Math.PI*2; a.push(P(cx+rx*Math.cos(t), cy+ry*Math.sin(t), -6));}
  GROUNDPTS=a;
  return `<polygon class="ground" points="${pts(a)}"/>`;
}
function orthoFrameSvg(b){
  const p=16;
  const cap = CHVIEW==='planta' ? 'planta � top' : CHVIEW==='alzado' ? 'alzado � front (height ×'+ZS+')' : 'perfil � side (height ×'+ZS+')';
  bbPush([b.x0-p, b.y0-p-30]); bbPush([b.x1+p, b.y1+p]);
  return `<rect class="ortho-frame" x="${f1(b.x0-p)}" y="${f1(b.y0-p)}" width="${f1(b.x1-b.x0+p*2)}" height="${f1(b.y1-b.y0+p*2)}" rx="6"/>`
    +`<text class="ortho-cap" x="${f1(b.x0-p)}" y="${f1(b.y0-p-11)}">${esc(cap)}</text>`;
}
function buildChassis(){
  BB={x0:1e9,y0:1e9,x1:-1e9,y1:-1e9};
  GROUNDPTS=[];
  const CW=680, CD=480, CH=54, CX=20, CY=0;
  const is3d = CHVIEW==='3d';
  let out=`<defs><filter id="softBlur" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="3.2"/></filter>`
    +`<linearGradient id="lidShade" x1="0" y1="0" x2="1" y2="0.62" gradientUnits="objectBoundingBox">`
    +`<stop offset="0" stop-color="var(--black)" stop-opacity="0.30"/>`
    +`<stop offset="1" stop-color="var(--black)" stop-opacity="0.02"/>`
    +`</linearGradient></defs>`;
  if(is3d) out+=groundShadowSvg();
  out+=traySvg();
  out+=rearIOSvg();
  out+=wallFaces({x:CX+CW-10,y:CY,z:0,w:10,d:CD,h:CH});
  if(is3d){
    /* one dimension per axis � thin, offset clear of components */
    const nrm=[0.653,-0.757], o1=24;
    out+=dimLine(P(CX+nrm[0]*o1,CY+nrm[1]*o1,CH),P(CX+CW+nrm[0]*o1,CY+nrm[1]*o1,CH),'707 mm',0,-11,'middle');
    out+=poly([P(CX,CY,CH),P(CX+CW,CY,CH),P(CX+CW,CY+CD,CH),P(CX,CY+CD,CH)],'lid');
    out+=lidPairSvg();
    out+=airflowSvg();
  }
  const order=[...COMPONENTS].filter(c=>c.geo).sort((a,b)=>{
    if(a.geo.t==='board') return -1;
    if(b.geo.t==='board') return 1;
    return depthKey(a)-depthKey(b);
  });
  /* orthographic service views: dash the parts a nearer part covers (hidden-line look) */
  const marks={};
  if(!is3d){
    const bs=order.map(c=>({c,b:bboxOf(projPts(c)),d:depthKey(c)}));
    bs.forEach(m=>{ m.hidden = bs.some(o=>o!==m && o.d>m.d && rectOverlap(m.b,o.b) > 0.34*rectArea(m.b)); });
    bs.forEach(m=>{ marks[m.c.id]=m.hidden; });
  }
  order.forEach(c=>{
    const attrs=`data-id="${c.id}" data-health="${c.health}" data-mat="${c.mat||'chip'}"${c.state?` data-state="${c.state}"`:''}`;
    out+=`<g class="hw${marks[c.id]?' hidden-part':''}" ${attrs} role="button" tabindex="0" aria-label="${esc(c.name)} � ${esc(c.health)}">`
      +focusRing(c)+slotlineOf(c)+shadowOf(c)+shapeOf(c)+`</g>`;
    if(c.geo.t==='board'){
      out+=riserSvg(60,300)+riserSvg(390,210)+backplaneSvg()+batterySvg()+usdSvg();
    }
  });
  out+=bezelSvg();
  if(is3d) out+=dimLine(P(CX,CY+CD,0),P(CX,CY+CD,CH),'1U � 43.2 mm',-34,0,'end');
  const sBB={x0:BB.x0,y0:BB.y0,x1:BB.x1,y1:BB.y1};
  if(!is3d) out+=orthoFrameSvg(sBB);
  /* elbow callouts � pill in the side gutter, leader back to a knob on the part */
  const CARDW=700, GUT=72, midU=(sBB.x0+sBB.x1)/2;
  const base=COMPONENTS.filter(c=>c.label).map(c=>{
    const [fx,fy]=footprint(c), a=P(fx,fy,topZ(c));
    const side = is3d ? c.label.side : (a[0]<midU?'L':'R');
    return {c,a,side};
  });
  const layout=PF=>{
    const SEP=PF*3.5, ls=base.map(l=>({c:l.c,a:l.a,side:l.side}));
    ['L','R'].forEach(side=>{
      const row=ls.filter(l=>l.side===side).sort((p,q)=>p.a[1]-q.a[1]);
      let last=-1e9;
      row.forEach(l=>{
        l.y=Math.max(l.a[1],last+SEP); last=l.y;
        const tw=l.c.label.t.length*0.62*PF, sw=l.c.label.s?l.c.label.s.length*0.46*PF*0.74:0;
        l.w=Math.max(tw,sw)+20; l.h=l.c.label.s?PF*2.4:PF*1.8;
        l.pcx=side==='L'? sBB.x0-GUT : sBB.x1+GUT;
      });
    });
    return ls;
  };
  let ls=layout(10*((sBB.x1-sBB.x0)/CARDW));
  const pw=ls.map(l=>l.pcx-l.w/2), pw2=ls.map(l=>l.pcx+l.w/2);
  const vbW=Math.max(sBB.x1,...pw2)-Math.min(sBB.x0,...pw);
  const PF=10*((vbW+44)/CARDW);
  ls=layout(PF);
  ls.forEach(l=>{
    const pl=l.pcx-l.w/2, pt=l.y-l.h/2, inner=l.side==='L'? pl+l.w : pl;
    bbPush([pl,pt]);bbPush([pl+l.w,pt+l.h]);
    const dx=l.side==='L'? pl+11 : pl+l.w-11;
    out+=`<g class="callout" pointer-events="none">`
      +`<path class="leader" d="M ${f1(l.a[0])} ${f1(l.a[1])} V ${f1(l.y)} H ${f1(inner)}"/>`
      +`<circle class="calo" cx="${f1(l.a[0])}" cy="${f1(l.a[1])}" r="2.6"/>`
      +`<rect class="pill" x="${f1(pl)}" y="${f1(pt)}" width="${f1(l.w)}" height="${f1(l.h)}" rx="${f1(PF*0.55)}"/>`
      +`<circle class="dring ${dotCls(l.c)}" cx="${f1(dx)}" cy="${f1(l.y)}" r="3"/>`
      +`<text class="pill-txt" font-size="${f1(PF)}" x="${f1(l.pcx+6)}" y="${f1(l.y-(l.c.label.s?PF*0.32:PF*0.34))}" text-anchor="middle">${esc(l.c.label.t)}</text>`
      +(l.c.label.s?`<text class="pill-sub" font-size="${f1(PF*0.74)}" x="${f1(l.pcx+6)}" y="${f1(l.y+PF*0.68)}" text-anchor="middle">${esc(l.c.label.s)}</text>`:'')
      +`</g>`;
  });
  const pad2=22;
  GROUNDPTS.forEach(bbPush);
  return `<svg viewBox="${(BB.x0-pad2).toFixed(0)} ${(BB.y0-pad2).toFixed(0)} ${(BB.x1-BB.x0+pad2*2).toFixed(0)} ${(BB.y1-BB.y0+pad2*2).toFixed(0)}" role="group" aria-label="Component map of the HPE ProLiant DL360 Gen11 1U chassis (${CHVIEW} view)">${out}</svg>`;
}

function invSub(c){
  const hw=c.match?hwOf(c.match.type,c.match.id,c.match.idx):null;
  if(!hw){ return c.id==='ilo'?'fw 1.74p20':c.id==='tpm'?'v1.512':c.short; }
  const b=[];
  if(hw.type==='cpu') b.push(hw.model,hw.cores+' cores');
  else if(hw.type==='memory') b.push(hw.slot,hw.memoryType+' '+hw.size);
  else if(hw.type==='power-supply') b.push(hw.slot,'fw '+hw.firmware);
  else if(hw.type==='fan') b.push('Fans '+DATA.hardware.filter(h=>h.type==='fan').length,'present');
  else if(hw.type==='hard-drive') b.push(hw.model,hw.capacity);
  else if(hw.type==='network-controller') b.push(hw.model,hw.slot?'slot '+hw.slot:null,hw.partNumber);
  else if(hw.type==='video-controller') b.push(hw.model);
  else if(hw.type==='pci-device') b.push(hw.slot,hw.manufacturer,hw.vendorId&&hw.deviceId?`VID: ${hw.vendorId} � DID: ${hw.deviceId}`:null);
  else if(hw.type==='storage-controller') b.push(hw.slot,hw.partNumber,hw.firmware?'fw '+hw.firmware:null);
  else if(hw.type==='system-board') b.push(hw.partNumber,hw.serialNumber);
  return b.filter(Boolean).join(' � ')||c.short;
}
function invRow(c){
  const hw=c.match?hwOf(c.match.type,c.match.id,c.match.idx):null;
  const ic=c.icon||typeIcon(hw?hw.type:'board');
  const fault=c.health==='critical'?'true':c.health==='warning'?'warn':'false';
  const st=c.health==='critical'||c.health==='warning'?c.health:'';
  return `<button class="inv-row" data-open="${c.id}" data-fault="${fault}" data-od-id="inv-${c.id}">
    <span class="dot" data-tone="${c.health}"></span>
    <span class="inv-icon">${icon(ic,13)}</span>
    <span style="min-width:0"><span class="inv-name">${esc(c.name)}</span><span class="inv-msub">${esc(invSub(c))}</span></span>
    <span class="inv-stat" data-tone="${st}">${esc(c.health)}</span>
  </button>`;
}
function invRows(){
  const rank=c=>c.health==='critical'?0:c.health==='warning'?1:2;
  const faults=[...COMPONENTS].filter(c=>rank(c)<2).sort((a,b)=>rank(a)-rank(b));
  const rest=[...COMPONENTS].filter(c=>rank(c)===2).sort((a,b)=>a.name.localeCompare(b.name));
  return (faults.length?`<div class="inv-sep">Faults � ${faults.length}</div>`+faults.map(invRow).join(''):'')
    +`<div class="inv-sep">All components � ${rest.length}</div>`+rest.map(invRow).join('');
}

function viewHardware(host){
  host = host || document.querySelector('#workspace');
  if(!host) return;
  HOST = host;
  const healthy=COMPONENTS.filter(c=>c.health==='healthy').length;
  const warned=COMPONENTS.filter(c=>c.health==='warning').length;
  const crit=COMPONENTS.filter(c=>c.health==='critical').length;
  host.innerHTML = `
  <div class="view-head">
    <div><h1 class="view-title" data-od-id="hardware-title">Hardware Health</h1>
    <p class="view-sub">${esc(DATA.meta.productName||'HPE ProLiant')} � 1U � perspective 3D view � hover for status, click for inventory and related IML</p></div>
    <div class="view-tools">${chip('critical',crit+' failed � '+warned+' warning')}</div>
  </div>
  <div class="hw-layout">
    <div class="hw-left">
      <section class="chassis-card" data-od-id="chassis-blueprint">
        <div class="chassis-head">
          <div><div class="chassis-title">Chassis blueprint</div>
          <div class="chassis-sub">${esc(DATA.meta.productName||'HPE ProLiant')} � dual fan cage � SFF bays � 2 x PSU</div></div>
          <div class="chassis-tools">
            <button class="zoom-btn" data-zoom="-1" aria-label="Zoom out" title="Zoom out">-</button>
            <span class="zoom-val" id="zoomVal">100%</span>
            <button class="zoom-btn" data-zoom="1" aria-label="Zoom in" title="Zoom in">+</button>
            <button class="zoom-btn" data-zoom="0" aria-label="Reset zoom" title="Reset zoom">?</button>
          </div>
        </div>
        <div class="chassis-zoom" id="zoomWrap">${buildChassis()}</div>
        <div class="tape" data-od-id="status-tape">
          <span class="tape-item"><span class="dot" data-tone="healthy"></span><b>${healthy}</b> healthy</span>
          <span class="tape-item"><span class="dot" data-tone="critical"></span><b>${crit}</b> failed</span>
          <span class="tape-item"><span class="dot" data-tone="warning"></span><b>${warned}</b> warning</span>
          <button class="btn btn-ghost btn-sm" id="focusFail" aria-pressed="false">Focus failed</button>
        </div>
      </section>
    </div>
    <aside class="card inv-panel" data-od-id="inventory-panel">
      <div class="inv-head">
        <div><div class="inv-title">Inventory &amp; failures</div><div class="inv-sub">${COMPONENTS.length} mapped components � click to focus the chassis</div></div>
        ${chip('critical',FAULTS().length+' open')}
      </div>
      <div class="inv-list" id="invList">${invRows()}</div>
    </aside>
  </div>`;
  wireHardware();
}

function wireHardware(){
  const svg=$('#workspace').querySelector('.chassis-zoom svg');
  const wrap=$('#zoomWrap');
  let z=1, renderedZ=1, panX=0, panY=0, drag=null, suppressClick=false;
  const clampPan=()=>{
    const base=svg.getBoundingClientRect();
    const viewW=Math.max(0,wrap.clientWidth-16), viewH=Math.max(0,wrap.clientHeight-4);
    const baseW=base.width/Math.max(renderedZ,0.6), baseH=base.height/Math.max(renderedZ,0.6);
    const maxX=Math.max(0,(baseW*z-viewW)/2), maxY=Math.max(0,(baseH*z-viewH)/2);
    panX=Math.max(-maxX,Math.min(maxX,panX)); panY=Math.max(-maxY,Math.min(maxY,panY));
  };
  const applyPan=()=>{
    clampPan(); svg.style.transform=`translate3d(${panX}px,${panY}px,0) scale(${z})`;
    renderedZ=z;
    wrap.classList.toggle('is-pannable',z>1); wrap.style.touchAction=z>1?'none':'auto';
  };
  const setZ=n=>{
    z=Math.max(0.6,Math.min(1.6,n));
    if(z<=1){z=1;panX=0;panY=0;}
    applyPan(); $('#zoomVal').textContent=Math.round(z*100)+'%';
  };
  const resetView=()=>{z=1;panX=0;panY=0;applyPan();$('#zoomVal').textContent='100%';};
  $('#workspace').querySelectorAll('.zoom-btn').forEach(b=>b.onclick=()=>{const d=Number(b.dataset.zoom);if(d===0)resetView();else setZ(z+d*0.2);});
  const ff=$('#focusFail');
  ff.onclick=()=>{const on=svg.classList.toggle('focus-fail');ff.setAttribute('aria-pressed',String(on));ff.textContent=on?'Unfocus':'Focus failed';};
  wrap.addEventListener('pointerdown',e=>{
    if(z<=1||e.button===2)return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};
    wrap.setPointerCapture?.(e.pointerId);
  });
  wrap.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId||z<=1)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4)return;
    if(!drag.moved){drag.moved=true;suppressClick=true;wrap.classList.add('is-panning');hideTip();}
    panX+=dx;panY+=dy;drag.x=e.clientX;drag.y=e.clientY;applyPan();e.preventDefault();
  });
  const endDrag=e=>{
    if(!drag||drag.id!==e.pointerId)return;
    wrap.releasePointerCapture?.(e.pointerId);wrap.classList.remove('is-panning');drag=null;
  };
  wrap.addEventListener('pointerup',endDrag);wrap.addEventListener('pointercancel',endDrag);
  wrap.addEventListener('dblclick',e=>{if(z>1||panX||panY){e.preventDefault();resetView();suppressClick=false;}});
  svg.addEventListener('mousemove',e=>{
    const g=e.target.closest?e.target.closest('.hw'):null;
    if(!g){hideTip();return;}
    const c=byId(g.dataset.id), hw=c.match?hwOf(c.match.type,c.match.id,c.match.idx):null;
    showTip(e, c.name, sevLabel(c.health)+(hw&&hw.slot?' � slot '+hw.slot:'')+(hw&&hw.model?' � '+hw.model:''));
  });
  svg.addEventListener('mouseleave',hideTip);
  svg.addEventListener('click',e=>{
    if(suppressClick){suppressClick=false;e.preventDefault();return;}
    const g=e.target.closest?e.target.closest('.hw'):null;
    if(g) openDetail(g.dataset.id); else closeDetail();
  });
  svg.addEventListener('keydown',e=>{
    const g=e.target.closest?e.target.closest('.hw'):null; if(!g) return;
    if(e.key==='Enter'||e.key===' '){e.preventDefault();openDetail(g.dataset.id);}
  });
  $('#workspace').querySelectorAll('.inv-row[data-open]').forEach(b=>b.onclick=()=>openDetail(b.dataset.open));
  wrap.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();setZ(z+(e.deltaY<0?0.1:-0.1));},{passive:false});
}

function openDetail(id){
  const c=byId(id); if(!c) return;
  document.querySelectorAll('.hw').forEach(g=>g.setAttribute('data-selected',String(g.dataset.id===id)));
  document.querySelectorAll('.inv-row').forEach(r=>r.setAttribute('data-active',String(r.dataset.open===id)));
  const hw = c.match?hwOf(c.match.type,c.match.id,c.match.idx):null;
  const fields = c.fields || hwFields(hw);
  const imlRows=imlFor(c);
  const rcas = (c.rca!=null)?[DATA.rca[c.rca]]:[];
  $('#detail').innerHTML = `
    <header>
      <div style="min-width:0">
        <div class="rca-meta" style="margin-bottom:8px">${chip(c.health)}<span class="tag">${esc(c.short)}</span></div>
        <h2 style="font:600 14px/1.3 var(--font-display);letter-spacing:-.01em">${esc(c.name)}</h2>
      </div>
      <button class="close-x" id="closeDetail" aria-label="Close detail panel">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>
      </button>
    </header>
    <div class="detail-body">
      <div class="dl">${fields.map(([k,v])=>`<div class="dl-row"><span class="dl-k">${esc(k)}</span><span class="dl-v">${esc(v)}</span></div>`).join('')}</div>
      ${c.note?`<p class="note">${c.note}</p>`:''}
      ${rcas.length?`<div class="rca-field"><span class="eyebrow">Related RCA</span>
        <div class="chips">${rcas.map(r=>`<span class="chip" data-tone="critical"><span class="dot" data-tone="critical"></span>${esc(r.title)}</span>`).join('')}</div>
        <div style="margin-top:2px"><button class="btn btn-ghost btn-sm" data-goto="rca">Open RCA view</button></div>
      </div>`:''}
      <div class="rca-field"><span class="eyebrow">Related IML entries (${imlRows.length})</span>
        ${imlRows.length?`<div class="iml-mini">${imlRows.map(r=>`
          <div class="iml-mini-item">
            <div class="iml-mini-top">${chip(r.severity)}<span class="iml-mini-date">${esc(r.date)}</span></div>
            <div class="iml-mini-msg">${esc(r.message)}</div>
          </div>`).join('')}</div>`:`<p class="note">No IML entry in the extract references this component.</p>`}
      </div>
    </div>`;
  $('#detail').setAttribute('data-open','true');
  $('#detail').setAttribute('aria-hidden','false');
  $('#closeDetail').onclick=closeDetail;
}
function closeDetail(){
  $('#detail').setAttribute('data-open','false');
  $('#detail').setAttribute('aria-hidden','true');
  document.querySelectorAll('.hw').forEach(g=>g.setAttribute('data-selected','false'));
  document.querySelectorAll('.inv-row').forEach(r=>r.setAttribute('data-active','false'));
}

/* ═══ tooltip ═════════════════════════════════════════════════════════ */
function showTip(e,name,sub){
  const t=$('#tip'); t.innerHTML=`<div class="tip-name">${esc(name)}</div><div class="tip-sub">${esc(sub)}</div>`;
  t.setAttribute('data-on','true');
  const w=t.offsetWidth,h=t.offsetHeight;
  let x=e.clientX+16, y=e.clientY+18;
  if(x+w>innerWidth-10) x=e.clientX-w-16;
  if(y+h>innerHeight-10) y=e.clientY-h-14;
  t.style.left=x+'px'; t.style.top=y+'px';
}
function hideTip(){$('#tip').setAttribute('data-on','false');}


/* -- public API -- */

/**
 * Prepare component list + data for a fresh model render.
 * `m.hardware` is the model's HardwareEntry[] and `m.meta` the server meta.
 */
export function setChassisModel(m){
  DATA = {
    meta: m.meta,
    hardware: m.hardware,
    rca: [],
    imlSample: [],
  };
  COMPONENTS = buildComponents(m.hardware);
}

/** Render the Hardware Health view into the given node or #workspace. */
export function mountChassis(host){
  viewHardware(host || HOST || document.querySelector('#workspace'));
}

export function chassisCounts(){
  const healthy=COMPONENTS.filter(c=>c.health==='healthy').length;
  const warned=COMPONENTS.filter(c=>c.health==='warning').length;
  const crit=COMPONENTS.filter(c=>c.health==='critical').length;
  return {healthy,warned,crit,total:COMPONENTS.length,faults:FAULTS().length};
}

export { closeDetail, openDetail, hideTip };
