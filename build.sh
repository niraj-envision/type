#!/usr/bin/env bash
# Inlines the site into one self-contained file: dist/type.html
# Useful for hosting it anywhere that takes a single page.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p dist

python3 - <<'PY'
import re, pathlib
html = pathlib.Path('index.html').read_text()
css  = pathlib.Path('css/style.css').read_text()
js   = ''.join(pathlib.Path('js/%s.js' % n).read_text() for n in ('words', 'sound', 'app'))

html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n%s\n</style>' % css)
for n in ('words', 'sound', 'app'):
    html = html.replace('<script src="js/%s.js"></script>' % n, '')
html = html.replace('</body>', '<script>\n%s\n</script>\n</body>' % js)
html = re.sub(r'\n{3,}', '\n\n', html)
pathlib.Path('dist/type.html').write_text(html)
print('dist/type.html  %.1f KB' % (len(html) / 1024))
PY
