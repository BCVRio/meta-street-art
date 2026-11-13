// "Something wrong?" reports: gone / painted over / changed / wrong place. Each report is remembered on this
// phone (the pin greys out at once) and sent as a public OpenStreetMap note at the spot, which local mappers
// act on and which tools/data/apply-reports.py reads back at the next data build to mark the spot for everyone.
// Anonymous notes are allowed by OSM; we tag them "SprayPath" and send at most one per spot per phone.
window.REPORT = (function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var API = params.has('osmdev') ? 'https://master.apis.dev.openstreetmap.org/api/0.6' : 'https://api.openstreetmap.org/api/0.6';
  var KEY = 'spraypath.reports';
  var KINDS = {
    gone: { label: 'It’s gone', note: 'The street art mapped here is no longer there (painted over or removed).' },
    changed: { label: 'A different piece is here now', note: 'The street art mapped here has changed: a different piece is on this wall now.' },
    place: { label: 'It’s not at this spot', note: 'The street art is not at this location (the mapped position seems wrong).' },
    ok: { label: 'Still here, looks great', note: null },
  };
  function all() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function get(spotId) { return all()[spotId] || null; }
  function remember(spotId, kind, noteId) {
    var r = all(); r[spotId] = { kind: kind, at: Date.now(), note: noteId || null };
    try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {}
  }
  // Sends the note. Resolves to the OSM note id (or null when nothing was sent, e.g. "looks fine").
  function send(spot, kind, extra) {
    var k = KINDS[kind]; if (!k || !k.note) return Promise.resolve(null);
    var text = 'SprayPath report: ' + k.note + '\nArtwork: ' + spot.name + (spot.osm ? ' (' + spot.osm + ')' : '') + (extra ? '\nNote: ' + extra.slice(0, 300) : '')
             + '\nReported from the SprayPath street art app (' + new Date().toISOString().slice(0, 10) + ').';
    var url = API + '/notes.json?lat=' + spot.lat + '&lon=' + spot.lng + '&text=' + encodeURIComponent(text);
    return fetch(url, { method: 'POST' }).then(function (r) {
      if (!r.ok) throw new Error('OSM said ' + r.status);
      return r.json();
    }).then(function (d) { return d && d.properties ? d.properties.id : null; });
  }
  // Text shown on pins/lists for a spot that was reported (by this phone, or by others at the last data build).
  function status(spot) {
    var mine = get(spot.id), kind = mine ? mine.kind : null;
    if (kind === 'ok') return null;
    if (kind === 'gone') return 'You reported this gone';
    if (kind === 'changed') return 'You reported a new piece here';
    if (kind === 'place') return 'You reported a wrong location';
    var r = spot.reports || {};
    if (r.gone) return 'Reported gone' + (r.gone > 1 ? ' (' + r.gone + ')' : '');
    if (r.changed) return 'Reported changed';
    return null;
  }
  function isGone(spot) { var m = get(spot.id); return (m && m.kind === 'gone') || !!(spot.reports && spot.reports.gone >= 2); }
  return { KINDS: KINDS, get: get, remember: remember, send: send, status: status, isGone: isGone };
})();
