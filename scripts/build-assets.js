const fs=require('fs');
const path=require('path');
const dir=path.join(process.cwd(),'public','mobile-parts');
const out=path.join(process.cwd(),'public','ann-mobile.webp');
const parts=fs.readdirSync(dir).filter(f=>f.endsWith('.txt')).sort();
const b64=parts.map(f=>fs.readFileSync(path.join(dir,f),'utf8').trim()).join('');
fs.writeFileSync(out,Buffer.from(b64,'base64'));
console.log('ANN mobile artwork assembled:',Math.round(fs.statSync(out).size/1024)+' KB');
