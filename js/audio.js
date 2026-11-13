/* 合成音效（WebAudio，不依赖外部素材） */
(function (DC) {
  'use strict';
  var ctx = null, master = null;
  var engine = null, screech = null, rumble = null;
  var enabled = true;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = enabled ? 0.6 : 0;
    var comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
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
    // 引擎：两个谐波 + 低通
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    var o2 = ctx.createOscillator(); o2.type = 'square';
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 3;
    var g = ctx.createGain(); g.gain.value = 0;
    var g2 = ctx.createGain(); g2.gain.value = 0.4;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
    o1.frequency.value = 60; o2.frequency.value = 30;
    o1.start(); o2.start();
    engine = { o1: o1, o2: o2, lp: lp, g: g };

    // 轮胎尖啸：窄带噪声 + 带颤音的尖锐音调
    var src = ctx.createBufferSource(); src.buffer = noiseBuffer(2); src.loop = true;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 7;
    var bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 3200; bp2.Q.value = 9;
    var ng = ctx.createGain(); ng.gain.value = 0.9;
    src.connect(bp); src.connect(bp2); bp.connect(ng); bp2.connect(ng);
    var sq = ctx.createOscillator(); sq.type = 'triangle'; sq.frequency.value = 1100;
    var vib = ctx.createOscillator(); vib.frequency.value = 23;
    var vibG = ctx.createGain(); vibG.gain.value = 60;
    vib.connect(vibG); vibG.connect(sq.frequency);
    var am = ctx.createOscillator(); am.frequency.value = 13;
    var amG = ctx.createGain(); amG.gain.value = 0.35;
    var sqG = ctx.createGain(); sqG.gain.value = 0.5;
    am.connect(amG); amG.connect(sqG.gain);
    sq.connect(sqG);
    var sg = ctx.createGain(); sg.gain.value = 0;
    ng.connect(sg); sqG.connect(sg); sg.connect(master);
    src.start(); sq.start(); vib.start(); am.start();
    screech = { src: src, bp: bp, sq: sq, g: sg };

    // 路面滚动噪声
    var rs = ctx.createBufferSource(); rs.buffer = noiseBuffer(2); rs.loop = true;
    var rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 400;
    var rg = ctx.createGain(); rg.gain.value = 0;
    rs.connect(rl); rl.connect(rg); rg.connect(master);
    rs.start();
    rumble = { g: rg, f: rl };
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

  function noiseBurst(dur, freq, vol, when, endFreq) {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime + (when || 0);
    var s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.1);
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(endFreq || 80, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.1);
  }

  var lastDrift = 0;
  DC.Audio = {
    unlock: ensure,
    setEnabled: function (on) {
      enabled = on;
      if (master) master.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.05);
    },
    // speedN: 当前车速/极速, drift: 0~1 侧滑强度
    update: function (speedN, drift, running, boost) {
      if (!ctx || !engine) return;
      var t = ctx.currentTime;
      speedN = Math.max(0, Math.min(1.4, speedN || 0));
      var base = 55 + speedN * 120 + drift * 18 + (boost ? 30 : 0);
      engine.o1.frequency.setTargetAtTime(base, t, 0.08);
      engine.o2.frequency.setTargetAtTime(base * 0.5, t, 0.08);
      engine.lp.frequency.setTargetAtTime(400 + speedN * 1500 + drift * 400, t, 0.1);
      engine.g.gain.setTargetAtTime(running ? 0.08 + speedN * 0.05 : 0, t, 0.1);
      // 尖啸声随侧滑强度变化，起漂瞬间更响
      var attack = Math.max(0, drift - lastDrift) * 2;
      lastDrift = drift;
      var sv = running ? Math.min(0.42, Math.pow(drift, 0.8) * 0.36 + attack * 0.2) : 0;
      screech.g.gain.setTargetAtTime(sv, t, drift > 0.1 ? 0.02 : 0.08);
      screech.bp.frequency.setTargetAtTime(1500 + drift * 700 + speedN * 300, t, 0.05);
      screech.sq.frequency.setTargetAtTime(950 + drift * 350 + speedN * 150, t, 0.05);
      rumble.g.gain.setTargetAtTime(running ? speedN * 0.06 : 0, t, 0.1);
      rumble.f.frequency.setTargetAtTime(250 + speedN * 400, t, 0.1);
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
    land: function (impact) { var v = Math.min(0.6, 0.15 + impact * 0.025); noiseBurst(0.35, 900, v, 0, 60); tone(90, 0.25, 'sine', v, 0, 40); },
    boost: function () { noiseBurst(0.8, 6000, 0.25, 0, 400); tone(300, 0.6, 'sawtooth', 0.1, 0, 900); },
    shield: function () { tone(300, 0.4, 'sine', 0.3, 0, 1200); tone(1200, 0.3, 'triangle', 0.15, 0.2); },
    click: function () { tone(880, 0.05, 'square', 0.08); },
    buy: function () { tone(784, 0.1, 'square', 0.12); tone(1175, 0.2, 'square', 0.12, 0.08); },
    deny: function () { tone(200, 0.2, 'square', 0.12); },
    countdown: function (go) { tone(go ? 880 : 440, go ? 0.4 : 0.15, 'square', 0.15); }
  };
})(window.DC);
