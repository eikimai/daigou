'use strict';
/* 匯出圖片：全部在手機本機用 canvas 繪製，不需要網路 */
const CARD_FONT='"PingFang TC","Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",-apple-system,sans-serif';
const RED='#e0334a';

function newCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function rr(g,x,y,w,h,r){
  g.beginPath();
  if(g.roundRect){g.roundRect(x,y,w,h,r);return}
  g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();
}
/* 自動換行：英文字不會從中間斷開，中文逐字斷 */
function wrapText(g,text,maxW){
  const lines=[];
  for(const para of String(text).split('\n')){
    const toks=[];
    for(const tk of (para.match(/[\x21-\x7e]+|\s+|[\s\S]/gu)||[''])){
      // 超過一行寬的長字串（例如網址）改成逐字斷行，避免超出畫面
      if(tk.length>1&&!/^\s+$/.test(tk)&&g.measureText(tk).width>maxW)toks.push(...tk);else toks.push(tk);
    }
    let line='';
    for(const tk of toks){
      const isSp=/^\s+$/.test(tk);
      if(isSp&&!line)continue;
      const tryL=line+tk;
      if(g.measureText(tryL).width>maxW&&line){lines.push(line.trimEnd());line=isSp?'':tk}else line=tryL;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function capLines(lines,max){
  if(lines.length<=max)return lines;
  const r=lines.slice(0,max);r[max-1]=r[max-1].slice(0,-1)+'…';return r;
}
function drawPrice(g,x,top,n,o,dry){
  g.save();g.textBaseline='alphabetic';g.fillStyle=o.color;
  const base=top+Math.round(o.big*.88);
  g.font=`${o.ws} ${o.small}px ${CARD_FONT}`;
  if(!dry)g.fillText('NT$',x,base);
  const w1=g.measureText('NT$').width+o.gap;
  g.font=`${o.wb} ${o.big}px ${CARD_FONT}`;const s=fmt(Math.round(n||0));
  if(!dry)g.fillText(s,x+w1,base);
  const w=w1+g.measureText(s).width;g.restore();return w;
}
async function drawPhoto(g,it,o,x,y,w,h,r){
  g.save();
  if(r)rr(g,x,y,w,h,r);else{g.beginPath();g.rect(x,y,w,h)}
  g.clip();
  if(it.photo){
    const im=await loadImg(it.photo);
    if(o.fit==='contain'){
      g.fillStyle='#f2f2f2';g.fillRect(x,y,w,h);
      const k=Math.min(w/im.width,h/im.height);g.drawImage(im,x+(w-im.width*k)/2,y+(h-im.height*k)/2,im.width*k,im.height*k);
    }else{
      const k=Math.max(w/im.width,h/im.height),dw=im.width*k,dh=im.height*k;g.drawImage(im,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
    }
  }else{
    const gr=g.createLinearGradient(x,y,x+w,y+h);gr.addColorStop(0,'#e9eef2');gr.addColorStop(1,'#d3dde5');g.fillStyle=gr;g.fillRect(x,y,w,h);
  }
  g.restore();
}
/* 圖上要顯示的規格：已買的商品只列還有剩的 */
function cardVariants(it){
  return (it.variants||[]).filter(v=>!it.bought||v.q-soldQty(it.id,v.n)>0).map(v=>v.n);
}
function layoutChips(g,list,maxW,font,padX,gap,maxRows){
  g.font=font;const rows=[[]];let x=0;
  for(const t of list){
    const w=g.measureText(t).width+padX*2;
    if(x+w>maxW&&rows[rows.length-1].length){if(rows.length>=maxRows)break;rows.push([]);x=0}
    rows[rows.length-1].push({t,w,x});x+=w+gap;
  }
  return rows;
}

/* ---------- 樣式一：簡約 ---------- */
async function cardClean(it,o){
  const W=1080,H=1350,PAD=60,F=CARD_FONT,c=newCanvas(W,H),g=c.getContext('2d');
  g.font=`700 60px ${F}`;const nameL=capLines(wrapText(g,it.name||'',W-PAD*2),2);
  const vars=o.variants?cardVariants(it):[];
  g.font=`700 36px ${F}`;const varL=vars.length?capLines(wrapText(g,'規格　'+vars.join('／'),W-PAD*2),2):[];
  g.font=`400 36px ${F}`;const noteL=o.note&&it.note?capLines(wrapText(g,it.note,W-PAD*2),6):[];
  const badge=o.store&&it.store,nTxt=varL.length+noteL.length;
  const block=44+(badge?84:0)+nameL.length*76+138+(nTxt?18+nTxt*52:0)+40;
  const PH=Math.max(520,Math.min(820,H-block));
  g.fillStyle='#fff';g.fillRect(0,0,W,H);
  await drawPhoto(g,it,o,0,0,W,PH,0);
  g.textBaseline='top';g.textAlign='left';
  let y=PH+44;
  if(badge){
    g.font=`600 34px ${F}`;const w=g.measureText(it.store).width+52;
    g.fillStyle='#eef1f4';rr(g,PAD,y,w,58,29);g.fill();
    g.fillStyle='#33404a';g.fillText(it.store,PAD+26,y+10);y+=84;
  }
  g.fillStyle='#1a1d20';g.font=`700 60px ${F}`;
  nameL.forEach(l=>{g.fillText(l,PAD,y);y+=76});
  drawPrice(g,PAD,y+2,it.price,{small:50,big:116,ws:700,wb:800,color:RED,gap:12});y+=138;
  if(nTxt)y+=18;
  g.font=`700 36px ${F}`;g.fillStyle='#33404a';varL.forEach(l=>{g.fillText(l,PAD,y);y+=52});
  g.font=`400 36px ${F}`;g.fillStyle='#5b6670';noteL.forEach(l=>{g.fillText(l,PAD,y);y+=52});
  return c;
}

/* ---------- 樣式二：雜誌 ---------- */
async function cardMag(it,o){
  const W=1080,H=1350,PAD=72,F=CARD_FONT,c=newCanvas(W,H),g=c.getContext('2d');
  g.font=`800 64px ${F}`;const nameL=capLines(wrapText(g,it.name||'',W-PAD*2),2);
  const vars=o.variants?cardVariants(it):[];
  g.font=`600 32px ${F}`;const varL=vars.length?capLines(wrapText(g,'規格　'+vars.join(' / '),W-PAD*2),2):[];
  g.font=`400 34px ${F}`;const noteL=o.note&&it.note?capLines(wrapText(g,it.note,W-PAD*2),5):[];
  const badge=o.store&&it.store,nTxt=varL.length+noteL.length;
  const block=48+(badge?46:0)+36+nameL.length*80+16+28+136+(nTxt?26+nTxt*50:0)+44;
  const PH=Math.max(500,Math.min(840,H-block));
  g.fillStyle='#fff';g.fillRect(0,0,W,H);
  await drawPhoto(g,it,o,0,0,W,PH,0);
  g.textBaseline='top';g.textAlign='left';
  let y=PH+48;
  if(badge){
    g.font=`600 26px ${F}`;g.fillStyle='#868d93';let x=PAD;
    for(const ch of it.store.toUpperCase()){g.fillText(ch,x,y);x+=g.measureText(ch).width+5}
    y+=46;
  }
  g.fillStyle=RED;g.fillRect(PAD,y,64,8);y+=28;
  g.fillStyle='#111';g.font=`800 64px ${F}`;
  nameL.forEach(l=>{g.fillText(l,PAD,y);y+=80});
  y+=16;g.fillStyle='#e3e6e8';g.fillRect(PAD,y,W-PAD*2,2);y+=26;
  drawPrice(g,PAD,y,it.price,{small:40,big:124,ws:500,wb:300,color:'#111',gap:14});y+=136;
  if(nTxt)y+=26;
  g.font=`600 32px ${F}`;g.fillStyle='#111';varL.forEach(l=>{g.fillText(l,PAD,y);y+=50});
  g.font=`400 34px ${F}`;g.fillStyle='#50565c';noteL.forEach(l=>{g.fillText(l,PAD,y);y+=50});
  return c;
}

/* ---------- 樣式三：柔色卡片 ---------- */
async function cardSoft(it,o){
  const W=1080,H=1350,PAD=56,F=CARD_FONT,c=newCanvas(W,H),g=c.getContext('2d');
  const tints=['#e8f0f6','#f4e9ef','#e7f2ea','#f2eee6'];
  const tint=tints[[...(it.name||'')].reduce((a,ch)=>a+ch.charCodeAt(0),0)%tints.length];
  const maxW=W-PAD*2;
  g.font=`700 58px ${F}`;const nameL=capLines(wrapText(g,it.name||'',maxW),2);
  const vars=o.variants?cardVariants(it):[];
  const chipRows=vars.length?layoutChips(g,vars,maxW,`500 30px ${F}`,22,12,3):[];
  g.font=`400 34px ${F}`;const noteL=o.note&&it.note?capLines(wrapText(g,it.note,maxW),4):[];
  const badge=o.store&&it.store;
  const bottom=36+104+24+nameL.length*72+(chipRows.length?14+chipRows.length*64:0)+(noteL.length?16+noteL.length*50:0)+4;
  const PH=Math.max(440,Math.min(780,H-PAD*2-bottom));
  g.fillStyle=tint;g.fillRect(0,0,W,H);
  await drawPhoto(g,it,o,PAD,PAD,maxW,PH,48);
  g.textBaseline='top';g.textAlign='left';
  let y=PAD+PH+36;
  const pw=drawPrice(g,0,0,it.price,{small:34,big:62,ws:700,wb:800,color:'#fff',gap:10},true)+64;
  g.fillStyle=RED;rr(g,PAD,y,pw,104,52);g.fill();
  drawPrice(g,PAD+32,y+22,it.price,{small:34,big:62,ws:700,wb:800,color:'#fff',gap:10});
  if(badge){
    g.font=`600 32px ${F}`;const sw=Math.min(g.measureText(it.store).width+48,W-PAD*2-pw-16);
    g.fillStyle='#fff';rr(g,PAD+pw+16,y+24,sw,56,28);g.fill();
    g.fillStyle='#33404a';g.save();rr(g,PAD+pw+16,y+24,sw,56,28);g.clip();g.fillText(it.store,PAD+pw+16+24,y+34);g.restore();
  }
  y+=104+24;
  g.fillStyle='#1c2329';g.font=`700 58px ${F}`;nameL.forEach(l=>{g.fillText(l,PAD,y);y+=72});
  if(chipRows.length){
    y+=14;
    for(const row of chipRows){
      for(const ch of row){
        g.fillStyle='#fff';rr(g,PAD+ch.x,y,ch.w,52,26);g.fill();
        g.fillStyle='#2b3640';g.font=`500 30px ${F}`;g.fillText(ch.t,PAD+ch.x+22,y+10);
      }
      y+=64;
    }
  }
  if(noteL.length){y+=16;g.font=`400 34px ${F}`;g.fillStyle='#55606a';noteL.forEach(l=>{g.fillText(l,PAD,y);y+=50})}
  return c;
}
const CARD_STYLES={clean:cardClean,mag:cardMag,soft:cardSoft};

/* ---------- 訂單明細圖 ---------- */
const lineLabel=l=>l.name+(l.variant?`（${l.variant}）`:'');
function orderText(od,withPay){
  const tot=orderTotal(od),paid=Math.min(od.paid||0,tot),due=tot-paid;
  let t=`【訂單明細】${custName(od.customerId)}\n`;
  od.lines.forEach(l=>{t+=`${lineLabel(l)} × ${l.qty}　NT$ ${fmt(l.qty*l.price)}\n`});
  t+=`合計 NT$ ${fmt(tot)}\n已收款 NT$ ${fmt(paid)}`+(due>0?`\n待收款 NT$ ${fmt(due)}`:'（已付清）');
  if(withPay&&due>0&&S.meta.payInfo)t+=`\n\n匯款資訊\n${S.meta.payInfo}`;
  if(od.note)t+=`\n備註：${od.note}`;
  return t;
}
async function drawOrderImage(od,o){
  const W=1080,PAD=60,F=CARD_FONT;
  const tot=orderTotal(od),paid=Math.min(od.paid||0,tot),due=tot-paid;
  const sg=newCanvas(10,10).getContext('2d');
  const nameW=W-PAD*2-130-24-250;
  sg.font=`600 36px ${F}`;
  const rows=od.lines.map(l=>({l,itm:S.items.find(i=>i.id===l.itemId),lines:capLines(wrapText(sg,lineLabel(l),nameW),2)}));
  rows.forEach(r=>{r.h=Math.max(130,r.lines.length*48+8)+36});
  sg.font=`400 32px ${F}`;
  const payL=o.pay&&due>0&&S.meta.payInfo?wrapText(sg,S.meta.payInfo,W-PAD*2):[];
  const noteL=od.note?wrapText(sg,'備註　'+od.note,W-PAD*2):[];
  const H=PAD+132+60+rows.reduce((s,r)=>s+r.h,0)+30+(due>0?270:210)+(payL.length?60+payL.length*46:0)+(noteL.length?24+noteL.length*46:0)+PAD;
  const c=newCanvas(W,H),g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,W,H);g.textBaseline='top';
  let y=PAD;
  g.fillStyle='#111';g.font=`800 58px ${F}`;g.textAlign='left';g.fillText('訂單明細',PAD,y);
  g.textAlign='right';g.font=`400 30px ${F}`;g.fillStyle='#7a838a';g.fillText(new Date(od.createdAt).toLocaleDateString('zh-TW'),W-PAD,y+22);
  g.textAlign='left';g.font=`500 38px ${F}`;g.fillStyle='#33404a';g.fillText('顧客　'+custName(od.customerId),PAD,y+78);
  y+=132;g.fillStyle='#111';g.fillRect(PAD,y,W-PAD*2,3);y+=24;
  for(const r of rows){
    const ty=y+6;
    g.fillStyle='#eef1f4';rr(g,PAD,ty,130,130,16);g.fill();
    const src=r.itm&&(r.itm.thumb||r.itm.photo);
    if(src){try{const im=await loadImg(src);g.save();rr(g,PAD,ty,130,130,16);g.clip();
      const k=Math.max(130/im.width,130/im.height);g.drawImage(im,PAD+(130-im.width*k)/2,ty+(130-im.height*k)/2,im.width*k,im.height*k);g.restore()}catch(e){}}
    g.textAlign='left';g.fillStyle='#1a1d20';g.font=`600 36px ${F}`;
    r.lines.forEach((t,i)=>g.fillText(t,PAD+154,ty+i*48));
    g.textAlign='right';g.fillStyle='#7a838a';g.font=`400 30px ${F}`;g.fillText(`NT$ ${fmt(r.l.price)} × ${r.l.qty}`,W-PAD,ty);
    g.fillStyle='#111';g.font=`800 40px ${F}`;g.fillText(`NT$ ${fmt(r.l.qty*r.l.price)}`,W-PAD,ty+46);
    y+=r.h;g.fillStyle='#e3e6e8';g.fillRect(PAD,y-14,W-PAD*2,2);
  }
  y+=30;
  g.textAlign='left';g.fillStyle='#33404a';g.font=`600 40px ${F}`;g.fillText('合計',PAD,y+22);
  g.textAlign='right';g.fillStyle=RED;g.font=`800 76px ${F}`;g.fillText('NT$ '+fmt(tot),W-PAD,y);y+=104;
  g.font=`400 34px ${F}`;g.textAlign='left';g.fillStyle='#5b6670';g.fillText('已收款',PAD,y);
  g.textAlign='right';g.fillStyle='#1b7f45';g.font=`600 34px ${F}`;g.fillText('NT$ '+fmt(paid),W-PAD,y);y+=52;
  if(due>0){
    g.textAlign='left';g.fillStyle='#5b6670';g.font=`400 34px ${F}`;g.fillText('待收款',PAD,y);
    g.textAlign='right';g.fillStyle=RED;g.font=`700 34px ${F}`;g.fillText('NT$ '+fmt(due),W-PAD,y);y+=52;
  }
  y+=14;g.textAlign='left';
  const [pk,pl]=payState(od);
  const pills=[[pl,pk==='paid'?'#dff2e6':pk==='part'?'#fcefd3':'#fbe3df',pk==='paid'?'#1b7f45':pk==='part'?'#a65f00':'#b83225'],[od.shipped?'已出貨':'未出貨',od.shipped?'#dff2e6':'#e8ecee',od.shipped?'#1b7f45':'#5b6670']];
  let px=PAD;g.font=`600 30px ${F}`;
  for(const [t,bg,fg] of pills){const w=g.measureText(t).width+44;g.fillStyle=bg;rr(g,px,y,w,50,25);g.fill();g.fillStyle=fg;g.fillText(t,px+22,y+9);px+=w+12}
  y+=50;
  if(payL.length){
    y+=34;g.fillStyle='#7a838a';g.font=`600 28px ${F}`;g.fillText('匯款資訊',PAD,y);y+=34;
    g.fillStyle='#33404a';g.font=`400 32px ${F}`;payL.forEach(l=>{g.fillText(l,PAD,y);y+=46});
  }
  if(noteL.length){y+=24;g.fillStyle='#7a838a';g.font=`400 32px ${F}`;noteL.forEach(l=>{g.fillText(l,PAD,y);y+=46})}
  return c;
}

/* ---------- 分享、下載、預覽 ---------- */
const safeName=s=>(s||'商品').replace(/[\\/:*?"<>|]/g,'_').slice(0,40);
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);
}
async function shareBlob(blob,name){
  try{
    const f=new File([blob],name,{type:blob.type});
    if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f]});return}
  }catch(e){if(e&&e.name==='AbortError')return}
  download(blob,name);
}
function mountImg(draw,filename){
  let blob=null,url='';
  setCleanup(()=>{if(url)URL.revokeObjectURL(url)});
  $('#eSh').onclick=()=>blob&&shareBlob(blob,filename());
  $('#eDl').onclick=()=>blob&&download(blob,filename());
  return async()=>{
    const c=await draw();
    blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.92));
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);$('#expImg').src=url;
  };
}
async function exportSheet(id){
  const it=S.items.find(x=>x.id===id);if(!it)return;
  const o={style:CARD_STYLES[S.meta.exportStyle]?S.meta.exportStyle:'clean',store:true,note:true,variants:true,fit:'cover'};
  const chip=(k,l,on)=>`<button class="chip ${on?'on':''}" data-o="${k}">${l}</button>`;
  openSheet(shHead('匯出圖片')+`
    <div class="seg" id="stySeg">${[['clean','簡約'],['mag','雜誌'],['soft','柔色卡片']].map(([k,l])=>`<button type="button" data-s="${k}" class="${o.style===k?'on':''}">${l}</button>`).join('')}</div>
    <div class="expwrap"><img id="expImg" alt="商品圖片預覽"></div>
    <div class="chips" id="optChips" style="margin-bottom:10px">${chip('store','顯示店名',1)}${chip('note','顯示細節',1)}${(it.variants||[]).length?chip('variants','顯示規格',1):''}${it.photo?chip('fit','照片完整顯示',0):''}</div>
    <p class="hint">沒有跳出分享選單時，長按上面的圖片也能存到相簿。</p>
    <div class="actions"><button class="btn" id="eDl">下載</button><button class="btn primary" id="eSh">分享 / 存到相簿</button></div>`);
  const redraw=mountImg(()=>CARD_STYLES[o.style](it,o),()=>safeName(it.name)+'.jpg');
  await redraw();
  $('#stySeg').onclick=async e=>{const b=e.target.closest('[data-s]');if(!b)return;o.style=b.dataset.s;setMeta('exportStyle',o.style);
    [...$('#stySeg').children].forEach(x=>x.classList.toggle('on',x===b));await redraw()};
  $('#optChips').onclick=async e=>{const b=e.target.closest('[data-o]');if(!b)return;const k=b.dataset.o;
    if(k==='fit')o.fit=o.fit==='cover'?'contain':'cover';else o[k]=!o[k];
    b.classList.toggle('on',k==='fit'?o.fit==='contain':o[k]);await redraw()};
}
async function orderImageSheet(id){
  const od=S.orders.find(x=>x.id===id);if(!od)return;
  const hasPay=!!S.meta.payInfo,o={pay:hasPay};
  openSheet(shHead('訂單明細')+`
    <div class="expwrap"><img id="expImg" alt="訂單明細預覽"></div>
    <div class="chips" id="optChips" style="margin-bottom:10px">${hasPay?'<button class="chip on" data-o="pay">顯示匯款資訊</button>':''}<button class="chip" id="eCopy">複製文字</button></div>
    <p class="hint">${hasPay?'':'到「匯率」分頁最下方填入匯款資訊，之後會自動印在待收款的明細上。'}「複製文字」可以直接貼到 LINE。</p>
    <div class="actions"><button class="btn" id="eDl">下載</button><button class="btn primary" id="eSh">分享 / 存到相簿</button></div>`);
  const redraw=mountImg(()=>drawOrderImage(od,o),()=>'訂單-'+safeName(custName(od.customerId))+'.jpg');
  await redraw();
  $('#optChips').onclick=async e=>{
    if(e.target.id==='eCopy'){
      try{await navigator.clipboard.writeText(orderText(od,o.pay));toast('已複製，可以貼到 LINE')}catch(err){toast('無法複製，請改用圖片')}
      return;
    }
    const b=e.target.closest('[data-o]');if(!b)return;o.pay=!o.pay;b.classList.toggle('on',o.pay);await redraw();
  };
}
