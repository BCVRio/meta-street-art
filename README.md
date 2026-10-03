# SprayPath, by BCVR Immersive

Live AR walking directions to London street art, in the phone browser. It's free, open source and has no app to install.

Pick a tour or a spot, hold up your phone, and follow the pink arrows flowing along the pavement. A blue light beacon marks where
the artwork is, and when you arrive you get the story behind the piece (on screen and read aloud).

**Live app:** https://bcvrio.github.io/meta-street-art/ (once GitHub Pages is switched on, see below)

## How the AR works

No paid SDK and no licence checks. Everything is standard web tech:

| Piece | What it does |
| --- | --- |
| Camera feed | `getUserMedia` rear camera, full screen behind a transparent three.js canvas |
| Which way you're looking | Phone motion sensors (`deviceorientation`) rotate the 3D camera |
| True north | Compass heading (`webkitCompassHeading` on iPhone, absolute orientation on Android) lines the 3D world up with north |
| Where you are | GPS (`watchPosition`), smoothed so the arrows glide rather than jump |
| The route | Walking route from OSRM on OpenStreetMap data, drawn as chevrons on the pavement |
| **Floor lock** (Android) | On phones with ARCore + Chrome, WebXR `immersive-ar` tracks the camera so arrows stay pinned to the ground between GPS fixes |

Works on iPhone (Safari) and Android (Chrome). Floor lock only appears on phones that support WebXR AR. iPhones don't support it yet.

**Accuracy:** GPS is typically 5–15 m between London's buildings and compasses can be thrown off by metal nearby, so arrows can sit
a little to one side of the real street. The big guide arrow and the turn-by-turn card are what to follow. Moving the phone in a
figure of eight recalibrates the compass.

## Files

```
index.html       Home screen (tours, map, spot list) and AR screen markup/styles
js/app.js        UI, navigation (route steps, rerouting, arrival), voice guidance, demo walk
js/ar-view.js    The AR renderer: camera feed, sensors, chevrons, guide arrow, beacon, WebXR floor lock
js/nav-core.js   Geo maths, OSRM routing, speech, compass
js/spots.js      The 13 spots and 3 walking tours, edit this to add art
```

No build step. three.js r169 is loaded from unpkg through an import map, and Leaflet draws the home-screen map.

## Run it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000/?demo=1
```

`?demo=1` simulates a walk from the nearest station, so you can try it anywhere. On a computer, drag to look around.
Other URL options: `?tour=shoreditch|southbank|camden` or `?spot=<id>` to jump straight into AR.

To test on a phone you need HTTPS (browsers only give camera, GPS and compass to secure pages). Either use the GitHub Pages link,
or run `npx localtunnel --port 8000` / `ngrok http 8000` and open the https link on your phone.

## Publish on GitHub Pages (free)

1. Repo **Settings → Pages**
2. **Source:** Deploy from a branch → **Branch:** `main`, folder `/ (root)` → Save
3. After a minute the app is live at `https://bcvrio.github.io/meta-street-art/`

Free GitHub accounts can only use Pages on **public** repos. A private repo needs GitHub Pro, or host the folder on
Netlify/Cloudflare Pages/Vercel (all free for static sites: drag and drop the folder).

## Data & credits

- Walking routes: OSRM foot profile via the FOSSGIS server `routing.openstreetmap.de` (fair use; for heavy traffic run your own OSRM).
- Map tiles and route data © OpenStreetMap contributors.
- Built with [three.js](https://threejs.org) (MIT) and [Leaflet](https://leafletjs.com) (BSD-2).
- Street art changes constantly. Coordinates point to the wall or street, and pieces may have been painted over.
