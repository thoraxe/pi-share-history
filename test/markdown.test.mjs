import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const readWeb = name => readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function browser() {
  const dom = new JSDOM(readWeb('index.html').replaceAll('__BASE_PATH__', '/pi-history'), { url: 'https://logs.example.com/pi-history/s/' + 'a'.repeat(32), runScripts: 'outside-only' });
  for (const name of ['vendor/marked.umd.js', 'vendor/purify.min.js', 'markdown.js']) dom.window.eval(readWeb(name));
  return dom;
}

test('browser renders Markdown headings, lists, links, tables, and escaped fenced code', () => {
  const dom = browser();
  try {
    const { window } = dom, output = window.document.createElement('div');
    const source = '# Heading\n\n**bold** and *italic*\n\n- one\n- two\n\n[site](https://example.com)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\n<script>alert(1)</script>\n```';
    assert.equal(window.PiMarkdown.render(output, source), true);
    assert.equal(output.querySelector('h1').textContent, 'Heading');
    assert.equal(output.querySelector('strong').textContent, 'bold');
    assert.equal(output.querySelector('em').textContent, 'italic');
    assert.equal(output.querySelectorAll('li').length, 2);
    assert.equal(output.querySelector('a').href, 'https://example.com/');
    assert.equal(output.querySelectorAll('td').length, 2);
    assert.equal(output.querySelector('pre code').textContent.trim(), '<script>alert(1)</script>');
    assert.equal(output.querySelector('script'), null);
  } finally { dom.window.close(); }
});

test('raw HTML, scripts, unsafe links, clobbering attributes, and tracking images are blocked', () => {
  const dom = browser();
  try {
    const { window } = dom, output = window.document.createElement('div');
    const attacks = [
      '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<script>alert(1)</script>',
      '<form id=records><input name=attributes></form>', '[bad](javascript:alert%281%29)',
      '[bad](data:text/html,evil)', '[bad](jav&#x61;script:alert%281%29)',
      '![tracking](https://tracker.example/pixel.png)',
    ];
    for (const source of attacks) {
      assert.equal(window.PiMarkdown.render(output, source), true);
      assert.equal(output.querySelector('script,img,svg,form,input,iframe,style'), null);
      assert.equal(output.querySelector('[onerror],[onload],[id],[name]'), null);
      for (const link of output.querySelectorAll('a[href]')) assert.doesNotMatch(link.getAttribute('href'), /^(javascript|data):/i);
    }
  } finally { dom.window.close(); }
});

test('sanitizer is a separate defense after parsing; missing or broken renderer fails closed', () => {
  const dom = browser();
  try {
    const { window } = dom, output = window.document.createElement('div');
    window.marked = { ...window.marked, Marked: class { parse() { return '<p id="records" onclick="alert(1)">safe</p><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>'; } } };
    window.eval(readWeb('markdown.js'));
    assert.equal(window.PiMarkdown.render(output, 'test'), true);
    assert.equal(output.querySelector('p').textContent, 'safe');
    assert.equal(output.querySelector('[id],[onclick],img,a[href]'), null);
    window.DOMPurify = undefined;
    assert.equal(window.PiMarkdown.render(output, 'test'), false);
    window.marked = undefined;
    window.eval(readWeb('markdown.js'));
    assert.equal(window.PiMarkdown.render(output, 'test'), false);
  } finally { dom.window.close(); }
});

