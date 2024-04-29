import {createElem as el} from './elem.js';

const tocElem = document.querySelector('#toc');
const toc = await (await fetch('toc.json')).json();

for (const {id, name, username, avatarUrl, screenshotURL} of toc) {
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

function filter(f) {
  const s = f.trim();
  for (const elem of tocElem.children) {
    const show = s
      ? elem.textContent.toLowerCase().includes(s)
      : true;
    elem.style.display = show ? '' : 'none';
  }
}

const searchElem = document.querySelector('#search input[type=text]');
searchElem.addEventListener('input', () => filter(searchElem.value));

{
  const s = new URLSearchParams(window.location.search);
  const q = s.get('q');
  if (q) {
    searchElem.value = q;
    filter(q);
  }
}