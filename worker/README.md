# The leaderboard worker

The site is static and keeps everything in the browser. A leaderboard is
the one thing that needs a server, and this directory is that server: a
[Cloudflare Worker](https://developers.cloudflare.com/workers/) with a
[D1](https://developers.cloudflare.com/d1/) SQLite database. Both have
free tiers that a typing site will never get near (100,000 requests a day,
five million database reads).

Without it the site still works; the leaderboard drawer just shows the best
runs on that device.

## What it does

    GET  /v1/health
    GET  /v1/board?board=time-30&period=all|day&device=<id>
    POST /v1/submit

Eight boards: time 15 / 30 / 60 / 120 and words 10 / 25 / 50 / 100, on the
plain english list with no punctuation or numbers — the same test for
everyone. Each has an all-time view (one row per browser, its best run) and
a last-24-hours view.

A submission carries the words that were shown and the log of every
keystroke. The worker **replays the log** with the same `js/replay.js` the
page uses and ranks what the replay says, never what the client claimed. It
also refuses anything a hand cannot do: more than 48 keys a second, a run
full of gaps under 20 ms (a log squeezed in time), or a hundred keys landing
at the same interval (a script). Accuracy has to be at least 80%.

This is a deterrent, not a proof. A determined cheat can forge a plausible
log. For a hobby leaderboard that is the right trade: no accounts, no
captchas, nothing to sign up for, and the easy cheats do not work.

Stored per run: board, name, the numbers, a random id for the browser (so
your own runs replace each other), a timestamp, and a salted hash of the IP
address for the rate limit. Runs older than thirty days are swept; the
all-time best per browser is kept.

## Deploy it (about ten minutes)

You need a free Cloudflare account and Node.

```sh
cd worker
npm install                      # wrangler, the Cloudflare CLI
npx wrangler login               # opens a browser

npx wrangler d1 create type-leaderboard
# → prints a database_id. Paste it into wrangler.toml.

npx wrangler d1 execute type-leaderboard --remote --file=schema.sql
npx wrangler deploy
# → https://type-leaderboard.<your-subdomain>.workers.dev
```

Then put that URL in `js/config.js` of the site:

```js
window.TYPE_CONFIG = { leaderboard: 'https://type-leaderboard.<your-subdomain>.workers.dev' };
```

and redeploy the site. Open the 🏆 drawer: it should say nobody has posted
yet. Finish a time 30 and it will ask for a name.

Optional, in `wrangler.toml`:

- `ALLOWED_ORIGINS` — `*` by default; set it to your site's origin
  (`https://type.example.com`) so nothing else can post to your board.
- `RATE_LIMIT` — submissions per hour from one address, 40 by default.
- a secret salt for the IP hashes: `npx wrangler secret put SALT`.

## Test it

```sh
cd worker
npm test
```

The tests run the validator against real runs captured from the page
(`test/fixtures/`) and against forged ones, and drive the routes over an
in-memory SQLite standing in for D1 — no account or network needed.
Node 22 or newer.

## Moderating

Everything is in D1, so `wrangler d1 execute` is the admin panel:

```sh
npx wrangler d1 execute type-leaderboard --remote --command \
  "DELETE FROM scores WHERE name = 'someone rude'; DELETE FROM runs WHERE name = 'someone rude';"
```
