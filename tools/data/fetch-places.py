#!/usr/bin/env python3
"""Fetches neighbourhood names (OSM place=suburb/quarter/neighbourhood/borough nodes) around every city in
data/index.json that has tours, for naming the auto-generated tours. Small batches, biggest cities first,
and the output file is rewritten after every batch, so a partial run is already useful.

Usage: python3 -I tools/data/fetch-places.py data/index.json <out places.json>
"""
import json, os, subprocess, sys, tempfile, time
ENDPOINTS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
             'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
RADIUS = 12000

def query(batch):
    return ('[out:json][timeout:150];(' + ''.join(
        f'node["place"~"^(suburb|quarter|neighbourhood|borough|district)$"]["name"](around:{RADIUS},{c["lat"]},{c["lng"]});' for c in batch) + ');out;')

def fetch(q, attempts=4):
    with tempfile.NamedTemporaryFile('w', suffix='.ql', delete=False) as f: f.write(q); qf = f.name
    try:
        for attempt in range(attempts):
            ep = ENDPOINTS[attempt % len(ENDPOINTS)]
            r = subprocess.run(['curl', '-sS', '-m', '170', '-A', 'SprayPath-data/1.0 (street art tour app)', '--data-urlencode', f'data@{qf}', ep], capture_output=True, text=True)
            try:
                d = json.loads(r.stdout)
                if 'elements' in d: return d['elements']
            except Exception: pass
            time.sleep(5 + 10 * attempt)
    finally: os.unlink(qf)
    return None

def fetch_batch(batch):
    els = fetch(query(batch))
    if els is not None or len(batch) == 1: return els or []
    half = len(batch) // 2
    a = fetch_batch(batch[:half]); b = fetch_batch(batch[half:])
    return a + b

def main():
    cities = [c for c in json.load(open(sys.argv[1]))['cities'] if c['tours'] > 0]
    cities.sort(key=lambda c: -c['tours'])
    out_path = sys.argv[2]
    out = []; seen = set(); done = set()
    if os.path.exists(out_path):                      # resume
        prev = json.load(open(out_path)); out = prev.get('places', []); done = set(prev.get('done', [])); seen = {p['id'] for p in out}
    todo = [c for c in cities if c['id'] not in done]
    for i in range(0, len(todo), 10):
        batch = todo[i:i + 10]; t0 = time.time()
        els = fetch_batch(batch)
        for e in els:
            pid = f"node/{e['id']}"
            if pid in seen or 'lat' not in e: continue
            seen.add(pid); out.append({'id': pid, 'lat': e['lat'], 'lon': e['lon'], 'tags': e['tags']})
        done.update(c['id'] for c in batch)
        json.dump({'places': out, 'done': sorted(done)}, open(out_path, 'w'))
        print(f"{len(done)}/{len(cities)} cities · {len(out)} places · batch {time.time() - t0:.0f}s ({batch[0]['name']} …)", flush=True)
        time.sleep(2)
    print('places:', len(out))

if __name__ == '__main__':
    main()
