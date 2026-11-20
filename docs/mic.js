// SingStar Party – phone microphone
(function () {
  "use strict";

  var CFG = window.SINGSTAR_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  var S = {
    name: localStorage.getItem("mic_name") || "",
    room: "",
    cid: localStorage.getItem("mic_cid"),
    peer: null, conn: null, joined: false,
    pendingToken: null,
    audio: null, analyser: null, buf: null,
    floor: 0.003, sens: Number(localStorage.getItem("mic_sens") || 1),
  };
  if (!S.cid) { S.cid = Math.random().toString(36).slice(2, 12); localStorage.setItem("mic_cid", S.cid); }

  var params = new URLSearchParams(location.search);
  S.room = (params.get("room") || localStorage.getItem("mic_room") || "").toUpperCase();
  $("name").value = S.name;
  $("room").value = S.room;
  $("sens").value = S.sens;

  function msg(text) {
    var m = $("msg");
    m.textContent = text;
    m.classList.add("show");
    clearTimeout(msg._t);
    msg._t = setTimeout(function () { m.classList.remove("show"); }, 3000);
  }
  function setStatus(s) { $("status").textContent = s; }
  function send(o) { if (S.conn && S.conn.open) { try { S.conn.send(o); } catch (e) { /* ignore */ } } }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  // ---------- connection ----------
  function connect() {
    if (!S.peer || S.peer.destroyed) {
      S.peer = new Peer();
      S.peer.on("open", openConn);
      S.peer.on("error", function (err) {
        if (err.type === "peer-unavailable") { setStatus("Room " + S.room + " not found – is the TV page open? Retrying…"); setTimeout(openConn, 3000); }
        else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") { setStatus("Network problem – retrying…"); }
      });
      S.peer.on("disconnected", function () { setTimeout(function () { if (!S.peer.destroyed) S.peer.reconnect(); }, 2000); });
    } else if (S.peer.open) openConn();
  }

  function openConn() {
    if (S.conn && S.conn.open) return;
    setStatus("Connecting to room " + S.room + "…");
    var conn = S.peer.connect(CFG.roomPrefix + S.room.toLowerCase(), { reliable: true });
    S.conn = conn;
    conn.on("open", function () {
      setStatus("Connected ✓");
      send({ t: "hello", name: S.name, cid: S.cid });
      if (S.pendingToken) { send({ t: "spotify", rt: S.pendingToken }); S.pendingToken = null; }
    });
    conn.on("data", onData);
    conn.on("close", function () {
      if (S.conn === conn) { S.conn = null; setStatus("Disconnected – reconnecting…"); setTimeout(connect, 2000); }
    });
  }

  function onData(m) {
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "welcome":
        document.body.style.setProperty("--c", m.color);
        $("myname").textContent = m.name;
        break;
      case "state":
        $("score").textContent = m.score || 0;
        $("loginwrap").classList.toggle("hidden", !!m.loggedIn);
        $("offset").textContent = "(" + (m.offset >= 0 ? "+" : "") + Number(m.offset || 0).toFixed(1) + " s)";
        if (m.track) {
          var note = m.lyrics === "none" ? "<br><small>No lyrics found 😕</small>" : m.lyrics === "plain" ? "<br><small>Unsynced lyrics – no scoring</small>" : "";
          $("song").innerHTML = "<b>" + escapeHtml(m.track.name) + "</b>" + escapeHtml(m.track.artist) + (m.playing ? "" : " · paused") + note;
        } else {
          $("song").textContent = m.loggedIn ? "Nothing playing – search a song below" : "Spotify not connected yet";
        }
        break;
      case "line":
        $("score").textContent = m.score;
        if (m.rating) {
          $("rating").textContent = m.rating + " +" + m.pts;
          clearTimeout(onData._r);
          onData._r = setTimeout(function () { $("rating").textContent = ""; }, 1800);
          if (navigator.vibrate && m.rating === "PERFECT!") navigator.vibrate(60);
        }
        break;
      case "results":
        var r = m.ranking || [];
        msg("🏆 " + r.map(function (x, i) { return (i + 1) + ". " + x.name + " " + x.score; }).join("  "));
        break;
      case "songs": renderResults(m.items || []); break;
      case "error": msg("⚠️ " + m.msg); break;
      case "info": msg(m.msg); break;
    }
  }

  function renderResults(items) {
    if (!items.length) { $("results").innerHTML = '<p style="opacity:.6">No songs found.</p>'; return; }
    $("results").innerHTML = items.map(function (it, i) {
      return '<div class="res"><img src="' + escapeHtml(it.image || "") + '" alt="" onerror="this.style.visibility=\'hidden\'"><div class="info"><div>' + escapeHtml(it.name) +
        '</div><div class="ar">' + escapeHtml(it.artist) + '</div></div><button data-i="' + i + '" data-k="play">Sing</button>' +
        '<button class="secondary" data-i="' + i + '" data-k="queue">+</button></div>';
    }).join("");
    $("results").onclick = function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var it = items[Number(b.getAttribute("data-i"))];
      send({ t: b.getAttribute("data-k"), uri: it.uri });
    };
  }

  // ---------- microphone ----------
  function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("This browser can't access the microphone (needs HTTPS / a recent browser)."));
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    S.audio = new AC();
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    }).then(function (stream) {
      var src = S.audio.createMediaStreamSource(stream);
      var hp = S.audio.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 70;
      S.analyser = S.audio.createAnalyser();
      S.analyser.fftSize = 2048;
      src.connect(hp); hp.connect(S.analyser);
      S.buf = new Float32Array(S.analyser.fftSize);
      if (S.audio.state === "suspended") S.audio.resume();
      setInterval(tick, 50);
    });
  }

  var lastMidi = null;
  function tick() {
    if (!S.analyser) return;
    if (S.audio.state === "suspended") S.audio.resume();
    S.analyser.getFloatTimeDomainData(S.buf);
    var r = Pitch.rms(S.buf);
    // adaptive noise floor (follows quiet levels quickly, loud levels slowly)
    S.floor = r < S.floor ? S.floor * 0.8 + r * 0.2 : S.floor * 0.998 + r * 0.002;
    var gate = Math.max(0.006 / S.sens, S.floor * (2.4 / S.sens));
    var midi = null;
    if (r > gate) {
      var res = Pitch.yin(S.buf, S.audio.sampleRate, { threshold: 0.15, minFreq: 75, maxFreq: 1000 });
      if (res && res.confidence > 0.8) {
        midi = Pitch.freqToMidi(res.freq);
        // suppress single-frame octave errors
        if (lastMidi !== null) {
          var d = midi - lastMidi;
          if (Math.abs(Math.abs(d) - 12) < 0.6) midi -= 12 * Math.sign(d);
        }
      }
    }
    lastMidi = midi;
    send({ t: "p", m: midi === null ? null : Math.round(midi * 100) / 100, r: Math.round(r * 1000) / 1000 });
    $("note").textContent = midi === null ? "–" : Pitch.midiToName(midi);
    $("ring").style.setProperty("--s", (1 + Math.min(0.5, r * 6)).toFixed(3));
  }

  // ---------- UI ----------
  function join() {
    S.name = $("name").value.trim() || "Singer";
    S.room = $("room").value.trim().toUpperCase();
    if (S.room.length !== 4) { msg("Enter the 4-letter room code from the TV"); return; }
    localStorage.setItem("mic_name", S.name);
    localStorage.setItem("mic_room", S.room);
    $("myname").textContent = S.name;
    $("join").classList.add("hidden");
    $("main").classList.remove("hidden");
    S.joined = true;
    connect();
    startMic().catch(function (e) {
      msg("🎤 Microphone blocked: " + e.message);
      setStatus("Microphone not available – allow mic access and reload");
    });
    if (navigator.wakeLock) {
      var lock = function () { navigator.wakeLock.request("screen").catch(function () {}); };
      lock();
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") lock(); });
    }
  }

  $("joinbtn").addEventListener("click", join);
  $("sens").addEventListener("input", function () { S.sens = Number(this.value); localStorage.setItem("mic_sens", String(S.sens)); });
  document.querySelectorAll("[data-a]").forEach(function (b) {
    b.addEventListener("click", function () { send({ t: "ctl", a: b.getAttribute("data-a") }); });
  });
  $("searchform").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("q").value.trim();
    if (q) { send({ t: "search", q: q }); $("q").blur(); }
  });
  $("spbtn").addEventListener("click", function () {
    if (!Spotify.isConfigured()) { msg("Spotify Client ID missing in config.js"); return; }
    Spotify.login();
  });

  // Returning from Spotify login on this phone → hand the login to the TV.
  Spotify.handleCallback().then(function (done) {
    if (done) {
      S.pendingToken = Spotify.takeRefreshToken();
      msg("Spotify connected – sending to TV…");
      if (S.room && S.name) {
        // mic access needs a tap on iOS, so show the join screen pre-filled
        $("name").value = S.name; $("room").value = S.room;
        $("joinbtn").textContent = "Continue (finish Spotify setup)";
      }
    }
  }, function (e) { msg("Spotify login failed: " + e.message); });
})();
