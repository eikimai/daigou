'use strict';
const VERSION='1.3.0';
/* ========== 基本設定 ========== */
const CUR={
  JPY:{sym:'¥',name:'日幣',dec:0,hint:1000,def:0.205},
  KRW:{sym:'₩',name:'韓幣',dec:0,hint:10000,def:0.022},
  THB:{sym:'฿',name:'泰銖',dec:2,hint:100,def:0.9},
  IDR:{sym:'Rp',name:'印尼盾',dec:0,hint:100000,def:0.0019},
  USD:{sym:'$',name:'美金',dec:2,hint:1,def:31}
};
const MODE_LABEL={mult:'倍數',add:'固定加價',margin:'目標利潤率'};
const $=(s,el=document)=>el.querySelector(s);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>{const n=parseFloat(String(v??'').replace(/,/g,''));return isFinite(n)?n:0};
const fmt=(n,d=0)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:d});
const twd=n=>'NT$ '+fmt(Math.round(n||0));
const fx=(n,c)=>CUR[c].sym+' '+fmt(n,CUR[c].dec);

/* ========== 本機資料庫（IndexedDB，離線可用）========== */
const S={trips:[],items:[],customers:[],orders:[],meta:{}};
let db=null, memOnly=false;
function openDB(){return new Promise((res,rej)=>{
  const r=indexedDB.open('daigou',1);
  r.onupgradeneeded=()=>{['trips','items','customers','orders'].forEach(s=>r.result.createObjectStore(s,{keyPath:'id'}));r.result.createObjectStore('meta',{keyPath:'k'})};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
})}
const getAll=st=>new Promise((res,rej)=>{const r=db.transaction(st).objectStore(st).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const putRec=(st,o)=>!db?Promise.resolve():new Promise((res,rej)=>{const t=db.transaction(st,'readwrite');t.objectStore(st).put(o);t.oncomplete=res;t.onerror=t.onabort=()=>rej(t.error)});
const delRec=(st,id)=>!db?Promise.resolve():new Promise((res,rej)=>{const t=db.transaction(st,'readwrite');t.objectStore(st).delete(id);t.oncomplete=res;t.onerror=t.onabort=()=>rej(t.error)});
async function loadAll(){
  try{
    db=await openDB();
    for(const st of ['trips','items','customers','orders'])S[st]=await getAll(st);
    (await getAll('meta')).forEach(r=>S.meta[r.k]=r.v);
    if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  }catch(e){memOnly=true;db=null}
  if(!S.meta.rates){S.meta.rates={};Object.keys(CUR).forEach(k=>S.meta.rates[k]=CUR[k].def)}
}
async function save(st,o){
  const a=S[st],i=a.findIndex(x=>x.id===o.id);i>=0?a[i]=o:a.push(o);
  try{await putRec(st,o)}catch(e){toast('儲存失敗，手機空間可能不足')}
}
async function remove(st,id){S[st]=S[st].filter(x=>x.id!==id);try{await delRec(st,id)}catch(e){}}
async function setMeta(k,v){S.meta[k]=v;try{await putRec('meta',{k,v})}catch(e){}}

/* ========== 計算 ========== */
function calcPrice(costTwd,mode,val,round){
  let p=0;
  if(costTwd>0){
    if(mode==='mult')p=costTwd*val;
    else if(mode==='add')p=costTwd+val;
    else p=val>=95?costTwd*20:costTwd/(1-val/100);
  }
  const r=round||1;
  return p>0?Math.ceil(p/r-1e-9)*r:0;
}
const curTrip=()=>S.trips.find(t=>t.id===S.meta.tripId)||S.trips[0]||null;
const tripOf=id=>S.trips.find(t=>t.id===id);
const costTwd=(i,t)=>num(i.cost)*t.rate;
const orderTotal=o=>o.lines.reduce((s,l)=>s+l.qty*l.price,0);
const soldQty=(id,v)=>S.orders.reduce((s,o)=>s+o.lines.filter(l=>l.itemId===id&&(v===undefined||(l.variant||'')===v)).reduce((a,l)=>a+l.qty,0),0);
const itemQty=i=>(i.variants&&i.variants.length)?i.variants.reduce((s,v)=>s+v.q,0):(i.qty||1);
const photosOf=i=>(i.photos&&i.photos.length)?i.photos:(i.photo?[{p:i.photo,t:i.thumb||i.photo}]:[]);
const findVar=(it,n)=>(it.variants||[]).find(v=>v.n===n)||null;
const varCost=(it,v,t)=>(v&&num(v.c)>0)?num(v.c)*t.rate:costTwd(it,t);
const varPrice=(it,v,t)=>{
  if(v&&num(v.p)>0)return num(v.p);
  if(v&&num(v.c)>0)return calcPrice(num(v.c)*t.rate,it.mode,num(it.val),t.round);
  return it.price||0;
};
/* 代購費率：售價 = 成本（台幣）×（1＋費率%）。手動固定的售價不受費率影響 */
const DEF_FEE=10;
const cleanRate=x=>{const n=Number(x);return isFinite(n)&&n>=0&&n<=300?Math.round(n*100)/100:DEF_FEE};
const custRate=id=>{const c=S.customers.find(x=>x.id===id);return c&&c.rate!=null?cleanRate(c.rate):DEF_FEE};
function feePrice(it,v,t,rate){
  if(v&&num(v.p)>0)return num(v.p);
  if(!v&&it.manual&&num(it.price)>0)return num(it.price);
  const c=varCost(it,v,t);
  return c>0?calcPrice(c,'mult',1+rate/100,t.round):(it.price||0);
}
/* 從規格名稱讀出容量，例如「100ml」「1.5L」「30片」，用來算每單位多少錢 */
const SIZE_RE=/(\d+(?:\.\d+)?)\s*(ml|cc|l|公升|kg|公斤|g|克|入|片|枚|個|个|包|支|顆|粒|條|pcs|sheets?)(?![a-z])/i;
function parseSize(name){
  const m=String(name||'').match(SIZE_RE);if(!m)return null;
  let a=parseFloat(m[1]),u=m[2].toLowerCase(),cls;
  if(!(a>0))return null;
  if(u==='l'||u==='公升'){a*=1000;u='ml';cls='ml'}
  else if(u==='ml'||u==='cc'){u='ml';cls='ml'}
  else if(u==='kg'||u==='公斤'){a*=1000;u='g';cls='g'}
  else if(u==='g'||u==='克'){u='g';cls='g'}
  else{cls='pc';if(u==='pcs'||u.startsWith('sheet'))u='片';if(u==='个')u='個'}
  return{amt:a,unit:u,cls};
}
function unitPrice(name,price){
  const s=parseSize(name);if(!s||!(price>0))return null;
  return{per:price/s.amt,unit:s.unit,cls:s.cls,amt:s.amt};
}
const fmtUnit=per=>per>=100?fmt(per,0):per>=10?fmt(per,1):fmt(per,2);
const needBackup=()=>(S.items.length+S.orders.length>0)&&(!S.meta.backupAt||Date.now()-S.meta.backupAt>7*864e5);
const custName=id=>(S.customers.find(c=>c.id===id)||{name:'(已刪除)'}).name;
function payState(o){const tot=orderTotal(o);if(tot>0&&o.paid>=tot)return['paid','已付清'];if(o.paid>0)return['part','訂金 '+twd(o.paid)];return['none','未付款']}
function tripStats(t){
  const items=S.items.filter(i=>i.tripId===t.id),orders=S.orders.filter(o=>o.tripId===t.id);
  const bought=items.filter(i=>i.bought);
  const hv=i=>(i.variants&&i.variants.length)?i.variants:null;
  const buyCost=bought.reduce((s,i)=>s+(hv(i)?hv(i).reduce((a,v)=>a+v.q*varCost(i,v,t),0):costTwd(i,t)*itemQty(i)),0);
  const revenue=orders.reduce((s,o)=>s+orderTotal(o),0);
  const paid=orders.reduce((s,o)=>s+Math.min(o.paid||0,orderTotal(o)),0);
  const lc=l=>l.costTwd||(()=>{const it=S.items.find(x=>x.id===l.itemId);return it?varCost(it,l.variant?findVar(it,l.variant):null,t):0})();
  const soldCost=orders.reduce((s,o)=>s+o.lines.reduce((a,l)=>a+l.qty*lc(l),0),0);
  const stock=bought.reduce((s,i)=>s+(hv(i)?hv(i).reduce((a,v)=>a+Math.max(0,v.q-soldQty(i.id,v.n))*varCost(i,v,t),0):Math.max(0,itemQty(i)-soldQty(i.id))*costTwd(i,t)),0);
  const unsold=bought.reduce((s,i)=>s+Math.max(0,itemQty(i)-soldQty(i.id)),0);
  return{items:items.length,bought:bought.length,buyCost,revenue,paid,due:revenue-paid,profit:revenue-soldCost,
    margin:revenue?(revenue-soldCost)/revenue*100:0,stock,unsold,toShip:orders.filter(o=>!o.shipped).length,orders:orders.length};
}

/* ========== 介面工具 ========== */
const ui={tab:'items',itemFilter:'all',orderFilter:'all'};
let toastT;
function toast(m){let t=$('.toast');if(t)t.remove();t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);clearTimeout(toastT);toastT=setTimeout(()=>t.remove(),2400)}
let sheetCleanup=null;
const setCleanup=f=>{sheetCleanup=f};
function runCleanup(){if(sheetCleanup){try{sheetCleanup()}catch(e){}sheetCleanup=null}}
function openSheet(html){runCleanup();const tt=$('.toast');if(tt)tt.remove();const s=$('#sheet');s.innerHTML=html;$('#sheetWrap').classList.add('open');document.body.classList.add('lock');s.scrollTop=0;return s}
function closeSheet(){runCleanup();$('#sheetWrap').classList.remove('open');document.body.classList.remove('lock');$('#sheet').innerHTML=''}
$('#sheetWrap').addEventListener('click',e=>{if(e.target.id==='sheetWrap')closeSheet()});
const shHead=t=>`<div class="sh-head"><h3>${t}</h3><button class="x" data-act="close">關閉</button></div>`;

/* ========== 畫面 ========== */
const LOGO='<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a8cf0"/><stop offset="1" stop-color="#0a56ad"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><path d="M8.6 12h14.8l1 11.6a2 2 0 0 1-2 2.2H9.6a2 2 0 0 1-2-2.2z" fill="#fff"/><path d="M11.4 12.4C11.4 6.6 20.6 6.6 20.6 12.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M11.2 19.6L21 15.4l-3.3 8.4-2-3.6z" fill="#0b6bcb"/><path d="M15.7 20.2L21 15.4" stroke="#fff" stroke-width=".9" stroke-linecap="round"/></svg>';
function render(){
  const t=curTrip();
  const todo=t?S.items.filter(i=>i.tripId===t.id&&!i.bought).length:0;
  const open=t?S.orders.filter(o=>o.tripId===t.id&&(!o.shipped||payState(o)[0]!=='paid')).length:0;
  const tabs=[['items','商品',todo],['orders','訂單',open],['customers','顧客',0],['trips','行程',0],['rates','匯率',0]];
  const hd=`<header><span class="brand">${LOGO}代購帳</span>${t?`<select id="tripSel" aria-label="目前行程">${S.trips.map(x=>`<option value="${x.id}"${x.id===t.id?' selected':''}>${esc(x.name)}（${x.currency}）</option>`).join('')}</select>`:'<span class="grow sub">先建立一趟行程</span>'}
    <button class="btn sm" data-act="converter">換算</button></header>`;
  let body;
  if(!t&&ui.tab!=='rates'&&ui.tab!=='trips')body=welcome();
  else body={items:viewItems,orders:viewOrders,customers:viewCustomers,trips:viewTrips,rates:viewRates}[ui.tab](t);
  const nav=`<nav><div class="in">${tabs.map(([k,l,b])=>`<button class="${ui.tab===k?'on':''}" data-act="tab" data-tab="${k}">${l}${b?`<span class="bd">${b}</span>`:''}</button>`).join('')}</div></nav>`;
  $('#app').innerHTML=hd+`<main>${body}</main>`+nav;
}
const welcome=()=>`<div class="empty"><b style="color:var(--fg);font-size:17px">歡迎使用代購帳</b><br>每趟出國建立一個行程，<br>商品、訂單、利潤都會分開記。<br><br><button class="btn primary" data-act="newTrip">建立第一趟行程</button></div>`;

const SORTS={new:'最新',price:'售價高到低',margin:'利潤率高到低',store:'店家',name:'名稱'};
function priceLabel(i,t){
  const ps=(i.variants||[]).map(v=>varPrice(i,v,t)).filter(p=>p>0);
  if(ps.length)return twd(Math.min(...ps))+(new Set(ps).size>1?' 起':'');
  return i.price?twd(i.price):'—';
}
function itemMargin(i,t){const p=i.price||0,c=costTwd(i,t);return p&&c?(p-c)/p:-1}
function itemListHTML(t){
  const f=ui.itemFilter,q=(ui.q||'').trim().toLowerCase();
  const mine=S.items.filter(i=>i.tripId===t.id);
  let list=mine.filter(i=>f==='all'||(f==='todo'?!i.bought:i.bought));
  if(q)list=list.filter(i=>[i.name,i.store,i.note,...(i.variants||[]).map(v=>v.n)].join(' ').toLowerCase().includes(q));
  const cmp={
    new:(a,b)=>b.createdAt-a.createdAt,
    price:(a,b)=>(b.price||0)-(a.price||0),
    margin:(a,b)=>itemMargin(b,t)-itemMargin(a,t),
    store:(a,b)=>(a.store||'\uffff').localeCompare(b.store||'\uffff','zh-Hant')||b.createdAt-a.createdAt,
    name:(a,b)=>(a.name||'').localeCompare(b.name||'','zh-Hant')
  }[ui.sort||'new'];
  list.sort(cmp);
  return list.length?list.map(i=>itemRow(i,t)).join(''):`<div class="empty">${mine.length?'沒有符合的商品':'還沒有商品。<br>出國前先把想買的記下來，<br>到現場再補成本和照片。'}</div>`;
}
function viewItems(t){
  const all=S.items.filter(i=>i.tripId===t.id),f=ui.itemFilter;
  const n=k=>all.filter(i=>k==='all'||(k==='todo'?!i.bought:i.bought)).length;
  const chip=(k,l)=>`<button class="chip ${f===k?'on':''}" data-act="itemFilter" data-id="${k}">${l} ${n(k)}</button>`;
  return (needBackup()?`<div class="warn" data-act="tab" data-tab="rates" style="cursor:pointer">超過 7 天沒備份了，點這裡去備份</div>`:'')+
    `<div class="chips">${chip('all','全部')}${chip('todo','待買')}${chip('done','已買')}</div>`+
    `<div class="row" style="gap:8px"><input class="inp" id="itemQ" type="search" enterkeyhint="search" placeholder="搜尋品名、店家、規格" value="${esc(ui.q||'')}" aria-label="搜尋商品" style="flex:1;min-width:0">`+
    `<select class="inp" id="itemSort" aria-label="排序" style="width:auto;flex:none">${Object.entries(SORTS).map(([k,l])=>`<option value="${k}"${(ui.sort||'new')===k?' selected':''}>${l}</option>`).join('')}</select></div>`+
    `<div id="itemList" class="list">${itemListHTML(t)}</div><button class="fab" data-act="newItem">＋ 新增商品</button>`;
}
function itemRow(i,t){
  const sold=soldQty(i.id),vs=i.variants||[];
  const costLine=num(i.cost)?fx(num(i.cost),t.currency)+' ≈ '+twd(costTwd(i,t)):(vs.some(v=>num(v.c)>0)?'規格各自成本':'成本未填');
  return `<div class="card item" data-act="editItem" data-id="${i.id}">
    <button class="chk ${i.bought?'on':''}" data-act="toggleBought" data-id="${i.id}" aria-label="已買">${i.bought?'✓':''}</button>
    <div class="thumb"${i.thumb?` style="background-image:url('${i.thumb}')"`:''}>${i.thumb?'':'無圖'}</div>
    <div class="grow"><div class="nm">${esc(i.name||'(未命名)')}</div>
      <div class="sub">${esc(i.store||'')}${i.store?' · ':''}× ${itemQty(i)}${vs.length?`（${vs.length} 款）`:''}${sold?` · 已售 ${sold}`:''}</div>
      <div class="sub">${costLine}</div></div>
    <div class="pr">${priceLabel(i,t)}</div></div>`;
}


function viewOrders(t){
  const all=S.orders.filter(o=>o.tripId===t.id).sort((a,b)=>b.createdAt-a.createdAt);
  const f=ui.orderFilter;
  const pass=(o,k)=>k==='all'||(k==='unpaid'?payState(o)[0]!=='paid':!o.shipped);
  const list=all.filter(o=>pass(o,f));
  const chip=(k,l)=>`<button class="chip ${f===k?'on':''}" data-act="orderFilter" data-id="${k}">${l} ${all.filter(o=>pass(o,k)).length}</button>`;
  return `<div class="chips">${chip('all','全部')}${chip('unpaid','未收齊')}${chip('unship','未出貨')}</div>`+
    (list.length?list.map(orderRow).join(''):`<div class="empty">${all.length?'這個分類沒有訂單':'還沒有訂單。<br>先新增商品和顧客，再建立訂單。'}</div>`)+
    `<button class="fab" data-act="newOrder">＋ 新增訂單</button>`;
}
function orderRow(o){
  const tot=orderTotal(o),[pk,pl]=payState(o),due=tot-Math.min(o.paid||0,tot);
  const names=o.lines.slice(0,2).map(l=>`${esc(lineLabel(l))}×${l.qty}`).join('、')+(o.lines.length>2?` 等 ${o.lines.length} 項`:'');
  return `<div class="card order" data-act="editOrder" data-id="${o.id}">
    <div class="top"><b>${esc(custName(o.customerId))}</b><span class="amt">${twd(tot)}</span></div>
    <div class="sub">${names}</div>
    <div class="chips"><button class="pill p-${pk}" data-act="togglePay" data-id="${o.id}">${pl}</button>
      <button class="pill ${o.shipped?'s-yes':'s-no'}" data-act="toggleShip" data-id="${o.id}">${o.shipped?'已出貨':'未出貨'}</button>
      <button class="pill s-no" data-act="orderImg" data-id="${o.id}">明細圖</button>
      ${due>0?`<span class="sub">待收 ${twd(due)}</span>`:''}</div></div>`;
}

function viewCustomers(){
  const list=S.customers.slice().sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
  return (list.length?list.map(c=>{
    const os=S.orders.filter(o=>o.customerId===c.id),tot=os.reduce((s,o)=>s+orderTotal(o),0),due=os.reduce((s,o)=>s+orderTotal(o)-Math.min(o.paid||0,orderTotal(o)),0);
    return `<div class="card row" data-act="editCustomer" data-id="${c.id}"><div class="grow"><div class="nm">${esc(c.name)}</div>
      <div class="sub">${esc(c.contact||'')}${c.contact?' · ':''}${os.length} 筆訂單 · 費率 +${c.rate!=null?cleanRate(c.rate):DEF_FEE}%</div></div>
      <div style="text-align:right"><b>${twd(tot)}</b>${due>0?`<div class="sub" style="color:var(--bad)">待收 ${twd(due)}</div>`:''}</div></div>`;
  }).join(''):`<div class="empty">還沒有顧客。<br>建立訂單時也可以直接新增。</div>`)+`<button class="fab" data-act="newCustomer">＋ 新增顧客</button>`;
}

function viewTrips(t){
  let h='';
  if(t){
    const s=tripStats(t);
    h+=`<h2>目前行程：${esc(t.name)}</h2><div class="stats">
      <div class="stat big"><span>利潤（已成交訂單）</span><b>${twd(s.profit)}${s.revenue?`　${fmt(s.margin,1)}%`:''}</b></div>
      <div class="stat"><span>營收</span><b>${twd(s.revenue)}</b></div>
      <div class="stat"><span>已收款</span><b>${twd(s.paid)}</b></div>
      <div class="stat"><span>待收款</span><b>${twd(s.due)}</b></div>
      <div class="stat"><span>未出貨訂單</span><b>${s.toShip} 筆</b></div>
      <div class="stat"><span>已買成本</span><b>${twd(s.buyCost)}</b></div>
      <div class="stat"><span>未售庫存（成本）</span><b>${twd(s.stock)}</b><span>${s.unsold} 件</span></div>
      <div class="stat"><span>已買 / 清單</span><b>${s.bought} / ${s.items}</b></div></div>`;
  }
  h+=`<h2>所有行程</h2>`+S.trips.slice().sort((a,b)=>b.createdAt-a.createdAt).map(x=>`
    <div class="card row" data-act="pickTrip" data-id="${x.id}"><div class="grow"><div class="nm">${esc(x.name)}${t&&x.id===t.id?' <span class="pill p-paid">目前</span>':''}</div>
    <div class="sub">${x.currency} · 1 ${x.currency} = NT$ ${fmt(x.rate,4)} · ${S.items.filter(i=>i.tripId===x.id).length} 件商品</div></div>
    <button class="btn sm" data-act="editTrip" data-id="${x.id}">編輯</button></div>`).join('');
  return h+`<button class="fab" data-act="newTrip">＋ 新行程</button>`;
}

function viewRates(){
  const r=S.meta.rates,at=S.meta.ratesAt,bk=S.meta.backupAt;
  const old=!bk||Date.now()-bk>7*864e5,has=S.items.length+S.orders.length>0;
  return `<h2>市場匯率（1 外幣 = NT$）</h2><div class="card">${Object.keys(CUR).map(k=>`
    <div class="rate"><div><b>${k}</b><div class="sub">${CUR[k].name}</div></div><div>
    <input class="inp" inputmode="decimal" data-rate="${k}" value="${r[k]}" aria-label="${k} 匯率">
    <div class="sub">≈ ${fmt(CUR[k].hint)} ${k} = NT$ ${fmt(r[k]*CUR[k].hint,1)}</div></div></div>`).join('')}
    <div class="row" style="margin-top:10px"><button class="btn primary grow" data-act="updateRates">連網更新匯率</button></div>
    <p class="hint">${at?'上次更新：'+new Date(at).toLocaleString('zh-TW'):'尚未更新，目前是概略匯率'}。每次更新只用幾 KB 流量。<br>每趟行程有自己的「實際換匯匯率」，不會被這裡改動。</p></div>
    <h2>資料備份</h2><div class="card">
    ${memOnly?'<div class="warn">這個瀏覽器無法儲存資料（可能是無痕模式），關掉就會消失。</div>':''}
    ${has&&old?`<div class="warn">${bk?'超過 7 天沒備份了':'還沒備份過'}。換手機或清除瀏覽資料前請先備份。</div>`:`<div class="good">${bk?'上次備份：'+new Date(bk).toLocaleString('zh-TW'):'目前沒有資料需要備份'}</div>`}
    <div class="row" style="margin-top:10px"><button class="btn grow" data-act="exportBackup">匯出備份</button><button class="btn grow" data-act="importBackup">匯入備份</button></div>
    <p class="hint">備份檔包含所有商品、照片、訂單。按「匯出備份」後，在分享選單選「儲存到檔案」，位置選 iCloud Drive。<br>備份檔內有顧客資料，請不要公開分享，也不要上傳到 GitHub。</p></div>
    <h2>匯款資訊（印在訂單明細圖上）</h2><div class="card"><textarea class="inp" id="payInfo" rows="3" placeholder="銀行、帳號、戶名">${esc(S.meta.payInfo||'')}</textarea><p class="hint">只存在這支手機，離開輸入框後自動儲存。</p></div>
    <h2>離線狀態</h2><div class="card"><div id="swState" class="sub">${swText()}</div><div class="sub" style="margin-top:4px">版本 ${VERSION}</div></div>`;
}
let swOK=null;
const swText=()=>swOK===true?'離線模式已就緒，沒有網路也能開啟和使用。':swOK===false?'離線模式尚未啟用（需要用 https 網址開啟）。':'檢查中…';

/* ========== 行程表單 ========== */
function tripSheet(id){
  const ex=id?S.trips.find(x=>x.id===id):null;
  const t=ex?JSON.parse(JSON.stringify(ex)):{id:uid(),name:'',currency:'JPY',rate:S.meta.rates.JPY,round:10,mode:'mult',defaults:{mult:1.1,add:100,margin:25},createdAt:Date.now()};
  const s=openSheet(shHead(ex?'編輯行程':'新增行程')+`
    <label class="f"><span>行程名稱</span><input id="tName" value="${esc(t.name)}" placeholder="例：2026/12 首爾 Olive Young"></label>
    <div class="two"><label class="f"><span>幣別</span><select id="tCur">${Object.keys(CUR).map(k=>`<option value="${k}"${k===t.currency?' selected':''}>${k} ${CUR[k].name}</option>`).join('')}</select></label>
    <label class="f"><span>實際換匯匯率（1 外幣 = NT$）</span><input id="tRate" inputmode="decimal" value="${t.rate}"></label></div>
    <div class="row" style="margin:-4px 0 12px"><button class="btn sm" id="useMkt" type="button">帶入市場匯率</button><span class="sub" id="rateHint"></span></div>
    <h2>預設定價</h2>
    <div class="seg" id="tMode">${Object.keys(MODE_LABEL).map(k=>`<button type="button" data-m="${k}" class="${t.mode===k?'on':''}">${MODE_LABEL[k]}</button>`).join('')}</div>
    <div class="two"><label class="f"><span>倍數 ×</span><input id="dMult" inputmode="decimal" value="${t.defaults.mult}"></label>
    <label class="f"><span>固定加價 NT$</span><input id="dAdd" inputmode="decimal" value="${t.defaults.add}"></label>
    <label class="f"><span>目標利潤率 %</span><input id="dMargin" inputmode="decimal" value="${t.defaults.margin}"></label>
    <label class="f"><span>售價進位到</span><select id="tRound">${[1,5,10,50].map(r=>`<option value="${r}"${t.round===r?' selected':''}>${r===1?'個位':r+' 的倍數'}</option>`).join('')}</select></label></div>
    <p class="hint">每件商品都可以單獨改定價方式，這裡只是預設值。</p>
    <div class="actions">${ex?`<button class="btn danger" id="tDel" style="flex:0 0 auto">刪除</button>`:''}<button class="btn primary" id="tSave">儲存</button></div>`);
  const hint=()=>{const c=$('#tCur').value;$('#rateHint').textContent=`市場：${S.meta.rates[c]}`};hint();
  $('#tCur').onchange=()=>{$('#tRate').value=S.meta.rates[$('#tCur').value];hint()};
  $('#useMkt').onclick=()=>{$('#tRate').value=S.meta.rates[$('#tCur').value]};
  $('#tMode').onclick=e=>{const b=e.target.closest('[data-m]');if(!b)return;t.mode=b.dataset.m;[...$('#tMode').children].forEach(x=>x.classList.toggle('on',x===b))};
  $('#tSave').onclick=async()=>{
    const name=$('#tName').value.trim();if(!name){toast('請輸入行程名稱');return}
    const rate=num($('#tRate').value);if(rate<=0){toast('請輸入匯率');return}
    Object.assign(t,{name,currency:$('#tCur').value,rate,round:+$('#tRound').value,defaults:{mult:num($('#dMult').value)||1,add:num($('#dAdd').value),margin:num($('#dMargin').value)}});
    await save('trips',t);await setMeta('tripId',t.id);if(!ex)ui.tab='items';closeSheet();render();toast('已儲存行程');
  };
  if($('#tDel'))$('#tDel').onclick=async function(){
    if(!this.dataset.ok){this.dataset.ok=1;this.textContent='再按一次：連商品和訂單一起刪除';return}
    for(const i of S.items.filter(i=>i.tripId===t.id))await remove('items',i.id);
    for(const o of S.orders.filter(o=>o.tripId===t.id))await remove('orders',o.id);
    await remove('trips',t.id);if(S.meta.tripId===t.id)await setMeta('tripId',(S.trips[0]||{}).id||'');closeSheet();render();
  };
}

/* ========== 商品表單 ========== */
function itemSheet(id){
  const t=curTrip(),ex=id?S.items.find(x=>x.id===id):null;
  const lastStore=(S.items.filter(i=>i.tripId===t.id).sort((a,b)=>b.createdAt-a.createdAt)[0]||{}).store||'';
  const it=ex?{...ex}:{id:uid(),tripId:t.id,name:'',store:lastStore,cost:'',qty:1,mode:t.mode,val:t.defaults[t.mode],price:0,manual:false,bought:false,note:'',photo:'',thumb:'',photos:[],variants:[],createdAt:Date.now()};
  const photos=photosOf(it).map(x=>({p:x.p,t:x.t}));
  const vars=(it.variants||[]).map(v=>({n:v.n,q:v.q,c:v.c||'',p:v.p||''}));
  const stores=[...new Set(S.items.map(i=>i.store).filter(Boolean))];
  const valLabel={mult:'倍數 ×',add:'加價 NT$',margin:'利潤率 %'};
  openSheet(shHead(ex?'編輯商品':'新增商品')+`
    <label class="photo" for="ph" id="phBox"></label>
    <input type="file" id="ph" accept="image/*" multiple hidden>
    <div class="ph-strip" id="phStrip"></div>
    <label class="f"><span>品名</span><input id="iName" value="${esc(it.name)}" placeholder="例：Dr.G 防曬乳 50ml" autocomplete="off"></label>
    <div class="two"><label class="f"><span>購買店家</span><input id="iStore" list="storeList" value="${esc(it.store)}" placeholder="例：Olive Young" autocomplete="off"><datalist id="storeList">${stores.map(s=>`<option value="${esc(s)}">`).join('')}</datalist></label>
    <label class="f"><span>數量</span><input id="iQty" type="number" min="1" inputmode="numeric" value="${it.qty||1}"></label></div>
    <label class="f"><span>商品細節（會顯示在圖片上）</span><textarea id="iNote" placeholder="規格、色號、容量、備註">${esc(it.note)}</textarea></label>
    <label class="f"><span>成本（${t.currency}，每件，規格沒填成本時沿用）</span><input id="iCost" inputmode="decimal" value="${it.cost===''?'':it.cost}" placeholder="0"></label>
    <div class="calc"><div class="sub" id="cTwd"></div>
      <div class="seg" id="iMode" style="margin-top:8px">${Object.keys(MODE_LABEL).map(k=>`<button type="button" data-m="${k}" class="${it.mode===k?'on':''}">${MODE_LABEL[k]}</button>`).join('')}</div>
      <div class="two"><label class="f" style="margin:0"><span id="vLbl">${valLabel[it.mode]}</span><input id="iVal" inputmode="decimal" value="${it.val}"></label>
      <label class="f" style="margin:0"><span>售價 NT$ <a href="#" id="auto" style="display:none;color:var(--accent)">改回自動</a></span><input id="iPrice" inputmode="decimal" value="${it.price||''}"></label></div>
      <div class="sub" id="cProfit" style="margin-top:8px"></div></div>
    <div class="f"><span>規格（選填）：容量、尺寸、色號</span><p class="hint" style="margin:0 0 8px">每個規格可以填自己的成本和售價，留空就沿用上面的設定。名稱寫上容量（例如 100ml、30片），會自動算每單位多少錢。</p><div id="vars"></div><button class="btn sm" id="addVar" type="button">＋ 加規格</button></div>
    <label class="chkrow"><input type="checkbox" id="iBought"${it.bought?' checked':''}><span>已買到</span></label>
    <div class="actions">${ex?`<button class="btn danger" id="iDel" style="flex:0 0 auto">刪除</button>`:''}<button class="btn" id="iSave">儲存</button><button class="btn primary" id="iExp">儲存並匯出圖片</button></div>`);

  /* 照片：可多張，第一張是主圖 */
  const drawPhotos=()=>{
    const b=$('#phBox');
    if(photos[0]){b.style.backgroundImage=`url('${photos[0].p}')`;b.textContent=''}
    else{b.style.backgroundImage='';b.textContent='拍照 / 選照片（可多張）'}
    $('#phStrip').innerHTML=photos.length?photos.map((x,n)=>`<div class="ph-th${n===0?' main':''}" data-n="${n}" style="background-image:url('${x.t}')"><button class="ph-x" data-f="del" type="button" aria-label="刪除照片">×</button></div>`).join('')+(photos.length>1?'<span class="sub" style="align-self:center;white-space:nowrap">點縮圖設為主圖</span>':''):'';
  };
  drawPhotos();
  $('#ph').onchange=async e=>{
    const fs=[...e.target.files];e.target.value='';
    for(const f of fs){
      if(photos.length>=6){toast('最多 6 張照片');break}
      try{const r=await processPhoto(f);photos.push({p:r.photo,t:r.thumb})}catch(err){toast('有照片無法讀取')}
    }
    drawPhotos();
  };
  $('#phStrip').onclick=e=>{
    const th=e.target.closest('.ph-th');if(!th)return;const n=+th.dataset.n;
    if(e.target.dataset.f==='del')photos.splice(n,1);else if(n>0)photos.unshift(photos.splice(n,1)[0]);
    drawPhotos();
  };

  /* 規格：名稱、數量、成本、售價（成本與售價可留空） */
  const baseCost=()=>num($('#iCost').value)*t.rate;
  const vPrice=v=>{
    if(num(v.p)>0)return num(v.p);
    const c=num(v.c)>0?num(v.c)*t.rate:baseCost();
    return num(v.c)>0&&c>0?calcPrice(c,it.mode,num($('#iVal').value),t.round):(num($('#iPrice').value)||0);
  };
  const syncQty=()=>{const q=$('#iQty');if(vars.length){q.value=vars.reduce((s,v)=>s+Math.max(0,Math.round(num(v.q))),0);q.disabled=true}else q.disabled=false};
  const updVars=()=>{
    const rows=[...$('#vars').children];
    const infos=vars.map(v=>{const price=vPrice(v),cost=num(v.c)>0?num(v.c)*t.rate:baseCost();return{price,cost,u:unitPrice(v.n,price)}});
    const best={},cnt={};
    infos.forEach((x,i)=>{if(!x.u)return;cnt[x.u.cls]=(cnt[x.u.cls]||0)+1;const b=best[x.u.cls];if(b===undefined||x.u.per<infos[b].u.per)best[x.u.cls]=i});
    rows.forEach((r,i)=>{
      const x=infos[i];
      r.querySelector('[data-f=p]').placeholder=x.price?`售價 ${fmt(x.price)}`:'售價';
      const mg=x.price&&x.cost?` · 利潤 ${fmt((x.price-x.cost)/x.price*100,0)}%`:'';
      const un=x.u?` · NT$ ${fmtUnit(x.u.per)}/${x.u.unit}${cnt[x.u.cls]>1&&best[x.u.cls]===i?'　★ 最划算':''}`:'';
      r.querySelector('.vinfo').textContent=(x.price?`NT$ ${fmt(x.price)}`:'')+mg+un;
    });
  };
  const drawVars=()=>{
    $('#vars').innerHTML=vars.map((v,n)=>`<div class="vrow" data-n="${n}"><input data-f="n" placeholder="規格，例：100ml 或 01 Rose" value="${esc(v.n)}" aria-label="規格名稱"><button class="rm" data-f="rm" type="button" aria-label="移除規格">×</button>
      <input data-f="q" type="number" min="0" inputmode="numeric" placeholder="數量" value="${v.q}" aria-label="數量"><input data-f="c" inputmode="decimal" placeholder="成本 ${t.currency}" value="${v.c}" aria-label="成本"><input data-f="p" inputmode="decimal" placeholder="售價" value="${v.p}" aria-label="售價"><div class="vinfo"></div></div>`).join('');
    syncQty();updVars();
  };

  const recalc=()=>{
    const c=num($('#iCost').value)*t.rate;
    $('#cTwd').textContent=c?`成本 ≈ ${twd(c)}（匯率 ${fmt(t.rate,4)}）`:'輸入成本後自動計算售價';
    if(!it.manual){it.price=calcPrice(c,it.mode,num($('#iVal').value),t.round);$('#iPrice').value=it.price||''}
    const p=num($('#iPrice').value);
    $('#cProfit').textContent=p&&c?`每件利潤 ${twd(p-c)}（${fmt((p-c)/p*100,1)}%）`:'';
    $('#auto').style.display=it.manual?'inline':'none';
    updVars();
  };
  drawVars();recalc();
  $('#addVar').onclick=()=>{vars.push({n:'',q:1,c:'',p:''});drawVars();const r=$('#vars').lastElementChild;if(r)r.querySelector('input').focus()};
  $('#vars').oninput=e=>{
    const r=e.target.closest('.vrow'),f=e.target.dataset.f;if(!r||!f||f==='rm')return;
    vars[+r.dataset.n][f]=e.target.value;if(f==='q')syncQty();updVars();
  };
  $('#vars').onclick=e=>{if(e.target.dataset.f==='rm'){vars.splice(+e.target.closest('.vrow').dataset.n,1);drawVars()}};
  $('#iCost').oninput=$('#iVal').oninput=recalc;
  $('#iPrice').oninput=()=>{it.manual=true;recalc()};
  $('#auto').onclick=e=>{e.preventDefault();it.manual=false;recalc()};
  $('#iMode').onclick=e=>{const b=e.target.closest('[data-m]');if(!b)return;it.mode=b.dataset.m;it.manual=false;
    [...$('#iMode').children].forEach(x=>x.classList.toggle('on',x===b));$('#iVal').value=t.defaults[it.mode];$('#vLbl').textContent=valLabel[it.mode];recalc()};

  const commit=async()=>{
    const name=$('#iName').value.trim();if(!name){toast('請輸入品名');return false}
    const vlist=vars.map(v=>({n:v.n.trim().slice(0,60),q:Math.max(0,Math.round(num(v.q))),c:num(v.c)>0?num(v.c):'',p:num(v.p)>0?num(v.p):''})).filter(v=>v.n);
    const vsum=vlist.reduce((s,v)=>s+v.q,0);
    Object.assign(it,{name,store:$('#iStore').value.trim(),qty:vlist.length?Math.max(1,vsum):Math.max(1,Math.round(num($('#iQty').value))||1),variants:vlist,
      note:$('#iNote').value.trim(),cost:num($('#iCost').value)||'',val:num($('#iVal').value),price:num($('#iPrice').value),bought:$('#iBought').checked,
      photos:photos.map(x=>({p:x.p,t:x.t})),photo:photos[0]?photos[0].p:'',thumb:photos[0]?photos[0].t:''});
    await save('items',it);return true;
  };
  $('#iSave').onclick=async()=>{if(await commit()){closeSheet();render();toast('已儲存')}};
  $('#iExp').onclick=async()=>{if(await commit()){render();exportSheet(it.id)}};
  if($('#iDel'))$('#iDel').onclick=async function(){
    if(!this.dataset.ok){this.dataset.ok=1;this.textContent='再按一次刪除';return}
    await remove('items',it.id);closeSheet();render();
  };
}

function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src})}
async function processPhoto(file){
  const url=URL.createObjectURL(file);
  try{
    const im=await loadImg(url);
    const draw=max=>{const k=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight));const c=document.createElement('canvas');
      c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',max>400?.82:.7)};
    return{photo:draw(1200),thumb:draw(160)};
  }finally{URL.revokeObjectURL(url)}
}

