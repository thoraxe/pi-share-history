import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const readWeb = name => readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const when = value => new Date(value).toLocaleString();

// Rule 2d keeps the API order, so the payload deliberately does not sort by `updated`.
async function directory(initial) {
  let shares = initial;
  const dom = new JSDOM(readWeb('index.html').replaceAll('__BASE_PATH__', '/pi-history'), {
    url: 'https://logs.example.com/pi-history/', runScripts: 'outside-only',
  });
  const { window } = dom;
  // jsdom does not fetch the <link>, so inline the real stylesheet to keep the reveal rules observable.
  window.document.head.insertAdjacentHTML('beforeend', `<style>${readWeb('style.css')}</style>`);
  window.fetch = async () => ({ ok: true, json: async () => shares });
  window.AbortSignal = AbortSignal;
  let refresh = () => {};
  window.setInterval = callback => { refresh = callback; return 1; };
  window.scrollTo = () => {};
  window.EventSource = class { constructor() { assert.fail('The directory must not open an SSE stream'); } };
  window.eval(readWeb('app.js'));
  await tick();
  return { dom, window, setShares(next) { shares = next; }, async poll() { refresh(); await tick(); } };
}

const id = letter => letter.repeat(32);
const hour = 3600000, day = 24 * hour;

test('directory shows counts and relative times in API order', async () => {
  const now = Date.now();
  const shares = [
    { id: id('a'), title: 'Live session', updated: now - 2 * hour, live: true, count: 12 },
    { id: id('b'), title: 'Saved session', updated: now - 3 * day, live: false, count: 1 },
    { id: id('c'), title: 'Fresh saved session', updated: now - 30_000, live: false, count: 0 },
  ];
  const { dom, window } = await directory(shares);
  try {
    const document = window.document;
    const articles = [...document.querySelectorAll('#records > article')];
    // Rule 2d: the order is the order of the payload, not the order of `updated`.
    assert.deepEqual(articles.map(a => a.querySelector('a').textContent), ['Live session', 'Saved session', 'Fresh saved session']);
    assert.deepEqual(articles.map(a => a.querySelector('a').getAttribute('href')), shares.map(s => `/pi-history/s/${s.id}`));
    // Rule 2a: one record count per share, and never a query per share.
    assert.deepEqual(articles.map(a => a.querySelector('.share-count').textContent), ['12 records', '1 record', '0 records']);
    // Rule 2b: a relative time at rest.
    assert.deepEqual(articles.map(a => a.querySelector('.share-time .relative').textContent), ['2h ago', '3d ago', 'just now']);
    assert.deepEqual(articles.map(a => a.querySelector('.share-state').textContent), ['● Live', 'Saved', 'Saved']);
  } finally { dom.window.close(); }
});

