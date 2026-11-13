#!/usr/bin/env python3
"""Adds the public-source links (Wikipedia, Wikidata, Wikimedia images, website, artist) to the spots already in
data/cities/*.json, matched by OSM id, without rebuilding the tours. Also applies tools/data/curated/*.json links.

Usage: python3 -I tools/data/merge-wiki.py <artwork.json> [data-dir]
"""
import json, os, re, sys
KEYS = (('wp', 'wikipedia'), ('swp', 'subject:wikipedia'), ('awp', 'artist:wikipedia'), ('wd', 'wikidata'), ('swd', 'subject:wikidata'),
        ('awd', 'artist:wikidata'), ('img', 'image'), ('commons', 'wikimedia_commons'), ('web', 'website'))
def wiki_for(tags):
    w = {}
    for k, src in KEYS:
        if tags.get(src): w[k] = tags[src].strip()
    artist = (tags.get('artist_name') or tags.get('artist') or '').strip()
    if artist: w['artist'] = artist
    if w.get('img') and not re.search(r'wikimedia|wikipedia|^File:', w['img'], re.I): w.pop('img')
    return w
def main():
    art = json.load(open(sys.argv[1])); data = sys.argv[2] if len(sys.argv) > 2 else 'data'
    art = art['elements'] if isinstance(art, dict) else art
    by_osm = {e['id'] if isinstance(e['id'], str) else f"{e['type']}/{e['id']}": wiki_for(e['tags']) for e in art if e.get('tags')}
    here = os.path.dirname(os.path.abspath(__file__)); curated = {}
    cdir = os.path.join(here, 'curated')
    for fn in os.listdir(cdir):
        if fn.endswith('.json'):
            for s in json.load(open(os.path.join(cdir, fn)))['spots']:
                if s.get('wiki'): curated[(fn[:-5], s['id'])] = s['wiki']
    n_links = n_spots = n_files = 0
    for fn in sorted(os.listdir(os.path.join(data, 'cities'))):
        path = os.path.join(data, 'cities', fn); d = json.load(open(path)); changed = False
        for s in d['spots']:
            w = curated.get((fn[:-5], s['id'])) or (by_osm.get(s.get('osm')) if s.get('osm') else None)
            n_spots += 1
            if w and s.get('wiki') != w: s['wiki'] = w; changed = True
            if w: n_links += 1
        if changed:
            json.dump(d, open(path, 'w'), ensure_ascii=False, separators=(',', ':')); n_files += 1
    print(f"spots: {n_spots}, with links: {n_links}, files updated: {n_files}")
if __name__ == '__main__':
    main()
