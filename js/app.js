import { SPOTS, TOURS, DEMO_STARTS } from './spots.js';
import {
  dist, bearing, distToSeg, ll, compassWord, fmtDist, sayDist, walkMins, fmtMins, lc,
  fetchRoute, stepText, remainingOnRoute, createSpeaker, buzz, createCompass,
} from './nav-core.js';
import { ARView } from './ar-view.js';

const $ = (id) => document.getElementById(id);
const spotById = Object.fromEntries(SPOTS.map((s) => [s.id, s]));
const params = new URLSearchParams(location.search);

// ---------- Settings (per device, best effort) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('spraypath.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('spraypath.' + k, JSON.stringify(v)); } catch {} },
};
const opts = { voice: store.get('voice', true), demo: params.has('demo') || store.get('demo', false) };

const speaker = createSpeaker({ enabled: () => opts.voice });
const say = (t, o) => speaker.say(t, o);
const compass = createCompass();
let view = null;

// ---------- Position: GPS or simulated walk ----------
let pos = null, watchId = null;
function emit(p) { pos = p; onPosition(); }
function startGPS() {
  if (watchId !== null) return;
  if (!('geolocation' in navigator)) { setStatus('Location is not available on this device. Try Demo walk.'); return; }
  watchId = navigator.geolocation.watchPosition(
    (g) => emit({
      lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy,
      heading: g.coords.speed > 0.6 && Number.isFinite(g.coords.heading) ? g.coords.heading : null,
    }),
    (err) => setStatus(`Location unavailable (${err.message}). Try Demo walk.`),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function stopGPS() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }

const sim = { timer: null, path: [], i: 0, speed: 1.4 * 3 };   // metres per second, sped up
function simStart(start) {
  clearInterval(sim.timer);
  emit({ lat: start.lat, lng: start.lng, acc: 5, heading: null });
  sim.timer = setInterval(simTick, 1000);
}
function simFollow(coords) { sim.path = coords.map(ll); sim.i = 0; }
function simTick() {
  if (!pos || sim.i >= sim.path.length) return;
  let left = sim.speed, cur = { lat: pos.lat, lng: pos.lng }, h = pos.heading;
  while (left > 0 && sim.i < sim.path.length) {
    const tgt = sim.path[sim.i], d = dist(cur, tgt);
    if (d <= left) { left -= d; cur = tgt; sim.i++; continue; }
    h = bearing(cur, tgt);
    cur = { lat: cur.lat + (tgt.lat - cur.lat) * left / d, lng: cur.lng + (tgt.lng - cur.lng) * left / d };
    left = 0;
  }
  emit({ lat: cur.lat, lng: cur.lng, acc: 5, heading: h });
}
function simStop() { clearInterval(sim.timer); sim.timer = null; sim.path = []; }

// ---------- Navigation ----------
const nav = { active: false, ready: false, queue: [], idx: 0, route: null, step: 1, announced: {}, arrived: false,
              routing: false, rerouteAt: 0, offCount: 0 };
const currentSpot = () => spotById[nav.queue[nav.idx]];

async function startTrip(ids) {
  nav.active = true; nav.ready = false; nav.queue = ids; nav.idx = 0;
  $('home').classList.add('hidden');
  $('ar').classList.remove('hidden');
  $('card-instr').textContent = 'Starting camera…';
  say(ids.length > 1 ? `Starting a ${ids.length} stop street art walk.` : `Let's go to ${spotById[ids[0]].name}.`, { interrupt: true });

  await compass.enable();               // iOS asks for motion access here (needs this tap)
  if (!view) {
    view = new ARView({ container: $('ar'), video: $('ar-video'), compass });
    view.onXRChange = (on) => { $('btn-xr').textContent = on ? '📱 Exit floor lock' : '📍 Floor lock'; };
  }
  const cameraOk = await view.start();
  $('ar').classList.toggle('no-camera', !cameraOk);
  if (!cameraOk) showHint('Camera unavailable: showing directions without the camera view', 6000);
  view.xrSupported().then((ok) => $('btn-xr').classList.toggle('hidden', !ok));
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}

  if (opts.demo) {
    const first = currentSpot();
    stopGPS();
    simStart(DEMO_STARTS.reduce((a, b) => (dist(b, first) < dist(a, first) ? b : a)));
  } else startGPS();
  nav.ready = true;
  beginLeg();
}

