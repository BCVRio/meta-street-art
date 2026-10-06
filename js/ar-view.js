// SprayPath AR, built on A-Frame.
//
// Location-based AR: the camera's rotation comes from the phone's motion sensors (A-Frame
// look-controls "magic window"), and the street content lives in the #sp-world entity, whose
// local frame is east = +X, north = -Z, pavement at y = 0, origin at the first GPS fix.
// Each frame the `spraypath` system
//   1. rotates #sp-world so its -Z axis lines up with true north (compass vs camera yaw), and
//   2. slides it so the user's GPS position sits under the camera.
// On Android phones with WebXR, "floor lock" switches A-Frame into AR mode so ARCore tracks the
// camera and the arrows stay put on the pavement between GPS fixes.
//
// Requires A-Frame (global AFRAME) to be loaded before this module.
import { toEN, rad } from './nav-core.js';

const AFRAME = window.AFRAME;
const THREE = AFRAME.THREE;
const UP = new THREE.Vector3(0, 1, 0);
const PINK = new THREE.Color(0xff3d7f);
const CHEVRON_SPACING = 2.5, CHEVRON_RANGE = 45, MAX_CHEVRONS = 24;
const BEACON_NEAR = 70;          // beacons further than this are drawn at this distance, scaled to match

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ---------- Geometry helpers ----------
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.6); s.lineTo(0.55, -0.05); s.lineTo(0.3, -0.05); s.lineTo(0, 0.3);
  s.lineTo(-0.3, -0.05); s.lineTo(-0.55, -0.05); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);          // shape +Y → -Z (forward), lying on the ground
  return g;
}
function arrowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.7); s.lineTo(0.42, 0.15); s.lineTo(0.17, 0.15); s.lineTo(0.17, -0.5);
  s.lineTo(-0.17, -0.5); s.lineTo(-0.17, 0.15); s.lineTo(-0.42, 0.15); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -0.06);
  g.rotateX(-Math.PI / 2);
  return g;
}
function fit(g, t, max) {
  if (g.measureText(t).width <= max) return t;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

// ---------- System: shared state, north alignment, GPS anchoring ----------
AFRAME.registerSystem('spraypath', {
  init() {
    this.origin = null;          // first GPS fix: origin of the world frame
    this.gps = null;
    this.route = null;           // { latlngs, pts: Vector2[] (x = east, y = -north), cum: number[] }
    this.destLatLng = null;
    this.dest = null;            // Vector2, world-local
    this.destName = '';
    this.label = ['', ''];
    this.celebrating = false;
    this.facingHint = null;      // walking direction (deg), used when there are no motion sensors
    this.compass = null;
    this.northKnown = false;
    this.snap = true;            // jump (rather than glide) the world into place next frame
    this.hasSensors = false;
    this.user = new THREE.Vector2();      // user's position in the world-local frame
    this.camPos = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);  // camera's horizontal forward direction
    this.guideYaw = null;
    this._dir = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.look = { lastYaw: null, draggedAt: 0 };

    addEventListener('deviceorientation', (e) => { if (e.alpha !== null) this.hasSensors = true; });
    this.el.addEventListener('enter-vr', () => {
      if (!this.el.is('ar-mode')) return;
      this.snap = true; this.northKnown = false;
      this.onXRChange?.(true);
    });
    this.el.addEventListener('exit-vr', () => { this.snap = true; this.northKnown = false; this.onXRChange?.(false); });
  },

  // (Plain methods, not getters: A-Frame copies system definitions, which would evaluate getters early.)
  isXR() { return this.el.is('ar-mode'); },
  getCamera() { return this.isXR() ? this.el.renderer.xr.getCamera() : this.el.camera; },

  // ----- Inputs from the app -----
  setPosition(p) {
    this.gps = p;
    if (!this.origin) {
      this.origin = { lat: p.lat, lng: p.lng };
      if (this.route) this.setRoute(this.route.latlngs);
      if (this.destLatLng) this.setDestination(this.destLatLng, this.destName);
    }
  },
  setRoute(latlngs) {
    if (!latlngs || latlngs.length < 2) { this.route = null; return; }
    if (!this.origin) { this.route = { latlngs }; return; }
    const pts = latlngs.map((p) => { const { e, n } = toEN(p, this.origin); return new THREE.Vector2(e, -n); });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.route = { latlngs, pts, cum };
  },
  setDestination(p, name = '') {
    this.destLatLng = p;
    this.destName = name;
    if (!p) { this.dest = null; return; }
    if (this.origin) { const { e, n } = toEN(p, this.origin); this.dest = new THREE.Vector2(e, -n); }
  },
  setLabel(line1, line2) { this.label = [line1, line2]; },
  setFacingHint(deg) { this.facingHint = deg; },
  celebrate(on) { this.celebrating = on; this.el.emit('sp-celebrate', { on }); },

  showNav() { return !this.celebrating && !!this.gps && !!this.origin; },

  // ----- Route helpers (world-local) -----
  routeProgress(u) {
    const { pts, cum } = this.route;
    let best = Infinity, s0 = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
      const t = len2 ? Math.max(0, Math.min(1, ((u.x - a.x) * abx + (u.y - a.y) * aby) / len2)) : 0;
      const d = Math.hypot(a.x + abx * t - u.x, a.y + aby * t - u.y);
      if (d < best) { best = d; s0 = cum[i - 1] + t * (cum[i] - cum[i - 1]); }
    }
    return s0;
  },
  routeAt(s) {
    const { pts, cum } = this.route;
    s = Math.max(0, Math.min(s, cum[cum.length - 1]));
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, yaw: Math.atan2(-(b.x - a.x), -(b.y - a.y)) };
  },

  // Signed angle (degrees, clockwise) from the camera's view to where the guide arrow points.
  relativeGuideAngle() {
    if (this.guideYaw === null) return null;
    const d = this.getCamera().getWorldDirection(this._dir);
    return -angleDiff(this.guideYaw, Math.atan2(-d.x, -d.z)) * 180 / Math.PI;
  },

  // ----- Per frame (systems tick before components) -----
  tick() {
    const world = this.worldEl?.object3D;
    if (!world) return;
    const cam = this.getCamera();
    if (!this.isXR()) this.steerWithoutSensors();
    this.updateNorth(cam, world);
    this.updateAnchor(cam, world);

    cam.getWorldPosition(this.camPos);
    const local = world.worldToLocal(this._v.copy(this.camPos));
    this.user.set(local.x, local.z);
    const f = cam.getWorldDirection(this._dir); f.y = 0;
    if (f.lengthSq() > 1e-4) this.camFwd.copy(f.normalize());
  },

  // Desktop / no motion sensors: face the walking direction unless the user dragged recently.
  steerWithoutSensors() {
    if (this.hasSensors) return;
    const lc = this.el.camera?.el?.components['look-controls'];
    if (!lc?.yawObject) return;
    const yawObj = lc.yawObject;
    if (this.look.lastYaw !== null && Math.abs(yawObj.rotation.y - this.look.lastYaw) > 1e-4) this.look.draggedAt = performance.now();
    if (this.look.lastYaw === null) lc.pitchObject.rotation.x = -0.18;
    if (this.facingHint !== null && performance.now() - this.look.draggedAt > 4000) {
      const target = this.worldEl.object3D.rotation.y - rad(this.facingHint);
      yawObj.rotation.y += angleDiff(target, yawObj.rotation.y) * 0.08;
    }
    this.look.lastYaw = yawObj.rotation.y;
  },

  // Rotate the world so its -Z axis points at true north.
  updateNorth(cam, world) {
    const H = this.compass?.get();
    if (H === null || H === undefined) return;
    const d = cam.getWorldDirection(this._dir);
    if (Math.abs(d.y) > 0.85) return;                    // looking at the ground/sky: yaw unreliable
    const target = Math.atan2(-d.x, -d.z) + rad(H);
    if (!this.northKnown || this.snap) { world.rotation.y = target; this.northKnown = true; }
    else world.rotation.y += angleDiff(target, world.rotation.y) * 0.03;
  },

  // Slide the world so the user's GPS position sits under the camera.
  updateAnchor(cam, world) {
    if (!this.gps || !this.origin) return;
    const { e, n } = toEN(this.gps, this.origin);
    const v = this._v.set(e, 0, -n).applyAxisAngle(UP, world.rotation.y);
    const p = cam.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(p.x - v.x, 0, p.z - v.z);
    if (this.snap) { world.position.copy(target); this.snap = false; }
    // In floor-lock mode ARCore tracking is smoother than GPS, so only drift slowly towards GPS.
    else world.position.lerp(target, this.isXR() ? 0.01 : 0.08);
  },
});

