# vertexshaderart.com is now a static site

## Saving

To save your work. Bookmark the URL or copy it to your blog/instagram/gist or [this github issue](https://github.com/greggman/vertexshaderart.com/issues/1) etc...

## Music Tracks

Options: 

* `random`

  chooses a random track

* `<some-url-to>.mp3`

  The mp3 file must have the correct permissions to stream. Ideally you'd pick public domain or CC0 track and add it to
  [this repo](https://github.com/greggman/music-lists.git).

* `<some-url.to>.json`

  A json file in the following format

  ```js
  {
    name?: string,    // name of track, if not provided it will be the base name of the url
    author?: string,  // name of author/artist/band
    url?: string,     // url for author's page
    infoUrl?: string, // url for info about the track 
    trackUrl?: string, // url for .mp3 file. if not provided assumes the path
                       // is the same as the .json file just with .mp3 instead
  }
  ```

## Adding art posted to the issue

When someone posts a link in [the art issue](https://github.com/greggman/vertexshaderart.com/issues/1),
add it with the url of their comment

```sh
npm install                # once, this downloads a chrome for the screenshots
npm run add-art https://github.com/greggman/vertexshaderart.com/issues/1#issuecomment-5248670514
```

That

* pulls the comment from the github api, taking the art's name from the link's
  text and the author from whoever wrote the comment
* decompresses the `#s=` part of the link into settings (same lzma + base64 the
  site uses)
* makes `art/<newRandomId>/art.json` and `art/<newRandomId>/index.html`
* runs the art in a real browser for 30 seconds with music playing so sound
  reactive shaders have history to draw, then saves the site's own 600x336
  thumbnail to `data/images/`
* regenerates `toc.json` (the gallery's index)

Useful options: `--seconds=<n>` to shoot at a different point in time,
`--name=` / `--author=` to override what came from the comment, `--index=<n>`
or `--all` when a comment has more than one link, `--dry-run` to see what it
would do, `--headful --verbose` when something goes wrong.
`npm run add-art -- --help` for the rest.

Related:

* `npm run screenshot-art <artId>` retakes one art's thumbnail, eg with a
  different `--seconds`, when the automatic one is a dud.
* `npm run gen-toc` rebuilds `toc.json` from the `art` folders, which are the
  source of truth.

## HLSL ports

`npm run gen-hlsl -- --author=<name>` writes `art/<id>/art.hlsl` next to
`art.json`, translating the embedded GLSL ES 1.00 vertex shader to HLSL
(vs_5_0). It's a source level port: same names, same structure, same comments.

The one thing that isn't a rename is matrices. GLSL is column vector
(`M * v`, `mat4()` takes columns, `m[i]` is a column) and HLSL is conventionally
row vector, so every matrix in the output holds the transpose of its GLSL
counterpart. That leaves constructors and `m[i]` indexing untouched and pushes
the whole difference into the multiplies (`M * v` becomes `mul(v, M)`), which
is why the translator carries a small type inferencer: it has to know which
`*` is a matrix multiply. Anything it can't type or parse is reported and
noted in a `// CAVEAT:` line in the generated file rather than guessed at.

## License

The site is license MIT but the individual shaders belong to their respective users.