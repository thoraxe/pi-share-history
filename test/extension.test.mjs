import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import extension, { piHasBuiltInShare } from '../extension/index.ts';
import { messageRecord, toolRecord } from '../extension/records.mjs';
import { createService } from '../server/index.mjs';

const suffix = '\n[truncated by pi-share-history]';

for (const prefix of ['', '/pi-history']) test(`extension lifecycle at ${prefix || '/'}; resumed session stays offline`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-ext-'));
  const key = 'extension-test-team-key-at-least-24-characters';
  const service = createService({ dataDir: dir, uploadKey: key, publicUrl: `http://localhost:9080${prefix}` });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}${prefix}`;
  const previous = { url: process.env.PI_SHARE_URL, key: process.env.PI_SHARE_KEY };
  process.env.PI_SHARE_URL = base + '/'; process.env.PI_SHARE_KEY = key;
  const entries = [{ type: 'message', message: { role: 'user', timestamp: 100, content: 'Historical prompt' } }];
  const hooks = new Map(), notifications = [];
  let command;
  const pi = {
    on: (name, handler) => hooks.set(name, handler),
    registerCommand: (_name, options) => { command = options.handler; },
    appendEntry: (customType, data) => entries.push({ type: 'custom', customType, data }),
  };
  const ctx = { cwd: '/tmp/project', sessionManager: { getBranch: () => entries }, ui: { setStatus() {}, confirm: async () => true, notify: (text, level) => notifications.push({ text, level }) } };
  try {
    await extension(pi);
    await hooks.get('session_start')({}, ctx);
    await command('start', ctx);
    assert.equal(notifications.at(-1).level, 'info');
    const share = entries.find(entry => entry.type === 'custom').data;
    assert.equal(share.server, base);
    assert.equal(new URL(share.url).pathname, `${prefix}/s/${share.id}`);
    await hooks.get('message_update')({ message: { role: 'assistant', timestamp: 200, content: [{ type: 'text', text: 'Streaming…' }] } }, ctx);
    // The final assistant text keeps the prose and drops the tool call that published separately.
    await hooks.get('message_end')({ message: { role: 'assistant', timestamp: 200, content: [{ type: 'text', text: 'Complete' }, { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'pwd' } }] } }, ctx);
    await hooks.get('tool_execution_start')({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'pwd' } }, ctx);
    await hooks.get('tool_execution_end')({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', args: { command: 'pwd' }, result: { content: [{ type: 'text', text: '/tmp/project' }] } }, ctx);
    await command('stop', ctx);
    let data = await fetch(base + `/api/shares/${share.id}`).then(r => r.json());
    assert.equal(data.live, false); assert.equal(data.records.length, 3);
    assert.equal(data.records[1].text, 'Complete');
    assert.equal(data.records[2].text, '{\n  "command": "pwd"\n}\n\n/tmp/project');
    assert.equal(JSON.stringify(data).includes(share.ownerKey), false);
    await hooks.get('session_shutdown')({}, ctx);
    await hooks.get('session_start')({}, ctx);
    await hooks.get('message_end')({ message: { role: 'user', timestamp: 300, content: 'Must remain private' } }, ctx);
    await hooks.get('session_shutdown')({}, ctx);
    data = await fetch(base + `/api/shares/${share.id}`).then(r => r.json());
    assert.equal(data.records.length, 3);
    await command('revoke', ctx);
    assert.equal((await fetch(base + `/api/shares/${share.id}`)).status, 404);
    await command('delete', ctx);
    assert.equal(entries.at(-1).data, null);
  } finally {
    await hooks.get('session_shutdown')?.({}, ctx);
    if (previous.url === undefined) delete process.env.PI_SHARE_URL; else process.env.PI_SHARE_URL = previous.url;
    if (previous.key === undefined) delete process.env.PI_SHARE_KEY; else process.env.PI_SHARE_KEY = previous.key;
    await service.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('assistant text keeps prose and omission placeholders but drops tool call blocks (10a)', () => {
  const record = messageRecord({ role: 'assistant', timestamp: 210, content: [
    { type: 'text', text: 'I will open the file.' },
    { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: '/tmp/listed-path' } },
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'image', data: 'image-bytes' },
    { type: 'widget', payload: 'unknown-payload' },
  ] });
  assert.equal(record.text, 'I will open the file.\n\n[thinking omitted]\n\n[image omitted]\n\n[widget block omitted]');
  assert.equal(JSON.stringify(record).includes('/tmp/listed-path'), false);
  assert.equal(record.text.includes('read'), false);
  assert.equal(record.text.includes('private reasoning'), false);
  assert.equal(record.text.includes('image-bytes'), false);
});

test('an assistant message that only calls a tool publishes empty text and does not throw (10a)', () => {
  const record = messageRecord({ role: 'assistant', timestamp: 220, content: [{ type: 'toolCall', id: 'c2', name: 'bash', arguments: { command: 'cat /tmp/listed-path' } }] });
  assert.equal(record.text, '');
  assert.equal(JSON.stringify(record).includes('/tmp/listed-path'), false);
  assert.equal(JSON.stringify(record).includes('bash'), false);
});

test('a finished tool record keeps both the arguments and the result (12a)', () => {
  const record = toolRecord({ type: 'tool_execution_end', toolCallId: 'c3', toolName: 'bash', args: { command: 'ls' }, result: { content: [{ type: 'text', text: 'a.txt' }] } });
  assert.equal(record.status, 'done');
  assert.equal(record.text, '{\n  "command": "ls"\n}\n\na.txt');
});

test('a tool record publishes its arguments when it has no result yet, and omits empty parts (12a)', () => {
  const running = toolRecord({ type: 'tool_execution_start', toolCallId: 'c4', toolName: 'grep', args: { pattern: 'needle' } });
  assert.equal(running.status, 'running');
  assert.equal(running.text, '{\n  "pattern": "needle"\n}');
  assert.equal(toolRecord({ type: 'tool_execution_end', toolCallId: 'c5', toolName: 'bash', args: { command: 'ls' }, result: { content: [] } }).text, '{\n  "command": "ls"\n}');
});

test('tool record text stays capped at 24000 characters with the truncation suffix (12a, 3)', () => {
  const record = toolRecord({ type: 'tool_execution_end', toolCallId: 'c6', toolName: 'bash', args: { command: 'a'.repeat(30000) }, result: { content: [{ type: 'text', text: 'b'.repeat(30000) }] } });
  assert.ok(record.text.startsWith('{\n  "command": "a'));
  assert.ok(record.text.endsWith(suffix));
  assert.equal(record.text.length, 24000 + suffix.length);
});

test('Pi versions with a built-in /share are detected from the version string', () => {
  assert.equal(piHasBuiltInShare('1.4.0'), false);
  assert.equal(piHasBuiltInShare('1.4.9'), false);
  assert.equal(piHasBuiltInShare('1.5.0'), true);
  assert.equal(piHasBuiltInShare('1.5.2'), true);
  assert.equal(piHasBuiltInShare('1.5.2-beta.1'), true);
  assert.equal(piHasBuiltInShare('1.10.0'), true);
  assert.equal(piHasBuiltInShare('2.0.0'), true);
  assert.equal(piHasBuiltInShare(undefined), false);
  assert.equal(piHasBuiltInShare('unknown'), false);
});
