/**
 * GökyüzüWebSpam — Webmail First-Login Toast (v44.00.48)
 *
 * cPanel Webmail (Roundcube/Horde) veya bayi kullanıcı panelinin footer
 * template'ine su sekilde eklenir:
 *   <script src="/gokyuzuwebspam/webmail-toast.js" async></script>
 *
 * Ne yapar:
 *   1. Aktif kullanicinin email adresini page context'ten cikarir
 *      (Roundcube: rcmail.env.username / Horde: Horde.user)
 *   2. `/api/notifications/for-recipient?email=…` cagrir
 *   3. count > 0 ise sag-alt kosede kirmizi toast gosterir
 *      (localStorage ile ayni gun icinde tekrarlanmaz)
 *
 * Kurulum sonrasi:
 *   /usr/local/cpanel/base/webmail/roundcube/plugins/gokyuzuwebspam/
 *   veya /usr/local/cpanel/base/frontend/paper_lantern/files/js/
 */
(function () {
  "use strict";
  // Panel URL: Roundcube plugin env.gws_panel_url > window.GWS_PANEL_URL > default
  var PANEL = (window.rcmail && window.rcmail.env && window.rcmail.env.gws_panel_url)
              || window.GWS_PANEL_URL
              || "https://panel.gokyuzuhosting.com";
  var STORAGE_KEY = "gws_last_notif_shown";

  function getUserEmail() {
    // 1) Roundcube plugin env (en guvenilir - server-side inject)
    try {
      if (window.rcmail && window.rcmail.env) {
        if (window.rcmail.env.gws_user_email) return window.rcmail.env.gws_user_email;
        if (window.rcmail.env.username && window.rcmail.env.username.indexOf("@") > 0) {
          return window.rcmail.env.username;
        }
      }
    } catch (e) {}
    // 2) Horde legacy
    try {
      if (window.Horde && window.Horde.conf && window.Horde.conf.username) {
        var h = window.Horde.conf.username;
        return h.indexOf("@") > 0 ? h : null;
      }
    } catch (e) {}
    // 3) DOM fallback: mailto link
    try {
      var links = document.querySelectorAll('a[href^="mailto:"]');
      if (links.length) return links[0].getAttribute("href").replace("mailto:", "");
    } catch (e) {}
    return null;
  }

  function alreadyShownToday() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (!v) return false;
      var today = new Date().toISOString().slice(0, 10);
      return v === today;
    } catch (e) { return false; }
  }

  function markShown() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString().slice(0, 10));
    } catch (e) {}
  }

  function showToast(data) {
    var box = document.createElement("div");
    box.setAttribute("data-testid", "gws-webmail-toast");
    box.style.cssText = [
      "position:fixed", "right:20px", "bottom:20px",
      "max-width:380px", "z-index:99999",
      "background:linear-gradient(135deg,#7c1d1d,#450a0a)",
      "color:#fff", "border:1px solid #f43f5e",
      "border-radius:8px", "padding:14px 16px",
      "font-family:-apple-system,Segoe UI,Roboto,sans-serif",
      "font-size:13px", "line-height:1.4",
      "box-shadow:0 8px 24px rgba(220,38,38,.35)",
      "backdrop-filter:blur(8px)",
    ].join(";");

    var senders = (data.senders || []).slice(0, 3).join(", ") || "—";
    var kinds = (data.kinds || []).map(function (k) {
      return { rat: "RAT", trojan: "Trojan", phishing: "Oltalama",
               executable_url: "Zararlı Bağlantı",
               executable_attachment: "Zararlı Ek",
               known_malicious: "Kötü Amaçlı" }[k] || k;
    }).join(", ") || "malware";

    box.innerHTML =
      '<div style="display:flex;align-items:start;gap:10px;">' +
      '<div style="font-size:24px;line-height:1;">🛡️</div>' +
      '<div style="flex:1;">' +
      '<div style="font-weight:700;margin-bottom:4px;">GökyüzüWebSpam Koruması</div>' +
      '<div style="opacity:.95;">' + data.message + '</div>' +
      '<div style="opacity:.75;font-size:11px;margin-top:6px;">' +
      'Türler: <b>' + kinds + '</b><br>' +
      'Kaynaklar: ' + senders +
      '</div>' +
      '</div>' +
      '<button id="gws-toast-close" style="background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer;opacity:.7;">×</button>' +
      '</div>';
    document.body.appendChild(box);

    document.getElementById("gws-toast-close").onclick = function () {
      box.parentNode.removeChild(box);
    };
    // 20 sn sonra otomatik kapan
    setTimeout(function () {
      if (box.parentNode) box.parentNode.removeChild(box);
    }, 20000);
  }

  function init() {
    if (alreadyShownToday()) return;
    var email = getUserEmail();
    if (!email) return;
    var url = PANEL + "/api/notifications/for-recipient?email=" +
              encodeURIComponent(email) + "&hours=24";
    fetch(url, { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.count || d.count <= 0) return;
        showToast(d);
        markShown();
      })
      .catch(function () { /* sessiz */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 500);
  }
})();
