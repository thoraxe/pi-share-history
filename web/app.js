const $ = id => document.getElementById(id);
const basePath = document.documentElement.dataset.basePath || '';
const id = location.pathname.slice(basePath.length).match(/^\/s\/([\w-]{32})$/)?.[1];
const nodes = new Map();
// Directory rows are reused by share id, so a 10 s refresh keeps keyboard focus and the revealed absolute time.
const directoryRows = new Map();
const groupSteps = new WeakMap();
let follow = true, busy = false, again = false, stream, draftExpiry, currentUnits = null;
// Rules 24a-24f: a fragment names a record. The target is resolved after the transcript renders, so the
// viewer does not depend on the record order. A fragment also means that the reader chose a record, so
// follow-live stays off and cannot scroll the page away from the target (rules 24d and 24f).
// The copied link carries the raw record id, so a raw match comes first. A hand-encoded fragment still
// resolves, because its decoded form is the second candidate.
const linkedTargetId = (location.hash || '').slice(1);
const decodedTargetId = (() => {
  try { return decodeURIComponent(linkedTargetId); } catch { return linkedTargetId; }
})();
if (linkedTargetId) follow = false;
// The fragment is resolved one time, after the first payload paints the transcript.
let targetHandled = false;
// Rule 24d: while a deep-link target is the place the reader chose, a live refresh must not scroll
// away from it. The follow controls clear the pin when the reader asks to follow live again.
let pinnedTarget = false;
// Rule 7w counts records, so the viewer remembers every record it has already shown, and the ids of the
// records that arrived since the reader last reached the bottom. The ids, not a number, are kept, so a
// mode change recomputes the pill count through the visibility rules of the new mode.
const seenRecords = new Set();
const arrivedRecords = new Set();
// The first payload is the page, not an arrival, so it seeds `seenRecords` and counts nothing.
let seeded = false;
// Rule 7ab announces every count change, so the viewer remembers the count the live region last carried.
// The first paint is not a change, so a fresh page announces nothing.
let announcedCount = 0;
const markdownKey = 'pi-share-history-markdown';
const advancedKey = 'pi-share-history-advanced';
const toolKinds = new Set(['tool', 'toolResult', 'bashExecution']);
const toolNameFallback = 'Tool';
const readKinds = new Set(['user', 'assistant', 'notice']);
let markdownEnabled = true, advanced = false;
const bodyCache = new WeakMap();
try { markdownEnabled = localStorage.getItem(markdownKey) !== 'off'; } catch { /* Storage can be blocked. */ }
try { advanced = localStorage.getItem(advancedKey) === 'on'; } catch { /* Keep the page-local default. */ }
const setText = (element, text) => { if (element && element.textContent !== text) element.textContent = text; };
const when = value => new Date(value).toLocaleString();
// Rule 2b shows the last-updated time as a distance from now. Rule 2c keeps the absolute timestamp for
// hover, focus, and assistive technology. The spec fixes no unit, rounding, or locale.
function relativeTime(value) {
  const elapsed = Date.now() - value;
  if (!Number.isFinite(elapsed) || elapsed < 60000) return 'just now';
  for (const [size, suffix] of [[31536000000, 'y'], [2592000000, 'mo'], [86400000, 'd'], [3600000, 'h'], [60000, 'm']]) {
    if (elapsed >= size) return `${Math.floor(elapsed / size)}${suffix} ago`;
  }
  return 'just now';
}
// Rules 1b and 1c keep the share state and the sync time in their own parts of the header.
function setStatus(state, sync = '') {
  setText($('status'), state);
  setText($('sync'), sync);
}
const isError = record => Boolean(record.error);
// Rule 7m shows the step status. A record without one must not invent it; an error still marks the step.
const stepStatus = record => record.status ? ` · ${record.status}` : isError(record) ? ' · error' : '';
const metadataText = record => [when(record.timestamp), record.model, record.status].filter(Boolean).join(' · ');
// Rule 7i forbids a raw kind name as a heading, so a label that repeats the kind counts as no label.
const namedLabel = record => record.label && record.label !== record.kind ? record.label : '';
// A bash-execution message has no tool name, so name the tool instead of showing its kind.
const toolName = record => namedLabel(record) || (record.kind === 'bashExecution' ? 'bash' : toolNameFallback);
function renderBody(node, record) {
  const text = (record.text || '') + (record.errorMessage ? `\n${record.errorMessage}` : '');
  const useMarkdown = markdownEnabled && ['user', 'assistant'].includes(record.kind);
  const previous = bodyCache.get(node);
  if (previous?.text === text && previous.useMarkdown === useMarkdown) return;
  const plain = node.querySelector('pre');
  const formatted = node.querySelector('.markdown-content');
  setText(plain, text);
  const rendered = useMarkdown && Boolean(formatted) && Boolean(window.PiMarkdown?.render(formatted, text));
  if (plain) plain.hidden = rendered;
  if (formatted) {
    formatted.hidden = !rendered;
    if (!rendered) formatted.replaceChildren();
  }
  bodyCache.set(node, { text, useMarkdown });
}
function updateAdvancedButton() {
  const button = $('advanced-toggle');
  document.documentElement.dataset.mode = advanced ? 'advanced' : 'read';
  if (!button) return;
  button.hidden = !id;
  button.textContent = `Advanced: ${advanced ? 'On' : 'Off'}`;
  button.setAttribute('aria-pressed', String(advanced));
}
updateAdvancedButton();
$('advanced-toggle')?.addEventListener('click', () => {
  advanced = !advanced;
  try {
    if (advanced) localStorage.setItem(advancedKey, 'on');
    else localStorage.removeItem(advancedKey);
  } catch { /* Keep the page-local choice. */ }
  updateAdvancedButton();
  applyView();
  // Rule 7w counts through the visibility rules of the current mode, so the count follows the switch.
  renderActivity();
});
function updateMarkdownButton() {
  $('markdown-toggle').textContent = `Markdown: ${markdownEnabled ? 'On' : 'Off'}`;
  $('markdown-toggle').setAttribute('aria-pressed', String(markdownEnabled));
}
updateMarkdownButton();
$('markdown-toggle').addEventListener('click', () => {
  markdownEnabled = !markdownEnabled;
  try { localStorage.setItem(markdownKey, markdownEnabled ? 'on' : 'off'); } catch { /* Keep the page-local choice. */ }
  updateMarkdownButton();
  for (const unit of currentUnits || []) {
    if (unit.records) {
      const steps = groupSteps.get(nodes.get(unit.key));
      for (const record of unit.records) {
        const step = steps?.get(record.id);
        if (step) renderBody(step, record);
      }
    } else {
      const node = nodes.get(unit.key);
      if (node) renderBody(node, unit.record);
    }
  }
  applyView();
});
function renderDraft(draft) {
  clearTimeout(draftExpiry);
  const visible = Boolean(id && draft?.text && draft.expiresIn > 0);
  $('draft').hidden = !visible;
  setText($('draft-text'), visible ? draft.text : '');
  if (visible) draftExpiry = setTimeout(() => renderDraft(null), draft.expiresIn);
}
// One predicate decides both what the page renders and what rule 7w counts, so the pill count and the
// rendered records cannot drift. Read mode shows a prompt, a reply, a notice, and an error, and it
// shows a tool group only through its failure notice, so a group is visible through a failed step.
// Advanced mode shows every record.
const hasText = record => typeof record.text === 'string' && record.text.trim() !== '';
// Rule 7b1 keeps an empty record out of Read mode, so a turn that only called a tool leaves no
// blank card. Advanced mode still shows every record.
// Rules 7b3 and 7b4: a deep-link target shows in Read mode even when the hiding rules would drop it.
const isLinkedTarget = record => Boolean(linkedTargetId) && (record.id === linkedTargetId || record.id === decodedTargetId);
const recordVisible = record => advanced || isLinkedTarget(record) || isError(record) || (readKinds.has(record.kind) && hasText(record));
const unitVisible = unit => unit.records ? unit.records.some(recordVisible) : recordVisible(unit.record);
// Rule 4 filters on visible text, so a hidden element and a closed disclosure contribute nothing.
// Read mode also keeps the metadata chip out of the match, because it is hidden at rest.
// The directory absolute timestamp is hidden at rest too, so it never matches before the reader reveals it.
function visibleText(target) {
  // A text node has no tag name and contributes its own text.
  if (!target.tagName) return target.textContent;
  if (target.hidden || (!advanced && target.classList.contains('meta')) || target.classList.contains('absolute')) return '';
  if (target.tagName === 'DETAILS' && !target.open) {
    const summary = target.querySelector(':scope > summary');
    return summary ? visibleText(summary) : '';
  }
  return contentText(target);
}
// A unit decides its own `hidden` state from this text, so the unit itself is not part of the walk.
const contentText = unit => [...unit.childNodes].map(visibleText).join(' ');
// A cleared transcript keeps no heading from the share that is gone.
function clearTitle() {
  setText($('title'), '');
  document.title = 'Pi team history';
}
// Rules 21 and 22: a clear leaves no marker on the page, so a generation number discards a payload that
// resolves after the clear and would otherwise render the transcript again.
let generation = 0;
// A cleared transcript keeps no heading, node, or count from the share that is gone. It also forgets
// that it was seeded, so the next payload is the page of a new share, not an arrival in the old one.
function clearTranscript() {
  generation++;
  stream?.close();
  $('records').replaceChildren();
  nodes.clear();
  currentUnits = [];
  seenRecords.clear();
  seeded = false;
  clearTitle();
  resetActivity();
}
function applyView() {
  const query = $('search').value.toLowerCase();
  if (!currentUnits) {
    // Rule 4 filters on visible text, so the directory uses the same walk as a transcript.
    for (const node of $('records').children) node.hidden = !contentText(node).toLowerCase().includes(query);
    return;
  }
  for (const unit of currentUnits) {
    const node = nodes.get(unit.key);
    if (!node) continue;
    if (unit.records) {
      // Rule 7b4: Read mode shows the row that holds a deep-link target. The other rows stay hidden.
      node.querySelector('details').hidden = !advanced && !unit.records.some(isLinkedTarget);
    } else updateThinking(node, unit.record, advanced);
    node.hidden = !unitVisible(unit) || !contentText(node).toLowerCase().includes(query);
  }
}
$('search').addEventListener('input', applyView);
// Rule 7w counts the arrived records that the current mode shows, through the same visibility rules
// that decide the records themselves, so a mode switch never desyncs the count from the page.
function pendingCount() {
  let count = 0;
  for (const unit of currentUnits || []) {
    for (const record of unit.records || [unit.record]) {
      if (arrivedRecords.has(record.id) && recordVisible(record)) count++;
    }
  }
  return count;
}
// Rules 7u, 7v, and 7ac: the pill is fixed to the bottom of the viewport, so a show or a hide moves
// nothing on the page.
function renderActivity() {
  const pill = $('activity');
  if (!pill) return;
  const count = pendingCount();
  const label = `${count} new record${count === 1 ? '' : 's'}`;
  pill.hidden = !id || !count;
  setText(pill, label);
  // Rule 7ab announces every count change, including the drop to zero: the reader still needs to know
  // that nothing is new. The first paint is not a change, so it announces nothing.
  if (count !== announcedCount) {
    setText($('activity-live'), count ? label : 'No new records');
    announcedCount = count;
  }
}
// Rule 23a restarts the count when the transcript is gone or the stream dropped.
function resetActivity() {
  arrivedRecords.clear();
  renderActivity();
}
// Rules 7 and 7y: one activation scrolls to the newest record and resumes follow-live.
function followLive() {
  follow = true;
  pinnedTarget = false;
  arrivedRecords.clear();
  $('follow').textContent = 'Following live';
  renderActivity();
  window.scrollTo(0, document.body.scrollHeight);
}
$('follow').hidden = !id;
// A fragment turns follow-live off before the first paint, so the button states the current mode.
$('follow').textContent = follow ? 'Following live' : 'Follow live';
$('follow').onclick = followLive;
$('activity')?.addEventListener('click', followLive);
window.addEventListener('scroll', () => {
  follow = window.innerHeight + window.scrollY >= document.body.scrollHeight - 100;
  // Rule 24d keeps the page on the target, so the control must not claim that it follows live.
  $('follow').textContent = follow && !pinnedTarget ? 'Following live' : 'Follow live';
  // Rule 7u: the bottom is where every record is visible, so the count restarts there.
  if (follow && arrivedRecords.size) resetActivity();
}, { passive: true });
function createThinkingNode() {
  const details = document.createElement('details');
  details.className = 'thinking';
  details.hidden = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Thinking';
  const plain = document.createElement('pre');
  details.append(summary, plain);
  return details;
}
// Rule 7b2: Read mode hides thinking. Advanced mode shows it with the record and starts it collapsed.
function updateThinking(node, record, shown) {
  const details = node.querySelector('.thinking');
  if (!details) return;
  const value = typeof record.thinking === 'string' ? record.thinking : '';
  details.hidden = !shown || !value;
  setText(details.querySelector('pre'), value);
}
// Rules 24g-24l: each turn carries one copy-link action. The action is a native button with an
// accessible name, and a short note next to it reports success or failure. The transcript stays usable
// when the clipboard is unavailable.
function createTurnActions(recordId) {
  const box = document.createElement('div');
  box.className = 'turn-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-link';
  button.textContent = 'Copy link';
  button.setAttribute('aria-label', 'Copy link to this turn');
  const note = document.createElement('span');
  note.className = 'copy-note';
  const timers = new WeakMap();
  button.addEventListener('click', async () => {
    // Rule 24h copies the absolute URL and ends it with the record fragment.
    const link = `${location.origin}${location.pathname}#${recordId}`;
    let message = 'Link copied';
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      message = 'Copy failed';
    }
    setText(note, message);
    clearTimeout(timers.get(note));
    timers.set(note, setTimeout(() => setText(note, ''), 2000));
  });
  box.append(button, note);
  return box;
}
function createRecordNode(recordId) {
  const node = document.createElement('article');
  node.className = 'record';
  // Keyboard focus reveals the metadata. It also has to survive a refresh, so renderTranscript never re-appends.
  node.tabIndex = 0;
  const role = document.createElement('span');
  role.className = 'role'; role.hidden = true;
  const label = document.createElement('span');
  label.className = 'label'; label.hidden = true;
  const plain = document.createElement('pre');
  const formatted = document.createElement('div');
  formatted.className = 'markdown-content'; formatted.hidden = true;
  const meta = document.createElement('p');
  meta.className = 'meta';
  node.append(role, label, plain, formatted, createThinkingNode(), meta, createTurnActions(recordId));
  return node;
}
function updateRecordNode(node, record) {
  // Rule 7j1: a message element uses its record id as the element id.
  node.id = record.id;
  node.dataset.kind = record.kind;
  if (record.error) node.dataset.error = 'true'; else delete node.dataset.error;
  const role = node.querySelector('.role');
  if (role) {
    // Only a prompt carries the `You` label, so no other record has text a search can match.
    role.hidden = record.kind !== 'user';
    setText(role, role.hidden ? '' : 'You');
  }
  const label = node.querySelector('.label');
  if (label) {
    // Only a label that adds information renders.
    const named = namedLabel(record);
    label.hidden = !named;
    setText(label, named);
  }
  setText(node.querySelector('.meta'), metadataText(record));
  updateThinking(node, record, advanced);
  renderBody(node, record);
}
function createGroupNode(recordId) {
  const node = document.createElement('article');
  node.className = 'tool-group';
  // Rule 7j2: the group row never takes a record id, because each step carries its own record id.
  // Read mode renders a failed group with its row closed, so the group must carry the metadata chip
  // and the keyboard focus itself. It also has to survive a refresh, so renderTranscript never re-appends.
  node.tabIndex = 0;
  const details = document.createElement('details');
  details.className = 'tool-row';
  const summary = document.createElement('summary');
  summary.className = 'tool-summary';
  const stepsBox = document.createElement('div');
  stepsBox.className = 'tool-steps';
  details.append(summary, stepsBox);
  const failure = document.createElement('p');
  failure.className = 'tool-failure'; failure.hidden = true;
  const meta = document.createElement('p');
  meta.className = 'meta'; meta.hidden = true;
  node.append(details, failure, meta, createTurnActions(recordId));
  return node;
}
function createStepNode() {
  const step = document.createElement('details');
  step.className = 'tool-step';
  const summary = document.createElement('summary');
  summary.className = 'tool-step-summary';
  const label = document.createElement('span');
  label.className = 'tool-step-label';
  // The metadata sits inside the summary because a closed step does not render its body.
  const meta = document.createElement('span');
  meta.className = 'meta';
  summary.append(label, meta);
  const plain = document.createElement('pre');
  const formatted = document.createElement('div');
  formatted.className = 'markdown-content'; formatted.hidden = true;
  step.append(summary, plain, formatted);
  return step;
}
function updateGroupNode(node, records) {
  const counts = new Map();
  for (const record of records) {
    const name = toolName(record);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const names = [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(', ');
  const failed = records.filter(isError);
  setText(node.querySelector('.tool-summary'), `${records.length} step${records.length === 1 ? '' : 's'} · ${names}${failed.length ? ` · ⚠ ${failed.length} failed` : ''}`);
  // Read mode renders only a failed group, so the group chip carries the first failed record's metadata.
  const failedMeta = failed[0];
  const groupMeta = node.querySelector(':scope > .meta');
  groupMeta.hidden = !failedMeta;
  setText(groupMeta, failedMeta ? metadataText(failedMeta) : '');
  let steps = groupSteps.get(node);
  if (!steps) { steps = new Map(); groupSteps.set(node, steps); }
  const stepsBox = node.querySelector('.tool-steps');
  const keep = new Set();
  let previous = null;
  for (const record of records) {
    keep.add(record.id);
    let step = steps.get(record.id);
    const created = !step;
    if (created) { step = createStepNode(); steps.set(record.id, step); }
    // Rule 7j1: a tool step uses its record id as the element id, so a deep link reaches it.
    step.id = record.id;
    step.dataset.kind = record.kind;
    if (record.error) step.dataset.error = 'true'; else delete step.dataset.error;
    setText(step.querySelector('.tool-step-label'), `${toolName(record)}${stepStatus(record)}`);
    setText(step.querySelector('.meta'), metadataText(record));
    renderBody(step, record);
    const reference = previous ? previous.nextElementSibling : stepsBox.firstElementChild;
    if (created || reference !== step) stepsBox.insertBefore(step, reference);
    previous = step;
  }
  for (const [key, step] of steps) if (!keep.has(key)) { step.remove?.(); steps.delete(key); }
  setText(node.querySelector('.tool-failure'), failed.map(record => `${toolName(record)} failed${record.errorMessage ? `: ${String(record.errorMessage).split('\n')[0]}` : ''}`).join(' · '));
  node.querySelector('.tool-failure').hidden = !failed.length;
}
function buildUnits(records) {
  const units = [];
  let group = null;
  for (const record of records) {
    if (toolKinds.has(record.kind)) {
      if (!group) {
        group = { key: `group:${record.id}`, records: [] };
        units.push(group);
      }
      group.records.push(record);
    } else {
      group = null;
      units.push({ key: `record:${record.id}`, record });
    }
  }
  return units;
}
// Rule 7w records which records arrived while the reader is away from the bottom. A record counts once,
// and the count is derived from the current mode (see `pendingCount`) rather than frozen here.
function noteArrivals(units) {
  // The first payload paints the page, so a reader who lands away from the bottom counts nothing.
  const seed = !seeded;
  seeded = true;
  for (const unit of units) {
    for (const record of unit.records || [unit.record]) {
      if (seenRecords.has(record.id)) continue;
      seenRecords.add(record.id);
      if (!seed && !follow) arrivedRecords.add(record.id);
    }
  }
  // Rule 7u: a reader at the bottom sees the new records, so only an away reader accrues a count.
  if (follow) arrivedRecords.clear();
  renderActivity();
}
function renderTranscript(data) {
  // Clear the temporary preview before rendering the submitted history.
  // Both changes paint together; drafts never become transcript nodes.
  renderDraft(data.draft);
  document.title = `${data.title} — Pi history`;
  setText($('title'), data.title);
  // Rules 1b and 1c: the dot and the state word form the share state, and the sync time follows it.
  setStatus(`● ${data.live ? 'Live' : 'Saved'}`, `Synced ${when(data.updated)}`);
  currentUnits = buildUnits(data.records);
  const keep = new Set(), container = $('records');
  let previous = null;
  for (const unit of currentUnits) {
    keep.add(unit.key);
    let node = nodes.get(unit.key);
    const created = !node;
    if (created) {
      // Rule 24i: the copy-link action of a group copies the record id of its first record.
      node = unit.records ? createGroupNode(unit.records[0].id) : createRecordNode(unit.record.id);
      nodes.set(unit.key, node);
    }
    if (unit.records) updateGroupNode(node, unit.records);
    else updateRecordNode(node, unit.record);
    // A node that already follows its predecessor stays put, so a refresh keeps focus and the selection.
    const reference = previous ? previous.nextElementSibling : container.firstElementChild;
    if (created || reference !== node) container.insertBefore(node, reference);
    previous = node;
  }
  for (const [key, node] of nodes) {
    if (keep.has(key)) continue;
    node.remove?.();
    nodes.delete(key);
  }
  noteArrivals(currentUnits);
}
// Rules 24b-24f: resolve the fragment to the element with that id. A valid target scrolls into view,
// opens a containing tool group, turns follow-live off, and highlights for 2 seconds. An unknown target
// leaves the page at the top and reports no error.
function revealTarget() {
  if (!linkedTargetId || targetHandled) return;
  targetHandled = true;
  const container = $('records');
  const element = [...container.querySelectorAll('[id]')].find(node => node.id === linkedTargetId || node.id === decodedTargetId);
  if (!element) return;
  follow = false;
  pinnedTarget = true;
  $('follow').textContent = 'Follow live';
  const row = element.closest?.('details.tool-row');
  if (row) row.open = true;
  element.scrollIntoView?.({ block: 'center' });
  element.classList.add('deep-link-target');
  setTimeout(() => element.classList.remove('deep-link-target'), 2000);
}
// Rules 2a-2d: each row shows a record count and a relative time at rest, keeps the absolute timestamp
// in the accessibility tree, and stays in the order that the API returns. Row nodes are reused and moved
// only when new or out of order, so a refresh does not drop focus from a row link (rule 2c).
function renderDirectory(data) {
  currentUnits = null;
  const container = $('records'), keep = new Set(), rows = [];
  for (const share of data) {
    keep.add(share.id);
    let row = directoryRows.get(share.id);
    if (!row) {
      row = {
        article: document.createElement('article'), link: document.createElement('a'), meta: document.createElement('p'),
        state: document.createElement('span'), time: document.createElement('time'),
        relative: document.createElement('span'), absolute: document.createElement('span'), count: document.createElement('span'),
      };
      row.meta.className = 'share-meta';
      row.state.className = 'share-state';
      row.time.className = 'share-time';
      row.relative.className = 'relative';
      row.absolute.className = 'absolute';
      row.count.className = 'share-count';
      // The relative time is decoration for sighted readers. The absolute timestamp is the value that
      // assistive technology reads, and CSS reveals it on hover and on focus.
      row.relative.setAttribute('aria-hidden', 'true');
      row.time.append(row.relative, row.absolute);
      row.meta.append(row.state, row.time, row.count);
      row.article.append(row.link, row.meta);
      directoryRows.set(share.id, row);
    }
    row.link.href = `${basePath}/s/${share.id}`;
    setText(row.link, share.title);
    row.state.dataset.live = share.live ? 'true' : 'false';
    setText(row.state, share.live ? '● Live' : 'Saved');
    row.time.dateTime = new Date(share.updated).toISOString();
    setText(row.relative, relativeTime(share.updated));
    setText(row.absolute, when(share.updated));
    setText(row.count, `${share.count ?? 0} record${share.count === 1 ? '' : 's'}`);
    rows.push(row.article);
  }
  for (const [shareId, row] of directoryRows) {
    if (keep.has(shareId)) continue;
    row.article.remove?.();
    directoryRows.delete(shareId);
  }
  let previous = null;
  // Moving a row detaches it, which blurs its link. Remember the focused share and restore it after the order.
  const focused = document.activeElement?.closest?.('#records > article')?.querySelector?.('a[href]')?.getAttribute('href') || '';
  for (const article of rows) {
    // A row that already follows its predecessor stays put. Moving it would drop focus and the selection.
    const reference = previous ? previous.nextElementSibling : container.firstElementChild;
    if (reference !== article) container.insertBefore(article, reference);
    previous = article;
  }
  if (focused) {
    const target = container.querySelector(`a[href="${focused}"]`);
    if (target && document.activeElement !== target) target.focus();
  }
}
async function refresh() {
  if (busy) { again = true; return; }
  busy = true;
  const started = generation;
  try {
    const response = await fetch(basePath + (id ? `/api/shares/${id}` : '/api/shares'), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      if (response.status === 404) {
        clearTranscript();
        throw new Error('Transcript deleted, revoked, or not found');
      }
      throw new Error(`Server returned ${response.status}`);
    }
    const data = await response.json();
    // A clear during the fetch owns the page now, so this payload is discarded (rules 21 and 22).
    if (started !== generation) return;
    if (!id) {
      setStatus('Public session directory');
      renderDirectory(data);
    } else {
      renderTranscript(data);
    }
    applyView();
    // Rules 24b-24f: the fragment resolves against the rendered transcript, after the view mode moves.
    revealTarget();
    if (id && follow && !pinnedTarget) window.scrollTo(0, document.body.scrollHeight);
  } catch (error) {
    renderDraft(null);
    // A closed stream cannot reconnect, so the message must not promise it.
    setStatus(error.message + (stream && stream.readyState !== 2 ? ' — reconnecting if available' : ''));
  }
  finally { busy = false; if (again) { again = false; void refresh(); } }
}
void refresh();
if (id) {
  stream = new EventSource(`${basePath}/api/shares/${id}/events`);
  stream.addEventListener('update', () => void refresh());
  stream.addEventListener('removed', () => { renderDraft(null); clearTranscript(); setStatus('This transcript was revoked or deleted.'); });
  stream.onerror = () => { renderDraft(null); resetActivity(); setStatus('Connection interrupted — reconnecting…'); };
} else setInterval(refresh, 10000);
