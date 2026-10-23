#!/usr/bin/env python3
"""Fetches neighbourhood names (OSM place=suburb/quarter/neighbourhood/borough nodes) around every city in
data/index.json, for naming the auto-generated tours. Polite to Overpass: batches of cities per request.

Usage: python3 -I tools/data/fetch-places.py data/index.json <out places.json>
"""
import json, subprocess, sys, time, tempfile, os
ENDPOINTS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter',
             'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
def fetch(q):
    with tempfile.NamedTemporaryFile('w', suffix='.ql', delete=False) as f: f.write(q); qf = f.name
    try:
        for attempt in range(8):
            ep = ENDPOINTS[attempt % len(ENDPOINTS)]
            r = subprocess.run(['curl', '-sS', '-m', '290', '-A', 'SprayPath-data/1.0 (street art tour app)', '--data-urlencode', f'data@{qf}', ep], capture_output=True, text=True)
            try:
                d = json.loads(r.stdout)
                if 'elements' in d: return d['elements']
            except Exception: pass
            time.sleep(4 * (attempt + 1))
    finally: os.unlink(qf)
    return None
cities = json.load(open(sys.argv[1]))['cities']
cities = [c for c in cities if c['tours'] > 0]
out = []; failed = []
for i in range(0, len(cities), 30):
    batch = cities[i:i + 30]
    q = '[out:json][timeout:250];(' + ''.join(f'node["place"~"^(suburb|quarter|neighbourhood|borough|district)$"]["name"](around:14000,{c["lat"]},{c["lng"]});' for c in batch) + ');out tags;'
    els = fetch(q)
    if els is None: failed += [c['id'] for c in batch]; print('FAILED', [c['id'] for c in batch]); continue
    out += [{'id': f"node/{e['id']}", 'lat': e['lat'], 'lon': e['lon'], 'tags': e['tags']} for e in els]
    print(f"{i + len(batch)}/{len(cities)} cities, {len(out)} places"); time.sleep(3)
json.dump(out, open(sys.argv[2], 'w'))
print('places:', len(out), 'failed batches:', failed)
