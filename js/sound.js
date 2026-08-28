/* ─────────────────────────────────────────────────────────────────
   sound.js — keyboard sounds, synthesised in the browser.

   No sample files. Every press is built from three layers, which is
   roughly what a real switch gives you:

     tick    the plastic contact — a few ms of filtered noise
     body    the stem and housing — a short pitched tone that falls
     thump   the bottom-out — a low sine that decays fast

   A switch is therefore data, not code: the table below is the whole
   difference between a clicky blue and a rubber dome. Everything runs
   through a compressor, so fast typing stacks without turning to mush,
   and each press is jittered a few percent in pitch and level so a
   burst does not sound like one sample machine-gunning.
   ───────────────────────────────────────────────────────────────── */
window.Sound = (() => {
  let ctx = null, master = null, comp = null, noiseBuf = null;
  let pack = 'click', volume = 0.35, errorSound = true;

  /* tick  : filtered noise      [freq, Q, gain, seconds, filter]
     body  : pitched tone        [freq, glideTo, gain, seconds, wave]
     thump : bottom-out sine     [freq, gain, seconds]
     clack : optional 2nd tick, for keyboards with a metallic ring
     space : how the space bar differs — pitch multiplier, gain multiplier */
  const SWITCHES = {
    click:      { tick: [2600, 1.2, .40, .020, 'bandpass'], body: [1750, 900, .13, .014, 'triangle'], thump: [168, .20, .042], space: [.72, 1.15] },
    tactile:    { tick: [1750, 1.0, .34, .026, 'bandpass'], body: [1150, 620, .10, .018, 'triangle'], thump: [150, .24, .050], space: [.76, 1.12] },
    linear:     { tick: [1250,  .8, .22, .022, 'lowpass'],  body: [ 820, 500, .06, .016, 'sine'],     thump: [132, .30, .055], space: [.78, 1.10] },
    thock:      { tick: [ 780,  .7, .48, .042, 'lowpass'],  body: [ 380, 260, .07, .030, 'triangle'], thump: [102, .38, .075], space: [.74, 1.14] },
    cream:      { tick: [1050,  .9, .34, .030, 'lowpass'],  body: [ 560, 330, .09, .026, 'sine'],     thump: [124, .32, .066], space: [.76, 1.12] },
    topre:      { tick: [ 900, 1.4, .34, .034, 'bandpass'], body: [ 430, 250, .15, .034, 'sine'],     thump: [158, .30, .058], space: [.80, 1.10] },
    alps:       { tick: [3100, 1.6, .34, .014, 'bandpass'], body: [2050, 900, .10, .012, 'square'],   thump: [186, .22, .040],
                  clack: [1450, 3.0, .18, .022], space: [.78, 1.12] },
    wood:       { tick: [ 820, 2.2, .34, .026, 'bandpass'], body: [ 620, 300, .12, .022, 'triangle'], thump: [210, .26, .048], space: [.76, 1.12] },
    typewriter: { tick: [4200, 1.6, .34, .013, 'bandpass'], body: [1500, 500, .14, .018, 'square'],   thump: [192, .28, .050],
                  clack: [2400, 2.4, .14, .020], bell: true, space: [.84, 1.08] },
    laptop:     { tick: [3000, 1.1, .40, .013, 'bandpass'], body: [1900, 1100, .12, .011, 'triangle'],thump: [240, .22, .030], space: [.82, 1.10] },
    marble:     { tick: [5200, 2.2, .30, .011, 'bandpass'], body: [2600, 1800, .16, .050, 'sine'],    thump: [420, .18, .040], space: [.80, 1.10] },
    pop:        { body: [ 760, 265, .34, .055, 'sine'],     tick: [3000, 2.0, .09, .008, 'bandpass'], space: [.70, 1.12] },
    beep:       { body: [ 900, 880, .22, .034, 'triangle'], tick: [2400, 2.0, .09, .007, 'bandpass'], space: [.70, 1.10] }
  };

  const PACKS = ['off', ...Object.keys(SWITCHES)];

  /* tanh saturation: transparent until things get loud, then it rounds the
     peaks off instead of letting them clip. */
  function softClip() {
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    return curve;
  }

  function makeNoise() {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      /* Ask for the smallest buffer the device will give us: on a busy
         Linux audio stack the default can be tens of milliseconds, and a
         keyboard sound that arrives late is worse than no sound at all. */
      try { ctx = new AC({ latencyHint: 0.01 }); } catch { ctx = new AC(); }
      master = ctx.createGain();
      master.gain.value = volume;
      /* A compressor was the wrong tool here. Its gain reduction is
         time-varying, so a fast run made it duck and pump — the switch
         audibly changed character mid-burst. A fixed soft-clip curve does
         the same job of keeping overlapping presses out of the ceiling,
         but its shape never changes, so the switch always sounds the same
         however fast you type. */
      comp = ctx.createWaveShaper();
      comp.curve = softClip();
      comp.oversample = '2x';
      master.connect(comp).connect(ctx.destination);
      noiseBuf = makeNoise();
    } catch { ctx = null; }
    return ctx;
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  const rand = (a, b) => a + Math.random() * (b - a);

  /* Schedule a few milliseconds ahead, never at `currentTime`. A press is a
     10-20ms envelope; if the main thread is busy — and on a keystroke it
     always is, updating the word, measuring layout, moving the caret — the
     audio thread can reach that block after the envelope's own start time has
     passed, and render the tail of a sound that never began. That is a press
     you hear nothing for. Seven milliseconds is more than one render quantum
     and far below the ~20ms where a delay becomes audible. */
  const LOOKAHEAD = 0.007;

  /* Two presses scheduled at the same instant do not sound like two presses.
     They sum into a single louder click, so a fast roll — or any keys the
     browser hands over in one batch after a busy frame — loses every press
     but the first. Holding them a few milliseconds apart is what makes them
     audible as separate keys. The queue is capped so it can never run ahead
     of your fingers. */
  const MIN_GAP = 0.011, MAX_AHEAD = 0.06;
  let lastT = 0;

  function when() {
    const now = ctx.currentTime;
    const t = Math.min(Math.max(now + LOOKAHEAD, lastT + MIN_GAP), now + MAX_AHEAD);
    lastT = t;
    return t;
  }

  function noise(t, freq, q, gain, dur, type) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = rand(0.9, 1.1);
    const flt = ctx.createBiquadFilter();
    flt.type = type; flt.frequency.value = freq; flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(master);
    src.start(t, rand(0, 0.5), dur + 0.02);
    src.stop(t + dur + 0.02);
  }

  /* How many voices are still sounding, worked out from when they were
     scheduled to end. The old counter leaned on `onended`, which does not
     always fire — it drifted upward and left every later keystroke quieter
     than the one before it. */
  let ends = [];
  function voices(now) {
    if (ends.length > 64) ends = ends.filter(e => e > now);
    let n = 0;
    for (const e of ends) if (e > now) n++;
    return n;
  }

  function tone(t, freq, to, gain, dur, type) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (to && to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
    ends.push(t + dur);
  }

  /* A wrong key gets its own short, dull thud. It replaces the click
     rather than stacking on top of it — two voices on one keystroke was
     the muddiest thing in here. */
  function errorVoice(t, lvl) {
    noise(t, 260, 0.9, 0.24 * lvl, 0.055, 'lowpass');
    tone(t, 148, 96, 0.26 * lvl, 0.085, 'triangle');
  }

  function press(key, busy) {
    const s = SWITCHES[pack];
    if (!s) return;
    const t = when();
    const isSpace = key === 'space';
    const [pMul, gMul] = isSpace ? (s.space || [0.78, 1.1]) : [1, 1];
    const p = rand(0.965, 1.04) * pMul;      // per-press pitch jitter
    const g = rand(0.9, 1.06) * gMul;        // and level jitter

    /* Past a dozen overlapping voices nothing more is audible, so drop the
       long tails rather than quietening the attack — the click you just made
       stays exactly as loud as the one before it. */
    if (s.tick)  noise(t, s.tick[0] * p, s.tick[1], s.tick[2] * g, s.tick[3], s.tick[4]);
    if (s.clack && !busy) noise(t + 0.004, s.clack[0] * p, s.clack[1], s.clack[2] * g, s.clack[3], 'bandpass');
    if (s.body)  tone(t, s.body[0] * p, s.body[1] * p, s.body[2] * g, s.body[3], s.body[4]);
    if (s.thump && !busy) tone(t + 0.003, s.thump[0] * p, null, s.thump[1] * g, s.thump[2], 'sine');
    if (s.bell && isSpace) {                 // the carriage bell, typewriter only
      tone(t + 0.012, 2100, null, 0.11 * g, 0.5);
      tone(t + 0.012, 3150, null, 0.04 * g, 0.35);
    }
    if (key === 'back') noise(t + 0.002, 1100 * p, 2.2, 0.14 * g, 0.018, 'bandpass');
  }

  /* key: 'letter' | 'space' | 'back' | 'error' */
  function play(key = 'letter') {
    try {
      if (key === 'error' ? (!errorSound || pack === 'off') : pack === 'off') return;
      if (!init()) return;
      resume();
      if (key === 'error') errorVoice(when(), 1);
      else press(key, voices(ctx.currentTime) > 12);
    } catch { /* never let audio break typing */ }
  }

  return {
    packs: PACKS,
    play,
    unlock() { init(); resume(); },
    get pack() { return pack; },
    set pack(v) { pack = PACKS.includes(v) ? v : 'click'; },
    get volume() { return volume; },
    set volume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.value = volume; },
    get errorSound() { return errorSound; },
    set errorSound(v) { errorSound = !!v; },
    preview(name) { const old = pack; pack = name; play('letter'); pack = old; },
    get context() { return ctx; },
    get output() { return master; },
    get latency() {
      if (!ctx) return null;
      return { base: ctx.baseLatency || 0, output: ctx.outputLatency || 0,
               total: Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) };
    }
  };
})();
