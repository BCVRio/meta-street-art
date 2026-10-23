// Street art data, one city at a time. data/index.json lists every city; data/cities/<id>.json holds that
// city's spots, walking tours and demo start points (built by tools/data/build.py from OpenStreetMap plus the
// hand-written tours in tools/data/curated/). Pages call DATA.ready(fn): fn runs once window.SPOTS, TOURS and
// DEMO_STARTS hold the chosen city (?city=…, else the last city used, else London).
window.DATA = (function () {
  'use strict';
  var index = null, city = null, params = new URLSearchParams(location.search);
  function getJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.json(); });
  }
  function dist(a, b) {
    var p = Math.PI / 180, dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  }
  function loadIndex() {
    return index ? Promise.resolve(index) : getJson('data/index.json').then(function (d) { index = d.cities; return index; });
  }
  function nearestCity(ll) {
    if (!index) return null;
    return index.reduce(function (a, b) { return dist(ll, b) < dist(ll, a) ? b : a; });
  }
  function load(id) {
    return loadIndex().then(function () {
      var meta = index.filter(function (c) { return c.id === id; })[0] || index.filter(function (c) { return c.id === 'london'; })[0] || index[0];
      return getJson('data/cities/' + meta.id + '.json').then(function (d) {
        window.SPOTS = d.spots; window.TOURS = d.tours; window.DEMO_STARTS = d.demoStarts || [];
        city = meta;
        try { localStorage.setItem('spraypath.city', meta.id); } catch (e) {}
        return meta;
      });
    });
  }
  function pick() {
    if (params.get('city')) return params.get('city');
    try { return localStorage.getItem('spraypath.city') || 'london'; } catch (e) { return 'london'; }
  }
  function ready(fn) {
    load(pick()).then(fn, function (e) {
      var box = document.getElementById('load-errors');
      if (box) { box.hidden = false; box.querySelector('ul').innerHTML = '<li>Could not load the street art data (' + (e.message || e) + ').</li>'; }
    });
  }
  return { ready: ready, load: load, loadIndex: loadIndex, nearestCity: nearestCity, dist: dist,
           current: function () { return city; }, all: function () { return index || []; } };
})();
