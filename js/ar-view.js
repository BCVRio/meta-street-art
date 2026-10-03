// Location-based AR view: three.js over the phone camera, placed with GPS + compass.
//
// The "world" group holds everything that lives on the street. Its local frame is
// east = +X, north = -Z, pavement at y = 0, origin at the first GPS fix. Each frame we
//   1. rotate the world so its -Z axis lines up with true north (compass vs camera yaw), and
//   2. slide it so the user's GPS position sits under the camera.
// In normal mode the camera's rotation comes from the phone's motion sensors. On Android
// phones with WebXR, "floor-locked" mode lets ARCore track the camera instead, so the
// arrows stay put on the pavement between GPS fixes.
import * as THREE from 'three';
import { toEN, rad } from './nav-core.js';

const EYE = 1.5;                 // assumed phone height above the pavement, metres
const UP = new THREE.Vector3(0, 1, 0);
const PINK = new THREE.Color(0xff3d7f), CYAN = 0x3dd6ff, GOLD = 0xffd23d;
const CHEVRON_SPACING = 2.5, CHEVRON_RANGE = 45, MAX_CHEVRONS = 24;
const BEACON_NEAR = 70;          // beacons further than this are drawn at this distance, scaled up

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// Device orientation → camera quaternion (as in three.js's former DeviceOrientationControls).
const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler();
const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
function orientationQuaternion(q, alpha, beta, gamma, screenAngle) {
  euler.set(beta, alpha, -gamma, 'YXZ');
  q.setFromEuler(euler);
  q.multiply(q1);                                     // camera looks out of the back of the phone
  q.multiply(q0.setFromAxisAngle(zee, -screenAngle)); // adjust for screen rotation
}

