import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, createService, SCHEMA_VERSION, migrations } from '../server/index.mjs';

const key = 'test-migration-key-at-least-24-chars';
const fixtures = new URL('./fixtures/', import.meta.url);
const remove = dir => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const withDatabase = (path, run) => {
  const db = new DatabaseSync(path);
  try { return run(db); } finally { db.close(); }
};
const rows = (db, table, columns) => db.prepare(`SELECT ${columns ? columns.map(name => `"${name}"`).join(',') : '*'} FROM ${table} ORDER BY 1,2`).all().map(row => ({ ...row }));
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);

test('each service schema change adds one ordered migration', () => {
  // Rule 22: each schema change increments the version by one.
  assert.equal(migrations.length, SCHEMA_VERSION);
  for (let version = 0; version < SCHEMA_VERSION; version++) assert.equal(typeof migrations[version], 'function');
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
    assert.equal(service.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally { await service.close(); remove(dir); }
});

test('each released fixture database migrates to the current schema without data loss', async () => {
  // Rule 24: one fixture for each released schema version.
  const files = readdirSync(fixtures).filter(name => /^schema-\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(basename(a, '.sqlite').slice('schema-'.length)) - Number(basename(b, '.sqlite').slice('schema-'.length)));
  assert.deepEqual(
    files.map(file => Number(basename(file, '.sqlite').slice('schema-'.length))),
    Array.from({ length: SCHEMA_VERSION }, (_, version) => version),
  );
  for (const file of files) {
    const dir = mkdtempSync(join(tmpdir(), 'pi-schema-fixture-'));
    copyFileSync(new URL(file, fixtures), join(dir, 'history.sqlite'));
    let service;
    try {
      const before = withDatabase(join(dir, 'history.sqlite'), db => ({
        version: db.prepare('PRAGMA user_version').get().user_version,
        sharesColumns: columns(db, 'shares'),
        recordsColumns: columns(db, 'records'),
        shares: rows(db, 'shares'),
        records: rows(db, 'records'),
      }));
      assert.equal(Number(basename(file, '.sqlite').slice('schema-'.length)), before.version);
      assert.ok(before.version < SCHEMA_VERSION);
      assert.notEqual(before.shares.length, 0);
      assert.notEqual(before.records.length, 0);

      service = createService({ dataDir: dir, uploadKey: key });
      // Rules 17 and 21: the fixture migrates to the current version and keeps every row and column.
      assert.equal(service.schemaVersion, SCHEMA_VERSION);
      assert.equal(service.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.deepEqual(rows(service.db, 'shares', before.sharesColumns), before.shares);
      assert.deepEqual(rows(service.db, 'records', before.recordsColumns), before.records);
    } finally {
      await service?.close();
      remove(dir);
    }
  }
});

test('a newer database is refused and the error names both versions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-newer-'));
  const newer = SCHEMA_VERSION + 1;
  withDatabase(join(dir, 'history.sqlite'), db => db.exec(`PRAGMA user_version=${newer}; CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('unchanged');`));
  try {
    // Rule 20.
    assert.throws(
      () => createService({ dataDir: dir, uploadKey: key }),
      error => error.message.includes(`Database schema version ${newer}`) && error.message.includes(`service schema version ${SCHEMA_VERSION}`),
    );
    const after = withDatabase(join(dir, 'history.sqlite'), db => ({
      version: db.prepare('PRAGMA user_version').get().user_version,
      journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
      shares: db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='shares'").get().n,
      value: db.prepare('SELECT value FROM keep').get().value,
    }));
    assert.deepEqual(after, { version: newer, journal: 'delete', shares: 0, value: 'unchanged' });
  } finally { remove(dir); }
});

test('a failed migration rolls back and stops startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-fail-'));
  // `record_order` is a table, so the v0.1.0 index of the same name cannot be created.
  withDatabase(join(dir, 'history.sqlite'), db => db.exec(`CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('unchanged'); CREATE TABLE record_order (value TEXT);`));
  try {
    // Rules 18 and 19: the pending steps run in one transaction and the service does not start.
    assert.throws(() => createService({ dataDir: dir, uploadKey: key }), /record_order/);
    const after = withDatabase(join(dir, 'history.sqlite'), db => ({
      version: db.prepare('PRAGMA user_version').get().user_version,
      journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
      shares: db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='shares'").get().n,
      value: db.prepare('SELECT value FROM keep').get().value,
    }));
    assert.deepEqual(after, { version: 0, journal: 'delete', shares: 0, value: 'unchanged' });
    // A leaked connection would keep the database files open on Windows.
    assert.deepEqual(readdirSync(dir), ['history.sqlite']);
  } finally { remove(dir); }
});

test('ordered migrations run in one transaction and roll back the version bump', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-order-'));
  const file = join(dir, 'history.sqlite');
  const order = [];
  const steps = [
    db => { order.push(1); db.exec('CREATE TABLE first_step (value TEXT)'); },
    db => { order.push(2); throw new Error('second step failed'); },
  ];
  try {
    // Rule 18: steps run in order. Rule 19: a failed step leaves no schema or version change.
    withDatabase(file, db => {
      assert.throws(() => applyMigrations(db, { target: 2, steps }), /second step failed/);
      assert.deepEqual(order, [1, 2]);
    });
    const after = withDatabase(file, db => ({
      version: db.prepare('PRAGMA user_version').get().user_version,
      firstStep: db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='first_step'").get().n,
    }));
    assert.deepEqual(after, { version: 0, firstStep: 0 });
  } finally { remove(dir); }
});

test('the startup log reports the active schema version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-schema-log-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATA_DIR: dir, UPLOAD_KEY: key, PUBLIC_URL: 'http://localhost:9080', PORT: '0', HOST: '127.0.0.1' },
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const exit = new Promise(resolve => child.once('exit', resolve));
  let stdout = '', stderr = '';
  try {
    const output = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup log timed out: ${stdout}${stderr}`)), 15000);
      child.stdout.on('data', chunk => {
        stdout += chunk;
        // Rule 23.
        if (stdout.includes(`schema version ${SCHEMA_VERSION}`)) {
          clearTimeout(timer); resolve(stdout);
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        if (!stdout.includes(`schema version ${SCHEMA_VERSION}`)) {
          clearTimeout(timer); reject(new Error(`Startup exited with ${code}: ${stdout}${stderr}`));
        }
      });
    });
    assert.match(output, new RegExp(`listening on port \\d+ with schema version ${SCHEMA_VERSION}`));
  } finally {
    child.kill();
    await exit;
    remove(dir);
  }
});