// ---------- Components ----------

// Marks the street-content root; the system moves/rotates it.
AFRAME.registerComponent('sp-world', {
  init() { this.el.sceneEl.systems.spraypath.worldEl = this.el; },
});

// Canvas text panel (sprite). Usage: sp-label="accent: #3dd6ff; width: 5; source: dest"
AFRAME.registerComponent('sp-label', {
  schema: { accent: { default: '#ff3d7f' }, width: { default: 1.5 }, source: { default: 'guide', oneOf: ['guide', 'dest'] } },
  init() {
    const c = this.canvas = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false }));
    spr.renderOrder = 10;
    spr.scale.set(this.data.width, this.data.width / 4, 1);
    this.el.setObject3D('mesh', spr);
    this.last = '';
  },
  draw(line1, line2) {
    const key = line1 + '|' + line2;
    if (key === this.last) return;
    this.last = key;
    const g = this.canvas.getContext('2d'), w = 1024, h = 256;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.beginPath();
    if (g.roundRect) g.roundRect(8, 8, w - 16, h - 16, 48); else g.rect(8, 8, w - 16, h - 16);
    g.fill();
    g.fillStyle = this.data.accent; g.fillRect(8, 40, 14, h - 80);
    g.fillStyle = '#fff'; g.font = '700 72px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(fit(g, line1, w - 90), 52, 112);
    g.fillStyle = '#c9c9d4'; g.font = '500 54px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(fit(g, line2 || '', w - 90), 52, 192);
    this.tex.needsUpdate = true;
  },
  tick() {
    const sys = this.el.sceneEl.systems.spraypath;
    if (this.data.source === 'guide') this.draw(sys.label[0], sys.label[1]);
    else if (sys.dest) {
      const d = Math.hypot(sys.dest.x - sys.user.x, sys.dest.y - sys.user.y);
      this.draw(sys.destName || 'Street art', d < 1000 ? `${Math.round(d / 5) * 5} m` : `${(d / 1000).toFixed(1)} km`);
    }
  },
});

