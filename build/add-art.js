import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

import {genToc} from './gen-toc.js';
import {makeArtHTML} from './lib/art-template.js';
import {makeImageId, makeUnusedArtId} from './lib/ids.js';
import {decodeSettingsParam} from './lib/lzma.js';
import {screenshotArt} from './lib/screenshot.js';

const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const artDir = path.join(repoRoot, 'art');
const imagesDir = path.join(repoRoot, 'data', 'images');

const usage = `
usage: npm run add-art -- <url> [options]

  <url>  either

           a github issue comment,
             https://github.com/greggman/vertexshaderart.com/issues/1#issuecomment-5248670514
           in which case the art links, the name and the author are taken from
           the comment,

           or a vertexshaderart link,
             https://www.vertexshaderart.com/src/#s=XQAAA...
           in which case you need to pass --author and probably --name

options:
  --name=<name>      name for the art (default: the link's text in the comment)
  --author=<login>   github username to credit
  --index=<n>        which link to use if the comment has more than one
  --all              add every link in the comment
  --seconds=<n>      how long to let the art run before the screenshot (default 30)
  --quality=<n>      jpeg quality 0..1 for the thumbnail (default 0.8)
  --no-screenshot    skip the screenshot (art gets no thumbnail)
  --no-toc           don't regenerate toc.json
  --headful          run the browser visibly, useful when things go wrong
  --verbose          show the browser's console
  --force            add even if this comment was already added
  --dry-run          print what would happen, write nothing
`;

function parseArgs(argv) {
  const options = {
    seconds: 30,
    quality: 0.8,
    screenshot: true,
    toc: true,
    headless: true,
  };
  const positional = [];
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, value] = arg.substring(2).split(/=(.*)/s);
    switch (key) {
      case 'name': options.name = value; break;
      case 'author': options.author = value; break;
      case 'index': options.index = parseInt(value); break;
      case 'all': options.all = true; break;
      case 'seconds': options.seconds = parseFloat(value); break;
      case 'quality': options.quality = parseFloat(value); break;
      case 'no-screenshot': options.screenshot = false; break;
      case 'no-toc': options.toc = false; break;
      case 'headful': options.headless = false; break;
      case 'verbose': options.verbose = true; break;
      case 'force': options.force = true; break;
      case 'dry-run': options.dryRun = true; break;
      case 'help': options.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  options.url = positional[0];
  return options;
}

const commentRE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/\d+#issuecomment-(\d+)$/;

// set GITHUB_TOKEN if you run into the 60 requests an hour anonymous rate limit
function githubFetch(path) {
  const headers = {accept: 'application/vnd.github+json'};
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return fetch(`https://api.github.com/${path}`, {headers});
}

