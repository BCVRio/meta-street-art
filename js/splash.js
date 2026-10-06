// SprayPath opening title: Higgsfield key art (assets/title-keyart.webp) brought to life with a kinetic
// title reveal, a light pulse running along the painted orb trail, drifting spray particles and a
// tilt parallax. "Begin now" zooms through into the map. Shown on every launch; skipped only by an explicit
// ?nosplash (the AR page's back link) or a shared spot/tour link.
(function () {
  'use strict';
  var root = document.getElementById('splash');
  if (!root) return;
  var params = new URLSearchParams(location.search);
  if (params.has('spot') || params.has('tour') || params.has('nosplash')) {
    root.remove(); document.documentElement.classList.remove('splash-open'); return;
  }

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var art = root.querySelector('.splash-art');
  var canvas = root.querySelector('canvas');
  var g = canvas.getContext('2d');
  var IMG_W = 1080, IMG_H = 1910;     // key art size; positions below are fractions of it

  // The glowing orb trail painted in the key art (fractions of the image), nearest first.
  var TRAIL = [[0.489, 0.788], [0.487, 0.675], [0.5, 0.625], [0.516, 0.6], [0.533, 0.585], [0.56, 0.575],
               [0.6, 0.57], [0.64, 0.566], [0.68, 0.565]];

  var W = 0, H = 0, dpr = 1, cover = { s: 1, ox: 0, oy: 0 };
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = root.clientWidth; H = root.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    var s = Math.max(W / IMG_W, H / IMG_H);   // object-fit: cover
    cover = { s: s, ox: (W - IMG_W * s) / 2, oy: (H - IMG_H * s) / 2 };
  }
  addEventListener('resize', resize);
  resize();
  function toScreen(fx, fy) { return [cover.ox + fx * IMG_W * cover.s, cover.oy + fy * IMG_H * cover.s]; }

  // Tilt parallax (falls back to a slow drift without motion access).
  var tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('deviceorientation', function (e) {
    if (e.gamma === null) return;
    tilt.tx = Math.max(-1, Math.min(1, e.gamma / 25));
    tilt.ty = Math.max(-1, Math.min(1, (e.beta - 60) / 30));
  });

  // Spray particles.
  var parts = [];
  for (var i = 0; i < (reduce ? 0 : 70); i++) parts.push(newPart(true));
  function newPart(anywhere) {
    return { x: Math.random(), y: anywhere ? Math.random() : 1.05, r: 0.6 + Math.random() * 2.4,
      vy: 0.012 + Math.random() * 0.03, vx: (Math.random() - 0.5) * 0.01, a: 0.25 + Math.random() * 0.6,
      c: Math.random() < 0.7 ? '255,61,127' : '61,214,255', tw: Math.random() * 6.28 };
  }

  var t0 = performance.now(), last = t0, running = true;
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    var t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
    tilt.x += (tilt.tx - tilt.x) * 0.06; tilt.y += (tilt.ty - tilt.y) * 0.06;
    var driftX = tilt.tx === 0 ? Math.sin(t * 0.25) * 0.4 : tilt.x;
    var driftY = tilt.ty === 0 ? Math.cos(t * 0.2) * 0.3 : tilt.y;
    art.style.setProperty('--px', (driftX * -10).toFixed(2) + 'px');
    art.style.setProperty('--py', (driftY * -8).toFixed(2) + 'px');

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';

    // Orb halos breathe, and a bright pulse runs up the trail every 2.4 s.
    var pulse = (t % 2.4) / 2.4 * (TRAIL.length + 1.5) - 0.5;
    for (var k = 0; k < TRAIL.length; k++) {
      var p = toScreen(TRAIL[k][0] + driftX * -0.004, TRAIL[k][1] + driftY * -0.003);
      var near = 1 - k / TRAIL.length;
      var hit = Math.max(0, 1 - Math.abs(k - pulse) * 0.9);
      var rad = (14 + 46 * near) * cover.s * 2.2 * (1 + 0.35 * hit + 0.06 * Math.sin(t * 3 + k));
      var grd = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad);
      grd.addColorStop(0, 'rgba(255,' + Math.round(120 + 120 * hit) + ',' + Math.round(170 + 80 * hit) + ',' + (0.35 + 0.55 * hit) + ')');
      grd.addColorStop(0.4, 'rgba(255,61,127,' + (0.18 + 0.3 * hit) + ')');
      grd.addColorStop(1, 'rgba(255,61,127,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(p[0], p[1], rad, 0, Math.PI * 2); g.fill();
    }
    // Particles drifting up through the alley.
    for (var j = 0; j < parts.length; j++) {
      var q = parts[j];
      q.y -= q.vy * dt; q.x += q.vx * dt + Math.sin(t + q.tw) * 0.0004;
      if (q.y < -0.05) parts[j] = q = newPart(false);
      var a = q.a * (0.6 + 0.4 * Math.sin(t * 2 + q.tw));
      g.fillStyle = 'rgba(' + q.c + ',' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(q.x * W, q.y * H, q.r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  requestAnimationFrame(frame);

  // Split the title into letters for the staggered slam-in.
  var title = root.querySelector('.splash-title');
  var word = title.textContent.trim();
  title.textContent = '';
  title.setAttribute('aria-label', word);
  word.split('').forEach(function (ch, i) {
    var s = document.createElement('span');
    s.textContent = ch;
    s.setAttribute('aria-hidden', 'true');
    s.style.setProperty('--i', i);
    if (i >= 5) s.className = 'pink';           // "Spray" white, "Path" pink
    title.appendChild(s);
  });
  // Sound logo: spray-can rattle, a "psssht", a neon chime, then "Welcome to Spray Path" (voice made with
  // Higgsfield). Phones only allow sound after a tap: it plays from the tap on ZapWorks' Continue button
  // (see below), or from Begin now when there is no ZapWorks screen.
  var welcome = new Audio('assets/sounds/welcome.mp3');
  welcome.preload = 'auto';
  var soundPlayed = false;
  function playSound() {
    if (soundPlayed) return;
    soundPlayed = true;
    // Voice directions wait until the sound logo has finished (see createSpeaker in nav.js).
    window.sprayIntroUntil = Date.now() + 5000;
    try {
      var played = welcome.play();
      if (played && played.catch) played.catch(function () { window.sprayIntroUntil = 0; });
      welcome.addEventListener('ended', function () { window.sprayIntroUntil = 0; });
    } catch (e) { window.sprayIntroUntil = 0; }
  }

  // Start the title reveal once it can actually be seen. On ZapWorks' free plan a "Continue" screen is added
  // on top of the page (after this script), so wait for it to be dismissed.
  var started = false;
  function start() {
    if (started) return;
    if (document.visibilityState === 'hidden') {     // e.g. still behind an app's loading screen
      document.addEventListener('visibilitychange', function again() {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', again); start();
      });
      return;
    }
    started = true;
    t0 = performance.now();
    requestAnimationFrame(function () { root.classList.add('go'); });
    // Begin now only takes taps once it has faded in, so a tap meant for a loading screen can't skip the title.
    setTimeout(function () { root.classList.add('ready'); }, 2200);
  }

  // Which ZapWorks version this is (the number in the URL), to check a phone has the latest upload.
  var ver = location.pathname.match(/\/(\d+)\//);
  root.querySelector('.splash-ver').textContent = ver ? 'v' + ver[1] : 'dev';
  function watchZapWorks() {
    var zw = document.querySelector('[class^="zws0-"]');
    var input = zw && zw.querySelector('input');
    if (!zw || !input || input.checked || getComputedStyle(zw).display === 'none') { start(); return; }
    input.addEventListener('change', function () { playSound(); setTimeout(start, 250); });
    var poll = setInterval(function () {        // in case it goes away some other way
      if (getComputedStyle(zw).display === 'none' || !zw.isConnected) { clearInterval(poll); start(); }
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchZapWorks);
  else watchZapWorks();

  // Begin now: zoom through into the map.
  var btn = document.getElementById('begin');
  btn.addEventListener('click', function () {
    if (!root.classList.contains('ready')) return;
    playSound();
    // This tap also unlocks speech on iOS for the voice directions (a silent, empty line).
    try { if ('speechSynthesis' in window) { var u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } } catch (e) {}
    // Ask for compass access from this tap (iOS), used later in AR.
    try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().catch(function () {}); } catch (e) {}
    root.classList.add('leaving');
    setTimeout(function () {
      running = false;
      root.remove();
      document.documentElement.classList.remove('splash-open');
      window.dispatchEvent(new Event('resize'));       // let the map re-measure
    }, reduce ? 50 : 750);
  });
})();
