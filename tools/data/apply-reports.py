#!/usr/bin/env python3
"""Reads the open OpenStreetMap notes created by SprayPath users ("SprayPath report: …") and marks the spots they
are about in data/cities/*.json as reported (spot.reports = {gone: n, changed: n, place: n}). Run before packaging.

Usage: python3 -I tools/data/apply-reports.py [data-dir]
"""
import json, math, os, subprocess, sys
def dist(a, b):
    p = math.pi / 180
    h = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))
def main():
    data = sys.argv[1] if len(sys.argv) > 1 else 'data'
    r = subprocess.run(['curl', '-sS', '-m', '120', '-A', 'SprayPath-data/1.0 (street art tour app)',
                        'https://api.openstreetmap.org/api/0.6/notes/search.json?q=SprayPath%20report&limit=10000&closed=0'], capture_output=True, text=True)
    notes = json.loads(r.stdout).get('features', [])
    reps = []
    for n in notes:
        txt = ' '.join(c.get('text', '') for c in n['properties'].get('comments', []))
        if 'SprayPath report' not in txt: continue
        kind = 'gone' if 'no longer there' in txt else 'changed' if 'has changed' in txt else 'place' if 'not at this location' in txt else None
        if kind: reps.append((n['geometry']['coordinates'][1], n['geometry']['coordinates'][0], kind))
    print(f'open SprayPath notes: {len(reps)}')
    touched = 0
    for fn in sorted(os.listdir(os.path.join(data, 'cities'))):
        path = os.path.join(data, 'cities', fn); d = json.load(open(path)); changed = False
        for s in d['spots']:
            counts = {}
            for lat, lon, kind in reps:
                if abs(lat - s['lat']) < 0.001 and abs(lon - s['lng']) < 0.002 and dist((lat, lon), (s['lat'], s['lng'])) < 30:
                    counts[kind] = counts.get(kind, 0) + 1
            if counts != s.get('reports', {}):
                if counts: s['reports'] = counts
                else: s.pop('reports', None)
                changed = True; touched += 1
        if changed: json.dump(d, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'spots updated: {touched}')
if __name__ == '__main__':
    main()