async function fetchComment(commentURL) {
  const m = commentRE.exec(commentURL);
  if (!m) {
    throw new Error(`not a github issue comment url: ${commentURL}`);
  }
  const [, owner, repo, id] = m;
  const res = await githubFetch(`repos/${owner}/${repo}/issues/comments/${id}`);
  if (!res.ok) {
    throw new Error(`could not fetch comment: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function makeUser(login, githubId) {
  return {
    username: login,
    ownerId: `github-${githubId ?? login}`,
    avatarUrl: githubId ? `https://avatars.githubusercontent.com/u/${githubId}?s=200` : '',
  };
}

/** Looks up a github user so art credited to `--author` still gets an avatar */
async function fetchUser(login) {
  const res = await githubFetch(`users/${login}`);
  if (!res.ok) {
    console.warn(`  WARNING: no github user "${login}" (${res.status}), crediting them without an avatar`);
    return makeUser(login);
  }
  const user = await res.json();
  return makeUser(user.login, user.id);
}

// `[name](url)` first so we can use the link text as the art's name,
// then bare urls that weren't already picked up.
const markdownLinkRE = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const bareLinkRE = /(?<!\()\bhttps?:\/\/[^\s)<>"']+/g;

function isArtLink(link) {
  try {
    const u = new URL(link);
    return /(^|\.)vertexshaderart\.com$/.test(u.hostname) && u.hash.includes('s=');
  } catch {
    return false;
  }
}

function findArtLinks(body) {
  const links = [];
  const seen = new Set();
  for (const [, name, link] of body.matchAll(markdownLinkRE)) {
    if (isArtLink(link) && !seen.has(link)) {
      seen.add(link);
      links.push({name: name.trim() || undefined, link});
    }
  }
  for (const link of body.match(bareLinkRE) || []) {
    if (isArtLink(link) && !seen.has(link)) {
      seen.add(link);
      links.push({link});
    }
  }
  return links;
}

async function settingsFromArtLink(link) {
  const hash = new URL(link).hash.substring(1);
  const s = new URLSearchParams(hash).get('s');
  if (!s) {
    throw new Error(`no s= parameter in ${link}`);
  }
  const art = await decodeSettingsParam(s);
  if (!art?.settings?.shader) {
    throw new Error(`no shader in ${link}`);
  }
  return art.settings;
}

/**
 * Looks for art we've already added from this url so running the same command
 * twice doesn't add the same art twice.
 */
function findExisting(sourceURL) {
  const ids = [];
  for (const id of fs.readdirSync(artDir)) {
    const jsonPath = path.join(artDir, id, 'art.json');
    if (!fs.existsSync(jsonPath)) {
      continue;
    }
    const art = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (art.source === sourceURL) {
      ids.push(id);
    }
  }
  return ids;
}

function makeArt({id, name, settings, user, imageId, sourceURL, date}) {
  const avatarUrl = user.avatarUrl || '';
  return {
    _id: id,
    owner: {
      _id: user.ownerId,
      createdAt: {$date: date},
      profile: {
        name: null,
        avatarUrl,
      },
      username: user.username,
    },
    createdAt: {$date: date},
    modifiedAt: {$date: date},
    origId: null,
    name,
    notes: '',
    rank: 1,
    private: false,
    unlisted: false,
    username: user.username,
    avatarUrl,
    settings,
    screenshotURL: imageId ? `data/images/images-${imageId}-thumbnail.jpg` : '',
    hasSound: settings.sound ? true : '',
    views: 0,
    likes: 0,
    revisionId: null,
    source: sourceURL,
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help || !options.url) {
    console.log(usage);
    process.exit(options.help ? 0 : 1);
  }

  let user;
  let links;
  let sourceURL = options.url;

  if (commentRE.test(options.url)) {
    const comment = await fetchComment(options.url);
    sourceURL = comment.html_url;
    user = options.author && options.author !== comment.user.login
      ? await fetchUser(options.author)
      : makeUser(comment.user.login, comment.user.id);
    links = findArtLinks(comment.body || '');
    if (!links.length) {
      throw new Error('no vertexshaderart art links (a url with #s=...) found in that comment');
    }
    console.log(`comment by ${comment.user.login}, ${links.length} art link(s)`);
  } else {
    if (!isArtLink(options.url)) {
      throw new Error(`not a github comment url and not a vertexshaderart art url (needs #s=...): ${options.url}`);
    }
    if (!options.author) {
      throw new Error('--author=<github login> is required when adding a raw art url');
    }
    user = await fetchUser(options.author);
    links = [{link: options.url}];
  }

  if (links.length > 1 && options.index === undefined && !options.all) {
    console.log('that comment has more than one art link, pass --index=<n> or --all:');
    links.forEach((l, i) => console.log(`  --index=${i}  ${l.name || '(unnamed)'}  ${l.link.substring(0, 60)}...`));
    process.exit(1);
  }
  if (options.index !== undefined) {
    if (!links[options.index]) {
      throw new Error(`--index=${options.index} but there are only ${links.length} link(s)`);
    }
    links = [links[options.index]];
  }

  const existing = findExisting(sourceURL);
  if (existing.length && !options.force) {
    throw new Error(`already added from ${sourceURL}: ${existing.join(', ')}. Use --force to add anyway`);
  }

  const date = Date.now();
  const added = [];

  for (const {name, link} of links) {
    const settings = await settingsFromArtLink(link);
    const artName = options.name || name || 'unnamed';
    const id = makeUnusedArtId(artDir);
    const imageId = options.screenshot ? makeImageId() : '';
    const art = makeArt({id, name: artName, settings, user, imageId, sourceURL, date});

    console.log(`\n"${artName}" by ${user.username} -> art/${id}`);
    console.log(`  ${settings.num} ${settings.mode}, sound: ${settings.sound || '(none)'}`);

    if (options.dryRun) {
      console.log('  (dry run, nothing written)');
      continue;
    }

    fs.mkdirSync(path.join(artDir, id), {recursive: true});
    fs.writeFileSync(path.join(artDir, id, 'art.json'), JSON.stringify(art, null, 2));
    fs.writeFileSync(path.join(artDir, id, 'index.html'), makeArtHTML(art));

    if (options.screenshot) {
      fs.mkdirSync(imagesDir, {recursive: true});
      const outPath = path.join(imagesDir, `images-${imageId}-thumbnail.jpg`);
      await screenshotArt({
        root: repoRoot,
        artId: id,
        outPath,
        seconds: options.seconds,
        quality: options.quality,
        headless: options.headless,
        verbose: options.verbose,
      });
      console.log(`  wrote ${path.relative(repoRoot, outPath)}`);
    }

    added.push(id);
  }

  if (options.toc && !options.dryRun && added.length) {
    const {total} = genToc();
    console.log(`\ntoc.json: ${total} entries`);
  }

  if (added.length) {
    console.log(`\nadded ${added.length}: ${added.map(id => `art/${id}`).join(' ')}`);
    console.log(`preview with: npx http-server . -p 8080  then open http://localhost:8080/art/${added[0]}`);
  }
}

main(process.argv.slice(2)).catch(e => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
