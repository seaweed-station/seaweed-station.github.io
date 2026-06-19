(function(window, document) {
  "use strict";

  function basename() {
    return location.pathname.split("/").pop() || "overview.html";
  }

  function renderNav(station) {
    var nodes = document.querySelectorAll("[data-v4-nav]");
    var current = basename();
    var stationQuery = station ? "?station=" + encodeURIComponent(station.station_key) : "";
    var links = [
      { href: "overview.html", label: "Overview", page: "overview.html" },
      { href: station ? "station.html" + stationQuery : "station.html", label: "Station", page: "station.html" },
      { href: station ? "station_health.html" + stationQuery : "station_health.html", label: "Health", page: "station_health.html" },
      { href: "battery_estimator.html", label: "Battery", page: "battery_estimator.html" },
      { href: "alerts.html", label: "Alerts", page: "alerts.html" },
      { href: "settings.html", label: "Settings", page: "settings.html" }
    ];
    nodes.forEach(function(node) {
      node.innerHTML = links.map(function(link) {
        var cls = current === link.page ? " class=\"active\"" : "";
        return "<a" + cls + " href=\"" + link.href + "\">" + link.label + "</a>";
      }).join("") + "<button class=\"btn btn-small btn-danger\" type=\"button\" data-v4-signout>Sign Out</button>";
    });
    document.querySelectorAll("[data-v4-signout]").forEach(function(btn) {
      btn.addEventListener("click", function() { window.SeaweedV4.signOut(); });
    });
  }

  window.SeaweedV4Nav = { render: renderNav };
})(window, document);