// Pink chevrons flowing along the walking route on the pavement.
AFRAME.registerComponent('sp-chevrons', {
  schema: { color: { type: 'color', default: '#ff3d7f' } },
  init() {
    const m = this.mesh = new THREE.InstancedMesh(chevronGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      MAX_CHEVRONS);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.Color(this.data.color);
    for (let i = 0; i < MAX_CHEVRONS; i++) m.setColorAt(i, this.color);
    m.count = 0;
    m.frustumCulled = false;
    this.el.setObject3D('mesh', m);
    this.mat = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.c = new THREE.Color();
    this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
  },
  tick(time) {
    const sys = this.el.sceneEl.systems.spraypath, m = this.mesh;
    if (!sys.showNav() || !sys.route?.pts) { m.count = 0; return; }
    const s0 = sys.routeProgress(sys.user);
    const total = sys.route.cum[sys.route.cum.length - 1];
    const phase = (time / 1000 * 1.4) % CHEVRON_SPACING;
    let n = 0;
    for (let k = 0; n < MAX_CHEVRONS; k++) {
      const ahead = 1.5 + phase + k * CHEVRON_SPACING;
      if (ahead > CHEVRON_RANGE || s0 + ahead > total) break;
      const p = sys.routeAt(s0 + ahead);
      const fade = 1 - ahead / CHEVRON_RANGE, sc = 0.9 + 0.3 * fade;
      this.mat.compose(this.p.set(p.x, 0.03, p.y), this.q.setFromAxisAngle(UP, p.yaw), this.s.set(sc, 1, sc));
      m.setMatrixAt(n, this.mat);
      m.setColorAt(n, this.c.copy(this.color).multiplyScalar(0.35 + 0.65 * fade));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  },
});

// The 3D arrow shape (used inside sp-guide).
AFRAME.registerComponent('sp-arrow-mesh', {
  schema: { color: { type: 'color', default: '#ff3d7f' } },
  init() {
    this.el.setObject3D('mesh', new THREE.Mesh(arrowGeometry(), new THREE.MeshStandardMaterial({
      color: this.data.color, emissive: this.data.color, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.1 })));
  },
});

// Floating guide arrow ~4 m ahead of the user, pointing ~20 m further along the route.
AFRAME.registerComponent('sp-guide', {
  schema: { distance: { default: 4 }, drop: { default: 0.8 }, lookAhead: { default: 20 } },
  tick(time) {
    const sys = this.el.sceneEl.systems.spraypath, o = this.el.object3D;
    o.visible = sys.showNav() && (!!sys.route?.pts || !!sys.dest);
    if (!o.visible) { sys.guideYaw = null; return; }
    let tx, ty;
    if (sys.route?.pts) { const p = sys.routeAt(sys.routeProgress(sys.user) + this.data.lookAhead); tx = p.x; ty = p.y; }
    else { tx = sys.dest.x; ty = sys.dest.y; }
    const yaw = Math.atan2(-(tx - sys.user.x), -(ty - sys.user.y)) + sys.worldEl.object3D.rotation.y;
    sys.guideYaw = sys.guideYaw === null ? yaw : sys.guideYaw + angleDiff(yaw, sys.guideYaw) * 0.15;
    const { camPos, camFwd } = sys, d = this.data.distance;
    o.position.set(camPos.x + camFwd.x * d, camPos.y - this.data.drop + Math.sin(time / 1000 * 2.2) * 0.05, camPos.z + camFwd.z * d);
    o.rotation.set(0, sys.guideYaw, 0);
  },
});

// Light-pillar beacon over the artwork; keeps the same on-screen size at any distance.
AFRAME.registerComponent('sp-beacon', {
  tick(time) {
    const sys = this.el.sceneEl.systems.spraypath, o = this.el.object3D;
    o.visible = sys.showNav() && !!sys.dest;
    if (!o.visible) return;
    const dx = sys.dest.x - sys.user.x, dy = sys.dest.y - sys.user.y, d = Math.hypot(dx, dy);
    const k = d > BEACON_NEAR ? BEACON_NEAR / d : 1;
    o.position.set(sys.user.x + dx * k, 0, sys.user.y + dy * k);
    o.scale.setScalar(Math.max(0.45, Math.min(d, BEACON_NEAR) / 30));   // children are sized for 30 m away
    const orb = this.el.querySelector('.sp-orb');
    if (orb) orb.object3D.position.y = 6.4 + Math.sin(time / 1000 * 2) * 0.2;
  },
});

// Arrival celebration: spinning frame + confetti in front of the camera.
AFRAME.registerComponent('sp-party', {
  schema: { count: { default: 80 } },
  init() {
    const cols = [0xff3d7f, 0x3dd6ff, 0x4dff9a, 0xffd23d, 0xb46bff];
    this.bits = [];
    for (let i = 0; i < this.data.count; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.13),
        new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      p.userData.v = new THREE.Vector3();
      p.userData.spin = Math.random() * 0.2;
      this.el.object3D.add(p); this.bits.push(p);
    }
    this.el.object3D.visible = false;
    this.el.sceneEl.addEventListener('sp-celebrate', (e) => {
      this.el.object3D.visible = e.detail.on;
      if (e.detail.on) for (const p of this.bits) {
        p.position.set(0, 0, 0);
        p.userData.v.set((Math.random() - 0.5) * 0.06, 0.03 + Math.random() * 0.06, (Math.random() - 0.5) * 0.06);
      }
    });
  },
  tick(time) {
    if (!this.el.object3D.visible) return;
    const sys = this.el.sceneEl.systems.spraypath, o = this.el.object3D;
    o.position.set(sys.camPos.x + sys.camFwd.x * 3, sys.camPos.y - 0.2, sys.camPos.z + sys.camFwd.z * 3);
    const frame = this.el.querySelector('.sp-frame');
    if (frame) frame.object3D.rotation.y = time / 1000 * 1.2;
    for (const p of this.bits) {
      p.position.add(p.userData.v);
      p.userData.v.y -= 0.0022;
      p.rotation.x += p.userData.spin; p.rotation.y += p.userData.spin;
      if (p.position.y < -1.4) { p.position.set(0, 0, 0); p.userData.v.y = 0.03 + Math.random() * 0.06; }
    }
  },
});

