/* ─────────────────────────────────────────────────────────────────
   app.js — the test engine.

   Layout of this file:
     1. config + storage        persisted settings, results, per-key stats
     2. word generation         english / english 1k / code / quotes / adaptive
     3. rendering               words, caret, pace caret, line scrolling
     4. input                   keydown, the mobile input path, space, backspace
     5. timing + statistics     wpm, raw, accuracy, consistency, the keystroke log
     6. results + charts        canvas, drawn by hand, no chart library
     7. leaderboard             the results prompt and the drawer
     8. ui                      config bar, settings, stats, palette, drawers
   ───────────────────────────────────────────────────────────────── */
(() => {
'use strict';

/* ── 1. config + storage ─────────────────────────────────────────── */

const DEFAULTS = {
  mode: 'time', time: 30, wordCount: 25, quoteLength: 'medium',
  punctuation: false, numbers: false, wordList: 'english',
  theme: 'serika-dark', sound: 'click', volume: 35, errorSound: true,
  caret: 'line', smooth: true, stopOnError: 'off',
  blind: false, liveWpm: true, fontSize: 1.6,
  spaceSound: 'same', font: 'JetBrains Mono', fontWeight: 500,
  tape: false, storyLength: 'medium',
  pace: 'off', paceWpm: 60,               // a ghost caret: off | pb | last | custom
  leaderboard: 'ask', name: ''            // ask | on | off
};

/* Modes with no finish line of their own: they run until you stop them. */
const ENDLESS = ['infinite', 'zen', 'adaptive'];
const FINITE  = ['words', 'quote', 'story'];
const GENERATED = ['time', 'words', 'infinite', 'adaptive'];   // built from a word list
const isEndless   = () => ENDLESS.includes(config.mode);
const isGenerated = () => GENERATED.includes(config.mode);

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
if (!WORDS.lists[config.wordList]) config.wordList = 'english';
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
  quote: null, lineTops: [],
  shift: { x: 0, y: 0 },         // where the view has scrolled the words to
  domOffset: 0,                  // index of the first word still in the DOM
  log: [],                       // every keystroke of this run, see replay.js
  result: null,                  // the finished run, for sharing and submitting
  elapsed: 0                     // its length in seconds, to the millisecond
};

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const wordsEl   = $('#words');
const windowEl  = $('#words-window');
const caretEl   = $('#caret');
const paceEl    = $('#pace-caret');
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
      /* a new sentence after . ! ? — also when the previous word closed a
         quote or a bracket, as in `said."` */
      if (i === 0 || /[.!?]["')]?$/.test(out[i - 1] || '')) out[i] = out[i][0].toUpperCase() + out[i].slice(1);
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

const wordList = () => WORDS.lists[config.wordList] || WORDS.english;

function makeWords(n) {
  const list = wordList();
  const raw = [];
  let last = '';
  for (let i = 0; i < n; i++) {
    let w;
    do { w = config.mode === 'adaptive' ? adaptivePick(list) : rnd(list); } while (w === last && list.length > 1);
    last = w;
    raw.push(w);
  }
  return decorate(raw);
}

/* A passage, cut to length at the end of a sentence — a story that stops
   mid-clause is worse than one that runs a few words long. */
const STORY_CAP = { short: 50, medium: 100, long: 200, full: Infinity };

const endsSentence = w => /[.!?]["']?$/.test(w);

function pickStory() {
  const s = rnd(STORIES);
  const words = s.text.trim().split(/\s+/);
  const cap = STORY_CAP[config.storyLength] ?? 100;
  if (words.length <= cap) return { ...s, words };

  let end = 0;
  for (let i = cap; i < Math.min(words.length, cap + 30); i++)
    if (endsSentence(words[i])) { end = i + 1; break; }
  if (!end) for (let i = cap - 1; i > cap / 2; i--)
    if (endsSentence(words[i])) { end = i + 1; break; }
  return { ...s, words: words.slice(0, end || cap) };
}

function seed() {
  state.quote = null;
  if (config.mode === 'story') {
    state.quote = pickStory();
    state.words = state.quote.words;
  } else if (config.mode === 'quote') {
    const pool = WORDS.quotes.filter(q => q.length === config.quoteLength);
    state.quote = rnd(pool.length ? pool : WORDS.quotes);
    state.words = state.quote.text.split(/\s+/);
  } else if (config.mode === 'words') {
    state.words = makeWords(config.wordCount);
  } else if (config.mode === 'zen') {
    state.words = [];
  } else {                                     // time, infinite, adaptive
    /* Enough for the whole test at a fast pace before a single key is
       pressed: 200 wpm for the full duration, floor of 80. Topping up is
       still there, but it should never be what saves the test. */
    const need = config.mode === 'time' ? Math.max(80, Math.ceil(config.time / 60 * 200)) : 80;
    state.words = makeWords(need);
  }
}

/* time and adaptive never run out of words */
function topUp() {
  if (['quote', 'story', 'words', 'zen'].includes(config.mode)) return;
  if (state.words.length - state.wordIndex < 40) {
    const more = makeWords(60);
    state.words.push(...more);
    appendWords(more);
  }
}

/* ── 3. rendering ────────────────────────────────────────────────── */

const esc = c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;
const escText = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

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
  state.shift = { x: 0, y: 0 };
  measureLines();
  scrollView();
  updateCaret();
  snapMotion();                    // a freshly drawn test does not slide into place
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

/* The letters of a word are already on the page; typing only changes what
   colour they are. Rewriting innerHTML for every keystroke threw away and
   rebuilt those nodes and forced a fresh layout each time, which is the jank
   underneath everything else. Only the class changes now, and the markup is
   rebuilt solely when the number of letters actually changes — that is, when
   an extra letter is added past the end of the word or removed again. */
function updateWord(i) {
  const el = wordEl(i);
  if (!el) return;
  const word = state.words[i] || '', typed = state.typed[i] || '';
  const spans = el.children;
  const needed = Math.max(word.length, typed.length) || 1;

  if (spans.length !== needed) {
    el.innerHTML = wordHTML(i);
  } else {
    for (let j = 0; j < needed; j++) {
      const t = word[j], k = typed[j], span = spans[j];
      const cls = t === undefined ? 'letter extra'
                : k === undefined ? 'letter'
                : k === t ? 'letter correct' : 'letter incorrect';
      if (span.className !== cls) span.className = cls;
      if (t === undefined && span.textContent !== k) span.textContent = k;
    }
  }
  el.classList.toggle('error',
    i < state.wordIndex && state.typed[i] !== undefined && typed !== word);
}

/* Only a change in letter count can rewrap a line. */
const widthChanged = (word, typed) => typed.length > word.length;

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
  state.shift = { x: Math.round(areaEl.clientWidth / 2 - active.offsetLeft), y: 0 };
}

function scrollView() { config.tape ? scrollTape() : scrollLines(); frame(); }

/* ── motion ────────────────────────────────────────────────────────
   The text and the caret used to animate independently, each on its own CSS
   transition that restarted from wherever it happened to be on every
   keystroke. Two consequences: at speed neither ever arrived, so the caret sat
   a character behind your fingers; and while the view slid to a new line the
   caret was already drawn at the new offset, so the two came apart.

   Both are now one thing. The caret's position is stored in the text's own
   coordinates, and the same frame that moves the text moves the caret with it,
   so they cannot drift apart. Motion is exponential smoothing with a half-life
   rather than a fixed duration: it converges from wherever it is, it never
   restarts, and it is frame-rate independent — the same on 60Hz and 144Hz. */

const view   = { x: 0, y: 0 };                 // where the text actually is
const caret  = { x: 0, y: 0, h: 0 };           // caret, in text coordinates
const target = { x: 0, y: 0, h: 0 };           // where the caret is headed
let frameId = null, lastFrame = 0;

/* One rate for both. The caret's target and the view move in opposite
   directions when a line wraps, and they only cancel out — keeping the caret
   glued to its letter — if they travel at the same speed. */
/* 18ms: the caret covers most of the distance inside a frame or two, so it
   reads as movement rather than as a jump, but at 200 wpm it is never more
   than a couple of pixels behind your fingers. Longer than about 25ms and a
   fast typist can see it trailing. */
const HALF_LIFE = 18;                              // milliseconds

/* exponential approach: half the remaining distance every `half` ms */
const approach = (cur, tgt, half, dt) => tgt + (cur - tgt) * Math.pow(2, -dt / half);

function frame(now) {
  if (now === undefined) {                     // called from an event: start one
    if (frameId === null) { lastFrame = performance.now(); frameId = requestAnimationFrame(frame); }
    return;
  }
  const dt = Math.min(now - lastFrame, 50);    // a dropped frame must not teleport
  lastFrame = now;

  if (config.smooth) {
    view.x = approach(view.x, state.shift.x, HALF_LIFE, dt);
    view.y = approach(view.y, state.shift.y, HALF_LIFE, dt);
    caret.x = approach(caret.x, target.x, HALF_LIFE, dt);
    caret.y = approach(caret.y, target.y, HALF_LIFE, dt);
  } else {
    view.x = state.shift.x; view.y = state.shift.y;
    caret.x = target.x; caret.y = target.y;
  }
  caret.h = target.h;

  const settled =
    Math.abs(view.x - state.shift.x) < 0.3 && Math.abs(view.y - state.shift.y) < 0.3 &&
    Math.abs(caret.x - target.x) < 0.3 && Math.abs(caret.y - target.y) < 0.3;
  if (settled) {
    view.x = state.shift.x; view.y = state.shift.y;
    caret.x = target.x; caret.y = target.y;
  }

  /* Whole pixels: a fractional offset resamples every glyph, and a caret on a
     half pixel is a two-pixel grey smear instead of a sharp bar. */
  wordsEl.style.transform = (view.x || view.y)
    ? `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px)` : 'none';
  caretEl.style.transform =
    `translate(${Math.round(caret.x + view.x)}px, ${Math.round(caret.y + view.y)}px)`;
  caretEl.style.height = `${Math.round(caret.h)}px`;

  frameId = settled ? null : requestAnimationFrame(frame);
}

/* Jump both to their targets without animating — a new test, a resize. */
function snapMotion() {
  view.x = state.shift.x; view.y = state.shift.y;
  caret.x = target.x; caret.y = target.y; caret.h = target.h;
  frame();
}

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
}

/* Where a letter sits, in the text's own coordinates. Layout offsets, not
   bounding rects: offsetLeft/Top ignore the transform on the words
   container, so the position is right even while the view is still
   animating. Letter offsets are relative to the word (it is
   `position: relative` for the error underline), so both halves are added. */
function letterPos(active, index) {
  const letters = active.children;
  const ox = active.offsetLeft, oy = active.offsetTop;
  if (index < letters.length) {
    const l = letters[index];
    return { x: ox + l.offsetLeft, y: oy + l.offsetTop, h: l.offsetHeight };
  }
  if (letters.length) {
    const l = letters[letters.length - 1];
    return { x: ox + l.offsetLeft + l.offsetWidth, y: oy + l.offsetTop, h: l.offsetHeight };
  }
  return { x: ox, y: oy, h: active.offsetHeight };
}

function updateCaret() {
  const active = wordEl(state.wordIndex);
  if (!active) { caretEl.classList.add('hidden'); return; }
  caretEl.classList.remove('hidden');
  const typedLen = (state.typed[state.wordIndex] || '').length;
  let { x, y, h } = letterPos(active, typedLen);

  if (config.caret === 'underline') y += h * 0.82;
  /* Stored in the text's coordinates, without the scroll offset: the frame
     adds the offset as it animates, which is what keeps the two locked. */
  const nx = x, ny = y + h * 0.11;
  const jumpedLine = Math.abs(ny - target.y) > 1;
  const jumpedFar  = Math.abs(nx - caret.x) > areaEl.clientWidth * 0.3;
  target.x = nx;
  target.y = ny;
  target.h = h * 0.78;
  if (jumpedLine || jumpedFar) {        // a wrap: be there, do not travel there
    caret.x = nx;
    caret.y = ny;
  }
  frame();
}

/* ── pace caret ────────────────────────────────────────────────────
   A second, dimmer caret that moves through the text at a fixed speed —
   your personal best for this test, your last run, or a number you pick.
   It is positioned every frame from the clock, so it never stutters and
   never has to be caught up. */
function paceWpm() {
  if (config.pace === 'off' || config.mode === 'zen') return 0;
  if (config.pace === 'custom') return +config.paceWpm || 0;
  const key = modeKey();
  if (config.pace === 'pb') return (pb[key] || {}).wpm || 0;
  if (config.pace === 'last') return (history.find(r => r.key === key) || {}).wpm || 0;
  return 0;
}

function updatePace() {
  const wpm = state.started && !state.finished ? paceWpm() : 0;
  if (!wpm) { paceEl.hidden = true; return; }
  const chars = wpm * 5 * (performance.now() - state.startTime) / 60000;
  let i = 0, cum = 0;
  for (; i < state.words.length; i++) {
    const len = state.words[i].length + 1;               // + the space
    if (chars < cum + len) break;
    cum += len;
  }
  const el = wordEl(i);
  if (!el) { paceEl.hidden = true; return; }              // pruned, or off the end
  const { x, y, h } = letterPos(el, Math.floor(chars - cum));
  paceEl.hidden = false;
  paceEl.style.transform = `translate(${Math.round(x + view.x)}px, ${Math.round(y + h * 0.11 + view.y)}px)`;
  paceEl.style.height = `${Math.round(h * 0.78)}px`;
}

/* ── 4. input ────────────────────────────────────────────────────── */

const MAX_EXTRA = Replay.MAX_EXTRA;

/* Every key that changes the test goes into the log, stamped in
   milliseconds since the first keystroke — see replay.js for the format. */
function logKey(k, refused) {
  const t = Math.round(performance.now() - state.startTime);
  state.log.push(refused ? [t, k, 'r'] : [t, k]);
}

/* The hidden input mirrors the word being typed. On a desktop keyboard the
   keydown handler does all the work and this only keeps the two in step;
   on a phone the keyboard edits the input and the `input` handler below
   works out what changed. */
function syncInput() {
  const v = state.typed[state.wordIndex] || '';
  if (inputEl.value !== v) inputEl.value = v;
}

/* Chrome fades back in on any mouse movement; the next keystroke takes it
   away again, so a nudge of the mouse does not cost the rest of the test. */
function focusMode() {
  if (state.started && !document.body.classList.contains('typing')) document.body.classList.add('typing');
}

function typeChar(ch) {
  if (state.finished) return;
  if (!state.started) start();
  focusMode();

  if (config.mode === 'zen' && state.words.length === 0) {
    state.words.push(''); appendWords(['']);
  }

  const i = state.wordIndex;
  if (config.mode !== 'zen' && !state.words[i]) { topUp(); renderAll(); }
  const target = config.mode === 'zen' ? null : (state.words[i] || '');
  const typed  = state.typed[i] || '';

  if (target !== null && typed.length >= target.length + MAX_EXTRA) return;

  const expected = target === null ? ch : target[typed.length];
  const correct  = ch === expected;

  if (!correct && config.stopOnError === 'letter') {
    state.keys.incorrect++;
    trackKey(expected, false);
    logKey(ch, true);
    Sound.play('error');
    return;
  }

  logKey(ch);
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
  if (widthChanged(target || '', state.typed[i])) { measureLines(); scrollView(); }
  updateCaret();
  syncInput();

  /* The last word of a finite test ends it the moment it is complete —
     nobody types a trailing space at the end of a quote. */
  if (target !== null && state.typed[i] === target && isLastWord(i)) finish();
}

function isLastWord(i) {
  if (config.mode === 'words') return i === config.wordCount - 1;
  if (['quote', 'story'].includes(config.mode)) return i === state.words.length - 1;
  return false;
}

function typeSpace() {
  if (state.finished) return;
  if (!state.started) start();
  focusMode();
  const i = state.wordIndex;
  const typed = state.typed[i] || '';
  if (!typed.length) return;                       // no empty words

  const target = config.mode === 'zen' ? typed : (state.words[i] || '');

  if (config.stopOnError === 'word' && typed !== target) { Sound.play('error'); return; }

  logKey(' ');
  if (typed === target) state.keys.correct++; else state.keys.incorrect++;
  if (typed.length < target.length) state.keys.missed += target.length - typed.length;

  if (config.spaceSound !== 'off') Sound.play(config.spaceSound === 'deeper' ? 'space' : 'letter');
  state.wordIndex++;
  updateWord(i);

  if (config.mode === 'zen') { state.words.push(''); appendWords(['']); }

  const limitReached =
    (config.mode === 'words' && state.wordIndex >= config.wordCount) ||
    (['quote', 'story'].includes(config.mode) && state.wordIndex >= state.words.length);
  if (limitReached) return finish();

  topUp();
  prune();
  scrollView();
  updateCaret();
  syncInput();
}

function backspace(whole) {
  if (state.finished || !state.started) return;
  const i = state.wordIndex;
  const typed = state.typed[i] || '';

  if (!typed.length) {
    if (i === 0) return;
    const prev = state.typed[i - 1] || '';
    if (config.mode !== 'zen' && prev === state.words[i - 1]) return;  // correct words are locked
    logKey(whole ? Replay.WORD_BACK : Replay.BACK);
    state.wordIndex--;
    if (whole) state.typed[i - 1] = '';
    updateWord(i - 1);
    scrollView(); updateCaret(); syncInput();
    Sound.play('back');
    return;
  }
  logKey(whole ? Replay.WORD_BACK : Replay.BACK);
  state.typed[i] = whole ? '' : typed.slice(0, -1);
  if (config.mode === 'zen') state.words[i] = state.typed[i];
  updateWord(i);
  if (widthChanged(state.words[i] || '', typed)) { measureLines(); scrollView(); }
  updateCaret();
  syncInput();
  Sound.play('back');
}

const drawerOpen = () => ['settings', 'stats', 'leaderboard'].some(id => !$('#' + id).hidden);
const isEditable = el => el && el !== inputEl && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function onKeyDown(e) {
  /* A drawer takes every key: esc closes it, the rest is its own business.
     Handling esc here — and only here — is what stops it from also opening
     the command palette on the way out. */
  if (drawerOpen()) {
    if (e.key === 'Escape') { e.preventDefault(); closeDrawers(); }
    return;
  }
  if (!$('#palette').hidden) return;            // the palette has its own handler
  if (isEditable(e.target)) return;             // a text field on the results screen
  if (e.key === 'Tab')     { e.preventDefault(); return restart(); }
  if (e.key === 'Escape')  { e.preventDefault(); return openPalette(); }
  if (e.getModifierState) $('#capslock').hidden = !e.getModifierState('CapsLock');
  if (e.altKey || e.metaKey) return;
  if (e.key === 'Backspace') { e.preventDefault(); return backspace(e.ctrlKey); }
  if (e.ctrlKey) return;
  if (e.key === ' ')       { e.preventDefault(); return typeSpace(); }
  if (e.key === 'Enter') {
    if (isEndless() && e.shiftKey) { e.preventDefault(); return finish(); }
    if (config.mode === 'zen') { e.preventDefault(); return typeSpace(); }
    return;
  }
  if (e.key.length === 1)  { e.preventDefault(); return typeChar(e.key); }
}

/* Phone keyboards do not send usable keydowns — Android reports every key
   as `Unidentified` and composes words through the IME. So the input is
   left to take the edit, and what changed is read off its value: the
   letters after the common prefix were typed, anything of the old word
   past it was deleted. A space commits the word. */
inputEl.addEventListener('input', () => {
  if (state.finished) { inputEl.value = ''; return; }
  const v = inputEl.value;
  const prev = state.typed[state.wordIndex] || '';
  if (v === prev) return;
  let common = 0;
  while (common < v.length && common < prev.length && v[common] === prev[common]) common++;
  for (let k = prev.length; k > common; k--) backspace(false);
  for (const ch of v.slice(common)) {
    if (state.finished) break;
    if (ch === ' ' || ch === '\n') typeSpace(); else if (ch.length === 1) typeChar(ch);
  }
  syncInput();
});

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

const elapsedMs = () => performance.now() - state.startTime;
const minutes = () => Math.max(elapsedMs() / 60000, 1 / 60000);
const liveWpm = () => Math.round(correctChars() / 5 / minutes());

function start() {
  state.started = true;
  state.startTime = performance.now();
  document.body.classList.add('typing');
  areaEl.classList.remove('unfocused');
  scheduleTick();
  loop();
}

/* The clock is the wall clock, not a count of timer callbacks. setInterval
   drifts a few milliseconds a second and a background tab throttles it to
   a crawl; both used to make a 60-second test run long. Each tick is now
   scheduled for the next whole second after the first keystroke, and if
   the browser was late it catches up. */
function scheduleTick() {
  const due = state.startTime + (state.secondsElapsed + 1) * 1000;
  state.timerId = setTimeout(tick, Math.max(0, due - performance.now()));
}

function tick() {
  if (state.finished || !state.started) return;
  const due = Math.floor(elapsedMs() / 1000);
  while (state.secondsElapsed < due) {
    state.secondsElapsed++;
    sample();
    if (config.mode === 'time' && state.secondsElapsed >= config.time) break;
  }
  if (config.mode === 'time') {
    const left = config.time - state.secondsElapsed;
    counterEl.textContent = Math.max(0, left);
    if (left <= 0) return finish();
  }
  scheduleTick();
}

function sample() {
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
}

function loop() {
  if (state.finished) return;
  topUp();
  if (config.liveWpm && state.started) {
    liveWpmEl.hidden = false;
    liveWpmEl.textContent = liveWpm() + ' wpm';
  }
  if (config.mode !== 'time') counterEl.textContent = progressLabel();
  updatePace();
  state.rafId = requestAnimationFrame(loop);
}

function progressLabel() {
  if (config.mode === 'time')  return String(config.time);
  if (config.mode === 'words') return `${state.wordIndex}/${config.wordCount}`;
  if (['quote', 'story'].includes(config.mode)) return `${state.wordIndex}/${state.words.length}`;
  /* Endless: there is no target to count down to, so count up — elapsed
     time, and how many words you have put behind you. */
  if (!state.started) return '0:00';
  const secs = Math.floor(elapsedMs() / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · ${state.wordIndex}`;
}

function trackKey(ch, ok) {
  if (!ch || ch === ' ') return;
  const k = ch.toLowerCase();
  if (!/^[a-z0-9]$/.test(k)) return;
  const s = keyStats[k] || (keyStats[k] = { n: 0, err: 0 });
  s.n++; if (!ok) s.err++;
}

/* ── 6. results + charts ─────────────────────────────────────────── */

function finish() {
  if (state.finished || !state.started) return;
  state.finished = true;
  state.endTime = performance.now();
  clearTimeout(state.timerId);
  cancelAnimationFrame(state.rafId);
  document.body.classList.remove('typing');
  paceEl.hidden = true;
  inputEl.value = '';

  /* whole milliseconds: the evidence sent to the leaderboard carries this same
     number, so the server's replay lands on exactly the same wpm */
  const secs = Math.max(Math.round(state.endTime - state.startTime) / 1000, 0.001);
  const mins = secs / 60;
  const correct = correctChars();
  const all = typedChars();
  const k = state.keys;
  const attempts = k.correct + k.incorrect + k.extra;

  const result = {
    wpm: Math.round(correct / 5 / mins),
    raw: Math.round(all / 5 / mins),
    acc: attempts ? Math.round((k.correct / attempts) * 1000) / 10 : 0,
    consistency: Replay.consistency(state.perSecond.map(s => s.raw)),
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
  state.result = result;
  state.elapsed = secs;

  showResults(result, isPb);
  offerLeaderboard(result, secs);
}

function modeLabel() {
  if (config.mode === 'time')  return `time ${config.time}`;
  if (config.mode === 'words') return `words ${config.wordCount}`;
  if (config.mode === 'quote') return `quote ${config.quoteLength}`;
  if (config.mode === 'story') return `story ${config.storyLength}`;
  if (config.mode === 'zen')   return 'zen';
  if (config.mode === 'infinite') return 'infinite';
  return 'adaptive';
}
/* The key a personal best is filed under. Punctuation, numbers and a
   different word list each make a different test, so each gets its own. */
function modeKey() {
  const extra = !isGenerated() ? ''
    : (config.punctuation ? '+p' : '') + (config.numbers ? '+n' : '') +
      (config.wordList !== 'english' ? '@' + config.wordList.replace(/\s+/g, '') : '');
  if (config.mode === 'time')  return `time-${config.time}${extra}`;
  if (config.mode === 'words') return `words-${config.wordCount}${extra}`;
  if (config.mode === 'quote') return `quote-${config.quoteLength}`;
  if (config.mode === 'story') return `story-${config.storyLength}`;
  return config.mode + extra;
}
const keyLabel = k => k.replace(/@/, ' · ').replace(/-/g, ' ').replace(/\+p/, ' punct').replace(/\+n/, ' num');

function typeLabel() {
  const parts = [modeLabel()];
  if (isGenerated()) {
    if (config.wordList !== 'english') parts.push(config.wordList);
    if (config.punctuation) parts.push('punct');
    if (config.numbers) parts.push('num');
  }
  return parts.join(' · ');
}

function showResults(r, isPb) {
  testEl.hidden = true;
  $('#config').style.display = 'none';
  resultsEl.hidden = false;
  $('#r-wpm').textContent = r.wpm;
  $('#r-acc').textContent = r.acc + '%';
  $('#r-pb').hidden = !isPb;
  $('#r-type').textContent = typeLabel();
  $('#r-raw').textContent = r.raw;
  $('#r-chars').textContent = r.chars;
  $('#r-consistency').textContent = r.consistency + '%';
  $('#r-time').textContent = r.seconds + 's';
  if (state.quote) $('#r-type').textContent = state.quote.title
    ? `${state.quote.title}${state.quote.author ? ' — ' + state.quote.author : ''}`
    : 'quote — ' + state.quote.source;
  drawChart();
  showWeakKeys();
  showWordStats();
}

function showWeakKeys() {
  const weak = Object.entries(keyStats)
    .filter(([, s]) => s.n >= 8 && s.err > 0)
    .map(([ch, s]) => ({ ch, rate: s.err / s.n }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 6);
  $('#weak-keys').hidden = weak.length === 0;
  $('#weak-list').innerHTML = weak
    .map(w => `<span class="weak-key">${escText(w.ch)} <small>${Math.round(w.rate * 100)}%</small></span>`).join('');
}

/* Which words went wrong, and which ones were slow — the words are where
   the time goes, and a list of them is the most useful thing a results
   screen can say. */
function showWordStats() {
  const wrong = [];
  for (let i = 0; i < state.wordIndex; i++) {
    const t = state.words[i], k = state.typed[i];
    if (t && k !== undefined && k !== t && !wrong.includes(t)) wrong.push(t);
  }
  const wrongEl = $('#wrong-words');
  wrongEl.hidden = wrong.length === 0;
  $('#wrong-list').innerHTML = wrong.slice(0, 12)
    .map(w => `<span class="stat-word err">${escText(w)}</span>`).join('') +
    (wrong.length > 12 ? `<span class="stat-more">+${wrong.length - 12} more</span>` : '');

  const times = Replay.wordTimes(state.words, state.log)
    .filter(w => w.word.length >= 3 && w.ms > 0)
    .map(w => ({ ...w, wpm: Math.round((w.word.length + 1) / 5 / (w.ms / 60000)) }))
    .sort((a, b) => a.wpm - b.wpm);
  const slow = [];
  for (const w of times) { if (!slow.some(s => s.word === w.word)) slow.push(w); if (slow.length === 5) break; }
  const slowEl = $('#slow-words');
  slowEl.hidden = slow.length < 3;
  $('#slow-list').innerHTML = slow
    .map(w => `<span class="stat-word">${escText(w.word)} <small>${w.wpm}</small></span>`).join('');
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

/* ── 7. leaderboard ──────────────────────────────────────────────── */

/* Everything the server needs to check the run for itself: the words,
   the keystroke log, and the numbers we came up with. */
function evidence(result, secs) {
  const total = config.mode === 'words' ? config.wordCount : 0;
  return {
    v: 1,
    board: Leaderboard.boardFor(config),
    name: Leaderboard.cleanName(config.name),
    device: Leaderboard.device(),
    mode: config.mode, time: config.time, wordCount: config.wordCount,
    list: config.wordList, punctuation: config.punctuation, numbers: config.numbers,
    stopOnError: config.stopOnError,
    words: state.words.slice(0, Math.max(state.wordIndex + 1, total)),
    log: state.log,
    seconds: secs,
    claimed: { wpm: result.wpm, raw: result.raw, acc: result.acc, consistency: result.consistency, chars: result.chars },
    date: result.date
  };
}

const lbBox = $('#lb-box');
const setLbStatus = (html, cls) => { const el = $('#lb-status'); el.innerHTML = html; el.className = 'lb-status ' + (cls || ''); };

function offerLeaderboard(result, secs) {
  lbBox.hidden = true;
  $('#lb-form').hidden = true;
  setLbStatus('');
  const board = Leaderboard.boardFor(config);
  if (!Leaderboard.enabled || !board || config.leaderboard === 'off') return;
  if (result.acc < Leaderboard.MIN_ACC) {
    lbBox.hidden = false;
    setLbStatus(`🏆 <b>${Leaderboard.label(board)}</b> leaderboard needs ${Leaderboard.MIN_ACC}% accuracy — this run had ${result.acc}%`, 'dim');
    return;
  }
  const payload = evidence(result, secs);
  lbBox.hidden = false;
  if (config.leaderboard === 'on' && payload.name) { submitRun(payload); return; }
  $('#lb-form').hidden = false;
  $('#lb-name').value = config.name || '';
  setLbStatus(`🏆 this run qualifies for the <b>${Leaderboard.label(board)}</b> leaderboard`);
  $('#lb-submit').onclick = () => {
    const name = Leaderboard.cleanName($('#lb-name').value);
    if (!name) { $('#lb-name').focus(); return; }
    config.name = name; config.leaderboard = 'on'; saveConfig();
    payload.name = name;
    $('#lb-form').hidden = true;
    submitRun(payload, true);
  };
  $('#lb-never').onclick = () => { config.leaderboard = 'off'; saveConfig(); lbBox.hidden = true; inputEl.focus({ preventScroll: true }); };
}

async function submitRun(payload, first) {
  setLbStatus('submitting to the leaderboard…', 'dim');
  try {
    const r = await Leaderboard.submit(payload);
    const board = Leaderboard.label(payload.board);
    const pos = [];
    if (r.rankDay)  pos.push(`<b>#${r.rankDay}</b> today`);
    if (r.rankAll)  pos.push(`<b>#${r.rankAll}</b> all time`);
    const note = r.best === false ? ' · not your best on this board, so the board keeps your better run' : '';
    setLbStatus(`🏆 ${board}: ${pos.join(' · ')}${note}` +
      (first ? '<br><small>future runs are submitted automatically — change that in settings</small>' : ''));
    lbBox.onclick = null;
  } catch (e) {
    setLbStatus(e.refused ? `the leaderboard did not accept this run: ${escText(e.message)}`
                          : `could not reach the leaderboard: ${escText(e.message)}`, 'err');
  }
}

/* the drawer */
let lbBoard = 'time-30', lbPeriod = 'all';

function pickBoard() {
  const b = Leaderboard.boardFor(config);
  if (b) lbBoard = b;
}

function renderLeaderboard() {
  chips('#lb-boards', Leaderboard.BOARDS, lbBoard, v => { lbBoard = v; }, Leaderboard.label, { rerender: renderLeaderboard, silent: true });
  chips('#lb-periods', ['day', 'all'], lbPeriod, v => { lbPeriod = v; }, v => v === 'day' ? 'last 24 hours' : 'all time', { rerender: renderLeaderboard, silent: true });
  const nameEl = $('#lb-drawer-name');
  nameEl.value = config.name || '';
  const body = $('#lb-body'), note = $('#lb-note');

  if (!Leaderboard.enabled) {
    const rows = Leaderboard.localBoard(history, lbBoard);
    note.innerHTML = 'no global leaderboard is configured for this copy of the site, so this is <b>your best runs on this device</b>. ' +
      'to rank against other people, deploy the free worker in <code>worker/</code> and put its URL in <code>js/config.js</code>.';
    body.innerHTML = rows.length ? rows.map((r, i) => lbRow(i + 1, config.name || 'you', r, false)).join('')
      : `<tr><td colspan="7" class="dim">no ${Leaderboard.label(lbBoard)} runs here yet</td></tr>`;
    return;
  }

  note.textContent = '';
  body.innerHTML = '<tr><td colspan="7" class="dim">loading…</td></tr>';
  const want = lbBoard + lbPeriod;
  Leaderboard.fetchBoard(lbBoard, lbPeriod).then(data => {
    if (lbBoard + lbPeriod !== want) return;               // the user has moved on
    body.innerHTML = data.entries.length
      ? data.entries.map(e => lbRow(e.rank, e.name, e, !!e.you)).join('')
      : `<tr><td colspan="7" class="dim">nobody has posted a ${Leaderboard.label(lbBoard)} run ${lbPeriod === 'day' ? 'in the last 24 hours' : 'yet'} — be the first</td></tr>`;
    if (data.you && !data.entries.some(e => e.you))
      body.innerHTML += `<tr class="you-row"><td colspan="7" class="dim">you are #${data.you.rank} of ${data.total} with ${data.you.wpm} wpm</td></tr>`;
    note.textContent = data.total ? `${data.total} ${data.total === 1 ? 'person' : 'people'} on this board` : '';
  }).catch(e => {
    body.innerHTML = `<tr><td colspan="7" class="err">could not load the leaderboard: ${escText(e.message)}</td></tr>`;
  });
}

function lbRow(rank, name, r, you) {
  const when = r.ts || r.date;
  return `<tr class="${you ? 'you-row' : ''}"><td class="rank">${rank}</td><td>${escText(name || 'anonymous')}${you ? ' <small>(you)</small>' : ''}</td>` +
    `<td class="num">${Math.round(r.wpm)}</td><td class="num dim">${r.acc}%</td><td class="num dim">${Math.round(r.raw)}</td>` +
    `<td class="num dim">${r.consistency}%</td><td class="dim">${when ? ago(when) : ''}</td></tr>`;
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

$('#lb-drawer-name').addEventListener('change', e => {
  config.name = Leaderboard.cleanName(e.target.value); e.target.value = config.name; saveConfig();
});
$('#lb-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#lb-submit').click(); } });

