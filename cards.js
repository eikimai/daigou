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
  let w=w1+g.measureText(s).width;
  if(o.suffix){g.font=`${o.ws} ${o.small}px ${CARD_FONT}`;if(!dry)g.fillText(o.suffix,x+w+10,base);w+=10+g.measureText(o.suffix).width}
  g.restore();return w;
}
function coverDraw(g,im,x,y,w,h){
  const k=Math.max(w/im.width,h/im.height),dw=im.width*k,dh=im.height*k;
  g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.drawImage(im,x+(w-dw)/2,y+(h-dh)/2,dw,dh);g.restore();
}
async function drawPhoto(g,it,o,x,y,w,h,r){
  g.save();
  if(r)rr(g,x,y,w,h,r);else{g.beginPath();g.rect(x,y,w,h)}
  g.clip();
  const list=photosOf(it);
  if(o.collage&&list.length>1){
    const ims=await Promise.all(list.slice(0,4).map(p=>loadImg(p.p))),gap=6,n=ims.length;
    g.fillStyle='#fff';g.fillRect(x,y,w,h);
    if(n===2){const cw=(w-gap)/2;coverDraw(g,ims[0],x,y,cw,h);coverDraw(g,ims[1],x+cw+gap,y,cw,h)}
    else if(n===3){const lw=Math.round(w*.6),rw=w-lw-gap,rh=(h-gap)/2;coverDraw(g,ims[0],x,y,lw,h);coverDraw(g,ims[1],x+lw+gap,y,rw,rh);coverDraw(g,ims[2],x+lw+gap,y+rh+gap,rw,rh)}
    else{const cw=(w-gap)/2,ch=(h-gap)/2;ims.forEach((im,i)=>coverDraw(g,im,x+(i%2)*(cw+gap),y+Math.floor(i/2)*(ch+gap),cw,ch))}
  }else{
    const cur=list[o.pi||0]||list[0];
    if(cur){
      const im=await loadImg(cur.p);
      if(o.fit==='contain'){
        g.fillStyle='#f2f2f2';g.fillRect(x,y,w,h);
        const k=Math.min(w/im.width,h/im.height);g.drawImage(im,x+(w-im.width*k)/2,y+(h-im.height*k)/2,im.width*k,im.height*k);
      }else coverDraw(g,im,x,y,w,h);
    }else{
      const gr=g.createLinearGradient(x,y,x+w,y+h);gr.addColorStop(0,'#e9eef2');gr.addColorStop(1,'#d3dde5');g.fillStyle=gr;g.fillRect(x,y,w,h);
    }
  }
  g.restore();
}
/* 圖上要顯示的規格：已買的商品只列還有剩的 */
function cardVariants(it){
  return (it.variants||[]).filter(v=>!it.bought||v.q-soldQty(it.id,v.n)>0).map(v=>v.n);
}
/* 售價：規格價格不同時顯示最低價加「起」，並列出價格表 */
function cardPricing(it,o){
  const t=tripOf(it.tripId);
  const vs=(it.variants||[]).filter(v=>!it.bought||v.q-soldQty(it.id,v.n)>0);
  if(!t)return{price:it.price||0,from:false,rows:null};
  const R=o.rate==null?DEF_FEE:o.rate;
  if(!vs.length)return{price:feePrice(it,null,t,R),from:false,rows:null};
  const rows=vs.map(v=>{const p=feePrice(it,v,t,R),u=o.unit?unitPrice(v.n,p):null;return{n:v.n,p,u:u?`NT$ ${fmtUnit(u.per)}/${u.unit}`:''}});
  const ps=rows.map(r=>r.p).filter(p=>p>0);
  if(!ps.length)return{price:feePrice(it,null,t,R),from:false,rows:null};
  const distinct=new Set(ps).size>1;
  return{price:Math.min(...ps),from:distinct,rows:distinct?rows:null};
}
const hasUnit=it=>(it.variants||[]).some(v=>parseSize(v.n));
/* 價格表：左邊規格名稱，右邊售價，中間灰色小字是每單位價格 */
function drawTable(g,rows,x,y,w,st){
  rows.slice(0,6).forEach(r=>{
    g.textBaseline='top';
    g.font=st.pf;const ptxt='NT$ '+fmt(r.p),pw=g.measureText(ptxt).width;
    g.textAlign='right';g.fillStyle=st.pc;g.fillText(ptxt,x+w,y);
    let right=x+w-pw-24;
    if(r.u){g.font=st.uf;g.fillStyle=st.uc;g.fillText(r.u,right,y+st.uo);right-=g.measureText(r.u).width+24}
    g.textAlign='left';g.font=st.nf;g.fillStyle=st.nc;
    let nm=r.n;while(nm.length>1&&g.measureText(nm).width>right-x)nm=nm.slice(0,-1);
    g.fillText(nm===r.n?nm:nm.slice(0,-1)+'…',x,y);
    y+=st.h;
    if(st.line){g.fillStyle=st.line;g.fillRect(x,y-9,w,2)}
  });
  g.textAlign='left';return y;
}