function beginLeg() {
  const spot = currentSpot();
  Object.assign(nav, { route: null, step: 1, announced: {}, arrived: false, offCount: 0, rerouteAt: 0 });
  $('ar-target').textContent = spot.name;
  $('ar-stop').textContent = (nav.queue.length > 1 ? `Stop ${nav.idx + 1} of ${nav.queue.length} · ` : '') + spot.area;
  $('card-story').classList.add('hidden');
  $('btn-next').classList.add('hidden');
  $('card-instr').textContent = pos ? 'Finding a walking route…' : 'Getting your location…';
  $('card-sub').textContent = '';
  view.celebrate(false);
  view.setRoute(null);
  view.setDestination(spot, spot.name);
  if (pos) reroute(true);
}

async function reroute(first) {
  if (nav.routing || !pos) return;
  nav.routing = true; nav.rerouteAt = Date.now();
  const spot = currentSpot();
  try {
    const route = await fetchRoute(pos, spot);
    if (!nav.active || currentSpot() !== spot) return;
    Object.assign(nav, { route, step: 1, announced: {}, offCount: 0 });
    view.setRoute(route.geometry.coordinates.map(ll));
    if (opts.demo) simFollow(route.geometry.coordinates);
    const s0 = route.legs[0].steps[0];
    say(first ? `${spot.name} is ${sayDist(route.distance)} away, about ${walkMins(route.distance)} minutes. ${stepText(s0)}. Follow the arrows.`
              : `Rerouting. ${stepText(s0)}.`);
  } catch {
    // Routing service unavailable: guide in a straight line instead.
    nav.route = null;
    view.setRoute(null);
    if (opts.demo) simFollow([[spot.lng, spot.lat]]);
    if (first) say(`${spot.name} is ${sayDist(dist(pos, spot))} away, to the ${compassWord(bearing(pos, spot))}. Follow the arrow.`);
  } finally { nav.routing = false; onPosition(); }
}

function onPosition() {
  if (!nav.active) { renderSpotList(); return; }
  if (!pos || !nav.ready) return;
  view?.setPosition(pos);
  view?.setFacingHint(pos.heading);
  $('ar-gps').textContent = opts.demo ? 'DEMO' : `GPS ±${Math.round(pos.acc)} m`;
  if (nav.arrived) return;
  if (!nav.route && !nav.routing && !nav.rerouteAt) { reroute(true); return; }

  const spot = currentSpot();
  const toSpot = dist(pos, spot);
  if (toSpot < 25) return arrive(spot);

  const steps = nav.route?.legs[0].steps;
  if (steps) {
    while (nav.step < steps.length - 1 && dist(pos, ll(steps[nav.step].maneuver.location)) < 15) nav.step++;
    const s = steps[nav.step];
    const dNext = dist(pos, ll(s.maneuver.location));
    const remaining = remainingOnRoute(pos, steps, nav.step);
    const instr = stepText(s);
    $('card-instr').textContent = instr;
    $('card-sub').textContent = `in ${fmtDist(dNext)} · ${fmtDist(remaining)} to go · ${fmtMins(remaining)}`;
    view.setLabel(instr, `in ${fmtDist(dNext)}`);

    if (dNext > 60 && !nav.announced[nav.step + 'far'] && s.maneuver.type !== 'arrive' && steps[nav.step - 1].distance > 120) {
      nav.announced[nav.step + 'far'] = true;
      say(`In ${sayDist(dNext)}, ${lc(instr)}.`);
    }
    if (dNext <= 30 && !nav.announced[nav.step + 'now']) {
      nav.announced[nav.step + 'now'] = nav.announced[nav.step + 'far'] = true;
      say(s.maneuver.type === 'arrive' ? `${spot.name} is just ahead.` : `${instr} now.`);
      buzz([80, 60, 80]);
    }
    // More than 40 m off the route for three fixes in a row → ask for a new route.
    const c = nav.route.geometry.coordinates;
    let off = Infinity;
    for (let i = 1; i < c.length; i++) off = Math.min(off, distToSeg(pos, ll(c[i - 1]), ll(c[i])));
    nav.offCount = off > 40 && pos.acc < 35 ? nav.offCount + 1 : 0;
    if (nav.offCount >= 3 && Date.now() - nav.rerouteAt > 20000) reroute(false);
  } else {
    const instr = `Head ${compassWord(bearing(pos, spot))}`;
    $('card-instr').textContent = instr;
    $('card-sub').textContent = `${fmtDist(toSpot)} in a straight line · ${fmtMins(toSpot * 1.3)}`;
    view.setLabel(instr, fmtDist(toSpot));
  }
}

