function safe(s) {
  return s ? String(s).replaceAll('"', '&quot;') : 'unknown';
}

/**
 * Generates the `art/<id>/index.html` wrapper page. It's only there for the
 * meta tags (title/thumbnail for link unfurls); the art itself is the iframe.
 * @param {object} art contents of art.json
 * @returns {string}
 */
export function makeArtHTML(art) {
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
    <meta name="twitter:image:src" content="${thumbnail}">

    <title>${title}</title>

    <link rel="stylesheet" href="../../style.css">
  </head>
  <body>
    <iframe src="../../src/?art=${id}"></iframe>
  </body>
</html>
`;
}
