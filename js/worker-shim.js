// ZapWorks serves pages cross-origin isolated (COEP: require-corp + COOP: same-origin). In that mode the
// browser refuses worker scripts that don't carry their own COEP header, which ZapWorks doesn't add to
// .js files, so Zappar's computer-vision worker never starts and the camera stays black.
// Workers created from a blob: URL inherit the page's policy, so start same-origin workers through a
// tiny blob that importScripts() the real file. Load this before vendor/zappar-aframe/zappar-aframe.js.
(function () {
  var NativeWorker = window.Worker;
  if (!NativeWorker || !window.Blob || !window.URL || !URL.createObjectURL) return;
  function ShimWorker(url, options) {
    try {
      var abs = new URL(url, location.href);
      var classic = !options || !options.type || options.type === 'classic';
      if (abs.origin === location.origin && classic && abs.protocol !== 'blob:') {
        var src = 'importScripts(' + JSON.stringify(abs.href) + ');';
        var blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        return new NativeWorker(blobUrl, options);
      }
    } catch (e) { /* fall through to a normal worker */ }
    return new NativeWorker(url, options);
  }
  ShimWorker.prototype = NativeWorker.prototype;
  window.Worker = ShimWorker;
})();