async function viewer({ saved, blocked = false, missing = false } = {}) {
  const dom = browser(), { window } = dom;
  if (saved) window.localStorage.setItem('pi-share-history-markdown', saved);
  if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  if (missing) window.PiMarkdown = undefined;
  let payload = {
    title: 'Rendering test', updated: Date.now(), draft: { text: '**unsent**', expiresIn: 8000 },
    records: [
      { id: 'a', kind: 'assistant', label: 'assistant', text: '# Reply\n\n**bold**', timestamp: 1 },
      { id: 'u', kind: 'user', label: 'user', text: '*hello*', timestamp: 2 },
      { id: 't', kind: 'toolResult', label: 'bash', text: '**literal tool output**', timestamp: 3 },
    ],
  };
  let fetches = 0, source;
  window.fetch = async () => { fetches++; return { ok: true, json: async () => payload }; };
  window.AbortSignal = AbortSignal;
  window.setInterval = () => 1;
  window.scrollTo = () => {};
  window.EventSource = class {
    listeners = {};
    constructor() { source = this; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() { this.readyState = 2; }
  };
  window.eval(readWeb('app.js'));
  await tick();
  return { dom, window, get fetches() { return fetches; }, async update(records) { payload = { ...payload, records }; source.listeners.update(); await tick(); } };
}

test('Markdown defaults on, toggles existing messages locally, persists, and leaves tools/drafts plain', async () => {
  const ui = await viewer();
  try {
    const document = ui.window.document, button = document.getElementById('markdown-toggle');
    const [assistant, user, tool] = document.querySelectorAll('#records > article');
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(assistant.querySelector('.markdown-content h1').textContent, 'Reply');
    assert.equal(user.querySelector('.markdown-content em').textContent, 'hello');
    assert.equal(tool.querySelector('pre').hidden, false);
    assert.equal(tool.querySelector('pre').textContent, '**literal tool output**');
    assert.equal(tool.querySelector('.markdown-content').hidden, true);
    assert.equal(document.getElementById('draft-text').textContent, '**unsent**');
    const step = tool.querySelector('details.tool-step');
    step.open = true;
    const requests = ui.fetches;
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(assistant.querySelector('pre').hidden, false);
    assert.equal(assistant.querySelector('pre').textContent, '# Reply\n\n**bold**');
    assert.equal(assistant.querySelector('.markdown-content').hidden, true);
    assert.equal(tool.querySelector('details.tool-step').open, true);
    assert.equal(ui.fetches, requests); // No API calls or server-side rendering on toggle.
    assert.equal(ui.window.localStorage.getItem('pi-share-history-markdown'), 'off');
    button.click();
    assert.equal(assistant.querySelector('.markdown-content strong').textContent, 'bold');
    await ui.update([{ id: 'a', kind: 'assistant', text: '## Streamed update', timestamp: 1 }]);
    assert.equal(assistant.querySelector('.markdown-content h2').textContent, 'Streamed update');
  } finally { ui.dom.window.close(); }
});

test('saved plain-text preference, blocked storage, and missing libraries work safely', async () => {
  for (const options of [{ saved: 'off' }, { blocked: true }, { missing: true }]) {
    const ui = await viewer(options);
    try {
      const assistant = ui.window.document.querySelector('#records > article');
      assert.equal(assistant.querySelector('pre').hidden, Boolean(options.blocked));
      ui.window.document.getElementById('markdown-toggle').click();
      assert.notEqual(ui.window.document.getElementById('status').textContent, 'Connecting…');
    } finally { ui.dom.window.close(); }
  }
});

// Read/Advanced modes, record roles, tool groups, and metadata.
const at = Date.UTC(2024, 0, 1);
const advancedKey = 'pi-share-history-advanced';
const rec = (id, kind, extra = {}) => ({ id, kind, label: extra.label ?? kind, text: extra.text ?? id, timestamp: at + (extra.timestamp ?? 0), ...extra });
// The records carry the labels the extension builds: a tool event names its tool, and a bash-execution
// message has no tool name, so its label falls back to the role and repeats the kind.
const toolRecords = () => [
  rec('t1', 'tool', { label: 'read', status: 'done', timestamp: 1 }),
  rec('t2', 'tool', { label: 'edit', status: 'done', timestamp: 2 }),
  rec('r1', 'toolResult', { label: 'bash', timestamp: 3 }),
  rec('b1', 'bashExecution', { timestamp: 4 }),
];

async function modeViewer({ records = [], savedAdvanced, blocked = false, markdown = false, draft, live = false, landAway = false, defer = false } = {}) {
  const dom = new JSDOM(readWeb('index.html').replaceAll('__BASE_PATH__', '/pi-history'), {
    url: `https://logs.example.com/pi-history/s/${'a'.repeat(32)}`, runScripts: 'outside-only',
  });
  const { window } = dom;
  // jsdom does not fetch the <link>, so inline the real stylesheet to keep computed styles observable.
  window.document.head.insertAdjacentHTML('beforeend', `<style>${readWeb('style.css')}</style>`);
  if (markdown) for (const name of ['vendor/marked.umd.js', 'vendor/purify.min.js', 'markdown.js']) window.eval(readWeb(name));
  if (savedAdvanced) window.localStorage.setItem(advancedKey, savedAdvanced);
  if (blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
  let payload = { title: 'Viewer test', updated: at, live, records, ...(draft ? { draft } : {}) }, source, fetches = 0, scrolls = 0, failStatus = 0;
  // A deferred fetch holds each response until the test releases it, so a payload can resolve after a clear.
  const waiting = [];
  window.fetch = async () => {
    fetches++;
    if (defer) await new Promise(resolve => waiting.push(resolve));
    return failStatus ? { ok: false, status: failStatus } : { ok: true, json: async () => payload };
  };
  window.AbortSignal = AbortSignal;
  window.setInterval = () => 1;
  window.setTimeout = () => 1;
  window.scrollTo = () => { scrolls++; };
  window.EventSource = class {
    listeners = {};
    constructor() { source = this; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() { this.readyState = 2; }
  };
  window.eval(readWeb('app.js'));
  // A restored scroll position turns follow-live off, so the first payload paints while the reader is away.
  if (landAway) awayFromBottom(window);
  await tick();
  return {
    dom, window,
    get fetches() { return fetches; },
    get scrolls() { return scrolls; },
    get source() { return source; },
    async update(records) {
      payload = { ...payload, records };
      source?.listeners.update();
      await tick();
    },
    // The next re-fetch fails with `status`, so a mid-session HTTP error is reachable from a test.
    async failure(status) {
      failStatus = status;
      source?.listeners.update();
      await tick();
    },
    // Release every held response, so a refresh that started earlier resolves now.
    async release() {
      waiting.splice(0).forEach(resolve => resolve());
      await tick();
    },
  };
}

const articles = window => [...window.document.querySelectorAll('#records > article')];
const toggle = window => window.document.getElementById('advanced-toggle');
const pill = window => window.document.getElementById('activity');
const announcement = window => window.document.getElementById('activity-live');
// jsdom lays nothing out, so a live-update test states the numbers that rule 7 measures.
const placeReader = (window, scrollY) => {
  Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
  Object.defineProperty(window.document.body, 'scrollHeight', { value: 5000, configurable: true });
  window.dispatchEvent(new window.Event('scroll'));
};
const awayFromBottom = window => placeReader(window, 0);
const atBottom = window => placeReader(window, 4500);
const styleRules = () => [...new JSDOM(`<style>${readWeb('style.css')}</style>`).window.document.styleSheets[0].cssRules]
  .flatMap(rule => rule.style ? [rule] : rule.cssRules ? [...rule.cssRules] : [])
  .filter(rule => rule.selectorText);
// A rule's declared values, so a themed border or background is asserted on the rule, not on a rendered box.
const declaredValues = selector => styleRules().filter(rule => rule.selectorText.includes(selector))
  .flatMap(rule => [...rule.style].map(name => rule.style.getPropertyValue(name))).join(' ');
// The values on one exact selector, so a renamed rule cannot satisfy an assertion by substring.
// The values of the top-level rules that mark an attribute. A descendant rule (which contains a space)
// is excluded, and a renamed rule still qualifies, so the check does not pin a selector string.
const attributeRules = attribute => styleRules()
  .filter(rule => rule.selectorText.split(',').some(part => part.trim().includes(attribute) && !part.trim().includes(' ')))
  .flatMap(rule => [...rule.style].map(name => rule.style.getPropertyValue(name)));
// jsdom keeps `var()` unresolved, so a themed colour is resolved against the `:root` token before comparison.
const resolveColor = value => String(value ?? '')
  .replace(/var((--[w-]+))/g, (match, name) => token(':root', name) || match);
// jsdom paints no pseudo-class, so a hover or focus reveal is asserted against the rule that performs it.
const revealsMeta = pseudo => styleRules().some(rule => /\[data-mode="read"\].*\.meta/.test(rule.selectorText)
  && rule.selectorText.includes(pseudo) && rule.style.getPropertyValue('opacity').trim() === '1');
// jsdom applies no media query either, so a reduced-motion rule is asserted inside its own block.
const reducedMotionRules = () => [...new JSDOM(`<style>${readWeb('style.css')}</style>`).window.document.styleSheets[0].cssRules]
  .filter(rule => rule.media && /prefers-reduced-motion/.test(rule.media.mediaText))
  .flatMap(rule => [...rule.cssRules]);
// jsdom resolves `var()` to nothing, so a themed token only shows up as a use in the stylesheet.
const usedProperties = () => new Set(styleRules().flatMap(rule => [...rule.style]
  .flatMap(name => [...String(rule.style.getPropertyValue(name)).matchAll(/var\((--[\w-]+)/g)].map(match => match[1]))));
const customProperties = selectorText => {
  const rule = styleRules().find(rule => rule.selectorText === selectorText);
  return rule ? [...rule.style].filter(name => name.startsWith('--')).sort() : [];
};
const token = (selectorText, name) => styleRules().find(rule => rule.selectorText === selectorText)?.style.getPropertyValue(name).trim();
// WCAG relative luminance and contrast ratio, so a tint is measured rather than compared as a string.
const luminance = value => {
  const [red, green, blue] = value.replace('#', '').match(/../g)
    .map(pair => parseInt(pair, 16) / 255)
    .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrast = (first, second) => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
};

test('Read mode is the default and hides tool activity, summaries, and metadata records (7a, 7b, 7c, 7e)', async () => {
  const ui = await modeViewer({ records: [
    rec('u1', 'user', { timestamp: 0 }),
    ...toolRecords(),
    rec('a1', 'assistant', { text: 'reply', timestamp: 5 }),
    rec('s1', 'branchSummary', { text: 'summary', timestamp: 6 }),
    rec('c1', 'custom', { label: 'my-custom-type', text: 'custom body', timestamp: 8 }),
    rec('n1', 'notice', { label: 'branch', text: 'notice', timestamp: 7 }),
  ] });
  try {
    const { window } = ui, document = window.document;
    const units = articles(window);
    assert.equal(units.length, 6);
    assert.equal(document.documentElement.dataset.mode, 'read');
    assert.deepEqual(units.filter(node => !node.hidden).map(node => node.dataset.kind ?? 'group'), ['user', 'assistant', 'notice']);
    assert.deepEqual(units.filter(node => node.hidden).map(node => node.dataset.kind ?? 'group'), ['group', 'branchSummary', 'custom']);
    assert.equal(window.localStorage.getItem(advancedKey), null);

    const before = { fetches: ui.fetches, scrolls: ui.scrolls, nodes: units };
    toggle(window).click();
    assert.equal(document.documentElement.dataset.mode, 'advanced');
    for (const node of units) assert.equal(node.hidden, false);
    assert.equal(ui.fetches, before.fetches);                       // A mode change does not fetch again.
    assert.equal(ui.scrolls, before.scrolls);                       // A mode change keeps the scroll position.
    assert.deepEqual(articles(window), before.nodes);               // A mode change keeps every node in the DOM.
    assert.equal(window.localStorage.getItem(advancedKey), 'on');

    toggle(window).click();
    assert.equal(document.documentElement.dataset.mode, 'read');
    assert.equal(window.localStorage.getItem(advancedKey), null);
    assert.deepEqual(units.filter(node => !node.hidden).map(node => node.dataset.kind ?? 'group'), ['user', 'assistant', 'notice']);
  } finally { ui.dom.window.close(); }
});

test('follow-live scrolls to the newest record, stops after a scroll away, and resumes on the button (7)', async () => {
  const ui = await modeViewer({ records: [rec('a1', 'assistant', { text: 'start', timestamp: 0 })] });
  try {
    const { window } = ui, document = window.document, follow = document.getElementById('follow');
    assert.equal(follow.hidden, false);
    assert.ok(ui.scrolls > 0, 'the first paint must scroll to the newest record');   // 7: on by default.

    // A reader who scrolled away from the bottom stops the follow, so a live append leaves the scroll position.
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    Object.defineProperty(window.document.body, 'scrollHeight', { value: 5000, configurable: true });
    window.dispatchEvent(new window.Event('scroll'));
    assert.equal(follow.textContent, 'Follow live');
    const away = ui.scrolls;
    await ui.update([rec('a1', 'assistant', { text: 'start', timestamp: 0 }), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    assert.equal(ui.scrolls, away);

    follow.click();
    assert.equal(follow.textContent, 'Following live');
    assert.ok(ui.scrolls > away);
    const resumed = ui.scrolls;
    await ui.update([rec('a1', 'assistant', { text: 'start', timestamp: 0 }), rec('a2', 'assistant', { text: 'more', timestamp: 1 }), rec('a3', 'assistant', { text: 'end', timestamp: 2 })]);
    assert.ok(ui.scrolls > resumed);
  } finally { ui.dom.window.close(); }
});

test('a remembered Advanced choice is applied on the next visit (7a)', async () => {
  const ui = await modeViewer({ records: [rec('t1', 'tool', { label: 'read' })], savedAdvanced: 'on' });
  try {
    assert.equal(ui.window.document.documentElement.dataset.mode, 'advanced');
    assert.equal(toggle(ui.window).textContent, 'Advanced: On');
    assert.equal(toggle(ui.window).getAttribute('aria-pressed'), 'true');
  } finally { ui.dom.window.close(); }
});

test('errors stay visible in Read mode and in Advanced mode (7d)', async () => {
  const ui = await modeViewer({ records: [
    rec('a1', 'assistant', { text: 'ok', timestamp: 0 }),
    rec('e1', 'tool', { label: 'bash', error: true, errorMessage: 'exit 1', status: 'error', timestamp: 1 }),
    rec('e2', 'assistant', { error: true, errorMessage: 'provider failed', text: 'bad', timestamp: 2 }),
  ] });
  try {
    const { window } = ui, document = window.document;
    const failedTool = document.querySelector('.tool-group');
    const failedReply = document.querySelector('article[data-kind="assistant"][data-error="true"]');
    assert.ok(failedTool); assert.ok(failedReply);
    assert.match(failedReply.querySelector('pre').textContent, /provider failed/);  // 6: the message shows with the text.
    // 6, 7g: an error is marked distinctly, so its rule must keep the error tokens.
    assert.match(attributeRules('[data-error="true"]').join(' '), /var\(--error\)/);
    assert.ok(attributeRules('[data-error="true"]').length >= 2);   // One rule for a record, one for a step.
    assert.equal(failedTool.hidden, false);
    assert.equal(failedReply.hidden, false);
    toggle(window).click();
    assert.equal(failedTool.hidden, false);
    assert.equal(failedReply.hidden, false);
    toggle(window).click();
    assert.equal(failedTool.hidden, false);
    assert.equal(failedReply.hidden, false);
  } finally { ui.dom.window.close(); }
});

test('records expose their role and do not use kind names as headings (7f, 7g, 7h, 7i, 7j)', async () => {
  const markdown = '# Title\n\n```js\nconst a = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |';
  const ui = await modeViewer({ records: [
    rec('u1', 'user', { text: 'hello', timestamp: 0 }),
    rec('a1', 'assistant', { text: markdown, timestamp: 1 }),
    rec('n1', 'notice', { label: 'branch', text: 'notice', timestamp: 2 }),
    rec('c1', 'custom', { label: 'my-custom-type', text: 'custom body', timestamp: 5 }),
    rec('s1', 'branch_summary', { text: 'summary', timestamp: 3 }),
    rec('s2', 'compaction', { text: 'summary', timestamp: 4 }),
    ...toolRecords(),
    { id: 't9', kind: 'tool', text: 'unlabelled', timestamp: at + 9 },
    { id: 't10', kind: 'toolResult', text: 'unlabelled', timestamp: at + 10 },
  ], markdown: true });
  try {
    const { window } = ui, document = window.document;
    toggle(window).click();
    for (const kind of ['user', 'assistant', 'notice', 'branch_summary', 'compaction']) {
      assert.equal(document.querySelector(`#records > article[data-kind="${kind}"]`).dataset.kind, kind);
    }
    const steps = document.querySelectorAll('details.tool-step');
    assert.equal(steps.length, 6);
    for (const step of steps) assert.ok(['tool', 'toolResult', 'bashExecution'].includes(step.dataset.kind));

    assert.equal(document.querySelector('article[data-kind="user"] .role').textContent, 'You');
    assert.equal(document.querySelector('article[data-kind="assistant"] .role').hidden, true);

    // A label that adds information renders; a label that repeats the kind does not.
    assert.equal(document.querySelector('article[data-kind="custom"] .label').textContent, 'my-custom-type');
    assert.equal(document.querySelector('article[data-kind="custom"] .label').hidden, false);
    assert.equal(document.querySelector('article[data-kind="notice"] .label').textContent, 'branch');
    assert.equal(document.querySelector('article[data-kind="assistant"] .label').hidden, true);

    for (const label of document.querySelectorAll('#records h1, #records h2, #records h3, #records summary')) {
      assert.doesNotMatch(label.textContent.trim(), /^(user|assistant|notice|custom|tool|toolResult|bashExecution|compaction|branch_summary|branchSummary|compactionSummary)$/i);
      assert.notEqual(label.textContent.trim(), 'Content / output');
    }
    // A record without a label must not fall back to its raw kind name.
    const names = [...document.querySelectorAll('.tool-step-label')].map(node => node.textContent.split(' · ')[0]);
    assert.equal(names.filter(name => name === 'Tool').length, 2);   // Two unlabelled records use the neutral name.
    for (const name of names) assert.doesNotMatch(name, /^(tool|toolResult|bashExecution)$/);

    // 7g, 7h: compare the rendered styles of the roles, not the text of the stylesheet.
    const styleOf = kind => window.getComputedStyle(document.querySelector(`article[data-kind="${kind}"]`));
    const colorOf = kind => styleOf(kind).color;
    const backgroundOf = kind => styleOf(kind).getPropertyValue('background');
    // A prompt tint must differ from a plain reply; the token names are resolved, so a restyle still passes.
    const resolvedBackground = kind => resolveColor(backgroundOf(kind));
    assert.notEqual(resolvedBackground('user'), resolvedBackground('assistant'));
    assert.ok(resolvedBackground('user'));                        // A prompt is tinted;
    assert.ok(resolvedBackground('assistant'));                   // a reply is plain prose.
    assert.equal(colorOf('user'), colorOf('assistant'));                // The tint must not change the text colour.
    assert.notEqual(colorOf('branch_summary'), colorOf('assistant'));   // A summary is subdued.
    assert.notEqual(colorOf('compaction'), colorOf('assistant'));
    assert.equal(colorOf('branch_summary'), colorOf('compaction'));
    assert.equal(styleOf('notice').borderStyle, 'dashed');              // A notice is an inline, dashed callout.
    assert.notEqual(styleOf('notice').fontStyle, styleOf('branch_summary').fontStyle);

    const reply = document.querySelector('article[data-kind="assistant"]');
    assert.equal(reply.querySelector('.markdown-content h1').textContent, 'Title');
    assert.ok(reply.querySelector('.markdown-content table'));
    assert.ok(reply.querySelector('.markdown-content pre code'));
    // 7j: Markdown styles read theme tokens, so every token in use must exist in every theme block.
    const tokens = customProperties(':root');
    for (const tokenName of usedProperties()) assert.ok(tokens.includes(tokenName), `:root must define ${tokenName}`);
    assert.deepEqual(customProperties(':root[data-theme="dark"]'), tokens);
    // The OS-default dark block covers every dark-mode reader with no explicit theme.
    assert.deepEqual(customProperties(':root:not([data-theme])'), tokens);
    // 7j: a table and a code block take their border and background from those tokens, so both themes style them.
    assert.match(declaredValues('.markdown-content th'), /var\(--border\)/);    // The cell border follows the theme.
    assert.match(declaredValues('.markdown-content th'), /var\(--control\)/);   // So does the header background.
    assert.match(declaredValues('.markdown-content pre'), /var\(--control\)/);  // And the code-block background.
    // 7h: jsdom keeps `var()` unresolved, so measure the tokens: a prompt tint must separate from the card
    // surface by more than a plain card separates from the page, in every theme.
    for (const selector of [':root', ':root:not([data-theme])', ':root[data-theme="dark"]']) {
      const tint = contrast(token(selector, '--prompt'), token(selector, '--surface'));
      const card = contrast(token(selector, '--surface'), token(selector, '--background'));
      assert.ok(tint > card, `${selector}: a prompt tint (${tint.toFixed(3)}:1) must be stronger than a plain card (${card.toFixed(3)}:1)`);
    }
  } finally { ui.dom.window.close(); }
});

test('consecutive tool records form one stable row with a count and tool names (7k, 7l, 7m, 7o)', async () => {
  const ui = await modeViewer({ records: [rec('a0', 'assistant', { text: 'start', timestamp: 0 }), ...toolRecords()] });
  try {
    const { window } = ui, document = window.document;
    assert.equal(document.querySelectorAll('.tool-group').length, 1);
    let group = document.querySelector('.tool-group');
    assert.match(group.querySelector('.tool-summary').textContent, /^4 steps · read, edit, bash ×2$/);
    assert.equal(group.querySelector('.tool-row').hidden, true);

    toggle(window).click();
    assert.equal(group.querySelector('.tool-row').hidden, false);
    assert.equal(group.querySelectorAll('details.tool-step').length, 4);
    const summaries = [...group.querySelectorAll('.tool-step-label')].map(node => node.textContent);
    // Two records carry no status, so their steps must not show one (7m).
    assert.deepEqual(summaries, ['read · done', 'edit · done', 'bash', 'bash']);
    for (const step of group.querySelectorAll('details.tool-step')) assert.equal(step.open, false);

    await ui.update([rec('a0', 'assistant', { text: 'start', timestamp: 0 }), ...toolRecords(), rec('t3', 'tool', { label: 'grep', status: 'running', timestamp: 8 })]);
    assert.equal(document.querySelectorAll('.tool-group').length, 1);
    assert.equal(document.querySelector('.tool-group'), group);
    assert.equal(group.querySelectorAll('details.tool-step').length, 5);
    assert.match(group.querySelector('.tool-summary').textContent, /^5 steps · read, edit, bash ×2, grep$/);
    assert.equal(group.querySelector('.tool-step-label').textContent, 'read · done');

    await ui.update([rec('a0', 'assistant', { text: 'start', timestamp: 0 }), ...toolRecords(), rec('t3', 'tool', { label: 'grep', status: 'running', timestamp: 8 }), rec('a1', 'assistant', { text: 'end', timestamp: 9 }), rec('t4', 'tool', { label: 'read', timestamp: 10 })]);
    assert.equal(document.querySelectorAll('.tool-group').length, 2);
    assert.equal(document.querySelectorAll('.tool-group')[1].querySelectorAll('details.tool-step').length, 1);
    assert.equal(articles(window)[0].dataset.kind, 'assistant');
    assert.equal(group.querySelectorAll('details.tool-step').length, 5);
  } finally { ui.dom.window.close(); }
});

test('a step label shows the record status and never invents one (7m)', async () => {
  const ui = await modeViewer({ records: [
    rec('a1', 'assistant', { text: 'start', timestamp: 0 }),
    rec('t1', 'tool', { label: 'grep', status: 'running', timestamp: 1 }),
    rec('r1', 'toolResult', { label: 'bash', timestamp: 2 }),
    rec('r2', 'toolResult', { label: 'read', error: true, errorMessage: 'permission denied', timestamp: 3 }),
  ] });
  try {
    const { window } = ui;
    toggle(window).click();
    const labels = [...window.document.querySelectorAll('.tool-step-label')].map(node => node.textContent);
    // A toolResult message carries no status, so an error is the only marker the viewer may add.
    assert.deepEqual(labels, ['grep · running', 'bash', 'read · error']);
  } finally { ui.dom.window.close(); }
});

test('a failed step warns while the row is closed and shows one notice in Read mode (7n)', async () => {
  const ui = await modeViewer({ records: [
    rec('a1', 'assistant', { text: 'start', timestamp: 0 }),
    rec('t1', 'tool', { label: 'bash', status: 'error', error: true, errorMessage: 'exit 1: missing file', text: 'failure output', timestamp: 1 }),
  ] });
  try {
    const { window } = ui, document = window.document, group = document.querySelector('.tool-group');
    const row = group.querySelector('.tool-row'), notice = group.querySelector('.tool-failure');
    assert.equal(document.documentElement.dataset.mode, 'read');
    assert.equal(group.hidden, false);
    assert.equal(row.hidden, true);
    assert.equal(notice.hidden, false);
    assert.match(notice.textContent, /^bash failed: exit 1: missing file$/);
    assert.equal(notice.textContent.includes('\n'), false);

    // The row summary only renders in Advanced mode, so the closed-row warning is asserted where it is reachable.
    toggle(window).click();
    assert.equal(row.hidden, false);
    assert.equal(row.open, false);
    assert.match(row.querySelector('.tool-summary').textContent, /^1 step · bash · ⚠ 1 failed$/);
    assert.equal(notice.hidden, false);
  } finally { ui.dom.window.close(); }
});

test('a group never uses a label that repeats its kind as a heading (7i, 7l, 7n)', async () => {
  // The extension sets `label` to `toolName || customType || role`, so a bash-execution message carries
  // `label === kind`. The step count, the step label, and the failure notice must not show that kind name.
  const ui = await modeViewer({ records: [
    rec('a0', 'assistant', { text: 'start', timestamp: 0 }),
    rec('t1', 'tool', { label: 'bash', status: 'done', timestamp: 1 }),
    rec('r1', 'toolResult', { label: 'bash', timestamp: 2 }),
    rec('b1', 'bashExecution', { timestamp: 3 }),
    rec('b2', 'bashExecution', { status: 'error', error: true, errorMessage: 'exit 2', timestamp: 4 }),
  ] });
  try {
    const { window } = ui, document = window.document, group = document.querySelector('.tool-group');
    assert.match(group.querySelector('.tool-summary').textContent, /^4 steps · bash ×4 · ⚠ 1 failed$/);
    assert.match(group.querySelector('.tool-failure').textContent, /^bash failed: exit 2$/);
    toggle(window).click();
    const labels = [...document.querySelectorAll('.tool-step-label')].map(node => node.textContent);
    assert.deepEqual(labels, ['bash · done', 'bash', 'bash', 'bash · error']);
    for (const label of labels) assert.doesNotMatch(label, /bashExecution/);
  } finally { ui.dom.window.close(); }
});

test('metadata stays in the accessibility tree, is reachable by keyboard, and reveals without a layout change (7p, 7q, 7r)', async () => {
  const ui = await modeViewer({ records: [rec('u1', 'user', { model: 'test-model', status: 'done', timestamp: 0 })] });
  try {
    const { window } = ui, document = window.document;
    const article = document.querySelector('#records > article'), meta = article.querySelector('.meta');
    assert.equal(meta.hidden, false);
    assert.match(meta.textContent, /test-model/);
    assert.match(meta.textContent, /done/);
    assert.equal(article.dataset.kind, 'user');
    assert.equal(document.documentElement.dataset.mode, 'read');
    assert.equal(window.getComputedStyle(meta).opacity, '0');                        // 7p: hidden at rest.

    // 7q: the record is keyboard reachable, and the stylesheet reveals the chip on hover and on focus.
    assert.equal(article.getAttribute('tabindex'), '0');
    article.focus();
    assert.equal(document.activeElement, article);
    assert.ok(article.matches(':focus-within'));
    for (const pseudo of [':hover', ':focus-within']) assert.ok(revealsMeta(pseudo), `Read mode must reveal .meta on ${pseudo}`);

    // 7r: the chip is out of flow, stays one line, and the record reserves a band that clears it, so a reveal moves nothing.
    const articleStyle = window.getComputedStyle(article), metaStyle = window.getComputedStyle(meta);
    assert.equal(metaStyle.position, 'absolute');
    assert.equal(metaStyle.whiteSpace, 'nowrap');
    assert.equal(metaStyle.textOverflow, 'ellipsis');
    // style.css states both values in rem. One line box is about 1.2em, at any viewport width.
    const band = parseFloat(metaStyle.top) + parseFloat(metaStyle.fontSize) * 1.2;
    assert.ok(parseFloat(articleStyle.paddingTop) >= band, `padding-top ${articleStyle.paddingTop} must clear the ${band}rem metadata band`);

    toggle(window).click();
    assert.equal(document.documentElement.dataset.mode, 'advanced');
    assert.equal(document.querySelector('#records .meta'), meta);
    assert.equal(meta.hidden, false);
    assert.equal(window.getComputedStyle(meta).opacity, '1');                        // 7q: Advanced always shows it.
  } finally { ui.dom.window.close(); }
});

test('a refresh reuses existing nodes, so keyboard focus survives (7e, 7o)', async () => {
  const start = () => [rec('a0', 'assistant', { text: 'start', timestamp: 0 }), ...toolRecords()];
  const ui = await modeViewer({ records: start() });
  try {
    const { window } = ui, document = window.document, records = document.getElementById('records');
    toggle(window).click();
    const step = document.querySelector('.tool-step-summary');
    step.setAttribute('tabindex', '0');
    step.focus();
    assert.equal(document.activeElement, step);

    const mutations = [];
    new window.MutationObserver(list => mutations.push(...list)).observe(records, { childList: true, subtree: true });
    await ui.update(start());
    assert.deepEqual(mutations, []);                                                 // No re-append of existing nodes.
    assert.equal(document.activeElement, step);                                      // Focus survives the refresh.

    // A live append adds one node and leaves the existing nodes in place.
    const assistant = articles(window)[0];
    mutations.length = 0;
    await ui.update([...start(), rec('a1', 'assistant', { text: 'end', timestamp: 9 })]);
    assert.deepEqual(mutations.flatMap(record => [...record.removedNodes]), []);
    assert.deepEqual(articles(window).map(node => node.dataset.kind ?? 'group'), ['assistant', 'group', 'assistant']);
    assert.equal(articles(window)[0], assistant);
    assert.equal(document.querySelectorAll('.tool-group').length, 1);
    assert.equal(document.activeElement, step);
  } finally { ui.dom.window.close(); }
});

test('Advanced mode shows the metadata of every record, including a tool step (7c, 7q)', async () => {
  const ui = await modeViewer({ records: [
    { id: 't1', kind: 'tool', label: 'bash', status: 'done', model: 'm-1', text: 'out', timestamp: at },
    { id: 's1', kind: 'branch_summary', text: 'summary', timestamp: at + 5 },
  ] });
  try {
    const { window } = ui, document = window.document;
    toggle(window).click();
    const row = document.querySelector('.tool-row'), step = document.querySelector('.tool-step');
    assert.equal(step.open, false);                                                  // The step body stays collapsed.
    row.open = true;                                                                 // A closed row renders its summary only.
    const stepMeta = step.querySelector('.meta');
    assert.equal(stepMeta.closest('summary'), step.querySelector('summary'));        // The metadata sits in the step summary.
    assert.equal(stepMeta.closest('[hidden]'), null);
    assert.equal(stepMeta.textContent, [new Date(at).toLocaleString(), 'm-1', 'done'].join(' · '));
    assert.equal(window.getComputedStyle(stepMeta).opacity, '1');
    const summaryMeta = document.querySelector('article[data-kind="branch_summary"] .meta');
    assert.equal(summaryMeta.textContent, new Date(at + 5).toLocaleString());
    assert.equal(document.querySelector('article[data-kind="branch_summary"]').hidden, false);
  } finally { ui.dom.window.close(); }
});

test('a failed group in Read mode keeps the metadata in the accessibility tree and reveals it on focus (7p, 7q, 7r)', async () => {
  const ui = await modeViewer({ records: [
    { id: 'a0', kind: 'assistant', text: 'start', timestamp: at },
    { id: 't1', kind: 'tool', label: 'bash', status: 'error', error: true, errorMessage: 'exit 1', model: 'm-1', timestamp: at + 1 },
    { id: 't2', kind: 'tool', label: 'read', status: 'done', model: 'm-2', timestamp: at + 2 },
  ] });
  try {
    const { window } = ui, document = window.document, group = document.querySelector('.tool-group');
    const meta = group.querySelector(':scope > .meta');
    assert.equal(document.documentElement.dataset.mode, 'read');
    assert.equal(group.hidden, false);                                       // 7d: a failed group shows in Read mode.
    assert.equal(group.querySelector('.tool-row').hidden, true);             // 7n: its row stays closed.
    assert.equal(meta.hidden, false);                                        // 7r: no hidden ancestor hides the chip.
    assert.equal(meta.closest('[hidden]'), null);
    // The chip describes the step that Read mode reports, and it is the only metadata Read mode can reach.
    assert.equal(meta.textContent, [new Date(at + 1).toLocaleString(), 'm-1', 'error'].join(' · '));
    assert.equal(window.getComputedStyle(meta).opacity, '0');                // 7p: hidden at rest.

    // 7q: the group is keyboard reachable, and the stylesheet reveals the chip on hover and on focus.
    assert.equal(group.getAttribute('tabindex'), '0');
    group.focus();
    assert.equal(document.activeElement, group);
    assert.ok(group.matches(':focus-within'));
    for (const pseudo of [':hover', ':focus-within']) assert.ok(revealsMeta(pseudo), `Read mode must reveal .meta on ${pseudo}`);

    // 7r: the chip is out of flow and the group reserves a band that clears it, so a reveal moves nothing.
    const groupStyle = window.getComputedStyle(group), metaStyle = window.getComputedStyle(meta);
    assert.equal(metaStyle.position, 'absolute');
    const band = parseFloat(metaStyle.top) + parseFloat(metaStyle.fontSize) * 1.2;
    assert.ok(parseFloat(groupStyle.paddingTop) >= band, `padding-top ${groupStyle.paddingTop} must clear the ${band}rem metadata band`);

    toggle(window).click();
    assert.equal(window.getComputedStyle(meta).opacity, '1');                // 7q: Advanced always shows it.
    assert.equal(document.querySelector('.tool-group'), group);             // 7e: a mode change keeps the node.
  } finally { ui.dom.window.close(); }
});

test('search matches only the visible text in either mode (4)', async () => {
  const ui = await modeViewer({ markdown: true, records: [
    rec('a1', 'assistant', { text: 'start', timestamp: 0 }),
    rec('u1', 'user', { text: '# hello **world**', model: 'test-model', timestamp: 2 }),
    rec('t1', 'tool', { label: 'bash', status: 'error', error: true, errorMessage: 'exit 1', text: 'SECRETTOKEN in output', timestamp: 1 }),
  ] });
  try {
    const { window } = ui, document = window.document, group = document.querySelector('.tool-group');
    const record = document.querySelector('article[data-kind="user"]'), search = document.getElementById('search');
    const reply = document.querySelector('article[data-kind="assistant"]');
    const update = query => { search.value = query; search.dispatchEvent(new window.Event('input')); };
    assert.equal(document.documentElement.dataset.mode, 'read');
    update('secret');
    assert.equal(group.hidden, true);        // The collapsed step body is not visible text.
    update('bash failed');
    assert.equal(group.hidden, false);       // The failure notice is.
    update('step');
    assert.equal(group.hidden, true);        // The row summary is not visible in Read mode, so it never matches.
    update('test-model');
    assert.equal(record.hidden, true);       // The metadata is hidden at rest, so it is not visible text either.
    update('**');
    assert.equal(record.hidden, true);       // Markdown renders, so the original source is not visible text.
    update('hello');
    assert.equal(record.hidden, false);
    update('you');
    assert.equal(record.hidden, false);      // The `You` marker is visible text, so it matches.
    assert.equal(reply.hidden, true);
    update('hello');
    assert.equal(record.hidden, false);

    toggle(window).click();
    const row = group.querySelector('.tool-row'), step = group.querySelector('details.tool-step');
    update('step');
    assert.equal(group.hidden, false);       // In Advanced mode the closed row renders its summary, so it matches.
    update('secret');
    assert.equal(group.hidden, true);        // A closed disclosure renders its summary only.
    row.open = true;
    update('secret');
    assert.equal(group.hidden, true);        // The step itself is still closed.
    step.open = true;
    update('secret');
    assert.equal(group.hidden, false);       // An open step renders its body.
    update('**');
    assert.equal(record.hidden, true);       // Advanced mode does not reveal the hidden source either.
    update('test-model');
    assert.equal(record.hidden, false);      // And the metadata is always visible.
    update('you');
    assert.equal(record.hidden, false);      // The prompt marker matches in either mode.
    assert.equal(reply.hidden, true);
  } finally { ui.dom.window.close(); }
});

test('a 404, a `removed` event, and a connection error clear the page and report it (21, 22, 23)', async () => {
  const records = [rec('a1', 'assistant', { text: 'start', timestamp: 0 }), rec('u1', 'user', { text: 'hello', timestamp: 1 })];

  // 21: a 404 clears the rendered records, stops the live stream, and explains the cause.
  const missing = await modeViewer({ records });
  try {
    const { document } = missing.window;
    assert.equal(document.getElementById('records').children.length, 2);
    await missing.failure(404);
    assert.equal(document.getElementById('records').children.length, 0);
    assert.equal(missing.source.readyState, 2);   // A closed stream cannot reconnect.
    assert.match(document.getElementById('status').textContent, /deleted, revoked, or not found/);
    assert.doesNotMatch(document.getElementById('status').textContent, /reconnecting/);   // A closed stream cannot reconnect.
    assert.equal(document.title, 'Pi team history');                                          // The stale share title is gone.
    assert.equal(document.getElementById('title').textContent, '');
  } finally { missing.dom.window.close(); }

  // 22: a `removed` event clears the transcript and reports the revocation.
  const revoked = await modeViewer({ records });
  try {
    const { document } = revoked.window;
    revoked.source.listeners.removed();
    assert.equal(document.getElementById('records').children.length, 0);
    assert.equal(revoked.source.readyState, 2);
    assert.match(document.getElementById('status').textContent, /revoked or deleted/);
    assert.equal(document.title, 'Pi team history');
    assert.equal(document.getElementById('title').textContent, '');
  } finally { revoked.dom.window.close(); }

  // 23: a connection error clears the draft preview and reports the reconnection. The transcript stays.
  const interrupted = await modeViewer({ records, draft: { text: '**unsent**', expiresIn: 8000 } });
  try {
    const { document } = interrupted.window;
    assert.equal(document.getElementById('draft').hidden, false);
    interrupted.source.onerror();
    assert.equal(document.getElementById('draft').hidden, true);
    assert.match(document.getElementById('status').textContent, /Connection interrupted/);
    assert.equal(document.getElementById('records').children.length, 2);
  } finally { interrupted.dom.window.close(); }
});

test('blocked storage does not break the Advanced control (7a)', async () => {
  const ui = await modeViewer({ records: [rec('t1', 'tool', { label: 'read' })], blocked: true });
  try {
    toggle(ui.window).click();
    assert.equal(ui.window.document.documentElement.dataset.mode, 'advanced');
    toggle(ui.window).click();
    assert.equal(ui.window.document.documentElement.dataset.mode, 'read');
  } finally { ui.dom.window.close(); }
});

// Compact share state and the new-activity pill. The pill lives only on a transcript, and a reader
// starts at the bottom, so each test first takes the reader away from it.
const oneRecord = () => [rec('a1', 'assistant', { text: 'start', timestamp: 0 })];

test('the header shows the share state as a dot and a state word (1b)', async () => {
  const live = await modeViewer({ live: true, records: oneRecord() });
  try {
    assert.equal(live.window.document.getElementById('status').textContent, '● Live');
  } finally { live.dom.window.close(); }

  // A saved transcript uses the same word as the directory and the glossary term.
  const saved = await modeViewer({ live: false, records: oneRecord() });
  try {
    assert.equal(saved.window.document.getElementById('status').textContent, '● Saved');
  } finally { saved.dom.window.close(); }
});

test('the sync time is its own text next to the share state (1c)', async () => {
  const ui = await modeViewer({ live: true, records: oneRecord() });
  try {
    const { window } = ui, document = window.document;
    const state = document.getElementById('status'), sync = document.getElementById('sync');
    assert.equal(state.textContent, '● Live');
    assert.equal(sync.textContent, `Synced ${new Date(at).toLocaleString()}`);
    assert.equal(state.nextElementSibling, sync);                 // The sync time sits next to the state.
    assert.doesNotMatch(state.textContent, /Synced|2024/);         // The share state carries no time.

    // 1c: an error message replaces both parts of the header, so no stale sync time stays behind.
    await ui.failure(500);
    assert.equal(state.textContent, 'Server returned 500 — reconnecting if available');
    assert.equal(sync.textContent, '');
  } finally { ui.dom.window.close(); }
});

test('the pill appears while the reader is away from the bottom and hides at the bottom (7u)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui;
    // The first paint follows live, so the reader has seen everything and there is no pill.
    assert.equal(pill(window).hidden, true);

    awayFromBottom(window);
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    assert.equal(pill(window).hidden, false);
    assert.equal(pill(window).textContent, '1 new record');

    atBottom(window);
    assert.equal(pill(window).hidden, true);                      // Reaching the bottom hides it.

    // A refresh with no new record keeps the zero count, so the pill stays hidden.
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    assert.equal(pill(window).hidden, true);
    assert.equal(announcement(window).textContent, '');
  } finally { ui.dom.window.close(); }
});

test('showing and hiding the pill never changes the scroll position (7v)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui, document = window.document;
    // jsdom lays nothing out, so the page height is the number rule 7v holds still.
    const height = () => document.body.scrollHeight;
    awayFromBottom(window);
    const before = ui.scrolls, idle = height();
    assert.equal(pill(window).hidden, true);

    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    const node = pill(window);
    assert.equal(node.hidden, false);
    assert.equal(window.getComputedStyle(node).position, 'fixed');  // It is out of the transcript flow.
    assert.equal(node.closest('#records'), null);                 // It is not a record.
    assert.equal(node.parentElement, document.body);              // It sits outside the scrolling content.
    assert.equal(height(), idle);                                 // So the page does not grow by its box.
    assert.equal(ui.scrolls, before);                             // The pill appeared without a scroll.

    atBottom(window);
    assert.equal(pill(window).hidden, true);
    assert.equal(height(), idle);                                 // Hiding it gives nothing back either.
    assert.equal(ui.scrolls, before);                             // And it disappeared without a scroll.
  } finally { ui.dom.window.close(); }
});

test('the transcript reserves a constant bottom band, so the pill covers no text (7v, 7ac)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui, document = window.document;
    const transcript = document.getElementById('records').closest('main');
    assert.ok(transcript, 'the records must sit in the transcript container');
    const reserve = () => window.getComputedStyle(transcript).paddingBottom;
    assert.equal(pill(window).hidden, true);
    const idle = reserve();
    // The band must clear the pill: its offset from the bottom edge plus its own padding.
    const box = window.getComputedStyle(pill(window));
    const band = parseFloat(box.bottom) + parseFloat(box.paddingTop) + parseFloat(box.paddingBottom);
    assert.ok(parseFloat(idle) >= band, `the reserved band ${idle} must clear the pill band ${band}rem`);

    awayFromBottom(window);
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    assert.equal(pill(window).hidden, false);
    assert.equal(reserve(), idle);                                // The band is reserved either way.
  } finally { ui.dom.window.close(); }
});

