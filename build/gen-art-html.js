import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

import {makeArtHTML} from './lib/art-template.js';

const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/**
 * Rewrites `art/<id>/index.html` for every art from its art.json.
 *
 * These pages exist only for their meta tags (what a link to the art unfurls
 * to); the art itself is the iframe. Run this after changing the template in
 * lib/art-template.js.
 *
 * @param {boolean} [dryRun] only report what would change
 * @returns {{changed: string[], total: number}}
 */
export function genArtHTML(dryRun) {
  const artDir = path.join(repoRoot, 'art');
  const changed = [];
  let total = 0;

  for (const id of fs.readdirSync(artDir).sort()) {
    const jsonPath = path.join(artDir, id, 'art.json');
    if (!fs.existsSync(jsonPath)) {
      continue;
    }
    ++total;
    const art = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const htmlPath = path.join(artDir, id, 'index.html');
    const html = makeArtHTML(art);
    const existing = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : null;
    if (existing === html) {
      continue;
    }
    changed.push(id);
    if (!dryRun) {
      fs.writeFileSync(htmlPath, html);
    }
  }

  return {changed, total};
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  const {changed, total} = genArtHTML(dryRun);
  console.log(`${changed.length} of ${total} art pages ${dryRun ? 'would change' : 'rewritten'}`);
}
