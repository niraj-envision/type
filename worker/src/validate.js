/* ─────────────────────────────────────────────────────────────────
   validate.js — decides whether a submitted run is real enough to rank.

   A typing test runs entirely in the browser, so the server can never
   *know* a result is honest. What it can do is refuse to take the
   client's word for it: every submission carries the words that were
   shown and the log of every keystroke, and the server replays that log
   with the same code the page uses (js/replay.js) and ranks what the
   replay says, not what the client claimed. On top of that it checks
   the run for things a person cannot do: more than about fifty
   keystrokes a second, or a hundred keys landing at exactly the same
   interval.

   None of this stops a determined cheat with a script that forges a
   plausible log. It stops the easy ones, which is what a hobby
   leaderboard needs.
   ───────────────────────────────────────────────────────────────── */
import Replay from '../../js/replay.js';
import WORDS from '../../js/words.js';

export const BOARDS = {
  'time-15':   { mode: 'time',  time: 15 },
  'time-30':   { mode: 'time',  time: 30 },
  'time-60':   { mode: 'time',  time: 60 },
  'time-120':  { mode: 'time',  time: 120 },
  'words-10':  { mode: 'words', count: 10 },
  'words-25':  { mode: 'words', count: 25 },
  'words-50':  { mode: 'words', count: 50 },
  'words-100': { mode: 'words', count: 100 }
};

export const LIMITS = {
  maxWpm: 320,             // the fastest verified humans on short tests sit around 300
  maxRaw: 420,
  minAcc: 80,              // below this it is practice, not a rank
  maxLog: 8000,            // keystrokes: 120 s at 300 wpm is ~3000
  maxWords: 1200,
  maxName: 20,
  burstWindowMs: 250,      // no more than `burstMax` keys inside any window this long
  burstMax: 12,            // = 48 keys a second
  minIntervalSd: 6,        // ms; a script with a fixed delay has no jitter at all
  maxSameInterval: 0.5,    // no one interval value may account for more than half the keys
  minKeysForRegularity: 40,
  fastGapMs: 20,           // a log squeezed to look faster is full of gaps no hand produces
  maxFastFraction: 0.05,
  timeSlack: 1.5,          // seconds a timed test may run past its clock (a slow tab)
  endSlackMs: 60           // for a words test, `seconds` must agree with the last keystroke
};

const ENGLISH = new Set(WORDS.english);
const fail = error => ({ ok: false, error });

export const cleanName = n => String(n || '')
  .replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.maxName);

function stddev(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/* Timing checks on the accepted keystrokes: bursts a hand cannot produce,
   and intervals too regular to be a hand at all. */
export function checkTiming(log) {
  const times = [];
  for (const ev of log) if (ev[2] !== 'r') times.push(ev[0]);
  for (let i = 0, j = 0; i < times.length; i++) {
    while (times[i] - times[j] > LIMITS.burstWindowMs) j++;
    if (i - j + 1 > LIMITS.burstMax) return 'faster than a human hand';
  }
  if (times.length >= LIMITS.minKeysForRegularity) {
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    if (gaps.filter(g => g < LIMITS.fastGapMs).length / gaps.length > LIMITS.maxFastFraction) return 'faster than a human hand';
    if (stddev(gaps) < LIMITS.minIntervalSd) return 'keystrokes are too regular to be typed';
    const counts = new Map();
    let top = 0;
    for (const g of gaps) { const c = (counts.get(g) || 0) + 1; counts.set(g, c); if (c > top) top = c; }
    if (top / gaps.length > LIMITS.maxSameInterval) return 'keystrokes are too regular to be typed';
  }
  return null;
}

export function validate(p) {
  if (!p || typeof p !== 'object') return fail('bad payload');
  const board = BOARDS[p.board];
  if (!board) return fail('unknown board');
  if (p.mode !== board.mode) return fail('mode does not match the board');
  if (board.mode === 'time' && +p.time !== board.time) return fail('duration does not match the board');
  if (board.mode === 'words' && +p.wordCount !== board.count) return fail('word count does not match the board');
  if (p.list !== 'english' || p.punctuation || p.numbers) return fail('only the plain english test is ranked');

  const name = cleanName(p.name) || 'anonymous';
  const device = String(p.device || '');
  if (!/^[0-9a-f-]{20,40}$/.test(device)) return fail('bad device id');

  const words = p.words;
  if (!Array.isArray(words) || !words.length || words.length > LIMITS.maxWords) return fail('bad word list');
  for (const w of words) {
    if (typeof w !== 'string' || !/^[a-z]+$/.test(w) || !ENGLISH.has(w)) return fail('words are not from the english list');
  }
  if (board.mode === 'words' && words.length !== board.count) return fail('word count does not match the board');

  const log = p.log;
  if (!Array.isArray(log) || !log.length || log.length > LIMITS.maxLog) return fail('bad keystroke log');
  let last = -1;
  for (const ev of log) {
    if (!Array.isArray(ev) || !Number.isInteger(ev[0]) || ev[0] < 0 || ev[0] < last) return fail('bad keystroke log');
    if (typeof ev[1] !== 'string' || ev[1].length !== 1) return fail('bad keystroke log');
    if (ev.length > 2 && ev[2] !== 'r') return fail('bad keystroke log');
    last = ev[0];
  }
  if (log[0][0] !== 0) return fail('the log does not start at the first keystroke');

  const seconds = +p.seconds;
  if (!(seconds > 0) || !Number.isFinite(seconds)) return fail('bad duration');
  if (board.mode === 'time' && (seconds < board.time || seconds > board.time + LIMITS.timeSlack)) return fail('duration does not match the clock');
  if (last > seconds * 1000 + LIMITS.endSlackMs) return fail('keystrokes after the end of the test');

  const run = Replay.run({ mode: p.mode, words, log, wordCount: board.count, seconds });
  if (!run) return fail('the log does not replay');
  if (board.mode === 'words') {
    if (!run.finished) return fail('the test was not finished');
    if (Math.abs(seconds * 1000 - run.endT) > LIMITS.endSlackMs) return fail('duration does not match the last keystroke');
  }

  const s = Replay.score(run, seconds);
  const c = p.claimed || {};
  if (c.chars !== undefined && c.chars !== s.chars) return fail('the claimed characters do not match the replay');
  if (c.wpm !== undefined && Math.abs(+c.wpm - s.wpm) > 1) return fail('the claimed wpm does not match the replay');
  if (c.acc !== undefined && Math.abs(+c.acc - s.acc) > 0.2) return fail('the claimed accuracy does not match the replay');

  if (s.acc < LIMITS.minAcc) return fail(`accuracy under ${LIMITS.minAcc}%`);
  if (s.wpm > LIMITS.maxWpm || s.raw > LIMITS.maxRaw) return fail('faster than a human hand');
  if (s.wpm < 1) return fail('nothing was typed');
  const timing = checkTiming(log);
  if (timing) return fail(timing);

  return {
    ok: true,
    result: {
      board: p.board, device, name,
      wpm: s.wpm, raw: s.raw, acc: s.acc, consistency: s.consistency,
      seconds: Math.round(seconds * 1000) / 1000
    }
  };
}
