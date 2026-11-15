/* 音效（WebAudio）
 * 引擎：合成，按后轮转速模拟换挡，空转时转速上扬
 * 轮胎尖啸：真实录音循环播放（js/skidSound.js，CC0），音调和音量随滑动速度变化，两路错开播放避免听出循环
 * 路面摩擦噪声：合成，与滑动速度成正比，不同路面音色不同（雪地、沙地主要是这个声音）
 */
(function (DC) {
  'use strict';
  var ctx = null, master = null;
  var eng = null, squeal = null, scrub = null, roll = null;
  var enabled = true;

  // 各路面的声音特征：squeal 尖啸音量比例、rate 尖啸音调、lp 尖啸的低通（湿路发闷）；
  // scrub 摩擦噪声的滤波中心/类型/Q；grain 颗粒感
  var SURF_SOUND = {
    asphalt: { squeal: 1.0, rate: 1.0, lp: 9000, f: 950, type: 'bandpass', q: 1.1, grain: 0.0, rollF: 420, scrub: 0.1 },
    wet: { squeal: 0.4, rate: 0.93, lp: 2800, f: 2100, type: 'bandpass', q: 0.9, grain: 0.15, rollF: 1100, scrub: 0.16 },
    sand: { squeal: 0.08, rate: 0.85, lp: 2200, f: 1300, type: 'bandpass', q: 0.9, grain: 0.75, rollF: 650, scrub: 0.19 },
    snow: { squeal: 0.0, rate: 0.8, lp: 1500, f: 420, type: 'lowpass', q: 0.9, grain: 0.85, rollF: 260, scrub: 0.34 },
    ice: { squeal: 0.28, rate: 1.22, lp: 7000, f: 3000, type: 'bandpass', q: 1.2, grain: 0.3, rollF: 1500, scrub: 0.11 }
  };

  // ---- 轮胎尖啸录音：解析内嵌的 WAV ----
  var skidPCM = null; // { sr, data: Float32Array }
  function skidSamples() {
    if (skidPCM !== null) return skidPCM;
    skidPCM = false;
    try {
      var b64 = DC.SKID_WAV;
      if (!b64) return skidPCM;
      var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
      for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
      var dv = new DataView(bytes.buffer), sr = dv.getUint32(24, true), p = 12, off = -1, len = 0;
      while (p + 8 <= n) {
        var id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]), sz = dv.getUint32(p + 4, true);
        if (id === 'data') { off = p + 8; len = sz; break; }
        p += 8 + sz + (sz & 1);
      }
      if (off < 0) return skidPCM;
      var cnt = Math.floor(Math.min(len, n - off) / 2), data = new Float32Array(cnt);
      for (var j = 0; j < cnt; j++) data[j] = dv.getInt16(off + j * 2, true) / 32768;
      skidPCM = { sr: sr, data: data };
    } catch (e) { skidPCM = false; }
    return skidPCM;
  }
  function skidBuffer() {
    var pcm = skidSamples();
    if (!pcm) return null;
    var buf = ctx.createBuffer(1, pcm.data.length, pcm.sr);
    buf.getChannelData(0).set(pcm.data);
    return buf;
  }

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
    // 低频调幅：模拟柴油机的突突声和 V8 的律动
    var lope = ctx.createOscillator(); lope.type = 'sine'; lope.frequency.value = 12;
    var lopeG = ctx.createGain(); lopeG.gain.value = 0;
    lope.connect(lopeG); lopeG.connect(eg.gain); lope.start();
    // 电机啸叫用的高频噪声
    var wn = noiseSrc();
    var wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 3000; wf.Q.value = 6;
    var wg = ctx.createGain(); wg.gain.value = 0;
    wn.connect(wf); wf.connect(wg); wg.connect(eg);
    eng = { o1: o1, o2: o2, o3: o3, g1: g1, g2: g2, g3: g3, lp: lp, g: eg, gear: 1, lope: lope, lopeG: lopeG, wf: wf, wg: wg, applied: null };

    // ---- 轮胎尖啸：真实录音，两路错开起点、略微失谐，避免听出循环 ----
    var sg = ctx.createGain(); sg.gain.value = 0;
    var slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 9000; slp.Q.value = 0.5;
    slp.connect(sg); sg.connect(master);
    var buf = skidBuffer(), voices = [];
    if (buf) {
      [[0, 0.62, 1], [buf.duration * 0.47, 0.45, 1.035]].forEach(function (v) {
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        var vg = ctx.createGain(); vg.gain.value = v[1];
        src.connect(vg); vg.connect(slp);
        src.start(0, v[0]);
        voices.push({ src: src, k: v[2] });
      });
    } else {
      // 没有录音时的备用：合成尖啸
      var s1 = ctx.createOscillator(); s1.type = 'sawtooth'; s1.frequency.value = 1150;
      var sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 1250; sbp.Q.value = 4;
      s1.connect(sbp); sbp.connect(slp); s1.start();
    }
    squeal = { g: sg, lp: slp, voices: voices, buf: buf };

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

  var curSurf = null;
  // 各类引擎的音色：w 波形，g 三个振荡器的音量，h 另外两个振荡器相对基频的倍数，
  // base/range 基频与转速范围，lp 低通滤波，lope 低频调幅深度与频率，whine 电机啸叫
  var ENGINES = {
    i4: { w: ['sawtooth', 'square', 'sawtooth'], g: [0.6, 0.35, 0.2], h: [0.5, 1.5], base: 38, range: 150, gears: 5, lp: [350, 1700], vol: 1, lope: 0, lopeF: 12, whine: 0 },
    v8: { w: ['sawtooth', 'square', 'triangle'], g: [0.65, 0.6, 0.2], h: [0.5, 0.75], base: 29, range: 100, gears: 5, lp: [260, 1250], vol: 1.0, lope: 0.28, lopeF: 9, whine: 0 },
    exotic: { w: ['sawtooth', 'sawtooth', 'sawtooth'], g: [0.5, 0.25, 0.42], h: [0.5, 2.0], base: 55, range: 240, gears: 6, lp: [520, 2900], vol: 1.55, lope: 0, lopeF: 12, whine: 0 },
    diesel: { w: ['square', 'square', 'sawtooth'], g: [0.55, 0.55, 0.12], h: [0.5, 1.5], base: 24, range: 62, gears: 4, lp: [200, 750], vol: 0.95, lope: 0.5, lopeF: 13, whine: 0 },
    ev: { w: ['sine', 'sine', 'triangle'], g: [0.5, 0.25, 0.2], h: [2.0, 3.0], base: 160, range: 760, gears: 1, lp: [2500, 5000], vol: 0.6, lope: 0, lopeF: 12, whine: 0.035 }
  };
  var engType = 'i4';

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

  // ---------- 背景音乐：程序合成的步进音序器 ----------
  // 和弦进行 Am - F - C - G，16 分音符网格
  var music = { on: true, mode: 'off', gain: null, timer: null, step: 0, nextT: 0, bpm: 126 };
  var CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // MIDI 音高
  var ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function mNote(freq, t, dur, type, vol, cutoff) {
    var o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff) {
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.Q.value = 2;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(music.gain);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function mNoise(t, dur, vol, hp) {
    var s = ctx.createBufferSource(); s.buffer = music.noise;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(music.gain);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function mKick(t) {
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(music.gain); o.start(t); o.stop(t + 0.22);
  }
  function scheduleStep(step, t) {
    var race = music.mode === 'race';
    var bar = Math.floor(step / 16) % 4, s16 = step % 16, chord = CHORDS[bar];
    var d = 60 / music.bpm / 4;
    // 和弦铺底（每小节一次）
    if (s16 === 0) {
      for (var i = 0; i < 3; i++) {
        mNote(mtof(chord[i]), t, d * 15.5, 'sawtooth', race ? 0.035 : 0.05, 700);
        mNote(mtof(chord[i]) * 1.006, t, d * 15.5, 'sawtooth', race ? 0.025 : 0.035, 600);
      }
    }
    // 琶音
    if (s16 % 2 === 0) {
      var n = chord[ARP[(s16 / 2) % 8]] + 12 + (Math.floor(step / 64) % 2 ? 12 : 0);
      mNote(mtof(n), t, d * 1.7, 'triangle', race ? 0.07 : 0.05);
    }
    if (race) {
      // 贝斯：16 分音符律动
      var bn = chord[0] - 24 + (s16 % 8 === 6 ? 12 : 0);
      if (s16 % 4 !== 1) mNote(mtof(bn), t, d * 0.9, 'sawtooth', 0.16, 320 + (s16 % 4 === 0 ? 250 : 0));
      if (s16 % 4 === 0) mKick(t);
      if (s16 % 8 === 4) mNoise(t, 0.13, 0.22, 1800);       // 军鼓
      if (s16 % 2 === 0) mNoise(t, s16 % 4 === 2 ? 0.07 : 0.03, 0.07, 7000); // 踩镲
      if (s16 === 14 && bar === 3) { mNoise(t, 0.1, 0.16, 2500); mNoise(t + d, 0.1, 0.18, 2500); } // 过门
    } else if (s16 === 0 && bar % 2 === 0) {
      mNote(mtof(chord[0] - 12), t, d * 14, 'sine', 0.14);
    }
  }
  function musicTick() {
    if (!ctx || music.mode === 'off' || !music.on || ctx.state !== 'running') return;
    var d = 60 / music.bpm / 4;
    if (music.nextT < ctx.currentTime) music.nextT = ctx.currentTime + 0.05;
    while (music.nextT < ctx.currentTime + 0.35) {
      scheduleStep(music.step, music.nextT);
      music.step++;
      music.nextT += d;
    }
  }
  function setMusicMode(mode) {
    music.mode = mode;
    if (!ctx) return;
    if (!music.gain) {
      music.gain = ctx.createGain(); music.gain.gain.value = 0;
      music.gain.connect(master);
      music.noise = noiseBuffer(1);
    }
    var target = !music.on || mode === 'off' ? 0 : (mode === 'race' ? 0.3 : 0.3);
    music.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.4);
    music.bpm = mode === 'race' ? 132 : 104;
    if (!music.timer) music.timer = setInterval(musicTick, 90);
  }

  // 页面切到后台时暂停所有声音，回来时恢复
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    try { if (document.hidden) ctx.suspend(); else ctx.resume(); } catch (e) { /* 忽略 */ }
  });

  DC.Audio = {
    renderTest: renderTest,
    unlock: function () {
      var ok = ensure();
      if (ok && music.mode !== 'off' && !music.gain) setMusicMode(music.mode);
      return ok;
    },
    setMusicMode: setMusicMode,
    setEngine: function (type) { engType = ENGINES[type] ? type : 'i4'; },
    setMusicEnabled: function (on) { music.on = on; setMusicMode(music.mode); },
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
      var E = ENGINES[engType] || ENGINES.i4;
      if (eng.applied !== engType) {
        eng.applied = engType;
        eng.o1.type = E.w[0]; eng.o2.type = E.w[1]; eng.o3.type = E.w[2];
        eng.g1.gain.setTargetAtTime(E.g[0], t, 0.05); eng.g2.gain.setTargetAtTime(E.g[1], t, 0.05); eng.g3.gain.setTargetAtTime(E.g[2], t, 0.05);
      }
      var rpm;
      if (E.gears <= 1) {
        rpm = Math.min(1.3, wn); // 电机：没有挡位，转速直接跟车速
      } else {
        // 变速箱：每挡内转速上升，换挡回落
        var pos = wn * E.gears * 0.92;
        var gear = Math.min(E.gears, Math.floor(pos) + 1);
        if (gear < eng.gear && pos > eng.gear - 1.15) gear = eng.gear; // 降挡迟滞
        eng.gear = gear;
        var inGear = Math.max(0, Math.min(1.25, pos - (gear - 1)));
        rpm = 0.28 + 0.62 * inGear + (o.air ? 0.15 : 0);
      }
      var base = E.base + rpm * E.range;
      eng.o1.frequency.setTargetAtTime(base, t, 0.04);
      eng.o2.frequency.setTargetAtTime(base * E.h[0], t, 0.04);
      eng.o3.frequency.setTargetAtTime(base * E.h[1], t, 0.04);
      eng.lp.frequency.setTargetAtTime(E.lp[0] + rpm * E.lp[1] + (o.boost ? 600 : 0), t, 0.06);
      var ev = (0.06 + rpm * 0.06 + (o.boost ? 0.03 : 0)) * E.vol;
      eng.g.gain.setTargetAtTime(ev, t, 0.08);
      eng.lope.frequency.setTargetAtTime(E.lopeF * (0.6 + rpm), t, 0.1);
      eng.lopeG.gain.setTargetAtTime(ev * E.lope, t, 0.1);
      eng.wf.frequency.setTargetAtTime(1500 + rpm * 4500, t, 0.05);
      eng.wg.gain.setTargetAtTime(E.whine * (0.3 + rpm), t, 0.08);

      var S = SURF_SOUND[o.surface] || SURF_SOUND.asphalt;
      if (curSurf !== o.surface) {
        curSurf = o.surface;
        scrub.f.type = S.type;
        scrub.f.Q.setTargetAtTime(S.q, t, 0.1);
      }
      var slip = o.slip || 0, slideV = o.slideV || 0;
      var load = Math.min(1, 0.4 + sp * 0.6);
      // 尖啸：超过抓地极限后出现，滑得越快越响、音调越高；音调带一点随机抖动（黏滑）
      var on = slip < 0.8 ? 0 : Math.min(1, (slip - 0.8) / 0.5);
      var sv = Math.min(1, slideV / 22);
      var sq = on * S.squeal * load * Math.min(1, slideV / 3) * (0.55 + 0.45 * sv);
      squeal.g.gain.setTargetAtTime(Math.min(0.62, sq * 0.62), t, sq > squeal.g.gain.value ? 0.02 : 0.06);
      var rate = S.rate * (0.86 + 0.16 * sv + 0.06 * Math.min(1, sp)) * (1 + (Math.random() - 0.5) * 0.035);
      for (var vi = 0; vi < squeal.voices.length; vi++) squeal.voices[vi].src.playbackRate.setTargetAtTime(rate * squeal.voices[vi].k, t, 0.035);
      squeal.lp.frequency.setTargetAtTime(S.lp, t, 0.1);
      // 滑动摩擦噪声
      var sc = Math.min(1, slideV / 16);
      scrub.g.gain.setTargetAtTime(sc * S.scrub, t, 0.03);
      scrub.f.frequency.setTargetAtTime(S.f * (0.8 + sc * 0.5), t, 0.05);
      scrub.grain.gain.setTargetAtTime(S.grain * 0.5, t, 0.1);
      // 滚动噪声
      roll.g.gain.setTargetAtTime(o.air ? 0 : sp * 0.055, t, 0.08);
      roll.f.frequency.setTargetAtTime(S.rollF * (0.6 + sp * 0.8), t, 0.1);
    },
    // 排气回火：几声短促的低频爆音
    backfire: function () {
      if (!ctx || !enabled) return;
      var n = 2 + Math.floor(Math.random() * 3);
      for (var i = 0; i < n; i++) { var w = i * (0.05 + Math.random() * 0.05); noiseBurst(0.07, 1400, 0.35, w, 120); tone(70 + Math.random() * 30, 0.06, 'square', 0.18, w, 40); }
    },
    // 起漂瞬间的轮胎啾声
    chirp: function (k) {
      if (!ctx || !enabled) return;
      if (squeal && squeal.buf) {
        var t0 = ctx.currentTime, src = ctx.createBufferSource(), gg = ctx.createGain();
        src.buffer = squeal.buf; src.playbackRate.value = 1.08 + Math.random() * 0.06;
        gg.gain.setValueAtTime(0.0001, t0); gg.gain.exponentialRampToValueAtTime(0.42 * (k || 1), t0 + 0.012); gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
        src.connect(gg); gg.connect(master); src.start(t0, Math.random() * (squeal.buf.duration - 0.4)); src.stop(t0 + 0.3);
        return;
      }
      var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(950, t + 0.18);
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2 * (k || 1), t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
    },
    coin: function (chain) { tone(1050 * Math.pow(1.06, chain || 0), 0.09, 'square', 0.07); tone(1575 * Math.pow(1.06, chain || 0), 0.12, 'triangle', 0.08, 0.03); },
    power: function () { [660, 880, 1320].forEach(function (f, i) { tone(f, 0.16, 'triangle', 0.16, i * 0.07); }); },
    comboUp: function (mult) { tone(520 * Math.pow(1.19, mult), 0.1, 'triangle', 0.18); tone(780 * Math.pow(1.19, mult), 0.14, 'triangle', 0.14, 0.05); },
    cash: function (big) {
      [1318, 1568, 2093].forEach(function (f, i) { tone(f, 0.12, 'square', 0.08, i * 0.06); });
      if (big) tone(2637, 0.35, 'triangle', 0.12, 0.2);
    },
    comboLost: function () { tone(330, 0.25, 'sawtooth', 0.12, 0, 160); },
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
