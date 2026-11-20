// SingStar Party – TV screen
(function () {
  "use strict";

  var CFG = window.SINGSTAR_CONFIG;
  var COLORS = ["#ff4fa3", "#3fd0ff", "#ffd23f", "#7dff6b", "#ff8a3f", "#b18aff", "#ff5c5c", "#4fffd2"];
  var LATENCY = 0.12;       // assumed mic + network delay (s)
  var WINDOW_PAST = 6, WINDOW_FUTURE = 2;
  var POLL_MS = 1500;

  var $ = function (id) { return document.getElementById(id); };

  var S = {
    room: null, peer: null,
    players: {},            // cid -> player
    order: 0,
    loggedIn: false,
    track: null, playing: false,
    anchorPerf: 0, anchorProg: 0,
    offset: Number(localStorage.getItem("tv_offset") || 0),
    lyrics: null, lines: [], budget: [], lineStats: {}, nextFinal: 0, resultsShown: false,
    pollBackoff: 0,
    player: null, tvDevice: null, playerStatus: "none", // none|loading|ready|unsupported|reauth
  };

  // ---------- helpers ----------
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2500);
  }
  function songTime() {
    var base = S.anchorProg;
    if (S.playing) base += (performance.now() - S.anchorPerf) / 1000;
    return base + S.offset;
  }
  function foldDiff(a, b) {
    var d = Math.abs(a - b) % 12;
    return Math.min(d, 12 - d);
  }
  function randomCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ", s = "";
    for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function joinUrl() {
    return location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "") + "mic.html?room=" + S.room;
  }
  function send(p, msg) {
    if (p && p.conn && p.conn.open) { try { p.conn.send(msg); } catch (e) { /* ignore */ } }
  }
  function broadcast(msg) {
    Object.keys(S.players).forEach(function (k) { send(S.players[k], msg); });
  }

  // ---------- room / QR ----------
  function renderQR() {
    var url = joinUrl();
    if (window.qrcode) {
      var qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      $("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0 });
      $("miniqr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
    }
    $("roomcode").textContent = S.room;
    $("roomcode2").textContent = S.room;
    $("joinurl").textContent = url.replace(/^https?:\/\//, "");
  }

  var idRetries = 0;
  function startPeer() {
    S.room = localStorage.getItem("tv_room") || randomCode();
    localStorage.setItem("tv_room", S.room);
    renderQR();
    var peer = new Peer(CFG.roomPrefix + S.room.toLowerCase());
    S.peer = peer;
    peer.on("open", function () { idRetries = 0; });
    peer.on("connection", onConnection);
    peer.on("disconnected", function () { setTimeout(function () { if (!peer.destroyed) peer.reconnect(); }, 2000); });
    peer.on("error", function (err) {
      if (err.type === "unavailable-id") {
        peer.destroy();
        idRetries++;
        if (idRetries > 3) { localStorage.removeItem("tv_room"); idRetries = 0; }
        setTimeout(startPeer, 4000);
      } else if (err.type === "network" || err.type === "server-error" || err.type === "socket-error") {
        toast("Connection problem – retrying…");
      }
    });
  }

  // ---------- players ----------
  function onConnection(conn) {
    conn.on("data", function (msg) { handleMsg(conn, msg); });
    conn.on("close", function () {
      Object.keys(S.players).forEach(function (k) {
        if (S.players[k].conn === conn) S.players[k].online = false;
      });
      renderPlayers();
    });
  }

  function handleMsg(conn, msg) {
    if (!msg || typeof msg !== "object") return;
    var p = conn._player;
    if (msg.t === "hello") {
      var cid = String(msg.cid || conn.peer);
      p = S.players[cid];
      if (!p) {
        p = S.players[cid] = { cid: cid, color: COLORS[S.order++ % COLORS.length], score: 0, trail: [], med: null, prevM: null, lastAt: performance.now(), rating: "", ratingAt: 0 };
      }
      p.name = String(msg.name || "Singer").slice(0, 16);
      p.conn = conn;
      p.online = true;
      conn._player = p;
      send(p, { t: "welcome", color: p.color, name: p.name, room: S.room });
      sendState(p);
      renderPlayers();
      toast(p.name + " joined 🎤");
      return;
    }
    if (!p) return;
    switch (msg.t) {
      case "p": onPitch(p, msg); break;
      case "search": doSearch(p, String(msg.q || "")); break;
      case "play": playUri(p, msg.uri, false); break;
      case "queue": playUri(p, msg.uri, true); break;
      case "ctl": control(p, msg.a); break;
      case "spotify":
        if (msg.rt) {
          SpotifyAPI.adoptRefreshToken(msg.rt).then(function () {
            S.loggedIn = true; updateLobby(); toast("Spotify connected by " + p.name); poll(true);
            if (S.playerStatus === "reauth") S.playerStatus = "none";
            if (S.player) { S.player.disconnect(); S.player = null; S.tvDevice = null; }
            initPlayer();
            send(p, { t: "spotify_ok" });
            broadcastState();
          }, function (e) { send(p, { t: "spotify_fail", msg: e.message }); });
        }
        break;
    }
  }

  function onPitch(p, msg) {
    var now = performance.now();
    var dt = Math.min(0.15, (now - p.lastAt) / 1000);
    p.lastAt = now;
    var m = typeof msg.m === "number" && isFinite(msg.m) ? msg.m : null;
    var t = songTime() - LATENCY;
    p.trail.push({ t: t, m: m });
    while (p.trail.length && p.trail[0].t < t - WINDOW_PAST - 1) p.trail.shift();
    if (m !== null) p.med = p.med === null ? m : p.med + (m - p.med) * 0.04;
    if (!S.playing || !S.lines.length) { p.prevM = m; return; }
    var idx = activeLine(t);
    if (idx >= 0) {
      var st = S.lineStats[idx] || (S.lineStats[idx] = {});
      var s = st[p.cid] || (st[p.cid] = { v: 0, s: 0 });
      if (m !== null) {
        s.v += dt;
        if (p.prevM !== null && foldDiff(m, p.prevM) < 0.7) s.s += dt;
      }
    }
    p.prevM = m;
  }

  function renderPlayers() {
    var html = "";
    Object.keys(S.players).forEach(function (k) {
      var p = S.players[k];
      var rate = performance.now() - p.ratingAt < 2500 ? p.rating : "";
      html += '<div class="chip' + (p.online ? "" : " off") + '" style="--c:' + p.color + '"><span>' +
        escapeHtml(p.name) + '</span><span class="sc">' + p.score + '</span><span class="rate">' + rate + "</span></div>";
    });
    $("players").innerHTML = html;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  function sendState(p) {
    send(p, {
      t: "state", loggedIn: S.loggedIn, playing: S.playing, score: p.score,
      reauth: S.playerStatus === "reauth", tvSpeaker: S.playerStatus,
      track: S.track ? { name: S.track.name, artist: artistOf(S.track) } : null,
      offset: S.offset,
      lyrics: S.lines.length ? "synced" : (S.lyrics && S.lyrics.plain ? "plain" : (S.track ? "none" : "")),
    });
  }
  function broadcastState() {
    Object.keys(S.players).forEach(function (k) { sendState(S.players[k]); });
  }
  function artistOf(t) {
    return (t.artists || []).map(function (a) { return a.name; }).join(", ");
  }

  // ---------- TV as Spotify speaker (Web Playback SDK) ----------
  function initPlayer() {
    if (!S.loggedIn || S.player || S.playerStatus === "loading") return;
    if (!SpotifyAPI.hasStreaming()) { S.playerStatus = "reauth"; updateLobby(); broadcastState(); return; }
    S.playerStatus = "loading";
    window.onSpotifyWebPlaybackSDKReady = function () {
      var player = new window.Spotify.Player({
        name: "SingStar TV",
        getOAuthToken: function (cb) { SpotifyAPI.accessToken().then(cb, function () {}); },
        volume: 0.8,
      });
      player.addListener("ready", function (e) {
        S.tvDevice = e.device_id; S.playerStatus = "ready";
        toast("🔊 TV is ready as Spotify speaker"); updateLobby(); broadcastState();
      });
      player.addListener("not_ready", function () { S.tvDevice = null; });
      player.addListener("initialization_error", function () { S.playerStatus = "unsupported"; updateLobby(); broadcastState(); });
      player.addListener("account_error", function () { S.playerStatus = "unsupported"; updateLobby(); broadcastState(); });
      player.addListener("authentication_error", function () {
        S.playerStatus = "reauth"; S.player = null; updateLobby(); broadcastState();
      });
      S.player = player;
      player.connect().then(function (ok) { if (!ok && S.playerStatus === "loading") { S.playerStatus = "unsupported"; updateLobby(); } });
    };
    var sc = document.createElement("script");
    sc.src = "https://sdk.scdn.co/spotify-player.js";
    sc.onerror = function () { S.playerStatus = "unsupported"; updateLobby(); };
    document.body.appendChild(sc);
  }
  // Browsers only allow sound after a key press / tap on the page.
  function activateSound() { if (S.player && S.player.activateElement) S.player.activateElement(); }
  document.addEventListener("keydown", activateSound);
  document.addEventListener("click", activateSound);

  function noDeviceMessage() {
    if (S.playerStatus === "reauth") return "Tap “Connect Spotify on the TV” once more on your phone – then the TV can play the music itself.";
    if (S.playerStatus === "unsupported") return "This TV browser can't play Spotify. Open the Spotify app on a phone, laptop or speaker (play & pause any song once), then tap Sing again.";
    if (S.playerStatus === "loading") return "The TV speaker is still starting – try again in a few seconds.";
    return "No Spotify device found. Open the Spotify app on a phone, laptop or speaker (play & pause any song once), then tap Sing again.";
  }

  // ---------- Spotify control ----------
  function doSearch(p, q) {
    if (!S.loggedIn) { send(p, { t: "error", msg: "Connect Spotify first." }); return; }
    if (!q.trim()) return;
    SpotifyAPI.api("GET", "/search?type=track&limit=10&q=" + encodeURIComponent(q)).then(function (r) {
      var items = ((r && r.tracks && r.tracks.items) || []).map(function (t) {
        var imgs = (t.album && t.album.images) || [];
        return { uri: t.uri, name: t.name, artist: artistOf(t), image: imgs.length ? imgs[imgs.length - 1].url : "" };
      });
      send(p, { t: "songs", items: items });
    }, function (e) { send(p, { t: "error", msg: e.message }); });
  }

  function withDevice(fn) {
    return fn("").catch(function (e) {
      if (e.status !== 404) throw e;
      return SpotifyAPI.api("GET", "/me/player/devices").then(function (r) {
        var devs = (r && r.devices) || [];
        var active = devs.filter(function (x) { return x.is_active; })[0];
        var id = active ? active.id : (S.tvDevice || (devs[0] && devs[0].id));
        if (!id) throw new Error(noDeviceMessage());
        if (id === S.tvDevice) activateSound();
        return fn(id);
      });
    });
  }

  function playUri(p, uri, queue) {
    if (!uri) return;
    var action = function (deviceId) {
      var dq = deviceId ? "device_id=" + encodeURIComponent(deviceId) : "";
      if (queue) return SpotifyAPI.api("POST", "/me/player/queue?uri=" + encodeURIComponent(uri) + (dq ? "&" + dq : ""));
      return SpotifyAPI.api("PUT", "/me/player/play" + (dq ? "?" + dq : ""), { uris: [uri] });
    };
    withDevice(action).then(function () {
      send(p, { t: "info", msg: queue ? "Added to queue" : "Starting…" });
      setTimeout(function () { poll(true); }, 700);
    }, function (e) {
      send(p, { t: "error", msg: e.reason === "PREMIUM_REQUIRED" ? "Spotify Premium is required." : e.message });
    });
  }

  function control(p, a) {
    var map = {
      pause: ["PUT", "/me/player/pause"], resume: ["PUT", "/me/player/play"],
      next: ["POST", "/me/player/next"], prev: ["POST", "/me/player/previous"],
    };
    if (a === "offset+" || a === "offset-") { changeOffset(a === "offset+" ? 0.1 : -0.1); return; }
    if (a === "restart") { SpotifyAPI.api("PUT", "/me/player/seek?position_ms=0").then(function () { poll(true); }, function () {}); return; }
    var c = map[a];
    if (!c || !S.loggedIn) return;
    withDevice(function (d) { return SpotifyAPI.api(c[0], c[1] + (d ? "?device_id=" + d : "")); })
      .then(function () { setTimeout(function () { poll(true); }, 500); }, function (e) { send(p, { t: "error", msg: e.message }); });
  }

  function changeOffset(delta) {
    S.offset = Math.round((S.offset + delta) * 10) / 10;
    localStorage.setItem("tv_offset", String(S.offset));
    toast("Lyrics timing " + (S.offset >= 0 ? "+" : "") + S.offset.toFixed(1) + " s");
    broadcastState();
  }

  var pollTimer = null;
  function poll(now) {
    clearTimeout(pollTimer);
    if (now !== true && S.pollBackoff > Date.now()) { pollTimer = setTimeout(poll, POLL_MS); return; }
    if (!S.loggedIn) { pollTimer = setTimeout(poll, POLL_MS); return; }
    var t0 = performance.now();
    SpotifyAPI.api("GET", "/me/player").then(function (r) {
      var mid = (t0 + performance.now()) / 2;
      if (!r || !r.item || r.item.type !== "track") { if (S.track) setTrack(null); S.playing = false; updateLobby(); return; }
      var prog = r.progress_ms / 1000;
      if (!S.track || S.track.id !== r.item.id) setTrack(r.item);
      var wasPlaying = S.playing;
      var predicted = S.anchorProg + (wasPlaying ? (mid - S.anchorPerf) / 1000 : 0);
      if (r.is_playing !== wasPlaying || Math.abs(predicted - prog) > 0.35) {
        S.anchorProg = prog; S.anchorPerf = mid;
      } else if (r.is_playing) {
        // gentle drift correction
        S.anchorProg = predicted + (prog - predicted) * 0.25;
        S.anchorPerf = mid;
      }
      if (r.is_playing !== wasPlaying) { S.playing = r.is_playing; broadcastState(); }
      S.playing = r.is_playing;
      updateLobby();
    }).catch(function (e) {
      if (e.status === 429) S.pollBackoff = Date.now() + 10000;
      if (!e.status && /invalid|revoked|not logged in/i.test(e.message || "")) {
        SpotifyAPI.logout(); S.loggedIn = false; updateLobby(); broadcastState();
      }
    }).then(function () { pollTimer = setTimeout(poll, POLL_MS); });
  }

  // ---------- song / lyrics ----------
  function setTrack(track) {
    var prev = S.track;
    if (prev && (!track || prev.id !== track.id)) maybeShowResults();
    S.track = track;
    S.lines = []; S.budget = []; S.lineStats = {}; S.nextFinal = 0; S.lyrics = null; S.resultsShown = false;
    S.anchorProg = 0; S.anchorPerf = performance.now();
    Object.keys(S.players).forEach(function (k) { var p = S.players[k]; p.score = 0; p.trail = []; p.rating = ""; });
    $("plain").classList.add("hidden");
    ["l0", "l1", "l2", "l3"].forEach(function (id) { $(id).textContent = ""; });
    if (!track) { $("title").textContent = ""; $("artist").textContent = ""; renderPlayers(); broadcastState(); return; }
    $("title").textContent = track.name;
    $("artist").textContent = artistOf(track);
    var imgs = (track.album && track.album.images) || [];
    $("bg").style.backgroundImage = imgs.length ? "url(" + imgs[0].url + ")" : "";
    $("l1").textContent = "Loading lyrics…";
    var id = track.id;
    Lyrics.find(track).then(function (res) {
      if (!S.track || S.track.id !== id) return;
      S.lyrics = res;
      $("l1").textContent = "";
      if (res && res.lines.length) {
        S.lines = res.lines;
        var total = 0;
        S.lines.forEach(function (l) { if (l.text) total += l.end - l.start; });
        S.budget = S.lines.map(function (l) { return l.text && total ? 10000 * (l.end - l.start) / total : 0; });
        resyncFinalPointer();
      } else if (res && res.instrumental) {
        $("l1").textContent = "♪ Instrumental ♪";
      } else if (res && res.plain) {
        $("plain").textContent = res.plain;
        $("plain").classList.remove("hidden");
        toast("Only unsynced lyrics found – no scoring for this song");
      } else {
        $("l1").textContent = "No lyrics found for this song 😕";
      }
      broadcastState();
    });
    renderPlayers();
    broadcastState();
  }

  function resyncFinalPointer() {
    var t = songTime();
    S.nextFinal = 0;
    while (S.nextFinal < S.lines.length && S.lines[S.nextFinal].end < t) S.nextFinal++;
  }

  function activeLine(t) {
    for (var i = 0; i < S.lines.length; i++) {
      var l = S.lines[i];
      if (l.start > t) return -1;
      if (l.text && t < l.end) return i;
    }
    return -1;
  }

  function finalizeLine(i) {
    var l = S.lines[i];
    if (!l.text) return;
    var dur = l.end - l.start;
    var stats = S.lineStats[i] || {};
    Object.keys(S.players).forEach(function (k) {
      var p = S.players[k];
      if (!p.online && !stats[k]) return;
      var s = stats[k] || { v: 0, s: 0 };
      var cov = Math.min(1, s.v / (dur * 0.6));
      var stab = s.v > 0 ? s.s / s.v : 0;
      var q = cov * (0.75 + 0.25 * stab);
      var pts = Math.round(S.budget[i] * q);
      p.score += pts;
      p.rating = q > 0.85 ? "PERFECT!" : q > 0.65 ? "GREAT" : q > 0.4 ? "GOOD" : q > 0.15 ? "OK" : "";
      p.ratingAt = performance.now();
      send(p, { t: "line", rating: p.rating, pts: pts, score: p.score });
    });
    delete S.lineStats[i];
    renderPlayers();
  }

  function maybeShowResults() {
    if (S.resultsShown) return;
    var list = Object.keys(S.players).map(function (k) { return S.players[k]; }).filter(function (p) { return p.score > 0; });
    if (!list.length) return;
    S.resultsShown = true;
    list.sort(function (a, b) { return b.score - a.score; });
    $("ranking").innerHTML = list.map(function (p, i) {
      return '<li style="color:' + p.color + '">' + (i === 0 ? "👑 " : "") + escapeHtml(p.name) + " – " + p.score + "</li>";
    }).join("");
    $("results").classList.remove("hidden");
    broadcast({ t: "results", ranking: list.map(function (p) { return { name: p.name, score: p.score }; }) });
    setTimeout(function () { $("results").classList.add("hidden"); }, 10000);
  }

  // ---------- render loop ----------
  var canvas = $("pitch"), ctx = canvas.getContext("2d");
  function resize() {
    var r = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * r;
    canvas.height = canvas.clientHeight * r;
  }
  window.addEventListener("resize", resize);

  var lastChips = 0, lastT = 0;
  function frame() {
    var t = songTime();
    // seek detection
    if (t < lastT - 1) resyncFinalPointer();
    lastT = t;

    if (S.lines.length) {
      while (S.nextFinal < S.lines.length && S.lines[S.nextFinal].end + 0.3 < t - LATENCY) {
        finalizeLine(S.nextFinal);
        S.nextFinal++;
      }
      if (S.nextFinal >= S.lines.length && !S.resultsShown) maybeShowResults();
      renderLyrics(t);
    }
    drawPitch(t);
    if (performance.now() - lastChips > 300) { lastChips = performance.now(); renderPlayers(); }
    requestAnimationFrame(frame);
  }

  function renderLyrics(t) {
    var L = S.lines, ci = -1;
    for (var i = 0; i < L.length; i++) { if (L[i].start <= t) ci = i; else break; }
    var cur = ci >= 0 ? L[ci] : null;
    $("l0").textContent = ci > 0 ? L[ci - 1].text : "";
    var curText = cur ? (cur.text || "♪") : "";
    $("l1").textContent = curText;
    var p = cur && cur.text ? Math.max(0, Math.min(1, (t - cur.start) / ((cur.end - cur.start) * 0.9))) : 0;
    $("l1").style.setProperty("--p", (p * 100).toFixed(1) + "%");
    $("l2").textContent = L[ci + 1] ? L[ci + 1].text : "";
    $("l3").textContent = L[ci + 2] ? L[ci + 2].text : "";
    // countdown before the next sung line
    var nxt = L[ci + 1];
    var gap = nxt && nxt.text && (!cur || !cur.text || t > cur.end) ? nxt.start - t : 99;
    $("countdown").textContent = gap < 3 && gap > 0 ? new Array(Math.ceil(gap) + 1).join("● ") : "";
  }

  function drawPitch(t) {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    var nowX = W * 0.75, pps = nowX / WINDOW_PAST;
    function X(tt) { return nowX + (tt - t) * pps; }
    // sung-line blocks
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.strokeStyle = "rgba(255,210,63,0.5)";
    ctx.lineWidth = 2;
    S.lines.forEach(function (l) {
      if (!l.text || l.end < t - WINDOW_PAST || l.start > t + WINDOW_FUTURE) return;
      var x0 = X(l.start), x1 = X(l.end);
      ctx.fillRect(x0, H * 0.08, x1 - x0, H * 0.84);
      ctx.beginPath(); ctx.moveTo(x0, H * 0.08); ctx.lineTo(x1, H * 0.08); ctx.stroke();
    });
    // player pitch trails
    var lw = Math.max(4, H * 0.025);
    Object.keys(S.players).forEach(function (k) {
      var p = S.players[k];
      if (!p.trail.length) return;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      var drawing = false, lastPt = null;
      for (var i = 0; i < p.trail.length; i++) {
        var pt = p.trail[i];
        if (pt.m === null || (lastPt && pt.t - lastPt.t > 0.25)) { drawing = false; lastPt = pt.m === null ? null : pt; if (pt.m === null) continue; }
        var rel = Math.max(-12, Math.min(12, pt.m - (p.med === null ? pt.m : p.med)));
        var y = H / 2 - rel * (H * 0.4 / 12);
        var x = X(pt.t);
        if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
        lastPt = pt;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }

  // ---------- lobby ----------
  function updateLobby() {
    var showLobby = !S.loggedIn || !S.track;
    $("lobby").classList.toggle("hidden", !showLobby);
    $("loginbox").classList.toggle("hidden", S.loggedIn);
    $("waitmsg").classList.toggle("hidden", !S.loggedIn);
    var sp = { ready: "🔊 Music plays on this TV (press OK on the remote once if there's no sound).",
      loading: "Setting up the TV as Spotify speaker…",
      unsupported: "This TV browser can't play Spotify itself – open the Spotify app on a phone, laptop or speaker.",
      reauth: "To play music on this TV, tap “Connect Spotify on the TV” once more on your phone." }[S.playerStatus] || "";
    $("speakermsg").textContent = S.loggedIn ? sp : "";
    if (!SpotifyAPI.isConfigured()) {
      $("loginmsg").textContent = "Setup missing: add your Spotify Client ID to config.js.";
      $("loginbtn").classList.add("hidden");
    } else if (!SpotifyAPI.canLoginHere()) {
      $("loginmsg").textContent = "Join with a phone and tap “Connect Spotify” there.";
      $("loginbtn").classList.add("hidden");
    }
  }

  // TV remote: left/right shifts lyrics timing
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") changeOffset(0.1);
    else if (e.key === "ArrowLeft") changeOffset(-0.1);
  });
  $("loginbtn").addEventListener("click", function () { SpotifyAPI.login(); });

  // ---------- boot ----------
  function boot() {
    resize();
    startPeer();
    SpotifyAPI.handleCallback().catch(function (e) { toast("Spotify login failed: " + e.message); })
      .then(function () {
        S.loggedIn = SpotifyAPI.hasLogin();
        updateLobby();
        poll(true);
        initPlayer();
      });
    requestAnimationFrame(frame);
    setInterval(broadcastState, 3000);
    if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(function () {});
  }
  boot();
})();
