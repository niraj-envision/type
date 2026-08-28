# type

A typing test. Monkeytype's shape — the modes, the caret, the results chart,
the command palette — with Keybr's adaptive drilling and a synthesised
mechanical keyboard on top.

No build step, no dependencies, no network calls. Three files of JavaScript
and one stylesheet.

## Run it

```sh
cd ~/Projects/type
python3 -m http.server 8777
# then open http://localhost:8777
```

Or open `dist/type.html` directly — `./build.sh` inlines the whole site into
that one self-contained file.

## Modes

| | |
|---|---|
| **time** | 15 / 30 / 60 / 120 seconds |
| **words** | 10 / 25 / 50 / 100 words |
| **quote** | short / medium / long, credited on the results screen |
| **story** | real prose: fables, openings of public-domain books, short essays |
| **infinite** | endless words, no clock — stop with `shift+enter` |
| **zen** | no target text at all; whatever you type is the text |
| **adaptive** | words weighted toward the keys you actually get wrong |

The last three have no finish line of their own: they run until you end them
with `shift+enter`, and the counter counts up (elapsed time · words) instead
of down.

`punctuation` and `numbers` mix commas, capitals, quotes, brackets and
four-digit numbers into the generated modes.

## Keys

    tab              restart
    esc              command palette — every mode, theme and sound
    ctrl+backspace   delete the current word
    backspace        go back, including into a previous word you got wrong
    shift+enter      finish a zen run

## What gets measured

**wpm** is correct characters divided by five, over elapsed minutes — the
standard word. A correct word contributes its trailing space; a word you got
wrong contributes only the letters that matched.

**raw** counts every character you typed, right or wrong. The gap between raw
and wpm is what your mistakes cost you.

**accuracy** is correct keypresses over all keypresses. It counts the key you
hit, not the state you ended in, so fixing a typo does not launder it.

**consistency** is `1 − (stddev ÷ mean)` of your per-second raw speed. 100% is
a metronome. It falls when you sprint and stall rather than holding a pace.

The chart plots running wpm against per-second raw, with a red cross on every
second that contained an error — the same reading Monkeytype gives you.

## Adaptive mode

Every keystroke updates a per-key tally of attempts and errors. Adaptive mode
samples five candidate words and keeps the one densest in your weak letters,
so `b`, `y` and `;` come round more often than chance would send them. The
results screen names your worst keys; the results drawer draws them as a
keyboard heatmap.

## Sound

Thirteen switches, all generated in the browser with the Web Audio API — no
samples to download. Each press is three layers, which is roughly what a real
switch gives you: a **tick** of filtered noise for the plastic contact, a
short pitched **body** for the stem and housing, and a low **thump** for the
bottom-out. A switch is therefore data, not code — one table row is the whole
difference between a clicky blue and a rubber dome.

    off
    click · tactile · linear        MX blue, brown, red
    thock · cream · topre           deep case, creamy linear, rubber dome
    alps · wood · marble            vintage clack, wooden, glassy
    typewriter · laptop             mechanism and bell, quiet low-travel
    pop · beep                      not keyboards at all

Pitch and level are jittered a few percent per press, so a fast burst does not
turn into one sample machine-gunning. A wrong key plays its own short thud
**instead of** the click, never stacked on top of it.

The output stage is a fixed soft-clip curve, not a compressor. A compressor's
gain reduction is time-varying, so a fast run made it duck and pump and the
switch audibly changed character mid-burst; a fixed curve keeps overlapping
presses out of the ceiling without ever changing shape. Past a dozen
overlapping voices the long tails are dropped rather than the whole press
being turned down, so the click you just made is exactly as loud as the one
before it. Measured over sixty presses at ~1000 wpm: 0.4% level drift, 1.6%
timbre drift, nothing clipped.

Settings shows the audio device's own output latency, so sound arriving late
can be told apart from a bug in here.

The space bar is its own setting — **same** as a letter click (the default),
a **deeper** switch to mark the end of a word, or **off** while the letters
keep clicking. `typewriter` rings its carriage bell only on `deeper`. A
separate low buzz fires on a wrong key and can be switched off on its own.

## Story mode

Random words measure speed; they are not worth reading. Story mode gives you
continuous prose instead — a fable retold, the opening of a public-domain
novel, or a short essay written for this project. Passages are cut to length
**at the end of a sentence**, never mid-clause, and the title and author sit
beside the test while you type and again on the results screen.

Everything in `js/stories.js` is free of copyright: excerpts are quoted as
written, fables are retold in plain modern English, essays are original. The
text is kept to typeable ASCII on purpose — straight quotes, no em dashes.
A typing test should not make you hunt for a character your keyboard does not
have.

## Layout

**paragraph** wraps the text over three lines and keeps the word you are
typing on the second one. **single line** puts the whole test on one straight
line that slides sideways, holding the current word in the middle of the
screen. It is the `⇄ single line` button in the top bar (also in Settings →
layout), and it works in every mode.

Either way only a window of words is ever in the DOM. Words that scroll out of
sight are dropped — whole lines above the view in paragraph mode, a screen's
worth off to the left in tape mode — and the scroll offset is recomputed from
what is left, so nothing on screen moves. Without that the DOM grows for the
whole test (630 words in a 60-second run at speed) and every keystroke
re-measures all of it, which is what makes long tests feel heavy.

The scroll offset is always rounded to whole pixels, and the caret is placed
from layout offsets rather than bounding rectangles, so it lands correctly
even while the view is still sliding.

## Type

Five faces (JetBrains Mono, Roboto Mono, IBM Plex Mono, Source Code Pro, or
your system mono), three weights and four sizes. The default is medium rather
than regular: light text on a dark ground blooms slightly, so heavier stems
read sharper.

The test text is deliberately *not* promoted to its own GPU layer — that
turns off subpixel antialiasing and is what makes typing sites look soft.

## Stored locally

Results, personal bests and per-key history live in `localStorage` and never
leave the machine. Settings → reset clears all of it.

## Files

    index.html      markup
    css/style.css   ten themes, four colour variables each
    js/words.js     word lists and quotes
    js/stories.js   prose passages for story mode
    js/sound.js     the synthesiser
    js/app.js       the engine: generation, input, timing, stats, charts, ui
    build.sh        inlines the above into dist/type.html