test('directory keeps the absolute timestamp for hover, focus, and assistive technology', async () => {
  const now = Date.now();
  const shares = [{ id: id('a'), title: 'Saved session', updated: now - 5 * hour, live: false, count: 2 }];
  const { dom, window } = await directory(shares);
  try {
    const time = window.document.querySelector('.share-time');
    // Rule 2c: the absolute value is in the page, and the row link can take keyboard focus.
    const absolute = time.querySelector('.absolute');
    assert.equal(absolute.textContent, when(shares[0].updated));
    assert.equal(absolute.getAttribute('aria-hidden'), null);
    assert.equal(absolute.hidden, false);
    assert.equal(time.getAttribute('datetime'), new Date(shares[0].updated).toISOString());
    // The relative time is decoration, so assistive technology reads one timestamp, not two.
    assert.equal(time.querySelector('.relative').getAttribute('aria-hidden'), 'true');
    // At rest the absolute value stays in the accessibility tree: CSS hides it with opacity, never display.
    assert.notEqual(window.getComputedStyle(absolute).display, 'none');
    assert.equal(window.getComputedStyle(absolute).visibility, 'visible');
    assert.equal(window.getComputedStyle(absolute).opacity, '0');
    // Rule 2b: the absolute timestamp is not shown at rest, and the relative time is.
    assert.equal(window.getComputedStyle(time.querySelector('.relative')).opacity, '1');
    // Keyboard focus can reach the link. jsdom paints no `:focus-within`, so the reveal is asserted against
    // the rule that performs it.
    const link = window.document.querySelector('#records > article a');
    link.focus();
    assert.equal(window.document.activeElement, link);
    const css = window.document.querySelector('style').textContent;
    assert.match(css, /article:hover \.share-time \.absolute[^{]*\{[^}]*opacity: 1/);
    assert.match(css, /article:focus-within \.share-time \.relative[^{]*\{[^}]*opacity: 0/);
    assert.match(css, /article:focus-within \.share-time \.absolute[^{]*\{[^}]*opacity: 1/);
    // The width reservation is what keeps the reveal off the record count, so guard the rule itself.
    assert.match(css, /\.share-time \{ display: inline-grid/);
    assert.match(css, /\.share-time > \* \{ grid-area: 1 \/ 1/);
  } finally { dom.window.close(); }
});

// Rule 2c needs keyboard focus, so a 10 s refresh must not rebuild or detach the focused row.
test('directory reuses rows across the poll so focus survives', async () => {
  const now = Date.now();
  const other = { id: id('b'), title: 'Other saved', updated: now - 2 * hour, live: false, count: 1 };
  const saved = { id: id('a'), title: 'Saved session', updated: now - 5 * hour, live: false, count: 2 };
  const ui = await directory([other, saved]);
  try {
    const document = ui.window.document;
    let articles = [...document.querySelectorAll('#records > article')];
    const article = articles[1], link = article.querySelector('a');
    assert.equal(link.textContent, 'Saved session');
    link.focus();
    assert.equal(document.activeElement, link);
    // Rule 11c puts the newly live share first, so the poll detaches and moves the focused row itself.
    ui.setShares([{ ...saved, updated: now, live: true }, other]);
    await ui.poll();
    articles = [...document.querySelectorAll('#records > article')];
    assert.deepEqual(articles.map(a => a.querySelector('a').textContent), ['Saved session', 'Other saved']);
    assert.equal(articles[0], article);
    assert.equal(document.activeElement, link);
  } finally { ui.dom.window.close(); }
});

// Rule 4 filters on visible text, so the at-rest-hidden absolute timestamp never matches.
test('directory search ignores the hidden absolute timestamp', async () => {
  const now = Date.now();
  const shares = [{ id: id('a'), title: 'Saved session', updated: now - 5 * hour, live: false, count: 2 }];
  const { dom, window } = await directory(shares);
  try {
    const document = window.document, article = document.querySelector('#records > article');
    const search = document.getElementById('search');
    // The absolute text is unique: the visible row carries only the title, `Saved`, the relative time, and the count.
    search.value = when(shares[0].updated);
    search.dispatchEvent(new window.Event('input'));
    assert.equal(article.hidden, true);
    // A visible value still filters the row in.
    search.value = 'saved session';
    search.dispatchEvent(new window.Event('input'));
    assert.equal(article.hidden, false);
  } finally { dom.window.close(); }
});

test('directory relative time covers minutes, hours, days, months, and years', async () => {
  const now = Date.now(), minute = 60_000;
  const shares = [59_000, 5 * minute, 90 * minute, 2 * hour, 3 * day, 45 * day, 400 * day].map((elapsed, index) => ({
    id: id(String.fromCharCode(97 + index)), title: `Share ${index}`, updated: now - elapsed, live: false, count: index,
  }));
  const { dom, window } = await directory(shares);
  try {
    assert.deepEqual(
      [...window.document.querySelectorAll('.share-time .relative')].map(node => node.textContent),
      ['just now', '5m ago', '1h ago', '2h ago', '3d ago', '1mo ago', '1y ago'],
    );
  } finally { dom.window.close(); }
});
