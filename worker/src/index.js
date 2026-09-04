/* ─────────────────────────────────────────────────────────────────
   index.js — the leaderboard API, a Cloudflare Worker over a D1
   (SQLite) database. Three routes:

     GET  /v1/health
     GET  /v1/board?board=time-30&period=all|day&device=<id>
     POST /v1/submit          the payload built by js/app.js `evidence()`

   Two tables (schema.sql): `runs` is every accepted run, which gives the
   last-24-hours board and the rate limit; `scores` is one row per
   device per board — your best — which is the all-time board.

   Privacy: the only thing stored about where a run came from is a
   salted hash of the IP address, kept for the rate limit and gone with
   the run after thirty days.
   ───────────────────────────────────────────────────────────────── */
import { validate, BOARDS } from './validate.js';

const LIMIT = 100;                       // rows per board
const DAY = 86400000;
const KEEP_RUNS_DAYS = 30;

const json = (data, status, headers) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

function corsHeaders(env, req) {
  const origin = req.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allow = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : (allowed[0] || 'null'));
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'vary': 'origin'
  };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/* ── GET /v1/board ────────────────────────────────────────────────── */
async function board(env, url) {
  const b = url.searchParams.get('board');
  if (!BOARDS[b]) return { ok: false, error: 'unknown board' };
  const period = url.searchParams.get('period') === 'day' ? 'day' : 'all';
  const device = url.searchParams.get('device') || '';
  const since = Date.now() - DAY;

  let rows, total, you = null;
  if (period === 'all') {
    rows = (await env.DB.prepare(
      `SELECT device, name, wpm, raw, acc, consistency, ts FROM scores
       WHERE board = ? ORDER BY wpm DESC, acc DESC, ts ASC LIMIT ?`).bind(b, LIMIT).all()).results;
    total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE board = ?').bind(b).first('n');
    if (device) {
      const mine = await env.DB.prepare('SELECT wpm FROM scores WHERE board = ? AND device = ?').bind(b, device).first();
      if (mine) {
        const rank = await env.DB.prepare('SELECT COUNT(*) + 1 AS r FROM scores WHERE board = ? AND wpm > ?').bind(b, mine.wpm).first('r');
        you = { rank, wpm: mine.wpm };
      }
    }
  } else {
    /* SQLite keeps the other columns from the row that holds the MAX */
    rows = (await env.DB.prepare(
      `SELECT device, name, MAX(wpm) AS wpm, raw, acc, consistency, ts FROM runs
       WHERE board = ? AND ts >= ? GROUP BY device ORDER BY wpm DESC, acc DESC, ts ASC LIMIT ?`).bind(b, since, LIMIT).all()).results;
    total = await env.DB.prepare('SELECT COUNT(DISTINCT device) AS n FROM runs WHERE board = ? AND ts >= ?').bind(b, since).first('n');
    if (device) {
      const mine = await env.DB.prepare('SELECT MAX(wpm) AS wpm FROM runs WHERE board = ? AND device = ? AND ts >= ?').bind(b, device, since).first();
      if (mine && mine.wpm !== null) {
        const rank = await env.DB.prepare(
          `SELECT COUNT(*) + 1 AS r FROM (SELECT device, MAX(wpm) AS w FROM runs WHERE board = ? AND ts >= ? GROUP BY device) WHERE w > ?`)
          .bind(b, since, mine.wpm).first('r');
        you = { rank, wpm: mine.wpm };
      }
    }
  }
  const entries = rows.map((r, i) => ({
    rank: i + 1, name: r.name, wpm: r.wpm, raw: r.raw, acc: r.acc, consistency: r.consistency, ts: r.ts,
    you: !!device && r.device === device || undefined
  }));
  return { ok: true, board: b, period, entries, total: total || 0, you };
}