test('the count counts the records the current mode shows and ignores the search filter (7w)', async () => {
  const arrived = () => [...oneRecord(), rec('u1', 'user', { text: 'one', timestamp: 1 }), rec('a2', 'assistant', { text: 'two', timestamp: 2 })];
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui, document = window.document, search = document.getElementById('search');
    awayFromBottom(window);
    // The search hides every record on the page. The count ignores the filter.
    search.value = 'nothing matches this';
    search.dispatchEvent(new window.Event('input'));
    assert.ok(articles(window).every(node => node.hidden));

    await ui.update([...oneRecord(), rec('u1', 'user', { text: 'one', timestamp: 1 })]);
    assert.equal(pill(window).textContent, '1 new record');

    // One count per record, not one per turn.
    await ui.update(arrived());
    assert.equal(pill(window).textContent, '2 new records');
    assert.equal(announcement(window).textContent, '2 new records');

    // A record that arrived earlier is not counted twice.
    await ui.update(arrived());
    assert.equal(pill(window).textContent, '2 new records');
  } finally { ui.dom.window.close(); }
});

test('a mode switch recomputes the count from the records that arrived (7w, 7x)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui;
    // Read mode shows the reply but hides the four tool steps, so the same arrivals count as one record.
    awayFromBottom(window);
    await ui.update([...oneRecord(), ...toolRecords(), rec('a2', 'assistant', { text: 'after', timestamp: 5 })]);
    assert.equal(pill(window).textContent, '1 new record');

    toggle(window).click();
    assert.equal(window.document.documentElement.dataset.mode, 'advanced');
    assert.equal(pill(window).textContent, '5 new records');      // Advanced shows every arrived record.
    assert.equal(pill(window).hidden, false);

    toggle(window).click();
    assert.equal(window.document.documentElement.dataset.mode, 'read');
    assert.equal(pill(window).textContent, '1 new record');       // Back to what Read mode shows.
    assert.equal(announcement(window).textContent, '1 new record');
  } finally { ui.dom.window.close(); }
});

