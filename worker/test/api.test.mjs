/* Tests for the worker's routes, against an in-memory SQLite that stands in
   for D1 (same SQL, same schema.sql). Run from worker/: `npm test`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/* Just enough of D1's API: prepare().bind().all()/first()/run() and batch(). */
class FakeD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(schema); }
  prepare(sql) {
    const db = this.db;
    return {
      params: [],
      bind(...p) { this.params = p; return this; },
      async all() { return { results: db.prepare(sql).all(...this.params), success: true }; },
      async first(col) { const row = db.prepare(sql).get(...this.params); if (row === undefined) return null; return col ? row[col] : row; },
      async run() { const info = db.prepare(sql).run(...this.params); return { success: true, meta: { changes: info.changes } }; }
    };
  }
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; }
}

const makeEnv = (extra = {}) => ({ DB: new FakeD1(), SALT: 'test', RATE_LIMIT: '5', ALLOWED_ORIGINS: '*', ...extra });
const ctx = { waitUntil: p => p };
const call = (env, path, init = {}, ip = '1.2.3.4') =>
  worker.fetch(new Request('https://api.test' + path, { ...init, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, origin: 'https://type.test', ...(init.headers || {}) } }), env, ctx);
const post = (env, body, ip) => call(env, '/v1/submit', { method: 'POST', body: JSON.stringify(body) }, ip);

test('health and cors', async () => {
  const env = makeEnv();
  const res = await call(env, '/v1/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.boards.slice(0, 2), ['time-15', 'time-30']);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const pre = await call(env, '/v1/submit', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await call(env, '/nope')).status, 404);
});

test('cors can be restricted to listed origins', async () => {
  const env = makeEnv({ ALLOWED_ORIGINS: 'https://type.test, https://other.test' });
  assert.equal((await call(env, '/v1/health')).headers.get('access-control-allow-origin'), 'https://type.test');
  const res = await worker.fetch(new Request('https://api.test/v1/health', { headers: { origin: 'https://evil.test' } }), env, ctx);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://type.test');
});

test('a run is accepted, ranked, and its best kept per device', async () => {
  const env = makeEnv();
  const p = fixture('words-25');
  let res = await post(env, p);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.best, true);
  assert.equal(data.rankAll, 1);
  assert.equal(data.rankDay, 1);
  assert.equal(data.wpm, p.claimed.wpm);

  /* the same run again is not a new best, and the board still has one row */
  res = await post(env, p);
  data = await res.json();
  assert.equal(data.best, false);
  assert.equal(data.rankAll, 1);

  const board = await (await call(env, `/v1/board?board=words-25&period=all&device=${p.device}`)).json();
  assert.equal(board.total, 1);
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].you, true);
  assert.equal(board.entries[0].name, p.name);
  assert.equal(board.you.rank, 1);
  const other = await (await call(env, '/v1/board?board=words-25&period=all&device=ffffffffffffffffffff')).json();
  assert.equal(other.entries[0].you, undefined);
  assert.equal(other.you, null);
});

test('a faster device outranks a slower one, on both boards', async () => {
  const env = makeEnv();
  const slow = fixture('words-10');
  /* the same run, a tenth faster, from another device — the claim is dropped so the replay decides */
  const fast = JSON.parse(JSON.stringify(slow));
  fast.device = 'abcdefabcdefabcdefabcdef';
  fast.name = 'speedy';
  fast.log = fast.log.map(([t, k, f]) => f ? [Math.round(t * 0.9), k, f] : [Math.round(t * 0.9), k]);
  fast.seconds = fast.log[fast.log.length - 1][0] / 1000;
  delete fast.claimed;

  const a = await (await post(env, slow, '1.1.1.1')).json();
  assert.equal(a.ok, true, a.error);
  const b = await (await post(env, fast, '2.2.2.2')).json();
  assert.equal(b.ok, true, b.error);
  assert.ok(b.wpm > a.wpm);
  assert.equal(b.rankAll, 1);
  assert.equal(b.rankDay, 1);

  const all = await (await call(env, `/v1/board?board=words-10&period=all&device=${slow.device}`)).json();
  assert.deepEqual(all.entries.map(e => e.name), ['speedy', slow.name]);
  assert.equal(all.you.rank, 2);
  const day = await (await call(env, `/v1/board?board=words-10&period=day&device=${slow.device}`)).json();
  assert.deepEqual(day.entries.map(e => e.rank), [1, 2]);
  assert.equal(day.entries[1].you, true);
  assert.equal(day.total, 2);
});

test('an invalid run is refused with a reason', async () => {
  const env = makeEnv();
  const p = fixture('words-10'); p.claimed.wpm = 900;
  const res = await post(env, p);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /does not match/);
  assert.equal((await post(env, { board: 'time-15' })).status, 400);
  const bad = await call(env, '/v1/submit', { method: 'POST', body: '{not json' });
  assert.equal(bad.status, 400);
});

test('too many submissions from one address are throttled', async () => {
  const env = makeEnv({ RATE_LIMIT: '3' });
  const p = fixture('words-10');
  for (let i = 0; i < 3; i++) assert.equal((await post(env, p, '9.9.9.9')).status, 200);
  const res = await post(env, p, '9.9.9.9');
  assert.equal(res.status, 429);
  assert.equal((await post(env, p, '8.8.8.8')).status, 200);       // another address is fine
});

test('an unknown board is a 400', async () => {
  const env = makeEnv();
  assert.equal((await call(env, '/v1/board?board=nope')).status, 400);
});
