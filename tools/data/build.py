#!/usr/bin/env python3
"""Builds the app's per-city street art data from OpenStreetMap.

Input (from tools/data/fetch.md):
  artwork.json   [{id, lat, lon, tags}]  every tourism=artwork with a mural/graffiti/street_art type
  cities.json    [{id, lat, lon, tags}]  place=city/town nodes with a population
  curated/*.json hand-written spots and tours (London), merged in and preferred over OSM copies

Output:
  data/index.json           list of cities with counts, for the city picker and nearest-city lookup
  data/cities/<city>.json   {spots, tours, demoStarts} for one city, loaded on demand by js/data.js

Usage: python3 -I tools/data/build.py <artwork.json> <cities.json> [out-dir] [places.json]
  places.json (optional, from fetch-places.py): place=suburb/neighbourhood nodes, used to name the tours.
"""
import json, math, os, re, sys, unicodedata
from collections import Counter, defaultdict

R = 6371000.0
def dist(a, b):
    p = math.pi / 180
    dlat = (b[0] - a[0]) * p; dlng = (b[1] - a[1]) * p
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))
def bearing(a, b):
    p = math.pi / 180
    y = math.sin((b[1] - a[1]) * p) * math.cos(b[0] * p)
    x = math.cos(a[0] * p) * math.sin(b[0] * p) - math.sin(a[0] * p) * math.cos(b[0] * p) * math.cos((b[1] - a[1]) * p)
    return (math.degrees(math.atan2(y, x)) + 360) % 360
def offset(a, brg, d):
    p = math.pi / 180
    lat1 = a[0] * p; lng1 = a[1] * p; t = brg * p; ad = d / R
    lat2 = math.asin(math.sin(lat1) * math.cos(ad) + math.cos(lat1) * math.sin(ad) * math.cos(t))
    lng2 = lng1 + math.atan2(math.sin(t) * math.sin(ad) * math.cos(lat1), math.cos(ad) - math.sin(lat1) * math.sin(lat2))
    return [round(math.degrees(lat2), 5), round(math.degrees(lng2), 5)]

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return s[:40] or 'x'

CITY_RADIUS = 10000000      # every spot belongs to its nearest city, however far
LINK = 400                  # spots closer than this are walkable neighbours
MAX_STOPS, MIN_STOPS = 8, 3
MAX_WALK = 4500             # straight-line length of a tour

def artwork_name(t):
    for k in ('name:en', 'name', 'official_name', 'alt_name'):
        if t.get(k): return t[k].strip()
    return None

def blurb(name, t, city):
    """A short spoken story from the tags; honest about what we know."""
    kind = {'mural': 'mural', 'graffiti': 'graffiti piece', 'street_art': 'street art piece', 'stencil': 'stencil', 'paste_up': 'paste-up'}.get(
        (t.get('artwork_type') or 'mural').split(';')[0].lower(), 'artwork')
    artist = (t.get('artist_name') or t.get('artist') or '').strip()
    year = (t.get('start_date') or t.get('artwork:creation_year') or '').strip()[:4]
    bits = []
    if t.get('name') or t.get('name:en'):
        s = f"You've reached {name}"
        if artist: s += f", a {kind} by {artist}"
        else: s += f", a {kind}"
        if year.isdigit(): s += f" from {year}"
        bits.append(s + '.')
    else:
        s = f"This {kind} is by {artist}" if artist else f"You're at a {kind} that has been mapped here"
        if year.isdigit(): s += f", painted in {year}"
        bits.append(s + '.')
    subj = (t.get('artwork_subject') or t.get('subject') or '').strip()
    if subj and len(subj) < 80 and ':' not in subj: bits.append(f"It shows {subj}.")
    desc = (t.get('description:en') or t.get('description') or t.get('inscription') or '').strip()
    if desc and 15 < len(desc) < 400: bits.append(desc if desc.endswith(('.', '!', '?')) else desc + '.')
    if not desc: bits.append('Street art changes fast, so if the wall has been repainted, look around: the next piece is often close by.')
    return ' '.join(bits)