test('the first payload is the page, not an arrival, when the reader lands away from the bottom (7w)', async () => {
  const records = [rec('a1', 'assistant', { text: 'start', timestamp: 0 }), rec('u1', 'user', { text: 'prompt', timestamp: 1 })];
  const ui = await modeViewer({ records, landAway: true });
  try {
    const { window } = ui;
    // A restored scroll position keeps follow-live off, so the page render must count none of its records.
    assert.equal(pill(window).hidden, true);
    assert.equal(pill(window).textContent, '0 new records');
    assert.equal(announcement(window).textContent, '');

    await ui.update([...records, rec('a2', 'assistant', { text: 'later', timestamp: 2 })]);
    assert.equal(pill(window).hidden, false);
    assert.equal(pill(window).textContent, '1 new record');       // A later arrival still counts.
  } finally { ui.dom.window.close(); }
});

test('the pill appears in Read mode and in Advanced mode (7x)', async () => {
  // Read mode shows prompts and replies, so a tool group that arrives adds nothing to the count.
  const read = await modeViewer({ records: oneRecord() });
  try {
    awayFromBottom(read.window);
    await read.update([...oneRecord(), ...toolRecords(), rec('u1', 'user', { text: 'prompt', timestamp: 5 })]);
    assert.equal(pill(read.window).hidden, false);
    assert.equal(pill(read.window).textContent, '1 new record');
  } finally { read.dom.window.close(); }

  // Advanced mode shows every record, so each record that arrives counts.
  const advancedUI = await modeViewer({ records: oneRecord(), savedAdvanced: 'on' });
  try {
    awayFromBottom(advancedUI.window);
    await advancedUI.update([...oneRecord(), rec('t1', 'tool', { label: 'read', timestamp: 1 }), rec('t2', 'tool', { label: 'edit', timestamp: 2 })]);
    assert.equal(pill(advancedUI.window).hidden, false);
    assert.equal(pill(advancedUI.window).textContent, '2 new records');
  } finally { advancedUI.dom.window.close(); }
});

