import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createService, SCHEMA_VERSION, migrations } from '../server/index.mjs';

const key = 'test-migration-key-at-least-24-chars';
const fixtures = new URL('./fixtures/', import.meta.url);

test('each service schema change adds one ordered migration', () => {
  // Rule 22: each schema change increments the version by one.
  assert.equal(migrations.length, SCHEMA_VERSION);
});

test('health reports the active schema version as an integer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-health-'));
  const service = createService({ dataDir: dir, uploadKey: key });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  try {
    // Rule 10a.
    const health = await fetch(base + '/health').then(r => r.json());
    assert.deepEqual(health, { ok: true, schema: SCHEMA_VERSION });
    assert.equal(Number.isInteger(health.schema), true);
    assert.equal(service.schemaVersion, SCHEMA_VERSION);
    assert.equal(service.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('each released fixture database migrates to the current schema without data loss', async () => {
  // Rule 24: one fixture for each released schema version.
  const files = readdirSync(fixtures).filter(name => /^schema-\d+\.sqlite$/.test(name));
  assert.notEqual(files.length, 0);
  for (const file of files) {
    const dir = mkdtempSync(join(tmpdir(), 'pi-schema-fixture-'));
    copyFileSync(new URL(file, fixtures), join(dir, 'history.sqlite'));
    let service;
    try {
      const before = new DatabaseSync(join(dir, 'history.sqlite'));
      const oldVersion = before.prepare('PRAGMA user_version').get().user_version;
      const share = before.prepare('SELECT id,title FROM shares').get();
      const record = before.prepare('SELECT id,body FROM records').get();
      before.close();
      assert.equal(Number(basename(file, '.sqlite').slice('schema-'.length)), oldVersion);
      assert.ok(oldVersion < SCHEMA_VERSION);

      service = createService({ dataDir: dir, uploadKey: key });
      // Rules 17 and 21: the fixture migrates to the current version and keeps its data.
      assert.equal(service.schemaVersion, SCHEMA_VERSION);
      assert.equal(service.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.deepEqual({ ...service.db.prepare('SELECT id,title FROM shares WHERE id=?').get(share.id) }, { ...share });
      assert.deepEqual({ ...service.db.prepare('SELECT id,body FROM records WHERE id=?').get(record.id) }, { ...record });
    } finally {
      await service?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a newer database is refused and the error names both versions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-newer-'));
  const newer = SCHEMA_VERSION + 1;
  const db = new DatabaseSync(join(dir, 'history.sqlite'));
  db.exec(`PRAGMA user_version=${newer}; CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('unchanged');`);
  db.close();
  try {
    // Rule 20.
    assert.throws(
      () => createService({ dataDir: dir, uploadKey: key }),
      error => error.message.includes(`Database schema version ${newer}`) && error.message.includes(`service schema version ${SCHEMA_VERSION}`),
    );
    const after = new DatabaseSync(join(dir, 'history.sqlite'));
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, newer);
    assert.equal(after.prepare('SELECT value FROM keep').get().value, 'unchanged');
    after.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed migration rolls back and stops startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-fail-'));
  const db = new DatabaseSync(join(dir, 'history.sqlite'));
  // `record_order` is a table, so the v0.1.0 index of the same name cannot be created.
  db.exec(`CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('unchanged'); CREATE TABLE record_order (value TEXT);`);
  db.close();
  try {
    // Rules 18 and 19: the pending steps run in one transaction and the service does not start.
    assert.throws(() => createService({ dataDir: dir, uploadKey: key }), /record_order/);
    const after = new DatabaseSync(join(dir, 'history.sqlite'));
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(after.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='shares'").get().n, 0);
    assert.equal(after.prepare('SELECT value FROM keep').get().value, 'unchanged');
    after.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the startup log reports the active schema version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-log-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATA_DIR: dir, UPLOAD_KEY: key, PUBLIC_URL: 'http://localhost:9080', PORT: '0', HOST: '127.0.0.1' },
  });
  child.stdout.setEncoding('utf8');
  const exit = new Promise(resolve => child.once('exit', resolve));
  try {
    const output = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error(`Startup log timed out: ${text}`)), 15000);
      child.stdout.on('data', chunk => {
        text += chunk;
        // Rule 23.
        if (text.includes(`schema version ${SCHEMA_VERSION}`)) {
          clearTimeout(timer); resolve(text);
        }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { if (!text.includes(`schema version ${SCHEMA_VERSION}`)) { clearTimeout(timer); reject(new Error(`Startup exited with ${code}: ${text}`)); } });
    });
    assert.match(output, new RegExp(`schema version ${SCHEMA_VERSION}`));
  } finally {
    child.kill();
    await exit;
    rmSync(dir, { recursive: true, force: true });
  }
});
