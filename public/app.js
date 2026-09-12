(() => {
  const state = {
    entries: [],
    cursor: new Date(),
    selectedDate: todayKey(),
    selectedPeriod: 'morning'
  };

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const shortMonths = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  function todayKey(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function key(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }
  function monthKey(dateString){ return dateString.slice(0,7); }
  function currentMonthKey(){ return `${state.cursor.getFullYear()}-${pad(state.cursor.getMonth()+1)}`; }
  function entryKey(date, period){ return `${date}|${period}`; }
  function getEntry(date, period){ return state.entries.find(e => e.date === date && e.period === period); }
  function pctDelta(a,b){ if(a===0&&b===0) return 0; if(a===0) return null; return ((b-a)/a)*100; }
  function avgWeekly(value, y, m){ return value / (new Date(y,m+1,0).getDate()/7); }

  async function api(url, options){
    const res = await fetch(url, {headers:{'Content-Type':'application/json'}, ...options});
    if(!res.ok){ const body=await res.json().catch(()=>({})); throw new Error(body.error || 'Erro ao salvar'); }
    return res.json();
  }

  function setStatus(text, busy=false){ $('saveStatus').textContent=text; $('saveStatus').style.opacity=busy?'.7':'1'; }

  async function load(){
    try{
      setStatus('Carregando…', true);
      state.entries = await api('/api/entries');
      setStatus('Sincronizado');
      renderAll();
    }catch(e){ setStatus('Falha ao sincronizar'); $('feedback').textContent=e.message; }
  }

  function renderAll(){ renderCalendar(); renderForm(); renderMetrics(); renderMonthOptions(); renderComparison(); renderTrend(); }

  function renderCalendar(){
    const y=state.cursor.getFullYear(), m=state.cursor.getMonth();
    $('monthLabel').textContent=`${monthNames[m]} ${y}`;
    const grid=$('calendar'); grid.innerHTML='';
    const first=new Date(y,m,1).getDay();
    for(let i=0;i<first;i++){ const b=document.createElement('div'); b.className='day muted'; grid.appendChild(b); }
    const days=new Date(y,m+1,0).getDate();
    for(let d=1;d<=days;d++){
      const date=key(y,m,d); const morning=getEntry(date,'morning'); const night=getEntry(date,'night');
      const btn=document.createElement('button'); btn.type='button'; btn.className='day'+(state.selectedDate===date?' selected':'');
      btn.setAttribute('aria-label', `${d} de ${monthNames[m]}`);
      btn.innerHTML=`<span class="day-number">${d}</span><span class="markers">${morning?'<i class="dot morning"></i>':''}${night?'<i class="dot night"></i>':''}${(morning?.happened||night?.happened)?'<i class="dot happened"></i>':''}</span>`;
      btn.addEventListener('click',()=>{state.selectedDate=date; renderCalendar(); renderForm();});
      grid.appendChild(btn);
    }
  }

  function renderForm(){
    const [y,m,d]=state.selectedDate.split('-');
    $('selectedDateLabel').textContent=`${d}/${m}/${y} • ${state.selectedPeriod==='morning'?'manhã':'noite'}`;
    document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b.dataset.period===state.selectedPeriod));
    const e=getEntry(state.selectedDate,state.selectedPeriod);
    $('selfWanted').checked=!!e?.selfWanted; $('partnerWanted').checked=!!e?.partnerWanted; $('happened').checked=!!e?.happened;
    $('deleteButton').disabled=!e; $('deleteButton').style.opacity=e?'1':'.45';
    $('feedback').textContent=e?'Registro existente carregado. Você pode alterar e salvar novamente.':'';
  }

  function monthStats(mk){
    const list=state.entries.filter(e=>monthKey(e.date)===mk);
    const [y,m]=mk.split('-').map(Number);
    const happened=list.filter(e=>e.happened).length;
    const self=list.filter(e=>e.selfWanted).length;
    const partner=list.filter(e=>e.partnerWanted).length;
    const both=list.filter(e=>e.selfWanted&&e.partnerWanted).length;
    const selfOnly=list.filter(e=>e.selfWanted&&!e.partnerWanted).length;
    const partnerOnly=list.filter(e=>!e.selfWanted&&e.partnerWanted).length;
    const neither=list.filter(e=>!e.selfWanted&&!e.partnerWanted).length;
    const opportunities=list.filter(e=>e.selfWanted||e.partnerWanted).length;
    const realization=opportunities? happened/opportunities*100 : 0;
    return {happened,self,partner,both,selfOnly,partnerOnly,neither,realization,weekly:avgWeekly(happened,y,m-1),records:list.length};
  }

  function renderMetrics(){
    const s=monthStats(currentMonthKey());
    $('metricHappened').textContent=s.happened; $('metricSelf').textContent=s.self; $('metricPartner').textContent=s.partner; $('metricBoth').textContent=s.both;
    $('metricHappenedSub').textContent=`${s.weekly.toFixed(1).replace('.',',')} por semana`;
    $('metricSelfSub').textContent=`${s.selfOnly} só eu`;
    $('metricPartnerSub').textContent=`${s.partnerOnly} só ela`;
    $('metricBothSub').textContent=`${s.realization.toFixed(0)}% de realização`;
  }

  function availableMonths(){
    const set=new Set(state.entries.map(e=>monthKey(e.date)));
    const now=new Date(); for(let i=0;i<12;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); set.add(`${d.getFullYear()}-${pad(d.getMonth()+1)}`); }
    return [...set].sort().reverse();
  }

  function monthLabel(mk){ const [y,m]=mk.split('-').map(Number); return `${shortMonths[m-1]}/${String(y).slice(-2)}`; }

  function renderMonthOptions(){
    const months=availableMonths(); const a=$('monthA'), b=$('monthB');
    const oldA=a.value, oldB=b.value; a.innerHTML=''; b.innerHTML='';
    months.forEach(m=>{ const oa=document.createElement('option'); oa.value=m; oa.textContent=monthLabel(m); a.appendChild(oa); const ob=oa.cloneNode(true); b.appendChild(ob); });
    a.value=oldA&&months.includes(oldA)?oldA:(months[1]||months[0]); b.value=oldB&&months.includes(oldB)?oldB:months[0];
  }

  function deltaCell(a,b){
    const d=pctDelta(a,b); if(d===null) return '<span class="delta up">novo</span>';
    const cls=d>0.05?'up':d<-0.05?'down':'flat'; const sign=d>0?'+':'';
    return `<span class="delta ${cls}">${sign}${d.toFixed(0)}%</span>`;
  }

  function renderComparison(){
    const ma=$('monthA').value, mb=$('monthB').value; if(!ma||!mb) return;
    const a=monthStats(ma), b=monthStats(mb);
    const rows=[
      ['Fizemos',a.happened,b.happened,deltaCell(a.happened,b.happened)],
      ['Média por semana',a.weekly.toFixed(1).replace('.',','),b.weekly.toFixed(1).replace('.',','),deltaCell(a.weekly,b.weekly)],
      ['Eu quis',a.self,b.self,deltaCell(a.self,b.self)],
      ['Minha esposa quis',a.partner,b.partner,deltaCell(a.partner,b.partner)],
      ['Os dois quiseram',a.both,b.both,deltaCell(a.both,b.both)],
      ['Eu quis / ela não',a.selfOnly,b.selfOnly,deltaCell(a.selfOnly,b.selfOnly)],
      ['Ela quis / eu não',a.partnerOnly,b.partnerOnly,deltaCell(a.partnerOnly,b.partnerOnly)],
      ['Taxa de realização',`${a.realization.toFixed(0)}%`,`${b.realization.toFixed(0)}%`,`${(b.realization-a.realization)>=0?'+':''}${(b.realization-a.realization).toFixed(0)} p.p.`]
    ];
    $('comparison').innerHTML=`<table><thead><tr><th>Indicador</th><th>${monthLabel(ma)}</th><th>${monthLabel(mb)}</th><th>Variação</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderTrend(){
    const svg=$('trendChart'); const now=new Date(state.cursor.getFullYear(),state.cursor.getMonth(),1); const months=[];
    for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push(`${d.getFullYear()}-${pad(d.getMonth()+1)}`); }
    const data=months.map(m=>({m,...monthStats(m)})); const max=Math.max(1,...data.flatMap(d=>[d.happened,d.self,d.partner]));
    const W=760,H=260,pL=44,pR=18,pT=18,pB=44,plotW=W-pL-pR,plotH=H-pT-pB;
    const x=i=>pL+(plotW/(data.length-1||1))*i, y=v=>pT+plotH-(v/max)*plotH;
    const colors={happened:'var(--success)',self:'var(--accent)',partner:'var(--night)'};
    let out='';
    for(let i=0;i<=4;i++){const val=max*i/4, yy=y(val); out+=`<line x1="${pL}" y1="${yy}" x2="${W-pR}" y2="${yy}" stroke="var(--line)" stroke-width="1"/><text x="${pL-10}" y="${yy+4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(val)}</text>`;}
    data.forEach((d,i)=>{out+=`<text x="${x(i)}" y="${H-16}" text-anchor="middle" font-size="10" fill="var(--muted)">${monthLabel(d.m)}</text>`;});
    ['happened','self','partner'].forEach(k=>{ const points=data.map((d,i)=>`${x(i)},${y(d[k])}`).join(' '); out+=`<polyline points="${points}" fill="none" stroke="${colors[k]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`; data.forEach((d,i)=>out+=`<circle cx="${x(i)}" cy="${y(d[k])}" r="4" fill="${colors[k]}"/>`); });
    svg.innerHTML=out;
  }

  async function save(){
    try{
      setStatus('Salvando…',true); $('feedback').textContent='Salvando…';
      const payload={date:state.selectedDate,period:state.selectedPeriod,selfWanted:$('selfWanted').checked,partnerWanted:$('partnerWanted').checked,happened:$('happened').checked};
      const saved=await api('/api/entries',{method:'PUT',body:JSON.stringify(payload)});
      const idx=state.entries.findIndex(e=>entryKey(e.date,e.period)===entryKey(saved.date,saved.period)); if(idx>=0) state.entries[idx]=saved; else state.entries.push(saved);
      setStatus('Sincronizado'); renderAll(); $('feedback').textContent='Registro salvo.';
    }catch(e){setStatus('Falha ao salvar'); $('feedback').textContent=e.message;}
  }

  async function remove(){
    try{
      setStatus('Excluindo…',true);
      await api(`/api/entries?date=${encodeURIComponent(state.selectedDate)}&period=${state.selectedPeriod}`,{method:'DELETE'});
      state.entries=state.entries.filter(e=>entryKey(e.date,e.period)!==entryKey(state.selectedDate,state.selectedPeriod)); setStatus('Sincronizado'); renderAll(); $('feedback').textContent='Registro excluído.';
    }catch(e){setStatus('Falha ao excluir'); $('feedback').textContent=e.message;}
  }

  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.selectedPeriod=b.dataset.period; renderForm();}));
  $('prevMonth').addEventListener('click',()=>{state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()-1,1); state.selectedDate=key(state.cursor.getFullYear(),state.cursor.getMonth(),1); renderAll();});
  $('nextMonth').addEventListener('click',()=>{state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth()+1,1); state.selectedDate=key(state.cursor.getFullYear(),state.cursor.getMonth(),1); renderAll();});
  $('saveButton').addEventListener('click',save); $('deleteButton').addEventListener('click',remove); $('monthA').addEventListener('change',renderComparison); $('monthB').addEventListener('change',renderComparison);

  load();
})();
