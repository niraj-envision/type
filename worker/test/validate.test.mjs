/* Tests for the run validator. Run from worker/: `npm test` (node --test). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validate, checkTiming, LIMITS } from '../src/validate.js';
import WORDS from '../../js/words.js';

const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));

/* a deterministic pseudo-random source, so the synthetic runs are stable */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* A synthetic but human-looking log: `gap` ms between keys, jittered by
   ±`jitter`, an `err` chance per letter of a wrong key that is then
   backspaced. Ends on the last letter of the last word, like a words test. */
function synth(words, { gap = 120, jitter = 50, err = 0, seed = 7 } = {}) {
  const rnd = prng(seed);
  const g = () => Math.round(gap + (rnd() * 2 - 1) * jitter);
  let t = 0; const log = [];
  words.forEach((w, i) => {
    for (const ch of w) {
      if (rnd() < err) { log.push([t, 'x']); t += g(); log.push([t, '\b']); t += g(); }
      log.push([t, ch]); t += g();
    }
    if (i < words.length - 1) { log.push([t, ' ']); t += g(); }
  });
  return log;
}
const pickWords = (n, seed = 3) => { const rnd = prng(seed); return Array.from({ length: n }, () => WORDS.english[Math.floor(rnd() * WORDS.english.length)]); };
const wordsRun = (n, opts = {}, extra = {}) => {
  const words = pickWords(n, opts.seed);
  const log = synth(words, opts);
  return { v: 1, board: `words-${n}`, name: 'synthetic', device: '0123456789abcdef0123', mode: 'words', wordCount: n,
           list: 'english', punctuation: false, numbers: false, words, log, seconds: log[log.length - 1][0] / 1000, ...extra };
};

for (const name of ['words-10', 'words-25', 'time-15']) {
  test(`accepts a real ${name} run and recomputes exactly what the page showed`, () => {
    const p = fixture(name);
    const v = validate(p);
    assert.equal(v.ok, true, v.error);
    assert.equal(v.result.wpm, p.claimed.wpm);
    assert.equal(v.result.raw, p.claimed.raw);
    assert.equal(v.result.acc, p.claimed.acc);
    assert.equal(v.result.board, name);
    assert.ok(Math.abs(v.result.consistency - p.claimed.consistency) <= 3, `consistency ${v.result.consistency} vs ${p.claimed.consistency}`);
  });
}

test('ranks the replay, not the claim: an inflated wpm is refused', () => {
  const p = fixture('words-25'); p.claimed.wpm += 40;
  assert.match(validate(p).error, /wpm does not match/);
});

test('a claim of more correct characters than the log produces is refused', () => {
  const p = fixture('words-25'); p.claimed.chars = '999/0/0/0';
  assert.match(validate(p).error, /characters do not match/);
});

test('a log squeezed in time to look faster is refused', () => {
  const p = fixture('words-25');
  p.log = p.log.map(([t, k, f]) => f ? [Math.round(t / 4), k, f] : [Math.round(t / 4), k]);
  p.seconds = p.seconds / 4;
  delete p.claimed;
  assert.match(validate(p).error, /faster than a human hand/);
});

test('a timed test cannot claim a shorter clock than its board', () => {
  const p = fixture('time-15'); p.seconds = 9; delete p.claimed;
  assert.match(validate(p).error, /clock/);
});

test('keystrokes after the clock ran out are refused', () => {
  const p = fixture('time-15'); p.log.push([20000, 'a']); delete p.claimed;
  assert.match(validate(p).error, /after the end/);
});

test('words must come from the english list', () => {
  const p = fixture('words-10'); p.words[0] = 'zzzzq';
  assert.match(validate(p).error, /english list/);
});

test('punctuation, numbers and other lists are not ranked', () => {
  const p = fixture('words-10'); p.punctuation = true;
  assert.match(validate(p).error, /plain english/);
  const q = fixture('words-10'); q.list = 'english 1k';
  assert.match(validate(q).error, /plain english/);
});

test('the board must match the test', () => {
  const p = fixture('words-10'); p.board = 'words-25';
  assert.equal(validate(p).ok, false);
  const q = fixture('words-10'); q.board = 'time-15';
  assert.equal(validate(q).ok, false);
  assert.equal(validate({ ...fixture('words-10'), board: 'nope' }).error, 'unknown board');
});

test('a log with a fixed interval is a script, not a person', () => {
  const p = wordsRun(25, { gap: 100, jitter: 0 });
  assert.match(validate(p).error, /too regular/);
});

test('a log with only a little jitter is still a script', () => {
  const p = wordsRun(25, { gap: 100, jitter: 4 });
  assert.match(validate(p).error, /too regular/);
});

test('a jittered synthetic run passes and is scored by the replay', () => {
  const p = wordsRun(25, { gap: 110, jitter: 45 });
  const v = validate(p);
  assert.equal(v.ok, true, v.error);
  assert.ok(v.result.wpm > 80 && v.result.wpm < 130, String(v.result.wpm));
  assert.equal(v.result.acc, 100);
  assert.equal(v.result.name, 'synthetic');
});

test('accuracy under the floor is practice, not a rank', () => {
  const p = wordsRun(25, { gap: 110, jitter: 45, err: 0.6 });
  assert.match(validate(p).error, /accuracy under/);
});

test('a superhuman speed is refused even with jitter', () => {
  const p = wordsRun(25, { gap: 28, jitter: 12 });
  assert.match(validate(p).error, /faster than a human hand/);
});

test('an unfinished words test is refused', () => {
  const p = wordsRun(25, { gap: 110, jitter: 45 });
  p.log = p.log.slice(0, -5);
  assert.match(validate(p).error, /not finished/);
});

test('the log must be in order and start at zero', () => {
  const p = wordsRun(10, { gap: 110, jitter: 45 });
  p.log[3][0] = p.log[2][0] - 50;
  assert.match(validate(p).error, /bad keystroke log/);
  const q = wordsRun(10, { gap: 110, jitter: 45 });
  q.log = q.log.map(([t, k]) => [t + 500, k]); q.seconds += 0.5;
  assert.match(validate(q).error, /first keystroke/);
});

test('names are trimmed to printable ascii and twenty characters', () => {
  const p = wordsRun(10, { gap: 110, jitter: 45 }, { name: '  Niráj   D​  the great typist of Kathmandu ' });
  const v = validate(p);
  assert.equal(v.ok, true, v.error);
  assert.equal(v.result.name, 'Nirj D the great typ');
  assert.ok(v.result.name.length <= LIMITS.maxName);
  assert.equal(validate(wordsRun(10, { gap: 110, jitter: 45 }, { name: '' })).result.name, 'anonymous');
});

test('device ids must look like ids', () => {
  const p = wordsRun(10, { gap: 110, jitter: 45 }, { device: 'not an id' });
  assert.match(validate(p).error, /device/);
});

test('checkTiming flags bursts a hand cannot make', () => {
  const log = Array.from({ length: 30 }, (_, i) => [i * 10, 'a']);
  assert.match(checkTiming(log), /faster/);
  assert.equal(checkTiming(synth(pickWords(20), { gap: 120, jitter: 50 })), null);
});
