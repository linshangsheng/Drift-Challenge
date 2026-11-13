/* 合成音效（WebAudio，不依赖外部素材） */
(function (DC) {
  'use strict';
  var ctx = null, master = null;
  var engine = null, screech = null;
  var enabled = true;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = enabled ? 0.6 : 0;
    master.connect(ctx.destination);
    buildLoops();
    return true;
  }

  function noiseBuffer(sec) {
    var len = Math.floor(ctx.sampleRate * sec);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function buildLoops() {
    // 引擎
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    var o2 = ctx.createOscillator(); o2.type = 'square';
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 3;
    var g = ctx.createGain(); g.gain.value = 0;
    var g2 = ctx.createGain(); g2.gain.value = 0.4;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
    o1.frequency.value = 60; o2.frequency.value = 30;
    o1.start(); o2.start();
    engine = { o1: o1, o2: o2, lp: lp, g: g };

    // 轮胎尖啸
    var src = ctx.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 4;
    var sg = ctx.createGain(); sg.gain.value = 0;
    src.connect(bp); bp.connect(sg); sg.connect(master);
    src.start();
    screech = { src: src, bp: bp, g: sg };
  }

  function tone(freq, dur, type, vol, when, slideTo) {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator(); o.type = type || 'sine';
    var g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseBurst(dur, freq, vol, when) {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime + (when || 0);
    var s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.1);
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.1);
  }

  DC.Audio = {
    unlock: ensure,
    setEnabled: function (on) {
      enabled = on;
      if (master) master.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.05);
    },
    // speedN: 0~1, drift: 0~1, running: 是否在比赛中
    update: function (speedN, drift, running) {
      if (!ctx || !engine) return;
      var t = ctx.currentTime;
      var base = 55 + speedN * 110 + drift * 25;
      engine.o1.frequency.setTargetAtTime(base, t, 0.08);
      engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
      engine.lp.frequency.setTargetAtTime(400 + speedN * 1400 + drift * 500, t, 0.1);
      engine.g.gain.setTargetAtTime(running ? 0.09 + speedN * 0.05 : 0, t, 0.1);
      screech.g.gain.setTargetAtTime(running ? Math.min(0.18, drift * 0.22) : 0, t, 0.05);
      screech.bp.frequency.setTargetAtTime(1200 + drift * 900, t, 0.1);
    },
    pickup: function () { tone(660, 0.12, 'square', 0.15); tone(990, 0.15, 'square', 0.12, 0.06); },
    merge: function (level) {
      var b = 330 * Math.pow(1.02, level);
      tone(b, 0.12, 'triangle', 0.25); tone(b * 1.26, 0.12, 'triangle', 0.25, 0.07); tone(b * 1.5, 0.25, 'triangle', 0.25, 0.14);
    },
    levelUp: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'sawtooth', 0.14, i * 0.09); });
      tone(1047, 0.6, 'triangle', 0.2, 0.36);
    },
    fall: function () { tone(500, 1.4, 'sine', 0.3, 0, 60); noiseBurst(1.2, 2000, 0.25, 0.1); },
    crash: function () { noiseBurst(0.6, 3000, 0.4); },
    shield: function () { tone(300, 0.4, 'sine', 0.3, 0, 1200); tone(1200, 0.3, 'triangle', 0.15, 0.2); },
    click: function () { tone(880, 0.05, 'square', 0.08); },
    buy: function () { tone(784, 0.1, 'square', 0.12); tone(1175, 0.2, 'square', 0.12, 0.08); },
    deny: function () { tone(200, 0.2, 'square', 0.12); },
    countdown: function (go) { tone(go ? 880 : 440, go ? 0.4 : 0.15, 'square', 0.15); }
  };
})(window.DC);
