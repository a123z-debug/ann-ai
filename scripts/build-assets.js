const fs=require('fs');
const path=require('path');
const sharp=require('sharp');

const publicDir=path.join(process.cwd(),'public');
const partsDir=path.join(publicDir,'mobile-parts');
const annMobile=path.join(publicDir,'ann-mobile.webp');

// Clean (text-free) crops cut from the master poster.
const crops=[
  {file:'scene-wide.webp',left:0,top:1050,width:2048,height:1600,quality:86,resize:1800},
  {file:'scene-cup.webp',left:0,top:1930,width:1000,height:710,quality:88},
  {file:'scene-door.webp',left:620,top:1650,width:880,height:850,quality:88},
  {file:'scene-tall.webp',left:0,top:1180,width:1320,height:1500,quality:84,resize:1000}
];

async function build(){
  const parts=fs.readdirSync(partsDir).filter(f=>f.endsWith('.txt')).sort();
  const b64=parts.map(f=>fs.readFileSync(path.join(partsDir,f),'utf8').trim()).join('');
  fs.writeFileSync(annMobile,Buffer.from(b64,'base64'));

  const meta=await sharp(annMobile).metadata();
  if(meta.width!==2048 || meta.height!==3072){
    throw new Error('Unexpected ann-mobile dimensions: '+meta.width+'x'+meta.height);
  }

  for(const c of crops){
    let img=sharp(annMobile).extract({left:c.left,top:c.top,width:c.width,height:c.height});
    if(c.resize) img=img.resize({width:c.resize});
    await img.webp({quality:c.quality}).toFile(path.join(publicDir,c.file));
  }

  console.log('ANN assets ready:',meta.width+'x'+meta.height,'+',crops.length,'crops');
}

build().catch(err=>{console.error(err);process.exit(1);});