/* ========== 訂單表單 ========== */
function orderSheet(id){
  const t=curTrip(),ex=id?S.orders.find(x=>x.id===id):null;
  const items=S.items.filter(i=>i.tripId===t.id);
  if(!ex&&!items.length){toast('先新增商品，才能建立訂單');return}
  const o=ex?JSON.parse(JSON.stringify(ex)):{id:uid(),tripId:t.id,customerId:(S.customers[0]||{}).id||'__new',lines:[],paid:0,shipped:false,note:'',createdAt:Date.now()};
  let rate=ex?(ex.rate!=null?cleanRate(ex.rate):custRate(ex.customerId)):custRate(o.customerId);
  // 規格剩餘數量：編輯舊訂單時，要把這張訂單原本佔用的數量加回來
  const leftOf=(itm,vn)=>{const v=(itm.variants||[]).find(x=>x.n===vn);if(!v)return 0;
    const own=ex?ex.lines.filter(l=>l.itemId===itm.id&&(l.variant||'')===vn).reduce((s,l)=>s+l.qty,0):0;return v.q-soldQty(itm.id,vn)+own};
  const defVariant=itm=>{const vs=itm.variants||[];const f=vs.find(v=>leftOf(itm,v.n)>0)||vs[0];return f?f.n:''};
  const itemOpts=sel=>items.map(i=>`<option value="${i.id}"${i.id===sel?' selected':''}>${esc(i.name)}</option>`).join('');
  const varOpts=(itm,sel)=>(itm.variants||[]).map(v=>`<option value="${esc(v.n)}"${v.n===sel?' selected':''}>${esc(v.n)} · NT$ ${fmt(feePrice(itm,v,t,rate))}（剩 ${leftOf(itm,v.n)}）</option>`).join('');
  openSheet(shHead(ex?'編輯訂單':'新增訂單')+`
    <label class="f"><span>顧客</span><select id="oCust">${S.customers.map(c=>`<option value="${c.id}"${c.id===o.customerId?' selected':''}>${esc(c.name)}</option>`).join('')}<option value="__new"${o.customerId==='__new'?' selected':''}>＋ 新顧客</option></select></label>
    <label class="f" id="newCustBox" style="display:none"><span>新顧客名稱</span><input id="oNewName" placeholder="姓名或 LINE 暱稱"></label>
    <div class="f"><span>代購費率（售價 = 成本 ×（1＋費率））</span><div class="chips" id="rateChips" style="align-items:center">${[5,8,10,12,15].map(r=>`<button type="button" class="chip" data-r="${r}">+${r}%</button>`).join('')}<input class="inp" id="oRate" inputmode="decimal" aria-label="自訂費率 %" style="width:78px;flex:none" value="${rate}"><span class="sub">%</span></div></div>
    <h2>商品</h2><div id="lines"></div>
    <button class="btn sm" id="addLine" type="button">＋ 加商品</button>
    <div class="calc" style="margin-top:12px"><div class="row"><span class="grow sub">訂單總額</span><span class="big" id="oTot"></span></div>
      <div class="two" style="margin-top:10px"><label class="f" style="margin:0"><span>已收款 NT$</span><input id="oPaid" inputmode="decimal" value="${o.paid||''}" placeholder="0"></label>
      <div style="display:flex;gap:6px;align-items:end"><button class="btn sm" id="payAll" type="button">全額</button><button class="btn sm" id="payNone" type="button">清空</button></div></div>
      <div id="oPayState" style="margin-top:8px"></div></div>
    <div class="warn" id="oWarn" style="display:none;margin-bottom:12px"></div>
    <label class="chkrow"><input type="checkbox" id="oShip"${o.shipped?' checked':''}><span>已出貨</span></label>
    <label class="f"><span>備註</span><input id="oNote" value="${esc(o.note)}" placeholder="收件方式、面交地點⋯"></label>
    <div class="actions">${ex?`<button class="btn danger" id="oDel" style="flex:0 0 auto">刪除</button>`:''}<button class="btn" id="oSave">儲存</button><button class="btn primary" id="oImg">儲存並匯出明細圖</button></div>`);
  const total=()=>o.lines.reduce((s,l)=>s+l.qty*l.price,0);
  const upd=()=>{
    const tot=total(),paid=num($('#oPaid').value);
    $('#oTot').textContent=twd(tot);
    const [k,l]=payState({lines:o.lines,paid});
    $('#oPayState').innerHTML=`<span class="pill p-${k}">${l}</span>${tot>paid?` <span class="sub">待收 ${twd(tot-paid)}</span>`:''}`;
    stockWarn();
  };
  // 已買到的商品，訂購數量超過庫存時提醒（預購還沒買的不提醒）
  const stockWarn=()=>{
    const need={},msgs=[];
    o.lines.forEach(l=>{const k=l.itemId+'|'+(l.variant||'');need[k]=(need[k]||0)+l.qty});
    for(const k of Object.keys(need)){
      const [iid,vn]=k.split('|'),itm=items.find(i=>i.id===iid);if(!itm||!itm.bought)continue;
      const own=ex?ex.lines.filter(l=>l.itemId===iid&&(l.variant||'')===vn).reduce((s,l)=>s+l.qty,0):0;
      const total=vn?((itm.variants||[]).find(v=>v.n===vn)||{q:0}).q:itemQty(itm);
      const left=total-soldQty(iid,vn||undefined)+own;
      if(need[k]>left)msgs.push(`${itm.name}${vn?'（'+vn+'）':''} 只剩 ${Math.max(0,left)} 件，這張訂單要 ${need[k]} 件`);
    }
    const w=$('#oWarn');w.style.display=msgs.length?'block':'none';w.textContent=msgs.length?'庫存不足：'+msgs.join('；'):'';
  };
  const drawLines=()=>{
    $('#lines').innerHTML=o.lines.map((l,n)=>{
      const itm=items.find(i=>i.id===l.itemId);
      return `<div class="line" data-n="${n}"><select data-f="item">${itemOpts(l.itemId)}${itm?'':`<option selected>${esc(l.name)}</option>`}</select>
      ${itm&&(itm.variants||[]).length?`<select data-f="variant" aria-label="規格">${varOpts(itm,l.variant)}</select>`:''}
      <input data-f="qty" type="number" min="1" inputmode="numeric" value="${l.qty}" aria-label="數量"><input data-f="price" inputmode="decimal" value="${l.price}" aria-label="單價"><button class="rm" data-f="rm" type="button" aria-label="移除">×</button></div>`}).join('')||'<p class="hint">還沒有商品，按下方加入。</p>';
    upd();
  };
  const lineFor=(itm,vn)=>{const v=vn?findVar(itm,vn):null;return{price:feePrice(itm,v,t,rate),costTwd:varCost(itm,v,t)}};
  const markRate=()=>[...document.querySelectorAll('#rateChips [data-r]')].forEach(b=>b.classList.toggle('on',+b.dataset.r===rate));
  const setRate=(r,typed)=>{
    rate=r;if(!typed)$('#oRate').value=r;markRate();
    o.lines.forEach(l=>{if(l.man)return;const itm=items.find(i=>i.id===l.itemId);if(itm)Object.assign(l,lineFor(itm,l.variant))});
    drawLines();
  };
  const addLine=itm=>{const vn=defVariant(itm);o.lines.push({itemId:itm.id,name:itm.name,variant:vn,qty:1,...lineFor(itm,vn)})};
  const toggleNew=()=>{$('#newCustBox').style.display=$('#oCust').value==='__new'?'block':'none'};
  toggleNew();markRate();
  $('#oCust').onchange=()=>{toggleNew();if(!ex)setRate(custRate($('#oCust').value))};
  $('#rateChips').onclick=e=>{const b=e.target.closest('[data-r]');if(b)setRate(+b.dataset.r)};
  $('#oRate').oninput=e=>{const s=e.target.value.trim();if(s===''||isNaN(Number(s)))return;setRate(cleanRate(s),true)};
  if(!o.lines.length)addLine(items.find(i=>!i.bought)||items[0]);
  drawLines();
  $('#addLine').onclick=()=>{addLine(items.find(i=>!o.lines.some(l=>l.itemId===i.id))||items[0]);drawLines()};
  $('#lines').onchange=e=>{
    const row=e.target.closest('.line');if(!row)return;const l=o.lines[+row.dataset.n],f=e.target.dataset.f;
    if(f==='item'){const itm=items.find(i=>i.id===e.target.value);if(!itm)return;const dv=defVariant(itm);Object.assign(l,{itemId:itm.id,name:itm.name,variant:dv,...lineFor(itm,dv)});drawLines()}
    else if(f==='variant'){const itm=items.find(i=>i.id===l.itemId);l.variant=e.target.value;if(itm)Object.assign(l,lineFor(itm,l.variant));drawLines()}
  };
  $('#lines').oninput=e=>{
    const row=e.target.closest('.line');if(!row)return;const l=o.lines[+row.dataset.n],f=e.target.dataset.f;
    if(f==='qty')l.qty=Math.max(1,Math.round(num(e.target.value))||1);if(f==='price'){l.price=num(e.target.value);l.man=true}upd();
  };
  $('#lines').onclick=e=>{if(e.target.dataset.f==='rm'){o.lines.splice(+e.target.closest('.line').dataset.n,1);drawLines()}};
  $('#oPaid').oninput=upd;
  $('#payAll').onclick=()=>{$('#oPaid').value=total();upd()};
  $('#payNone').onclick=()=>{$('#oPaid').value='';upd()};
  const commit=async()=>{
    if(!o.lines.length){toast('請至少加入一項商品');return false}
    let cid=$('#oCust').value;
    if(cid==='__new'){const nm=$('#oNewName').value.trim();if(!nm){toast('請輸入新顧客名稱');return false}
      const c={id:uid(),name:nm,contact:'',note:'',rate,createdAt:Date.now()};await save('customers',c);cid=c.id}
    Object.assign(o,{customerId:cid,rate,paid:num($('#oPaid').value),shipped:$('#oShip').checked,note:$('#oNote').value.trim()});
    await save('orders',o);return true;
  };
  $('#oSave').onclick=async()=>{if(await commit()){closeSheet();render();toast('已儲存訂單')}};
  $('#oImg').onclick=async()=>{if(await commit()){render();orderImageSheet(o.id)}};
  if($('#oDel'))$('#oDel').onclick=async function(){
    if(!this.dataset.ok){this.dataset.ok=1;this.textContent='再按一次刪除';return}
    await remove('orders',o.id);closeSheet();render();
  };
}

