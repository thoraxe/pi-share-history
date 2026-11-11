const $ = id => document.getElementById(id);
const basePath = document.documentElement.dataset.basePath || '';
const id = location.pathname.slice(basePath.length).match(/^\/s\/([\w-]{32})$/)?.[1];
const nodes = new Map();
const groupSteps = new WeakMap();
let follow = true, busy = false, again = false, stream, draftExpiry, currentUnits = null;
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
function unitVisible(unit) {
  if (advanced) return true;
  return unit.records ? unit.records.some(isError) : readKinds.has(unit.record.kind) || isError(unit.record);
}
// Rule 4 filters on visible text, so a hidden element and a closed disclosure contribute nothing.
// Read mode also keeps the metadata chip out of the match, because it is hidden at rest.
function visibleText(target) {
  // A text node has no tag name and contributes its own text.
  if (!target.tagName) return target.textContent;
  if (target.hidden || (!advanced && target.classList.contains('meta'))) return '';
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
    if (unit.records) node.querySelector('details').hidden = !advanced;
    node.hidden = !unitVisible(unit) || !contentText(node).toLowerCase().includes(query);
  }
}
$('search').addEventListener('input', applyView);
$('follow').hidden = !id;
$('follow').onclick = () => { follow = true; window.scrollTo(0, document.body.scrollHeight); $('follow').textContent = 'Following live'; };
window.addEventListener('scroll', () => {
  follow = window.innerHeight + window.scrollY >= document.body.scrollHeight - 100;
  $('follow').textContent = follow ? 'Following live' : 'Follow live';
}, { passive: true });
function createRecordNode() {
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
  node.append(role, label, plain, formatted, meta);
  return node;
}
function updateRecordNode(node, record) {
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
  renderBody(node, record);
}
function createGroupNode() {
  const node = document.createElement('article');
  node.className = 'tool-group';
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
  node.append(details, failure, meta);
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
function renderTranscript(data) {
  // Clear the temporary preview before rendering the submitted history.
  // Both changes paint together; drafts never become transcript nodes.
  renderDraft(data.draft);
  document.title = `${data.title} — Pi history`;
  setText($('title'), data.title);
  setText($('status'), `${data.live ? '● Live' : 'Offline — saved transcript'} · Synced ${when(data.updated)}`);
  currentUnits = buildUnits(data.records);
  const keep = new Set(), container = $('records');
  let previous = null;
  for (const unit of currentUnits) {
    keep.add(unit.key);
    let node = nodes.get(unit.key);
    const created = !node;
    if (created) {
      node = unit.records ? createGroupNode() : createRecordNode();
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
}
async function refresh() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const response = await fetch(basePath + (id ? `/api/shares/${id}` : '/api/shares'), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      if (response.status === 404) {
        stream?.close(); $('records').replaceChildren(); nodes.clear(); currentUnits = []; clearTitle();
        throw new Error('Transcript deleted, revoked, or not found');
      }
      throw new Error(`Server returned ${response.status}`);
    }
    const data = await response.json();
    if (!id) {
      currentUnits = null;
      $('status').textContent = 'Public session directory';
      $('records').replaceChildren(...data.map(share => {
        const article = document.createElement('article'), link = document.createElement('a'), meta = document.createElement('p');
        link.href = `${basePath}/s/${share.id}`; link.textContent = share.title;
        meta.textContent = `${share.live ? '● Live' : 'Saved'} · Updated ${when(share.updated)}`;
        article.append(link, meta); return article;
      }));
    } else {
      renderTranscript(data);
    }
    applyView();
    if (id && follow) window.scrollTo(0, document.body.scrollHeight);
  } catch (error) {
    renderDraft(null);
    // A closed stream cannot reconnect, so the message must not promise it.
    $('status').textContent = error.message + (stream && stream.readyState !== 2 ? ' — reconnecting if available' : '');
  }
  finally { busy = false; if (again) { again = false; void refresh(); } }
}
void refresh();
if (id) {
  stream = new EventSource(`${basePath}/api/shares/${id}/events`);
  stream.addEventListener('update', () => void refresh());
  stream.addEventListener('removed', () => { renderDraft(null); stream.close(); $('records').replaceChildren(); nodes.clear(); currentUnits = []; clearTitle(); $('status').textContent = 'This transcript was revoked or deleted.'; });
  stream.onerror = () => { renderDraft(null); $('status').textContent = 'Connection interrupted — reconnecting…'; };
} else setInterval(refresh, 10000);
