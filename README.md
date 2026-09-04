# type

A typing test. Monkeytype's shape — the modes, the caret, the results chart,
the command palette — with Keybr's adaptive drilling, a synthesised
mechanical keyboard, a leaderboard, and nothing else: no ads, no trackers,
no account, no cookie banner.

No build step, no dependencies. A handful of files of JavaScript and one
stylesheet. Everything you do stays in your browser unless you press
*submit* on the leaderboard.

## Run it

```sh
cd ~/Projects/type
python3 -m http.server 8777
# then open http://localhost:8777
```

Or open `dist/type.html` directly — `./build.sh` inlines the whole site into
that one self-contained file and restarts the server on port 8777, so what is
being served is always what was just built. `./build.sh --no-serve` skips the
restart.

Served over https (or from localhost) the site installs as an app and works
offline: a service worker keeps a copy of the shell and the fonts, network
first, cache when there is none.

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
four-digit numbers into the generated modes. The generated modes draw from a
**word list**: the english 400 (the default), the english 1k, or a set of
code keywords and symbols. The list is the last button in the config bar.

## Keys

    tab              restart
    esc              command palette — every mode, theme, list and sound
    ctrl+backspace   delete the current word
    backspace        go back, including into a previous word you got wrong
    shift+enter      finish a zen / infinite / adaptive run

On a phone the on-screen keyboard works too, including backspace and the
keyboards that compose whole words before committing them.

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
second that contained an error — the same reading Monkeytype gives you. Under
it: the words you mistyped, and the words that took you longest, each with
the speed you managed on it.

The clock is the wall clock. Ticks are scheduled against the time of the first
keystroke rather than counted, so a 60-second test is 60 seconds even when the
browser is busy or the tab is throttled.

## Leaderboard

Eight boards — time 15 / 30 / 60 / 120 and words 10 / 25 / 50 / 100 — on the
plain english list with no punctuation or numbers, so it is the same test for
everyone. Each has an all-time view (one entry per browser, your best) and a
last-24-hours view. Open it from the 🏆 in the header.

Nothing is sent until you press **submit** on a results screen. What goes:
the name you type, a random id for this browser, the numbers on the screen,
and the keystroke log of that run. The server **replays the log** with the
same code the page uses (`js/replay.js`) and ranks what the replay says, not
what the page claimed; it also refuses anything a hand cannot do (fifty keys
a second, keystrokes at a fixed interval, a log squeezed in time). It needs
80% accuracy. After the first submission the page submits qualifying runs on
its own; *settings → leaderboard* turns that off, or back to asking.

The board is a tiny [Cloudflare Worker](worker/) on the free tier. Deploy it
in ten minutes with `worker/README.md`, put its URL in `js/config.js`, and
this copy of the site has a global leaderboard. Without one, the drawer shows
the best runs on your own device and nothing is ever sent anywhere.

## Pace caret

A second, dimmer caret that moves through the text at a fixed speed: your
personal best for this exact test, your last run, or a number you pick. It is
positioned from the clock every frame, so it never stutters and never has to
catch up. *settings → pace caret*.

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

The scrolling text and the window it scrolls through are two elements, and
they have to be: a transform moves an element's clip box along with its
content, so scrolling the words by transforming the box that also clips them
drags the visible window upward over the wpm row.

Motion is one animation frame driving both the text and the caret, with the
caret's position stored in the text's own coordinates so the two cannot come
apart. It is exponential smoothing with an 18ms half-life rather than a CSS
transition with a fixed duration: it converges from wherever it is, never
restarts mid-flight, and behaves the same on a 60Hz and a 144Hz screen. At
200 wpm the caret sits under 5px from its target on average and lands exactly
on it at rest. Offsets are rounded to whole pixels — a caret on a half pixel
is a two-pixel grey smear instead of a sharp bar.

## Type

Five faces (JetBrains Mono, Roboto Mono, IBM Plex Mono, Source Code Pro, or
your system mono), three weights and four sizes. The default is medium rather
than regular: light text on a dark ground blooms slightly, so heavier stems
read sharper. When the web fonts arrive after the first paint, the lines are
re-measured so the caret follows the real glyphs.

The test text is deliberately *not* promoted to its own GPU layer — that
turns off subpixel antialiasing and is what makes typing sites look soft.

Sixteen themes, four colours each, in `css/style.css`.

## Stored locally

Results, personal bests and per-key history live in `localStorage` and never
leave the machine. *Settings → your data* exports all of it as a JSON file
and imports it again on another browser. *Settings → reset* clears it.

## Hosting and a domain

The site is static files, so anything that serves files hosts it. It is on
Vercel today (`type-topaz.vercel.app`); the same repository also deploys to
GitHub Pages with `.github/workflows/pages.yml` once *Settings → Pages* is
set to "GitHub Actions".

Free names that were free at the time of writing:

- **`type.is-a.dev`** — [is-a.dev](https://github.com/is-a-dev/register)
  gives developers a free subdomain by pull request; it points at Vercel or
  GitHub Pages with a CNAME. `typing`, `typetest`, `wpm` and `keys` were
  free there too.
- **`type.js.org`** — [js.org](https://js.org) does the same for JavaScript
  projects on GitHub Pages, but its rules ask for sites *directly related to
  the JavaScript ecosystem* (tools, packages), so an app that merely happens
  to be written in JS may be turned down.
- **a subdomain of a domain you already own** (`type.envisionanalytics.net`)
  — one CNAME record, no application, no cost.
- `niraj-envision.github.io/type` — GitHub Pages' own address, nothing to
  set up beyond enabling Pages.

A paid `.com` / `.dev` / `.app` costs about ten dollars a year; check the
name at a registrar before getting attached to it.

## Files

    index.html          markup
    css/style.css       sixteen themes, four colour variables each
    js/config.js        deployment settings: the leaderboard URL
    js/words.js         word lists and quotes (also loaded by the worker)
    js/stories.js       prose passages for story mode
    js/replay.js        replays a keystroke log and scores it (page + worker)
    js/sound.js         the synthesiser
    js/leaderboard.js   the leaderboard API client
    js/app.js           the engine: generation, input, timing, stats, charts, ui
    sw.js               the service worker: offline, installable
    manifest.webmanifest, icons/
    worker/             the leaderboard API: a Cloudflare Worker over D1
    build.sh            inlines the above into dist/type.html, restarts the server
