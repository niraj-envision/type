/* ─────────────────────────────────────────────────────────────────
   leaderboard.js — the client for the leaderboard API.

   Only the network and the rules live here; the drawer and the results
   prompt are drawn by app.js, which owns the DOM and the config. If no
   API URL is configured (js/config.js) `enabled` is false and nothing
   here ever touches the network.

   What gets sent, and only when you press submit: your chosen name, a
   random id for this browser (so your own runs replace each other
   instead of filling the board), the numbers on the results screen,
   and the keystroke log of that one run so the server can replay it
   and check the numbers for itself. No account, no email, no cookies.
   ───────────────────────────────────────────────────────────────── */
window.Leaderboard = (() => {
  'use strict';

  const API = String((window.TYPE_CONFIG || {}).leaderboard || '').trim().replace(/\/+$/, '');

  /* The boards: the standard tests, english list, no punctuation or
     numbers — the same test for everybody, or a rank means nothing. */
  const TIMES = [15, 30, 60, 120], COUNTS = [10, 25, 50, 100];
  const BOARDS = [...TIMES.map(t => 'time-' + t), ...COUNTS.map(n => 'words-' + n)];
  const MIN_ACC = 80;                     // below this a run is practice, not a rank
  const MAX_NAME = 20;

  function boardFor(cfg) {
    if (cfg.punctuation || cfg.numbers || cfg.wordList !== 'english') return null;
    if (cfg.mode === 'time' && TIMES.includes(+cfg.time)) return 'time-' + cfg.time;
    if (cfg.mode === 'words' && COUNTS.includes(+cfg.wordCount)) return 'words-' + cfg.wordCount;
    return null;
  }

  /* A random id per browser, kept in localStorage. It identifies the
     device to the board, nothing more — it is not tied to a person. */
  let deviceId = null;
  function device() {
    if (deviceId) return deviceId;
    try { deviceId = localStorage.getItem('type.device'); } catch { /* private mode */ }
    if (!deviceId || !/^[0-9a-f-]{20,40}$/.test(deviceId)) {
      deviceId = (crypto.randomUUID && crypto.randomUUID()) ||
        Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem('type.device', deviceId); } catch { /* fine */ }
    }
    return deviceId;
  }

  const cleanName = n => String(n || '')
    .replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

  async function request(path, opts = {}) {
    if (!API) throw new Error('no leaderboard configured');
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(API + path, { ...opts, signal: ctl && ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        /* the server answered, and said no — different from not answering */
        throw Object.assign(new Error(data.error || ('server said ' + res.status)), { refused: !!data.error });
      }
      return data;
    } finally { if (timer) clearTimeout(timer); }
  }

  return {
    enabled: !!API, API, BOARDS, MIN_ACC, MAX_NAME,
    boardFor, device, cleanName,
    label: board => board.replace('-', ' '),

    /* period: 'day' (last 24 hours) or 'all' */
    fetchBoard(board, period) {
      return request(`/v1/board?board=${encodeURIComponent(board)}&period=${period}&device=${encodeURIComponent(device())}`);
    },
    submit(payload) {
      return request('/v1/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    /* With no server, the board is the best runs on this device. */
    localBoard(history, board) {
      return history.filter(r => r.key === board && r.acc >= MIN_ACC)
        .sort((a, b) => b.wpm - a.wpm || b.acc - a.acc).slice(0, 10);
    }
  };
})();