// Sets the camera's field of view to roughly match a phone's main camera shown full-screen.
AFRAME.registerComponent('sp-camera-fov', {
  init() {
    this.onResize = () => {
      if (this.el.sceneEl.is('ar-mode')) return;
      this.el.setAttribute('camera', 'fov', innerHeight >= innerWidth ? 63 : 42);
    };
    addEventListener('resize', this.onResize);
    this.onResize();
  },
  remove() { removeEventListener('resize', this.onResize); },
});

// ---------- Scene markup ----------
// Edit the look of the beacon, arrow and celebration here.
const SCENE_HTML = `
<a-scene embedded class="sp-scene" spraypath
  renderer="alpha: true; antialias: true; colorManagement: true"
  xr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false" loading-screen="enabled: false"
  webxr="requiredFeatures: local-floor; optionalFeatures: dom-overlay; overlayElement: #ar-overlay">
  <a-entity light="type: hemisphere; color: #ffffff; groundColor: #444466; intensity: 2.2"></a-entity>
  <a-entity light="type: directional; color: #ffffff; intensity: 1.4" position="2 5 3"></a-entity>

  <a-entity id="sp-camera" camera="near: 0.05; far: 800" sp-camera-fov
    look-controls="touchEnabled: false; magicWindowTrackingEnabled: true" position="0 1.6 0"></a-entity>

  <a-entity id="sp-world" sp-world>
    <a-entity sp-chevrons="color: #ff3d7f"></a-entity>
    <a-entity sp-beacon>
      <a-cylinder radius="0.3" height="6" position="0 3 0" open-ended="true"
        material="shader: flat; color: #3dd6ff; opacity: 0.45; transparent: true; side: double"></a-cylinder>
      <a-sphere class="sp-orb" radius="0.55" position="0 6.4 0" material="shader: flat; color: #3dd6ff"></a-sphere>
      <a-entity sp-label="accent: #3dd6ff; width: 5; source: dest" position="0 7.8 0"></a-entity>
    </a-entity>
  </a-entity>

  <a-entity sp-guide>
    <a-entity sp-arrow-mesh="color: #ff3d7f" rotation="20 0 0" scale="0.6 0.6 0.6"></a-entity>
    <a-entity sp-label="width: 1.5" position="0 0.75 0"></a-entity>
  </a-entity>

  <a-entity sp-party>
    <a-torus class="sp-frame" radius="0.9" radius-tubular="0.06" segments-radial="12" segments-tubular="4" rotation="0 0 45"
      material="color: #ffd23d; emissive: #ffd23d; emissiveIntensity: 0.6"></a-torus>
  </a-entity>
</a-scene>`;