test('one activation of the pill scrolls to the bottom and resumes follow-live (7y)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui, follow = window.document.getElementById('follow');
    awayFromBottom(window);
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    const before = ui.scrolls;

    pill(window).click();
    assert.ok(ui.scrolls > before);                               // One activation scrolls to the bottom.
    assert.equal(pill(window).hidden, true);
    assert.equal(follow.textContent, 'Following live');           // And follow-live resumed.

    const resumed = ui.scrolls;
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 }), rec('a3', 'assistant', { text: 'end', timestamp: 2 })]);
    assert.ok(ui.scrolls > resumed);                              // The next record follows live again.
  } finally { ui.dom.window.close(); }
});

test('the pill does not animate when the user requests reduced motion (7z)', () => {
  // jsdom applies no media query, so rule 7z is asserted inside its own block. A base animation is
  // not pinned here; only the override that the rule requires is.
  const reduced = reducedMotionRules().filter(rule => rule.selectorText === '#activity');
  assert.equal(reduced.length, 1);
  assert.equal(reduced[0].style.getPropertyValue('animation').trim(), 'none');
});

test('the pill is reachable and operable with the keyboard (7aa)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui;
    awayFromBottom(window);
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    const node = pill(window);
    assert.equal(node.hidden, false);
    // A native button is in the tab order without a tabindex, and Enter or Space raise a click.
    assert.equal(node.tagName, 'BUTTON');
    assert.equal(node.getAttribute('tabindex'), null);
    assert.equal(node.disabled, false);

    node.focus();
    assert.equal(window.document.activeElement, node);
    const before = ui.scrolls;
    node.click();                                                 // The activation a key press produces.
    assert.ok(ui.scrolls > before);
    assert.equal(node.hidden, true);
  } finally { ui.dom.window.close(); }
});

