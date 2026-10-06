// SprayPath map page: OpenStreetMap + GPS + turn-by-turn walking directions (OSRM).
(function () {
  'use strict';
  var N = window.NAV;
  var $ = function (id) { return document.getElementById(id); };
  var spotById = {};
  window.SPOTS.forEach(function (s) { spotById[s.id] = s; });
  var params = new URLSearchParams(location.search);

  // ---------- Settings & saved trip (best effort) ----------
  function load(k, d) { try { var v = localStorage.getItem('spraypath.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('spraypath.' + k, JSON.stringify(v)); } catch (e) {} }
  var opts = { voice: load('voice', true), demo: params.has('demo') || load('demo', false) };
  // Hold voice lines until the page has had a tap and the title page has gone (and its welcome sound has
  // played, see splash.js), so nothing is spoken over the ZapWorks loading screen.
  var touched = false;
  ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { touched = true; }, { capture: true, once: true }); });
  var speaker = N.createSpeaker({ enabled: function () { return opts.voice; },
    ready: function () { return touched && !document.getElementById('splash'); } });
  var say = function (t, o) { speaker.say(t, o); };

  // ---------- Map ----------
  var map = L.map('map', { zoomControl: false }).setView([51.515, -0.095], 13);
  var tileOpts = {
    maxZoom: 19, className: 'dark-tiles',
    // OpenStreetMap asks for a Referer; some hosts send none by default, which gets tiles refused.
    referrerPolicy: 'strict-origin-when-cross-origin',
    // ZapWorks pages are cross-origin isolated (COEP: require-corp): images from other sites only load
    // as CORS requests. OSM tile servers allow that (Access-Control-Allow-Origin: *).
    crossOrigin: 'anonymous',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', tileOpts).addTo(map);
  var tileErrors = 0, fallback = false;
  osm.on('tileerror', function () {
    // If the main OSM tile server refuses us, switch to the OSM France (Humanitarian) tiles.
    if (++tileErrors > 4 && !fallback) {
      fallback = true;
      map.removeLayer(osm);
      L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', Object.assign({}, tileOpts, { subdomains: 'abc' })).addTo(map);
    }
  });

  var spotMarkers = {};
  window.SPOTS.forEach(function (s) {
    var m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: '<div class="spot-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
    var el = document.createElement('div');
    el.innerHTML = '<b></b><small></small><div class="pbtns"><button class="primary">Directions</button><a>📷 AR</a></div>';
    el.querySelector('b').textContent = s.name;
    el.querySelector('small').textContent = s.area;
    el.querySelector('button').onclick = function () { map.closePopup(); startTrip([s.id]); };
    el.querySelector('a').onclick = function () { el.querySelector('a').href = arLink(s.id); };
    m.bindPopup(el);
    spotMarkers[s.id] = m;
  });

  var you = null, youAcc = null, routeLine = null, routeCasing = null;
  var follow = true, followPausedUntil = 0, centredOnce = false;
  map.on('dragstart', function () { followPausedUntil = Date.now() + 15000; });
  $('btn-locate').onclick = function () {
    followPausedUntil = 0; follow = true;
    if (pos) centreOn([pos.lat, pos.lng], Math.max(map.getZoom(), 17), true);
  };

  // Centre a point in the part of the map you can see (above the bottom panel).
  function centreOn(ll, zoom, animate) {
    zoom = zoom || map.getZoom();
    var sheetH = $('sheet').offsetHeight || 0;
    var pt = map.project(ll, zoom).add([0, sheetH / 2]);
    map.setView(map.unproject(pt, zoom), zoom, { animate: !!animate });
  }

  function drawYou() {
    if (!pos) return;
    var ll = [pos.lat, pos.lng];
    if (!you) {
      you = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="you"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 }).addTo(map);
      youAcc = L.circle(ll, { radius: pos.acc || 20, color: '#3dd6ff', weight: 1, fillOpacity: 0.1 }).addTo(map);
    } else { you.setLatLng(ll); youAcc.setLatLng(ll).setRadius(Math.min(pos.acc || 20, 200)); }
    // Centre on you at the first fix, then keep following you (paused for 15 s whenever you drag the map).
    if (!centredOnce) { centredOnce = true; centreOn(ll, trip.active ? Math.max(map.getZoom(), 16) : 16); return; }
    if (follow && Date.now() > followPausedUntil) centreOn(ll, null, true);
  }

  // ---------- Position: GPS or demo walk ----------
  var pos = null, watchId = null;
  function setGps(t) { $('gps-chip').textContent = t; }
  function emit(p) { pos = p; drawYou(); onPosition(); }
  function startGPS() {
    if (watchId !== null) return;
    if (!('geolocation' in navigator)) { setGps('No GPS on this device: try Demo walk'); return; }
    watchId = navigator.geolocation.watchPosition(function (g) {
      emit({ lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy,
        heading: g.coords.speed > 0.6 && isFinite(g.coords.heading) ? g.coords.heading : null });
    }, function (err) { setGps('Location unavailable: ' + err.message); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function stopGPS() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }

  var sim = { timer: null, path: [], i: 0, speed: 1.4 * 4 };
  function simStart(start) { clearInterval(sim.timer); emit({ lat: start.lat, lng: start.lng, acc: 5, heading: null }); sim.timer = setInterval(simTick, 1000); }
  function simFollow(coords) { sim.path = coords.map(N.ll); sim.i = 0; }
  function simTick() {
    if (!pos || sim.i >= sim.path.length) return;
    var left = sim.speed, cur = { lat: pos.lat, lng: pos.lng }, h = pos.heading;
    while (left > 0 && sim.i < sim.path.length) {
      var tgt = sim.path[sim.i], d = N.dist(cur, tgt);
      if (d <= left) { left -= d; cur = tgt; sim.i++; continue; }
      h = N.bearing(cur, tgt);
      cur = { lat: cur.lat + (tgt.lat - cur.lat) * left / d, lng: cur.lng + (tgt.lng - cur.lng) * left / d };
      left = 0;
    }
    emit({ lat: cur.lat, lng: cur.lng, acc: 5, heading: h });
  }
  function simStop() { clearInterval(sim.timer); sim.timer = null; sim.path = []; }

  // ---------- Trip / turn-by-turn ----------
  var trip = { active: false, queue: [], idx: 0, route: null, step: 1, announced: {}, arrived: false, routing: false, rerouteAt: 0, offCount: 0 };
  function currentSpot() { return spotById[trip.queue[trip.idx]]; }
  function arLink(id) {
    var q = 'ar.html?spot=' + encodeURIComponent(id);
    if (pos) q += '&lat=' + pos.lat.toFixed(6) + '&lng=' + pos.lng.toFixed(6);
    if (opts.demo) q += '&demo=1';
    return q;
  }

  function startTrip(ids, resumeIdx) {
    trip.active = true; trip.queue = ids; trip.idx = resumeIdx || 0;
    save('trip', { queue: ids, idx: trip.idx });
    $('browse').classList.add('hidden');
    $('nav').classList.remove('hidden');
    follow = true; followPausedUntil = 0;
    if (!resumeIdx) say(ids.length > 1 ? 'Starting a ' + ids.length + ' stop street art walk.' : "Let's go to " + spotById[ids[0]].name + '.', { interrupt: true });
    if (opts.demo && !pos) {
      var first = currentSpot();
      simStart(window.DEMO_STARTS.reduce(function (a, b) { return N.dist(b, first) < N.dist(a, first) ? b : a; }));
    }
    beginLeg();
  }

  function beginLeg() {
    var spot = currentSpot();
    Object.assign(trip, { route: null, step: 1, announced: {}, arrived: false, offCount: 0, rerouteAt: 0 });
    save('trip', { queue: trip.queue, idx: trip.idx });
    $('nav-target').textContent = (trip.queue.length > 1 ? 'STOP ' + (trip.idx + 1) + ' OF ' + trip.queue.length + ' · ' : '') + spot.name.toUpperCase();
    $('story').classList.add('hidden');
    $('btn-next').classList.add('hidden');
    $('turn-instr').textContent = pos ? 'Finding a walking route…' : 'Waiting for GPS…';
    $('turn-dist').textContent = '–';
    $('nav-summary').textContent = '';
    $('btn-ar').href = arLink(spot.id);
    Object.keys(spotMarkers).forEach(function (id) {
      spotMarkers[id].setIcon(L.divIcon({ className: '', html: '<div class="spot-pin' + (id === spot.id ? ' target' : '') + '"></div>',
        iconSize: id === spot.id ? [22, 22] : [16, 16], iconAnchor: id === spot.id ? [11, 11] : [8, 8] }));
    });
    clearRoute();
    if (pos) reroute(true);
  }

  function clearRoute() {
    if (routeLine) { map.removeLayer(routeLine); map.removeLayer(routeCasing); routeLine = routeCasing = null; }
    $('steps').innerHTML = '';
  }

  function reroute(first) {
    if (trip.routing || !pos) return;
    trip.routing = true; trip.rerouteAt = Date.now();
    var spot = currentSpot();
    N.fetchRoute(pos, spot).then(function (route) {
      if (!trip.active || currentSpot() !== spot) return;
      Object.assign(trip, { route: route, step: 1, announced: {}, offCount: 0 });
      clearRoute();
      var latlngs = route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
      routeCasing = L.polyline(latlngs, { color: '#000', weight: 10, opacity: 0.5 }).addTo(map);
      routeLine = L.polyline(latlngs, { color: '#ff3d7f', weight: 6, opacity: 0.95 }).addTo(map);
      if (first) { map.fitBounds(routeLine.getBounds(), { paddingTopLeft: [30, 90], paddingBottomRight: [30, Math.round(innerHeight * 0.45)] }); followPausedUntil = Date.now() + 6000; }
      renderSteps();
      if (opts.demo) simFollow(route.geometry.coordinates);
      var s0 = route.legs[0].steps[0];
      say(first ? spot.name + ' is ' + N.sayDist(route.distance) + ' away, about ' + N.walkMins(route.distance) + ' minutes. ' + N.stepText(s0) + '.'
                : 'Rerouting. ' + N.stepText(s0) + '.');
    }).catch(function () {
      trip.route = null;
      clearRoute();
      routeLine = L.polyline([[pos.lat, pos.lng], [spot.lat, spot.lng]], { color: '#ff3d7f', weight: 4, dashArray: '8 8' }).addTo(map);
      routeCasing = L.polyline([], {}).addTo(map);
      if (opts.demo) simFollow([[spot.lng, spot.lat]]);
      if (first) say(spot.name + ' is ' + N.sayDist(N.dist(pos, spot)) + ' away, to the ' + N.compassWord(N.bearing(pos, spot)) + '.');
    }).then(function () { trip.routing = false; onPosition(); });
  }

  function renderSteps() {
    var ol = $('steps');
    ol.innerHTML = '';
    trip.route.legs[0].steps.forEach(function (s, i) {
      if (i === 0) return;
      var li = document.createElement('li');
      li.innerHTML = '<span class="t"></span><span class="d"></span>';
      li.querySelector('.t').textContent = N.stepText(s);
      li.querySelector('.d').textContent = i < trip.route.legs[0].steps.length - 1 ? N.fmtDist(s.distance) : '';
      ol.appendChild(li);
    });
  }
  function highlightStep() {
    var lis = $('steps').children;
    for (var i = 0; i < lis.length; i++) {
      lis[i].className = i + 1 < trip.step ? 'done' : i + 1 === trip.step ? 'current' : '';
    }
  }

  var TURN_ANGLE = { 'sharp left': -135, left: -90, 'slight left': -45, straight: 0, 'slight right': 45, right: 90, 'sharp right': 135, uturn: 180 };
  function setTurnIcon(step) {
    var m = step && step.maneuver, a = 0;
    if (m && m.type !== 'arrive') a = TURN_ANGLE[m.modifier || 'straight'] || 0;
    $('turn-icon').querySelector('svg').style.transform = 'rotate(' + a + 'deg)';
    $('turn-icon').style.background = m && m.type === 'arrive' ? 'var(--ok)' : 'var(--accent)';
  }

  function onPosition() {
    if (!pos) return;
    setGps(opts.demo ? 'Demo walk' : 'GPS ±' + Math.round(pos.acc) + ' m');
    if (!trip.active) { renderSpots(); return; }
    if (trip.arrived) return;
    if (!trip.route && !trip.routing && !trip.rerouteAt) { reroute(true); return; }

    var spot = currentSpot(), toSpot = N.dist(pos, spot);
    if (toSpot < 25) { arrive(spot); return; }
    var steps = trip.route && trip.route.legs[0].steps;
    if (steps) {
      while (trip.step < steps.length - 1 && N.dist(pos, N.ll(steps[trip.step].maneuver.location)) < 15) trip.step++;
      var s = steps[trip.step], dNext = N.dist(pos, N.ll(s.maneuver.location));
      var rem = N.remainingOnRoute(pos, steps, trip.step), instr = N.stepText(s);
      $('turn-dist').textContent = N.fmtDist(dNext);
      $('turn-instr').textContent = instr;
      $('nav-summary').textContent = N.fmtDist(rem) + ' to go · ' + N.fmtMins(rem) + ' · arrive ' +
        new Date(Date.now() + rem / 1.3 * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      setTurnIcon(s);
      highlightStep();
      if (dNext > 60 && !trip.announced[trip.step + 'far'] && s.maneuver.type !== 'arrive' && steps[trip.step - 1].distance > 120) {
        trip.announced[trip.step + 'far'] = true;
        say('In ' + N.sayDist(dNext) + ', ' + N.lc(instr) + '.');
      }
      if (dNext <= 30 && !trip.announced[trip.step + 'now']) {
        trip.announced[trip.step + 'now'] = trip.announced[trip.step + 'far'] = true;
        say(s.maneuver.type === 'arrive' ? spot.name + ' is just ahead.' : instr + ' now.');
        N.buzz([80, 60, 80]);
      }
      // More than 40 m off the route for three fixes in a row → new route.
      var c = trip.route.geometry.coordinates, off = Infinity;
      for (var i = 1; i < c.length; i++) off = Math.min(off, N.distToSeg(pos, N.ll(c[i - 1]), N.ll(c[i])));
      trip.offCount = off > 40 && pos.acc < 35 ? trip.offCount + 1 : 0;
      if (trip.offCount >= 3 && Date.now() - trip.rerouteAt > 20000) reroute(false);
    } else {
      $('turn-dist').textContent = N.fmtDist(toSpot);
      $('turn-instr').textContent = 'Head ' + N.compassWord(N.bearing(pos, spot)) + ' (straight line)';
      $('nav-summary').textContent = N.fmtMins(toSpot * 1.3);
      setTurnIcon(null);
    }
  }

  function arrive(spot) {
    trip.arrived = true;
    N.buzz([200, 100, 200]);
    $('turn-dist').textContent = "You've arrived";
    $('turn-instr').textContent = spot.name;
    $('nav-summary').textContent = spot.area;
    setTurnIcon({ maneuver: { type: 'arrive' } });
    $('story').textContent = spot.blurb;
    $('story').classList.remove('hidden');
    var more = trip.idx < trip.queue.length - 1;
    $('btn-next').classList.toggle('hidden', !more);
    say(spot.blurb, { interrupt: true });
    if (more) say('Tap next stop when you are ready for ' + spotById[trip.queue[trip.idx + 1]].name + '.');
    else if (trip.queue.length > 1) say("That's the end of the walk. Thanks for exploring London's street art.");
    if (opts.demo) sim.path = [];
  }

  function nextStop(skip) {
    if (trip.idx >= trip.queue.length - 1) { if (skip) say('That was the last stop.'); return; }
    trip.idx++;
    say('Next stop: ' + currentSpot().name + '.', { interrupt: true });
    beginLeg();
  }

  function endTrip() {
    trip.active = false; trip.route = null; trip.rerouteAt = 0;
    save('trip', null);
    speaker.cancel();
    clearRoute();
    if (opts.demo) { simStop(); pos = null; if (you) { map.removeLayer(you); map.removeLayer(youAcc); you = youAcc = null; } }
    Object.keys(spotMarkers).forEach(function (id) {
      spotMarkers[id].setIcon(L.divIcon({ className: '', html: '<div class="spot-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }));
    });
    $('nav').classList.add('hidden');
    $('browse').classList.remove('hidden');
    renderSpots();
  }

  $('btn-next').onclick = function () { nextStop(); };
  $('btn-skip').onclick = function () { nextStop(true); };
  $('btn-end').onclick = endTrip;
  $('btn-steps').onclick = function () { $('steps').classList.toggle('hidden'); };

  // ---------- Browse ----------
  function syncSettings() {
    $('opt-voice').setAttribute('aria-pressed', opts.voice);
    $('opt-demo').setAttribute('aria-pressed', opts.demo);
  }
  $('opt-voice').onclick = function () { opts.voice = !opts.voice; save('voice', opts.voice); syncSettings(); if (opts.voice) say('Voice directions on.', { interrupt: true }); };
  $('opt-demo').onclick = function () {
    opts.demo = !opts.demo; save('demo', opts.demo); syncSettings();
    centredOnce = false;
    if (opts.demo) { stopGPS(); pos = null; setGps('Demo walk: pick a tour or spot'); }
    else { setGps('Finding your location…'); startGPS(); }
    renderSpots();
  };

  window.TOURS.forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'tour';
    b.innerHTML = '<b></b><small></small>';
    b.querySelector('b').textContent = t.name;
    b.querySelector('small').textContent = t.stops.length + ' stops · ' + t.desc;
    b.onclick = function () { startTrip(t.stops); };
    $('tours').appendChild(b);
  });

  var lastListAt = 0, lastListLive = false;
  function renderSpots() {
    var live = !!pos && !opts.demo;
    // Re-sort at most every 3 s, but always redraw when distances first become available.
    if (live === lastListLive && Date.now() - lastListAt < 3000 && $('spots').children.length) return;
    lastListAt = Date.now(); lastListLive = live;
    var list = window.SPOTS.map(function (s) { return { s: s, d: live ? N.dist(pos, s) : null }; });
    if (live) list.sort(function (a, b) { return a.d - b.d; });
    $('spots').innerHTML = '';
    list.forEach(function (x) {
      var b = document.createElement('button');
      b.className = 'spot';
      b.innerHTML = '<div class="meta"><b></b><small></small></div><span class="dist"></span>';
      b.querySelector('b').textContent = x.s.name;
      b.querySelector('small').textContent = x.s.area + ' · ' + x.s.tags.join(', ');
      b.querySelector('.dist').textContent = x.d === null ? '→' : N.fmtDist(x.d);
      b.onclick = function () { startTrip([x.s.id]); };
      $('spots').appendChild(b);
    });
  }

  // ---------- Start ----------
  syncSettings();
  renderSpots();
  if (opts.demo) setGps('Demo walk: pick a tour or spot'); else startGPS();
  var saved = load('trip', null);
  var pre = params.get('tour') ? (window.TOURS.find(function (t) { return t.id === params.get('tour'); }) || {}).stops
          : spotById[params.get('spot')] ? [params.get('spot')] : null;
  if (pre) startTrip(pre);
  else if (saved && saved.queue && saved.queue.every(function (id) { return spotById[id]; })) startTrip(saved.queue, saved.idx);
  window.sprayReady = true;
})();
