// Finds a picture and a paragraph for a spot from public sources, on demand (when a spot is opened):
//   1. the spot's own Wikipedia article (OSM `wikipedia` / `subject:wikipedia` tag), via the Wikipedia summary API;
//   2. else its Wikidata item (OSM `wikidata`): the item's Wikipedia article in any language, plus its image (P18);
//   3. else a Wikipedia article within 80 m whose title matches the spot or its artist ("nearby" search);
//   4. else a Wikimedia Commons image named in OSM (`image` / `wikimedia_commons`), with our own blurb;
//   5. else a Commons photo taken within 50 m whose title names the piece or the artist;
//   6. else our blurb alone, with a web search as "find out more".
// All of these answer CORS requests, which ZapWorks' cross-origin isolation requires. Results are cached per session.
window.WIKI = (function () {
  'use strict';
  var cache = {};
  function get(url) {
    // plain GET, no custom headers: keeps every call a "simple" CORS request (no preflight) on all browsers
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function splitWiki(tag) {            // "en:Leake Street" → { lang, title }
    var m = /^([a-z\-]{2,12}):(.+)$/.exec(tag || '');
    return m ? { lang: m[1], title: m[2].trim() } : tag ? { lang: 'en', title: tag.trim() } : null;
  }
  function summary(lang, title) {
    return get('https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_')))
      .then(function (d) {
        if (!d || d.type === 'disambiguation' || !d.extract) throw new Error('no summary');
        // a title clash with something that is clearly not a wall (e.g. "Nuclear Dawn" the video game)
        if (/\b(video game|film|album|song|band|novel|television|footballer|politician)\b/i.test(d.description || '')) throw new Error('wrong subject');
        return { title: d.title, text: d.extract, image: d.thumbnail && d.thumbnail.source ? d.thumbnail.source.replace(/\/\d+px-/, '/640px-') : null,
                 url: d.content_urls && d.content_urls.mobile ? d.content_urls.mobile.page : 'https://' + lang + '.m.wikipedia.org/wiki/' + encodeURIComponent(title), source: 'Wikipedia' };
      });
  }
  function commonsImage(file) {         // "File:Foo.jpg" or a Commons URL → a 640px thumbnail URL on upload.wikimedia.org
    var name = file.replace(/^.*\/(File:|wiki\/)/, '').replace(/^File:/, '');
    name = decodeURIComponent(name).replace(/ /g, '_');
    return get('https://commons.wikimedia.org/w/api.php?action=query&titles=File:' + encodeURIComponent(name) + '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&format=json&origin=*')
      .then(function (d) {
        var pages = d.query && d.query.pages, p = pages && pages[Object.keys(pages)[0]], ii = p && p.imageinfo && p.imageinfo[0];
        if (!ii) throw new Error('no image');
        var meta = ii.extmetadata || {}, artist = (meta.Artist && meta.Artist.value || '').replace(/<[^>]+>/g, ''), lic = meta.LicenseShortName && meta.LicenseShortName.value;
        return { image: ii.thumburl || ii.url, credit: (artist ? artist + ' · ' : '') + (lic || 'Wikimedia Commons'), page: ii.descriptionurl };
      });
  }
  function wikidata(q) {
    return get('https://www.wikidata.org/wiki/Special:EntityData/' + encodeURIComponent(q) + '.json').then(function (d) {
      var e = d.entities && d.entities[q]; if (!e) throw new Error('no entity');
      var links = e.sitelinks || {}, lang = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja'].filter(function (l) { return links[l + 'wiki']; })[0] || Object.keys(links).filter(function (k) { return /wiki$/.test(k) && !/commons|quote|voyage|source|news|books/.test(k); }).map(function (k) { return k.replace(/wiki$/, ''); })[0];
      var img = e.claims && e.claims.P18 && e.claims.P18[0].mainsnak.datavalue && e.claims.P18[0].mainsnak.datavalue.value;
      var desc = e.descriptions && (e.descriptions.en || e.descriptions[Object.keys(e.descriptions)[0]]);
      return { lang: lang, title: lang && links[lang + 'wiki'].title, image: img, desc: desc && desc.value };
    });
  }
  function similar(a, b) {
    var norm = function (s) { return (s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
    a = norm(a); b = norm(b); if (!a || !b) return false;
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    var wa = a.split(' ').filter(function (w) { return w.length > 3; }), wb = b.split(' ');
    var hits = wa.filter(function (w) { return wb.indexOf(w) >= 0; }).length;
    return wa.length > 0 && hits >= Math.max(1, Math.ceil(wa.length * 0.6));
  }
  function nearby(spot) {
    return get('https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=' + spot.lat + '|' + spot.lng + '&gsradius=80&gslimit=8&format=json&origin=*')
      .then(function (d) {
        var hits = (d.query && d.query.geosearch) || [], artist = (spot.wiki && spot.wiki.artist) || '';
        var m = hits.filter(function (h) { return similar(h.title, spot.name) || (artist && similar(h.title, artist)); })[0];
        if (!m) throw new Error('nothing nearby');
        return summary('en', m.title);
      });
  }
  var ART_WORDS = /mural|murales|graffiti|graffito|street.?art|streetart|fresque|fresco|affresco|wandbild|wandmalerei|wall ?painting|peinture murale|stencil|paste.?up|mosaic|mosaik|mozaika/i;
  function commonsNearby(spot) {        // a Commons photo taken within 50 m whose title names the piece or its artist,
    return get('https://commons.wikimedia.org/w/api.php?action=query&list=geosearch&gscoord=' + spot.lat + '|' + spot.lng + '&gsradius=50&gsnamespace=6&gslimit=30&format=json&origin=*')
      .then(function (d) {           // else one within 25 m whose title says it is a mural / graffiti / street art
        var hits = (d.query && d.query.geosearch) || [], artist = (spot.wiki && spot.wiki.artist) || '';
        var title = function (h) { return h.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' '); };
        var m = hits.filter(function (h) { var t = title(h); return similar(t, spot.name) || (artist && similar(t, artist)); })[0]
             || hits.filter(function (h) { return h.dist <= 25 && ART_WORDS.test(title(h)); })[0];
        if (!m) throw new Error('no commons photo nearby');
        return commonsImage(m.title);
      });
  }
  function fallback(spot, extra) {
    var q = encodeURIComponent(spot.name + ' ' + (spot.area || '') + ' street art');
    return Object.assign({ title: spot.name, text: spot.blurb, image: null, url: 'https://duckduckgo.com/?q=' + q, source: 'Search the web' }, extra || {});
  }
  // Resolves to { title, text, image, credit?, url, source }.
  function lookup(spot) {
    var key = spot.id; if (cache[key]) return cache[key];
    var w = spot.wiki || {}, p;
    var wp = splitWiki(w.wp), swp = splitWiki(w.swp);
    if (wp) p = summary(wp.lang, wp.title);
    else if (swp) p = summary(swp.lang, swp.title);
    else p = Promise.reject(new Error('no wikipedia tag'));
    p = p.catch(function () {
      var q = w.wd || w.swd; if (!q) throw new Error('no wikidata');
      return wikidata(q).then(function (e) {
        if (e.title) return summary(e.lang, e.title).catch(function () { return { title: e.title, text: e.desc || spot.blurb, image: null, url: 'https://' + e.lang + '.m.wikipedia.org/wiki/' + encodeURIComponent(e.title), source: 'Wikipedia' }; })
          .then(function (s) { return !s.image && e.image ? commonsImage(e.image).then(function (c) { return Object.assign(s, { image: c.image, credit: c.credit }); }, function () { return s; }) : s; });
        if (e.image) return commonsImage(e.image).then(function (c) { return fallback(spot, { image: c.image, credit: c.credit, url: 'https://www.wikidata.org/wiki/' + q, source: 'Wikidata' }); });
        throw new Error('bare wikidata');
      });
    }).catch(function () { return nearby(spot); })
      .catch(function () {
        var img = w.img || w.commons;
        if (img && /wikimedia|wikipedia|^File:/i.test(img)) return commonsImage(img).then(function (c) { return fallback(spot, { image: c.image, credit: c.credit, url: c.page, source: 'Wikimedia Commons' }); });
        throw new Error('no image');
      })
      .catch(function () { return commonsNearby(spot).then(function (c) { return fallback(spot, { image: c.image, credit: c.credit, url: c.page, source: 'Wikimedia Commons' }); }); })
      .catch(function () {
        // the artist's article is still a good "find out more"
        var awp = splitWiki(w.awp);
        if (awp) return summary(awp.lang, awp.title).then(function (s) { return fallback(spot, { image: s.image, url: s.url, source: 'Wikipedia (artist)', artistText: s.text }); });
        throw new Error('nothing');
      })
      .catch(function () { return fallback(spot); });
    cache[key] = p; return p;
  }
  return { lookup: lookup };
})();
