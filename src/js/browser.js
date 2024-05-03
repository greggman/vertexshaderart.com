import {createElem as el} from './elem.js';
import { PseudoRandom } from './random.js';

const params = new URLSearchParams(window.location.search);
const r = new PseudoRandom();
const tocElem = document.querySelector('#toc');
const toc = (await (await fetch('toc.json')).json())

const seed = parseInt((!params.has('random') && sessionStorage.getItem('seed')) || (Math.random() * 0x7FFF_FFFF));
sessionStorage.setItem('seed', seed);
r.reset(seed);

const score = art => art.rank + (art.username !== 'anon' && art.likes > 0 ? 10 : 0);
toc.forEach(v => v.rank = r.rand());
toc.sort((a, b) => score(b) - score(a));

for (const {id, name, username, likes, avatarUrl, screenshotURL} of toc) {
  const artUrl = `art/${id}`;
  tocElem.appendChild(el('div', [
    el('a', {
      className: 'thumbnail',
      style: { backgroundImage: `url(${screenshotURL}`},
      href: artUrl,
    }),
    el('div', { className: 'meta' }, [
      el('a', {href: artUrl, textContent: name}),
      el('a', {href: `?owner=${username}`, textContent: username}),
    ]),
  ]));
}

const searchElem = document.querySelector('#search input[type=text]');

function filter() {
  const s = searchElem.value.trim();
  for (const elem of tocElem.children) {
    const show = s
      ? elem.textContent.toLowerCase().includes(s)
      : true;
    elem.style.display = show ? '' : 'none';
  }
}

searchElem.addEventListener('input', filter);

{
  const q = params.get('q');
  if (q) {
    searchElem.value = q;
  }
}
filter();
