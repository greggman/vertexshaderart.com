import fs from 'fs';

function fixBS(v) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; ++i) {
      v[i] = fixBS(v[i]);
    }
  } else if (v === null) {
    return null;
  } if (typeof v === 'object') {
    const keys = Object.keys(v);  
    if (keys.length === 1 && keys[0].startsWith('$number')) {
      return parseFloat(v[keys[0]]);
    }
    for (const k of keys) {
      v[k] = fixBS(v[k]);
    }
  }
  return v;
}

function loadData(name) {
  const d = JSON.parse(fs.readFileSync(name, {encoding: 'utf8'}));
  fixBS(d);
  return d;
}

const art = loadData('../../temp/vsa-backup/backup/latest/admin/art.json');

const users = Object.fromEntries(
  loadData('../../temp/vsa-backup/backup/latest/admin/users.json').map(v => [v._id, v]));


for (const u of Object.values(users)) {
  delete u.services;
  delete u.emails;
}

for (const a of art) {
  a.settings = JSON.parse(a.settings);
}

const screenshotRE = /images\/(.*?-thumbnail\..*?)$/;
for (const a of art) {
  const m = screenshotRE.exec(a.screenshotURL);
  a.screenshotURL = `data/images/images-${m[1]}`;
}

function safe(s) {
  return s ? s.replaceAll('"', '&quot;') : 'unknown';
}

function getHTML(art) {
  const title = `vertexshaderart - ${safe(art.name)} - by ${safe(art.owner?.username)}`;
  const thumbnail = `https://vertexshaderart.com/${art.screenshotURL}`;
  const url = `https://vertexshaderart.com/art/${art._id}`;
  const id = art._id;
  return `<!DOCTYPE html>
<html>
  <head>

    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">

    <meta name="description" content="vertexshaderart">
    <meta name="keywords" content="webgl glsl graphics">
    <meta name="thumbnail" content="${thumbnail}">

    <meta property="og:title" content="${title}">
    <meta property="og:type" content="website">
    <meta property="og:image" content="${thumbnail}">
    <meta property="og:description" content="vertexshadertart">
    <meta property="og:url" content="${url}">

    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:domain" content="webgpufundamentals.org">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:url" content="${url}">
    <meta name="twitter:description" content="vertexshaderart">
    <meta name="twitter:image:src" content=${thumbnail}">

    <title>${title}</title>

    <link rel="stylesheet" href="../../style.css">
  </head>
  <body>
    <iframe src="../../src/?art=${id}"
  </body>
</html>
`;
}

const toc = [];

for (const obj of art) {
  const id = obj._id;
  obj.owner = users[obj.owner] || {username: 'anon'};
  if (!obj.private) {
    fs.mkdirSync(`art/${id}`, {recursive: true});
    fs.writeFileSync(`art/${id}/art.json`, JSON.stringify(obj, null, 2));
    fs.writeFileSync(`art/${id}/index.html`, getHTML(obj));
  }
  if (!obj.private && !obj.unlisted) {
    toc.push({
      id,
      name: obj.name,
      username: obj.owner?.username,
      avatarUrl: obj.avatarUrl,
      screenshotURL: obj.screenshotURL,
      rank: obj.rank,
      likes: obj.likes,
      views: obj.views,      
    });
  }
}

fs.writeFileSync('toc.json', JSON.stringify(toc, null, 2));
