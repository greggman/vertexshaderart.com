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
  latest() {
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
  return el('div', {dataset: {username}}, [
    el('a', {
      className: 'thumbnail',
      style: { backgroundImage: `url(${screenshotURL}`},
      href: artUrl,
    }),
    el('div', { className: 'meta' }, [
      el('a', {href: artUrl, textContent: name}),
      el('a', {href: `?owner=${encodeURIComponent(username)}`, textContent: username}),
    ]),
  ]);
}

function render() {
  tocElem.replaceChildren(...sorts[sortElem.value]().map(makeEntry));
  filter();
}

const searchElem = document.querySelector('#search input[type=text]');
const ownerElem = document.querySelector('#owner');
const ownerNameElem = document.querySelector('#ownername');

// clicking a username shows only their art. That's an exact match on the
// username, not a search for the text, so an art someone else named after
// them doesn't come along with it.
let owner = params.get('owner') || '';

function setOwner(name) {
  owner = name;
  ownerNameElem.textContent = `by: ${name}`;
  ownerElem.style.display = name ? '' : 'none';
}

function filter() {
  // lowercased, the text it's matched against is lowercased too, so without
  // this a search with any capital in it matches nothing
  const s = searchElem.value.trim().toLowerCase();
  for (const elem of tocElem.children) {
    const show = (!owner || elem.dataset.username === owner) &&
                 (!s || elem.textContent.toLowerCase().includes(s));
    elem.style.display = show ? '' : 'none';
  }
}

searchElem.addEventListener('input', filter);

document.querySelector('#clearowner').addEventListener('click', e => {
  // in page so the sort and whatever's typed in the search box survive
  e.preventDefault();
  const url = new URL(window.location.href);
  url.searchParams.delete('owner');
  history.replaceState({}, '', url);
  setOwner('');
  filter();
});

{
  const q = params.get('q');
  if (q) {
    searchElem.value = q;
  }
  setOwner(owner);
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
