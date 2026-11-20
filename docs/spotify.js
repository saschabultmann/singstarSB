// Spotify login (Authorization Code + PKCE, no client secret) and Web API helper.
(function (root) {
  "use strict";

  var SCOPES = "user-read-playback-state user-modify-playback-state user-read-currently-playing streaming user-read-email user-read-private";
  var LS = { access: "sp_access", refresh: "sp_refresh", expires: "sp_expires", verifier: "sp_verifier", redirect: "sp_redirect" };

  function clientId() {
    return (root.SINGSTAR_CONFIG && root.SINGSTAR_CONFIG.spotifyClientId) || "";
  }
  function isConfigured() {
    var id = clientId();
    return id && id.indexOf("PASTE_") !== 0;
  }

  function randomString(len) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var arr = new Uint8Array(len);
    root.crypto.getRandomValues(arr);
    var out = "";
    for (var i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }

  function base64url(buffer) {
    var bytes = new Uint8Array(buffer), str = "";
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function redirectUri() {
    return location.origin + location.pathname;
  }

  function canLoginHere() {
    return !!(root.crypto && root.crypto.subtle && root.isSecureContext !== false);
  }

  function login() {
    if (!isConfigured()) { alert("Spotify Client ID missing in config.js"); return Promise.resolve(); }
    var verifier = randomString(64);
    localStorage.setItem(LS.verifier, verifier);
    localStorage.setItem(LS.redirect, redirectUri());
    return root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (hash) {
      var params = new URLSearchParams({
        client_id: clientId(),
        response_type: "code",
        redirect_uri: redirectUri(),
        code_challenge_method: "S256",
        code_challenge: base64url(hash),
        scope: SCOPES,
      });
      location.href = "https://accounts.spotify.com/authorize?" + params.toString();
    });
  }

  function saveTokens(t) {
    if (t.access_token) localStorage.setItem(LS.access, t.access_token);
    if (t.refresh_token) localStorage.setItem(LS.refresh, t.refresh_token);
    if (t.expires_in) localStorage.setItem(LS.expires, String(Date.now() + (t.expires_in - 60) * 1000));
    if (t.scope) localStorage.setItem("sp_scope", t.scope);
  }

  function tokenRequest(body) {
    return fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error_description || j.error || "Spotify token error");
        saveTokens(j);
        return j;
      });
    });
  }

  // Call on page load. Resolves true if a login callback was processed.
  function handleCallback() {
    var params = new URLSearchParams(location.search);
    var code = params.get("code");
    if (!code) {
      if (params.get("error")) history.replaceState(null, "", redirectUri());
      return Promise.resolve(false);
    }
    var verifier = localStorage.getItem(LS.verifier);
    var redirect = localStorage.getItem(LS.redirect) || redirectUri();
    history.replaceState(null, "", redirect);
    return tokenRequest({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirect,
      client_id: clientId(),
      code_verifier: verifier,
    }).then(function () { localStorage.removeItem(LS.verifier); return true; });
  }

  var refreshing = null;
  function refresh() {
    var rt = localStorage.getItem(LS.refresh);
    if (!rt) return Promise.reject(new Error("not logged in"));
    if (!refreshing) {
      refreshing = tokenRequest({ grant_type: "refresh_token", refresh_token: rt, client_id: clientId() })
        .then(function (j) { refreshing = null; return j.access_token; },
              function (e) { refreshing = null; throw e; });
    }
    return refreshing;
  }

  function accessToken() {
    var t = localStorage.getItem(LS.access);
    var exp = Number(localStorage.getItem(LS.expires) || 0);
    if (t && Date.now() < exp) return Promise.resolve(t);
    return refresh();
  }

  function hasStreaming() { return (localStorage.getItem("sp_scope") || "").indexOf("streaming") >= 0; }

  function hasLogin() { return !!localStorage.getItem(LS.refresh); }

  // Used when a phone logged in and hands its refresh token to the TV.
  function adoptRefreshToken(rt) {
    localStorage.setItem(LS.refresh, rt);
    localStorage.removeItem(LS.access);
    localStorage.removeItem(LS.expires);
    return refresh();
  }

  // Phone side: take the refresh token and forget it locally.
  function takeRefreshToken() {
    var rt = localStorage.getItem(LS.refresh);
    [LS.access, LS.refresh, LS.expires].forEach(function (k) { localStorage.removeItem(k); });
    return rt;
  }

  function logout() {
    localStorage.removeItem("sp_scope");
    [LS.access, LS.refresh, LS.expires].forEach(function (k) { localStorage.removeItem(k); });
  }

  function api(method, path, body, retried) {
    return accessToken().then(function (token) {
      var opts = { method: method, headers: { Authorization: "Bearer " + token } };
      if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      return fetch("https://api.spotify.com/v1" + path, opts).then(function (r) {
        if (r.status === 401 && !retried) {
          localStorage.removeItem(LS.expires);
          return api(method, path, body, true);
        }
        if (r.status === 204 || r.status === 202) return null;
        return r.text().then(function (txt) {
          var j = null;
          try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = null; }
          if (!r.ok) {
            var err = new Error((j && j.error && j.error.message) || ("Spotify error " + r.status));
            err.status = r.status;
            err.reason = j && j.error && j.error.reason;
            throw err;
          }
          return j;
        });
      });
    });
  }

  root.SpotifyAPI = {
    isConfigured: isConfigured, canLoginHere: canLoginHere, login: login, handleCallback: handleCallback,
    hasLogin: hasLogin, adoptRefreshToken: adoptRefreshToken, takeRefreshToken: takeRefreshToken,
    logout: logout, api: api, accessToken: accessToken, hasStreaming: hasStreaming,
  };
})(window);
