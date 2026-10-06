// SprayPath AR (milestone 1): Zappar camera + one arrow pointing at the chosen street art spot,
// with a status panel so we can see what works on a real phone.
// Load after A-Frame, Zappar for A-Frame, spots.js and nav.js, and before the <a-scene>.
(function () {
  'use strict';
  var N = window.NAV, THREE = AFRAME.THREE;
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Shared state ----------
  var state = {
    pos: null, gpsErr: '', target: null, compass: null, compassSrc: '', orientEvents: 0,
    cameraFrames: 0, firstFrame: false, rel: null,
  };
  window.sprayState = state;

  // Target: ?spot=id, else nearest spot once GPS is known.
  var spotById = {};
  window.SPOTS.forEach(function (s) { spotById[s.id] = s; });
  if (spotById[params.get('spot')]) state.target = spotById[params.get('spot')];

  // Position: GPS, or a fixed demo position passed from the map page.
  if (params.has('demo') && params.get('lat')) {
    state.pos = { lat: +params.get('lat'), lng: +params.get('lng'), acc: 5, demo: true };
  } else if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(function (g) {
      state.pos = { lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy,
        course: g.coords.speed > 0.6 && isFinite(g.coords.heading) ? g.coords.heading : null };
      state.gpsErr = '';
    }, function (e) { state.gpsErr = e.message || 'denied'; }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  } else state.gpsErr = 'not available';

  // Compass: heading of the back camera (iOS webkitCompassHeading, Android absolute orientation).
  var compass = N.createCompass();
  function hookCompass() { compass.enable(); }
  hookCompass();
  addEventListener('deviceorientation', function (e) { if (e.alpha !== null || typeof e.webkitCompassHeading === 'number') state.orientEvents++; });
  addEventListener('deviceorientationabsolute', function (e) { if (e.alpha !== null) state.orientEvents++; });

  // ---------- Components ----------
  function arrowGeometry() {
    var s = new THREE.Shape();
    s.moveTo(0, 0.7); s.lineTo(0.42, 0.15); s.lineTo(0.17, 0.15); s.lineTo(0.17, -0.5);
    s.lineTo(-0.17, -0.5); s.lineTo(-0.17, 0.15); s.lineTo(-0.42, 0.15); s.closePath();
    var g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    g.translate(0, 0, -0.06);
    g.rotateX(-Math.PI / 2);          // lies flat, tip pointing along -Z
    return g;
  }
  AFRAME.registerComponent('sp-arrow', {
    schema: { color: { type: 'color', default: '#ff3d7f' } },
    init: function () {
      this.el.setObject3D('mesh', new THREE.Mesh(arrowGeometry(), new THREE.MeshStandardMaterial({
        color: this.data.color, emissive: this.data.color, emissiveIntensity: 0.5, roughness: 0.4 })));
    },
  });

  // Canvas text panel that always faces the camera.
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

  // Keeps itself ~3 m in front of the camera and turns its arrow toward the target.
  AFRAME.registerComponent('sp-pointer', {
    init: function () { this.dir = new THREE.Vector3(); this.p = new THREE.Vector3(); this.yaw = null; },
    tick: function (t) {
      var cam = this.el.sceneEl.camera, o = this.el.object3D;
      if (!cam) return;
      var camSys = this.el.sceneEl.systems['zappar-camera'];
      if (camSys && camSys.camera && camSys.camera.pipeline) state.cameraFrames = camSys.camera.pipeline.frameNumber();

      // Pick the nearest spot if none was chosen.
      if (!state.target && state.pos) {
        state.target = window.SPOTS.reduce(function (a, b) { return N.dist(state.pos, b) < N.dist(state.pos, a) ? b : a; });
      }
      state.compass = compass.get();
      var heading = state.compass !== null ? state.compass : (state.pos && state.pos.course !== null && state.pos.course !== undefined ? state.pos.course : null);
      state.compassSrc = state.compass !== null ? 'compass' : heading !== null ? 'GPS course' : '';

      cam.getWorldPosition(this.p);
      cam.getWorldDirection(this.dir);
      var fy = this.dir.y; this.dir.y = 0;
      if (this.dir.lengthSq() < 1e-4) this.dir.set(0, 0, -1); else this.dir.normalize();
      o.position.set(this.p.x + this.dir.x * 3, this.p.y - 0.6 + Math.sin(t / 450) * 0.04, this.p.z + this.dir.z * 3);

      var label = this.el.querySelector('[sp-label]').components['sp-label'];
      var arrow = this.el.querySelector('[sp-arrow]').object3D;
      if (!state.target || !state.pos) { arrow.visible = false; label.set('Waiting for GPS…', state.gpsErr ? 'GPS: ' + state.gpsErr : 'Allow location access'); state.rel = null; return; }
      var d = N.dist(state.pos, state.target), b = N.bearing(state.pos, state.target);
      if (heading === null) {
        arrow.visible = false; state.rel = null;
        label.set(state.target.name, N.fmtDist(d) + ' to the ' + N.compassWord(b) + ' · no compass yet');
        return;
      }
      arrow.visible = true;
      state.rel = N.normAngle(b - heading);
      // Camera yaw in scene space; turning clockwise by rel means a negative three.js yaw.
      var camYaw = Math.atan2(-this.dir.x, -this.dir.z);
      var yaw = camYaw - state.rel * Math.PI / 180;
      this.yaw = this.yaw === null ? yaw : this.yaw + Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * 0.2;
      arrow.rotation.set(0, this.yaw - camYaw, 0);   // arrow is a child of a group that follows the camera's yaw
      o.rotation.set(0, camYaw, 0);
      label.set(state.target.name, N.fmtDist(d) + (Math.abs(state.rel) > 60 ? (state.rel > 0 ? ' · turn right' : ' · turn left') : ' · ahead'));
      void fy;
    },
  });

  // ---------- Status panel ----------
  function row(id, ok, text) {
    var el = $(id);
    el.querySelector('.v').textContent = text;
    el.className = ok === true ? 'ok' : ok === false ? 'bad' : 'wait';
  }
  function updateStatus() {
    var Z = window.ZapparAFrame, ZT = Z && Z.ZapparThreeForAFrame;
    var appClip = null;
    try { appClip = Z && Z.isAppClip ? Z.isAppClip() : null; } catch (e) { appClip = null; }
    row('st-zappar', !!Z, Z ? 'loaded' + (ZT && ZT.browserIncompatible() ? ' · browser NOT supported' : '') + (appClip === true ? ' · inside App Clip' : appClip === false ? ' · in browser' : '') : 'not loaded');
    var camSys = document.querySelector('a-scene') && document.querySelector('a-scene').systems['zappar-camera'];
    var perm = camSys && camSys.permissionGranted;
    row('st-camera', state.cameraFrames > 0 ? true : perm === false ? false : null,
      state.cameraFrames > 0 ? 'running (' + state.cameraFrames + ' frames)' : perm === undefined ? 'waiting for permission' : perm ? 'permission OK, no frames yet' : 'permission denied');
    row('st-motion', state.orientEvents > 0 ? true : null, state.orientEvents > 0 ? state.orientEvents + ' sensor readings' : 'no readings yet');
    row('st-compass', state.compass !== null ? true : state.compassSrc ? null : false,
      state.compass !== null ? Math.round(state.compass) + '°' : state.compassSrc ? 'using ' + state.compassSrc : 'none');
    row('st-gps', state.pos ? true : state.gpsErr ? false : null,
      state.pos ? (state.pos.demo ? 'demo position' : '±' + Math.round(state.pos.acc) + ' m') : state.gpsErr ? state.gpsErr : 'waiting');
    row('st-target', state.target && state.pos ? true : null, state.target ? state.target.name + (state.pos ? ' · ' + N.fmtDist(N.dist(state.pos, state.target)) : '') : 'nearest spot');
    // 2D arrow mirrors the 3D one, so direction works even if 3D content can't be seen.
    $('arrow2d').style.transform = 'rotate(' + (state.rel || 0) + 'deg)';
    $('arrow2d').style.opacity = state.rel === null ? 0.25 : 1;
    $('compass-btn').classList.toggle('hidden', state.orientEvents > 0);
  }
  setInterval(updateStatus, 300);

  document.addEventListener('DOMContentLoaded', function () {
    $('compass-btn').onclick = hookCompass;
    $('status-toggle').onclick = function () { $('status').classList.toggle('collapsed'); };
    $('back').href = 'index.html' + (params.has('demo') ? '?demo=1' : '');
    var cam = document.getElementById('cam');
    if (cam) cam.addEventListener('first-frame', function () { state.firstFrame = true; });
    window.sprayReady = true;
  });
})();
