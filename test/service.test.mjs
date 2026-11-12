import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../server/index.mjs';
import { messageRecord, toolRecord } from '../extension/records.mjs';

const key = 'test-team-key-at-least-24-characters';
test('multi-publisher history, auth, SSE, persistence, revocation and deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-share-'));
  let service, base;
  async function open() {
    service = createService({ dataDir: dir, uploadKey: key });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${service.server.address().port}`;
  }
  const api = (path, method = 'GET', data, token = '') => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  try {
    await open();
    assert.equal((await api('/api/shares', 'POST', { title: 'bad' })).status, 401);
    const create = () => api('/api/shares', 'POST', { title: '<script>public title</script>' }, key).then(r => r.json());
    const a = await create(), b = await create();
    const path = `/api/shares/${a.id}`;
    assert.notEqual(a.id, b.id);
    assert.equal((await api(path + '/records', 'POST', { records: [], live: true }, b.ownerKey)).status, 401);
    const payload = { records: [{ id: 'm1', kind: 'user', text: '<img src=x onerror=alert(1)>' }], live: true };
    assert.equal((await api(path + '/records', 'POST', payload, a.ownerKey)).status, 200);
    await api(path + '/records', 'POST', payload, a.ownerKey);
    let data = await api(path).then(r => r.json());
    assert.equal(data.records.length, 1); assert.equal(data.live, true); assert.equal(data.ownerKey, undefined);
    const controller = new AbortController();
    const stream = await fetch(base + path + '/events', { signal: controller.signal });
    assert.match(stream.headers.get('content-type'), /event-stream/);
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: update/);
    controller.abort(); await reader.cancel().catch(() => {});
    await api(path + '/stop', 'POST', undefined, a.ownerKey);
    assert.equal((await api(path).then(r => r.json())).live, false);
    await service.close(); await open();
    data = await api(path).then(r => r.json()); assert.equal(data.records.length, 1);
    assert.equal((await api('/api/shares').then(r => r.json())).length, 2);
    assert.equal((await api(path + '/revoke', 'POST', undefined, a.ownerKey)).status, 200);
    assert.equal((await api(path)).status, 404);
    assert.equal((await api('/api/shares').then(r => r.json())).length, 1);
    assert.equal((await api(path, 'DELETE', undefined, a.ownerKey)).status, 200);
    assert.equal((await api(path)).status, 404);
    assert.equal((await api('/')).headers.get('content-security-policy').includes("script-src 'self'"), true);
    assert.equal((await api('/api/shares/' + b.id + '/records', 'POST', { records: [{ id: 42 }], live: true }, b.ownerKey)).status, 400);
  } finally { if (service?.server.listening) await service.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('directory lists record counts and puts live shares first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-directory-'));
  const service = createService({ dataDir: dir, uploadKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const api = (path, method = 'GET', data, token = '') => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` }, body: data === undefined ? undefined : JSON.stringify(data) });
  const create = title => api('/api/shares', 'POST', { title }, key).then(r => r.json());
  const post = (share, records, live) => api(`/api/shares/${share.id}/records`, 'POST', { records, live }, share.ownerKey);
  try {
    const first = await create('First saved'), second = await create('Second saved'), live = await create('Live session');
    const stale = await create('Stale live intent'), tieA = await create('Tie A'), tieB = await create('Tie B');
    // Make id order differ from insertion order, so the `s.id` tie-break is provably load-bearing.
    for (const [share, fixed] of [[tieA, 'y'.repeat(32)], [tieB, 'b'.repeat(32)]]) {
      service.db.prepare('UPDATE shares SET id=? WHERE id=?').run(fixed, share.id);
      share.id = fixed;
    }
    assert.equal((await post(first, [{ id: 'a1', kind: 'user' }, { id: 'a2', kind: 'assistant' }], false)).status, 200);
    assert.equal((await post(second, [{ id: 'b1', kind: 'user' }], false)).status, 200);
    assert.equal((await post(live, [{ id: 'l1', kind: 'user' }, { id: 'l2', kind: 'user' }, { id: 'l3', kind: 'user' }], true)).status, 200);
    assert.equal((await post(stale, [{ id: 's1', kind: 'user' }], true)).status, 200);
    assert.equal((await post(tieA, [{ id: 't1', kind: 'user' }], false)).status, 200);
    assert.equal((await post(tieB, [{ id: 'u1', kind: 'user' }], false)).status, 200);
    // Pin the timestamps. A saved share is newer than the live share, so only `isLive DESC` produces the
    // asserted order. The stale live intent is older than the 20 s window, so it drops into the saved group.
    const stamp = Date.now();
    const setUpdated = (share, updated, liveIntent) => service.db.prepare('UPDATE shares SET updated=?,live=? WHERE id=?').run(updated, liveIntent ? 1 : 0, share.id);
    setUpdated(first, stamp, false);
    setUpdated(second, stamp - 2000, false);
    setUpdated(live, stamp - 1000, true);
    setUpdated(stale, stamp - 30000, true);
    setUpdated(tieA, stamp - 5000, false);
    setUpdated(tieB, stamp - 5000, false);
    // Rule 11b: the whole directory needs one statement, not one query for each share.
    const prepare = service.db.prepare.bind(service.db);
    let calls = 0;
    service.db.prepare = (...args) => { calls++; return prepare(...args); };
    const list = await api('/api/shares').then(r => r.json());
    service.db.prepare = prepare;
    assert.equal(calls, 1);
    // Rule 11c: live shares first, then saved transcripts by `updated` descending, then id ascending.
    const tied = [tieA.id, tieB.id].sort();
    assert.deepEqual(list.map(s => s.id), [live.id, first.id, second.id, ...tied, stale.id]);
    assert.deepEqual(list.map(s => s.live), [true, false, false, false, false, false]);
    // Rule 11a: `count` is the number of stored records, independent of mode or view.
    const counts = Object.fromEntries(list.map(s => [s.id, s.count]));
    assert.deepEqual(counts, {
      [live.id]: 3, [first.id]: 2, [second.id]: 1, [stale.id]: 1, [tieA.id]: 1, [tieB.id]: 1,
    });
    // The count follows the stored records, and an upsert does not double-count an id.
    assert.equal((await post(first, [{ id: 'a3', kind: 'user' }, { id: 'a2', kind: 'assistant' }], false)).status, 200);
    const after = await api('/api/shares').then(r => r.json());
    assert.equal(after.find(s => s.id === first.id).count, 3);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('record allowlist omits credentials, metadata, images, and thinking', () => {
  assert.equal(messageRecord({ role: 'system', content: 'secret' }), null);
  const record = messageRecord({ role: 'assistant', timestamp: 123, details: { key: 'secret' }, content: [{ type: 'text', text: 'Hello' }, { type: 'thinking', thinking: 'secret' }, { type: 'image', data: 'secret' }], thinkingSignature: 'secret' });
  assert.equal(JSON.stringify(record).includes('secret'), false);
  assert.match(record.text, /Hello/);
  assert.equal(record.id, messageRecord({ role: 'assistant', timestamp: 123, content: 'updated' }).id);
  assert.equal(toolRecord({ type: 'tool_execution_end', toolCallId: 'a', toolName: 'bash', result: { content: [{ type: 'text', text: 'done' }], details: { key: 'secret' } } }).text, 'done');
  assert.ok(Buffer.byteLength(JSON.stringify(messageRecord({ role: 'user', timestamp: 1, content: '😀'.repeat(100000) }))) < 128 * 1024);
});
test('storage quota rollback and config validation', async () => {
  assert.throws(() => createService({ uploadKey: 'short' }), /24/);
  const dir = mkdtempSync(join(tmpdir(), 'pi-quota-'));
  const service = createService({ dataDir: dir, uploadKey: key, maxRecords: 1 });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const post = (path, data, token) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(data) });
  try {
    const share = await post('/api/shares', { title: 'Quota' }, key).then(r => r.json());
    const result = await post(`/api/shares/${share.id}/records`, { live: true, records: [{ id: '1', kind: 'user' }, { id: '2', kind: 'user' }] }, share.ownerKey);
    assert.equal(result.status, 413);
    assert.equal((await fetch(base + `/api/shares/${share.id}`).then(r => r.json())).records.length, 0);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});
