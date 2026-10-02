const $=s=>document.querySelector(s),messages=$('#messages'),form=$('#form'),input=$('#input');
function add(text,who='user'){const w=document.createElement('div');w.className='msg '+who;w.innerHTML='<div class="bubble"></div><time>الآن</time>';w.querySelector('.bubble').textContent=text;messages.append(w);messages.scrollTop=messages.scrollHeight;}
async function send(text){text=(text||'').trim();if(!text)return;add(text,'user');input.value='';try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});const d=await r.json();add(d.reply||'تعذر الرد الآن.','bot');}catch{add('صار عندي انقطاع بسيط. جرّب مرة ثانية.','bot');}}
form.addEventListener('submit',e=>{e.preventDefault();send(input.value);});
document.querySelectorAll('.quick button').forEach(b=>b.onclick=()=>send(b.textContent));
