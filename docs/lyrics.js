// Synced lyrics from LRCLIB (https://lrclib.net) + LRC parsing.
(function (root) {
  "use strict";

  function cleanTitle(t) {
    return String(t || "")
      .replace(/\s*[-–]\s*(\d{4}\s+)?(remaster(ed)?|live|radio edit|single version|mono|stereo|edit|version|bonus track).*$/i, "")
      .replace(/\s*\((feat|ft|with)\.?[^)]*\)/i, "")
      .replace(/\s*\[[^\]]*\]/g, "")
      .trim();
  }

  // Parses LRC text into [{ start, end, text }] (seconds).
  function parseLRC(lrc) {
    var lines = [];
    String(lrc || "").split(/\r?\n/).forEach(function (raw) {
      var re = /\[(\d{1,2}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g, m, stamps = [], last = 0;
      while ((m = re.exec(raw))) {
        stamps.push(Number(m[1]) * 60 + Number(m[2].replace(":", ".")));
        last = re.lastIndex;
      }
      if (!stamps.length) return;
      var text = raw.slice(last).replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, "").trim();
      stamps.forEach(function (s) { lines.push({ start: s, text: text }); });
    });
    lines.sort(function (a, b) { return a.start - b.start; });
    for (var i = 0; i < lines.length; i++) {
      var next = i + 1 < lines.length ? lines[i + 1].start : lines[i].start + 6;
      var est = Math.min(8, Math.max(2.5, lines[i].text.length * 0.12));
      lines[i].end = Math.min(next, lines[i].start + est);
    }
    return lines.filter(function (l, i) { return l.text || i === 0 || lines[i - 1].text; });
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // Returns { lines: [...], plain: "..." } or null.
  function find(track) {
    var title = cleanTitle(track.name);
    var artist = track.artists && track.artists[0] ? track.artists[0].name : "";
    var duration = Math.round((track.duration_ms || 0) / 1000);
    var q = new URLSearchParams({ track_name: title, artist_name: artist, album_name: (track.album && track.album.name) || "", duration: String(duration) });
    return fetchJSON("https://lrclib.net/api/get?" + q.toString()).then(function (hit) {
      if (hit && hit.syncedLyrics) return hit;
      var s = new URLSearchParams({ track_name: title, artist_name: artist });
      return fetchJSON("https://lrclib.net/api/search?" + s.toString()).then(function (list) {
        if (!list || !list.length) return hit;
        var synced = list.filter(function (x) { return x.syncedLyrics; });
        synced.sort(function (a, b) { return Math.abs(a.duration - duration) - Math.abs(b.duration - duration); });
        return synced[0] || hit || list[0];
      });
    }).then(function (hit) {
      if (!hit) return null;
      return { lines: hit.syncedLyrics ? parseLRC(hit.syncedLyrics) : [], plain: hit.plainLyrics || "", instrumental: !!hit.instrumental };
    });
  }

  var api = { cleanTitle: cleanTitle, parseLRC: parseLRC, find: find };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Lyrics = api;
})(this);
