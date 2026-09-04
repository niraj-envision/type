/* ─────────────────────────────────────────────────────────────────
   config.js — deployment settings. This is the one file to edit when
   you host the site somewhere.

   leaderboard   The URL of your leaderboard worker, without a trailing
                 slash — see worker/README.md for how to deploy one on
                 Cloudflare's free tier, e.g.
                     'https://type-leaderboard.yourname.workers.dev'
                 Leave it empty and the leaderboard drawer shows the best
                 runs on this device only, and nothing is ever sent
                 anywhere.
   ───────────────────────────────────────────────────────────────── */
window.TYPE_CONFIG = {
  leaderboard: ''
};
