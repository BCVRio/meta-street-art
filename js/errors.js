// On-screen error banner (phones have no visible console). Load this first, as a plain script.
// Reports script errors and failed scripts/styles; ignores images (e.g. a missing map tile).
(function () {
  var shown = {};
  window.sprayReport = function (msg) {
    if (shown[msg]) return;
    shown[msg] = 1;
    var show = function () {
      var box = document.getElementById('load-errors');
      if (!box) return setTimeout(show, 50);
      box.hidden = false;
      var li = document.createElement('li');
      li.textContent = msg;
      box.querySelector('ul').appendChild(li);
    };
    show();
  };
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window) {
      if (t.tagName === 'SCRIPT' || t.tagName === 'LINK') window.sprayReport('Could not load ' + (t.src || t.href));
      return;
    }
    window.sprayReport((e.message || 'Script error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    window.sprayReport('Error: ' + ((e.reason && e.reason.message) || e.reason));
  });
})();
