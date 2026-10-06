#!/usr/bin/env sh
# Builds dist/spraypath-zapworks.zip for upload to ZapWorks
# (zap.works → your project → Experience → upload ZIP). index.html sits at the root of the zip.
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/spraypath-zapworks.zip
python3 - <<'PY'
import zipfile, os
def tree(d, exts):
    return sorted(os.path.join(r, f) for r, _, fs in os.walk(d) for f in fs if f.endswith(exts))
files = (['index.html', 'ar.html', 'manifest.json', 'icon.svg'] + tree('js', ('.js',))
         + tree('vendor', ('.js', '.wasm', '.css')) + tree('targets', ('.zpt',)))
with zipfile.ZipFile('dist/spraypath-zapworks.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    # Explicit folder entries: some unzip tools (and hosting importers) drop files in folders without them.
    for d in sorted({os.path.dirname(f) for f in files if os.path.dirname(f)} | {os.path.dirname(os.path.dirname(f)) for f in files if os.path.dirname(os.path.dirname(f))}):
        z.writestr(d + '/', '')
    for f in files:
        z.write(f, f)
print(f'Created dist/spraypath-zapworks.zip ({len(files)} files):', ', '.join(files))
PY
