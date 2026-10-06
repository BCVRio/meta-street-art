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
files = (['index.html', 'manifest.json', 'icon.svg'] + tree('js', ('.js',))
         + tree('vendor', ('.js', '.wasm')) + tree('targets', ('.zpt',)))
with zipfile.ZipFile('dist/spraypath-zapworks.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f)
print(f'Created dist/spraypath-zapworks.zip ({len(files)} files):', ', '.join(files))
PY
