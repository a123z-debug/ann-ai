const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const input = path.join(process.cwd(), 'public', 'ann-cover.webp');
const output = path.join(process.cwd(), 'public', 'hero-8k.avif');

async function build() {
  if (!fs.existsSync(input)) {
    throw new Error('Missing public/ann-cover.webp');
  }

  await sharp(input, {limitInputPixels:false})
    .resize(5120, 7680, {
      fit: 'cover',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false
    })
    .sharpen()
    .avif({
      quality: 58,
      effort: 4
    })
    .toFile(output);

  const meta = await sharp(output).metadata();
  const size = fs.statSync(output).size;
  console.log(
    'ANN hero generated:',
    meta.width + 'x' + meta.height,
    Math.round(size / 1024) + ' KB'
  );
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