test('a count change is announced to assistive technology (7ab)', async () => {
  const arrived = () => [...oneRecord(), rec('u1', 'user', { text: 'one', timestamp: 1 }), rec('a2', 'assistant', { text: 'two', timestamp: 2 })];
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui, live = announcement(window);
    assert.equal(live.getAttribute('role'), 'status');
    assert.equal(live.getAttribute('aria-live'), 'polite');
    assert.equal(live.closest('[hidden]'), null);                 // The region stays in the accessibility tree.
    assert.notEqual(window.getComputedStyle(live).display, 'none');
    assert.equal(live.textContent, '');                           // Nothing to announce at first.

    awayFromBottom(window);
    await ui.update(arrived());
    assert.equal(live.textContent, '2 new records');
    await ui.update([...arrived(), rec('a3', 'assistant', { text: 'three', timestamp: 3 })]);
    assert.equal(live.textContent, '3 new records');              // The new count is announced again.

    atBottom(window);
    assert.equal(live.textContent, '');                           // The reset leaves no stale count.
  } finally { ui.dom.window.close(); }
});

test('the pill appears at the bottom of the viewport (7ac)', async () => {
  const ui = await modeViewer({ records: oneRecord() });
  try {
    const { window } = ui;
    awayFromBottom(window);
    await ui.update([...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 })]);
    const node = pill(window), style = window.getComputedStyle(node);
    assert.equal(node.hidden, false);
    assert.equal(style.position, 'fixed');                        // It does not move with the records.
    assert.equal(style.bottom, '1rem');                           // It sits at the bottom edge.
    assert.equal(node.parentElement, window.document.body);       // Outside the scrolling content.
    assert.equal(node.closest('main'), null);
  } finally { ui.dom.window.close(); }
});