/* ── POST /v1/submit ──────────────────────────────────────────────── */
async function submit(env, req, ctx) {
  const text = await req.text();
  if (text.length > 400000) return { ok: false, error: 'payload too large' };
  let p;
  try { p = JSON.parse(text); } catch { return { ok: false, error: 'bad json' }; }
  const v = validate(p);
  if (!v.ok) return v;
  const r = v.result;

  const ip = req.headers.get('cf-connecting-ip') || '0.0.0.0';
  const ipHash = await sha256(ip + '|' + (env.SALT || 'type'));
  const now = Date.now();
  const limit = +(env.RATE_LIMIT || 40);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM runs WHERE ip = ? AND ts >= ?').bind(ipHash, now - 3600000).first('n');
  if (recent >= limit) return { ok: false, error: 'too many submissions from this network — try again in an hour' };

  const prev = await env.DB.prepare('SELECT wpm FROM scores WHERE board = ? AND device = ?').bind(r.board, r.device).first();
  const best = !prev || r.wpm > prev.wpm;

  const stmts = [
    env.DB.prepare(
      `INSERT INTO runs (board, device, name, wpm, raw, acc, consistency, seconds, ts, ip) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(r.board, r.device, r.name, r.wpm, r.raw, r.acc, r.consistency, r.seconds, now, ipHash)
  ];
  if (best) {
    stmts.push(env.DB.prepare(
      `INSERT INTO scores (board, device, name, wpm, raw, acc, consistency, seconds, ts) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(board, device) DO UPDATE SET name = excluded.name, wpm = excluded.wpm, raw = excluded.raw,
         acc = excluded.acc, consistency = excluded.consistency, seconds = excluded.seconds, ts = excluded.ts`)
      .bind(r.board, r.device, r.name, r.wpm, r.raw, r.acc, r.consistency, r.seconds, now));
  } else {
    /* a renamed player keeps their best under the new name */
    stmts.push(env.DB.prepare('UPDATE scores SET name = ? WHERE board = ? AND device = ?').bind(r.name, r.board, r.device));
  }
  await env.DB.batch(stmts);

  const bestWpm = best ? r.wpm : prev.wpm;
  const rankAll = await env.DB.prepare('SELECT COUNT(*) + 1 AS r FROM scores WHERE board = ? AND wpm > ?').bind(r.board, bestWpm).first('r');
  const dayBest = await env.DB.prepare('SELECT MAX(wpm) AS w FROM runs WHERE board = ? AND device = ? AND ts >= ?').bind(r.board, r.device, now - DAY).first('w');
  const rankDay = await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM (SELECT device, MAX(wpm) AS w FROM runs WHERE board = ? AND ts >= ? GROUP BY device) WHERE w > ?`)
    .bind(r.board, now - DAY, dayBest).first('r');

  /* housekeeping, now and then: old runs are not needed for anything */
  if (Math.random() < 0.02) {
    const sweep = env.DB.prepare('DELETE FROM runs WHERE ts < ?').bind(now - KEEP_RUNS_DAYS * DAY).run();
    if (ctx && ctx.waitUntil) ctx.waitUntil(sweep); else await sweep;
  }

  return { ok: true, best, wpm: r.wpm, bestWpm, rankAll, rankDay };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const headers = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      if (url.pathname === '/v1/health') return json({ ok: true, boards: Object.keys(BOARDS) }, 200, headers);
      if (url.pathname === '/v1/board' && req.method === 'GET') {
        const r = await board(env, url);
        return json(r, r.ok ? 200 : 400, headers);
      }
      if (url.pathname === '/v1/submit' && req.method === 'POST') {
        const r = await submit(env, req, ctx);
        return json(r, r.ok ? 200 : (/too many/.test(r.error) ? 429 : 400), headers);
      }
      return json({ ok: false, error: 'not found' }, 404, headers);
    } catch (e) {
      return json({ ok: false, error: 'server error: ' + (e && e.message ? e.message : e) }, 500, headers);
    }
  }
};
