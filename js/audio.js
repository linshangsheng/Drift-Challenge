/* 合成音效（WebAudio，不依赖外部素材）
 * 引擎：按后轮转速模拟换挡，空转时转速上扬
 * 轮胎：接近抓地极限时的黏滑尖啸 + 与滑动速度成正比的摩擦噪声，不同路面音色不同
 */
(function (DC) {
  'use strict';
  var ctx = null, master = null;
  var eng = null, squeal = null, scrub = null, roll = null;
  var enabled = true;

  // 各路面的声音特征：squeal 尖啸比例；scrub 摩擦噪声的滤波中心/类型/Q；grain 颗粒感
  var SURF_SOUND = {
    asphalt: { squeal: 1.0, f: 950, type: 'bandpass', q: 1.1, grain: 0.0, rollF: 420, scrub: 0.2 },
    wet: { squeal: 0.35, f: 2100, type: 'bandpass', q: 0.9, grain: 0.15, rollF: 1100, scrub: 0.15 },
    sand: { squeal: 0.1, f: 1300, type: 'bandpass', q: 0.9, grain: 0.75, rollF: 650, scrub: 0.17 },
    snow: { squeal: 0.0, f: 420, type: 'lowpass', q: 0.9, grain: 0.85, rollF: 260, scrub: 0.34 },
    ice: { squeal: 0.25, f: 3000, type: 'bandpass', q: 1.2, grain: 0.3, rollF: 1500, scrub: 0.11 }
  };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = enabled ? 0.7 : 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
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
  function noiseSrc() { var s = ctx.createBufferSource(); s.buffer = noiseBuffer(2.5); s.loop = true; s.start(); return s; }

  function buildLoops() {
    // ---- 引擎：基频 + 二次、三次谐波，低通随负载打开 ----
    var o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    var o2 = ctx.createOscillator(); o2.type = 'square';
    var o3 = ctx.createOscillator(); o3.type = 'sawtooth';
    var g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
    g1.gain.value = 0.6; g2.gain.value = 0.35; g3.gain.value = 0.2;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5; lp.frequency.value = 600;
    var eg = ctx.createGain(); eg.gain.value = 0;
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(lp); g2.connect(lp); g3.connect(lp); lp.connect(eg); eg.connect(master);
    [o1, o2, o3].forEach(function (o) { o.frequency.value = 50; o.start(); });
    eng = { o1: o1, o2: o2, o3: o3, lp: lp, g: eg, gear: 1 };

    // ---- 轮胎尖啸：两个失谐振荡器，频率被低频噪声扰动（黏滑），并做快速颤动 ----
    var s1 = ctx.createOscillator(); s1.type = 'sawtooth'; s1.frequency.value = 900;
    var s2 = ctx.createOscillator(); s2.type = 'triangle'; s2.frequency.value = 1340;
    var jitter = noiseSrc();
    var jlp = ctx.createBiquadFilter(); jlp.type = 'lowpass'; jlp.frequency.value = 25;
    var jg = ctx.createGain(); jg.gain.value = 160;
    jitter.connect(jlp); jlp.connect(jg); jg.connect(s1.frequency); jg.connect(s2.frequency);
    var trem = ctx.createOscillator(); trem.frequency.value = 38;
    var tg = ctx.createGain(); tg.gain.value = 0.35;
    var sMix = ctx.createGain(); sMix.gain.value = 0.6;
    trem.connect(tg); tg.connect(sMix.gain);
    var sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 1100; sbp.Q.value = 3;
    var sg = ctx.createGain(); sg.gain.value = 0;
    var s2g = ctx.createGain(); s2g.gain.value = 0.5;
    s1.connect(sMix); s2.connect(s2g); s2g.connect(sMix); sMix.connect(sbp); sbp.connect(sg); sg.connect(master);
    s1.start(); s2.start(); trem.start();
    squeal = { s1: s1, s2: s2, bp: sbp, g: sg, trem: trem };

    // ---- 滑动摩擦噪声（随路面变音色，带颗粒感调制） ----
    var nsrc = noiseSrc();
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 950; nf.Q.value = 1.1;
    var grainG = ctx.createGain(); grainG.gain.value = 1;
    var l1 = ctx.createOscillator(); l1.type = 'square'; l1.frequency.value = 17;
    var l2 = ctx.createOscillator(); l2.type = 'square'; l2.frequency.value = 29.3;
    var lg = ctx.createGain(); lg.gain.value = 0;
    l1.connect(lg); l2.connect(lg); lg.connect(grainG.gain);
    l1.start(); l2.start();
    var ng = ctx.createGain(); ng.gain.value = 0;
    nsrc.connect(nf); nf.connect(grainG); grainG.connect(ng); ng.connect(master);
    scrub = { f: nf, g: ng, grain: lg };

    // ---- 滚动噪声 ----
    var rsrc = noiseSrc();
    var rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 400;
    var rg = ctx.createGain(); rg.gain.value = 0;
    rsrc.connect(rl); rl.connect(rg); rg.connect(master);
    roll = { f: rl, g: rg };
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

  // 尖啸强度：接近峰值滑移最响，完全滑动后减弱但仍有
  function squealCurve(x) {
    if (x < 0.75) return 0;
    if (x < 1.3) return (x - 0.75) / 0.55;
    return 0.45 + 0.55 * Math.exp(-(x - 1.3) * 0.9);
  }

  var curSurf = null;

  // 测试用：离线渲染某种工况的声音并返回各频段能量
  function renderTest(o, sec) {
    var saved = [ctx, master, eng, squeal, scrub, roll, curSurf];
    var sr = 22050;
    ctx = new OfflineAudioContext(1, Math.floor(sr * sec), sr);
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    curSurf = null;
    buildLoops();
    DC.Audio.update(o);
    var c = ctx;
    var p = c.startRendering().then(function (buf) {
      var d = buf.getChannelData(0), N = 2048, start = d.length - N * 4, bands = [0, 0, 0, 0], rms = 0;
      for (var seg = 0; seg < 4; seg++) {
        var off = start + seg * N;
        for (var k = 1; k < N / 2; k += 3) {
          var re = 0, im = 0;
          for (var n = 0; n < N; n++) { var a = 2 * Math.PI * k * n / N; re += d[off + n] * Math.cos(a); im -= d[off + n] * Math.sin(a); }
          var f = k * sr / N, e = re * re + im * im;
          bands[f < 300 ? 0 : f < 1500 ? 1 : f < 4000 ? 2 : 3] += e;
        }
      }
      for (var i = start; i < d.length; i++) rms += d[i] * d[i];
      return { rms: Math.sqrt(rms / (d.length - start)), bands: bands.map(function (b) { return +(b / 1e3).toFixed(1); }) };
    });
    ctx = saved[0]; master = saved[1]; eng = saved[2]; squeal = saved[3]; scrub = saved[4]; roll = saved[5]; curSurf = saved[6];
    return p;
  }

  DC.Audio = {
    renderTest: renderTest,
    unlock: ensure,
    setEnabled: function (on) {
      enabled = on;
      if (master) master.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05);
    },
    // o: { speedN, wheelN, slip(滑移率/峰值), slideV(接地点滑动速度 m/s), surface, running, boost, air }
    update: function (o) {
      if (!ctx || !eng) return;
      var t = ctx.currentTime;
      if (!o || !o.running) {
        eng.g.gain.setTargetAtTime(0, t, 0.1);
        squeal.g.gain.setTargetAtTime(0, t, 0.05);
        scrub.g.gain.setTargetAtTime(0, t, 0.05);
        roll.g.gain.setTargetAtTime(0, t, 0.1);
        return;
      }
      var sp = Math.max(0, Math.min(1.5, o.speedN || 0));
      var wn = Math.max(0, Math.min(1.8, o.wheelN || sp));
      // 5 挡变速：每挡内转速上升，换挡回落
      var gears = 5, pos = wn * gears * 0.92;
      var gear = Math.min(gears, Math.floor(pos) + 1);
      if (gear < eng.gear && pos > eng.gear - 1.15) gear = eng.gear; // 降挡迟滞
      eng.gear = gear;
      var inGear = Math.max(0, Math.min(1.25, pos - (gear - 1)));
      var rpm = 0.28 + 0.62 * inGear + (o.air ? 0.15 : 0);
      var base = 38 + rpm * 150;
      eng.o1.frequency.setTargetAtTime(base, t, 0.04);
      eng.o2.frequency.setTargetAtTime(base * 0.5, t, 0.04);
      eng.o3.frequency.setTargetAtTime(base * 1.5, t, 0.04);
      eng.lp.frequency.setTargetAtTime(350 + rpm * 1700 + (o.boost ? 600 : 0), t, 0.06);
      eng.g.gain.setTargetAtTime(0.06 + rpm * 0.06 + (o.boost ? 0.03 : 0), t, 0.08);

      var S = SURF_SOUND[o.surface] || SURF_SOUND.asphalt;
      if (curSurf !== o.surface) {
        curSurf = o.surface;
        scrub.f.type = S.type;
        scrub.f.Q.setTargetAtTime(S.q, t, 0.1);
      }
      var slip = o.slip || 0, slideV = o.slideV || 0;
      var load = Math.min(1, 0.4 + sp * 0.6);
      // 尖啸
      var sq = squealCurve(slip) * S.squeal * load * Math.min(1, slideV / 2.5);
      squeal.g.gain.setTargetAtTime(Math.min(0.55, sq * 0.55), t, sq > 0.05 ? 0.025 : 0.07);
      var pitch = 780 + Math.min(1, slip / 3) * 420 + sp * 220;
      squeal.s1.frequency.setTargetAtTime(pitch, t, 0.05);
      squeal.s2.frequency.setTargetAtTime(pitch * 1.49, t, 0.05);
      squeal.bp.frequency.setTargetAtTime(pitch * 1.2, t, 0.05);
      squeal.trem.frequency.setTargetAtTime(28 + slip * 6, t, 0.1);
      // 滑动摩擦噪声
      var sc = Math.min(1, slideV / 16);
      scrub.g.gain.setTargetAtTime(sc * S.scrub, t, 0.03);
      scrub.f.frequency.setTargetAtTime(S.f * (0.8 + sc * 0.5), t, 0.05);
      scrub.grain.gain.setTargetAtTime(S.grain * 0.5, t, 0.1);
      // 滚动噪声
      roll.g.gain.setTargetAtTime(o.air ? 0 : sp * 0.055, t, 0.08);
      roll.f.frequency.setTargetAtTime(S.rollF * (0.6 + sp * 0.8), t, 0.1);
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