function arrive(spot) {
  nav.arrived = true;
  view.celebrate(true);
  buzz([200, 100, 200]);
  $('card-instr').textContent = `You've arrived: ${spot.name}`;
  $('card-sub').textContent = spot.area;
  $('card-story').textContent = spot.blurb;
  $('card-story').classList.remove('hidden');
  const more = nav.idx < nav.queue.length - 1;
  $('btn-next').classList.toggle('hidden', !more);
  say(spot.blurb, { interrupt: true });
  if (more) say(`Tap next stop when you're ready for ${spotById[nav.queue[nav.idx + 1]].name}.`);
  else if (nav.queue.length > 1) say("That's the end of the walk. Thanks for exploring London's street art.");
  if (opts.demo) sim.path = [];
}

function nextStop(skip) {
  if (!nav.active) return;
  if (nav.idx >= nav.queue.length - 1) { if (skip) say('That was the last stop.'); return; }
  nav.idx++;
  say(`Next stop: ${currentSpot().name}.`, { interrupt: true });
  beginLeg();
}

let wakeLock = null;
function endTrip() {
  nav.active = false; nav.ready = false; nav.route = null; nav.rerouteAt = 0;
  simStop();
  speaker.cancel();
  view?.stop();
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
  $('ar').classList.add('hidden');
  $('home').classList.remove('hidden');
  if (opts.demo) pos = null; else startGPS();
  renderSpotList();
  setTimeout(() => map?.invalidateSize(), 50);
}

// Edge hints when the route is behind or off to the side of the camera.
setInterval(() => {
  if (!nav.active || nav.arrived || !view) { $('edge-left').classList.add('hidden'); $('edge-right').classList.add('hidden'); return; }
  const a = view.relativeGuideAngle();
  $('edge-left').classList.toggle('hidden', a === null || a > -50);
  $('edge-right').classList.toggle('hidden', a === null || a < 50);
}, 250);

let hintTimer = null;
function showHint(text, ms = 4000) {
  $('ar-hint').textContent = text;
  $('ar-hint').classList.remove('hidden');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => $('ar-hint').classList.add('hidden'), ms);
}

$('btn-repeat').onclick = () => (nav.arrived ? say(currentSpot().blurb, { interrupt: true }) : speaker.repeat());
$('btn-skip').onclick = () => nextStop(true);
$('btn-next').onclick = () => nextStop();
$('btn-exit').onclick = endTrip;
$('btn-mute').onclick = () => {
  opts.voice = !opts.voice; store.set('voice', opts.voice); syncSettings();
  if (!opts.voice) speaker.cancel();
};
$('btn-xr').onclick = async () => {
  if (view.xr) { view.exitXR(); return; }
  try { await view.enterXR(); showHint('Floor lock on: arrows now stay on the pavement', 4000); }
  catch (e) { showHint(`Floor lock unavailable: ${e.message || e}`, 5000); }
};

