(function(){
'use strict';
var WORDS=[],SESS=[],DAY=null,SIZE=25;
var STREAK={count:0,today:false};
var USER=null,DAYS=[],PROG={},RATING={avg:0,count:0,mine:0},CFG={needsCode:false};
var save={sessions:{},xp:0,weak:{},pron:{},sound:true};
try{save.sound=localStorage.getItem('bv-sound')!=='0'}catch(e){}

/* ---------- server ---------- */
function api(method,url,body){
  var o={method:method,headers:{},credentials:'same-origin'};
  if(body!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
  return fetch(url,o).then(function(r){
    return r.json().catch(function(){return {}}).then(function(j){
      if(r.status===401&&url!=='/api/login'){var had=!!USER;USER=null;login(had?'Please sign in again.':'');throw new Error('auth')}
      if(!r.ok){var e=new Error(j.error||'Something went wrong');e.status=r.status;throw e}
      return j;
    });
  });
}
function toast(t){var o=document.getElementById('toast');if(o)o.remove();var d=document.createElement('div');d.className='toast';d.id='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},2600)}
var PEND_KEY='bv-pending';
function pend(){try{return JSON.parse(localStorage.getItem(PEND_KEY)||'{}')}catch(e){return {}}}
function setPend(o){try{localStorage.setItem(PEND_KEY,JSON.stringify(o))}catch(e){}}
var flushing=false;
function flush(){
  if(flushing||!USER)return;var p=pend(),ids=Object.keys(p);if(!ids.length)return;flushing=true;
  var chain=Promise.resolve();
  ids.forEach(function(id){chain=chain.then(function(){return api('PUT','/api/progress/'+id,{state:p[id]}).then(function(){var q=pend();delete q[id];setPend(q)})})});
  chain.catch(function(){}).then(function(){flushing=false});
}
function persist(){
  if(!DAY||!USER)return;
    var st={sessions:save.sessions,xp:save.xp,weak:save.weak,pron:save.pron||{}};PROG[DAY.id]=st;
  var p=pend();p[DAY.id]=st;setPend(p);flush();
}
  function awardPron(w){
  if(!DAY||!USER)return Promise.reject(new Error('no'));
  save.pron=save.pron||{};
  if(save.pron[w.i])return Promise.resolve({awarded:false,xp:0});
  return api('POST','/api/pronounce',{dayId:DAY.id,word:w.i}).then(function(r){
    save.pron[w.i]=1;
    if(r&&r.awarded){save.xp+=r.xp;sfx.ok()}
    persist();
    return r;
  });
}
function logAttempt(){
  var body={dayId:DAY.id,session:Q.id,pct:Q.pct,stars:Q.stars,correct:Q.correct,total:Q.N,xp:Q.xp,bestStreak:Q.best,seconds:Math.round((Date.now()-Q.t0)/1000),misses:Q.misses};
  api('POST','/api/attempts',body).then(function(r){if(r&&r.streak)STREAK=r.streak}).catch(function(){});
}
function setDay(info,rows){
  DAY=info;
  WORDS=rows.map(function(r,i){return {i:i,n:i+1,part:r[0],sec:r[1],en:r[2],uz:r[3]}});
  SESS=[];for(var s=0;s<WORDS.length;s+=SIZE){SESS.push({id:SESS.length+1,idx:WORDS.slice(s,s+SIZE).map(function(w){return w.i})})}
  var p=PROG[info.id]||{};
    save={sessions:p.sessions||{},xp:p.xp||0,weak:p.weak||{},pron:p.pron||{},sound:save.sound};
}

/* ---------- helpers ---------- */
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function shuffle(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t}return a}
function sv(c,p){return '<svg class="'+c+'" viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>'}
var IC={
 star:sv('fill','<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>'),
 flame:sv('fill','<path d="M19.48 12.35c-1.57-4.08-7.16-4.3-5.81-10.23.1-.44-.37-.78-.75-.55C9.29 3.71 6.68 8 8.87 13.62c.18.46-.36.89-.75.59-1.81-1.37-2-3.34-1.84-4.75.06-.52-.62-.77-.91-.34C4.69 10.16 4 11.84 4 14.37c.38 5.68 5.91 7.14 7.87 7.39 2.77.35 5.76-.9 7.87-3.4 2.1-2.49 2.97-5.62 1.74-8.01z"/>'),
 bolt:sv('fill','<path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/>'),
 check:sv('line','<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
 cross:sv('line','<path d="M6 6l12 12M18 6L6 18"/>'),
 back:sv('line','<path d="M15 5l-7 7 7 7"/>'),
 next:sv('line','<path d="M5 12h14M13 6l6 6-6 6"/>'),
 sound:sv('line','<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>'),
 mute:sv('line','<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
 cards:sv('line','<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/>'),
 target:sv('line','<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>')
};
function starsHtml(n,total){var h='';for(var i=0;i<(total||3);i++){h+=i<n?IC.star.replace('class="fill"','class="fill on"'):IC.star}return h}

/* ---------- sound & haptics ---------- */
var AC=null;
function tone(freqs,dur,type,vol){
  if(!save.sound)return;
  try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();var t=AC.currentTime;
    freqs.forEach(function(f,k){var o=AC.createOscillator(),g=AC.createGain();o.type=type||'sine';o.frequency.value=f;
      var st=t+k*dur;g.gain.setValueAtTime(0.0001,st);g.gain.linearRampToValueAtTime(vol||.06,st+.015);g.gain.exponentialRampToValueAtTime(.0001,st+dur);
      o.connect(g);g.connect(AC.destination);o.start(st);o.stop(st+dur+.03)})}catch(e){}
}
var sfx={ok:function(){tone([660,880],.1)},bad:function(){tone([230,170],.14,'triangle',.08)},win:function(){tone([523,659,784,1047],.13)}};
function buzz(p){try{if(navigator.vibrate)navigator.vibrate(p)}catch(e){}}

/* ---------- word logic ---------- */
var STOP={the:1,and:1,for:1,with:1,from:1,that:1,this:1,into:1,over:1,than:1,have:1,been:1,their:1,one:1,someone:1,something:1};
function kw(s){return s.toLowerCase().replace(/[^a-z\s'-]/g,' ').split(/\s+/).filter(function(w){return w.length>=4&&!STOP[w]})}
function similar(a,b){if(a.en.toLowerCase()===b.en.toLowerCase())return true;var ka=kw(a.en),kb=kw(b.en);return ka.some(function(x){return kb.indexOf(x)>-1})}
function distract(w,field){
  var mine=w[field],L=mine.length;
  var c=WORDS.filter(function(o){return o.i!==w.i&&o[field]!==mine&&!similar(w,o)}).map(function(o){
    return {o:o,s:Math.abs(o[field].length-L)/Math.max(L,o[field].length)+(o.part===w.part?-.2:0)+Math.random()*.45}});
  c.sort(function(a,b){return a.s-b.s});
  var out=[],seen={};seen[mine]=1;
  for(var k=0;k<c.length&&out.length<3;k++){var t=c[k].o[field];if(seen[t])continue;seen[t]=1;out.push(t)}
  return out;
}
function isSingle(en){return /^[A-Za-z][A-Za-z'-]{2,}$/.test(en)}
function norm(s){return s.toLowerCase().replace(/[^a-z]/g,'')}
function lev(a,b){var m=a.length,n=b.length,d=[],i,j;for(i=0;i<=m;i++){d[i]=[i]}for(j=1;j<=n;j++){d[0][j]=j}
  for(i=1;i<=m;i++){for(j=1;j<=n;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1))}}return d[m][n]}
function plan(N){var n1=Math.round(N*.36),n2=Math.round(N*.32);return [n1,n2,N-n1-n2]}
function partLabel(idx){if(!WORDS[idx[0]].part)return '';var p={};idx.forEach(function(i){p[WORDS[i].part]=1});var k=Object.keys(p).sort();return k.length>1?'Parts '+k.join(' & '):'Part '+k[0]}
function nextSession(){
  for(var i=0;i<SESS.length;i++){if(!save.sessions[SESS[i].id])return SESS[i].id}
  var best=SESS[0].id,bs=9;SESS.forEach(function(s){var st=(save.sessions[s.id]||{}).stars||0;if(st<bs){bs=st;best=s.id}});return best;
}
function weakList(){return Object.keys(save.weak).map(Number)}

/* ---------- views ---------- */
var app=document.getElementById('app');
var Q=null, ST=null, view='home';
function show(html,v){view=v;app.innerHTML=html;document.body.classList.remove('has-sheet');window.scrollTo(0,0)}

function dayHome(){
  var stars=0;for(var k in save.sessions){stars+=save.sessions[k].stars||0}
  var weak=weakList().length, nx=nextSession(), played=!!save.sessions[nx];
  var cards=SESS.map(function(s){
    var r=save.sessions[s.id], a=WORDS[s.idx[0]].n, b=WORDS[s.idx[s.idx.length-1]].n;
    return '<button class="scard" data-act="open" data-s="'+s.id+'" aria-label="Session '+s.id+'">'+
      '<span class="snum">'+s.id+'</span><span class="stitle">Session '+s.id+'</span>'+
      '<span class="srange">Words '+a+'–'+b+'</span><span class="spart">'+partLabel(s.idx)+'</span>'+
      '<span class="foot">'+(r?'<span class="stars">'+starsHtml(r.stars)+'</span><span class="best">'+r.best+'%</span>':'<span class="stars">'+starsHtml(0)+'</span><span class="new">New</span>')+'</span></button>';
  }).join('');
  var weakBtn=weak>=4
    ? '<button class="weak" data-act="weak"><span class="wi">'+IC.target+'</span><span><b>Practise weak words</b><span>'+weak+' words to fix. One mixed round.</span></span></button>'
    : '<button class="weak" disabled><span class="wi">'+IC.target+'</span><span><b>Weak words</b><span>Words you miss will collect here for extra practice.</span></span></button>';
  show('<div class="band"><div class="wrap hero">'+
    '<div class="toprow"><button class="icon ghost" data-act="hub" aria-label="All days">'+IC.back+'</button><span class="pill">'+esc(DAY.badge)+'</span><button class="icon ghost" data-act="sound" aria-label="'+(save.sound?'Turn sound off':'Turn sound on')+'">'+(save.sound?IC.sound:IC.mute)+'</button></div>'+
    '<h1>'+esc(DAY.title)+'</h1><p class="sub">'+esc(DAY.topic?DAY.topic+' · ':'')+WORDS.length+' words · '+SESS.length+' sessions</p>'+
    '<div class="stats"><div class="stat"><b>'+IC.star+stars+'/'+SESS.length*3+'</b><span>Stars</span></div>'+
    '<div class="stat"><b>'+IC.bolt+save.xp+'</b><span>XP</span></div>'+
    '<div class="stat"><b>'+IC.target+weak+'</b><span>Weak words</span></div></div></div></div>'+
    '<div class="wrap main">'+
    '<button class="cta" data-act="open" data-s="'+nx+'">'+(played?'Improve Session '+nx:'Start Session '+nx)+IC.next+'</button>'+
    '<div class="sec-h"><h2>Sessions</h2><span>25 words each</span></div><div class="grid">'+cards+'</div>'+weakBtn+
    '<div style="text-align:center"><button class="link" data-act="reset" id="rst">Reset my progress</button></div></div>','home');
}

function intro(id){
  var ss=SESS[id-1],words=ss.idx.map(function(i){return WORDS[i]}),secs=[],seen={};
  words.forEach(function(w){if(!seen[w.sec]){seen[w.sec]=1;secs.push(w.sec)}});
  var p=plan(words.length), r=save.sessions[id];
  show('<div class="wrap"><div class="bar"><button class="icon solid" data-act="home" aria-label="Back">'+IC.back+'</button><h2>Session '+id+'</h2></div>'+
    '<div class="stack" style="padding-block:6px 24px">'+
    '<div class="panel"><div><b>Words '+words[0].n+'–'+words[words.length-1].n+'</b> · '+partLabel(ss.idx)+(r?' · Best '+r.best+'%':'')+'</div>'+
    '<div class="topics">'+secs.map(function(t){return '<span class="topic">'+esc(t)+'</span>'}).join('')+'</div></div>'+
    '<div class="panel plan"><div class="step"><i>1</i><div><b>Pick the meaning</b><span>'+p[0]+' questions · English to Uzbek</span></div></div>'+
    '<div class="step"><i>2</i><div><b>Pick the English</b><span>'+p[1]+' questions · Uzbek to English</span></div></div>'+
    '<div class="step"><i>3</i><div><b>Build or type it</b><span>'+p[2]+' questions · spell the answer</span></div></div></div>'+
    '<button class="cta alt" data-act="study" data-s="'+id+'">'+IC.cards+'Study the '+words.length+' words first</button>'+
    '<button class="cta" data-act="quiz" data-s="'+id+'">Start quiz'+IC.next+'</button></div></div>','intro');
}

/* flashcards */
function study(id){ST={id:id,deck:SESS[id-1].idx.slice(),pos:0,flip:false};card()}
function card(){ST.flip=false;
  var w=WORDS[ST.deck[ST.pos]],n=ST.deck.length,last=ST.pos===n-1;
  show('<div class="wrap"><div class="bar"><button class="icon solid" data-act="intro" data-s="'+ST.id+'" aria-label="Back">'+IC.back+'</button>'+
    '<div class="meter"><i style="width:'+((ST.pos+1)/n*100)+'%"></i></div><span class="chip-s xp">'+(ST.pos+1)+'/'+n+'</span></div>'+
    '<div class="deck"><div class="fc" id="fc" data-act="flip" role="button" tabindex="0" aria-label="Flip card">'+
    '<div class="face"><span class="secchip">'+esc(w.sec)+'</span><div class="big">'+esc(w.en)+'</div><span class="hint">Tap to see the Uzbek</span></div>'+
    '<div class="face back"><span class="secchip">'+esc(w.sec)+'</span><div class="big">'+esc(w.uz)+'</div><span class="en-s">'+esc(w.en)+'</span><span class="hint">Tap to flip back</span></div></div></div>'+
    '<div id="vv-slot"></div>'+
    '<div class="navrow"><button class="cta alt" data-act="prev"'+(ST.pos===0?' disabled':'')+' aria-label="Previous">'+IC.back+'</button>'+
    (last?'<button class="cta" data-act="quiz" data-s="'+ST.id+'">Start quiz'+IC.next+'</button>':'<button class="cta" data-act="nextcard">Next'+IC.next+'</button>')+'</div>'+
    '<div style="text-align:center;padding-block:6px 24px"><button class="link" data-act="quiz" data-s="'+ST.id+'">Skip to the quiz</button></div></div>','study');
if(window.VocabVoice)VocabVoice.mount(document.getElementById('vv-slot'),w.en,{earned:!!(save.pron&&save.pron[w.i]),onMatch:function(){return awardPron(w)}});
  }

/* quiz */
function startQuiz(idxs,opts){
  var N=idxs.length,p=plan(N),order=shuffle(idxs);
  var qs=order.map(function(w,k){
    var stage=k<p[0]?1:k<p[0]+p[1]?2:3;
    var type=stage===1?'en2uz':stage===2?'uz2en':(isSingle(WORDS[w].en)?'type':'build');
    return {w:w,stage:stage,type:type};
  });
  Q={t0:Date.now(),id:opts.id,weak:!!opts.weak,qs:qs,N:N,pos:0,xp:0,streak:0,best:0,correct:0,first:{},misses:[],fix:false,done:0,total:N,tries:{},answered:false,cur:null,bd:null,earned:0};
  nextQ();
}
var STAGE=['Pick the meaning','Pick the English','Build or type the answer'];
function topBar(){
  var pr=Math.min(100,Math.round((Q.done)/Q.total*100));
  return '<div class="bar"><button class="icon solid" data-act="quit" aria-label="Leave session">'+IC.cross+'</button>'+
    '<div class="meter" role="progressbar" aria-valuenow="'+pr+'" aria-valuemin="0" aria-valuemax="100"><i style="width:'+pr+'%"></i></div>'+
    '<span class="chip-s" title="Streak">'+IC.flame+Q.streak+'</span>'+(Q.fix?'':'<span class="chip-s xp" title="XP">'+IC.bolt+Q.xp+'</span>')+'</div>';
}
function nextQ(){
  var q=Q.qs[Q.pos];
  if(!q){return Q.fix?finishFix():finish()}
  Q.answered=false;var w=WORDS[q.w];Q.cur={q:q,w:w};
  var head='<div class="wrap qpad">'+topBar()+'<div class="stage">'+(Q.fix?'Fix-it round · Try again':'Stage '+q.stage+' of 3 · '+STAGE[q.stage-1])+'</div>';
  var html;
  if(q.type==='en2uz'||q.type==='uz2en'){
    var field=q.type==='en2uz'?'uz':'en',correct=w[field],opts=shuffle([correct].concat(distract(w,field)));
    q.opts=opts;q.ok=opts.indexOf(correct);
    html=head+'<div class="qcard"><span class="qsec">'+esc(w.sec)+'</span><div class="qlabel">'+(q.type==='en2uz'?'What does it mean in Uzbek?':'Which English word or phrase is this?')+'</div>'+
      '<div class="prompt'+(q.type==='uz2en'?' uz':'')+'">'+esc(q.type==='en2uz'?w.en:w.uz)+'</div></div>'+
      '<div class="opts" id="opts">'+opts.map(function(t,k){return '<button class="opt" data-act="pick" data-k="'+k+'"><span class="lt">'+'ABCD'.charAt(k)+'</span><span class="ot">'+esc(t)+'</span></button>'}).join('')+'</div>'+
      '<div style="text-align:center"><button class="link" data-act="skip">I don’t know</button></div></div>';
  }else if(q.type==='build'){
    var toks=w.en.split(/\s+/),ids=shuffle(toks.map(function(_,i){return i}));
    if(toks.length>1){var tries=0;while(ids.every(function(v,i){return v===i})&&tries<5){ids=shuffle(ids);tries++}}
    Q.bd={toks:toks,pool:ids,ans:[],locked:false};
    html=head+'<div class="qcard"><span class="qsec">'+esc(w.sec)+'</span><div class="qlabel">Build the English phrase for</div><div class="prompt uz">'+esc(w.uz)+'</div></div>'+
      '<div class="slots" id="slots"></div><div class="pool" id="pool"></div>'+
      '<div class="actions"><button class="link" data-act="skip">I don’t know</button><button class="cta" id="chk" data-act="check" disabled>Check</button></div></div>';
  }else{
    var len=w.en.length;
    html=head+'<div class="qcard"><span class="qsec">'+esc(w.sec)+'</span><div class="qlabel">Type the English word for</div><div class="prompt uz">'+esc(w.uz)+'</div></div>'+
      '<div class="field"><input id="ans" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Your answer" aria-label="Your answer">'+
      '<small>'+len+' letters · starts with “'+esc(w.en.charAt(0).toUpperCase())+'”</small></div>'+
      '<div class="actions"><button class="link" data-act="skip">I don’t know</button><button class="cta" id="chk" data-act="check">Check</button></div></div>';
  }
  show(html,'quiz');
  if(q.type==='build')drawBuild();
  if(q.type==='type'){var inp=document.getElementById('ans');if(inp){try{inp.focus({preventScroll:true})}catch(e){}}}
}
function drawBuild(){
  var b=Q.bd,locked=b.locked;
  var sl=document.getElementById('slots'),pl=document.getElementById('pool'),chk=document.getElementById('chk');
  function disp(t){return (t===t.toUpperCase()&&/[A-Z]{2}/.test(t))?t:t.toLowerCase()}
  sl.innerHTML=b.ans.length?b.ans.map(function(i){return '<button class="chipw sel" data-act="unchip" data-i="'+i+'"'+(locked?' disabled':'')+'>'+esc(disp(b.toks[i]))+'</button>'}).join(''):'<span class="ph">Tap the words in order</span>';
  pl.innerHTML=b.pool.filter(function(i){return b.ans.indexOf(i)<0}).map(function(i){return '<button class="chipw" data-act="chip" data-i="'+i+'"'+(locked?' disabled':'')+'>'+esc(disp(b.toks[i]))+'</button>'}).join('');
  if(chk)chk.disabled=locked||b.ans.length!==b.toks.length;
}
function pick(k){
  if(Q.answered)return;var q=Q.cur.q,ok=k===q.ok,box=document.getElementById('opts');
  var bt=box.querySelectorAll('.opt');
  box.classList.add('done');
  bt.forEach(function(b,i){if(i===q.ok)b.classList.add('ok');else if(i===k)b.classList.add('bad');else b.classList.add('dim')});
  resolve(ok);
}
function skip(){
  if(Q.answered)return;var q=Q.cur.q;
  if(q.opts){var box=document.getElementById('opts');box.classList.add('done');box.querySelectorAll('.opt').forEach(function(b,i){b.classList.add(i===q.ok?'ok':'dim')})}
  if(q.type==='build'){Q.bd.locked=true;drawBuild()}
  var inp=document.getElementById('ans');if(inp)inp.disabled=true;
  resolve(false);
}
function check(){
  if(Q.answered)return;var q=Q.cur.q,w=Q.cur.w,ok=false,note='';
  if(q.type==='build'){
    var b=Q.bd,mine=b.ans.map(function(i){return b.toks[i].toLowerCase()}).join(' '),want=w.en.toLowerCase().split(/\s+/).join(' ');
    ok=mine===want;b.locked=true;drawBuild();document.getElementById('slots').classList.add(ok?'ok':'bad');
  }else{
    var inp=document.getElementById('ans'),v=norm(inp.value||''),t=norm(w.en);
    if(!v){inp.focus();return}
    if(v===t)ok=true;else if(t.length>=6&&lev(v,t)<=1){ok=true;note='Nearly. Check the spelling.'}
    inp.disabled=true;inp.style.borderColor=ok?'var(--ok)':'var(--bad)';
  }
  resolve(ok,note);
}
var PRAISE=['Correct','Nice one','Spot on','Great','Well done'];
function resolve(ok,note){
  Q.answered=true;var w=Q.cur.w,q=Q.cur.q,gain=0,msg='';
  if(!Q.fix){
    if(ok){Q.correct++;Q.streak++;gain=10+(Q.streak>=6?10:Q.streak>=3?5:0);Q.xp+=gain;Q.first[w.i]=true;if(Q.streak>Q.best)Q.best=Q.streak;sfx.ok();buzz(15)}
    else{Q.streak=0;Q.first[w.i]=false;Q.misses.push(w.i);sfx.bad();buzz([40,30,40])}
    Q.done++;
  }else{
    if(ok){Q.done++;sfx.ok();buzz(15)}
    else{Q.tries[w.i]=(Q.tries[w.i]||0)+1;sfx.bad();buzz([40,30,40]);
      if(Q.tries[w.i]<2){Q.qs.push({w:w.i,stage:0,type:Q.qs.length%2?'en2uz':'uz2en'})}else{Q.done++}}
  }
  var title=ok?(PRAISE[Q.pos%5]+(gain?' +'+gain:'')):'Not quite';
  if(ok&&Q.streak>=3&&!Q.fix)msg=Q.streak+' in a row';
  var html='<div class="sheet'+(ok?'':' bad')+'" role="status" aria-live="polite"><div class="inner"><div class="ttl">'+(ok?IC.check:IC.cross)+'<span>'+title+'</span></div>'+
    '<div class="ans"><b>'+esc(w.en)+'</b> · '+esc(w.uz)+(note||msg?'<small>'+esc(note||msg)+'</small>':'')+'</div>'+
    '<button class="cta" data-act="cont" id="cont">Continue'+IC.next+'</button></div></div>';
  app.insertAdjacentHTML('beforeend',html);document.body.classList.add('has-sheet');
  var m=document.querySelector('.meter i');if(m)m.style.width=Math.min(100,Math.round(Q.done/Q.total*100))+'%';
  var f=document.querySelector('.chip-s');if(f){f.innerHTML=IC.flame+Q.streak}
  var x=document.querySelector('.chip-s.xp');if(x&&!Q.fix)x.innerHTML=IC.bolt+Q.xp;
  setTimeout(function(){var c=document.getElementById('cont');if(c)try{c.focus({preventScroll:true})}catch(e){}},60);
}
function cont(){Q.pos++;nextQ()}

function finish(){
  var N=Q.N,pct=Math.round(Q.correct/N*100),stars=pct>=90?3:pct>=75?2:pct>=50?1:0;
  Q.pct=pct;Q.stars=stars;
  WORDS.forEach(function(w){if(Q.first[w.i]===true&&save.weak[w.i])delete save.weak[w.i]});
  Q.misses.forEach(function(i){save.weak[i]=(save.weak[i]||0)+1});
  save.xp+=Q.xp;
  if(!Q.weak){var r=save.sessions[Q.id]||{plays:0,best:0,stars:0};r.plays++;r.best=Math.max(r.best,pct);r.stars=Math.max(r.stars,stars);save.sessions[Q.id]=r}
  persist();logAttempt();results();
}
function results(){
  var N=Q.N,pct=Q.pct,stars=Q.stars,miss=Q.misses.slice();
  var title=stars===3?'Excellent work':stars===2?'Good job':stars===1?'Getting there':'Keep practising';
  var sub=Q.fixed?'All mistakes fixed. Play again to lock them in.':stars>=2?'You know these words well.':'Study the words once more and try again.';
  var hasNext=!Q.weak&&Q.id<SESS.length;
  var missHtml=miss.length?'<div class="miss"><h3>'+(Q.fixed?'Words you practised':'Words to review')+' ('+miss.length+')</h3>'+miss.map(function(i){var w=WORDS[i];return '<div class="mi"><b>'+esc(w.en)+'</b><small>'+esc(w.uz)+'</small></div>'}).join('')+'</div>':'';
  show('<div class="wrap"><div class="res"><div class="ring"><svg viewBox="0 0 120 120"><defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#FF4D5E"/></linearGradient></defs>'+
    '<circle class="tr" cx="60" cy="60" r="52"/><circle class="pr" id="pr" cx="60" cy="60" r="52"/></svg><b>'+pct+'%</b></div>'+
    '<div class="bigstars">'+[0,1,2].map(function(i){return i<stars?IC.star.replace('class="fill"','class="fill on" style="animation-delay:'+(.3+i*.25)+'s"'):IC.star}).join('')+'</div>'+
    '<h2>'+title+'</h2><p>'+sub+'</p>'+
    '<div class="trio"><div><b>'+Q.correct+'/'+N+'</b><span>First try</span></div><div><b>+'+Q.xp+'</b><span>XP</span></div><div><b>'+Q.best+'</b><span>Best streak</span></div></div>'+
    missHtml+
    '<div class="stack" style="width:100%;padding-block:8px 24px">'+
    (miss.length&&!Q.fixed?'<button class="cta" data-act="fix">Fix my '+miss.length+' mistake'+(miss.length>1?'s':'')+IC.next+'</button>':'')+
    (hasNext?'<button class="cta'+(miss.length&&!Q.fixed?' alt':'')+'" data-act="open" data-s="'+(Q.id+1)+'">Next: Session '+(Q.id+1)+IC.next+'</button>':'')+
    (Q.weak?'':'<button class="cta alt" data-act="quiz" data-s="'+Q.id+'">Play Session '+Q.id+' again</button>')+
    '<button class="cta alt" data-act="home">Back to sessions</button></div></div></div>','results');
  setTimeout(function(){var p=document.getElementById('pr');if(p)p.style.strokeDashoffset=String(327-327*pct/100)},60);
  if(stars>=2){sfx.win();confetti()}else if(stars===1){sfx.ok()}
}
function startFix(){
  var ids=Q.misses.slice();
  Q.fix=true;Q.fixed=false;Q.qs=ids.map(function(w,k){return {w:w,stage:0,type:k%2?'uz2en':'en2uz'}});Q.pos=0;Q.done=0;Q.total=ids.length;Q.tries={};Q.streak=0;nextQ();
}
function finishFix(){Q.fixed=true;Q.fix=false;results()}

/* confetti */
function confetti(){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  var c=document.createElement('canvas');c.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
  document.body.appendChild(c);var W=c.width=window.innerWidth,H=c.height=window.innerHeight,x=c.getContext('2d');
  var cols=['#7C3AED','#A78BFA','#E11D2E','#FF4D5E','#FFC933','#FFFFFF'],P=[];
  for(var i=0;i<90;i++)P.push({x:W/2+(Math.random()-.5)*60,y:H*.35,vx:(Math.random()-.5)*11,vy:-Math.random()*11-3,s:5+Math.random()*6,r:Math.random()*6,vr:(Math.random()-.5)*.4,c:cols[i%cols.length]});
  var t0=performance.now();
  (function fr(t){var e=t-t0;x.clearRect(0,0,W,H);P.forEach(function(p){p.vy+=.28;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;x.save();x.translate(p.x,p.y);x.rotate(p.r);x.fillStyle=p.c;x.globalAlpha=Math.max(0,1-e/2200);x.fillRect(-p.s/2,-p.s/3,p.s,p.s*.6);x.restore()});
    if(e<2200)requestAnimationFrame(fr);else c.remove()})(t0);
}

/* ---------- leaderboard ---------- */
var LB=null,LBMODE='stars',LBSCOPE='week';
try{LBSCOPE=sessionStorage.getItem('bv-lbscope')==='all'?'all':'week'}catch(e){}
function lbSorted(){
  if(!LB)return [];
  var m=LBMODE;
  return LB.rows.slice().sort(function(a,b){return (b[m]-a[m])||(b[m==='stars'?'xp':'stars']-a[m==='stars'?'xp':'stars'])||a.name.localeCompare(b.name)});
}
function lbHtml(){
  if(!LB)return '<div class="empty-s">Loading…</div>';
  var all=lbSorted(),top=all.slice(0,10),me=null,myi=-1;
  all.forEach(function(r,i){if(r.id===LB.me){me=r;myi=i}});
  var medal=['gold','silver','bronze'];
  function row(r,i,self){
    return '<div class="lbrow'+(r.id===LB.me?' me':'')+(self?' self-out':'')+'"><span class="rk '+(i<3?medal[i]:'')+'">'+(i+1)+'</span>'+
      '<span class="nm">'+esc(r.name)+(r.id===LB.me?' <em>you</em>':'')+'</span>'+
      '<span class="v s'+(LBMODE==='stars'?' hi':'')+'">'+IC.star+r.stars+'</span><span class="v x'+(LBMODE==='xp'?' hi':'')+'">'+IC.bolt+r.xp+'</span></div>';
  }
  var h=top.map(function(r,i){return row(r,i,false)}).join('');
  if(me&&myi>=10)h+='<div class="lbgap">···</div>'+row(me,myi,true);
  if(!top.length||(LBSCOPE==='week'&&all.every(function(r){return !r.stars&&!r.xp})))h='<div class="empty-s">'+(LBSCOPE==='week'?'No one has practised this week yet. Be the first!':'Be the first on the board. Finish a session!')+'</div>';
  if(LBSCOPE==='week'&&LB.resetsAt){var dl=Math.max(0,Math.ceil((LB.resetsAt-Date.now())/86400e3));h+='<div class="lbnote">New week starts in '+dl+' day'+(dl===1?'':'s')+'</div>'}
  return h;
}
function lbRender(){
  var box=document.getElementById('lbbox');if(!box)return;
  box.innerHTML='<div class="seg" role="tablist"><button class="'+(LBSCOPE==='week'?'on':'')+'" data-act="lbscope" data-sc="week" role="tab">This week</button>'+
    '<button class="'+(LBSCOPE==='all'?'on':'')+'" data-act="lbscope" data-sc="all" role="tab">All time</button></div>'+
    '<div class="seg" role="tablist"><button class="'+(LBMODE==='stars'?'on':'')+'" data-act="lbmode" data-m="stars" role="tab">'+IC.star+'Stars</button>'+
    '<button class="'+(LBMODE==='xp'?'on':'')+'" data-act="lbmode" data-m="xp" role="tab">'+IC.bolt+'XP</button></div><div class="lb">'+lbHtml()+'</div>';
}
function lbLoad(){
  var sc=LBSCOPE;
  api('GET','/api/leaderboard?scope='+sc).then(function(d){if(sc===LBSCOPE){LB=d;lbRender()}}).catch(function(){});
}

/* ---------- web app screens ---------- */
function hubStats(){
  var stars=0,poss=0,xp=0,weak=0;
  DAYS.forEach(function(d){poss+=d.sessions*3;var p=PROG[d.id];if(p){xp+=p.xp||0;weak+=Object.keys(p.weak||{}).length;for(var k in p.sessions){if(Number(k)<=d.sessions)stars+=p.sessions[k].stars||0}}});
  return {stars:stars,poss:poss,xp:xp,weak:weak};
}
function dayProg(d){
  var p=PROG[d.id]||{sessions:{}},done=0,stars=0;
  for(var k in p.sessions){if(Number(k)<=d.sessions){done++;stars+=p.sessions[k].stars||0}}
  return {done:done,stars:stars};
}
function rateRow(){
  var m=RATING.mine,h='';
  for(var i=1;i<=5;i++){h+='<button class="'+(i<=m?'on':'')+'" data-act="rate" data-v="'+i+'" aria-label="'+i+' star'+(i>1?'s':'')+'">'+IC.star+'</button>'}
  return h;
}
function avgText(){return RATING.count?'<div class="avg">'+IC.star+RATING.avg.toFixed(1)+'<small>('+RATING.count+' rating'+(RATING.count>1?'s':'')+')</small></div>':'<div class="avg"><small>No ratings yet</small></div>'}
function streakHtml(){
  var n=STREAK.count||0;
  var t=n>0?(n+'-day streak'+(STREAK.today?'':' · practise today to keep it')):'Start your streak today';
  return '<div class="streak'+(n>0&&STREAK.today?' hot':'')+'">'+IC.flame+'<span>'+t+'</span></div>';
}
/* colour themes: classic (original) or navy (optional, calmer) */
var SKIN='classic';
try{SKIN=localStorage.getItem('bv-skin')==='navy'?'navy':'classic'}catch(e){}
function setSkin(s){
  SKIN=s;try{localStorage.setItem('bv-skin',s)}catch(e){}
  var r=document.documentElement;
  if(s==='navy'){r.setAttribute('data-skin','navy');r.setAttribute('data-theme','dark')}else{r.removeAttribute('data-skin');r.removeAttribute('data-theme')}
  var m=document.querySelector('meta[name=theme-color]');if(m)m.setAttribute('content',s==='navy'?'#0B1220':'#4C1D95');
}
setSkin(SKIN);
var HUBTAB='days';
try{HUBTAB=sessionStorage.getItem('bv-tab')==='board'?'board':'days'}catch(e){}
function dayCards(){
  if(!DAYS.length)return '<div class="empty-s">No days yet. Your teacher will add them soon.</div>';
  return '<div class="dgrid">'+DAYS.map(function(d){
    var p=dayProg(d),pct=Math.round(p.done/d.sessions*100),num=(d.badge.match(/\d+/)||[''])[0],done=p.done>=d.sessions;
    return '<button class="dcard'+(done?' done':'')+'" data-act="openday" data-d="'+d.id+'">'+
      '<span class="dn">'+(num?'<span>Day<b>'+esc(num)+'</b></span>':'<b>'+esc(d.badge)+'</b>')+'</span>'+
      '<span class="dt">'+esc(d.title)+'</span>'+
      '<span class="ds">'+esc(d.topic?d.topic:d.words+' words')+'</span>'+
      '<span class="meter" aria-hidden="true"><i style="width:'+pct+'%"></i></span>'+
      '<span class="dfoot"><span class="stars">'+starsHtml(Math.round(p.stars/d.sessions))+'</span><span class="dpr">'+(done?'Done':p.done+'/'+d.sessions)+'</span></span></button>';
  }).join('')+'</div>';
}
function hubBody(){
  if(HUBTAB==='board')return '<div class="sec-h"><h2>Leaderboard</h2><span>Top 10</span></div><div class="lbcard" id="lbbox"></div>';
  return '<div class="sec-h"><h2>Your days</h2><span>'+DAYS.length+' available</span></div>'+dayCards()+
    '<div class="rate-card"><div class="rate-top"><b>Rate this course</b><span id="avgbox">'+avgText()+'</span></div>'+
    '<div class="rate-stars" id="rs">'+rateRow()+'</div><div class="rate-msg" id="rmsg">'+(RATING.mine?'Thanks! Tap a star to change your rating.':'How useful is this for you? Tap a star.')+'</div></div>';
}
function hubTabs(){
  return '<div class="seg hubtabs" role="tablist"><button class="'+(HUBTAB==='days'?'on':'')+'" data-act="hubtab" data-t="days" role="tab">'+IC.cards+'Days</button>'+
    '<button class="'+(HUBTAB==='board'?'on':'')+'" data-act="hubtab" data-t="board" role="tab">'+IC.star+'Leaderboard</button></div>';
}
function setHubTab(t){
  HUBTAB=t==='board'?'board':'days';try{sessionStorage.setItem('bv-tab',HUBTAB)}catch(e){}
  var tb=document.getElementById('hubtabs'),bd=document.getElementById('hubbody');
  if(!tb||!bd)return hub();
  tb.innerHTML=hubTabs();bd.innerHTML=hubBody();if(HUBTAB==='board')lbLoad();
}
function hub(){
  var s=hubStats(),first=null;
  for(var i=0;i<DAYS.length;i++){if(dayProg(DAYS[i]).done<DAYS[i].sessions){first=DAYS[i];break}}
  var first1=USER.name.split(' ')[0];
  show('<div class="band"><div class="wrap hero">'+
    '<div class="toprow"><span class="pill">Class</span><span class="rt"><button class="icon ghost txt" data-act="skin" aria-label="Change colour theme">'+(SKIN==='navy'?'Classic look':'Navy look')+'</button><button class="icon ghost txt" data-act="logout">Log out</button></span></div>'+
    '<p class="hello">Hi, '+esc(first1)+'</p>'+streakHtml()+'<h1>Vocab Trainer</h1><p class="sub">Pick a day and keep your stars growing</p>'+
    '<div class="stats"><div class="stat"><b>'+IC.star+s.stars+'/'+s.poss+'</b><span>Stars</span></div>'+
    '<div class="stat"><b>'+IC.bolt+s.xp+'</b><span>XP</span></div>'+
    '<div class="stat"><b>'+IC.target+s.weak+'</b><span>Weak words</span></div></div></div></div>'+
    '<div class="wrap main">'+
    (first?'<button class="cta" data-act="openday" data-d="'+first.id+'">Continue · '+esc(first.badge)+IC.next+'</button>':'')+
    '<div id="hubtabs">'+hubTabs()+'</div><div id="hubbody" class="hubbody">'+hubBody()+'</div>'+
    '</div>','hub');
  if(HUBTAB==='board')lbLoad();
}
function doRate(v){
  api('POST','/api/rating',{stars:v}).then(function(r){
    RATING=r;var rs=document.getElementById('rs'),ab=document.getElementById('avgbox'),m=document.getElementById('rmsg');
    if(rs)rs.innerHTML=rateRow();if(ab)ab.innerHTML=avgText();if(m)m.textContent='Thanks for rating!';sfx.ok();
  }).catch(function(e){if(e.message!=='auth')toast('Could not save rating')});
}
function loading(t){show('<div class="skel"><div class="spin"></div>'+esc(t||'Loading…')+'</div>','load')}
function openDay(id){
  loading();
  api('GET','/api/days/'+id).then(function(d){
    var rows=d.rows;delete d.rows;setDay(d,rows);dayHome();
  }).catch(function(e){if(e.message!=='auth'){toast('Could not load the day');hub()}});
}
function login(msg){
  show('<div class="band"><div class="wrap hero">'+
    '<div class="toprow"><span class="logo-badge">'+IC.cards.replace('class="line"','class="line"')+'</span></div>'+
    '<h1>Vocab Trainer</h1><p class="sub">English words with Uzbek meanings, day by day. Sign in to save your stars and progress.</p></div></div>'+
    '<div class="wrap main"><form id="lf" class="stack" novalidate>'+
    '<div class="field-s"><label for="nm">Your name</label><input id="nm" name="name" autocomplete="name" placeholder="e.g. Aziza Karimova" maxlength="60"></div>'+
    '<div class="field-s"><label for="em">Your email</label><input id="em" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="name@example.com"></div>'+
    (CFG.needsCode?'<div class="field-s"><label for="cc">Class code</label><input id="cc" name="code" autocomplete="off" autocapitalize="off" placeholder="Ask your teacher"></div>':'')+
    '<div class="err" id="lerr" role="alert">'+esc(msg||'')+'</div>'+
    '<button class="cta" type="submit" id="lgo">Start learning'+IC.next+'</button>'+
    '<p class="note-s">Your teacher can see your email and progress.</p></form></div>','login');
  var f=document.getElementById('lf');
  f.addEventListener('submit',function(e){
    e.preventDefault();var er=document.getElementById('lerr'),btn=document.getElementById('lgo');
    var body={name:f.name.value,email:f.email.value,code:f.code?f.code.value:''};
    btn.disabled=true;er.textContent='';
    api('POST','/api/login',body).then(function(){return start()}).catch(function(x){er.textContent=x.message||'Could not sign in';btn.disabled=false});
  });
}
function start(){
  loading();
  return api('GET','/api/bootstrap').then(function(b){
    USER=b.student;DAYS=b.days;PROG=b.progress||{};RATING=b.rating;STREAK=b.streak||STREAK;hub();flush();
  });
}
function boot(){
  fetch('/api/config').then(function(r){return r.json()}).catch(function(){return {}}).then(function(c){
    CFG=c||{};
    return api('GET','/api/bootstrap').then(function(b){USER=b.student;DAYS=b.days;PROG=b.progress||{};RATING=b.rating;STREAK=b.streak||STREAK;hub();flush()})
      .catch(function(e){if(e.message!=='auth'&&e.status!==401){login('Could not reach the server. Check your connection.')}});
  });
}

/* ---------- events ---------- */
function openModal(){
  app.insertAdjacentHTML('beforeend','<div class="modal" id="modal"><div class="dialog" role="dialog" aria-modal="true" aria-label="Leave session"><h3>Leave this session?</h3><p>Your answers in this round will be lost.</p>'+
    '<button class="cta" data-act="stay">Keep going</button><button class="cta alt" data-act="leave">Leave</button></div></div>');
}
app.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b||b.disabled)return;
  var a=b.dataset.act,s=Number(b.dataset.s);
  switch(a){
    case 'home':dayHome();break;
    case 'hub':hub();break;
    case 'lbmode':LBMODE=b.dataset.m;lbRender();break;
    case 'lbscope':LBSCOPE=b.dataset.sc==='all'?'all':'week';try{sessionStorage.setItem('bv-lbscope',LBSCOPE)}catch(e){}LB=null;lbRender();lbLoad();break;
    case 'skin':setSkin(SKIN==='navy'?'classic':'navy');hub();break;
    case 'hubtab':setHubTab(b.dataset.t);break;
    case 'rate':doRate(Number(b.dataset.v));break;
    case 'logout':api('POST','/api/logout',{}).catch(function(){}).then(function(){USER=null;PROG={};login()});break;
    case 'openday':openDay(Number(b.dataset.d));break;
    case 'open':case 'intro':intro(s);break;
    case 'study':study(s);break;
    case 'flip':ST.flip=!ST.flip;document.getElementById('fc').classList.toggle('flip',ST.flip);break;
    case 'nextcard':ST.pos=Math.min(ST.deck.length-1,ST.pos+1);card();break;
    case 'prev':ST.pos=Math.max(0,ST.pos-1);card();break;
    case 'quiz':startQuiz(SESS[s-1].idx,{id:s});break;
    case 'weak':var wl=shuffle(weakList()).slice(0,SIZE);startQuiz(wl,{id:'weak',weak:true});break;
    case 'pick':pick(Number(b.dataset.k));break;
    case 'skip':skip();break;
    case 'check':check();break;
    case 'chip':if(Q.bd&&!Q.bd.locked){Q.bd.ans.push(Number(b.dataset.i));drawBuild()}break;
    case 'unchip':if(Q.bd&&!Q.bd.locked){var i=Q.bd.ans.indexOf(Number(b.dataset.i));if(i>-1)Q.bd.ans.splice(i,1);drawBuild()}break;
    case 'cont':cont();break;
    case 'quit':openModal();break;
    case 'stay':var m=document.getElementById('modal');if(m)m.remove();break;
    case 'leave':dayHome();break;
    case 'fix':startFix();break;
    case 'sound':save.sound=!save.sound;try{localStorage.setItem('bv-sound',save.sound?'1':'0')}catch(e){}if(save.sound)sfx.ok();dayHome();break;
    case 'reset':
      if(b.dataset.armed){save={sessions:{},xp:0,weak:{},sound:save.sound};persist();dayHome()}
      else{b.dataset.armed='1';b.textContent='Tap again to erase all progress'}
      break;
  }
});
document.addEventListener('keydown',function(e){
  if(view==='quiz'&&Q){
    if(Q.answered){if(e.key==='Enter'){e.preventDefault();cont()}return}
    var q=Q.cur&&Q.cur.q;
    if(q&&q.opts){var k='1234'.indexOf(e.key);if(k<0)k='abcd'.indexOf(e.key.toLowerCase());if(k>-1&&k<q.opts.length)pick(k)}
    if(q&&q.type==='type'&&e.key==='Enter'){e.preventDefault();check()}
  }else if(view==='study'&&ST){
    if(e.key==='ArrowRight'&&ST.pos<ST.deck.length-1){ST.pos++;card()}
    else if(e.key==='ArrowLeft'&&ST.pos>0){ST.pos--;card()}
    else if(e.key===' '||e.key==='Enter'){if(document.activeElement&&document.activeElement.id==='fc'){e.preventDefault();ST.flip=!ST.flip;document.getElementById('fc').classList.toggle('flip',ST.flip)}}
  }
});
var tx=null;
app.addEventListener('touchstart',function(e){tx=view==='study'?e.touches[0].clientX:null},{passive:true});
app.addEventListener('touchend',function(e){
  if(tx===null||!ST)return;var dx=e.changedTouches[0].clientX-tx;tx=null;
  if(Math.abs(dx)<60)return;
  if(dx<0&&ST.pos<ST.deck.length-1){ST.pos++;card()}else if(dx>0&&ST.pos>0){ST.pos--;card()}
},{passive:true});

boot();
})();