/* ── 8. ui ───────────────────────────────────────────────────────── */

const AMOUNTS = {
  time:  [15, 30, 60, 120],
  words: [10, 25, 50, 100],
  quote: ['short', 'medium', 'long'],
  story: ['short', 'medium', 'long', 'full']
};
const LISTS = Object.keys(WORDS.lists);

function renderConfigBar() {
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === config.mode));
  /* punctuation and numbers only mean something for generated words */
  const generated = isGenerated();
  $$('[data-toggle]').forEach(b => {
    const t = b.dataset.toggle;
    b.hidden = t !== 'tape' && !generated;   // tape is a layout, it applies everywhere
    b.classList.toggle('active', !!config[t]);
  });
  const listBtn = $('#wordlist-btn');
  listBtn.hidden = !generated;
  listBtn.textContent = config.wordList;
  listBtn.classList.toggle('active', config.wordList !== 'english');
  $('#list-sep').style.display = generated ? '' : 'none';

  const box = $('#amounts');
  const src = $('#source');
  /* A story is worth naming while you type it; a quote's source is a small
     reveal, so that one waits for the results screen. */
  if (config.mode === 'story' && state.quote) {
    src.hidden = false;
    src.innerHTML = `<b>${escText(state.quote.title)}</b><br>${
      state.quote.author ? escText(state.quote.author) : 'written for this test'}${
      state.quote.note === 'retold' ? ', retold' : ''}`;
  } else src.hidden = true;

  const list = AMOUNTS[config.mode];
  $('#amount-sep').style.display = list ? '' : 'none';
  box.innerHTML = '';
  if (!list) return;
  const current = config.mode === 'time' ? config.time
                : config.mode === 'words' ? config.wordCount
                : config.mode === 'story' ? config.storyLength : config.quoteLength;
  list.forEach(v => {
    const b = document.createElement('button');
    b.className = 'cfg' + (v === current ? ' active' : '');
    b.textContent = v;
    b.onclick = () => {
      if (config.mode === 'time') config.time = v;
      else if (config.mode === 'words') config.wordCount = v;
      else if (config.mode === 'story') config.storyLength = v;
      else config.quoteLength = v;
      saveConfig(); renderConfigBar(); restart();
    };
    box.appendChild(b);
  });
}

