# SprayPath, by BCVR Immersive

Live AR walking directions to London street art, in the phone browser. It's free, open source and has no app to install.

Pick a tour or a spot, hold up your phone, and follow the pink arrows flowing along the pavement. A blue light beacon marks where
the artwork is, and when you arrive you get the story behind the piece (on screen and read aloud).

**Hosting:** upload to ZapWorks (see *Publish on ZapWorks*) or any HTTPS static host.

## How the AR works

Built with **[A-Frame](https://aframe.io) 1.8** (open source, MIT). There are no tracking SDKs or licence checks, so it runs on any
HTTPS host, including ZapWorks.

| Piece | What it does |
| --- | --- |
| Camera feed | `getUserMedia` rear camera, full screen behind a transparent A-Frame `<a-scene>` |
| Which way you're looking | A-Frame `look-controls` "magic window" turns the phone's motion sensors into camera rotation |
| True north | Compass heading (`webkitCompassHeading` on iPhone, absolute orientation on Android) rotates `#sp-world` to line up with north |
| Where you are | GPS (`watchPosition`), smoothed so the arrows glide rather than jump |
| The route | Walking route from OSRM on OpenStreetMap data, drawn as chevrons on the pavement |
| **Floor lock** (Android) | A-Frame's WebXR AR mode (`sceneEl.enterAR()`, ARCore) tracks the camera so arrows stay pinned to the ground between GPS fixes |

Works on iPhone (Safari) and Android (Chrome). Floor lock only appears on phones that support WebXR AR. iPhones don't support it yet.

**Accuracy:** GPS is typically 5–15 m between London's buildings and compasses can be thrown off by metal nearby, so arrows can sit
a little to one side of the real street. The big guide arrow and the turn-by-turn card are what to follow. Moving the phone in a
figure of eight recalibrates the compass.

## A-Frame scene

`js/ar-view.js` defines the scene markup (`SCENE_HTML`) and these components, so the 3D look can be edited in plain A-Frame HTML:

| Component / system | Role |
| --- | --- |
| `spraypath` (system) | Shared state; aligns `#sp-world` to north and anchors it to GPS every frame |
| `sp-world` | Root for street content: east = +X, north = −Z, pavement at y = 0 |
| `sp-chevrons` | Pink chevrons flowing along the route (`color`) |
| `sp-guide` + `sp-arrow-mesh` | Floating arrow ahead of the user (`distance`, `drop`, `lookAhead`) |
| `sp-beacon` | Light pillar over the artwork, constant on-screen size; its look is the `<a-cylinder>`/`<a-sphere>` inside it |
| `sp-label` | Canvas text panel (`accent`, `width`, `source: guide|dest`) |
| `sp-party` | Arrival confetti around the `<a-torus>` frame |
| `sp-camera-fov` | Matches the 3D camera's field of view to the phone camera |

## Files

```
index.html               Home screen (tours, map, spot list) and AR screen; loads A-Frame from aframe.io
js/app.js                UI, navigation (route steps, rerouting, arrival), voice guidance, demo walk
js/ar-view.js            A-Frame system, components and scene markup
js/nav-core.js           Geo maths, OSRM routing, speech, compass
js/spots.js              The 13 spots and 3 walking tours, edit this to add art
scripts/package-zapworks.sh  Builds dist/spraypath-zapworks.zip for ZapWorks
```

No build step needed to run it.

## Publish on ZapWorks

1. Run `./scripts/package-zapworks.sh` (needs Python 3). It creates `dist/spraypath-zapworks.zip` with `index.html` at the root.
2. In [zap.works](https://zap.works), open (or create) your project and upload the zip on the **Experience** tab
   (or use the ZapWorks CLI shown there).
3. Open the `*.zappar.io` link on your phone. It's HTTPS, so camera, GPS and compass all work.

On Windows without the script: zip `index.html`, `manifest.json`, `icon.svg` and the `js` folder (keep the folder) and upload that.

## Run it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000/?demo=1
```

`?demo=1` simulates a walk from the nearest station, so you can try it anywhere. On a computer, drag to look around.
Other URL options: `?tour=shoreditch|southbank|camden` or `?spot=<id>` to jump straight into AR.

To test on a phone you need HTTPS (browsers only give camera, GPS and compass to secure pages): use ZapWorks, GitHub Pages
(Settings → Pages → Deploy from branch `main`), or `ngrok http 8000`.

## Data & credits

- Walking routes: OSRM foot profile via the FOSSGIS server `routing.openstreetmap.de` (fair use; for heavy traffic run your own OSRM).
- Map tiles and route data © OpenStreetMap contributors.
- Built with [A-Frame](https://aframe.io) (MIT) and [Leaflet](https://leafletjs.com) (BSD-2).
- Street art changes constantly. Coordinates point to the wall or street, and pieces may have been painted over.