def load_elements(path):
    with open(path) as f: d = json.load(f)
    els = (d.get('elements') or d.get('places') or []) if isinstance(d, dict) else d
    out = []
    for e in els:
        c = e.get('center') or e
        lat, lon = c.get('lat'), c.get('lon', c.get('lng'))
        if lat is None or lon is None or not e.get('tags'): continue
        out.append({'id': e.get('id') if isinstance(e.get('id'), str) else f"{e.get('type','node')}/{e.get('id')}",
                    'lat': float(lat), 'lon': float(lon), 'tags': e['tags']})
    return out

class Grid:
    """Nearest-neighbour lookup on a ~0.2° grid."""
    def __init__(self, items, key):
        self.cells = defaultdict(list); self.key = key
        for it in items: self.cells[self.cell(key(it))].append(it)
    @staticmethod
    def cell(ll): return (int(ll[0] // 0.2), int(ll[1] // 0.2))
    def near(self, ll, maxd):
        """Nearest item within maxd: searches growing rings of cells (so remote spots still find a city)."""
        cx, cy = self.cell(ll); best = None; bd = maxd
        for ring in range(0, 40):
            if best is not None and ring > 1: break          # found at ring r → nothing closer beyond ring r+1
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    if max(abs(dx), abs(dy)) != ring: continue
                    for it in self.cells.get((cx + dx, cy + dy), ()):
                        d = dist(ll, self.key(it))
                        if d < bd: bd, best = d, it
            if ring * 0.2 * 111000 > maxd: break
        return best, bd

def make_tours(spots, city_name, places=None):
    """Group walkable spots into tours of 3-8 stops."""
    n = len(spots); ll = [(s['lat'], s['lng']) for s in spots]
    # neighbours within LINK (grid-accelerated)
    cells = defaultdict(list)
    for i, p in enumerate(ll): cells[(int(p[0] // 0.004), int(p[1] // 0.006))].append(i)
    adj = [[] for _ in range(n)]
    for i, p in enumerate(ll):
        cx, cy = int(p[0] // 0.004), int(p[1] // 0.006)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cells.get((cx + dx, cy + dy), ()):
                    if j > i and dist(p, ll[j]) <= LINK: adj[i].append(j); adj[j].append(i)
    seen = [False] * n; comps = []
    for i in range(n):
        if seen[i]: continue
        st = [i]; seen[i] = True; comp = []
        while st:
            k = st.pop(); comp.append(k)
            for j in adj[k]:
                if not seen[j]: seen[j] = True; st.append(j)
        if len(comp) >= MIN_STOPS: comps.append(comp)
    groups = []
    for comp in comps:
        if len(comp) <= MAX_STOPS: groups.append(comp); continue
        # k-means into groups of ~6
        k = math.ceil(len(comp) / 6); pts = [ll[i] for i in comp]
        cents = [pts[int(t * len(pts) / k)] for t in range(k)]
        for _ in range(12):
            buckets = [[] for _ in range(k)]
            for idx, p in zip(comp, pts): buckets[min(range(k), key=lambda c: dist(p, cents[c]))].append(idx)
            cents = [(sum(ll[i][0] for i in b) / len(b), sum(ll[i][1] for i in b) / len(b)) if b else cents[c] for c, b in enumerate(buckets)]
        for b in buckets:
            if len(b) > MAX_STOPS: b = sorted(b, key=lambda i: ll[i][1])[:MAX_STOPS]
            if len(b) >= MIN_STOPS: groups.append(b)
    tours = []
    for g in groups:
        # order: start at the westmost stop, then nearest neighbour
        order = [min(g, key=lambda i: ll[i][1])]; rest = set(g) - {order[0]}
        while rest:
            nxt = min(rest, key=lambda i: dist(ll[order[-1]], ll[i])); order.append(nxt); rest.remove(nxt)
        length = sum(dist(ll[order[i - 1]], ll[order[i]]) for i in range(1, len(order)))
        if length > MAX_WALK: continue
        tours.append((order, length))
    # names: the neighbourhood (place node nearest the tour's centre), else the stops' address tags, else the first stop
    used = Counter(); out = []
    tours.sort(key=lambda t: (-len(t[0]), t[1]))
    for order, length in tours:
        cx = sum(ll[i][0] for i in order) / len(order); cy = sum(ll[i][1] for i in order) / len(order)
        place = places.near((cx, cy), 1800)[0] if places else None
        areas = Counter(a for a in (spots[i].get('_area') for i in order) if a)
        if place: base, name = place['tags']['name'], f"{place['tags']['name']} Walk"
        elif areas: base = areas.most_common(1)[0][0]; name = f"{base} Walk"
        else:
            named = [spots[i]['name'] for i in order if not spots[i]['name'].startswith(('Untitled', 'Mural by', 'Graffiti by', 'Street art by'))]
            base = named[0] if named else city_name; name = f"{base} & around" if named else f"{city_name} walls"
        used[name] += 1
        if used[name] > 1: name += f" {used[name]}"
        first, last = spots[order[0]], spots[order[-1]]
        km = max(0.3, round(length * 1.3 / 1000, 1))     # streets are longer than straight lines
        tid = slug(name)
        named = [spots[i]['name'] for i in order if not spots[i]['name'].startswith(('Untitled', 'Mural by', 'Graffiti by', 'Street art by'))]
        desc = (f"{named[0]} to {named[-1]}" if len(named) >= 2 else f"{named[0]} and around" if named else f"{len(order)} walls") + f" · about {km:g} km"
        out.append({'id': tid, 'name': name, 'desc': desc, 'stops': [spots[i]['id'] for i in order], 'km': km})
    return out

def main():
    art_path, cities_path = sys.argv[1], sys.argv[2]
    out_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', '..', 'data')
    here = os.path.dirname(os.path.abspath(__file__))
    art = load_elements(art_path); cities = load_elements(cities_path)
    places = None
    if len(sys.argv) > 4 and os.path.exists(sys.argv[4]):
        pl = [p for p in load_elements(sys.argv[4]) if p['tags'].get('name')]
        places = Grid(pl, lambda p: (p['lat'], p['lon'])); print(f"places: {len(pl)}")
    # place=city nodes with a name; where a population is given, only real cities (50k+) anchor spots
    def pop(c):
        try: return int(''.join(ch for ch in c['tags'].get('population', '') if ch.isdigit()) or 0)
        except Exception: return 0
    cities = [c for c in cities if c['tags'].get('name')]
    # OSM also tags inner districts as place=city (City of London, Westminster…): fold a city into any bigger
    # one nearby so a metropolis is one entry. Reach grows with the bigger city's population.
    cities.sort(key=pop, reverse=True)
    kept = []; kgrid = defaultdict(list)
    for c in cities:
        hc = (c['lat'], c['lon']); ok = True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for k in kgrid.get((int(hc[0] // 0.2) + dx, int(hc[1] // 0.2) + dy), ()):
                    reach = 18000 if pop(k) >= 2000000 else 12000 if pop(k) >= 500000 else 7000 if pop(k) >= 150000 else 4000
                    if dist(hc, (k['lat'], k['lon'])) < reach: ok = False; break
                if not ok: break
            if not ok: break
        if ok: kept.append(c); kgrid[(int(hc[0] // 0.2), int(hc[1] // 0.2))].append(c)
    print(f"cities: {len(cities)} → {len(kept)} after folding districts into their city")
    cities = kept
    cgrid = Grid(cities, lambda c: (c['lat'], c['lon']))
    by_city = defaultdict(list); skipped = Counter()
    for e in art:
        t = e['tags']; kind = (t.get('artwork_type') or '').lower()
        name = artwork_name(t); artist = t.get('artist_name') or t.get('artist')
        city, d = cgrid.near((e['lat'], e['lon']), CITY_RADIUS)
        if not city: skipped['no city nearby'] += 1; continue
        by_city[city['id']].append(e)
    # curated cities (hand-written data) are merged in
    curated = {}
    cdir = os.path.join(here, 'curated')
    if os.path.isdir(cdir):
        for fn in os.listdir(cdir):
            if fn.endswith('.json'):
                with open(os.path.join(cdir, fn)) as f: curated[fn[:-5]] = json.load(f)
    index = []; os.makedirs(os.path.join(out_dir, 'cities'), exist_ok=True)
    city_by_id = {c['id']: c for c in cities}
    used_slugs = Counter()
    # biggest cities first, so "london" is London, and a smaller namesake gets a suffix
    for cid, els in sorted(by_city.items(), key=lambda kv: -len(kv[1])):
        c = city_by_id[cid]; cname = c['tags'].get('name:en') or c['tags']['name']
        country = c['tags'].get('addr:country') or c['tags'].get('is_in:country_code') or ''
        city_slug = slug(cname); used_slugs[city_slug] += 1
        if used_slugs[city_slug] > 1: city_slug += '-' + (country.lower() if country else '') + str(used_slugs[city_slug])
        spots = []; ids = Counter()
        cur = curated.get(city_slug, {'spots': [], 'tours': [], 'demoStarts': []})
        for s in cur['spots']: spots.append(dict(s, curated=True))
        cur_grid = Grid(spots, lambda s: (s['lat'], s['lng']))
        for e in els:
            t = e['tags']; name = artwork_name(t); artist = (t.get('artist_name') or t.get('artist') or '').strip()
            kind = (t.get('artwork_type') or 'mural').split(';')[0].lower()
            if not name:
                what = 'mural' if 'mural' in kind else 'graffiti' if 'graffiti' in kind else 'street art'
                name = f"{what.capitalize()} by {artist}" if artist else f"Untitled {what}"
            if cur_grid.near((e['lat'], e['lon']), 40)[0]: continue      # already hand-written
            base = slug(name); ids[base] += 1
            sid = base if ids[base] == 1 else f"{base}-{ids[base]}"
            area = t.get('addr:suburb') or t.get('addr:quarter') or t.get('addr:neighbourhood') or t.get('addr:district')
            tags = [x for x in [kind.replace('_', ' '), 'artist: ' + artist if artist else None] if x]
            spots.append({'id': sid, 'name': name, 'area': area or cname, 'lat': round(e['lat'], 5), 'lng': round(e['lon'], 5),
                          'tags': tags, 'blurb': blurb(name, t, cname), 'osm': e['id'], '_area': area})
        if len(spots) < 1: continue
        tours = list(cur['tours']) + make_tours([s for s in spots if not s.get('curated')], cname, places)
        by_id = {s['id']: s for s in spots}
        demo = list(cur.get('demoStarts', []))
        for tr in tours:
            if tr['id'] in {d.get('tour') for d in demo}: continue
            a = by_id[tr['stops'][0]]; b = by_id[tr['stops'][1]] if len(tr['stops']) > 1 else a
            demo.append({'tour': tr['id'], 'name': 'Start of ' + tr['name'], **dict(zip(('lat', 'lng'), offset((a['lat'], a['lng']), (bearing((a['lat'], a['lng']), (b['lat'], b['lng'])) + 180) % 360, 350)))})
        for s in spots: s.pop('_area', None); s.pop('curated', None)
        fn = f"{city_slug}.json"
        with open(os.path.join(out_dir, 'cities', fn), 'w') as f:
            json.dump({'city': cname, 'spots': spots, 'tours': tours, 'demoStarts': demo}, f, ensure_ascii=False, separators=(',', ':'))
        index.append({'id': city_slug, 'name': cname, 'country': country, 'lat': round(c['lat'], 4), 'lng': round(c['lon'], 4),
                      'spots': len(spots), 'tours': len(tours)})
    index.sort(key=lambda x: -x['spots'])
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump({'built': __import__('datetime').date.today().isoformat(), 'cities': index}, f, ensure_ascii=False, separators=(',', ':'))
    print(f"cities: {len(index)}  spots: {sum(x['spots'] for x in index)}  tours: {sum(x['tours'] for x in index)}  skipped: {dict(skipped)}")
    for x in index[:15]: print(f"  {x['name']:<22} {x['spots']:>5} spots {x['tours']:>4} tours")

if __name__ == '__main__':
    main()
