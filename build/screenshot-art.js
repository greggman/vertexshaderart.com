import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

import {genToc} from './gen-toc.js';
import {makeArtHTML} from './lib/art-template.js';
import {makeImageId} from './lib/ids.js';
import {screenshotArt} from './lib/screenshot.js';

const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

const usage = `
usage: npm run screenshot-art -- <artId> [options]

  Re-takes the thumbnail for an art that's already in the repo.

options:
  --seconds=<n>   how long to let the art run first (default 30)
  --quality=<n>   jpeg quality 0..1 (default 0.8)
  --new-image     write a new image id instead of overwriting the existing jpg
  --headful       run the browser visibly
  --verbose       show the browser's console
`;

async function main(argv) {
  const options = {seconds: 30, quality: 0.8, headless: true};
  let artId;
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      artId = arg;
      continue;
    }
    const [key, value] = arg.substring(2).split(/=(.*)/s);
    switch (key) {
      case 'seconds': options.seconds = parseFloat(value); break;
      case 'quality': options.quality = parseFloat(value); break;
      case 'new-image': options.newImage = true; break;
      case 'headful': options.headless = false; break;
      case 'verbose': options.verbose = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!artId) {
    console.log(usage);
    process.exit(1);
  }

  const jsonPath = path.join(repoRoot, 'art', artId, 'art.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`no such art: art/${artId}`);
  }
  const art = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  if (options.newImage || !art.screenshotURL) {
    art.screenshotURL = `data/images/images-${makeImageId()}-thumbnail.jpg`;
    fs.writeFileSync(jsonPath, JSON.stringify(art, null, 2));
    fs.writeFileSync(path.join(repoRoot, 'art', artId, 'index.html'), makeArtHTML(art));
    genToc();
  }

  const outPath = path.join(repoRoot, art.screenshotURL);
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  console.log(`"${art.name}" by ${art.owner?.username}`);
  await screenshotArt({
    root: repoRoot,
    artId,
    outPath,
    seconds: options.seconds,
    quality: options.quality,
    headless: options.headless,
    verbose: options.verbose,
  });
  console.log(`  wrote ${art.screenshotURL}`);
}

main(process.argv.slice(2)).catch(e => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
