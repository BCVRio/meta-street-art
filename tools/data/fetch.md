# Refreshing the worldwide street art data

The app ships one JSON file per city under `data/cities/` plus `data/index.json`. They are built from
OpenStreetMap, where street art is mapped as `tourism=artwork` with `artwork_type` = mural / graffiti /
street_art. Anyone can add a wall at openstreetmap.org, and it appears here on the next rebuild.

## 1. Download from Overpass

    python3 -I tools/data/fetch-overpass.py /path/to/raw

One request at a time, seven continent-sized chunks, patient retries across mirrors (the public Overpass
servers are often overloaded; this can take an hour or more). It writes two files:

- `artwork.json`: `nwr["tourism"="artwork"]["artwork_type"~"mural|graffiti|street_art|stencil|paste_up",i]` → `out center tags;`
- `cities.json`: `node["place"="city"]` → `out;` (districts tagged as cities are folded into the big city at build time)

Each element is saved as `{id, lat, lon, tags}`. overpass.openstreetmap.fr was the one mirror that answered reliably
(about 3 minutes for Europe); the others were overloaded. The last fetch (Oct 2026) gave 46,826 artworks and 11,851 cities.

## 2. Neighbourhood names (optional, improves tour names)

    python3 -I tools/data/fetch-places.py data/index.json places.json

Fetches `place=suburb|quarter|neighbourhood|borough` nodes within 14 km of every city that has tours.
Run it after a first build (it reads `data/index.json`), then rebuild with the places file.

## 3. Build

    python3 -I tools/data/build.py artwork.json cities.json data places.json

What it does:
- keeps every artwork (unnamed ones become "Untitled mural" / "Untitled graffiti");
- assigns each to its nearest city (place=city), however far;
- merges `tools/data/curated/<city>.json` (hand-written spots, tours and demo starts; London), skipping OSM
  copies within 40 m of a curated spot;
- writes a short spoken blurb from the tags (name, artist, year, subject, description);
- groups spots within 400 m of each other into walks of 3–8 stops (k-means splits big clusters), orders the
  stops west → east by nearest neighbour, drops walks over 4.5 km straight-line, and names them after the
  nearest neighbourhood ("Kreuzberg Walk"), else the stops' address tags, else the first stop;
- adds a demo start point 350 m before the first stop of every tour.

The app then loads `data/index.json` and one city file (`js/data.js`).