function setMode(m) { config.mode = m; saveConfig(); applyConfig(); renderConfigBar(); restart(); }
function setList(l) { if (!WORDS.lists[l]) return; config.wordList = l; saveConfig(); renderConfigBar(); restart(); }

function restart() {
  clearTimeout(state.timerId);
  cancelAnimationFrame(state.rafId);
  Object.assign(state, {
    typed: [], wordIndex: 0, started: false, finished: false,
    startTime: 0, endTime: 0, keys: { correct: 0, incorrect: 0, extra: 0, missed: 0 },
    perSecond: [], lastSampleChars: 0, lastSampleErrors: 0, secondsElapsed: 0,
    shift: { x: 0, y: 0 }, domOffset: 0, log: [], result: null, elapsed: 0
  });
  seed();
  renderAll();
  renderConfigBar();               // the source line names the new passage
  resultsEl.hidden = true;
  lbBox.hidden = true;
  testEl.hidden = false;
  $('#config').style.display = '';
  document.body.classList.remove('typing');
  liveWpmEl.hidden = true;
  paceEl.hidden = true;
  counterEl.textContent = config.mode === 'time' ? config.time : progressLabel();
  inputEl.value = '';
  inputEl.focus({ preventScroll: true });
}

function repeat() {                                   // same text, fresh run
  const words = state.words.slice(), quote = state.quote;
  restart();
  state.words = words; state.quote = quote;
  renderAll();
  renderConfigBar();               // restart() named the passage it just discarded
  counterEl.textContent = config.mode === 'time' ? config.time : progressLabel();
}

