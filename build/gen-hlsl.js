import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

import {convert, inactiveRanges} from './lib/glsl2hlsl.js';

const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const artDir = path.join(repoRoot, 'art');

const usage = `
usage: npm run gen-hlsl -- [options]

  Writes art/<id>/art.hlsl next to art.json for every art by a given author,
  translating the embedded GLSL ES 1.00 vertex shader to HLSL.

options:
  --author=<name>   whose art to convert (default gman)
  --id=<artId>      just this one, repeatable
  --dry-run         report without writing
  --verbose         list every warning, not just a summary
`;

/** Things that would mean the translation didn't finish. */
function lint(hlsl) {
  const problems = [];
  const leftovers = [
    [/\bvec[234]\s*[(\w]/, 'vec2/3/4 left in output'],
    [/\bmat[234]\s*[(\w]/, 'mat2/3/4 left in output'],
    [/\btexture2D\s*\(/, 'texture2D left in output'],
    [/\bmix\s*\(/, 'mix( left in output'],
    [/\bfract\s*\(/, 'fract( left in output'],
    [/\binversesqrt\s*\(/, 'inversesqrt( left in output'],
    [/(?<!glsl)\bmod\s*\(/, 'mod( left in output'],
    [/\battribute\b|\bvarying\b/, 'attribute/varying left in output'],
    [/\bgl_FragColor\b/, 'gl_FragColor in a vertex shader'],
  ];
  // Strip comments so the header's prose doesn't trip the scan, and strip
  // preprocessor-dead blocks and directives: `#if 0 } else {` is legitimately
  // unbalanced as text, and a #define body can hold a stray brace.
  const blanked = [...inactiveRanges(hlsl)].reduce(
    (s, [a, b]) => s.slice(0, a) + ' '.repeat(b - a) + s.slice(b), hlsl);
  const code = blanked
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/^[ \t]*#[^\n\\]*(?:\\\n[^\n\\]*)*/gm, '');
  for (const [re, msg] of leftovers) {
    if (re.test(code)) { problems.push(msg); }
  }
  let depth = 0;
  for (const c of code) {
    if (c === '{') { ++depth; }
    if (c === '}') { --depth; }
    if (depth < 0) { break; }
  }
  if (depth !== 0) { problems.push(`unbalanced braces (${depth})`); }
  for (const [open, close, what] of [['(', ')', 'parens'], ['[', ']', 'brackets']]) {
    let d = 0;
    for (const c of code) {
      if (c === open) { ++d; }
      if (c === close) { --d; }
    }
    if (d !== 0) { problems.push(`unbalanced ${what} (${d})`); }
  }
  if (!/\bvoid\s+main\s*\(/.test(code)) { problems.push('no main() to call from the entry point'); }
  return problems;
}

function main(argv) {
  const options = {author: 'gman', ids: []};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split(/=(.*)/s);
    switch (key) {
      case 'author': options.author = value; break;
      case 'id': options.ids.push(value); break;
      case 'dry-run': options.dryRun = true; break;
      case 'verbose': options.verbose = true; break;
      case 'help': console.log(usage); return;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }

  const ids = options.ids.length ? options.ids : fs.readdirSync(artDir).sort();
  const results = {converted: [], failed: [], warned: [], skipped: 0};

  for (const id of ids) {
    const jsonPath = path.join(artDir, id, 'art.json');
    if (!fs.existsSync(jsonPath)) { continue; }
    const art = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const username = art.owner?.username ?? art.username;
    if (!options.ids.length && username !== options.author) { ++results.skipped; continue; }
    const glsl = art.settings?.shader;
    if (!glsl) { results.failed.push([id, 'no shader in art.json']); continue; }

    try {
      const {hlsl, warnings, renames} = convert(glsl, {id, name: art.name, username});
      const problems = lint(hlsl);
      if (problems.length) {
        results.failed.push([id, problems.join('; ')]);
        continue;
      }
      if (!options.dryRun) {
        fs.writeFileSync(path.join(artDir, id, 'art.hlsl'), hlsl);
      }
      results.converted.push(id);
      if (warnings.length) { results.warned.push([id, warnings]); }
      void renames;
    } catch (e) {
      results.failed.push([id, e.message]);
    }
  }

  console.log(`${options.author}: ${results.converted.length} converted, ${results.failed.length} failed`);
  for (const [id, why] of results.failed) {
    console.log(`  FAIL ${id}: ${why}`);
  }
  if (results.warned.length) {
    const counts = new Map();
    for (const [, ws] of results.warned) {
      for (const w of new Set(ws.map(w => w.replace(/ at offset \d+/, '')))) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
    console.log(`\nwarnings in ${results.warned.length} file(s):`);
    for (const [w, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, options.verbose ? 200 : 15)) {
      console.log(`  ${String(n).padStart(4)}  ${w}`);
    }
  }
  return results;
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
