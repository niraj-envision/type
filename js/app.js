/* ─────────────────────────────────────────────────────────────────
   app.js — the test engine.

   Layout of this file:
     1. config + storage        persisted settings, results, per-key stats
     2. word generation         english / code / quotes / adaptive
     3. rendering               words, caret, line scrolling
     4. input                   keydown, space, backspace rules
     5. timing + statistics     wpm, raw, accuracy, consistency
     6. results + charts        canvas, drawn by hand, no chart library
     7. ui                      config bar, settings, stats, palette
   ───────────────────────────────────────────────────────────────── */
(() => {
'use strict';

/* ── 1. config + storage ─────────────────────────────────────────── */

const DEFAULTS = {
  mode: 'time', time: 30, wordCount: 25, quoteLength: 'medium',
  punctuation: false, numbers: false,
  theme: 'serika-dark', sound: 'click', volume: 35, errorSound: true,
  caret: 'line', smooth: true, stopOnError: 'off',
  blind: false, liveWpm: true, fontSize: 1.6,
  spaceSound: 'same', font: 'JetBrains Mono', fontWeight: 500,
  tape: false
};

/* Modes with no finish line of their own: they run until you stop them. */
const ENDLESS = ['infinite', 'zen', 'adaptive'];
const isEndless = () => ENDLESS.includes(config.mode);

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('type.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('type.' + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
  clear() { try { ['config','history','pb','keys'].forEach(k => localStorage.removeItem('type.' + k)); } catch {} }
};

const config  = Object.assign({}, DEFAULTS, store.get('config', {}));
let history   = store.get('history', []);
let pb        = store.get('pb', {});
let keyStats  = store.get('keys', {});   // { a: {n, err}, … }

const saveConfig = () => store.set('config', config);

/* ── state ───────────────────────────────────────────────────────── */

const state = {
  words: [], typed: [], wordIndex: 0,
  started: false, finished: false, startTime: 0, endTime: 0,
  timerId: null, rafId: null,
  keys: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
  perSecond: [], lastSampleChars: 0, lastSampleErrors: 0, secondsElapsed: 0,
  quote: null, lineTops: [], suppressInput: false,
  shift: { x: 0, y: 0 },         // where the view has scrolled the words to
  domOffset: 0                   // index of the first word still in the DOM
};

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const wordsEl   = $('#words');
const caretEl   = $('#caret');
const areaEl    = $('#typing-area');
const inputEl   = $('#hidden-input');
const counterEl = $('#live-counter');
const liveWpmEl = $('#live-wpm');
const testEl    = $('#test');
const resultsEl = $('#results');

/* ── 2. word generation ──────────────────────────────────────────── */

const rnd  = arr => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* Keybr's idea: letters you get wrong show up more often. Sample a few
   candidates and keep the one richest in your weak letters. */
function weakness(ch) {
  const s = keyStats[ch];
  if (!s || s.n < 4) return 0.15;              // unseen keys get a small pull
  return Math.min(1, (s.err / s.n) * 4);
}
function adaptivePick(list) {
  let best = null, bestScore = -1;
  for (let i = 0; i < 5; i++) {
    const w = rnd(list);
    let score = 0;
    for (const ch of w) score += weakness(ch);
    score /= w.length;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

function decorate(words) {
  if (!config.numbers && !config.punctuation) return words;
  const out = words.slice();
  for (let i = 0; i < out.length; i++) {
    if (config.numbers && Math.random() < 0.12) {
      out[i] = String(rint(0, 9999));
      continue;
    }
    if (config.punctuation) {
      if (i === 0 || /[.!?]$/.test(out[i - 1] || '')) out[i] = out[i][0].toUpperCase() + out[i].slice(1);
      const r = Math.random();
      if (r < 0.04)      out[i] = '"' + out[i] + '"';
      else if (r < 0.07) out[i] = '(' + out[i] + ')';
      else if (r < 0.12) out[i] = out[i] + rnd(WORDS.punctuation);
      else if (r < 0.16) out[i] = out[i] + ',';
      else if (r < 0.22) out[i] = out[i] + '.';
    }
  }
  if (config.punctuation && out.length) out[out.length - 1] = out[out.length - 1].replace(/[,;:]$/, '.');
  return out;
}

function makeWords(n) {
  const list = config.mode === 'code' ? WORDS.code : WORDS.english;
  const raw = [];
  let last = '';
  for (let i = 0; i < n; i++) {
    let w;
    do { w = config.mode === 'adaptive' ? adaptivePick(list) : rnd(list); } while (w === last);
    last = w;
    raw.push(w);
  }
  return decorate(raw);
}

function seed() {
  state.quote = null;
  if (config.mode === 'quote') {
    const pool = WORDS.quotes.filter(q => q.length === config.quoteLength);
    state.quote = rnd(pool.length ? pool : WORDS.quotes);
    state.words = state.quote.text.split(/\s+/);
  } else if (config.mode === 'words') {
    state.words = makeWords(config.wordCount);
  } else if (config.mode === 'zen') {
    state.words = [];
  } else {                                     // time, infinite, adaptive
    state.words = makeWords(60);
  }
}

/* time and adaptive never run out of words */
function topUp() {
  if (config.mode === 'quote' || config.mode === 'words' || config.mode === 'zen') return;
  if (state.words.length - state.wordIndex < 25) {
    const more = makeWords(30);
    state.words.push(...more);
    appendWords(more);
  }
}

/* ── 3. rendering ────────────────────────────────────────────────── */

const esc = c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;

function wordHTML(i) {
  const target = state.words[i] || '';
  const typed  = state.typed[i] || '';
  let html = '';
  const len = Math.max(target.length, typed.length);
  for (let j = 0; j < len; j++) {
    const t = target[j], k = typed[j];
    if (t === undefined)      html += `<span class="letter extra">${esc(k)}</span>`;
    else if (k === undefined) html += `<span class="letter">${esc(t)}</span>`;
    else                      html += `<span class="letter ${k === t ? 'correct' : 'incorrect'}">${esc(t)}</span>`;
  }
  return html || '<span class="letter"></span>';
}

/* Words scroll out of view forever, so only a window of them is kept in the
   DOM; this maps a word index onto the element that is actually there. */
const wordEl = i => wordsEl.children[i - state.domOffset];

function renderAll() {
  wordsEl.innerHTML = state.words.slice(state.domOffset)
    .map((_, k) => `<div class="word">${wordHTML(state.domOffset + k)}</div>`).join('');
  wordsEl.style.transform = 'none';
  state.shift = { x: 0, y: 0 };
  measureLines();
  scrollView();
  updateCaret();
}

function appendWords(newWords) {
  const start = state.words.length - newWords.length;
  const frag = document.createDocumentFragment();
  newWords.forEach((_, k) => {
    const d = document.createElement('div');
    d.className = 'word';
    d.innerHTML = wordHTML(start + k);
    frag.appendChild(d);
  });
  wordsEl.appendChild(frag);
  measureLines();
}

function updateWord(i) {
  const el = wordEl(i);
  if (!el) return;
  el.innerHTML = wordHTML(i);
  const typed = state.typed[i];
  el.classList.toggle('error', i < state.wordIndex && typed !== undefined && typed !== state.words[i]);
}

function measureLines() {
  if (config.tape) { state.lineTops = []; return; }
  const tops = [];
  for (const w of wordsEl.children) {
    const t = w.offsetTop;
    if (tops[tops.length - 1] !== t) tops.push(t);
  }
  state.lineTops = tops;
}

/* Tape: one straight line, the word you are typing pinned to the middle.
   The offset is rounded to whole pixels — a fractional translate resamples
   every glyph and is what makes scrolling text look soft. */
function scrollTape() {
  const active = wordEl(state.wordIndex);
  if (!active) return;
  const x = Math.round(areaEl.clientWidth / 2 - active.offsetLeft);
  state.shift = { x, y: 0 };
  wordsEl.style.transform = `translateX(${x}px)`;
}

function scrollView() { config.tape ? scrollTape() : scrollLines(); }

/* Drop the words that have scrolled out of sight. In paragraph view only
   whole lines above the visible window go, and in tape view only words a
   full screen off to the left — in both cases the scroll offset is then
   recomputed from what is left, so nothing on screen moves. Without this the
   DOM grows for the whole test (630 words in a 60-second run) and every
   keystroke re-measures all of it. */
const PRUNE_AT = 20;

function prune() {
  const active = wordEl(state.wordIndex);
  if (!active) return;
  let cut = 0;
  if (config.tape) {
    const edge = active.offsetLeft - areaEl.clientWidth;
    for (const el of wordsEl.children) {
      if (el.offsetLeft + el.offsetWidth >= edge) break;
      cut++;
    }
  } else {
    const line = state.lineTops.indexOf(active.offsetTop);
    if (line < 2) return;
    const keepFrom = state.lineTops[line - 1];
    for (const el of wordsEl.children) {
      if (el.offsetTop >= keepFrom) break;
      cut++;
    }
  }
  if (cut < PRUNE_AT) return;                 // not worth the reflow
  for (let k = 0; k < cut; k++) wordsEl.removeChild(wordsEl.firstChild);
  state.domOffset += cut;
  measureLines();
}

function scrollLines() {
  const active = wordEl(state.wordIndex);
  if (!active || !state.lineTops.length) return;
  const line = state.lineTops.indexOf(active.offsetTop);
  if (line < 0) return;
  /* whole pixels only: a fractional offset resamples every glyph */
  const shift = Math.round(state.lineTops[Math.max(0, line - 1)] - state.lineTops[0]);
  state.shift = { x: 0, y: -shift };
  wordsEl.style.transform = shift ? `translateY(${-shift}px)` : 'none';
}

function updateCaret() {
  const active = wordEl(state.wordIndex);
  if (!active) { caretEl.classList.add('hidden'); return; }
  caretEl.classList.remove('hidden');
  const typedLen = (state.typed[state.wordIndex] || '').length;
  const letters  = active.children;
  /* Layout offsets, not bounding rects: offsetLeft/Top ignore the transform
     on the words container, so the caret lands correctly even while the view
     is still animating to its new position. Reading rects mid-transition put
     the caret wherever the animation happened to be that frame. */
  let x, y, h;
  if (typedLen < letters.length) {
    const l = letters[typedLen];
    x = l.offsetLeft; y = l.offsetTop; h = l.offsetHeight;
  } else if (letters.length) {
    const l = letters[letters.length - 1];
    x = l.offsetLeft + l.offsetWidth; y = l.offsetTop; h = l.offsetHeight;
  } else {
    x = active.offsetLeft; y = active.offsetTop; h = active.offsetHeight;
  }
  x += state.shift.x; y += state.shift.y;
  if (config.caret === 'underline') y += h * 0.82;
  caretEl.style.height = `${h * 0.78}px`;
  caretEl.style.transform = `translate(${x}px, ${y + h * 0.11}px)`;
}

/* ── 4. input ────────────────────────────────────────────────────── */

const MAX_EXTRA = 10;

function typeChar(ch) {
  if (state.finished) return;
  if (!state.started) start();

  if (config.mode === 'zen' && state.words.length === 0) {
    state.words.push(''); appendWords(['']);
  }

  const i = state.wordIndex;
  const target = config.mode === 'zen' ? null : (state.words[i] || '');
  const typed  = state.typed[i] || '';

  if (target !== null && typed.length >= target.length + MAX_EXTRA) return;

  const expected = target === null ? ch : target[typed.length];
  const correct  = ch === expected;

  if (!correct && config.stopOnError === 'letter') {
    state.keys.incorrect++;
    trackKey(expected, false);
    Sound.play('error');
    return;
  }

  state.typed[i] = typed + ch;
  if (target !== null && typed.length >= target.length) state.keys.extra++;
  else if (correct) state.keys.correct++;
  else state.keys.incorrect++;
  if (target !== null && typed.length < target.length) trackKey(expected, correct);

  /* one voice per keystroke: the error thud replaces the click rather
     than landing on top of it */
  Sound.play(correct || !config.errorSound ? 'letter' : 'error');

  if (config.mode === 'zen') {
    state.words[i] = state.typed[i];   // zen: the text is whatever you type
  }
  updateWord(i);
  measureLines();
  updateCaret();

  /* The last word of a finite test ends it the moment it is complete —
     nobody types a trailing space at the end of a quote. */
  if (target !== null && state.typed[i] === target && isLastWord(i)) finish();
}

function isLastWord(i) {
  if (config.mode === 'words') return i === config.wordCount - 1;
  if (config.mode === 'quote') return i === state.words.length - 1;
  return false;
}

function typeSpace() {
  if (state.finished) return;
  if (!state.started) start();
  const i = state.wordIndex;
  const typed = state.typed[i] || '';
  if (!typed.length) return;                       // no empty words

  const target = config.mode === 'zen' ? typed : (state.words[i] || '');

  if (config.stopOnError === 'word' && typed !== target) { Sound.play('error'); return; }

  if (typed === target) state.keys.correct++; else state.keys.incorrect++;
  if (typed.length < target.length) state.keys.missed += target.length - typed.length;

  if (config.spaceSound !== 'off') Sound.play(config.spaceSound === 'deeper' ? 'space' : 'letter');
  state.wordIndex++;
  updateWord(i);

  if (config.mode === 'zen') { state.words.push(''); appendWords(['']); }

  const limitReached =
    (config.mode === 'words' && state.wordIndex >= config.wordCount) ||
    (config.mode === 'quote' && state.wordIndex >= state.words.length);
  if (limitReached) return finish();

  topUp();
  prune();
  scrollView();
  updateCaret();
}

function backspace(whole) {
  if (state.finished) return;
  const i = state.wordIndex;
  const typed = state.typed[i] || '';

  if (!typed.length) {
    if (i === 0) return;
    const prev = state.typed[i - 1] || '';
    if (config.mode !== 'zen' && prev === state.words[i - 1]) return;  // correct words are locked
    state.wordIndex--;
    updateWord(i - 1);
    if (whole) state.typed[i - 1] = '';
    updateWord(i - 1);
    scrollView(); updateCaret();
    Sound.play('back');
    return;
  }
  state.typed[i] = whole ? '' : typed.slice(0, -1);
  if (config.mode === 'zen') state.words[i] = state.typed[i];
  updateWord(i);
  measureLines();
  updateCaret();
  Sound.play('back');
}

function onKeyDown(e) {
  if (!$('#palette').hidden || !$('#settings').hidden || !$('#stats').hidden) return;
  if (e.key === 'Tab')     { e.preventDefault(); return restart(); }
  if (e.key === 'Escape')  { e.preventDefault(); return openPalette(); }
  if (e.key === 'CapsLock' || e.getModifierState) {
    $('#capslock').hidden = !e.getModifierState('CapsLock');
  }
  if (e.altKey || e.metaKey) return;
  if (e.key === 'Backspace') { e.preventDefault(); state.suppressInput = true; return backspace(e.ctrlKey); }
  if (e.ctrlKey) return;
  if (e.key === ' ')       { e.preventDefault(); state.suppressInput = true; return typeSpace(); }
  if (e.key === 'Enter') {
    if (isEndless() && e.shiftKey) { e.preventDefault(); return finish(); }
    if (config.mode === 'zen') { e.preventDefault(); return typeSpace(); }
  }
  if (e.key.length === 1)  { e.preventDefault(); state.suppressInput = true; return typeChar(e.key); }
}

/* mobile keyboards fire `input`, not usable keydowns */
inputEl.addEventListener('input', e => {
  const data = e.data;
  inputEl.value = '';
  if (state.suppressInput) { state.suppressInput = false; return; }
  if (!data) return;
  for (const ch of data) ch === ' ' ? typeSpace() : typeChar(ch);
});
document.addEventListener('keyup', () => { state.suppressInput = false; });

/* ── 5. timing + statistics ──────────────────────────────────────── */

function typedChars() {
  let n = 0;
  for (let i = 0; i <= state.wordIndex; i++) n += (state.typed[i] || '').length;
  return n + state.wordIndex;                      // + spaces
}

function correctChars() {
  let n = 0;
  for (let i = 0; i <= state.wordIndex && i < Math.max(state.words.length, state.typed.length); i++) {
    const t = state.words[i] || '', k = state.typed[i] || '';
    for (let j = 0; j < Math.min(t.length, k.length); j++) if (t[j] === k[j]) n++;
    if (i < state.wordIndex && t === k) n++;       // the space after a correct word
  }
  return n;
}

const minutes = () => Math.max((performance.now() - state.startTime) / 60000, 1 / 60000);
const liveWpm = () => Math.round(correctChars() / 5 / minutes());

function start() {
  state.started = true;
  state.startTime = performance.now();
  document.body.classList.add('typing');
  areaEl.classList.remove('unfocused');
  state.timerId = setInterval(tick, 1000);
  loop();
}

function tick() {
  state.secondsElapsed++;
  const chars  = typedChars();
  const errors = state.keys.incorrect + state.keys.extra;
  state.perSecond.push({
    t: state.secondsElapsed,
    raw: Math.round(((chars - state.lastSampleChars) / 5) * 60),
    wpm: liveWpm(),
    errors: errors - state.lastSampleErrors
  });
  state.lastSampleChars = chars;
  state.lastSampleErrors = errors;

  if (config.mode === 'time') {
    const left = config.time - state.secondsElapsed;
    counterEl.textContent = Math.max(0, left);
    if (left <= 0) finish();
  }
}

function loop() {
  if (state.finished) return;
  if (config.liveWpm && state.started) {
    liveWpmEl.hidden = false;
    liveWpmEl.textContent = liveWpm() + ' wpm';
  }
  if (config.mode !== 'time') counterEl.textContent = progressLabel();
  state.rafId = requestAnimationFrame(loop);
}

function progressLabel() {
  if (config.mode === 'time')  return String(config.time);
  if (config.mode === 'words') return `${state.wordIndex}/${config.wordCount}`;
  if (config.mode === 'quote') return `${state.wordIndex}/${state.words.length}`;
  /* Endless: there is no target to count down to, so count up — elapsed
     time, and how many words you have put behind you. */
  if (!state.started) return '0:00';
  const secs = Math.floor((performance.now() - state.startTime) / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${state.wordIndex}`;
}

function trackKey(ch, ok) {
  if (!ch || ch === ' ') return;
  const k = ch.toLowerCase();
  if (!/^[a-z0-9]$/.test(k)) return;
  const s = keyStats[k] || (keyStats[k] = { n: 0, err: 0 });
  s.n++; if (!ok) s.err++;
}

function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

function consistency(samples) {
  const raws = samples.map(s => s.raw).filter(r => r > 0);
  if (raws.length < 2) return 100;
  const mean = raws.reduce((a, b) => a + b, 0) / raws.length;
  if (!mean) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - stddev(raws) / mean) * 100)));
}

/* ── 6. results + charts ─────────────────────────────────────────── */

function finish() {
  if (state.finished || !state.started) return;
  state.finished = true;
  state.endTime = performance.now();
  clearInterval(state.timerId);
  cancelAnimationFrame(state.rafId);
  document.body.classList.remove('typing');

  const secs = Math.max((state.endTime - state.startTime) / 1000, 0.001);
  const mins = secs / 60;
  const correct = correctChars();
  const all = typedChars();
  const k = state.keys;
  const attempts = k.correct + k.incorrect + k.extra;

  const result = {
    wpm: Math.round(correct / 5 / mins),
    raw: Math.round(all / 5 / mins),
    acc: attempts ? Math.round((k.correct / attempts) * 1000) / 10 : 0,
    consistency: consistency(state.perSecond),
    chars: `${k.correct}/${k.incorrect}/${k.extra}/${k.missed}`,
    seconds: Math.round(secs * 10) / 10,
    mode: modeLabel(),
    key: modeKey(),
    date: Date.now()
  };

  const best = pb[result.key];
  /* An endless run you quit after four words is not a personal best. */
  const longEnough = !isEndless() || secs >= 15;
  const isPb = result.acc >= 70 && longEnough && (!best || result.wpm > best.wpm);
  if (isPb) { pb[result.key] = { wpm: result.wpm, acc: result.acc, date: result.date }; store.set('pb', pb); }

  history.unshift(result);
  history = history.slice(0, 100);
  store.set('history', history);
  store.set('keys', keyStats);

  showResults(result, isPb);
}

function modeLabel() {
  if (config.mode === 'time')  return `time ${config.time}`;
  if (config.mode === 'words') return `words ${config.wordCount}`;
  if (config.mode === 'quote') return `quote ${config.quoteLength}`;
  if (config.mode === 'zen')   return 'zen';
  if (config.mode === 'infinite') return 'infinite';
  return 'adaptive';
}
function modeKey() {
  const extra = (config.punctuation ? '+p' : '') + (config.numbers ? '+n' : '');
  if (config.mode === 'time')  return `time-${config.time}${extra}`;
  if (config.mode === 'words') return `words-${config.wordCount}${extra}`;
  if (config.mode === 'quote') return `quote-${config.quoteLength}`;
  return config.mode;
}

function showResults(r, isPb) {
  testEl.hidden = true;
  $('#config').style.display = 'none';
  resultsEl.hidden = false;
  $('#r-wpm').textContent = r.wpm;
  $('#r-acc').textContent = r.acc + '%';
  $('#r-pb').hidden = !isPb;
  $('#r-type').textContent = r.mode + (config.punctuation ? ' punct' : '') + (config.numbers ? ' num' : '');
  $('#r-raw').textContent = r.raw;
  $('#r-chars').textContent = r.chars;
  $('#r-consistency').textContent = r.consistency + '%';
  $('#r-time').textContent = r.seconds + 's';
  if (state.quote) $('#r-type').textContent = 'quote — ' + state.quote.source;
  drawChart();
  showWeakKeys();
}

function showWeakKeys() {
  const weak = Object.entries(keyStats)
    .filter(([, s]) => s.n >= 8 && s.err > 0)
    .map(([ch, s]) => ({ ch, rate: s.err / s.n }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);
  $('#weak-keys').hidden = weak.length === 0;
  $('#weak-list').innerHTML = weak
    .map(w => `<span class="weak-key">${w.ch} <small>${Math.round(w.rate * 100)}%</small></span>`).join('');
}

/* Hand-drawn canvas chart: wpm line, raw line, error crosses. */
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function setupCanvas(cv, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 800;
  cv.width = w * dpr; cv.height = cssHeight * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssHeight);
  return { ctx, w, h: cssHeight };
}

function drawChart() {
  const cv = $('#chart');
  const data = state.perSecond;
  const { ctx, w, h } = setupCanvas(cv, 260);
  const pad = { l: 42, r: 42, t: 16, b: 26 };
  const main = css('--main'), sub = css('--sub'), err = css('--err'), text = css('--text');

  if (data.length < 2) {
    ctx.fillStyle = sub; ctx.font = '14px "Lexend Deca", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('too short to chart', w / 2, h / 2);
    return;
  }

  const maxY = Math.max(20, ...data.map(d => Math.max(d.wpm, d.raw))) * 1.15;
  const X = i => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - (v / maxY) * (h - pad.t - pad.b);

  // grid + y axis
  ctx.strokeStyle = sub; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  ctx.fillStyle = sub; ctx.font = '11px "Lexend Deca", sans-serif'; ctx.textAlign = 'right';
  const step = Math.max(10, Math.round(maxY / 4 / 10) * 10);
  for (let v = 0; v <= maxY; v += step) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.globalAlpha = 0.75; ctx.fillText(String(v), pad.l - 8, Y(v) + 4); ctx.globalAlpha = 0.25;
  }
  ctx.globalAlpha = 1;

  // x labels
  ctx.textAlign = 'center'; ctx.fillStyle = sub; ctx.globalAlpha = 0.75;
  const every = Math.max(1, Math.round(data.length / 8));
  data.forEach((d, i) => { if (i % every === 0) ctx.fillText(d.t + 's', X(i), h - 6); });
  ctx.globalAlpha = 1;

  const line = (key, color, width, alpha) => {
    ctx.beginPath();
    data.forEach((d, i) => i ? ctx.lineTo(X(i), Y(d[key])) : ctx.moveTo(X(i), Y(d[key])));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1;
  };
  line('raw', sub, 1.6, 0.85);
  line('wpm', main, 2.6, 1);

  // error crosses
  ctx.strokeStyle = err; ctx.lineWidth = 1.8;
  data.forEach((d, i) => {
    if (!d.errors) return;
    const x = X(i), y = Y(d.wpm), s = 4;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
    ctx.stroke();
  });

  // legend
  ctx.textAlign = 'left'; ctx.font = '11px "Lexend Deca", sans-serif';
  ctx.fillStyle = main; ctx.fillText('wpm', pad.l, 12);
  ctx.fillStyle = sub;  ctx.fillText('raw', pad.l + 34, 12);
  ctx.fillStyle = err;  ctx.fillText('errors', pad.l + 64, 12);
  ctx.fillStyle = text;
}

function drawHistoryChart() {
  const cv = $('#history-chart');
  const data = history.slice(0, 50).reverse();
  const { ctx, w, h } = setupCanvas(cv, 200);
  const main = css('--main'), sub = css('--sub');
  if (data.length < 2) {
    ctx.fillStyle = sub; ctx.font = '14px "Lexend Deca", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('take a few tests and your trend shows up here', w / 2, h / 2);
    return;
  }
  const pad = { l: 36, r: 12, t: 14, b: 18 };
  const maxY = Math.max(...data.map(d => d.wpm)) * 1.2;
  const X = i => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
  const Y = v => h - pad.b - (v / maxY) * (h - pad.t - pad.b);

  ctx.strokeStyle = sub; ctx.globalAlpha = 0.25;
  ctx.fillStyle = sub; ctx.font = '10px "Lexend Deca", sans-serif'; ctx.textAlign = 'right';
  const step = Math.max(10, Math.round(maxY / 3 / 10) * 10);
  for (let v = 0; v <= maxY; v += step) {
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.globalAlpha = 0.7; ctx.fillText(String(v), pad.l - 6, Y(v) + 3); ctx.globalAlpha = 0.25;
  }
  ctx.globalAlpha = 1;

  // area under the curve
  ctx.beginPath();
  data.forEach((d, i) => i ? ctx.lineTo(X(i), Y(d.wpm)) : ctx.moveTo(X(i), Y(d.wpm)));
  ctx.strokeStyle = main; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.lineTo(X(data.length - 1), h - pad.b); ctx.lineTo(X(0), h - pad.b); ctx.closePath();
  ctx.globalAlpha = 0.12; ctx.fillStyle = main; ctx.fill(); ctx.globalAlpha = 1;
  data.forEach((d, i) => {
    ctx.beginPath(); ctx.arc(X(i), Y(d.wpm), 2.4, 0, Math.PI * 2);
    ctx.fillStyle = main; ctx.fill();
  });
}

/* ── 7. ui ───────────────────────────────────────────────────────── */

const AMOUNTS = {
  time:  [15, 30, 60, 120],
  words: [10, 25, 50, 100],
  quote: ['short', 'medium', 'long']
};

function renderConfigBar() {
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === config.mode));
  /* punctuation and numbers only mean something for generated words */
  const generated = ['time', 'words', 'adaptive'].includes(config.mode);
  $$('[data-toggle]').forEach(b => {
    b.hidden = !generated;
    b.classList.toggle('active', !!config[b.dataset.toggle]);
  });
  const box = $('#amounts');
  const list = AMOUNTS[config.mode];
  $('#amount-sep').style.display = list ? '' : 'none';
  box.innerHTML = '';
  if (!list) return;
  const current = config.mode === 'time' ? config.time
                : config.mode === 'words' ? config.wordCount : config.quoteLength;
  list.forEach(v => {
    const b = document.createElement('button');
    b.className = 'cfg' + (v === current ? ' active' : '');
    b.textContent = v;
    b.onclick = () => {
      if (config.mode === 'time') config.time = v;
      else if (config.mode === 'words') config.wordCount = v;
      else config.quoteLength = v;
      saveConfig(); renderConfigBar(); restart();
    };
    box.appendChild(b);
  });
}

function setMode(m) { config.mode = m; saveConfig(); applyConfig(); renderConfigBar(); restart(); }

function restart() {
  clearInterval(state.timerId);
  cancelAnimationFrame(state.rafId);
  Object.assign(state, {
    typed: [], wordIndex: 0, started: false, finished: false,
    startTime: 0, endTime: 0, keys: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
    perSecond: [], lastSampleChars: 0, lastSampleErrors: 0, secondsElapsed: 0,
    shift: { x: 0, y: 0 }, domOffset: 0
  });
  seed();
  renderAll();
  resultsEl.hidden = true;
  testEl.hidden = false;
  $('#config').style.display = '';
  document.body.classList.remove('typing');
  liveWpmEl.hidden = true;
  counterEl.textContent = config.mode === 'time' ? config.time : progressLabel();
  inputEl.value = '';
  inputEl.focus({ preventScroll: true });
}

function repeat() {                                   // same text, fresh run
  const words = state.words.slice(), quote = state.quote;
  restart();
  state.words = words; state.quote = quote;
  renderAll();
}

const FONTS = ['JetBrains Mono', 'Roboto Mono', 'IBM Plex Mono', 'Source Code Pro', 'system mono'];

function applyConfig() {
  $('#zen-hint').hidden = !isEndless();
  wordsEl.classList.toggle('tape', config.tape);
  const root = document.documentElement.style;
  root.setProperty('--mono', config.font === 'system mono' ? 'ui-monospace' : `"${config.font}"`);
  root.setProperty('--font-weight', config.fontWeight);
  document.documentElement.dataset.theme = config.theme;
  document.documentElement.dataset.caret = config.caret;
  document.documentElement.style.setProperty('--font-size', config.fontSize + 'rem');
  caretEl.classList.toggle('smooth', config.smooth);
  wordsEl.classList.toggle('blind', config.blind);
  Sound.pack = config.sound;
  Sound.volume = config.volume / 100;
  Sound.errorSound = config.errorSound;
  $('#theme-name').textContent = config.theme.replace(/-/g, ' ');
  $('#sound-name').textContent = config.sound;
  liveWpmEl.hidden = !config.liveWpm || !state.started;
}

/* settings drawer -------------------------------------------------- */
const THEMES = ['serika-dark','dracula','nord','catppuccin','gruvbox','tokyo-night','matrix','rose-pine','paper','solarized-light'];

function chips(container, values, current, onPick, labels) {
  const el = $(container);
  el.innerHTML = '';
  values.forEach(v => {
    const b = document.createElement('button');
    b.className = 'chip' + (v === current ? ' active' : '');
    b.textContent = labels ? labels(v) : String(v).replace(/-/g, ' ');
    b.onclick = () => { onPick(v); saveConfig(); applyConfig(); renderSettings(); renderAll(); };
    el.appendChild(b);
  });
}

function renderSettings() {
  chips('#set-sound', Sound.packs, config.sound, v => { config.sound = v; Sound.pack = v; Sound.preview(v); });
  chips('#set-spacesound', ['same', 'deeper', 'off'], config.spaceSound, v => {
    config.spaceSound = v;
    if (v !== 'off') Sound.play(v === 'deeper' ? 'space' : 'letter');
  });
  chips('#set-errorsound', [true, false], config.errorSound, v => config.errorSound = v, v => v ? 'on' : 'off');
  chips('#set-theme', THEMES, config.theme, v => config.theme = v);
  chips('#set-caret', ['line', 'block', 'underline', 'off'], config.caret, v => config.caret = v);
  chips('#set-smooth', [true, false], config.smooth, v => config.smooth = v, v => v ? 'on' : 'off');
  chips('#set-stoponerror', ['off', 'letter', 'word'], config.stopOnError, v => config.stopOnError = v);
  chips('#set-blind', [true, false], config.blind, v => config.blind = v, v => v ? 'on' : 'off');
  chips('#set-livewpm', [true, false], config.liveWpm, v => config.liveWpm = v, v => v ? 'on' : 'off');
  chips('#set-tape', [false, true], config.tape, v => { config.tape = v; }, v => v ? 'single line' : 'paragraph');
  chips('#set-font', FONTS, config.font, v => config.font = v, v => v);
  chips('#set-weight', [400, 500, 700], config.fontWeight, v => config.fontWeight = v,
        v => v === 400 ? 'regular' : v === 500 ? 'medium' : 'bold');
  chips('#set-fontsize', [1.2, 1.6, 2, 2.4], config.fontSize, v => config.fontSize = v, v => v + 'x');
  $('#set-volume').value = config.volume;
  /* Sound arriving late is the audio device, not the page — show the number
     so it can be told apart from a bug in here. */
  const l = Sound.latency;
  $('#latency-note').textContent = l ? `output latency ${l.total} ms` : '';
}

$('#set-volume').addEventListener('input', e => {
  config.volume = +e.target.value; Sound.volume = config.volume / 100; saveConfig();
});
$('#set-volume').addEventListener('change', () => Sound.play('letter'));
$('#set-reset').addEventListener('click', () => {
  if (!confirm('Clear all results, personal bests and per-key history?')) return;
  store.clear(); history = []; pb = {}; keyStats = {};
  Object.assign(config, DEFAULTS); saveConfig(); applyConfig(); renderConfigBar(); renderSettings(); restart();
});

/* stats drawer ----------------------------------------------------- */
function renderStats() {
  const order = ['time-15','time-30','time-60','time-120','words-10','words-25','words-50','words-100'];
  const keys = order.filter(k => pb[k]).concat(Object.keys(pb).filter(k => !order.includes(k)));
  $('#pb-grid').innerHTML = keys.length ? keys.map(k => `
    <div class="pb-card">
      <div class="pb-mode">${k.replace(/-/g, ' ')}</div>
      <div class="pb-wpm">${pb[k].wpm}</div>
      <div class="pb-acc">${pb[k].acc}% acc</div>
    </div>`).join('')
    : '<p style="color:var(--sub);font-size:.9rem">no personal bests yet — finish a test.</p>';

  $('#history-body').innerHTML = history.slice(0, 50).map(r => `
    <tr><td>${r.wpm}</td><td class="dim">${r.raw}</td><td>${r.acc}%</td>
        <td class="dim">${r.consistency}%</td><td class="dim">${r.mode}</td>
        <td class="dim">${new Date(r.date).toLocaleString()}</td></tr>`).join('');

  $('#keyboard-heat').innerHTML = WORDS.rows.map((row, ri) => `<div class="heat-row" style="padding-left:${ri * 1.1}rem">${
    row.split('').map(ch => {
      const s = keyStats[ch];
      const acc = s && s.n >= 3 ? 1 - s.err / s.n : null;
      const bg = acc === null ? 'color-mix(in srgb, var(--sub) 15%, transparent)'
        : acc > 0.97 ? 'color-mix(in srgb, var(--main) 55%, transparent)'
        : acc > 0.92 ? 'color-mix(in srgb, var(--main) 28%, transparent)'
        : acc > 0.85 ? 'color-mix(in srgb, var(--err) 30%, transparent)'
        : 'color-mix(in srgb, var(--err) 60%, transparent)';
      const title = s ? `${ch}: ${Math.round((1 - s.err / s.n) * 100)}% over ${s.n}` : `${ch}: no data`;
      return `<div class="heat-key" style="background:${bg}" title="${title}">${ch}</div>`;
    }).join('')}</div>`).join('');

  drawHistoryChart();
}

/* command palette -------------------------------------------------- */
let palIndex = 0, palItems = [];

function commands() {
  const c = [
    { name: 'restart test', hint: 'tab', run: restart },
    { name: 'repeat this text', run: repeat },
    { name: 'open settings', run: () => openDrawer('settings') },
    { name: 'view your results', run: () => openDrawer('stats') },
    { name: 'toggle punctuation', run: () => { config.punctuation = !config.punctuation; saveConfig(); renderConfigBar(); restart(); } },
    { name: 'toggle numbers', run: () => { config.numbers = !config.numbers; saveConfig(); renderConfigBar(); restart(); } },
    { name: 'toggle blind mode', run: () => { config.blind = !config.blind; saveConfig(); applyConfig(); } }
  ];
  ['time','words','quote','zen','adaptive'].forEach(m => c.push({ name: `mode ${m}`, hint: 'mode', run: () => setMode(m) }));
  AMOUNTS.time.forEach(v => c.push({ name: `time ${v}`, hint: 'time', run: () => { config.mode='time'; config.time=v; saveConfig(); renderConfigBar(); restart(); } }));
  AMOUNTS.words.forEach(v => c.push({ name: `words ${v}`, hint: 'words', run: () => { config.mode='words'; config.wordCount=v; saveConfig(); renderConfigBar(); restart(); } }));
  THEMES.forEach(t => c.push({ name: `theme ${t.replace(/-/g,' ')}`, hint: 'theme', run: () => { config.theme=t; saveConfig(); applyConfig(); } }));
  Sound.packs.forEach(s => c.push({ name: `sound ${s}`, hint: 'sound', run: () => { config.sound=s; saveConfig(); applyConfig(); Sound.play('letter'); } }));
  ['same','deeper','off'].forEach(v => c.push({ name: `space bar sound ${v}`, hint: 'sound', run: () => { config.spaceSound=v; saveConfig(); } }));
  c.push({ name: `single line (tape) ${config.tape ? 'off' : 'on'}`, hint: 'display',
           run: () => { config.tape = !config.tape; saveConfig(); applyConfig(); renderAll(); } });
  FONTS.forEach(f => c.push({ name: `font ${f}`, hint: 'font', run: () => { config.font=f; saveConfig(); applyConfig(); renderAll(); } }));
  [400,500,700].forEach(v => c.push({ name: `font weight ${v}`, hint: 'font', run: () => { config.fontWeight=v; saveConfig(); applyConfig(); updateCaret(); } }));
  return c;
}

function openPalette() {
  const p = $('#palette');
  if (!p.hidden) return closePalette();
  p.hidden = false;
  $('#palette-input').value = '';
  filterPalette('');
  $('#palette-input').focus();
}
function closePalette() { $('#palette').hidden = true; inputEl.focus({ preventScroll: true }); }

function filterPalette(q) {
  const needle = q.toLowerCase().trim();
  palItems = commands().filter(c => !needle || c.name.toLowerCase().includes(needle));
  palIndex = 0;
  $('#palette-list').innerHTML = palItems
    .map((c, i) => `<li class="${i === 0 ? 'sel' : ''}" data-i="${i}">${c.name}<span class="p-hint">${c.hint || ''}</span></li>`)
    .join('');
}
function movePalette(d) {
  if (!palItems.length) return;
  palIndex = (palIndex + d + palItems.length) % palItems.length;
  $$('#palette-list li').forEach((li, i) => li.classList.toggle('sel', i === palIndex));
  const sel = $('#palette-list li.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function runPalette() {
  const c = palItems[palIndex];
  closePalette();
  if (c) c.run();
}

$('#palette-input').addEventListener('input', e => filterPalette(e.target.value));
$('#palette-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(); }
  else if (e.key === 'Tab') e.preventDefault();
});
$('#palette-list').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  palIndex = +li.dataset.i; runPalette();
});
$('#palette').addEventListener('mousedown', e => { if (e.target.id === 'palette') closePalette(); });

/* drawers ---------------------------------------------------------- */
function openDrawer(id) {
  $('#' + id).hidden = false;
  if (id === 'settings') renderSettings();
  if (id === 'stats') renderStats();
}
function closeDrawers() {
  ['settings', 'stats'].forEach(id => $('#' + id).hidden = true);
  inputEl.focus({ preventScroll: true });
}
$$('[data-close]').forEach(b => b.onclick = closeDrawers);
$$('.drawer').forEach(d => d.addEventListener('mousedown', e => { if (e.target === d) closeDrawers(); }));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (!$('#settings').hidden || !$('#stats').hidden)) { e.preventDefault(); closeDrawers(); }
}, true);

/* wiring ----------------------------------------------------------- */
$$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$$('[data-toggle]').forEach(b => b.onclick = () => {
  config[b.dataset.toggle] = !config[b.dataset.toggle];
  saveConfig(); renderConfigBar(); restart();
});
$('#restart').onclick = restart;
$('#next-test').onclick = restart;
$('#repeat-test').onclick = repeat;
$('#logo').onclick = e => { e.preventDefault(); restart(); };
$('#share-result').onclick = async () => {
  const r = history[0]; if (!r) return;
  const text = `${r.wpm} wpm · ${r.acc}% acc · ${r.mode} · consistency ${r.consistency}% — type`;
  try { await navigator.clipboard.writeText(text); $('#share-result').textContent = '✓'; }
  catch { $('#share-result').textContent = '✕'; }
  setTimeout(() => $('#share-result').textContent = '⧉', 1200);
};
$$('[data-action]').forEach(b => b.onclick = () => {
  const a = b.dataset.action;
  if (a === 'palette') openPalette();
  if (a === 'settings') openDrawer('settings');
  if (a === 'stats') openDrawer('stats');
  if (a === 'theme') { const i = THEMES.indexOf(config.theme); config.theme = THEMES[(i + 1) % THEMES.length]; saveConfig(); applyConfig(); }
  if (a === 'sound') { const i = Sound.packs.indexOf(config.sound); config.sound = Sound.packs[(i + 1) % Sound.packs.length]; saveConfig(); applyConfig(); Sound.play('letter'); }
});

areaEl.addEventListener('mousedown', () => setTimeout(() => inputEl.focus({ preventScroll: true }), 0));

/* Keystrokes are read from `document`, so the test is live whether or not the
   hidden input holds focus. The overlay therefore means one thing only: this
   window is not the one receiving keys. */
const setFocused = on => {
  areaEl.classList.toggle('unfocused', !on);
  if (on) inputEl.focus({ preventScroll: true });
};
window.addEventListener('blur', () => setFocused(false));
window.addEventListener('focus', () => setFocused(true));
$('#outoffocus').addEventListener('click', () => setFocused(true));
document.addEventListener('keydown', () => areaEl.classList.remove('unfocused'), true);

document.addEventListener('keydown', onKeyDown);

/* Focus mode should survive a twitchy mouse: real movement brings the
   chrome back, a pixel of drift does not. */
let mx = null, my = null;
document.addEventListener('mousemove', e => {
  if (mx !== null && Math.hypot(e.clientX - mx, e.clientY - my) < 12) return;
  mx = e.clientX; my = e.clientY;
  document.body.classList.remove('typing');
});
document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
window.addEventListener('resize', () => { measureLines(); scrollView(); updateCaret(); if (!resultsEl.hidden) drawChart(); });

/* A read-only window into the engine, for the test harness. */
window.__type = { get state() { return state; }, get config() { return config; } };

/* go --------------------------------------------------------------- */
applyConfig();
renderConfigBar();
restart();
setFocused(document.hasFocus());
})();
