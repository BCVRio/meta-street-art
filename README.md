# SprayPath, by BCVR Immersive

Live AR walking directions to London street art, in the phone browser. There's no app to install, and it's hosted on ZapWorks.

Pick a tour or a spot, hold up your phone, and follow the pink arrows flowing along the pavement. A blue light beacon marks where
the artwork is, and when you arrive you get the story behind the piece (on screen and read aloud).

**Hosting:** upload to ZapWorks (see *Publish on ZapWorks*) or any HTTPS static host.

## How the AR works

Built with **[A-Frame](https://aframe.io) 1.8** and **[Zappar for A-Frame](https://github.com/zappar-xr/zappar-aframe) 4.0.0**,
hosted on **ZapWorks**.

| Piece | What it does |
| --- | --- |
| Camera feed + phone motion | Zappar camera (`zappar-camera="pose-mode: attitude"`): camera background, lens-accurate projection, rotation from the motion sensors, permission prompts |
| True north | Compass heading (`webkitCompassHeading` on iPhone, absolute orientation on Android) rotates `#sp-world` to line up with north |
| Where you are | GPS (`watchPosition`), smoothed so the arrows glide rather than jump |
| The route | Walking route from OSRM on OpenStreetMap data, drawn as chevrons on the pavement |
| **Mural recognition** | Zappar image tracking (`zappar-image`): point the camera at a mural with a trained target and it lights up and plays its story |

Works on iPhone (Safari) and Android (Chrome).

**Accuracy:** GPS is typically 5–15 m between London's buildings and compasses can be thrown off by metal nearby, so arrows can sit
a little to one side of the real street. The big guide arrow and the turn-by-turn card are what to follow. Moving the phone in a
figure of eight recalibrates the compass.

## A-Frame scene

`js/ar-view.js` defines the scene markup (`SCENE_HTML`, `MURAL_HTML`) and these components, so the 3D look can be edited in plain
A-Frame HTML:

| Component / system | Role |
| --- | --- |
| `spraypath` (system) | Shared state; aligns `#sp-world` to north, anchors it to GPS, adds the mural image tracker |
| `sp-world` | Root for street content: east = +X, north = −Z, pavement at y = 0 |
| `sp-chevrons` | Pink chevrons flowing along the route (`color`) |
| `sp-guide` + `sp-arrow-mesh` | Floating arrow ahead of the user (`distance`, `drop`, `lookAhead`), adjusted to the phone's lens |
| `sp-beacon` | Light pillar over the artwork, constant on-screen size; its look is the `<a-cylinder>`/`<a-sphere>` inside it |
| `sp-label` | Canvas text panel (`accent`, `width`, `source: guide|dest|static`) |
| `sp-party` | Arrival confetti around the `<a-torus>` frame |

## Mural recognition (Zappar image targets)

1. Take a straight-on, well-lit photo of the mural.
2. Train it: `./scripts/train-target.sh photos/leake-street.jpg leake-street` (offline, writes `targets/leake-street.zpt`).
3. Add `target: 'targets/leake-street.zpt',` to that spot in `js/spots.js`.
4. Rebuild the zip and upload.

When the user is navigating to that spot, the tracker is switched on. Pointing the camera at the mural shows a pink ring and
"✓ name" label pinned to the wall, and counts as arriving. Street art gets repainted, so retrain when a piece changes.

## Files

```
index.html                    Home screen (tours, map, spot list) and AR screen
js/app.js                     UI, navigation (route steps, rerouting, arrival), voice guidance, demo walk
js/ar-view.js                 A-Frame system, components and scene markup; Zappar camera and image tracking
js/nav-core.js                Geo maths, OSRM routing, speech, compass
js/spots.js                   The 13 spots and 3 walking tours, edit this to add art and targets
targets/                      Zappar image targets (.zpt)
vendor/zappar-aframe/         Zappar for A-Frame 4.0.0, bundled (script, workers, CV engine .wasm)
tools/zappar-build/           webpack config + pinned versions used to build vendor/zappar-aframe
scripts/build-zappar.sh       Rebuilds vendor/zappar-aframe from npm
scripts/train-target.sh       Trains a mural photo into a .zpt
scripts/package-zapworks.sh   Builds dist/spraypath-zapworks.zip for ZapWorks
```

Zappar doesn't publish a ready-to-use standalone build of version 4 on its CDN, so `vendor/zappar-aframe/` is bundled from npm with
webpack, using A-Frame's own copy of three.js. You only need to rebuild it to upgrade Zappar (needs Node 18+).

## Publish on ZapWorks

1. Run `./scripts/package-zapworks.sh` (needs Python 3). It creates `dist/spraypath-zapworks.zip` with `index.html` at the root.
2. In [zap.works](https://zap.works), open your Universal AR project and upload the zip on the **Experience** tab.
3. Open the `*.zappar.io` link (or scan its QR code) on your phone.

Zappar's licence check passes automatically on ZapWorks hosting and on `localhost` for testing.
Other hosts must be registered with Zappar first.

## Run it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000/?demo=1
```

`?demo=1` simulates a walk from the nearest station, so you can try it anywhere (on a computer the view turns to face the walking
direction). Other URL options: `?tour=shoreditch|southbank|camden` or `?spot=<id>` to jump straight into AR.
For a phone, use ZapWorks, since phones need HTTPS for the camera, GPS and compass.

## Data & credits

- Walking routes: OSRM foot profile via the FOSSGIS server `routing.openstreetmap.de` (fair use; for heavy traffic run your own OSRM).
- Map tiles and route data © OpenStreetMap contributors.
- Built with [A-Frame](https://aframe.io) (MIT), [Zappar for A-Frame](https://github.com/zappar-xr/zappar-aframe) (MIT wrapper; Zappar's
  computer-vision library requires an active ZapWorks subscription) and [Leaflet](https://leafletjs.com) (BSD-2).
- Street art changes constantly. Coordinates point to the wall or street, and pieces may have been painted over.
