(function(window, document) {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  async function boot(options) {
    options = options || {};
    if (options.auth !== false && !window.SeaweedV4.requireAuth()) return null;
    if (window.SeaweedV4Nav) window.SeaweedV4Nav.render(options.station || null);
    return null;
  }

  window.SeaweedV4Page = { boot: boot, ready: ready };
})(window, document);