const FONTS = ['JetBrains Mono', 'Roboto Mono', 'IBM Plex Mono', 'Source Code Pro', 'system mono'];

function applyConfig() {
  $('#zen-hint').hidden = !isEndless();
  windowEl.classList.toggle('tape', config.tape);
  const root = document.documentElement.style;
  root.setProperty('--mono', config.font === 'system mono' ? 'ui-monospace' : `"${config.font}"`);
  root.setProperty('--font-weight', config.fontWeight);
  document.documentElement.dataset.theme = config.theme;
  document.documentElement.dataset.caret = config.caret;
  document.documentElement.style.setProperty('--font-size', config.fontSize + 'rem');
  wordsEl.classList.toggle('blind', config.blind);
  Sound.pack = config.sound;
  Sound.volume = config.volume / 100;
  Sound.errorSound = config.errorSound;
  $('#theme-name').textContent = config.theme.replace(/-/g, ' ');
  $('#sound-name').textContent = config.sound;
  liveWpmEl.hidden = !config.liveWpm || !state.started;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = css('--bg');
  /* a theme change while the results are up must recolour the charts */
  if (!resultsEl.hidden) drawChart();
  if (!$('#stats').hidden) drawHistoryChart();
}

/* settings drawer -------------------------------------------------- */
const THEMES = ['serika-dark','dracula','nord','catppuccin','gruvbox','tokyo-night','matrix','rose-pine',
                'monokai','one-dark','everforest','midnight','coffee','paper','solarized-light','lavender'];

