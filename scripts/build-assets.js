const fs=require('fs');
const path=require('path');
const sharp=require('sharp');

const publicDir=path.join(process.cwd(),'public');
const partsDir=path.join(publicDir,'mobile-parts');
const annMobile=path.join(publicDir,'ann-mobile.webp');
const cleanScene=path.join(publicDir,'mobile-scene.webp');

async function build(){
  const parts=fs.readdirSync(partsDir).filter(f=>f.endsWith('.txt')).sort();
  const b64=parts.map(f=>fs.readFileSync(path.join(partsDir,f),'utf8').trim()).join('');
  fs.writeFileSync(annMobile,Buffer.from(b64,'base64'));

  const meta=await sharp(annMobile).metadata();
  if(meta.width!==2048 || meta.height!==3072){
    throw new Error('Unexpected ann-mobile dimensions: '+meta.width+'x'+meta.height);
  }

  await sharp(annMobile)
    .extract({left:0,top:1050,width:2048,height:1600})
    .webp({quality:90})
    .toFile(cleanScene);

  console.log('ANN mobile assets ready:',meta.width+'x'+meta.height);
}

build().catch(err=>{console.error(err);process.exit(1);});
