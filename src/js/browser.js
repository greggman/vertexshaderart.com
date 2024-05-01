import {createElem as el} from './elem.js';
import { PseudoRandom } from './random.js';

const r = new PseudoRandom();
const tocElem = document.querySelector('#toc');
const toc = (await (await fetch('toc.json')).json())

const seed = parseInt(sessionStorage.getItem('seed') || (Math.random() * 0x7FFF_FFFF));
sessionStorage.setItem('seed', seed);
r.reset(seed);


toc.forEach(v => v.rank = r.rand());
toc.sort((a, b) => b.rank - a.rank);

for (const {id, name, username, likes, avatarUrl, screenshotURL} of toc) {
  const artUrl = `art/${id}`;
  tocElem.appendChild(el('div', {
      dataset: {
        username,
        likes,
      },
    }, [
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
const popularElem = document.querySelector('#popular input[type=checkbox]');

function filter() {
  const s = searchElem.value.trim();
  const showAll = !popularElem.checked;
  for (const elem of tocElem.children) {
    const ok = showAll || (elem.dataset.username !== 'anon' && elem.dataset.likes > 0);
    const match = s
      ? elem.textContent.toLowerCase().includes(s)
      : true;
    elem.style.display = (ok && match) ? '' : 'none';
  }
}

searchElem.addEventListener('input', filter);
popularElem.addEventListener('change', filter)

{
  const s = new URLSearchParams(window.location.search);
  const q = s.get('q');
  if (q) {
    searchElem.value = q;
  }
}
filter();
