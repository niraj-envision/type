#!/usr/bin/env bash
# Inlines the site into one self-contained file: dist/type.html
# Then restarts the local server, so what is being served is always what was
# just built — a stale server is an hour of debugging a bug you already fixed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p dist

python3 - <<'PY'
import re, pathlib
html = pathlib.Path('index.html').read_text()
css  = pathlib.Path('css/style.css').read_text()
js   = ''.join(pathlib.Path('js/%s.js' % n).read_text() for n in ('words', 'stories', 'sound', 'app'))

html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n%s\n</style>' % css)
for n in ('words', 'stories', 'sound', 'app'):
    html = html.replace('<script src="js/%s.js"></script>' % n, '')
html = html.replace('</body>', '<script>\n%s\n</script>\n</body>' % js)
html = re.sub(r'\n{3,}', '\n\n', html)
pathlib.Path('dist/type.html').write_text(html)
print('built   dist/type.html  %.1f KB' % (len(html) / 1024))
PY

PORT="${PORT:-8777}"
if [[ "${1:-}" == "--no-serve" ]]; then exit 0; fi

# Kill only the server on this port, by pid, so nothing else in the session dies.
for pid in $(pgrep -f "http.server $PORT" || true); do kill "$pid" 2>/dev/null || true; done
sleep 0.4
setsid nohup python3 -m http.server "$PORT" >/tmp/type-server.log 2>&1 </dev/null &
sleep 0.6

if curl -fsS -o /dev/null "http://localhost:$PORT/"; then
  echo "serving http://localhost:$PORT  (restarted)"
else
  echo "server did not come up on $PORT — see /tmp/type-server.log" >&2
  exit 1
fi
