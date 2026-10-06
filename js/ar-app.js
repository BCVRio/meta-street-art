// SprayPath AR (milestone 2): Zappar camera, a trail of pink dots on the ground along the walking
// route (the same OSRM / OpenStreetMap route as the map), the pink guide arrow, and turn-by-turn
// labels that match the map's directions. A status panel shows what's working on the phone.
// Load after A-Frame, Zappar for A-Frame, spots.js and nav.js, and before the <a-scene>.
//
// How the street is placed: Zappar's camera ("attitude" mode) stays at the origin and rotates with
// the phone. The #sp-world entity holds everything on the street, in a local frame where east = +X,
// north = -Z and the pavement is y = 0, with its origin at the first GPS fix. Every frame we rotate
// #sp-world so -Z points to true north (camera yaw + compass heading) and slide it so your GPS
// position is under the camera, EYE metres above the pavement.
(function () {
  'use strict';
  var N = window.NAV, THREE = AFRAME.THREE;
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var EYE = 1.3;                       // phone height above the pavement (held at chest height, tilted down)
  var DOT_SPACING = 1.2, DOT_START = 1.6, DOT_FADE_IN = 1.4, DOT_RANGE = 40, MAX_DOTS = 40;
  var SNAP_MAX = 30;                   // within this many metres of the route, lock your position onto it
  var GUIDE_LOOKAHEAD = 12;            // the arrow points this far along the route
  var ARRIVE_RADIUS = 20;
  var angleDiff = function (a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); };

  // ---------- Shared state ----------
  var state = {
    pos: null, gpsErr: '', target: null, compass: null, headingSrc: '', orientEvents: 0, cameraFrames: 0,
    rel: null, routeMsg: 'waiting for GPS', arrived: false,
  };
  window.sprayState = state;

  var spotById = {};
  window.SPOTS.forEach(function (s) { spotById[s.id] = s; });
  if (spotById[params.get('spot')]) state.target = spotById[params.get('spot')];
  var demo = params.has('demo');

  // ---------- Voice (same on/off setting as the map page) ----------
  var voiceOn = true;
  try { var v = localStorage.getItem('spraypath.voice'); if (v !== null) voiceOn = JSON.parse(v); } catch (e) {}
  // Stay quiet until the camera has been running for a moment, so nothing is spoken over the ZapWorks
  // loading screen or the camera permission prompt.
  var camLiveAt = 0;
  var speaker = N.createSpeaker({ enabled: function () { return voiceOn; }, ready: function () {
    if (!(state.cameraFrames > 0)) return false;
    if (!camLiveAt) camLiveAt = Date.now();
    return Date.now() - camLiveAt > 1500;
  } });

  // ---------- Position: GPS, or a demo walk from the position passed by the map page ----------
  if (demo && params.get('lat')) {
    state.pos = { lat: +params.get('lat'), lng: +params.get('lng'), acc: 5, demo: true, course: null };
  } else if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(function (g) {
      state.pos = { lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy,
        course: g.coords.speed > 0.6 && isFinite(g.coords.heading) ? g.coords.heading : null };
      state.gpsErr = '';
      onPosition();
    }, function (e) { state.gpsErr = e.message || 'denied'; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  } else state.gpsErr = 'not available';

  // Demo walk: move along the route at a brisk (sped-up) walking pace.
  var sim = { path: [], i: 0, speed: 1.4 * 2 };
  if (demo) setInterval(function () {
    if (!state.pos || sim.i >= sim.path.length || state.arrived) return;
    var left = sim.speed, cur = { lat: state.pos.lat, lng: state.pos.lng }, h = state.pos.course;
    while (left > 0 && sim.i < sim.path.length) {
      var t = sim.path[sim.i], d = N.dist(cur, t);
      if (d <= left) { left -= d; cur = t; sim.i++; continue; }
      h = N.bearing(cur, t);
      cur = { lat: cur.lat + (t.lat - cur.lat) * left / d, lng: cur.lng + (t.lng - cur.lng) * left / d };
      left = 0;
    }
    state.pos = { lat: cur.lat, lng: cur.lng, acc: 5, demo: true, course: h };
    onPosition();
  }, 1000);

  // ---------- Compass ----------
  var compass = N.createCompass();
  function hookCompass() { compass.enable(); }
  hookCompass();
  addEventListener('deviceorientation', function (e) { if (e.alpha !== null || typeof e.webkitCompassHeading === 'number') state.orientEvents++; });
  addEventListener('deviceorientationabsolute', function (e) { if (e.alpha !== null) state.orientEvents++; });

  // ---------- Route (OSRM walking route, same as the map page) ----------
  var nav = { origin: null, route: null, steps: null, pts: null, cum: null, step: 1, routing: false, rerouteAt: 0, offCount: 0, announced: {} };

  function toLocal(p) { var en = N.toEN(p, nav.origin); return { x: en.e, z: -en.n }; }

  function setRoute(route) {
    nav.route = route; nav.steps = route.legs[0].steps; nav.step = 1; nav.announced = {}; nav.offCount = 0;
    nav.pts = route.geometry.coordinates.map(function (c) { return toLocal({ lat: c[1], lng: c[0] }); });
    nav.cum = [0];
    for (var i = 1; i < nav.pts.length; i++) nav.cum.push(nav.cum[i - 1] + Math.hypot(nav.pts[i].x - nav.pts[i - 1].x, nav.pts[i].z - nav.pts[i - 1].z));
    if (demo) { sim.path = route.geometry.coordinates.map(N.ll); sim.i = 0; }
  }

  function requestRoute(first) {
    if (nav.routing || !state.pos || !state.target) return;
    nav.routing = true; nav.rerouteAt = Date.now();
    state.routeMsg = 'finding a walking route…';
    var target = state.target;
    N.fetchRoute(state.pos, target).then(function (route) {
      if (target !== state.target) return;
      setRoute(route);
      state.routeMsg = N.fmtDist(route.distance) + ' walking route';
      speaker.say(first ? 'Follow the pink dots. ' + N.stepText(nav.steps[0]) + '.' : 'Rerouting. ' + N.stepText(nav.steps[0]) + '.');
    }).catch(function (e) {
      state.routeMsg = 'route unavailable (' + (e.message || e) + '), pointing straight';
      if (demo) { sim.path = [{ lat: target.lat, lng: target.lng }]; sim.i = 0; }
    }).then(function () { nav.routing = false; });
  }

  // Distance along the route of the point nearest to u, and the point/heading at a distance s.
  function routeProgress(u) {
    var best = Infinity, s0 = 0, P = nav.pts;
    for (var i = 1; i < P.length; i++) {
      var a = P[i - 1], b = P[i], abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz;
      var t = len2 ? Math.max(0, Math.min(1, ((u.x - a.x) * abx + (u.z - a.z) * abz) / len2)) : 0;
      var d = Math.hypot(a.x + abx * t - u.x, a.z + abz * t - u.z);
      if (d < best) { best = d; s0 = nav.cum[i - 1] + t * (nav.cum[i] - nav.cum[i - 1]); }
    }
    return { s: s0, off: best };
  }
  function routeAt(s) {
    var P = nav.pts, C = nav.cum;
    s = Math.max(0, Math.min(s, C[C.length - 1]));
    var i = 1;
    while (i < P.length - 1 && C[i] < s) i++;
    var a = P[i - 1], b = P[i], seg = C[i] - C[i - 1] || 1, t = (s - C[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  }

  // Your position for drawing: snapped onto the route (like a sat-nav), so GPS wobble sideways doesn't
  // move the trail, and smoothed along it so small backward jitter is ignored. Computed once per frame.
  var track = { s: null, at: -1, cache: null, last: 0 };
  function userAnchor() {
    var ms = performance.now(), now = Math.floor(ms / 8);
    if (track.at === now && track.cache) return track.cache;
    var dt = Math.min(0.5, track.last ? (ms - track.last) / 1000 : 0); track.last = ms;
    var u = toLocal(state.pos), out;
    if (!nav.pts) out = { x: u.x, z: u.z, s: null };
    else {
      var pr = routeProgress(u);
      if (pr.off > SNAP_MAX) { track.s = null; out = { x: u.x, z: u.z, s: pr.s }; }
      else {
        if (track.s === null || Math.abs(pr.s - track.s) > 30) track.s = pr.s;              // first fix or big jump
        else if (pr.s - track.s > 3) track.s += (pr.s - track.s - 1) * (1 - Math.exp(-dt / 0.5));   // walked on: catch up in ~1 s
        else if (track.s - pr.s > 10) track.s += (pr.s - track.s + 4) * (1 - Math.exp(-dt / 1.5));  // clearly went back
        // (smaller differences are GPS wobble while standing still: ignore them)
        var p = routeAt(track.s);
        out = { x: p.x, z: p.z, s: track.s };
      }
    }
    track.at = now; track.cache = out;
    return out;
  }
  window.sprayDebug = { nav: nav, anchor: function () { return userAnchor(); }, local: function () { return toLocal(state.pos); } };

  // Turn-by-turn, the same rules as the map page.
  function onPosition() {
    if (!state.pos) return;
    if (!state.target) state.target = window.SPOTS.reduce(function (a, b) { return N.dist(state.pos, b) < N.dist(state.pos, a) ? b : a; });
    if (!nav.origin) nav.origin = { lat: state.pos.lat, lng: state.pos.lng };
    if (!nav.route && !nav.routing && !nav.rerouteAt) { requestRoute(true); return; }
    if (state.arrived) return;
    var toSpot = N.dist(state.pos, state.target);
    if (toSpot < ARRIVE_RADIUS) {
      state.arrived = true;
      N.buzz([200, 100, 200]);
      speaker.say("You've arrived. " + state.target.blurb, { interrupt: true });
      return;
    }
    if (!nav.steps) return;
    var steps = nav.steps;
    while (nav.step < steps.length - 1 && N.dist(state.pos, N.ll(steps[nav.step].maneuver.location)) < 15) nav.step++;
    var s = steps[nav.step], dNext = N.dist(state.pos, N.ll(s.maneuver.location)), instr = N.stepText(s);
    if (dNext <= 30 && !nav.announced[nav.step]) {
      nav.announced[nav.step] = true;
      speaker.say(s.maneuver.type === 'arrive' ? state.target.name + ' is just ahead.' : instr + ' now.');
      N.buzz([80, 60, 80]);
    }
    // More than 40 m off the route for three fixes → new route.
    var off = routeProgress(toLocal(state.pos)).off;
    nav.offCount = off > 40 && state.pos.acc < 35 ? nav.offCount + 1 : 0;
    if (nav.offCount >= 3 && Date.now() - nav.rerouteAt > 20000) { nav.route = null; requestRoute(false); }
  }

  // Text for the floating label: next instruction + distance.
  function labelText() {
    if (!state.pos) return ['Waiting for GPS…', state.gpsErr ? 'GPS: ' + state.gpsErr : 'Allow location access'];
    if (!state.target) return ['Finding street art…', ''];
    if (state.arrived) return ["You've arrived", state.target.name];
    if (nav.steps) {
      var s = nav.steps[nav.step];
      return [N.stepText(s), 'in ' + N.fmtDist(N.dist(state.pos, N.ll(s.maneuver.location))) + ' · ' + state.target.name];
    }
    return [state.target.name, N.fmtDist(N.dist(state.pos, state.target)) + ' · ' + state.routeMsg];
  }

  // ---------- Geometry ----------
  // Navigation pointer: a rounded arrowhead with a notched tail, smoothly bevelled.
  function arrowShape(k) {
    var s = new THREE.Shape();
    s.moveTo(0, 0.78 * k);
    s.quadraticCurveTo(0.04 * k, 0.78 * k, 0.07 * k, 0.72 * k);
    s.lineTo(0.52 * k, -0.3 * k);
    s.quadraticCurveTo(0.56 * k, -0.42 * k, 0.44 * k, -0.4 * k);
    s.lineTo(0.03 * k, -0.12 * k);
    s.quadraticCurveTo(0, -0.1 * k, -0.03 * k, -0.12 * k);
    s.lineTo(-0.44 * k, -0.4 * k);
    s.quadraticCurveTo(-0.56 * k, -0.42 * k, -0.52 * k, -0.3 * k);
    s.lineTo(-0.07 * k, 0.72 * k);
    s.quadraticCurveTo(-0.04 * k, 0.78 * k, 0, 0.78 * k);
    return s;
  }
  function arrowGeometry(k, depth) {
    var g = new THREE.ExtrudeGeometry(arrowShape(k), { depth: depth, curveSegments: 24, bevelEnabled: true,
      bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 6 });
    g.translate(0, 0, -depth / 2);
    g.rotateX(-Math.PI / 2);          // lies flat, tip pointing along -Z
    return g;
  }
  // Soft round glow (white; tinted per use), drawn additively.
  var glowTex = null;
  function glowTexture() {
    if (glowTex) return glowTex;
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
    return glowTex;
  }

  // ---------- Components ----------
  AFRAME.registerComponent('sp-arrow', {
    schema: { color: { type: 'color', default: '#ff3d7f' } },
    init: function () {
      // Glossy pink pointer with a white rim and a soft glow; tip raised ~35° towards you so it reads clearly.
      var tilt = new THREE.Group();
      var body = new THREE.Mesh(arrowGeometry(1, 0.1), new THREE.MeshStandardMaterial({
        color: this.data.color, emissive: this.data.color, emissiveIntensity: 0.65, roughness: 0.22, metalness: 0.15 }));
      var rim = new THREE.Mesh(arrowGeometry(1.13, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      rim.position.y = -0.05;
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: this.data.color, transparent: true,
        opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(1.6, 1.6, 1);
      glow.renderOrder = -1;
      tilt.add(glow, rim, body);
      tilt.rotation.x = 0.6;
      this.el.setObject3D('mesh', tilt);
    },
  });

  // Canvas text panel that always faces the camera (available for in-scene labels, e.g. the arrival beacon).
  AFRAME.registerComponent('sp-label', {
    schema: { width: { default: 1.6 } },
    init: function () {
      var c = this.canvas = document.createElement('canvas');
      c.width = 1024; c.height = 256;
      this.tex = new THREE.CanvasTexture(c);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false }));
      spr.renderOrder = 10;
      spr.scale.set(this.data.width, this.data.width / 4, 1);
      this.el.setObject3D('mesh', spr);
      this.last = '';
    },
    set: function (a, b) {
      var key = a + '|' + b;
      if (key === this.last) return;
      this.last = key;
      var g = this.canvas.getContext('2d');
      g.clearRect(0, 0, 1024, 256);
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.beginPath(); if (g.roundRect) g.roundRect(8, 8, 1008, 240, 48); else g.rect(8, 8, 1008, 240); g.fill();
      g.fillStyle = '#ff3d7f'; g.fillRect(8, 40, 14, 176);
      g.fillStyle = '#fff'; g.font = '700 72px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillText(a, 52, 112, 930);
      g.fillStyle = '#c9c9d4'; g.font = '500 54px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillText(b, 52, 192, 930);
      this.tex.needsUpdate = true;
    },
  });

  // Aligns #sp-world with north and with your GPS position (see the comment at the top).
  AFRAME.registerComponent('sp-world', {
    init: function () { this.dir = new THREE.Vector3(); this.v = new THREE.Vector3(); this.snap = true; this.user = { x: 0, z: 0 }; },
    tick: function (time, dtMs) {
      var cam = this.el.sceneEl.camera, o = this.el.object3D;
      if (!cam || !state.pos || !nav.origin) return;
      var dt = Math.min(0.5, (dtMs || 16) / 1000);
      cam.getWorldDirection(this.dir);
      var camYaw = Math.atan2(-this.dir.x, -this.dir.z), level = Math.abs(this.dir.y) < 0.85;

      // Which way is the camera facing? Compass first, then GPS course, then (demo/no sensors) the route.
      state.compass = compass.get();
      var heading = state.compass, src = 'compass';
      if (heading === null && state.pos.course !== null && state.pos.course !== undefined) { heading = state.pos.course; src = 'GPS course'; }
      if (heading === null && nav.pts && !state.orientEvents) {
        var u0 = toLocal(state.pos), p = routeAt(routeProgress(u0).s + GUIDE_LOOKAHEAD);
        heading = (Math.atan2(p.x - u0.x, -(p.z - u0.z)) * 180 / Math.PI + 360) % 360;   // compass bearing of the route ahead
        src = 'route (no sensors)';
      }
      state.headingSrc = heading === null ? '' : src;
      if (heading !== null && level) {
        var target = camYaw + heading * Math.PI / 180;
        if (this.snap) o.rotation.y = target; else o.rotation.y += angleDiff(target, o.rotation.y) * (1 - Math.exp(-dt / 0.6));
      }
      // Slide so your (route-snapped) position is under the camera.
      var u = userAnchor();
      this.user = u;
      this.v.set(u.x, 0, u.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.rotation.y);
      var tx = -this.v.x, tz = -this.v.z, ty = -EYE;
      if (this.snap) { o.position.set(tx, ty, tz); this.snap = heading === null; }
      else { var k = 1 - Math.exp(-dt / 0.2); o.position.x += (tx - o.position.x) * k; o.position.z += (tz - o.position.z) * k; o.position.y = ty; }
    },
  });

  // Pink dots on the pavement along the route, flowing forward, with a brighter pulse travelling ahead.
  AFRAME.registerComponent('sp-dots', {
    schema: { color: { type: 'color', default: '#ff3d7f' } },
    init: function () {
      // Each dot is a glossy pink bead on the pavement over a soft additive glow pool, so the trail reads
      // clearly in daylight and glows at night.
      var mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.25 });
      var glowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      var core = new THREE.SphereGeometry(0.15, 32, 16); core.scale(1, 0.6, 1); core.translate(0, 0.09, 0);
      var glow = new THREE.PlaneGeometry(1.1, 1.1); glow.rotateX(-Math.PI / 2); glow.translate(0, 0.01, 0);
      this.core = new THREE.InstancedMesh(core, mat, MAX_DOTS);
      this.glow = new THREE.InstancedMesh(glow, glowMat, MAX_DOTS);
      [this.core, this.glow].forEach(function (m) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; m.renderOrder = 2;
      });
      this.base = new THREE.Color(this.data.color);
      for (var i = 0; i < MAX_DOTS; i++) { this.core.setColorAt(i, this.base); this.glow.setColorAt(i, this.base); }
      this.el.object3D.add(this.glow, this.core);
      this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color();
    },
    tick: function (time) {
      var core = this.core, glow = this.glow;
      if (!nav.pts || !state.pos || state.arrived) { core.count = glow.count = 0; return; }
      var a = userAnchor(), t = time / 1000, s0 = a.s !== null ? a.s : routeProgress(toLocal(state.pos)).s, total = nav.cum[nav.cum.length - 1];
      var phase = (t * 1.1) % DOT_SPACING;          // dots creep forward along the path
      var pulse = (t * 9) % (DOT_RANGE + 12);       // a bright wave runs ahead every few seconds
      var n = 0;
      for (var k = 0; n < MAX_DOTS; k++) {
        var ahead = DOT_START + phase + k * DOT_SPACING;
        if (ahead > DOT_RANGE || s0 + ahead > total) break;
        var p = routeAt(s0 + ahead);
        var fade = 1 - ahead / DOT_RANGE;
        var wave = Math.max(0, 1 - Math.abs(ahead - pulse) / 2.5);
        var grow = Math.min(1, (ahead - DOT_START) / DOT_FADE_IN);   // dots grow in gently ahead of you
        var sc = (0.8 + 0.5 * wave + 0.25 * fade) * (0.25 + 0.75 * grow);
        this.m.compose(this.p.set(p.x, 0, p.z), this.q.identity(), this.s.set(sc, sc, sc));
        core.setMatrixAt(n, this.m); glow.setMatrixAt(n, this.m);
        this.c.copy(this.base).multiplyScalar(0.45 + 0.55 * fade).lerp(new THREE.Color(1, 1, 1), wave * 0.45);
        core.setColorAt(n, this.c); glow.setColorAt(n, this.c);
        n++;
      }
      core.count = glow.count = n;
      core.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
      if (core.instanceColor) core.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    },
  });

  // Pink arrow in the bottom third of the view, pointing along the route (or at the spot with no route).
  AFRAME.registerComponent('sp-pointer', {
    init: function () { this.dir = new THREE.Vector3(); this.p = new THREE.Vector3(); this.yaw = null; },
    tick: function (t) {
      var sceneEl = this.el.sceneEl, cam = sceneEl.camera, o = this.el.object3D;
      if (!cam) return;
      var camSys = sceneEl.systems['zappar-camera'];
      if (camSys && camSys.camera && camSys.camera.pipeline) state.cameraFrames = camSys.camera.pipeline.frameNumber();

      cam.getWorldPosition(this.p);
      cam.getWorldDirection(this.dir);
      // Sit in the bottom third of the screen, 3.2 m out along the view (never below the pavement), so you
      // can hold the phone low and tilted down while walking.
      var fovY = 2 * Math.atan(1 / cam.projectionMatrix.elements[5]);
      if (!isFinite(fovY) || fovY < 0.2) fovY = 1;
      // Direction through a point 32% of the way from the screen centre to the bottom edge.
      var ray = this.ray || (this.ray = new THREE.Vector3());
      ray.set(0, -0.32 * Math.tan(fovY / 2), -1).normalize().transformDirection(cam.matrixWorld);
      // Go 3.2 m along it, or less if that would be under the pavement; scale with distance so the arrow
      // keeps the same size on screen.
      var d = 3.2;
      if (ray.y < -0.01) d = Math.min(d, (EYE - 0.35) / -ray.y);
      d = Math.max(d, 1.2);
      o.position.set(this.p.x + ray.x * d, this.p.y + ray.y * d + Math.sin(t / 450) * 0.02 * d, this.p.z + ray.z * d);
      o.scale.setScalar(d / 3.2);
      this.dir.y = 0;
      if (this.dir.lengthSq() < 1e-4) this.dir.set(0, 0, -1); else this.dir.normalize();
      var camYaw = Math.atan2(-this.dir.x, -this.dir.z);

      var arrow = this.el.querySelector('[sp-arrow]').object3D;
      var worldEl = sceneEl.querySelector('[sp-world]');
      if (!state.pos || !state.target || !state.headingSrc || state.arrived || !nav.origin) { arrow.visible = false; state.rel = null; return; }

      // Where to point, in the world's local frame, then into scene space via the world's rotation.
      var u = userAnchor(), aim;
      if (nav.pts) aim = routeAt((u.s !== null ? u.s : routeProgress(u).s) + GUIDE_LOOKAHEAD);
      else aim = toLocal(state.target);
      var yaw = Math.atan2(-(aim.x - u.x), -(aim.z - u.z)) + worldEl.object3D.rotation.y;
      this.yaw = this.yaw === null ? yaw : this.yaw + angleDiff(yaw, this.yaw) * 0.15;
      arrow.visible = true;
      arrow.rotation.set(0, this.yaw, 0);
      state.rel = -angleDiff(this.yaw, camYaw) * 180 / Math.PI;
    },
  });

  // ---------- Status panel ----------
  function row(id, ok, text) {
    var el = $(id);
    el.querySelector('.v').textContent = text;
    el.className = ok === true ? 'ok' : ok === false ? 'bad' : 'wait';
  }
  function updateStatus() {
    var Z = window.ZapparAFrame, ZT = Z && Z.ZapparThreeForAFrame, appClip = null;
    try { appClip = Z && Z.isAppClip ? Z.isAppClip() : null; } catch (e) { appClip = null; }
    row('st-zappar', !!Z, Z ? 'loaded' + (ZT && ZT.browserIncompatible() ? ' · browser NOT supported' : '') + (appClip === true ? ' · inside App Clip' : appClip === false ? ' · in browser' : '') : 'not loaded');
    var sc = document.querySelector('a-scene'), camSys = sc && sc.systems['zappar-camera'], perm = camSys && camSys.permissionGranted;
    row('st-camera', state.cameraFrames > 0 ? true : perm === false ? false : null,
      state.cameraFrames > 0 ? 'running (' + state.cameraFrames + ' frames)' : perm === undefined ? 'waiting for permission' : perm ? 'permission OK, no frames yet' : 'permission denied');
    row('st-motion', state.orientEvents > 0 ? true : null, state.orientEvents > 0 ? state.orientEvents + ' sensor readings' : 'no readings yet');
    row('st-compass', state.compass !== null ? true : state.headingSrc ? null : false,
      state.compass !== null ? Math.round(state.compass) + '°' : state.headingSrc ? 'using ' + state.headingSrc : 'none');
    row('st-gps', state.pos ? true : state.gpsErr ? false : null,
      state.pos ? (state.pos.demo ? 'demo walk' : '±' + Math.round(state.pos.acc) + ' m') : state.gpsErr ? state.gpsErr : 'waiting');
    row('st-route', nav.route ? true : null, state.arrived ? 'arrived' : state.routeMsg);
    row('st-target', state.target && state.pos ? true : null, state.target ? state.target.name + (state.pos ? ' · ' + N.fmtDist(N.dist(state.pos, state.target)) : '') : 'nearest spot');
    var txt = labelText();
    if ($('instr-1').textContent !== txt[0]) $('instr-1').textContent = txt[0];
    if ($('instr-2').textContent !== txt[1]) $('instr-2').textContent = txt[1];
    $('arrow2d').style.transform = 'rotate(' + (state.rel || 0) + 'deg)';
    $('arrow2d').style.opacity = state.rel === null ? 0.25 : 1;
    $('compass-btn').classList.toggle('hidden', state.orientEvents > 0);
    $('compass-hint').classList.toggle('hidden', state.orientEvents > 0 || !$('status').classList.contains('collapsed'));
    $('story').classList.toggle('hidden', !state.arrived);
    $('demo-badge').classList.toggle('hidden', !demo);
    if (state.arrived && state.target) $('story').textContent = state.target.blurb;
  }
  setInterval(updateStatus, 300);
  setInterval(onPosition, 1000);       // keep step tracking ticking even without new fixes

  document.addEventListener('DOMContentLoaded', function () {
    $('compass-btn').onclick = hookCompass;
    $('compass-hint').onclick = hookCompass;
    // iOS (and Zappar's App Clip) only give compass readings after a tap: ask on the first tap anywhere.
    document.addEventListener('click', function once() {
      if (state.orientEvents === 0) hookCompass();
      if (state.orientEvents > 0) document.removeEventListener('click', once);
    });
    $('status-toggle').onclick = function () {
      var c = $('status').classList.toggle('collapsed');
      $('status-toggle').textContent = c ? 'Show' : 'Hide';
    };
    $('back').href = 'index.html?nosplash=1' + (demo ? '&demo=1' : '');
    $('real-gps').onclick = function () {
      try { localStorage.setItem('spraypath.demo', 'false'); } catch (e) {}
      location.href = 'ar.html' + (state.target ? '?spot=' + encodeURIComponent(state.target.id) : '');
    };
    window.sprayReady = true;
  });
})();
