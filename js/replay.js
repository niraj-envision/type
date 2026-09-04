/* ─────────────────────────────────────────────────────────────────
   replay.js — replays a keystroke log against the target words and
   scores the result with exactly the rules the engine uses live.

   The engine keeps a log of every key that changed the test:

       [t, k]        t   milliseconds since the first keystroke
                     k   the character typed, ' ' for the space that
                         ends a word, '\b' for backspace and '\x17'
                         (ctrl+backspace) for deleting a whole word
       [t, k, 'r']   a key the test refused (stop on error) — it still
                     counts against accuracy, it just was not inserted

   Given the words and the log, `run` rebuilds what was typed and
   `score` turns that into wpm, raw, accuracy and consistency. The page
   uses it to describe a finished run; the leaderboard worker uses the
   same file to check a submitted run before ranking it, so a result
   cannot be inflated without also forging a log that produces it.

   UMD-style: `window.Replay` in the browser, a CommonJS module under
   Node and in the worker bundle.
   ───────────────────────────────────────────────────────────────── */
(function (root, factory) {
  const R = factory();
  if (typeof module === 'object' && module.exports) module.exports = R;
  if (root) root.Replay = R;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_EXTRA = 10;                 // extra letters allowed past a word's end
  const BACK = '\b', WORD_BACK = '\x17';
  const FINITE = ['words', 'quote', 'story'];

  /* Rebuild the typed words from the log. `words` are the targets; for
     zen there are none and the text is whatever was typed. */
  function run({ mode, words, log, wordCount, seconds }) {
    const zen = mode === 'zen';
    const targets = zen ? [] : (words || []).slice();
    const typed = [];
    const keys = { correct: 0, incorrect: 0, extra: 0, missed: 0 };
    const finite = FINITE.includes(mode);
    const total = mode === 'words' ? (wordCount || 0) : targets.length;
    let wi = 0, finished = false, endT = 0, lastT = 0;

    /* Per-second samples of how many characters had been typed, taken at
       every whole-second boundary — the same reading the live timer takes. */
    const samples = [];
    let bucket = 0;
    const typedChars = () => {
      let n = 0;
      for (let i = 0; i <= wi; i++) n += (typed[i] || '').length;
      return n + wi;                                   // + the spaces
    };
    const sampleUpTo = t => {
      const b = Math.floor(t / 1000);
      while (bucket < b) { samples.push(typedChars()); bucket++; }
    };

    for (const ev of log || []) {
      if (finished) break;
      const t = +ev[0], k = ev[1], refused = ev[2] === 'r';
      if (!(t >= lastT)) return null;                  // the log must be in order
      lastT = t;
      sampleUpTo(t);
      const i = wi, cur = typed[i] || '';

      if (k === BACK || k === WORD_BACK) {
        const whole = k === WORD_BACK;
        if (!cur.length) {
          if (i === 0) continue;
          const prev = typed[i - 1] || '';
          if (!zen && prev === (targets[i - 1] || '')) continue;   // correct words are locked
          wi--;
          if (whole) typed[i - 1] = '';
          continue;
        }
        typed[i] = whole ? '' : cur.slice(0, -1);
        if (zen) targets[i] = typed[i];
        continue;
      }

      if (k === ' ') {
        if (!cur.length) continue;                     // no empty words
        const target = zen ? cur : (targets[i] || '');
        if (cur === target) keys.correct++; else keys.incorrect++;
        if (cur.length < target.length) keys.missed += target.length - cur.length;
        wi++;
        if (finite && wi >= total) { finished = true; endT = t; }
        continue;
      }

      if (typeof k !== 'string' || k.length !== 1) return null;   // not a keystroke
      const target = zen ? null : (targets[i] || '');
      if (refused) { keys.incorrect++; continue; }
      if (target !== null && cur.length >= target.length + MAX_EXTRA) continue;
      const expected = target === null ? k : target[cur.length];
      const correct = k === expected;
      if (target !== null && cur.length >= target.length) keys.extra++;
      else if (correct) keys.correct++;
      else keys.incorrect++;
      typed[i] = cur + k;
      if (zen) targets[i] = typed[i];
      if (target !== null && typed[i] === target && finite && i === total - 1) { finished = true; endT = t; }
    }

    /* A finite test stops sampling when it finishes; a timed one runs to
       the clock. Either way the partial last second is never a sample,
       which is also what the live timer does. */
    const end = finished ? endT : (seconds || lastT / 1000) * 1000;
    sampleUpTo(end);

    return { mode, words: targets, typed, wordIndex: wi, keys, finished, endT, lastT, samples };
  }

  function correctChars(r) {
    let n = 0;
    const limit = Math.max(r.words.length, r.typed.length);
    for (let i = 0; i <= r.wordIndex && i < limit; i++) {
      const t = r.words[i] || '', k = r.typed[i] || '';
      for (let j = 0; j < Math.min(t.length, k.length); j++) if (t[j] === k[j]) n++;
      if (i < r.wordIndex && t === k) n++;             // the space after a correct word
    }
    return n;
  }
  function typedChars(r) {
    let n = 0;
    for (let i = 0; i <= r.wordIndex; i++) n += (r.typed[i] || '').length;
    return n + r.wordIndex;
  }

  function stddev(xs) {
    if (xs.length < 2) return 0;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
  }
  /* 1 − (stddev ÷ mean) of the per-second raw speed; seconds with no
     typing are left out, so a pause is not a collapse in consistency. */
  function consistency(raws) {
    const r = raws.filter(x => x > 0);
    if (r.length < 2) return 100;
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    if (!mean) return 0;
    return Math.max(0, Math.min(100, Math.round((1 - stddev(r) / mean) * 100)));
  }

  /* Per-second raw wpm from the sampled character counts. */
  function perSecondRaw(samples) {
    const out = [];
    let last = 0;
    for (const s of samples) { out.push(Math.round(((s - last) / 5) * 60)); last = s; }
    return out;
  }

  /* The numbers on the results screen, from a run and how long it took. */
  function score(r, seconds) {
    const mins = Math.max(seconds, 0.001) / 60;
    const correct = correctChars(r), all = typedChars(r);
    const k = r.keys, attempts = k.correct + k.incorrect + k.extra;
    return {
      wpm: Math.round(correct / 5 / mins),
      raw: Math.round(all / 5 / mins),
      acc: attempts ? Math.round((k.correct / attempts) * 1000) / 10 : 0,
      consistency: consistency(perSecondRaw(r.samples)),
      chars: `${k.correct}/${k.incorrect}/${k.extra}/${k.missed}`,
      correctChars: correct, typedChars: all
    };
  }

  /* Where the time went, word by word: how long each word took from its
     first letter to the space after it, for the "slowest words" line. */
  function wordTimes(words, log) {
    const out = [];
    let wi = 0, startT = null, typed = '';
    for (const [t, k, flag] of log || []) {
      if (flag === 'r') continue;
      if (k === ' ') {
        if (!typed.length) continue;
        if (startT !== null) out.push({ index: wi, word: words[wi] || typed, ms: t - startT });
        wi++; startT = null; typed = '';
      } else if (k === BACK) {
        if (typed.length) typed = typed.slice(0, -1);
        else if (wi > 0) { wi--; typed = 'x'; startT = t; }   // back into a word: restart its clock
      } else if (k === WORD_BACK) {
        if (typed.length) typed = '';
        else if (wi > 0) { wi--; typed = ''; startT = t; }
      } else {
        if (startT === null) startT = t;
        typed += k;
      }
    }
    return out;
  }

  return { run, score, correctChars, typedChars, consistency, perSecondRaw, wordTimes, MAX_EXTRA, BACK, WORD_BACK };
});
