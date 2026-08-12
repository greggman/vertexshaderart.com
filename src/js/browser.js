import {createElem as el} from './elem.js';
import { PseudoRandom } from './random.js';

const params = new URLSearchParams(window.location.search);
const r = new PseudoRandom();
const tocElem = document.querySelector('#toc');
const sortElem = document.querySelector('#sort');
const toc = (await (await fetch('toc.json')).json())

const seed = parseInt((!params.has('random') && sessionStorage.getItem('seed')) || (Math.random() * 0x7FFF_FFFF));
sessionStorage.setItem('seed', seed);

function shuffle(array) {
  for (let i = array.length - 1; i > 0; --i) {
    const ndx = Math.random() * (i + 1) | 0;
    [array[i], array[ndx]] = [array[ndx], array[i]];
  }
  return array;
}

const sorts = {
  // A shuffle that holds still for the session, with art people liked
  // floated to the top.
  featured() {
    r.reset(seed);
    const score = art => art.rank + (art.username !== 'anon' && art.likes > 0 ? 10 : 0);
    toc.forEach(v => v.rank = r.rand());
    return [...toc].sort((a, b) => score(b) - score(a));
  },
  // Newest first.
  new() {
    return [...toc].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  // Actually random, a fresh order every time you pick it or reload.
  random() {
    return shuffle([...toc]);
  },
};

const defaultSort = 'featured';

function makeEntry({id, name, username, screenshotURL}) {
  const artUrl = `art/${id}`;
  return el('div', [
    el('a', {
      className: 'thumbnail',
      style: { backgroundImage: `url(${screenshotURL}`},
      href: artUrl,
    }),
    el('div', { className: 'meta' }, [
      el('a', {href: artUrl, textContent: name}),
      el('a', {href: `?owner=${username}`, textContent: username}),
    ]),
  ]);
}

function render() {
  tocElem.replaceChildren(...sorts[sortElem.value]().map(makeEntry));
  filter();
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

{
  const sort = params.get('sort') || localStorage.getItem('sort');
  sortElem.value = sorts[sort] ? sort : defaultSort;
}

sortElem.addEventListener('change', () => {
  localStorage.setItem('sort', sortElem.value);
  // so reloading and sharing the url keep the order you're looking at
  const url = new URL(window.location.href);
  url.searchParams.set('sort', sortElem.value);
  history.replaceState({}, '', url);
  render();
});

render();
