const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');

const PORT=process.env.PORT||3000;
const PUBLIC=path.join(__dirname,'public');
const KB=path.join(__dirname,'data','knowledge.json');

const {buildPass,missingConfig}=require('./lib/pass');
const router=require('./lib/router');
const {guard}=require('./lib/admin');
const SEC=require('./lib/security');
const readKB=()=>JSON.parse(fs.readFileSync(KB,'utf8'));
const send=(res,code,obj)=>{res.writeHead(code,Object.assign({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},SEC.HEADERS));res.end(JSON.stringify(obj));};
class BadBody extends Error{constructor(code,msg){super(msg);this.status=code;}}
const parse=req=>new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>256*1024){reject(new BadBody(413,'too_large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(new BadBody(400,'bad_json'))}});req.on('error',reject);});
const norm=s=>String(s||'').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^\u0600-\u06FFa-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();

function localAnswer(message,kb){
  const q=norm(message);
  let best=null,score=0;
  for(const item of kb.facts||[]){
    let s=0;
    for(const k of item.keywords||[]) if(q.includes(norm(k))) s+=norm(k).length;
    s*=(item.weight||1);
    if(s>score){score=s;best=item;}
  }
  return best?best.answer:kb.fallback;
}


function serve(req,res){
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/') p='/index.html';
  if(p==='/admin') p='/admin.html';
  if(p==='/wallet') p='/wallet.html';
  if(p==='/order') p='/order.html';
  if(p==='/orders') p='/orders.html';
  if(p==='/account') p='/account.html';
  if(p==='/gift') p='/gift.html';
  const f=path.normalize(path.join(PUBLIC,p));
  if(!f.startsWith(PUBLIC+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) return false;
  const ext=path.extname(f);
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.avif':'image/avif','.jpg':'image/jpeg','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.webmanifest':'application/manifest+json','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
  res.writeHead(200,Object.assign({'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':(ext==='.html'||p==='/sw.js')?'no-cache':'public, max-age=3600'},SEC.HEADERS));
  fs.createReadStream(f).pipe(res);
  return true;
}

http.createServer(async(req,res)=>{
  // the socket address, for rate limits when no trusted proxy is in front (never taken from the client)
  delete req.headers['x-ann-remote'];
  req.headers['x-ann-remote']=String(req.socket.remoteAddress||'local');
  try{
    if(req.method==='GET'&&req.url.startsWith('/health')) return send(res,200,{ok:true,service:'ann-ai'});
    const u=new URL(req.url,'http://x');
    // /api/v1/<path>, or the rewritten form /api/gateway?p=<path> (Vercel may hand that to this file)
    const gw=/^\/api\/(?:gateway|app)\/?$/.test(u.pathname);
    if(u.pathname.startsWith('/api/v1/')||gw){
      const query=Object.fromEntries(u.searchParams);
      const path=gw?(query.p||''):u.pathname.slice(8);
      delete query.p;
      if(!SEC.jsonOnly(req.method,req.headers)) return send(res,415,{error:'json_only',message:'الطلب لازم يكون JSON.'});
      const body=(req.method==='GET')?{}:await parse(req);
      const r=await router.handle(req.method,path,{query,body,headers:req.headers});
      return send(res,r.status,r.body);
    }
    if(u.pathname==='/.well-known/apple-developer-merchantid-domain-association'){
      const v=process.env.APPLE_PAY_DOMAIN_ASSOCIATION||'';
      if(!v) return send(res,404,{error:'not_configured'});
      res.writeHead(200,{'Content-Type':'text/plain'});return res.end(v);
    }
    if(req.method==='GET'&&req.url.startsWith('/api/pass')){
      if(/[?&]check=1/.test(req.url)) return send(res,200,{ready:missingConfig().length===0});
      try{
        const buf=buildPass();
        res.writeHead(200,{'Content-Type':'application/vnd.apple.pkpass','Content-Disposition':'attachment; filename="ann-coffee.pkpass"','Cache-Control':'no-store'});
        return res.end(buf);
      }catch(e){
        if(e.code==='NOT_CONFIGURED') return send(res,503,{error:'wallet_not_configured'});
        return send(res,500,{error:'pass_build_failed'});
      }
    }
    if(req.url.startsWith('/api/knowledge')&&(req.method==='GET'||req.method==='PUT')){
      // same PIN check and lockout as the dashboard
      const denied=await guard(req.headers); if(denied) return send(res,denied.status,denied.body);
      if(req.method==='GET') return send(res,200,readKB());
      if(!SEC.jsonOnly(req.method,req.headers)) return send(res,415,{error:'json_only'});
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
    if(e instanceof BadBody) return send(res,e.status,{error:e.message,message:'بيانات الطلب غير صحيحة.'});
    return send(res,500,{error:'server_error'});
  }
}).listen(PORT,'0.0.0.0',()=>console.log('ann-ai listening on '+PORT));