// ---------- Home screen ----------
function setStatus(t) { $('status-line').textContent = t; }
function syncSettings() {
  $('opt-voice').setAttribute('aria-pressed', opts.voice);
  $('opt-demo').setAttribute('aria-pressed', opts.demo);
  $('btn-mute').textContent = opts.voice ? '🔊' : '🔇';
}
$('opt-voice').onclick = () => { opts.voice = !opts.voice; store.set('voice', opts.voice); syncSettings(); if (opts.voice) say('Voice guidance on.', { interrupt: true }); };
$('opt-demo').onclick = () => {
  opts.demo = !opts.demo; store.set('demo', opts.demo); syncSettings();
  if (opts.demo) { stopGPS(); pos = null; setStatus('Demo walk on: pick a tour to watch a simulated walk from the nearest station.'); }
  else { setStatus('Finding your location…'); startGPS(); }
  renderSpotList();
};

function renderTours() {
  for (const t of TOURS) {
    const b = document.createElement('button');
    b.className = 'tour';
    b.innerHTML = '<b></b><small></small>';
    b.querySelector('b').textContent = t.name;
    b.querySelector('small').textContent = `${t.stops.length} stops · ${t.desc}`;
    b.onclick = () => startTrip(t.stops);
    $('tours').appendChild(b);
  }
}

let map = null, youMarker = null;
function renderSpotList() {
  const live = pos && !opts.demo;
  const list = SPOTS.map((s) => ({ s, d: live ? dist(pos, s) : null }));
  if (live) list.sort((a, b) => a.d - b.d);
  if (live) setStatus(`Location found (±${Math.round(pos.acc)} m). Nearest: ${list[0].s.name}, ${fmtDist(list[0].d)}.`);
  const box = $('spots');
  box.innerHTML = '';
  for (const { s, d } of list) {
    const b = document.createElement('button');
    b.className = 'spot';
    b.innerHTML = '<div class="meta"><b></b><small></small></div><span class="dist"></span>';
    b.querySelector('b').textContent = s.name;
    b.querySelector('small').textContent = `${s.area} · ${s.tags.join(', ')}`;
    b.querySelector('.dist').textContent = d === null ? '→' : fmtDist(d);
    b.onclick = () => startTrip([s.id]);
    box.appendChild(b);
  }
  if (map && live) {
    if (!youMarker) youMarker = window.L.circleMarker([pos.lat, pos.lng], { radius: 7, color: '#3dd6ff', fillOpacity: 1 }).addTo(map);
    else youMarker.setLatLng([pos.lat, pos.lng]);
  }
}

function initMap() {
  const L = window.L;
  if (!L) { $('map').classList.add('hidden'); return; }
  map = L.map('map', { zoomControl: false }).setView([51.515, -0.095], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors', className: 'dark-tiles',
  }).addTo(map);
  for (const s of SPOTS) {
    const el = document.createElement('div');
    el.innerHTML = '<b></b><br><span></span><br><a href="#">Take me there →</a>';
    el.querySelector('b').textContent = s.name;
    el.querySelector('span').textContent = s.area;
    el.querySelector('a').onclick = (ev) => { ev.preventDefault(); map.closePopup(); startTrip([s.id]); };
    L.circleMarker([s.lat, s.lng], { radius: 8, color: '#ff3d7f', fillColor: '#ff3d7f', fillOpacity: 0.85 }).addTo(map).bindPopup(el);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && nav.active && !wakeLock) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  }
});

syncSettings();
renderTours();
initMap();
renderSpotList();
if (opts.demo) setStatus('Demo walk on: pick a tour to watch a simulated walk from the nearest station.');
else startGPS();

const pre = params.get('tour') ? TOURS.find((t) => t.id === params.get('tour'))?.stops
          : spotById[params.get('spot')] ? [params.get('spot')] : null;
if (pre) startTrip(pre);
