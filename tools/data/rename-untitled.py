#!/usr/bin/env python3
"""Gives the "Untitled" spots in data/cities/*.json a better name from whatever OpenStreetMap mapped about them
(subject, Wikidata label, inscription, description, Commons photo title, religion, street, operator, year), and
refreshes their blurbs and the tour descriptions that mention them. Keeps ids, so saved trips still work.

Usage: python3 -I tools/data/rename-untitled.py <artwork.json> [data-dir]
"""
import json, os, re, subprocess, sys, time, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('build', os.path.join(here, 'build.py')); build = importlib.util.module_from_spec(spec); spec.loader.exec_module(build)

def wikidata_labels(qids):
    labels = {}; qids = sorted(set(qids))
    for i in range(0, len(qids), 50):
        batch = qids[i:i + 50]
        url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + '|'.join(batch) + '&props=labels&languages=en|fr|de|es|it|pt|nl|pl&format=json'
        for attempt in range(5):
            r = subprocess.run(['curl', '-sS', '-m', '60', '-A', 'SprayPath-data/1.0 (street art tour app)', url], capture_output=True, text=True)
            try:
                ents = json.loads(r.stdout).get('entities', {})
                for q, e in ents.items():
                    ls = e.get('labels', {})
                    for lang in ('en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl'):
                        if lang in ls: labels[q] = ls[lang]['value']; break
                break
            except Exception: time.sleep(8 * (attempt + 1))
        time.sleep(3)
    return labels

def main():
    art = json.load(open(sys.argv[1])); data = sys.argv[2] if len(sys.argv) > 2 else 'data'
    tags = {(e['id'] if isinstance(e['id'], str) else f"{e['type']}/{e['id']}"): e['tags'] for e in art if e.get('tags')}
    qids = [q for t in tags.values() for k in ('subject:wikidata', 'wikidata') for q in [(t.get(k) or '').split(';')[0].strip()]
            if q.startswith('Q') and not any(t.get(n) for n in ('name', 'name:en', 'artwork_subject', 'subject'))]
    labels = wikidata_labels(qids); print('wikidata labels:', len(labels), 'of', len(set(qids)))
    renamed = 0; reasons = {}
    for fn in sorted(os.listdir(os.path.join(data, 'cities'))):
        path = os.path.join(data, 'cities', fn); d = json.load(open(path)); changed = False; by_id = {}
        for s in d['spots']:
            by_id[s['id']] = s
            if not s.get('osm') or s['osm'] not in tags: continue
            if not re.match(r'^(Untitled |Mural by |Graffiti by |Street art by |Stencil by )', s['name']): continue
            t = tags[s['osm']]; kind = (t.get('artwork_type') or 'mural').split(';')[0].lower()
            artist = (t.get('artist_name') or t.get('artist') or '').strip()
            new = build.derive_name(t, kind, artist, labels)
            if new != s['name']:
                s['name'] = new; s['blurb'] = build.blurb(new, dict(t, name=new), d.get('city', '')); changed = True; renamed += 1
        # still nameless but on a neighbourhood-named walk: "Mural in Kreuzberg" beats "Untitled mural"
        for tr in d['tours']:
            m = re.match(r'^(.+?) Walk(?: \d+)?$', tr['name'])
            if not m: continue
            for i in tr['stops']:
                s = by_id.get(i)
                if s and s['name'].startswith('Untitled '):
                    what = s['name'][len('Untitled '):]
                    s['name'] = f"{what.capitalize()} in {m.group(1)}"; s['blurb'] = s['blurb'].replace("You're at a " + what + " that has been mapped here", f"You're at a {what} in {m.group(1)} that has been mapped here"); changed = True; renamed += 1
        for tr in d['tours']:
            if re.search(r'^\d+ walls|and around ·', tr['desc']):
                named = [by_id[i]['name'] for i in tr['stops'] if i in by_id and not by_id[i]['name'].startswith('Untitled')]
                km = tr.get('km', 1)
                new_desc = (f"{named[0]} to {named[-1]}" if len(named) >= 2 else f"{named[0]} and around" if named else f"{len(tr['stops'])} walls") + f" · about {km:g} km"
                if new_desc != tr['desc']: tr['desc'] = new_desc; changed = True
        if changed: json.dump(d, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('renamed:', renamed)

if __name__ == '__main__':
    main()