/* ========== 顧客表單 ========== */
function customerSheet(id){
  const ex=id?S.customers.find(x=>x.id===id):null;
  const c=ex?{...ex}:{id:uid(),name:'',contact:'',note:'',rate:DEF_FEE,createdAt:Date.now()};
  const os=ex?S.orders.filter(o=>o.customerId===c.id).sort((a,b)=>b.createdAt-a.createdAt):[];
  const tot=os.reduce((s,o)=>s+orderTotal(o),0),due=os.reduce((s,o)=>s+orderTotal(o)-Math.min(o.paid||0,orderTotal(o)),0);
  openSheet(shHead(ex?'顧客資料':'新增顧客')+`
    <label class="f"><span>名稱</span><input id="cName" value="${esc(c.name)}" placeholder="姓名或 LINE 暱稱"></label>
    <label class="f"><span>聯絡方式</span><input id="cContact" value="${esc(c.contact)}" placeholder="LINE ID、IG、電話"></label>
    <label class="f"><span>預設代購費率 %（下訂時自動帶入，可再調整）</span><input id="cRate" inputmode="decimal" value="${c.rate!=null?cleanRate(c.rate):DEF_FEE}"></label>
    <label class="f"><span>備註</span><textarea id="cNote" placeholder="收件地址、偏好、膚質⋯">${esc(c.note)}</textarea></label>
    ${ex?`<h2>購買紀錄（${os.length} 筆　共 ${twd(tot)}${due>0?`　待收 ${twd(due)}`:''}）</h2>`+(os.map(o=>{const tr=tripOf(o.tripId),[pk,pl]=payState(o);return `<div class="card" style="margin-bottom:8px"><div class="row"><b class="grow">${twd(orderTotal(o))}</b><span class="pill p-${pk}">${pl}</span><span class="pill ${o.shipped?'s-yes':'s-no'}">${o.shipped?'已出貨':'未出貨'}</span></div>
      <div class="sub" style="white-space:normal">${o.lines.map(l=>`${esc(lineLabel(l))}×${l.qty}`).join('、')}</div><div class="sub">${tr?esc(tr.name):''} · ${new Date(o.createdAt).toLocaleDateString('zh-TW')}</div></div>`}).join('')||'<p class="hint">還沒有訂單</p>'):''}
    <div class="actions">${ex?`<button class="btn danger" id="cDel" style="flex:0 0 auto">刪除</button>`:''}<button class="btn primary" id="cSave">儲存</button></div>`);
  $('#cSave').onclick=async()=>{const name=$('#cName').value.trim();if(!name){toast('請輸入名稱');return}
    Object.assign(c,{name,contact:$('#cContact').value.trim(),note:$('#cNote').value.trim(),rate:cleanRate($('#cRate').value.trim()===''?DEF_FEE:$('#cRate').value)});await save('customers',c);closeSheet();render()};
  if($('#cDel'))$('#cDel').onclick=async function(){
    if(os.length){toast('這位顧客還有訂單，請先刪除訂單');return}
    if(!this.dataset.ok){this.dataset.ok=1;this.textContent='再按一次刪除';return}
    await remove('customers',c.id);closeSheet();render();
  };
}