// ---------- Wrapper used by app.js ----------
export class ARView {
  constructor({ container, video, compass }) {
    this.video = video;
    video.insertAdjacentHTML('afterend', SCENE_HTML);   // scene draws over the camera feed
    this.sceneEl = container.querySelector('a-scene');
    this.ready = new Promise((resolve) => {
      if (this.sceneEl.hasLoaded) resolve(); else this.sceneEl.addEventListener('loaded', resolve, { once: true });
    }).then(() => {
      this.sys = this.sceneEl.systems.spraypath;
      this.sys.compass = compass;
      this.sys.onXRChange = (on) => {
        this.video.style.visibility = on ? 'hidden' : '';
        this.onXRChange?.(on);
      };
    });
  }

  async start() {
    await this.ready;
    this.sceneEl.play();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      return true;
    } catch { return false; }
  }
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.sceneEl.is('ar-mode')) this.sceneEl.exitVR();
    this.sceneEl.pause();
  }

  get xr() { return this.sceneEl.is('ar-mode'); }
  async xrSupported() {
    try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
  }
  enterXR() { return this.sceneEl.enterAR(); }
  exitXR() { return this.sceneEl.exitVR(); }

  setPosition(p) { this.sys?.setPosition(p); }
  setRoute(r) { this.sys?.setRoute(r); }
  setDestination(p, name) { this.sys?.setDestination(p, name); }
  setLabel(a, b) { this.sys?.setLabel(a, b); }
  setFacingHint(h) { this.sys?.setFacingHint(h); }
  celebrate(on) { this.sys?.celebrate(on); }
  relativeGuideAngle() { return this.sys?.relativeGuideAngle() ?? null; }
}
