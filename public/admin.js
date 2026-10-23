(function(){
'use strict';
var KEYN='bv-admin-key',key='',DATA=null,tab='students',sortBy='lastSeen',sortDir=-1,q='';
try{key=sessionStorage.getItem(KEYN)||''}catch(e){}
var app=document.getElementById('app');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function api(m,u,b){
  var o={method:m,headers:{'x-admin-key':key}};
  if(b!==undefined){o.headers['Content-Type']='application/json';o.body=JSON.stringify(b)}
  return fetch(u,o).then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok){var e=new Error(j.error||'Error');e.status=r.status;throw e}return j})});
}
function ago(t){if(!t)return '—';var s=(Date.now()-t)/1000;if(s<90)return 'just now';if(s<3600)return Math.round(s/60)+' min ago';if(s<86400)return Math.round(s/3600)+' h ago';return Math.round(s/86400)+' d ago'}
function dt(t){return t?new Date(t).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'—'}
function stars(n){return '<span class="stx">'+'★'.repeat(n)+'</span><span class="muted">'+'★'.repeat(Math.max(0,3-n))+'</span>'}
function head(extra){
  return '<div class="band"><div class="aw hero"><div class="toprow"><span class="pill">Teacher</span>'+(key?'<span><button class="icon ghost txt" id="out">Lock</button></span>':'')+'</div>'+
  '<h1>Dashboard</h1><p class="sub">Track your students and manage the days</p>'+(extra||'')+'</div></div>';
}
function gate(msg){
  app.innerHTML=head()+'<div class="aw" style="max-width:420px"><form id="gf" class="card" style="margin-top:20px"><div class="field-s"><label for="k">Teacher key</label><input id="k" type="password" autocomplete="current-password" placeholder="The ADMIN_KEY you set on the server"></div>'+
   '<div class="err" id="ge">'+esc(msg||'')+'</div><button class="cta" type="submit">Open dashboard</button></form></div>';
  document.getElementById('gf').onsubmit=function(e){e.preventDefault();key=document.getElementById('k').value;load()};
}
function load(){
  api('GET','/api/admin/overview').then(function(d){
    DATA=d;try{sessionStorage.setItem(KEYN,key)}catch(e){}render();
  }).catch(function(e){
    key='';try{sessionStorage.removeItem(KEYN)}catch(x){}
    gate(e.status===503?'The server has no ADMIN_KEY yet. Set it in your host settings.':e.status===429?'Too many tries. Wait a few minutes.':'Wrong key.');
  });
}
function render(){
  var t=DATA.totals;
  app.innerHTML=head()+'<div class="aw"><div class="kpis">'+
   '<div class="kpi"><b>'+t.students+'</b><span>Students</span></div><div class="kpi"><b>'+t.active7+'</b><span>Active this week</span></div>'+
   '<div class="kpi"><b>'+t.attempts+'</b><span>Quiz rounds played</span></div><div class="kpi"><b>'+(t.ratings?t.rating.toFixed(1)+' ★':'—')+'</b><span>Course rating ('+t.ratings+')</span></div></div>'+
   '<div class="tabs">'+['students','days','feedback'].map(function(x){return '<button class="tab'+(tab===x?' on':'')+'" data-tab="'+x+'">'+({students:'Students',days:'Days & words',feedback:'Feedback'})[x]+'</button>'}).join('')+'</div>'+
   '<div id="body"></div></div>';
  document.getElementById('out').onclick=function(){key='';try{sessionStorage.removeItem(KEYN)}catch(e){}gate()};
  app.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){tab=b.dataset.tab;render()}});
  if(tab==='students')students();else if(tab==='days')days();else feedback();
}
/* ---- students ---- */
var COLS=[['name','Student'],['email','Email'],['lastSeen','Last active'],['sessionsDone','Sessions'],['stars','Stars'],['avgPct','Avg %'],['xp','XP'],['weakWords','Weak'],['rating','Rating']];
function students(){
  var rows=DATA.students.filter(function(s){return !q||(s.name+' '+s.email).toLowerCase().indexOf(q)>-1});
  rows.sort(function(a,b){var x=a[sortBy],y=b[sortBy];if(x==null)x=-1;if(y==null)y=-1;if(typeof x==='string')return x.localeCompare(y)*sortDir;return (x-y)*sortDir});
  var h='<div class="tools"><input type="search" id="sq" placeholder="Search name or email" value="'+esc(q)+'"><a class="btn alt" href="#" id="e1">Export students CSV</a><a class="btn alt" href="#" id="e2">Export quiz rounds CSV</a></div>'+
   '<div class="tw"><table><thead><tr>'+COLS.map(function(c){return '<th data-s="'+c[0]+'">'+c[1]+(sortBy===c[0]?(sortDir>0?' ▲':' ▼'):'')+'</th>'}).join('')+'</tr></thead><tbody>'+
   (rows.length?rows.map(function(s){
     var pct=s.sessionsTotal?Math.round(s.sessionsDone/s.sessionsTotal*100):0;
     return '<tr class="row" data-id="'+s.id+'"><td><b>'+esc(s.name)+'</b></td><td class="muted">'+esc(s.email)+'</td><td>'+ago(s.lastSeen)+'</td>'+
      '<td class="n"><span class="pbar"><i style="width:'+pct+'%"></i></span>'+s.sessionsDone+'/'+s.sessionsTotal+'</td><td class="n"><span class="stx">★</span> '+s.stars+'</td>'+
      '<td class="n">'+(s.avgPct==null?'—':'<span class="'+(s.avgPct>=75?'good':s.avgPct<50?'warn':'')+'">'+s.avgPct+'%</span>')+'</td><td class="n">'+s.xp+'</td><td class="n">'+s.weakWords+'</td><td>'+(s.rating?'<span class="stx">'+'★'.repeat(s.rating)+'</span>':'—')+'</td></tr>';
   }).join(''):'<tr><td colspan="9" class="muted" style="padding:24px;text-align:center">No students yet. Share the website link with them.</td></tr>')+'</tbody></table></div>';
  document.getElementById('body').innerHTML=h;
  var sq=document.getElementById('sq');sq.oninput=function(){q=sq.value.toLowerCase();var p=sq.selectionStart;students();var n=document.getElementById('sq');n.focus();n.setSelectionRange(p,p)};
  document.querySelectorAll('th[data-s]').forEach(function(th){th.onclick=function(){var k=th.dataset.s;if(sortBy===k)sortDir*=-1;else{sortBy=k;sortDir=(k==='name'||k==='email')?1:-1}students()}});
  document.querySelectorAll('tr.row').forEach(function(tr){tr.onclick=function(){detail(Number(tr.dataset.id))}});
  document.getElementById('e1').onclick=function(e){e.preventDefault();dl('/api/admin/export.csv','students.csv')};
  document.getElementById('e2').onclick=function(e){e.preventDefault();dl('/api/admin/attempts.csv','quiz_rounds.csv')};
}
function dl(u,name){
  fetch(u,{headers:{'x-admin-key':key}}).then(function(r){return r.blob()}).then(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();a.remove()});
}
function detail(id){
  api('GET','/api/admin/students/'+id).then(function(d){
    var s=d.student;
    var h='<button class="btn alt back" id="bk">← All students</button><div class="card"><h2 class="s">'+esc(s.name)+'</h2><div class="muted">'+esc(s.email)+' · joined '+dt(s.created_at)+' · last active '+ago(s.last_seen)+'</div></div>';
    d.days.forEach(function(day){
      var cells='';
      for(var i=1;i<=day.sessions;i++){var r=day.progress[i];cells+='<div class="sc'+(r?'':' na')+'"><span class="muted">Session '+i+'</span><b>'+(r?r.best+'%':'—')+'</b>'+(r?stars(r.stars||0)+' <span class="muted">· '+r.plays+'×</span>':'<span class="muted">not started</span>')+'</div>'}
      h+='<div class="card"><h2 class="s">'+esc(day.badge)+' · '+esc(day.title)+' <span class="muted" style="font-weight:500;font-size:13px">· '+day.xp+' XP</span></h2><div class="grid2">'+cells+'</div>'+
        (day.weak.length?'<p class="muted" style="margin:12px 0 6px;font-size:13px">Words this student misses most</p><div>'+day.weak.map(function(w){return '<span class="pillm" title="'+esc(w.uz)+'" style="margin:0 6px 6px 0">'+esc(w.en)+' · '+w.times+'×</span>'}).join('')+'</div>':'')+'</div>';
    });
    h+='<div class="card"><h2 class="s">Recent quiz rounds</h2><div class="tw"><table><thead><tr><th>When</th><th>Day</th><th>Session</th><th>Score</th><th>Stars</th><th>XP</th><th>Time</th></tr></thead><tbody>'+
      (d.attempts.length?d.attempts.map(function(a){return '<tr><td>'+dt(a.created_at)+'</td><td>'+esc(a.badge)+'</td><td>'+(a.session==='weak'?'Weak words':a.session)+'</td><td class="n">'+a.pct+'% ('+a.correct+'/'+a.total+')</td><td>'+stars(a.stars)+'</td><td class="n">'+a.xp+'</td><td class="n">'+Math.floor(a.seconds/60)+':'+String(a.seconds%60).padStart(2,'0')+'</td></tr>'}).join(''):'<tr><td colspan="7" class="muted" style="padding:18px">No rounds yet.</td></tr>')+'</tbody></table></div></div>'+
      '<button class="btn red sm" id="dels">Delete this student and their data</button>';
    document.getElementById('body').innerHTML=h;
    document.getElementById('bk').onclick=function(){students()};
    var b=document.getElementById('dels');b.onclick=function(){
      if(!b.dataset.a){b.dataset.a='1';b.textContent='Click again to confirm delete';return}
      api('DELETE','/api/admin/students/'+id).then(load);
    };
    window.scrollTo(0,0);
  });
}
/* ---- days ---- */
function days(){
  api('GET','/api/admin/days').then(function(list){
    var h='<div class="card"><h2 class="s">Add a new day</h2><div class="frow"><input class="inp" id="nb" placeholder="Badge, e.g. Day 4"><input class="inp" id="nt" placeholder="Title, e.g. Reading Vocab"><input class="inp" id="np" placeholder="Topic (optional)"></div>'+
     '<textarea class="inp" id="nx" placeholder="Paste words, one per line:\nenglish word - uzbek meaning\n\nStart a line with # to name a topic:\n# Gardening\nlawn - maysazor"></textarea>'+
     '<p class="muted" style="font-size:12.5px;margin:8px 0">Separators that work: " - ", –, —, =, |, ; or a Tab (paste two columns from Excel). Every 25 words become one session.</p>'+
     '<button class="btn" id="add">Create day</button><div class="msg" id="am"></div></div>'+
     '<div class="card"><h2 class="s">Days</h2>'+(list.length?list.map(function(d){
       return '<div class="dl" data-id="'+d.id+'"><div class="t"><b>'+esc(d.badge)+' · '+esc(d.title)+'</b>'+(d.hidden?' <span class="pillm">hidden</span>':'')+'<div class="muted" style="font-size:12.5px">'+esc(d.topic)+(d.topic?' · ':'')+d.words+' words · '+d.sessions+' sessions</div></div>'+
        '<button class="btn alt sm" data-a="edit">Edit words</button><button class="btn alt sm" data-a="hide">'+(d.hidden?'Show to students':'Hide')+'</button><button class="btn alt sm" data-a="up">↑</button><button class="btn alt sm" data-a="down">↓</button><button class="btn red sm" data-a="del">Delete</button></div>';
     }).join(''):'<p class="muted">No days yet.</p>')+'<div id="ed"></div></div>';
    document.getElementById('body').innerHTML=h;
    document.getElementById('add').onclick=function(){
      var m=document.getElementById('am');m.className='msg';m.textContent='Saving…';
      api('POST','/api/admin/days',{badge:val('nb'),title:val('nt'),topic:val('np'),text:val('nx')}).then(function(r){
        m.className='msg good';m.textContent='Created: '+r.words+' words'+(r.skipped.length?' (skipped lines: '+r.skipped.join(', ')+')':'');setTimeout(days,900);
      }).catch(function(e){m.className='msg warn';m.textContent=e.message});
    };
    document.querySelectorAll('.dl').forEach(function(row){
      var id=Number(row.dataset.id),d=list.filter(function(x){return x.id===id})[0],idx=list.indexOf(d);
      row.querySelectorAll('[data-a]').forEach(function(b){b.onclick=function(){
        var a=b.dataset.a;
        if(a==='hide')api('PATCH','/api/admin/days/'+id,{hidden:!d.hidden}).then(days);
        else if(a==='up'||a==='down'){var o=list[idx+(a==='up'?-1:1)];if(!o)return;var s1=idx+1,s2=list.indexOf(o)+1;
          api('PATCH','/api/admin/days/'+id,{sort:s2}).then(function(){return api('PATCH','/api/admin/days/'+o.id,{sort:s1})}).then(days)}
        else if(a==='del'){if(!b.dataset.c){b.dataset.c='1';b.textContent='Confirm: deletes all progress';return}api('DELETE','/api/admin/days/'+id).then(days)}
        else if(a==='edit')api('GET','/api/admin/days/'+id+'/text').then(function(r){
          var ed=document.getElementById('ed');
          ed.innerHTML='<h2 class="s" style="margin-top:16px">Edit '+esc(d.badge)+'</h2><div class="frow"><input class="inp" id="eb" value="'+esc(d.badge)+'"><input class="inp" id="et" value="'+esc(d.title)+'"><input class="inp" id="ep" value="'+esc(d.topic)+'" placeholder="Topic"></div><textarea class="inp" id="ex"></textarea>'+
            '<p class="muted" style="font-size:12.5px;margin:8px 0">Careful: changing the order of words changes which words belong to each session, so old stars may no longer match. Adding new words at the end is safe.</p><button class="btn" id="sv">Save changes</button><div class="msg" id="em"></div>';
          document.getElementById('ex').value=r.text;ed.scrollIntoView({behavior:'smooth'});
          document.getElementById('sv').onclick=function(){var m=document.getElementById('em');
            api('PATCH','/api/admin/days/'+id,{badge:val('eb'),title:val('et'),topic:val('ep'),text:val('ex')}).then(function(r){m.className='msg good';m.textContent='Saved'+(r.skipped.length?' (skipped lines: '+r.skipped.join(', ')+')':'');setTimeout(days,800)}).catch(function(e){m.className='msg warn';m.textContent=e.message})};
        });
      }});
    });
  });
}
function val(id){return document.getElementById(id).value}
function feedback(){
  var c=DATA.comments;
  document.getElementById('body').innerHTML='<div class="card"><h2 class="s">Ratings</h2><p>'+(DATA.totals.ratings?'<b style="font-size:22px">'+DATA.totals.rating.toFixed(1)+' ★</b> from '+DATA.totals.ratings+' student'+(DATA.totals.ratings>1?'s':''):'No ratings yet.')+'</p></div>'+
   (c.length?'<div class="card"><h2 class="s">Comments</h2>'+c.map(function(x){return '<div class="dl"><div class="t"><b>'+esc(x.name)+'</b> <span class="stx">'+'★'.repeat(x.stars)+'</span><div>'+esc(x.comment)+'</div></div><span class="muted" style="font-size:12.5px">'+ago(x.updated_at)+'</span></div>'}).join('')+'</div>':'');
}
if(key)load();else gate();
})();