/* ========== 匯率換算器 ========== */
function converterSheet(){
  const t=curTrip();let cur=t?t.currency:'JPY';
  const rateOf=c=>t&&t.currency===c?t.rate:S.meta.rates[c];
  openSheet(shHead('換算')+`
    <div class="seg" id="cvTab"><button type="button" data-k="fx" class="on">匯率換算</button><button type="button" data-k="unit">單價比較</button></div>
    <label class="f"><span>幣別</span><select id="vCur">${Object.keys(CUR).map(k=>`<option value="${k}"${k===cur?' selected':''}>${k} ${CUR[k].name}</option>`).join('')}</select></label>
    <div id="cvFx"><div class="two"><label class="f"><span id="vA">外幣</span><input id="vF" inputmode="decimal" placeholder="0"></label><label class="f"><span>台幣 NT$</span><input id="vT" inputmode="decimal" placeholder="0"></label></div>
    <p class="hint" id="vNote"></p></div>
    <div id="cvUnit" style="display:none">
      <label class="f"><span>比較單位</span><select id="uUnit"><option value="ml">毫升 ml</option><option value="g">公克 g</option><option value="pc">片 / 入 / 個</option></select></label>
      ${[1,2,3,4].map(()=>`<div class="urow"><input class="inp" data-f="p" inputmode="decimal" placeholder="價格"><input class="inp" data-f="a" inputmode="decimal" placeholder="容量或數量"><div class="uout"></div></div>`).join('')}
      <p class="hint">輸入各種容量的價格和數量，自動算每單位多少錢，最划算的會標出來。</p></div>
    <div class="actions"><button class="btn primary" data-act="close">完成</button></div>`);
  const cur$=()=>$('#vCur').value;
  const note=()=>{cur=cur$();$('#vA').textContent=cur+' '+CUR[cur].name;$('#vNote').textContent=`使用匯率：1 ${cur} = NT$ ${fmt(rateOf(cur),4)}${t&&t.currency===cur?'（目前行程）':'（市場）'}`};note();
  const calcUnit=()=>{
    const rows=[...document.querySelectorAll('#cvUnit .urow')],unit={ml:'ml',g:'g',pc:'個'}[$('#uUnit').value],rate=rateOf(cur$());
    const vals=rows.map(r=>{const p=num(r.querySelector('[data-f=p]').value),a=num(r.querySelector('[data-f=a]').value);return p>0&&a>0?p/a:null});
    const ok=vals.filter(v=>v!==null),best=ok.length>1?Math.min(...ok):null;
    rows.forEach((r,i)=>{const v=vals[i],o=r.querySelector('.uout');
      o.innerHTML=v===null?'':`${CUR[cur$()].sym}${fmt(v,v<1?3:2)}/${unit} ≈ NT$ ${fmtUnit(v*rate)}/${unit}　每 100${unit} NT$ ${fmt(v*rate*100,0)}${best!==null&&v===best?' <b style="color:var(--good)">★ 最划算</b>':''}`});
  };
  $('#cvTab').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;[...$('#cvTab').children].forEach(x=>x.classList.toggle('on',x===b));
    $('#cvFx').style.display=b.dataset.k==='fx'?'block':'none';$('#cvUnit').style.display=b.dataset.k==='unit'?'block':'none';
    if(b.dataset.k==='unit')calcUnit()};
  $('#vCur').onchange=()=>{note();$('#vF').dispatchEvent(new Event('input'));calcUnit()};
  $('#vF').oninput=()=>{const v=num($('#vF').value);$('#vT').value=v?fmt(v*rateOf(cur),1).replace(/,/g,''):''};
  $('#vT').oninput=()=>{const v=num($('#vT').value);$('#vF').value=v?fmt(v/rateOf(cur),CUR[cur].dec).replace(/,/g,''):''};
  $('#cvUnit').oninput=calcUnit;$('#uUnit').onchange=calcUnit;
  $('#vF').focus();
}

