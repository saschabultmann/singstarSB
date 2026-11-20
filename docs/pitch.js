// Pitch detection (YIN algorithm) – shared by the mic page and tests.
(function (root) {
  "use strict";

  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // Returns { freq, confidence } or null if no clear pitch.
  function yin(buf, sampleRate, opts) {
    opts = opts || {};
    var threshold = opts.threshold || 0.15;
    var minFreq = opts.minFreq || 70;
    var maxFreq = opts.maxFreq || 1100;
    var half = buf.length >> 1;
    var tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    var tauMax = Math.min(half - 1, Math.floor(sampleRate / minFreq));
    var d = new Float32Array(tauMax + 1);
    var tau, i, delta, sum;

    for (tau = 1; tau <= tauMax; tau++) {
      sum = 0;
      for (i = 0; i < half; i++) {
        delta = buf[i] - buf[i + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }
    // cumulative mean normalized difference
    d[0] = 1;
    var running = 0;
    for (tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) return null;
    // parabolic interpolation
    var betterTau = best;
    if (best > 1 && best < tauMax) {
      var s0 = d[best - 1], s1 = d[best], s2 = d[best + 1];
      var denom = 2 * (2 * s1 - s2 - s0);
      if (denom !== 0) betterTau = best + (s2 - s0) / denom;
    }
    return { freq: sampleRate / betterTau, confidence: 1 - d[best] };
  }

  function rms(buf) {
    var s = 0;
    for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function freqToMidi(f) {
    return 69 + 12 * Math.log(f / 440) / Math.LN2;
  }

  function midiToName(m) {
    var n = Math.round(m);
    return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  var api = { yin: yin, rms: rms, freqToMidi: freqToMidi, midiToName: midiToName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pitch = api;
})(this);
