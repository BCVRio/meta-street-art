#!/usr/bin/env python3
"""Downloads the worldwide raw data for build.py from Overpass: one request at a time, continent-sized
chunks, patient retries across mirrors (the public servers are often overloaded; this just keeps trying).

Usage: python3 -I tools/data/fetch-overpass.py <out-dir>
Writes <out-dir>/artwork.json and <out-dir>/cities.json (and per-chunk files in <out-dir>/chunks/).
"""
import json, os, random, subprocess, sys, tempfile, time

MIRRORS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter',
           'https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter']
CHUNKS = {  # south, west, north, east
    'europe': (35, -30, 72, 40), 'africa-middle-east': (-36, -30, 35, 60), 'north-asia': (35, 40, 72, 180),
    'south-asia': (-11, 60, 35, 180), 'oceania': (-50, 100, -11, 180), 'north-america': (14, -170, 72, -50),
    'latin-america': (-56, -100, 14, -30),
}
ART = '[out:json][timeout:600][maxsize:1073741824];nwr["tourism"="artwork"]["artwork_type"~"mural|graffiti|street_art|stencil|paste_up|streetart",i]({bbox});out center tags;'
CITY = '[out:json][timeout:600];node["place"~"^(city|town)$"](if:number(t["population"])>=100000)({bbox});out;'

def fetch(query, log):
    with tempfile.NamedTemporaryFile('w', suffix='.ql', delete=False) as f: f.write(query); qf = f.name
    try:
        for attempt in range(60):
            ep = MIRRORS[attempt % len(MIRRORS)]
            t0 = time.time()
            r = subprocess.run(['curl', '-sS', '-m', '660', '-A', 'SprayPath-data/1.0 (street art tour app)', '--data-urlencode', f'data@{qf}', ep], capture_output=True, text=True)
            try:
                d = json.loads(r.stdout)
                if 'elements' in d:
                    log(f'  ok from {ep} in {time.time() - t0:.0f}s: {len(d["elements"])} elements'); return d['elements']
                log(f'  {ep}: JSON without elements ({str(d)[:80]})')
            except Exception:
                log(f'  {ep}: {(r.stdout[:60] or r.stderr[:80]).strip()!r} after {time.time() - t0:.0f}s')
            time.sleep(min(300, 30 + attempt * 20) + random.uniform(0, 15))
    finally: os.unlink(qf)
    return None

def main():
    out = sys.argv[1]; os.makedirs(os.path.join(out, 'chunks'), exist_ok=True)
    logf = open(os.path.join(out, 'fetch.log'), 'a')
    def log(m): print(time.strftime('%H:%M:%S'), m); logf.write(time.strftime('%H:%M:%S ') + m + '\n'); logf.flush()
    for kind, tmpl in (('cities', CITY), ('artwork', ART)):
        for name, bb in CHUNKS.items():
            path = os.path.join(out, 'chunks', f'{kind}-{name}.json')
            if os.path.exists(path): continue
            log(f'{kind} {name} {bb}')
            els = fetch(tmpl.format(bbox=','.join(map(str, bb))), log)
            if els is None: log(f'  GAVE UP on {kind} {name}'); continue
            json.dump(els, open(path, 'w'))
            time.sleep(20)
    for kind in ('cities', 'artwork'):
        seen = set(); merged = []
        for name in CHUNKS:
            path = os.path.join(out, 'chunks', f'{kind}-{name}.json')
            if not os.path.exists(path): continue
            for e in json.load(open(path)):
                key = (e['type'], e['id'])
                if key in seen or not e.get('tags'): continue
                seen.add(key); c = e.get('center', e)
                if 'lat' not in c: continue
                merged.append({'id': f"{e['type']}/{e['id']}", 'lat': c['lat'], 'lon': c['lon'], 'tags': e['tags']})
        json.dump(merged, open(os.path.join(out, f'{kind}.json'), 'w'))
        log(f'{kind}.json: {len(merged)} elements')

if __name__ == '__main__':
    main()