async function updateRates(){
  try{
    const ac=new AbortController(),to=setTimeout(()=>ac.abort(),8000);
    const r=await fetch('https://open.er-api.com/v6/latest/TWD',{cache:'no-store',signal:ac.signal});clearTimeout(to);
    const j=await r.json();if(!j||!j.rates)throw 0;
    const rates={...S.meta.rates};Object.keys(CUR).forEach(k=>{if(j.rates[k]>0)rates[k]=+(1/j.rates[k]).toPrecision(5)});
    await setMeta('rates',rates);await setMeta('ratesAt',Date.now());return true;
  }catch(e){return false}
}

/* ========== 備份 ========== */
async function exportBackup(){
  const data=JSON.stringify({app:'daigou',v:1,at:Date.now(),trips:S.trips,items:S.items,customers:S.customers,orders:S.orders,rates:S.meta.rates,payInfo:S.meta.payInfo||''});
  const blob=new Blob([data],{type:'application/json'});
  const name='代購帳備份-'+new Date().toISOString().slice(0,10)+'.json';
  await setMeta('backupAt',Date.now());
  try{const f=new File([blob],name,{type:'application/json'});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f]});render();return}}catch(e){if(e&&e.name==='AbortError'){render();return}}
  download(blob,name);render();
}
/* 匯入備份時逐欄檢查：只收預期的欄位和格式，其餘一律丟掉，避免壞檔或惡意檔案影響 App */
const okId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(x);
const cs=(v,m)=>String(v==null?'':v).slice(0,m);
const cn=v=>{const n=Number(v);return isFinite(n)?n:0};
const ci=(v,lo,hi)=>Math.min(hi,Math.max(lo,Math.round(cn(v))));
const cleanImg=v=>typeof v==='string'&&v.length<4e6&&/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]*$/.test(v)?v:'';
const CLEAN={
  trips:r=>{if(!r||!okId(r.id)||!CUR[r.currency]||!(Number(r.rate)>0))return null;const d=r.defaults||{};
    return{id:r.id,name:cs(r.name,100),currency:r.currency,rate:Number(r.rate),round:[1,5,10,50].includes(+r.round)?+r.round:10,
      mode:MODE_LABEL[r.mode]?r.mode:'mult',defaults:{mult:cn(d.mult)||1,add:cn(d.add),margin:cn(d.margin)},createdAt:cn(r.createdAt)||Date.now()}},
  items:r=>{if(!r||!okId(r.id)||!okId(r.tripId))return null;
    return{id:r.id,tripId:r.tripId,name:cs(r.name,200),store:cs(r.store,100),note:cs(r.note,2000),cost:(r.cost===''||r.cost==null)?'':cn(r.cost),
      qty:ci(r.qty,1,99999),mode:MODE_LABEL[r.mode]?r.mode:'mult',val:cn(r.val),price:cn(r.price),manual:!!r.manual,bought:!!r.bought,
      photo:cleanImg(r.photo),thumb:cleanImg(r.thumb),
      variants:(Array.isArray(r.variants)?r.variants:[]).slice(0,60).map(v=>({n:cs(v&&v.n,60),q:ci(v&&v.q,0,99999),c:cn(v&&v.c)>0?cn(v.c):'',p:cn(v&&v.p)>0?cn(v.p):''})).filter(v=>v.n),
      photos:(Array.isArray(r.photos)?r.photos:[]).slice(0,6).map(x=>({p:cleanImg(x&&x.p),t:cleanImg(x&&x.t)})).filter(x=>x.p),
      createdAt:cn(r.createdAt)||Date.now()}},
  customers:r=>{if(!r||!okId(r.id))return null;return{id:r.id,name:cs(r.name,100),contact:cs(r.contact,200),note:cs(r.note,1000),rate:r.rate==null?DEF_FEE:cleanRate(r.rate),createdAt:cn(r.createdAt)||Date.now()}},
  orders:r=>{if(!r||!okId(r.id)||!okId(r.tripId)||!okId(r.customerId))return null;
    return{id:r.id,tripId:r.tripId,customerId:r.customerId,
      lines:(Array.isArray(r.lines)?r.lines:[]).slice(0,300).map(l=>({itemId:okId(l&&l.itemId)?l.itemId:'',name:cs(l&&l.name,200),variant:cs(l&&l.variant,60),
        qty:ci(l&&l.qty,1,99999),price:cn(l&&l.price),costTwd:cn(l&&l.costTwd)})),
      rate:r.rate==null?null:cleanRate(r.rate),paid:cn(r.paid),shipped:!!r.shipped,note:cs(r.note,500),createdAt:cn(r.createdAt)||Date.now()}}
};
async function importBackup(file){
  try{
    if(file.size>100e6)throw 0;
    const d=JSON.parse(await file.text());if(!d||d.app!=='daigou')throw 0;
    let n=0,skip=0;
    for(const st of ['trips','items','customers','orders'])for(const r of (Array.isArray(d[st])?d[st]:[])){const c=CLEAN[st](r);if(c){await save(st,c);n++}else skip++}
    if(d.rates&&typeof d.rates==='object'){const rates={...S.meta.rates};for(const k of Object.keys(CUR)){const v=Number(d.rates[k]);if(v>0&&isFinite(v))rates[k]=v}await setMeta('rates',rates)}
    if(typeof d.payInfo==='string'&&d.payInfo)await setMeta('payInfo',d.payInfo.slice(0,500));
    if(!curTrip()&&S.trips[0])await setMeta('tripId',S.trips[0].id);
    render();toast(`已匯入 ${n} 筆資料`+(skip?`，略過 ${skip} 筆格式不符的資料`:''));
  }catch(e){toast('這不是有效的備份檔')}
}

