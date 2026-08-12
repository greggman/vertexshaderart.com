import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/**
 * Rebuilds toc.json (the index the gallery page fetches) by scanning
 * the art.json in each art folder. Everything toc.json holds also lives in the
 * art.json files, so the art folders are the source of truth.
 *
 * The order of the existing toc.json is preserved and new art is appended, so
 * adding one piece of art produces a one entry diff instead of reshuffling
 * 1300 lines. (Order doesn't matter to the site, src/js/browser.js re-sorts
 * with a random rank each visit.)
 *
 * @returns {{added: string[], removed: string[], total: number}}
 */
export function genToc() {
  const artDir = path.join(repoRoot, 'art');
  const tocPath = path.join(repoRoot, 'toc.json');

  const entries = new Map();
  for (const id of fs.readdirSync(artDir).sort()) {
    const jsonPath = path.join(artDir, id, 'art.json');
    if (!fs.existsSync(jsonPath)) {
      continue;
    }
    const art = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (art.private || art.unlisted) {
      continue;
    }
    entries.set(id, {
      id,
      name: art.name,
      username: art.owner?.username,
      avatarUrl: art.avatarUrl,
      screenshotURL: art.screenshotURL,
      rank: art.rank,
      likes: art.likes,
      views: art.views,
      // ms since epoch, for the gallery's "new" sort
      createdAt: art.createdAt?.$date ?? art.createdAt ?? 0,
    });
  }

  const oldToc = fs.existsSync(tocPath)
    ? JSON.parse(fs.readFileSync(tocPath, 'utf8'))
    : [];

  const toc = [];
  const removed = [];
  for (const old of oldToc) {
    const entry = entries.get(old.id);
    if (entry) {
      toc.push(entry);
      entries.delete(old.id);
    } else {
      removed.push(old.id);
    }
  }
  const added = [...entries.keys()];
  toc.push(...entries.values());

  fs.writeFileSync(tocPath, JSON.stringify(toc, null, 2));
  return {added, removed, total: toc.length};
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  const {added, removed, total} = genToc();
  console.log(`toc.json: ${total} entries (+${added.length} -${removed.length})`);
  for (const id of added) {
    console.log(`  + ${id}`);
  }
  for (const id of removed) {
    console.log(`  - ${id}`);
  }
}