/* A row of chips. Picking one saves, applies, and redraws — unless the
   caller asks for `silent`, for chips that are not settings at all. */
function chips(container, values, current, onPick, labels, opts = {}) {
  const el = $(container);
  el.innerHTML = '';
  values.forEach(v => {
    const b = document.createElement('button');
    b.className = 'chip' + (v === current ? ' active' : '');
    b.textContent = labels ? labels(v) : String(v).replace(/-/g, ' ');
    b.onclick = () => {
      onPick(v);
      if (opts.silent) { (opts.rerender || (() => {}))(); return; }
      saveConfig(); applyConfig(); renderSettings(); renderAll();
    };
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
  chips('#set-pace', ['off', 'pb', 'last', 'custom'], config.pace, v => config.pace = v,
        v => v === 'pb' ? 'personal best' : v === 'last' ? 'last run' : v);
  $('#set-pacewpm').value = config.paceWpm;
  chips('#set-stoponerror', ['off', 'letter', 'word'], config.stopOnError, v => config.stopOnError = v);
  chips('#set-blind', [true, false], config.blind, v => config.blind = v, v => v ? 'on' : 'off');
  chips('#set-livewpm', [true, false], config.liveWpm, v => config.liveWpm = v, v => v ? 'on' : 'off');
  chips('#set-tape', [false, true], config.tape, v => { config.tape = v; }, v => v ? 'single line' : 'paragraph');
  chips('#set-list', LISTS, config.wordList, v => { config.wordList = v; renderConfigBar(); restart(); }, v => v);
  chips('#set-font', FONTS, config.font, v => config.font = v, v => v);
  chips('#set-weight', [400, 500, 700], config.fontWeight, v => config.fontWeight = v,
        v => v === 400 ? 'regular' : v === 500 ? 'medium' : 'bold');
  chips('#set-fontsize', [1.2, 1.6, 2, 2.4], config.fontSize, v => config.fontSize = v, v => v + 'x');
  chips('#set-leaderboard', ['ask', 'on', 'off'], config.leaderboard, v => config.leaderboard = v,
        v => v === 'ask' ? 'ask each time' : v === 'on' ? 'always' : 'never');
  $('#set-name').value = config.name || '';
  $('#set-leaderboard-note').textContent = Leaderboard.enabled
    ? 'runs that qualify (english list, no punctuation or numbers, at least ' + Leaderboard.MIN_ACC + '% accuracy) can be posted to the global board.'
    : 'no global leaderboard is configured for this copy of the site; nothing is sent anywhere.';
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
$('#set-pacewpm').addEventListener('change', e => {
  config.paceWpm = Math.max(10, Math.min(400, Math.round(+e.target.value) || 60));
  e.target.value = config.paceWpm;
  if (config.pace !== 'custom') { config.pace = 'custom'; renderSettings(); }
  saveConfig();
});
$('#set-name').addEventListener('change', e => {
  config.name = Leaderboard.cleanName(e.target.value); e.target.value = config.name; saveConfig();
});
$('#set-reset').addEventListener('click', () => {
  if (!confirm('Clear all results, personal bests and per-key history?')) return;
  store.clear(); history = []; pb = {}; keyStats = {};
  Object.assign(config, DEFAULTS); saveConfig(); applyConfig(); renderConfigBar(); renderSettings(); restart();
});

/* Your data is yours: a JSON file out, the same file back in. */
$('#set-export').addEventListener('click', () => {
  const data = { app: 'type', version: 1, exported: new Date().toISOString(), config, history, pb, keys: keyStats };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `type-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#set-import').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'type' || !Array.isArray(data.history)) throw new Error('not a type export');
    if (!confirm(`Import ${data.history.length} results and replace what is on this device?`)) return;
    history = data.history.filter(r => r && typeof r.wpm === 'number').slice(0, 100);
    pb = (data.pb && typeof data.pb === 'object') ? data.pb : {};
    keyStats = (data.keys && typeof data.keys === 'object') ? data.keys : {};
    if (data.config && typeof data.config === 'object') Object.assign(config, DEFAULTS, data.config);
    if (!WORDS.lists[config.wordList]) config.wordList = 'english';
    store.set('history', history); store.set('pb', pb); store.set('keys', keyStats); saveConfig();
    applyConfig(); renderConfigBar(); renderSettings(); restart();
    alert('imported.');
  } catch (err) { alert('could not import: ' + err.message); }
});

/* stats drawer ----------------------------------------------------- */
function renderStats() {
  const order = ['time-15','time-30','time-60','time-120','words-10','words-25','words-50','words-100'];
  const keys = order.filter(k => pb[k]).concat(Object.keys(pb).filter(k => !order.includes(k)));
  $('#pb-grid').innerHTML = keys.length ? keys.map(k => `
    <div class="pb-card">
      <div class="pb-mode">${escText(keyLabel(k))}</div>
      <div class="pb-wpm">${pb[k].wpm}</div>
      <div class="pb-acc">${pb[k].acc}% acc</div>
    </div>`).join('')
    : '<p style="color:var(--sub);font-size:.9rem">no personal bests yet — finish a test.</p>';

  $('#history-body').innerHTML = history.slice(0, 50).map(r => `
    <tr><td>${r.wpm}</td><td class="dim">${r.raw}</td><td>${r.acc}%</td>
        <td class="dim">${r.consistency}%</td><td class="dim">${escText(keyLabel(r.key || r.mode))}</td>
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
    { name: 'open leaderboard', run: () => openDrawer('leaderboard') },
    { name: 'toggle punctuation', run: () => { config.punctuation = !config.punctuation; saveConfig(); renderConfigBar(); restart(); } },
    { name: 'toggle numbers', run: () => { config.numbers = !config.numbers; saveConfig(); renderConfigBar(); restart(); } },
    { name: 'toggle blind mode', run: () => { config.blind = !config.blind; saveConfig(); applyConfig(); } },
    { name: 'export your data', run: () => $('#set-export').click() }
  ];
  ['time','words','quote','story','infinite','zen','adaptive'].forEach(m =>
    c.push({ name: `mode ${m}`, hint: 'mode', run: () => setMode(m) }));
  AMOUNTS.story.forEach(v => c.push({ name: `story ${v}`, hint: 'story',
    run: () => { config.mode='story'; config.storyLength=v; saveConfig(); applyConfig(); restart(); } }));
  AMOUNTS.time.forEach(v => c.push({ name: `time ${v}`, hint: 'time', run: () => { config.mode='time'; config.time=v; saveConfig(); applyConfig(); restart(); } }));
  AMOUNTS.words.forEach(v => c.push({ name: `words ${v}`, hint: 'words', run: () => { config.mode='words'; config.wordCount=v; saveConfig(); applyConfig(); restart(); } }));
  LISTS.forEach(l => c.push({ name: `word list ${l}`, hint: 'words', run: () => setList(l) }));
  THEMES.forEach(t => c.push({ name: `theme ${t.replace(/-/g,' ')}`, hint: 'theme', run: () => { config.theme=t; saveConfig(); applyConfig(); } }));
  Sound.packs.forEach(s => c.push({ name: `sound ${s}`, hint: 'sound', run: () => { config.sound=s; saveConfig(); applyConfig(); Sound.play('letter'); } }));
  ['same','deeper','off'].forEach(v => c.push({ name: `space bar sound ${v}`, hint: 'sound', run: () => { config.spaceSound=v; saveConfig(); } }));
  ['off','pb','last','custom'].forEach(v => c.push({ name: `pace caret ${v === 'pb' ? 'personal best' : v === 'last' ? 'last run' : v}`, hint: 'pace',
    run: () => { config.pace = v; saveConfig(); } }));
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
    .map((c, i) => `<li class="${i === 0 ? 'sel' : ''}" data-i="${i}">${escText(c.name)}<span class="p-hint">${c.hint || ''}</span></li>`)
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
  closeDrawers(false);
  $('#' + id).hidden = false;
  if (id === 'settings') renderSettings();
  if (id === 'stats') renderStats();
  if (id === 'leaderboard') { pickBoard(); renderLeaderboard(); }
  $('#' + id).scrollTop = 0;
}
function closeDrawers(refocus = true) {
  ['settings', 'stats', 'leaderboard'].forEach(id => $('#' + id).hidden = true);
  if (refocus) inputEl.focus({ preventScroll: true });
}
$$('[data-close]').forEach(b => b.onclick = () => closeDrawers());
$$('.drawer').forEach(d => d.addEventListener('mousedown', e => { if (e.target === d) closeDrawers(); }));

/* wiring ----------------------------------------------------------- */
$$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$$('[data-toggle]').forEach(b => b.onclick = () => {
  config[b.dataset.toggle] = !config[b.dataset.toggle];
  saveConfig(); applyConfig(); renderConfigBar(); restart();
});
$('#wordlist-btn').onclick = () => setList(LISTS[(LISTS.indexOf(config.wordList) + 1) % LISTS.length]);
$('#restart').onclick = restart;
$('#next-test').onclick = restart;
$('#repeat-test').onclick = repeat;
$('#logo').onclick = e => { e.preventDefault(); restart(); };
$('#share-result').onclick = async () => {
  const r = state.result || history[0]; if (!r) return;
  const text = `${r.wpm} wpm · ${r.acc}% acc · ${keyLabel(r.key || r.mode)} · consistency ${r.consistency}% — type`;
  try { await navigator.clipboard.writeText(text); $('#share-result').textContent = '✓'; }
  catch { $('#share-result').textContent = '✕'; }
  setTimeout(() => $('#share-result').textContent = '⧉', 1200);
};
$$('[data-action]').forEach(b => b.onclick = () => {
  const a = b.dataset.action;
  if (a === 'palette') openPalette();
  if (a === 'settings') openDrawer('settings');
  if (a === 'stats') openDrawer('stats');
  if (a === 'leaderboard') openDrawer('leaderboard');
  if (a === 'theme') { const i = THEMES.indexOf(config.theme); config.theme = THEMES[(i + 1) % THEMES.length]; saveConfig(); applyConfig(); }
  if (a === 'sound') { const i = Sound.packs.indexOf(config.sound); config.sound = Sound.packs[(i + 1) % Sound.packs.length]; saveConfig(); applyConfig(); Sound.play('letter'); }
  /* a button that keeps focus would take the next enter as a click */
  if (a === 'theme' || a === 'sound') { b.blur(); inputEl.focus({ preventScroll: true }); }
});

areaEl.addEventListener('mousedown', () => setTimeout(() => inputEl.focus({ preventScroll: true }), 0));

/* Keystrokes are read from `document`, so the test is live whether or not the
   hidden input holds focus. The overlay therefore means one thing only: this
   window is not the one receiving keys. */
const setFocused = on => {
  areaEl.classList.toggle('unfocused', !on);
  if (on && !drawerOpen() && $('#palette').hidden && !isEditable(document.activeElement)) inputEl.focus({ preventScroll: true });
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

const relayout = () => { measureLines(); scrollView(); updateCaret(); snapMotion(); };
window.addEventListener('resize', () => { relayout(); if (!resultsEl.hidden) drawChart(); });
/* The web fonts arrive after the first paint and rewrap every line. The
   measured line tops and the caret have to follow, or the caret sits on
   the fallback font's letter until the next keystroke. */
if (document.fonts) {
  document.fonts.ready.then(relayout);
  document.fonts.addEventListener('loadingdone', relayout);
}

/* Offline: a service worker keeps a copy of the site, so it opens with no
   network and can be installed like an app. Not from file://, and never
   from the single-file build in dist/. */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/\/dist\//.test(location.pathname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

/* A read-only window into the engine, for the test harness. */
window.__type = { get state() { return state; }, get config() { return config; },
                  get history() { return history; }, get pb() { return pb; },
                  get motion() { return { view, caret, target, shift: state.shift }; },
                  evidence: () => state.result ? evidence(state.result, state.elapsed) : null,
                  finish, restart, openDrawer };

/* go --------------------------------------------------------------- */
applyConfig();
renderConfigBar();
restart();
setFocused(document.hasFocus());
})();