/* ========== 事件 ========== */
const ACT={
  close:closeSheet,
  tab:(id,el)=>{ui.tab=el.dataset.tab;render();scrollTo(0,0)},
  itemFilter:id=>{ui.itemFilter=id;render()},
  orderFilter:id=>{ui.orderFilter=id;render()},
  newItem:()=>itemSheet(),editItem:id=>itemSheet(id),
  toggleBought:async id=>{const i=S.items.find(x=>x.id===id);i.bought=!i.bought;await save('items',i);render()},
  newOrder:()=>orderSheet(),editOrder:id=>orderSheet(id),
  toggleShip:async id=>{const o=S.orders.find(x=>x.id===id);o.shipped=!o.shipped;await save('orders',o);render()},
  togglePay:async id=>{const o=S.orders.find(x=>x.id===id),tot=orderTotal(o);o.paid=o.paid>=tot?0:tot;await save('orders',o);render()},
  newCustomer:()=>customerSheet(),editCustomer:id=>customerSheet(id),
  newTrip:()=>tripSheet(),editTrip:id=>tripSheet(id),
  pickTrip:async id=>{await setMeta('tripId',id);ui.tab='items';render()},
  converter:converterSheet,
  updateRates:async(id,el)=>{el.disabled=true;el.textContent='更新中…';const ok=await updateRates();render();toast(ok?'匯率已更新':'無法連線，請稍後再試')},
  orderImg:id=>orderImageSheet(id),
  exportBackup,importBackup:()=>$('#importFile').click()
};
document.addEventListener('click',e=>{const el=e.target.closest('[data-act]');if(!el)return;const fn=ACT[el.dataset.act];if(fn){e.stopPropagation();fn(el.dataset.id,el,e)}});
document.addEventListener('input',e=>{
  if(e.target.id==='itemQ'){ui.q=e.target.value;const l=$('#itemList'),t=curTrip();if(l&&t)l.innerHTML=itemListHTML(t)}
});
document.addEventListener('change',async e=>{
  if(e.target.id==='tripSel'){await setMeta('tripId',e.target.value);render()}
  else if(e.target.id==='itemSort'){ui.sort=e.target.value;render()}
  else if(e.target.dataset.rate){const v=num(e.target.value);if(v>0){const r={...S.meta.rates,[e.target.dataset.rate]:v};await setMeta('rates',r)}render()}
  else if(e.target.id==='payInfo'){await setMeta('payInfo',e.target.value.trim().slice(0,500))}
  else if(e.target.id==='importFile'){const f=e.target.files[0];e.target.value='';if(f)importBackup(f)}
});

/* ========== 啟動 ========== */
(async()=>{
  await loadAll();
  if(!S.meta.tripId&&S.trips[0])await setMeta('tripId',S.trips[0].id);
  if(!S.trips.length)ui.tab='trips';
  render();
  if(!S.trips.length)setTimeout(()=>{if(!$('#sheetWrap.open'))tripSheet()},250);
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{swOK=true;const e=$('#swState');if(e)e.textContent=swText()}).catch(()=>{swOK=false;const e=$('#swState');if(e)e.textContent=swText()});
  }else{swOK=false}
  if(navigator.onLine&&(!S.meta.ratesAt||Date.now()-S.meta.ratesAt>12*36e5)){if(await updateRates()&&!$('#sheetWrap.open'))render()}
})();