function textSprite(w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.renderOrder = 10;
  let last = '';
  spr.userData.draw = (line1, line2, accent = '#ff3d7f') => {
    const key = line1 + '|' + line2 + accent;
    if (key === last) return;
    last = key;
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.62)';
    g.beginPath();
    if (g.roundRect) g.roundRect(8, 8, w - 16, h - 16, 48); else g.rect(8, 8, w - 16, h - 16);
    g.fill();
    g.fillStyle = accent; g.fillRect(8, 40, 14, h - 80);
    g.fillStyle = '#fff'; g.font = '700 72px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(fit(g, line1, w - 90), 52, 112);
    g.fillStyle = '#c9c9d4'; g.font = '500 54px -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText(fit(g, line2 || '', w - 90), 52, 192);
    tex.needsUpdate = true;
  };
  return spr;
}
function fit(g, t, max) {
  if (g.measureText(t).width <= max) return t;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

function chevronShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.6); s.lineTo(0.55, -0.05); s.lineTo(0.3, -0.05); s.lineTo(0, 0.3);
  s.lineTo(-0.3, -0.05); s.lineTo(-0.55, -0.05); s.closePath();
  return s;
}
function flatChevron() {
  const g = new THREE.ShapeGeometry(chevronShape());
  g.rotateX(-Math.PI / 2);          // shape +Y → -Z (forward), lying on the ground
  return g;
}
function guideArrowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.7); s.lineTo(0.42, 0.15); s.lineTo(0.17, 0.15); s.lineTo(0.17, -0.5);
  s.lineTo(-0.17, -0.5); s.lineTo(-0.17, 0.15); s.lineTo(-0.42, 0.15); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  g.translate(0, 0, -0.06);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class ARView {
  constructor({ canvas, video, overlay, compass }) {
    Object.assign(this, { canvas, video, overlay, compass });
    this.xr = false;
    this.origin = null;          // first GPS fix: origin of the world frame
    this.gps = null;             // latest fix
    this.northKnown = false;
    this.snap = true;            // jump (rather than glide) the world into place on the next frame
    this.route = null;           // { pts: Vector2[] (x=east, y=-north), cum: number[], latlngs }
    this.destLatLng = null;
    this.dest = null;            // Vector2 in world-local frame
    this.facingHint = null;      // walking direction (deg) used when there are no motion sensors
    this.devOrient = null;
    this.look = { yaw: 0, pitch: -0.18, draggedAt: 0 };
    this.celebrating = false;
    this.labelText = ['', ''];
    this.guideYaw = null;

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setClearColor(0x000000, 0);
    r.xr.enabled = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(63, 1, 0.05, 800);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 5, 3); this.scene.add(sun);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.buildContent();

    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.resize();
    this.onOrient = (e) => { if (e.alpha !== null && e.beta !== null) this.devOrient = e; };
    addEventListener('deviceorientation', this.onOrient);
    this.bindDrag();
  }

  // ---------- Scene content ----------
  buildContent() {
    // Ground chevrons that flow along the walking route.
    this.chevrons = new THREE.InstancedMesh(flatChevron(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
      MAX_CHEVRONS);
    this.chevrons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_CHEVRONS; i++) this.chevrons.setColorAt(i, PINK);
    this.chevrons.count = 0;
    this.chevrons.frustumCulled = false;
    this.world.add(this.chevrons);

    // Big floating guide arrow a few metres ahead of the user, pointing along the route.
    this.guide = new THREE.Group();
    const arrow = new THREE.Mesh(guideArrowGeometry(), new THREE.MeshStandardMaterial({
      color: 0xff3d7f, emissive: 0xff3d7f, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.1 }));
    arrow.rotation.x = 0.35;     // tip raised slightly so it reads well from eye height
    arrow.scale.setScalar(0.6);
    this.guide.add(arrow);
    this.guideArrow = arrow;
    this.label = textSprite();
    this.label.scale.set(1.5, 0.375, 1);
    this.label.position.set(0, 0.75, 0);
    this.guide.add(this.label);
    this.scene.add(this.guide);

    // Beacon: a tall light pillar over the artwork, visible from streets away.
    this.beacon = new THREE.Group();
    // Sized for 30 m away; updateBeacon() scales it so it keeps the same size on screen at any distance.
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    pillar.position.y = 3;
    this.beaconOrb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), new THREE.MeshBasicMaterial({ color: CYAN }));
    this.beaconOrb.position.y = 6.4;
    this.beaconLabel = textSprite();
    this.beaconLabel.scale.set(5, 1.25, 1);
    this.beaconLabel.position.y = 7.8;
    this.beacon.add(pillar, this.beaconOrb, this.beaconLabel);
    this.beacon.visible = false;
    this.world.add(this.beacon);

    // Arrival: spinning gold frame + confetti, in front of the camera.
    this.party = new THREE.Group();
    this.partyFrame = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 12, 4),
      new THREE.MeshStandardMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.6 }));
    this.partyFrame.rotation.z = Math.PI / 4;
    this.party.add(this.partyFrame);
    const cols = [0xff3d7f, 0x3dd6ff, 0x4dff9a, 0xffd23d, 0xb46bff];
    this.confetti = [];
    for (let i = 0; i < 80; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.13),
        new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      p.userData.v = new THREE.Vector3();
      p.userData.spin = Math.random() * 0.2;
      this.party.add(p); this.confetti.push(p);
    }
    this.party.visible = false;
    this.scene.add(this.party);
  }

  // ---------- Inputs from the app ----------
  setPosition(p) {
    this.gps = p;
    if (!this.origin) {
      this.origin = { lat: p.lat, lng: p.lng };
      if (this.route) this.setRoute(this.route.latlngs);
      if (this.destLatLng) this.setDestination(this.destLatLng);
    }
  }
  setRoute(latlngs) {
    if (!latlngs || latlngs.length < 2) { this.route = null; return; }
    if (!this.origin) { this.route = { latlngs }; return; }
    const pts = latlngs.map((p) => { const { e, n } = toEN(p, this.origin); return new THREE.Vector2(e, -n); });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.route = { latlngs, pts, cum };
  }
  setDestination(p, name = '') {
    this.destLatLng = p;
    if (name) this.destName = name;
    if (!p) { this.dest = null; return; }
    if (this.origin) { const { e, n } = toEN(p, this.origin); this.dest = new THREE.Vector2(e, -n); }
  }
  setLabel(line1, line2) { this.labelText = [line1, line2]; }
  setFacingHint(deg) { this.facingHint = deg; }
  celebrate(on) {
    this.celebrating = on;
    if (on) for (const p of this.confetti) {
      p.position.set(0, 0, 0);
      p.userData.v.set((Math.random() - 0.5) * 0.06, 0.03 + Math.random() * 0.06, (Math.random() - 0.5) * 0.06);
    }
  }

  // ---------- Lifecycle ----------
  async start() {
    let cameraOk = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
    } catch { cameraOk = false; }
    this.renderer.setAnimationLoop((t) => this.frame(t));
    return cameraOk;
  }
  stop() {
    this.renderer.setAnimationLoop(null);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.renderer.xr.getSession()?.end();
  }

  async xrSupported() {
    try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
  }
  async enterXR() {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: this.overlay },
    });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    this.xr = true; this.snap = true; this.northKnown = false;
    this.video.style.visibility = 'hidden';
    session.addEventListener('end', () => {
      this.xr = false; this.snap = true; this.northKnown = false;
      this.video.style.visibility = '';
      this.resize();
      this.onXRChange?.(false);
    });
    this.onXRChange?.(true);
  }
  exitXR() { this.renderer.xr.getSession()?.end(); }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Rough vertical field of view of a phone's main camera shown full-screen ("cover").
    this.camera.fov = h >= w ? 63 : 42;
    this.camera.updateProjectionMatrix();
  }

  bindDrag() {
    // Without motion sensors (e.g. desktop testing) let the user drag to look around.
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; });
    addEventListener('pointerup', () => { last = null; });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last || this.devOrient) return;
      this.look.yaw += (e.clientX - last[0]) * 0.005;
      this.look.pitch = Math.max(-1.2, Math.min(1.0, this.look.pitch + (e.clientY - last[1]) * 0.005));
      this.look.draggedAt = performance.now();
      last = [e.clientX, e.clientY];
    });
  }

  // ---------- Per frame ----------
  frame(t) {
    const time = t / 1000;
    const cam = this.xr ? this.renderer.xr.getCamera() : this.camera;
    if (!this.xr) this.updatePhoneCamera();
    this.updateNorth(cam);
    this.updateAnchor(cam);

    const camPos = cam.getWorldPosition(this._v1 || (this._v1 = new THREE.Vector3()));
    const user = this.world.worldToLocal(camPos.clone());
    const userXZ = new THREE.Vector2(user.x, user.z);

    // Camera's horizontal forward direction (scene frame), for placing HUD-like objects.
    const fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); else fwd.normalize();

    const showNav = !this.celebrating && !!this.gps && !!this.origin;
    this.updateChevrons(userXZ, time, showNav);
    this.updateGuide(userXZ, camPos, fwd, time, showNav);
    this.updateBeacon(userXZ, time, showNav);
    this.updateParty(camPos, fwd, time);

    this.renderer.render(this.scene, this.camera);
  }

  updatePhoneCamera() {
    const q = this._q || (this._q = new THREE.Quaternion());
    if (this.devOrient) {
      const o = this.devOrient;
      const sa = screen.orientation?.angle ?? window.orientation ?? 0;
      orientationQuaternion(q, rad(o.alpha), rad(o.beta), rad(o.gamma), rad(sa));
      this.camera.quaternion.slerp(q, 0.35);
      return;
    }
    // No sensors: face the walking direction unless the user dragged recently.
    if (this.facingHint !== null && performance.now() - this.look.draggedAt > 4000) {
      const target = this.world.rotation.y - rad(this.facingHint);
      this.look.yaw += angleDiff(target, this.look.yaw) * 0.08;
    }
    this.camera.rotation.set(this.look.pitch, this.look.yaw, 0, 'YXZ');
  }

  // Rotate the world so its -Z axis points at true north.
  updateNorth(cam) {
    const H = this.compass?.get();
    if (H === null || H === undefined) return;
    const d = cam.getWorldDirection(this._v2 || (this._v2 = new THREE.Vector3()));
    if (Math.abs(d.y) > 0.85) return;                    // looking at the ground/sky: yaw unreliable
    const camYaw = Math.atan2(-d.x, -d.z);
    const target = camYaw + rad(H);
    if (!this.northKnown || this.snap) { this.world.rotation.y = target; this.northKnown = true; }
    else this.world.rotation.y += angleDiff(target, this.world.rotation.y) * 0.03;
  }

  // Slide the world so the user's GPS position sits under the camera.
  updateAnchor(cam) {
    if (!this.gps || !this.origin) return;
    const { e, n } = toEN(this.gps, this.origin);
    const v = (this._v3 || (this._v3 = new THREE.Vector3())).set(e, 0, -n).applyAxisAngle(UP, this.world.rotation.y);
    let cx = 0, cz = 0;
    if (this.xr) { const p = cam.getWorldPosition(new THREE.Vector3()); cx = p.x; cz = p.z; }
    const target = new THREE.Vector3(cx - v.x, this.xr ? 0 : -EYE, cz - v.z);
    if (this.snap) { this.world.position.copy(target); this.snap = false; }
    // In floor-locked mode ARCore tracking is smoother than GPS, so only drift slowly towards GPS.
    else this.world.position.lerp(target, this.xr ? 0.01 : 0.08);
  }

  // Nearest distance along the route to point u, plus the route point/heading at a distance.
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
  }
  routeAt(s) {
    const { pts, cum } = this.route;
    s = Math.max(0, Math.min(s, cum[cum.length - 1]));
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, yaw: Math.atan2(-(b.x - a.x), -(b.y - a.y)) };
  }

  updateChevrons(user, time, show) {
    const m = this.chevrons;
    if (!show || !this.route?.pts) { m.count = 0; return; }
    const s0 = this.routeProgress(user);
    const total = this.route.cum[this.route.cum.length - 1];
    const phase = (time * 1.4) % CHEVRON_SPACING;
    const mat = this._m || (this._m = new THREE.Matrix4());
    const quat = this._cq || (this._cq = new THREE.Quaternion());
    const col = this._c || (this._c = new THREE.Color());
    let n = 0;
    for (let k = 0; n < MAX_CHEVRONS; k++) {
      const ahead = 1.5 + phase + k * CHEVRON_SPACING;
      const s = s0 + ahead;
      if (ahead > CHEVRON_RANGE || s > total) break;
      const p = this.routeAt(s);
      quat.setFromAxisAngle(UP, p.yaw);
      const fade = 1 - ahead / CHEVRON_RANGE;
      const sc = 0.9 + 0.3 * fade;
      mat.compose(new THREE.Vector3(p.x, 0.03, p.y), quat, new THREE.Vector3(sc, 1, sc));
      m.setMatrixAt(n, mat);
      m.setColorAt(n, col.copy(PINK).multiplyScalar(0.35 + 0.65 * fade));
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  updateGuide(user, camPos, fwd, time, show) {
    this.guide.visible = show && (!!this.route?.pts || !!this.dest);
    if (!this.guide.visible) return;
    // Aim at a point ~20 m further along the route so the arrow bends with the street.
    let tx, ty;
    if (this.route?.pts) { const p = this.routeAt(this.routeProgress(user) + 20); tx = p.x; ty = p.y; }
    else { tx = this.dest.x; ty = this.dest.y; }
    const localYaw = Math.atan2(-(tx - user.x), -(ty - user.y));
    const yaw = localYaw + this.world.rotation.y;
    this.guideYaw = this.guideYaw === null ? yaw : this.guideYaw + angleDiff(yaw, this.guideYaw) * 0.15;
    this.guide.position.set(camPos.x + fwd.x * 4, camPos.y - 0.8 + Math.sin(time * 2.2) * 0.05, camPos.z + fwd.z * 4);
    this.guide.rotation.set(0, this.guideYaw, 0);
    this.label.userData.draw(this.labelText[0], this.labelText[1]);
  }

  // Signed angle (degrees, clockwise) from where the camera faces to where the guide arrow points.
  relativeGuideAngle() {
    if (this.guideYaw === null) return null;
    const cam = this.xr ? this.renderer.xr.getCamera() : this.camera;
    const d = cam.getWorldDirection(new THREE.Vector3());
    return -angleDiff(this.guideYaw, Math.atan2(-d.x, -d.z)) * 180 / Math.PI;
  }

  updateBeacon(user, time, show) {
    this.beacon.visible = show && !!this.dest;
    if (!this.beacon.visible) return;
    const dx = this.dest.x - user.x, dy = this.dest.y - user.y, d = Math.hypot(dx, dy);
    const k = d > BEACON_NEAR ? BEACON_NEAR / d : 1;
    this.beacon.position.set(user.x + dx * k, 0, user.y + dy * k);
    this.beacon.scale.setScalar(Math.max(0.45, Math.min(d, BEACON_NEAR) / 30));
    this.beaconOrb.position.y = 6.4 + Math.sin(time * 2) * 0.2;
    this.beaconLabel.userData.draw(this.destName || 'Street art', d < 1000 ? `${Math.round(d / 5) * 5} m` : `${(d / 1000).toFixed(1)} km`, '#3dd6ff');
  }

  updateParty(camPos, fwd, time) {
    this.party.visible = this.celebrating;
    if (!this.celebrating) return;
    this.party.position.set(camPos.x + fwd.x * 3, camPos.y - 0.2, camPos.z + fwd.z * 3);
    this.partyFrame.rotation.y = time * 1.2;
    for (const p of this.confetti) {
      p.position.add(p.userData.v);
      p.userData.v.y -= 0.0022;
      p.rotation.x += p.userData.spin; p.rotation.y += p.userData.spin;
      if (p.position.y < -1.4) { p.position.set(0, 0, 0); p.userData.v.y = 0.03 + Math.random() * 0.06; }
    }
  }
}
