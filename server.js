const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');

const PORT=process.env.PORT||3000;
const PUBLIC=path.join(__dirname,'public');
const KB=path.join(__dirname,'data','knowledge.json');
const ADMIN_PIN=process.env.ADMIN_PIN||'change-me';

const readKB=()=>JSON.parse(fs.readFileSync(KB,'utf8'));
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const parse=req=>new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1024*1024)reject(new Error('too_large'));});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}});req.on('error',reject);});
const norm=s=>String(s||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^\u0600-\u06FFa-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();

function localAnswer(message,kb){
  const q=norm(message);
  let best=null,score=0;
  for(const item of kb.facts||[]){
    let s=0;
    for(const k of item.keywords||[]) if(q.includes(norm(k))) s+=norm(k).length;
    if(s>score){score=s;best=item;}
  }
  return best?best.answer:kb.fallback;
}

function auth(req){
  const a=Buffer.from(String(req.headers['x-admin-pin']||''));
  const b=Buffer.from(String(ADMIN_PIN));
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

function serve(req,res){
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  if(p==='/admin') p='/admin.html';
  const f=path.normalize(path.join(PUBLIC,p));
  if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return false;
  const ext=path.extname(f);
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'});
  fs.createReadStream(f).pipe(res);
  return true;
}

http.createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url.startsWith('/health')) return send(res,200,{ok:true,service:'ann-ai'});
    if(req.method==='GET'&&req.url.startsWith('/api/knowledge')){
      if(!auth(req)) return send(res,401,{error:'unauthorized'});
      return send(res,200,readKB());
    }
    if(req.method==='PUT'&&req.url.startsWith('/api/knowledge')){
      if(!auth(req)) return send(res,401,{error:'unauthorized'});
      const body=await parse(req);
      if(!body||typeof body!=='object'||!Array.isArray(body.facts)) return send(res,400,{error:'invalid_knowledge'});
      fs.writeFileSync(KB,JSON.stringify(body,null,2),'utf8');
      return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&req.url.startsWith('/api/chat')){
      const body=await parse(req);
      const message=String(body.message||'').slice(0,1000);
      if(!message.trim()) return send(res,400,{error:'empty_message'});
      return send(res,200,{reply:localAnswer(message,readKB())});
    }
    if(req.method==='GET'&&serve(req,res)) return;
    return send(res,404,{error:'not_found'});
  }catch(e){
    return send(res,500,{error:'server_error'});
  }
}).listen(PORT,'0.0.0.0',()=>console.log('ann-ai listening on '+PORT));
