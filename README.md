# SprayPath, by BCVR Immersive

Walking directions and AR to London street art, hosted on **ZapWorks**. Built with OpenStreetMap, Leaflet,
A-Frame and **Zappar for A-Frame**.

This is a staged rebuild: each milestone is tested on a real phone before the next is added.

| Page | What it does | Status |
| --- | --- | --- |
| `index.html`, map | OpenStreetMap map, live GPS, walking tours, turn-by-turn directions (route on the map, next-turn card, full step list, voice prompts, re-routing when you go off route), arrival stories, demo walk | Built |
| `ar.html`, AR | Zappar camera (set up as in Zappar's A-Frame docs), 3D arrow to the chosen spot, status panel for testing | **Milestone 1**: test on iPhone |

Next milestones, each only after the last one works on a phone:
1. Zappar camera + one arrow (now)
2. Route arrows on the pavement in AR, synced with the map's turn-by-turn
3. Beacon over the artwork, arrival in AR
4. Mural recognition (Zappar image targets)

## Files

```
index.html          Map page
ar.html             AR page (A-Frame scene with zappar-camera, zappar-permissions-ui, zappar-compatibility-ui)
js/errors.js        On-screen error banner (phones have no console)
js/spots.js         The 13 spots and 3 walking tours
js/nav.js           Geo maths, OSRM walking routes, voice, compass
js/map-app.js       Map page logic
js/ar-app.js        AR components (sp-pointer, sp-arrow, sp-label) and the status panel
vendor/             A-Frame 1.8.0, Zappar for A-Frame 4.0.0 (bundled), Leaflet 1.9.4
tools/zappar-build  How vendor/zappar-aframe is built (scripts/build-zappar.sh)
scripts/            package-zapworks.sh (zip for upload), train-target.sh (mural targets), build-zappar.sh
```

All scripts are plain `<script>` files: no modules and no build step for the app itself.

## Publish on ZapWorks

1. `./scripts/package-zapworks.sh` creates `dist/spraypath-zapworks.zip`.
2. In [zap.works](https://zap.works), upload it on your project's **Experience** tab.
3. Open the `*.zappar.io` link on your phone.

## Test locally

```sh
python3 -m http.server 8000
# map: http://localhost:8000/?demo=1      AR: http://localhost:8000/ar.html?spot=leake-street
```

## Credits

Map data © OpenStreetMap contributors. Walking routes: OSRM via FOSSGIS (`routing.openstreetmap.de`). Built with
[A-Frame](https://aframe.io), [Zappar for A-Frame](https://github.com/zappar-xr/zappar-aframe) and [Leaflet](https://leafletjs.com).
Street art changes constantly; spots point to the wall or street.
