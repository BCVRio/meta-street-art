#!/usr/bin/env sh
# Builds dist/spraypath-zapworks.zip for upload to ZapWorks
# (zap.works → your project → Experience → upload ZIP). index.html sits at the root of the zip.
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/spraypath-zapworks.zip
python3 - <<'PY'
import zipfile, os
files = ['index.html', 'manifest.json', 'icon.svg'] + sorted('js/' + f for f in os.listdir('js') if f.endswith('.js'))
with zipfile.ZipFile('dist/spraypath-zapworks.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f)
print('Created dist/spraypath-zapworks.zip:', ', '.join(files))
PY