test('a 404, a `removed` event, or a reconnect hides the pill and resets the count (23a)', async () => {
  const arrived = () => [...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 }), rec('u1', 'user', { text: 'hi', timestamp: 2 })];
  const show = async ui => {
    awayFromBottom(ui.window);
    await ui.update(arrived());
    assert.equal(pill(ui.window).textContent, '2 new records');
    assert.equal(pill(ui.window).hidden, false);
  };

  // 21, 23a: a 404 clears the transcript, so the pill and the count go with it.
  const missing = await modeViewer({ records: oneRecord() });
  try {
    await show(missing);
    await missing.failure(404);
    assert.equal(pill(missing.window).hidden, true);
    assert.equal(announcement(missing.window).textContent, '');
  } finally { missing.dom.window.close(); }

  // 22, 23a: a `removed` event clears the transcript in the same way.
  const revoked = await modeViewer({ records: oneRecord() });
  try {
    await show(revoked);
    revoked.source.listeners.removed();
    assert.equal(pill(revoked.window).hidden, true);
    assert.equal(announcement(revoked.window).textContent, '');
  } finally { revoked.dom.window.close(); }

  // 23, 23a: a reconnect drops the count, and the re-fetched records do not count again.
  const interrupted = await modeViewer({ records: oneRecord() });
  try {
    await show(interrupted);
    interrupted.source.onerror();
    assert.equal(pill(interrupted.window).hidden, true);

    await interrupted.update(arrived());
    assert.equal(pill(interrupted.window).textContent, '0 new records');
    assert.equal(pill(interrupted.window).hidden, true);

    await interrupted.update([...arrived(), rec('a3', 'assistant', { text: 'later', timestamp: 3 })]);
    assert.equal(pill(interrupted.window).textContent, '1 new record');
    assert.equal(pill(interrupted.window).hidden, false);
  } finally { interrupted.dom.window.close(); }
});

test('a payload that resolves after a clear cannot render the transcript again (21, 22, 23a)', async () => {
  const arrived = () => [...oneRecord(), rec('a2', 'assistant', { text: 'more', timestamp: 1 }), rec('u1', 'user', { text: 'hi', timestamp: 2 })];
  const ui = await modeViewer({ records: oneRecord(), defer: true });
  try {
    const { window } = ui, document = window.document;
    await ui.release();                                            // The first payload paints the page.
    assert.equal(articles(window).length, 1);
    awayFromBottom(window);

    await ui.update(arrived());                                    // This refresh holds its response in flight.
    assert.equal(articles(window).length, 1);                      // Nothing rendered yet.

    ui.source.listeners.removed();                                 // 22: the transcript clears mid-flight.
    assert.equal(articles(window).length, 0);
    assert.equal(document.getElementById('title').textContent, '');

    await ui.release();                                            // The held payload resolves after the clear.
    assert.equal(articles(window).length, 0);                      // It is discarded, so the page stays clear.
    assert.equal(pill(window).hidden, true);
    assert.equal(announcement(window).textContent, '');
  } finally { ui.dom.window.close(); }
});