/* ---------- 商品圖：雜誌風 ---------- */
async function cardMag(it,o){
  const W=1080,H=1350,PAD=72,F=CARD_FONT,c=newCanvas(W,H),g=c.getContext('2d');
  const pr=cardPricing(it,o),tbl=o.variants&&pr.rows?pr.rows.slice(0,6):null;
  g.font=`800 64px ${F}`;const nameL=capLines(wrapText(g,it.name||'',W-PAD*2),2);
  const vars=o.variants&&!tbl?cardVariants(it):[];
  g.font=`600 32px ${F}`;const varL=vars.length?capLines(wrapText(g,'規格　'+vars.join(' / '),W-PAD*2),2):[];
  g.font=`400 34px ${F}`;const noteL=o.note&&it.note?capLines(wrapText(g,it.note,W-PAD*2),tbl?2:5):[];
  const badge=o.store&&it.store,tblH=tbl?tbl.length*56:0,nTxt=varL.length+noteL.length;
  const block=48+(badge?46:0)+36+nameL.length*80+16+28+136+((tbl||nTxt)?22:0)+tblH+nTxt*50+44;
  const PH=Math.max(440,Math.min(840,H-block));
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
  drawPrice(g,PAD,y,pr.price,{small:40,big:124,ws:500,wb:300,color:'#111',gap:14,suffix:pr.from?'起':''});y+=136;
  if(tbl||nTxt)y+=22;
  if(tbl)y=drawTable(g,tbl,PAD,y,W-PAD*2,{nf:`600 32px ${F}`,nc:'#111',pf:`700 32px ${F}`,pc:'#111',uf:`400 26px ${F}`,uc:'#868d93',uo:4,h:56,line:'#e3e6e8'});
  g.textBaseline='top';
  g.font=`600 32px ${F}`;g.fillStyle='#111';varL.forEach(l=>{g.fillText(l,PAD,y);y+=50});
  g.font=`400 34px ${F}`;g.fillStyle='#50565c';noteL.forEach(l=>{g.fillText(l,PAD,y);y+=50});
  return c;
}



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
  const o={rate:DEF_FEE,store:true,note:true,variants:true,unit:true,fit:'cover',collage:false,pi:0};
  const photos=photosOf(it),chip=(k,l,on)=>`<button class="chip ${on?'on':''}" data-o="${k}">${l}</button>`;
  openSheet(shHead('匯出圖片')+`
    <div class="f" style="margin-bottom:8px"><span>代購費率（售價 = 成本 ×（1＋費率））</span><div class="chips" id="rateChips" style="align-items:center">${[5,8,10,12,15].map(r=>`<button type="button" class="chip${r===o.rate?' on':''}" data-r="${r}">+${r}%</button>`).join('')}<input class="inp" id="xRate" inputmode="decimal" aria-label="自訂費率 %" style="width:78px;flex:none" value="${o.rate}"><span class="sub">%</span></div></div>
    <div class="expwrap"><img id="expImg" alt="商品圖片預覽"></div>
    ${photos.length>1?`<div class="ph-strip" id="expPh">${photos.map((x,n)=>`<div class="ph-th${n===0?' main':''}" data-n="${n}" style="background-image:url('${x.t}')"></div>`).join('')}</div>`:''}
    <div class="chips" id="optChips" style="margin-bottom:10px">${chip('store','顯示店名',1)}${chip('note','顯示細節',1)}${(it.variants||[]).length?chip('variants','顯示規格',1):''}${hasUnit(it)?chip('unit','顯示單價換算',1):''}${photos.length?chip('fit','照片完整顯示',0):''}${photos.length>1?chip('collage','拼貼多張照片',0):''}</div>
    <p class="hint">費率只用來算售價，不會印在圖上；手動固定的售價不受影響。${photos.length>1?'點縮圖選擇主圖。':''}沒有跳出分享選單時，長按上面的圖片也能存到相簿。</p>
    <div class="actions"><button class="btn" id="eDl">下載</button><button class="btn primary" id="eSh">分享 / 存到相簿</button></div>`);
  const redraw=mountImg(()=>cardMag(it,o),()=>safeName(it.name)+'.jpg');
  await redraw();
  const setR=async(r,typed)=>{o.rate=r;if(!typed)$('#xRate').value=r;[...document.querySelectorAll('#rateChips [data-r]')].forEach(b=>b.classList.toggle('on',+b.dataset.r===r));await redraw()};
  $('#rateChips').onclick=e=>{const b=e.target.closest('[data-r]');if(b)setR(+b.dataset.r)};
  $('#xRate').oninput=e=>{const s=e.target.value.trim();if(s===''||isNaN(Number(s)))return;setR(cleanRate(s),true)};
  if($('#expPh'))$('#expPh').onclick=async e=>{const th=e.target.closest('.ph-th');if(!th)return;o.pi=+th.dataset.n;o.collage=false;
    [...$('#expPh').children].forEach(x=>x.classList.toggle('main',x===th));const cb=$('#optChips [data-o=collage]');if(cb)cb.classList.remove('on');await redraw()};
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
