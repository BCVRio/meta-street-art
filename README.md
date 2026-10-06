# SprayPath, by BCVR Immersive

Walking directions and AR to London street art, hosted on **ZapWorks**. Built with OpenStreetMap, Leaflet,
A-Frame and **Zappar for A-Frame**.

This is a staged rebuild: each milestone is tested on a real phone before the next is added.

| Page | What it does | Status |
| --- | --- | --- |
| `index.html`, map | Animated title page ("Follow the art.", Begin now plays the spray-can sound logo and "Welcome to Spray Path"), OpenStreetMap map, live GPS, walking tours, turn-by-turn directions (route on the map, next-turn card, full step list, voice prompts, re-routing when you go off route), arrival stories, demo walk | Built |
| `ar.html`, AR | Zappar camera (set up as in Zappar's A-Frame docs), a trail of glowing pink dots on the pavement along the walking route, a 3D pink guide arrow in the bottom third of the screen (so you can hold the phone low), turn-by-turn labels matching the map, arrival story, status panel | **Milestone 2**: test on iPhone |

Next milestones, each only after the last one works on a phone:
1. Zappar camera + one arrow ✓
2. Pink dot trail along the route on the pavement, synced with the map's turn-by-turn (now)
3. Beacon over the artwork, arrival in AR
4. Mural recognition (Zappar image targets)

## Files

```
index.html          Map page
ar.html             AR page (A-Frame scene with zappar-camera, zappar-permissions-ui, zappar-compatibility-ui)
js/errors.js        On-screen error banner (phones have no console)
js/worker-shim.js   Starts Zappar's workers from blob: URLs so they run under ZapWorks' cross-origin isolation
js/spots.js         The 13 spots and 3 walking tours
js/nav.js           Geo maths, OSRM walking routes, voice, compass
js/map-app.js       Map page logic
js/splash.js        Title page: animates the key art (assets/title-keyart.webp, made with Higgsfield) and Begin now
js/ar-app.js        AR: route + turn-by-turn, components sp-world (north + GPS alignment), sp-dots, sp-pointer, sp-arrow, sp-label; status panel
assets/             Title key art; sounds/welcome.mp3 sound logo (voice made with Higgsfield, spray and chime synthesised)
vendor/             A-Frame 1.8.0, Zappar for A-Frame 4.0.0 (bundled), Leaflet 1.9.4, Bungee font (OFL)
tools/zappar-build  How vendor/zappar-aframe is built (scripts/build-zappar.sh)
scripts/            package-zapworks.sh (zip for upload), train-target.sh (mural targets), build-zappar.sh
```

All scripts are plain `<script>` files: no modules and no build step for the app itself.

## ZapWorks hosting notes

ZapWorks serves pages with `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`.
Under those headers, images from other sites must be requested with CORS (the map tiles use `crossOrigin`), and
worker scripts need their own COEP header, so `js/worker-shim.js` starts Zappar's workers from `blob:` URLs instead.

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

Map data © OpenStreetMap contributors. Walking routes: OSRM via FOSSGIS (`routing.openstreetmap.de`). Title key art generated with Higgsfield. Bungee font by David Jonathan Ross (SIL OFL). Built with
[A-Frame](https://aframe.io), [Zappar for A-Frame](https://github.com/zappar-xr/zappar-aframe) and [Leaflet](https://leafletjs.com).
Street art changes constantly; spots point to the wall or street.
