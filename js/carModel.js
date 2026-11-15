/* 程序化车辆建模：曲面车身、车窗立柱、轮毂、灯组与各类特种车辆（车头朝 +Z） */
(function (DC) {
  'use strict';
  var T = THREE;
  var UP = new T.Vector3(0, 1, 0), SIDE = new T.Vector3(1, 0, 0);

  // ---------- 共享材质（按材质分桶合并几何体，减少绘制次数） ----------
  var MATS = null;
  function mats() {
    if (MATS) return MATS;
    MATS = {
      paint: new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.28 }),
      matte: new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.82 }),
      chrome: new T.MeshStandardMaterial({ vertexColors: true, metalness: 1.0, roughness: 0.18 }),
      glass: new T.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.05 }),
      light: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      flashA: new T.MeshBasicMaterial({ color: '#ff2020', toneMapped: false }),
      flashB: new T.MeshBasicMaterial({ color: '#2a6bff', toneMapped: false })
    };
    return MATS;
  }
  DC.carMaterials = mats;
  // 警灯闪烁
  DC.updateCarFx = function (t) {
    var m = mats();
    var a = Math.sin(t * 15) > 0;
    m.flashA.color.set(a ? '#ff2a2a' : '#300404');
    m.flashB.color.set(a ? '#04102e' : '#3a7bff');
  };

  // ---------- 文字贴花 ----------
  var decalCache = {};
  function decalMat(key) {
    if (decalCache[key]) return decalCache[key];
    var d = DECALS[key];
    var cv = document.createElement('canvas');
    cv.width = d.w; cv.height = d.h;
    d.draw(cv.getContext('2d'), d.w, d.h);
    var tex = new T.CanvasTexture(cv);
    tex.encoding = T.sRGBEncoding;
    tex.anisotropy = 4;
    var m = new T.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.2,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    if (d.glow) { m.emissive = new T.Color('#ffffff'); m.emissiveMap = tex; m.emissiveIntensity = 1; }
    decalCache[key] = m;
    return m;
  }
  function txt(x, s, size, color, cx, cy, weight) {
    x.font = (weight || '900') + ' ' + size + 'px "PingFang SC","Microsoft YaHei",Arial,sans-serif';
    x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(s, cx, cy);
  }
  var DECALS = {
    police: { w: 512, h: 128, draw: function (x, w, h) {
      x.fillStyle = '#1846b8'; x.fillRect(0, 34, w, 60);
      x.fillStyle = '#ffffff'; x.fillRect(0, 30, w, 4); x.fillRect(0, 94, w, 4);
      txt(x, '警察  POLICE', 46, '#ffffff', w / 2, 65);
    } },
    policeHood: { w: 256, h: 128, draw: function (x, w, h) { txt(x, '警察', 80, '#1846b8', w / 2, h / 2); } },
    fire: { w: 512, h: 128, draw: function (x, w, h) {
      x.fillStyle = '#f5f5f5'; x.fillRect(0, 40, w, 48);
      txt(x, '119  消防救援', 40, '#c40d0d', w / 2, 65);
    } },
    ambulance: { w: 512, h: 160, draw: function (x, w, h) {
      x.fillStyle = '#e01e1e'; x.fillRect(0, 118, w, 22);
      x.fillRect(40, 30, 24, 72); x.fillRect(16, 54, 72, 24);
      txt(x, '120 急救', 62, '#e01e1e', 300, 66);
    } },
    taxi: { w: 256, h: 96, glow: true, draw: function (x, w, h) {
      x.fillStyle = '#ffd21f'; x.fillRect(0, 0, w, h);
      txt(x, 'TAXI', 64, '#111111', w / 2, h / 2 + 2);
    } },
    bus: { w: 512, h: 96, glow: true, draw: function (x, w, h) {
      x.fillStyle = '#111111'; x.fillRect(0, 0, w, h);
      txt(x, 'K18 环城快线', 54, '#ffa31a', w / 2, h / 2 + 2, '700');
    } },
    school: { w: 512, h: 112, draw: function (x, w, h) {
      x.fillStyle = '#ffcc00'; x.fillRect(0, 0, w, h);
      txt(x, '校车 SCHOOL BUS', 50, '#111111', w / 2, h / 2 + 2);
    } },
    tour: { w: 512, h: 128, draw: function (x, w, h) {
      txt(x, 'CITY TOUR 城市观光', 46, '#ffffff', w / 2, h / 2);
    } },
    cargo: { w: 512, h: 128, draw: function (x, w, h) {
      x.fillStyle = '#ff7a00'; x.fillRect(0, 86, w, 18);
      txt(x, '同城急送 EXPRESS', 48, '#2d2d2d', w / 2, 48);
    } },
    chevron: { w: 512, h: 128, draw: function (x, w, h) {
      x.fillStyle = '#ffd400'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#d81e1e';
      for (var i = -2; i < 10; i++) { x.beginPath(); x.moveTo(i * 64, h); x.lineTo(i * 64 + 32, h); x.lineTo(i * 64 + 96, 0); x.lineTo(i * 64 + 64, 0); x.closePath(); x.fill(); }
    } },
    rescue: { w: 512, h: 128, draw: function (x, w, h) {
      x.fillStyle = '#ffd400'; x.fillRect(0, 36, w, 56);
      txt(x, '道路救援 RESCUE', 42, '#222222', w / 2, 65);
    } }
  };

  // ---------- 几何合并器 ----------
  var tmpColor = new T.Color();
  function Builder() { this.b = {}; this.extra = []; }
  Builder.prototype.add = function (geo, bucket, color, matrix) {
    var g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    var n = g.attributes.position.count;
    var col = new Float32Array(n * 3);
    tmpColor.set(color || '#ffffff');
    for (var i = 0; i < n; i++) { col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b; }
    (this.b[bucket] = this.b[bucket] || []).push({ p: g.attributes.position.array, n: g.attributes.normal.array, c: col });
    g.dispose();
  };
  Builder.prototype.decal = function (key, w, h, matrix) {
    var m = new T.Mesh(new T.PlaneGeometry(w, h), decalMat(key));
    m.applyMatrix4(matrix);
    this.extra.push(m);
  };
  Builder.prototype.build = function () {
    var group = new T.Group();
    var M = mats();
    for (var key in this.b) {
      var parts = this.b[key], total = 0, i;
      for (i = 0; i < parts.length; i++) total += parts[i].p.length;
      var P = new Float32Array(total), N = new Float32Array(total), C = new Float32Array(total), o = 0;
      for (i = 0; i < parts.length; i++) { P.set(parts[i].p, o); N.set(parts[i].n, o); C.set(parts[i].c, o); o += parts[i].p.length; }
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(P, 3));
      g.setAttribute('normal', new T.BufferAttribute(N, 3));
      g.setAttribute('color', new T.BufferAttribute(C, 3));
      g.computeBoundingSphere();
      var mesh = new T.Mesh(g, M[key]);
      mesh.castShadow = key === 'paint' || key === 'matte'; // 镀铬小零件、灯、玻璃不投影
      group.add(mesh);
    }
    this.extra.forEach(function (m) { group.add(m); });
    return group;
  };

  // ---------- 基础工具 ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function spow(v, e) { return Math.sign(v) * Math.pow(Math.abs(v), e); }
  function curve(keys, u) {
    if (u <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (u <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i];
        var t = (u - a[0]) / (b[0] - a[0]);
        t = t * t * (3 - 2 * t);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return keys[keys.length - 1][1];
  }
  function mat(x, y, z, rx, ry, rz) {
    var m = new T.Matrix4();
    m.makeRotationFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0, 'YXZ'));
    m.setPosition(x, y, z);
    return m;
  }
  function box(B, bucket, color, w, h, d, x, y, z, rx, ry, rz) {
    B.add(new T.BoxGeometry(w, h, d), bucket, color, mat(x, y, z, rx, ry, rz));
  }
  function boxPair(B, bucket, color, w, h, d, x, y, z, rx, ry, rz) {
    box(B, bucket, color, w, h, d, x, y, z, rx, ry, rz);
    box(B, bucket, color, w, h, d, -x, y, z, rx, -(ry || 0), -(rz || 0));
  }
  // 两点之间的长方体（立柱、栏杆）
  function beam(B, bucket, color, p1, p2, w, d) {
    var len = p1.distanceTo(p2);
    if (len < 1e-4) return;
    var g = new T.BoxGeometry(w, d, len);
    var dir = p2.clone().sub(p1).normalize();
    var up = Math.abs(dir.y) > 0.95 ? SIDE : UP;
    var m = new T.Matrix4().lookAt(p1, p2, up);
    m.setPosition(p1.clone().add(p2).multiplyScalar(0.5));
    B.add(g, bucket, color, m);
  }
  function V(x, y, z) { return new T.Vector3(x, y, z); }

  // 沿 Z 方向放样：rings 返回每个截面的点（逆时针），自动生成平滑法线
  function loft(zs, ringAt, closed) {
    var pos = [], idx = [], M = 0;
    for (var k = 0; k < zs.length; k++) {
      var pts = ringAt(zs[k], k);
      M = pts.length;
      for (var j = 0; j < M; j++) pos.push(pts[j][0], pts[j][1], zs[k]);
    }
    var segs = closed ? M : M - 1;
    for (var s = 0; s < zs.length - 1; s++) {
      for (var i = 0; i < segs; i++) {
        var i2 = (i + 1) % M;
        var a = s * M + i, b = (s + 1) * M + i, c = s * M + i2, d = (s + 1) * M + i2;
        idx.push(a, c, b, c, d, b);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------- 车身外形 ----------
  // P: L 长, W 宽, zc 中心, clear 离地, top 顶线关键点 [[u,y]], pF/pR 平面圆润度, nTop/nBot 截面方正度,
  //    axles 轴位置(z), wR 轮半径, archGap 轮拱间隙, bumpF/bumpR 前后包围上翘
  //    sS/sR 腰线与门槛线的位置（-1 底 ~ 1 顶），gT/gR/gB 车身在顶部、门槛线、底部相对腰线的宽度，
  //    band 车身下沿深色饰板的上边界（不设则没有）
  function Shape(P) {
    this.P = P;
    this.hl = P.L / 2;
    this.zc = P.zc || 0;
    if (P.sS === undefined) { P.sS = 0.3; P.sR = -0.5; P.gT = 1; P.gR = 1; P.gB = 1; }
  }
  // 截面的横向收放：腰线处最宽，往下收向门槛，往上收向机盖和后备箱盖
  Shape.prototype.g = function (s) {
    var P = this.P;
    if (s >= P.sS) return lerp(1, P.gT, (s - P.sS) / (1 - P.sS));
    if (s >= P.sR) return lerp(P.gR, 1, (s - P.sR) / (P.sS - P.sR));
    return lerp(P.gB, P.gR, (s + 1) / (P.sR + 1));
  };
  Shape.prototype.z = function (u) { return this.zc + u * this.hl; };
  Shape.prototype.w = function (u) {
    var P = this.P, p = u > 0 ? P.pF : P.pR, a = Math.min(1, Math.abs(u));
    var w = P.W / 2 * Math.pow(Math.max(0, 1 - Math.pow(a, p)), 1 / p);
    if (P.taperF && u > 0) w *= 1 - P.taperF * u * u;
    if (P.taperR && u < 0) w *= 1 - P.taperR * u * u;
    if (P.bulge && P.axles) {
      var z = this.zc + u * this.hl, ar = P.wR + (P.archGap || 0.06);
      for (var i = 0; i < P.axles.length; i++) {
        var q = (z - P.axles[i]) / (ar * 1.25);
        w += P.W / 2 * P.bulge * Math.exp(-q * q);
      }
    }
    return w;
  };
  Shape.prototype.y1 = function (u) {
    var P = this.P, y = curve(P.top, u);
    if (P.axles && P.hump !== false) {
      // 轮拱上方的翼子板隆起，保证车轮被包住
      var z = this.zc + u * this.hl, ar = P.wR + (P.archGap || 0.06), need = P.wR + ar + 0.1;
      for (var i = 0; i < P.axles.length; i++) {
        var q = Math.abs(z - P.axles[i]) / (ar * 1.6);
        if (q < 1) y = Math.max(y, lerp(y, need, Math.cos(q * Math.PI / 2)));
      }
    }
    return y;
  };
  Shape.prototype.y0 = function (u) {
    var P = this.P, z = this.z(u);
    var y = P.clear + (P.bumpF || 0) * smooth(0.7, 1, u) + (P.bumpR || 0) * smooth(0.7, 1, -u);
    var ar = P.wR + (P.archGap || 0.06);
    (P.axles || []).forEach(function (za) {
      var dz = Math.abs(z - za);
      if (dz < ar) y = Math.max(y, P.wR + Math.sqrt(ar * ar - dz * dz) * 0.98);
    });
    return Math.min(y, this.y1(u) - 0.12);
  };
  // 在某高度处车身侧面的半宽
  Shape.prototype.sideX = function (u, y) {
    var P = this.P, y0 = this.y0(u), y1 = this.y1(u), yc = (y0 + y1) / 2, h = (y1 - y0) / 2;
    var s = clamp((y - yc) / h, -1, 1), n = s > 0 ? P.nTop : P.nBot;
    return this.w(u) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), n)), 1 / n) * this.g(s);
  };
  // 车头（dir=1）/ 车尾（dir=-1）表面：横向 x、高度 y 处对应的 u 和 z
  Shape.prototype.faceU = function (x, y, dir) {
    var ax = Math.abs(x), u = 1, st = 0.025;
    while (u > 0.45 && this.sideX(dir * u, y) < ax) u -= st;
    if (u >= 1) return dir;
    var lo = u, hi = u + st;
    for (var i = 0; i < 9; i++) { var mid = (lo + hi) / 2; if (this.sideX(dir * mid, y) >= ax) lo = mid; else hi = mid; }
    return dir * lo;
  };
  Shape.prototype.faceZ = function (x, y, dir) { return this.z(this.faceU(x, y, dir)); };
  // 车身顶面（机盖、后备箱盖）在横向 x 处的高度
  Shape.prototype.topY = function (u, x) {
    var P = this.P, w = this.w(u), y0 = this.y0(u), y1 = this.y1(u), ax = Math.abs(x), n = P.nTop;
    var lo = Math.max(0, P.sS), hi = 1;
    for (var i = 0; i < 16; i++) {
      var mid = (lo + hi) / 2;
      if (w * Math.pow(Math.max(0, 1 - Math.pow(mid, n)), 1 / n) * this.g(mid) >= ax) lo = mid; else hi = mid;
    }
    return (y0 + y1) / 2 + (y1 - y0) / 2 * lo;
  };
  // 车头/车尾表面在横向 x 处的 z 坐标
  // 数值求解车头/车尾表面在横向 x 处的 z（考虑轮拱外扩等变形）
  Shape.prototype.endU = function (x, dir) {
    var ax = Math.abs(x), lo = 0, hi = 1;
    if (this.w(dir * 0.0) < ax) return 0;
    for (var i = 0; i < 22; i++) {
      var mid = (lo + hi) / 2;
      if (this.w(dir * mid) >= ax) lo = mid; else hi = mid;
    }
    return dir * lo;
  };
  Shape.prototype.frontZ = function (x) { return this.z(this.endU(x, 1)); };
  Shape.prototype.rearZ = function (x) { return this.z(this.endU(x, -1)); };

  function sampleU(P) {
    var N = Math.round(26 + P.L * 5), us = [], i;
    for (i = 0; i < N; i++) {
      var v = -1 + 2 * i / (N - 1);
      us.push(Math.sign(v) * (1 - Math.pow(1 - Math.abs(v), 1.7)));
    }
    var hl = P.L / 2, zc = P.zc || 0, ar = P.wR + (P.archGap || 0.06) + 0.04;
    (P.axles || []).forEach(function (za) {
      for (var k = -7; k <= 7; k++) us.push((za + ar * k / 7 - zc) / hl);
    });
    for (var e = 0; e <= 10; e++) { var eu = 1 - 0.09 * Math.pow(e / 10, 1.6); us.push(eu, -eu); } // 车头车尾的转角处加密
    (P.extraU || []).forEach(function (u) { us.push(u); });
    us = us.filter(function (u) { return u >= -1 && u <= 1; }).sort(function (a, b) { return a - b; });
    var out = [us[0]];
    for (i = 1; i < us.length; i++) if (us[i] - out[out.length - 1] > 0.004) out.push(us[i]);
    return out;
  }

  // 截面环上的参数点：[cx, s]。在腰线处放重复点（法线断开，形成一道清晰的折线），
  // 在门槛线和深色饰板边界处各放一个点，保证这些线是平直的
  function bodyRing(P) {
    var half = [], NH = 13, i;
    function at(t) { var sn = Math.sin(t), n = sn > 0 ? P.nTop : P.nBot; return { t: t, c: spow(Math.cos(t), 2 / n), s: spow(sn, 2 / n) }; }
    function tOf(sv) { var n = sv > 0 ? P.nTop : P.nBot; return Math.asin(spow(sv, n / 2)); }
    for (i = 0; i <= NH; i++) half.push(at(-Math.PI / 2 + i / NH * Math.PI));
    var marks = [P.sR];
    if (P.band !== undefined && P.band !== null) marks.push(P.band);
    marks.forEach(function (m) { half.push(at(tOf(m))); });
    half.sort(function (a, b) { return a.t - b.t; });
    var clean = [half[0]];
    for (i = 1; i < half.length; i++) {
      var prev = clean[clean.length - 1];
      if (half[i].t - prev.t < 0.035) { // 太近的点合并，优先保留特征线上的点
        if (marks.some(function (m) { return Math.abs(half[i].s - m) < 1e-6; })) clean[clean.length - 1] = half[i];
        continue;
      }
      clean.push(half[i]);
    }
    // 腰线：重复点
    var ts = tOf(P.sS), out = [], done = false;
    for (i = 0; i < clean.length; i++) {
      if (!done && clean[i].t > ts - 0.03) {
        if (Math.abs(clean[i].t - ts) < 0.03) { out.push(at(ts), at(ts)); done = true; continue; }
        out.push(at(ts), at(ts)); done = true;
      }
      out.push(clean[i]);
    }
    var ring = out.map(function (q) { return [q.c, q.s]; });
    for (i = out.length - 2; i >= 1; i--) ring.push([-out[i].c, out[i].s]);
    return ring;
  }

  // split: { u, color } 表示 u 小于该值的后半段车身用另一种颜色（双色车身）
  function lowerBody(B, S, color, split) {
    var P = S.P, us = sampleU(P), ring = bodyRing(P), M = ring.length;
    if (split) { us.push(split.u); us.sort(function (a, b) { return a - b; }); }
    var zs = us.map(function (u) { return S.z(u); });
    var geo = loft(zs, function (z, k) {
      var u = us[k], w = S.w(u), y0 = S.y0(u), y1 = S.y1(u), yc = (y0 + y1) / 2, h = (y1 - y0) / 2;
      return ring.map(function (q) { return [w * q[0] * S.g(q[1]), yc + h * q[1]]; });
    }, true);
    // 按位置把面分到不同的颜色：车身、双色车身的后半段、下沿的深色饰板
    var pos = geo.attributes.position.array, nor = geo.attributes.normal.array, idx = geo.index.array, out = {};
    var hasBand = P.band !== undefined && P.band !== null;
    function lifted(u) { // 轮拱处截面底边被抬高，这里不画饰板
      return S.y0(u) > P.clear + (P.bumpF || 0) * smooth(0.7, 1, u) + (P.bumpR || 0) * smooth(0.7, 1, -u) + 0.015;
    }
    for (var t = 0; t < idx.length; t += 6) {
      var a0 = idx[t], k = Math.floor(a0 / M), j = a0 % M;
      var um = (us[k] + us[Math.min(k + 1, us.length - 1)]) / 2;
      var sm = (ring[j][1] + ring[(j + 1) % M][1]) / 2;
      var bucket = 'paint', col = split && um <= split.u ? split.color : color;
      if (hasBand && sm < P.band && !lifted(us[k]) && !lifted(us[Math.min(k + 1, us.length - 1)])) { bucket = 'matte'; col = P.bandColor || '#151517'; }
      var key = bucket + '|' + col, o = out[key] = out[key] || { b: bucket, c: col, p: [], n: [] };
      for (var e = 0; e < 6; e++) {
        var vi = idx[t + e];
        o.p.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
        o.n.push(nor[vi * 3], nor[vi * 3 + 1], nor[vi * 3 + 2]);
      }
    }
    for (var key2 in out) {
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(out[key2].p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(out[key2].n, 3));
      B.add(g, out[key2].b, out[key2].c);
    }
    geo.dispose();
    // 轮拱内侧（深色），避免透过轮拱看到天空
    var ar = P.wR + (P.archGap || 0.06);
    (P.axles || []).forEach(function (za) {
      var u = (za - S.zc) / S.hl;
      var top = Math.min(S.y1(u) - 0.1, P.wR + ar);
      // 内衬下沿不低于轮拱两侧的车身底边，避免从保险杠下面露出来
      var uf = clamp((za + ar * 1.1 - S.zc) / S.hl, -1, 1), ur = clamp((za - ar * 1.1 - S.zc) / S.hl, -1, 1);
      var bot = Math.max(P.wR * 0.4, S.y0(uf) + 0.04, S.y0(ur) + 0.04);
      if (top - bot < 0.1) return;
      var ymid = (top + bot) / 2, wmin = 99;
      for (var k2 = -4; k2 <= 4; k2++) wmin = Math.min(wmin, S.sideX(clamp((za + ar * k2 / 4 - S.zc) / S.hl, -1, 1), ymid));
      box(B, 'matte', '#0d0d0f', Math.max(0.2, wmin * 2 - 0.06), top - bot, ar * 2 - 0.04, 0, ymid, za);
    });
  }

  // 玻璃座舱：G 为座舱参数。同一块曲面按区域划分为车窗玻璃、A/B/C 柱和车顶
  function greenhouse(B, S, G, bodyColor) {
    var roofColor = G.roofColor || bodyColor;
    var pillarColor = G.pillar || roofColor;
    function yb(u) { return S.y1(u) - 0.02; }
    function wb(u) { return S.w(u) * (G.inset || 0.92); }
    function yt(u) {
      var base = yb(u);
      if (u >= G.rR && u <= G.rF) {
        var m = (G.rR + G.rF) / 2, hw = (G.rF - G.rR) / 2 || 1;
        return G.roof + (G.crown || 0.03) * (1 - Math.pow((u - m) / hw, 2));
      }
      if (u > G.rF) { var t = (u - G.rF) / (G.gF - G.rF); return lerp(G.roof, base, Math.pow(t, G.wsCurve || 1.25)); }
      var t2 = (G.rR - u) / (G.rR - G.gR); return lerp(G.roof, base, Math.pow(t2, G.rwCurve || 1.15));
    }
    function wtop(u) { return wb(u) * G.tumble; }
    var nT = G.n || 5, nB = 16;
    // cy: -1(底) ~ 1(顶) 处的截面点
    function pt(u, cx, cy) {
      var b = yb(u), t = Math.max(b + 0.001, yt(u)), f = (cy + 1) / 2;
      return [cx * lerp(wb(u), wtop(u), f), b + f * (t - b)];
    }
    var RING = 28, ring = [];
    for (var j = 0; j < RING; j++) {
      var a = -Math.PI / 2 + j / RING * Math.PI * 2, sn = Math.sin(a), n = sn > 0 ? nT : nB;
      ring.push([spow(Math.cos(a), 2 / n), spow(sn, 2 / n)]);
    }
    var us = [], N = 44;
    for (var i = 0; i < N; i++) us.push(lerp(G.gR, G.gF, i / (N - 1)));
    var bU = G.bU || [], bw = (G.bW || 0.1) / S.hl;
    [G.rR, G.rF, G.rR - 0.015, G.rF + 0.015].concat(bU.map(function (u) { return u - bw / 2; }), bU.map(function (u) { return u + bw / 2; }))
      .forEach(function (u) { if (u > G.gR && u < G.gF) us.push(u); });
    us.sort(function (x, y) { return x - y; });
    var zs = us.map(function (u) { return S.z(u); });
    var geo = loft(zs, function (z, k) { return ring.map(function (c) { return pt(us[k], c[0], c[1]); }); }, true);
    var pos = geo.attributes.position.array, nor = geo.attributes.normal.array, idx = geo.index.array;
    var out = {};
    var cSolid = G.cSolid, aBand = G.aBand || 0.5;
    function classify(u, cy) {
      if (cy < -0.8) return ['matte', '#111111']; // 窗框密封条
      if (cy > 0.82) {
        if (u >= G.rR - 0.005 && u <= G.rF + 0.005) return ['paint', roofColor];
        return ['glass', G.glass || '#16202b'];
      }
      if (u > G.rF && cy > aBand) return ['paint', pillarColor]; // A 柱
      if (u < G.rR) {
        if (cSolid && u < G.rR + 0.001 && u > G.gR + (cSolid === true ? 0 : cSolid)) return ['paint', pillarColor];
        if (cy > aBand - 0.1) return ['paint', pillarColor]; // C 柱
      }
      for (var q = 0; q < bU.length; q++) if (Math.abs(u - bU[q]) < bw / 2) return [G.bColor ? 'matte' : 'paint', G.bColor || pillarColor];
      if (cy > 0.62 && u >= G.rR && u <= G.rF) return ['paint', roofColor]; // 车顶边缘
      return ['glass', G.glass || '#16202b'];
    }
    for (var t = 0; t < idx.length; t += 6) {
      var a0 = idx[t], cIdx = idx[t + 1], bIdx = idx[t + 2];
      var M = RING, k = Math.floor(a0 / M), jj = a0 % M;
      var um = (us[k] + us[Math.min(k + 1, us.length - 1)]) / 2;
      var cy = (ring[jj][1] + ring[(jj + 1) % M][1]) / 2;
      var cl = classify(um, cy), key = cl[0] + '|' + cl[1];
      var o = out[key] = out[key] || { b: cl[0], c: cl[1], p: [], n: [] };
      for (var e = 0; e < 6; e++) {
        var vi = idx[t + e];
        o.p.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]);
        o.n.push(nor[vi * 3], nor[vi * 3 + 1], nor[vi * 3 + 2]);
      }
    }
    for (var key in out) {
      var g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(out[key].p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(out[key].n, 3));
      B.add(g, out[key].b, out[key].c);
    }
    // 腰线饰条
    var segs = 8;
    for (var side = -1; side <= 1; side += 2) {
      for (var q2 = 0; q2 < segs; q2++) {
        var u1 = lerp(G.gR + 0.01, G.gF - 0.02, q2 / segs), u2 = lerp(G.gR + 0.01, G.gF - 0.02, (q2 + 1) / segs);
        beam(B, G.trim ? 'chrome' : 'matte', G.trim ? '#d9d9d9' : '#151515', V(side * wb(u1) * 1.005, yb(u1) + 0.025, S.z(u1)), V(side * wb(u2) * 1.005, yb(u2) + 0.025, S.z(u2)), 0.02, 0.03);
      }
    }
    return { yb: yb, wb: wb, yt: yt, wtop: wtop, pt: pt };
  }

  // ---------- 车轮 ----------
  var wheelCache = {};
  // 轮胎：圆润的胎肩，ri 是轮辋半径
  function tireGeo(R, tw, ri) {
    var key = R.toFixed(3) + '_' + tw.toFixed(3) + '_' + ri.toFixed(3);
    if (wheelCache[key]) return wheelCache[key];
    var h = tw / 2, sh = Math.min(0.06, (R - ri) * 0.4), pts = [];
    pts.push(new T.Vector2(ri, h - 0.01));
    pts.push(new T.Vector2(ri + (R - ri) * 0.15, h));                  // 胎唇
    pts.push(new T.Vector2(R - sh * 1.6, h + 0.004));                  // 胎侧微鼓
    for (var i = 0; i <= 4; i++) { var a = i / 4 * Math.PI / 2; pts.push(new T.Vector2(R - sh + Math.sin(a) * sh, h - sh + Math.cos(a) * sh)); }
    for (var j = 4; j >= 0; j--) { var b = j / 4 * Math.PI / 2; pts.push(new T.Vector2(R - sh + Math.sin(b) * sh, -h + sh - Math.cos(b) * sh)); }
    pts.push(new T.Vector2(R - sh * 1.6, -h - 0.004));
    pts.push(new T.Vector2(ri + (R - ri) * 0.15, -h));
    pts.push(new T.Vector2(ri, -h + 0.01));
    var g = new T.LatheGeometry(pts, 26);
    g.rotateZ(-Math.PI / 2); // 旋转轴 Y -> X，+Y 侧朝外
    wheelCache[key] = g;
    return g;
  }
  // 绕 X 轴旋转的车轮零件：profile 是 [半径, 轴向位置] 列表
  function latheX(profile, seg) {
    var g = new T.LatheGeometry(profile.map(function (q) { return new T.Vector2(q[0], q[1]); }), seg || 22);
    g.rotateZ(-Math.PI / 2);
    return g;
  }
  // 辐条：梯形截面，从轮毂（r0，宽 w0）到轮辋（r1，宽 w1），外端相对内端沿切向偏 skew；
  // 轮毂比轮辋外沿凹进 dish，形成内凹的轮面
  function spokeGeo(r0, r1, w0, w1, skew, depth, dish) {
    var key = ['sp', r0, r1, w0, w1, skew, depth, dish].map(function (v) { return typeof v === 'number' ? v.toFixed(3) : v; }).join('_');
    if (wheelCache[key]) return wheelCache[key];
    var sh = new T.Shape();
    sh.moveTo(-w0 / 2, r0); sh.lineTo(w0 / 2, r0); sh.lineTo(skew + w1 / 2, r1); sh.lineTo(skew - w1 / 2, r1); sh.closePath();
    var g = new T.ExtrudeGeometry(sh, { depth: depth, bevelEnabled: false });
    g.translate(0, 0, -depth);
    // 内凹：越靠近轮毂越往里
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) { var r = p.getY(i); p.setZ(i, p.getZ(i) - dish * clamp((r1 - r) / (r1 - r0), 0, 1)); }
    g.computeVertexNormals();
    g.rotateY(Math.PI / 2); // 挤出方向 z -> x（朝外）
    wheelCache[key] = g;
    return g;
  }
  var RIM_STYLES = {
    // n 辐条数；w0/w1 内外宽度（相对轮辋半径）；skew 外端切向偏移；split 每根辐条在外端分叉
    five: { n: 5, w0: 0.3, w1: 0.26 },
    multi: { n: 10, w0: 0.11, w1: 0.13 },
    mesh: { n: 7, w0: 0.07, w1: 0.06, split: 0.24 },
    turbine: { n: 12, w0: 0.09, w1: 0.13, skew: 0.32 },
    y: { n: 5, w0: 0.16, w1: 0.08, split: 0.3 }
  };

  // side: +1 右侧(+X 朝外) / -1 左侧
  function wheel(B, W, x, z, side) {
    var R = W.R, tw = W.tw, ri = R * (W.ri || 0.66);
    var base = mat(x, R, z, 0, side > 0 ? 0 : Math.PI, 0);
    function add(g, bucket, color, local) {
      var m = base.clone().multiply(local || new T.Matrix4());
      B.add(g, bucket, color, m);
    }
    add(tireGeo(R, tw, ri), 'matte', '#141414');
    var face = tw / 2 - 0.02;
    // 轮辋内筒（深色）和内侧底面
    add(latheX([[ri * 0.98, face - 0.02], [ri * 0.98, -tw * 0.45]], 24), 'matte', '#222225');
    var back = new T.CircleGeometry(ri * 0.98, 24); back.rotateY(Math.PI / 2);
    add(back, 'matte', '#18181a', mat(-tw * 0.3, 0, 0));
    // 刹车盘 + 卡钳
    var disc = new T.CylinderGeometry(ri * 0.8, ri * 0.8, 0.03, 24);
    disc.rotateZ(-Math.PI / 2);
    add(disc, 'chrome', '#7a7a7a', mat(face - 0.1, 0, 0));
    var dh = new T.CylinderGeometry(ri * 0.36, ri * 0.36, 0.035, 16);
    dh.rotateZ(-Math.PI / 2);
    add(dh, 'matte', '#3a3a3c', mat(face - 0.1, 0, 0));
    if (W.caliper) {
      add(new T.BoxGeometry(0.07, ri * 0.5, ri * 0.3), 'paint', W.caliper, mat(face - 0.08, ri * 0.52, -ri * 0.36, 0.75, 0, 0));
    }
    var rc = W.rim || '#c8c8c8', rb = W.rimBucket || 'chrome';
    var style = W.style || 'five';
    if (style === 'steel') {
      // 钢圈：冲压圆盘 + 散热孔 + 中心盖
      add(latheX([[ri * 0.98, face - 0.035], [ri * 0.96, face], [ri * 0.82, face - 0.005], [ri * 0.74, face - 0.035], [ri * 0.5, face - 0.03], [ri * 0.46, face - 0.005], [ri * 0.3, face]], 24), 'paint', W.rim || '#9a9a9a');
      for (var hlz = 0; hlz < 6; hlz++) {
        var ha = hlz / 6 * Math.PI * 2, hole = new T.CircleGeometry(ri * 0.075, 10); hole.rotateY(Math.PI / 2);
        add(hole, 'matte', '#141414', mat(face - 0.028, Math.cos(ha) * ri * 0.62, Math.sin(ha) * ri * 0.62));
      }
      add(latheX([[ri * 0.32, face - 0.01], [ri * 0.3, face + 0.02], [ri * 0.15, face + 0.035], [0.001, face + 0.04]], 18), 'chrome', '#d8d8d8');
      return;
    }
    if (style === 'truck') {
      add(latheX([[ri * 0.98, face - 0.03], [ri * 0.95, face], [ri * 0.6, face - 0.04], [ri * 0.45, face - 0.04], [ri * 0.4, face]], 24), 'chrome', '#bdbdbd');
      var hubT = new T.CylinderGeometry(ri * 0.38, ri * 0.42, 0.08, 16); hubT.rotateZ(-Math.PI / 2);
      add(hubT, 'matte', '#5a5a5a', mat(face, 0, 0));
      for (var b = 0; b < 8; b++) {
        var a0 = b / 8 * Math.PI * 2;
        add(new T.CylinderGeometry(0.025, 0.025, 0.06, 6), 'chrome', '#eeeeee', mat(face + 0.03, Math.cos(a0) * ri * 0.3, Math.sin(a0) * ri * 0.3, 0, 0, Math.PI / 2));
      }
      return;
    }
    // 轮辋外圈：带厚度的唇边
    add(latheX([[ri * 0.84, face - 0.06], [ri * 0.9, face - 0.008], [ri * 1.0, face + 0.004], [ri * 1.05, face - 0.012], [ri * 1.02, face - 0.04]], 26), rb, rc);
    var st = RIM_STYLES[style] || RIM_STYLES.five;
    var dish = W.dish !== undefined ? W.dish : 0.035, dep = 0.035;
    function spoke(ang, w0, w1, skew) {
      var g = spokeGeo(ri * 0.2, ri * 0.92, ri * w0, ri * w1, ri * (skew || 0), dep, dish);
      add(g, rb, rc, new T.Matrix4().makeTranslation(face, 0, 0).multiply(new T.Matrix4().makeRotationX(ang)));
    }
    for (var k = 0; k < st.n; k++) {
      var ang = k / st.n * Math.PI * 2;
      if (st.split) { spoke(ang, st.w0, st.w1, st.split * 0.5); spoke(ang, st.w0, st.w1, -st.split * 0.5); }
      else spoke(ang, st.w0, st.w1, st.skew || 0);
    }
    // 轮毂盖 + 螺母
    add(latheX([[ri * 0.27, face - dish - 0.03], [ri * 0.26, face - dish + 0.005], [ri * 0.18, face - dish + 0.02], [0.001, face - dish + 0.025]], 20), rb, rc);
    var cap = new T.CircleGeometry(ri * 0.11, 16); cap.rotateY(Math.PI / 2);
    add(cap, 'paint', W.capColor || '#1a1a1a', mat(face - dish + 0.027, 0, 0));
    for (var ln = 0; ln < 5; ln++) {
      var la = ln / 5 * Math.PI * 2 + Math.PI / 5, nut = new T.CylinderGeometry(ri * 0.03, ri * 0.03, 0.03, 6);
      nut.rotateZ(-Math.PI / 2);
      add(nut, 'chrome', '#e0e0e0', mat(face - dish + 0.015, Math.cos(la) * ri * 0.19, Math.sin(la) * ri * 0.19));
    }
  }

  // steer: 为前轮单独生成可转动的子模型（玩家车用）
  var steerMode = false;
  function wheels(B, P, W, S) {
    (P.axles || []).forEach(function (za, i) {
      var x = S ? S.w((za - S.zc) / S.hl) * 0.985 - W.tw / 2 : P.W / 2 - W.tw / 2 - (W.inset || 0.03);
      if (steerMode && i === 0) {
        [1, -1].forEach(function (sd) {
          var sb = new Builder();
          wheel(sb, W, 0, 0, sd);
          var g = sb.build();
          g.traverse(function (o) { if (o.isMesh) o.geometry.translate(0, -W.R, 0); });
          g.position.set(sd * x, W.R, za);
          g.name = 'frontWheel';
          B.extra.push(g);
        });
        return;
      }
      wheel(B, W, x, za, 1);
      wheel(B, W, -x, za, -1);
      if (W.dual && i > 0) { // 后轴双胎
        wheel(B, W, x - W.tw - 0.02, za, 1);
        wheel(B, W, -x + W.tw + 0.02, za, -1);
      }
    });
  }

  // ---------- 灯组与细节 ----------
  // 车头/车尾表面在 x 处的切线角，用于让灯组贴合曲面
  function frontAngle(S, x) { var d = 0.02; return Math.atan2(S.frontZ(x + d) - S.frontZ(x - d), 2 * d); }
  function rearAngle(S, x) { var d = 0.02; return Math.atan2(S.rearZ(x + d) - S.rearZ(x - d), 2 * d); }
  // 车身在高度 y 处比最宽处窄多少（截面是超椭圆，越靠上下越窄）
  function narrowAt(S, u, y) {
    var w = S.w(u);
    return w > 1e-4 ? Math.max(0.35, S.sideX(u, y) / w) : 1;
  }
  // 换算成“最宽处轮廓”上的等效横向位置，这样贴合点落在该高度的真实表面上
  function effX(S, x, y, u) {
    var lim = S.w(u * 0.5) * 0.97;
    return clamp(x / narrowAt(S, u, y), -lim, lim);
  }
  function flushFront(B, bucket, color, S, x, y, w, h, d, inset) {
    var ex = effX(S, x, y, 0.92);
    var ang = frontAngle(S, ex);
    var z = S.frontZ(ex) - d / 2 + (inset === undefined ? 0.02 : inset);
    box(B, bucket, color, w, h, d, x, y, z, 0, -ang, 0);
  }
  function flushRear(B, bucket, color, S, x, y, w, h, d, inset) {
    var ex = effX(S, x, y, -0.92);
    var ang = rearAngle(S, ex);
    var z = S.rearZ(ex) + d / 2 - (inset === undefined ? 0.02 : inset);
    box(B, bucket, color, w, h, d, x, y, z, 0, -ang, 0);
  }
  // ---------- 贴合车身曲面的面片 ----------
  // 在车身表面上按参数网格生成一块面片，并沿法线抬起 off，用来做车灯、格栅、缝线等
  // fn(a, b) -> [x, y, z]；(ox, oy, oz) 是期望的外法线方向，用来统一面的朝向
  function patch(B, bucket, color, na, nb, fn, ox, oy, oz, off) {
    var pos = [], idx = [], i, j, W1 = na + 1;
    for (j = 0; j <= nb; j++) for (i = 0; i <= na; i++) { var q = fn(i / na, j / nb); pos.push(q[0], q[1], q[2]); }
    for (j = 0; j < nb; j++) for (i = 0; i < na; i++) { var a = j * W1 + i, b = a + 1, c = a + W1, d = c + 1; idx.push(a, b, c, b, d, c); }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    var n = g.attributes.normal, sx = 0, sy = 0, sz = 0;
    for (i = 0; i < n.count; i++) { sx += n.getX(i); sy += n.getY(i); sz += n.getZ(i); }
    if (sx * ox + sy * oy + sz * oz < 0) {
      for (i = 0; i < idx.length; i += 3) { var t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.setIndex(idx);
      g.computeVertexNormals();
      n = g.attributes.normal;
    }
    var pa = g.attributes.position;
    for (i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) + n.getX(i) * off, pa.getY(i) + n.getY(i) * off, pa.getZ(i) + n.getZ(i) * off);
    B.add(g, bucket, color);
    g.dispose();
  }
  // 四边形内的双线性插值；c = [[p,q] x4]，依次是 (a=0,b=0) (a=1,b=0) (a=1,b=1) (a=0,b=1)
  function bil(c, a, b) {
    var x0 = lerp(c[0][0], c[1][0], a), y0 = lerp(c[0][1], c[1][1], a), x1 = lerp(c[3][0], c[2][0], a), y1 = lerp(c[3][1], c[2][1], a);
    return [lerp(x0, x1, b), lerp(y0, y1, b)];
  }
  function sub(c, a0, a1, b0, b1) { return [bil(c, a0, b0), bil(c, a1, b0), bil(c, a1, b1), bil(c, a0, b1)]; }
  function rect(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  function span(c, i, j, k, l) { return Math.max(Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]), Math.hypot(c[k][0] - c[l][0], c[k][1] - c[l][1])); }
  // 车头（dir=1）/ 车尾（dir=-1）表面上的四边形，c 的坐标是 [x, y]
  function fq(B, bucket, color, S, dir, c, off, na, nb) {
    na = na || clamp(Math.ceil(span(c, 0, 1, 3, 2) / 0.055), 2, 18);
    nb = nb || clamp(Math.ceil(span(c, 0, 3, 1, 2) / 0.06), 1, 6);
    patch(B, bucket, color, na, nb, function (a, b) {
      var q = bil(c, a, b), lim = S.sideX(dir * 0.84, q[1]) * 0.985, x = clamp(q[0], -lim, lim);
      return [x, q[1], S.faceZ(x, q[1], dir)];
    }, 0, 0, dir, off);
  }
  // 车身侧面上的四边形，c 的坐标是 [z, y]
  function sq(B, bucket, color, S, side, c, off, na, nb) {
    na = na || clamp(Math.ceil(span(c, 0, 1, 3, 2) / 0.12), 1, 14);
    nb = nb || clamp(Math.ceil(span(c, 0, 3, 1, 2) / 0.07), 1, 8);
    patch(B, bucket, color, na, nb, function (a, b) {
      var q = bil(c, a, b);
      return [side * S.sideX(clamp((q[0] - S.zc) / S.hl, -1, 1), q[1]), q[1], q[0]];
    }, side, 0, 0, off);
  }
  // 车身顶面（机盖、后备箱盖）上的四边形，c 的坐标是 [x, z]
  function tq(B, bucket, color, S, c, off, na, nb) {
    na = na || clamp(Math.ceil(span(c, 0, 1, 3, 2) / 0.1), 1, 14);
    nb = nb || clamp(Math.ceil(span(c, 0, 3, 1, 2) / 0.1), 1, 14);
    patch(B, bucket, color, na, nb, function (a, b) {
      var q = bil(c, a, b);
      return [q[0], S.topY(clamp((q[1] - S.zc) / S.hl, -1, 1), q[0]), q[1]];
    }, 0, 1, 0, off);
  }

  // ---------- 牌照 ----------
  var plateCache = {};
  function plateMat(level, kind) {
    var key = level + kind;
    if (plateCache[key]) return plateCache[key];
    var rnd = seeded(level * 31 + 7);
    var prov = '京沪粤浙苏川鲁湘鄂闽'[Math.floor(rnd() * 10)], abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ', num = '0123456789';
    var text = prov + abc[Math.floor(rnd() * 24)] + '·';
    for (var i = 0; i < 5; i++) text += (i < 2 && rnd() < 0.4 ? abc[Math.floor(rnd() * 24)] : num[Math.floor(rnd() * 10)]);
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 80;
    var x = cv.getContext('2d');
    if (kind === 'ev') { var gr = x.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, '#f2f6f2'); gr.addColorStop(1, '#3fbf6a'); x.fillStyle = gr; }
    else x.fillStyle = kind === 'big' ? '#f0c020' : '#1846b8';
    roundRect(x, 2, 2, 252, 76, 9); x.fill();
    x.strokeStyle = kind === 'blue' ? '#ffffff' : '#111111'; x.lineWidth = 3;
    roundRect(x, 7, 7, 242, 66, 6); x.stroke();
    txt(x, text, 44, kind === 'blue' ? '#ffffff' : '#111111', 128, 42, '700');
    var tex = new T.CanvasTexture(cv);
    tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
    plateCache[key] = new T.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return plateCache[key];
  }
  function plate(B, S, o, dir, y) {
    var z = S.faceZ(0.2, y, dir) + dir * 0.012;
    var m = new T.Mesh(new T.PlaneGeometry(0.46, 0.145), plateMat(o.level || 0, o.plateKind || (o.ev ? 'ev' : 'blue')));
    m.applyMatrix4(mat(0, y, z, 0, dir > 0 ? 0 : Math.PI, 0));
    B.extra.push(m);
  }

  // ---------- 灯组、格栅 ----------
  function headlights(B, S, o) {
    var P = S.P, style = o.lights || 'rect', Wh = P.W / 2;
    var uF = 0.93, yLo = S.y0(uF), yHi = S.y1(uF), H = yHi - yLo;
    var yc = o.lightY || (yLo + H * 0.72);
    var c = '#f4f8ff';
    for (var s = -1; s <= 1; s += 2) {
      if (style === 'round') {
        var x = o.lightX || Math.min(P.W * 0.32, S.w(0.86) * 0.7), xx = s * x, zf = S.faceZ(xx, yc, 1), ang = Math.atan2(S.faceZ(xx + 0.03, yc, 1) - S.faceZ(xx - 0.03, yc, 1), 0.06);
        var rr = o.lightR || 0.115;
        var cup = new T.CylinderGeometry(rr * 1.12, rr * 0.9, 0.1, 22);
        cup.rotateX(Math.PI / 2);
        B.add(cup, 'chrome', '#d8d8d8', mat(xx, yc, zf - 0.035, 0, -ang, 0));
        var lens = new T.SphereGeometry(rr, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        lens.rotateX(Math.PI / 2); lens.scale(1, 1, 0.42);
        B.add(lens, 'light', c, mat(xx, yc, zf + 0.012, 0, -ang, 0));
        var ring = new T.TorusGeometry(rr * 1.04, 0.018, 6, 22);
        B.add(ring, 'chrome', '#e4e4e4', mat(xx, yc, zf + 0.016, 0, -ang, 0));
        continue;
      }
      if (style === 'bus') {
        var bx = Wh - 0.34;
        fq(B, 'matte', '#0a0a0c', S, 1, rect(s * (bx - 0.24), yc - 0.11, s * (bx + 0.24), yc + 0.11), 0.008);
        fq(B, 'light', c, S, 1, rect(s * (bx - 0.2), yc - 0.07, s * (bx + 0.05), yc + 0.07), 0.014);
        fq(B, 'light', '#ffb020', S, 1, rect(s * (bx + 0.08), yc - 0.06, s * (bx + 0.2), yc + 0.06), 0.014);
        continue;
      }
      var slim = style === 'slim';
      var hh = slim ? clamp(H * 0.2, 0.06, 0.085) : clamp(H * 0.3, 0.1, 0.16);
      var xi = Wh * (o.lightIn || (slim ? 0.34 : 0.46)), xo = Wh * 0.99;
      var sweep = slim ? hh * 0.9 : hh * 0.3;
      // 内端窄、外端宽并上扬，绕到车身转角
      var q = [[s * xi, yc - hh * 0.42], [s * xo, yc - hh * 0.3 + sweep], [s * xo, yc + hh * 0.62 + sweep], [s * xi, yc + hh * 0.38]];
      fq(B, 'matte', '#07080a', S, 1, [[s * (xi - 0.02), q[0][1] - 0.015], [s * xo, q[1][1] - 0.015], [s * xo, q[2][1] + 0.015], [s * (xi - 0.02), q[3][1] + 0.015]], 0.006);
      fq(B, 'glass', slim ? '#8fa0b3' : '#aab8c8', S, 1, q, 0.011);
      if (slim) {
        fq(B, 'light', c, S, 1, sub(q, 0.04, 0.96, 0.62, 0.9), 0.016);   // 日行灯条
        fq(B, 'light', c, S, 1, sub(q, 0.1, 0.3, 0.12, 0.5), 0.016);     // 透镜
        fq(B, 'light', c, S, 1, sub(q, 0.36, 0.52, 0.12, 0.5), 0.016);
      } else {
        fq(B, 'light', c, S, 1, sub(q, 0.07, 0.36, 0.3, 0.86), 0.016);   // 近光透镜
        fq(B, 'chrome', '#e8e8e8', S, 1, sub(q, 0.42, 0.66, 0.34, 0.84), 0.015); // 远光反射碗
        fq(B, 'light', '#ffffff', S, 1, sub(q, 0.05, 0.95, 0.05, 0.2), 0.016);   // 日行灯条
        fq(B, 'light', '#ffb020', S, 1, sub(q, 0.74, 0.96, 0.34, 0.84), 0.016);  // 转向灯
      }
    }
  }
  function taillights(B, S, o) {
    var P = S.P, u = -0.93, Wh = P.W / 2, yLo = S.y0(u), yHi = S.y1(u), H = yHi - yLo;
    var y = o.tailY || (yLo + H * 0.74);
    var red = '#ff1a1a', dark = '#2a0406';
    if (o.tails === 'bar') {
      // 贯穿式尾灯
      var xb = Wh * 0.97, hb = 0.05;
      fq(B, 'matte', '#090909', S, -1, rect(-xb, y - hb * 0.5 - 0.02, xb, y + hb * 0.5 + 0.02), 0.006, 26, 1);
      fq(B, 'light', red, S, -1, rect(-xb, y - hb * 0.5, xb, y + hb * 0.5), 0.012, 26, 1);
      return;
    }
    if (o.tails === 'round') {
      for (var r = -1; r <= 1; r += 2) for (var q = 0; q < 2; q++) {
        var xx = r * (P.W * 0.37 - q * 0.21), zr = S.faceZ(xx, y, -1), ang = Math.atan2(S.faceZ(xx + 0.03, y, -1) - S.faceZ(xx - 0.03, y, -1), 0.06);
        var g = new T.CylinderGeometry(0.078, 0.078, 0.06, 18);
        g.rotateX(Math.PI / 2);
        B.add(g, 'light', red, mat(xx, y, zr + 0.005, 0, -ang, 0));
        var rg = new T.TorusGeometry(0.082, 0.014, 6, 18);
        B.add(rg, 'matte', '#0c0c0c', mat(xx, y, zr - 0.02, 0, -ang, 0));
      }
      return;
    }
    for (var s = -1; s <= 1; s += 2) {
      if (o.tails === 'tall') {
        var x0 = Wh * 0.8, x1 = Wh * 0.99, ya = yLo + H * 0.42, yb = yLo + H * 0.92;
        fq(B, 'matte', dark, S, -1, rect(s * (x0 - 0.015), ya - 0.015, s * x1, yb + 0.015), 0.006);
        fq(B, 'light', red, S, -1, rect(s * x0, ya + (yb - ya) * 0.3, s * x1, yb), 0.012);
        fq(B, 'light', '#ffb020', S, -1, rect(s * x0, ya + (yb - ya) * 0.14, s * x1, ya + (yb - ya) * 0.27), 0.012);
        fq(B, 'light', '#f4f4f4', S, -1, rect(s * x0, ya, s * x1, ya + (yb - ya) * 0.11), 0.012);
        continue;
      }
      var hh = clamp(H * 0.24, 0.09, 0.14), xi = Wh * 0.4, xo = Wh * 0.99;
      var c = [[s * xi, y - hh * 0.4], [s * xo, y - hh * 0.5], [s * xo, y + hh * 0.55], [s * xi, y + hh * 0.4]];
      fq(B, 'matte', dark, S, -1, [[s * (xi - 0.02), c[0][1] - 0.015], [s * xo, c[1][1] - 0.015], [s * xo, c[2][1] + 0.015], [s * (xi - 0.02), c[3][1] + 0.015]], 0.006);
      fq(B, 'light', red, S, -1, sub(c, 0.2, 1, 0, 1), 0.012);
      fq(B, 'glass', '#c9ced6', S, -1, sub(c, 0.02, 0.15, 0.22, 0.78), 0.012);  // 倒车灯
      fq(B, 'light', '#ff5a3a', S, -1, sub(c, 0.25, 0.95, 0.42, 0.58), 0.016);  // 灯腔里的亮条
    }
  }
  function grille(B, S, o) {
    var P = S.P, u = 0.95, Wh = P.W / 2, yLo = S.y0(u), yHi = S.y1(u), H = yHi - yLo;
    var chrome = !!o.grilleChrome;
    var gw = o.grilleW || P.W * 0.4, gh = o.grilleH || clamp(H * 0.26, 0.09, 0.2);
    var y = o.grilleY || (yLo + H * 0.6);
    var bandTop = yLo + H * 0.2;
    if (!o.ev && !o.noGrille) {
      // 上格栅：上宽下窄
      var g = [[-gw / 2 * 0.86, y - gh / 2], [gw / 2 * 0.86, y - gh / 2], [gw / 2, y + gh / 2], [-gw / 2, y + gh / 2]];
      fq(B, 'matte', '#0b0b0d', S, 1, g, 0.008);
      var slats = Math.max(2, Math.round(gh / 0.05));
      for (var k = 1; k < slats; k++) fq(B, chrome ? 'chrome' : 'matte', chrome ? '#d6d6d6' : '#2c2e33', S, 1, sub(g, 0.03, 0.97, k / slats - 0.035, k / slats + 0.035), 0.013, 0, 1);
      if (chrome || o.trim) {
        fq(B, 'chrome', '#e2e2e2', S, 1, sub(g, -0.02, 1.02, 0.94, 1.08), 0.014, 0, 1);
        fq(B, 'chrome', '#e2e2e2', S, 1, sub(g, -0.02, 1.02, -0.08, 0.06), 0.014, 0, 1);
      }
    }
    // 下进气口
    var iw = Wh * (o.intake ? 0.62 : 0.5), ih = clamp(H * (o.intake ? 0.2 : 0.14), 0.06, 0.16), iy = bandTop + ih / 2 + 0.02;
    if (!o.noIntake) {
      var lower = [[-iw * 0.9, iy - ih / 2], [iw * 0.9, iy - ih / 2], [iw, iy + ih / 2], [-iw, iy + ih / 2]];
      fq(B, 'matte', '#0a0a0c', S, 1, lower, 0.008);
      fq(B, 'matte', '#26282c', S, 1, sub(lower, 0.02, 0.98, 0.42, 0.58), 0.012, 0, 1);
      if (o.intake) for (var sd = -1; sd <= 1; sd += 2) { // 两侧的导流口
        fq(B, 'matte', '#0a0a0c', S, 1, [[sd * Wh * 0.72, iy - ih * 0.45], [sd * Wh * 0.93, iy - ih * 0.2], [sd * Wh * 0.93, iy + ih * 0.75], [sd * Wh * 0.72, iy + ih * 0.5]], 0.008);
      }
    }
    // 前牌照
    if (!o.noPlate) plate(B, S, o, 1, o.plateY || (o.ev || o.noGrille ? yLo + H * 0.46 : Math.max(iy + ih / 2 + 0.085, y - gh / 2 - 0.1)));
  }
  function rearDetails(B, S, o) {
    var P = S.P, u = -0.95, yLo = S.y0(u), yHi = S.y1(u), H = yHi - yLo;
    if (!o.exhaustCenter && !o.noPlate) plate(B, S, o, -1, yLo + H * 0.47);
    // 后保险杠下部的深色护板
    if (!o.noIntake) {
      var vw = P.W * 0.36, vy = yLo + H * 0.2;
      fq(B, 'matte', '#0c0c0e', S, -1, [[-vw * 0.92, vy], [vw * 0.92, vy], [vw, vy + H * 0.13], [-vw, vy + H * 0.13]], 0.008);
    }
    // 后保险杠两角的反光片
    if (!o.noReflector) for (var rs = -1; rs <= 1; rs += 2) fq(B, 'light', '#b01010', S, -1, rect(rs * P.W * 0.38, yLo + H * 0.25, rs * P.W * 0.46, yLo + H * 0.3), 0.01);
    var ex = o.exhaust === undefined ? 1 : o.exhaust;
    if (ex) {
      var ey = S.y0(-0.97) + 0.07;
      var g = new T.CylinderGeometry(o.exR || 0.045, o.exR || 0.045, 0.14, 14, 1, true);
      g.rotateX(Math.PI / 2);
      var xs = ex === 4 ? [-0.55, -0.4, 0.4, 0.55] : (ex === 2 ? [-0.45, 0.45] : (ex === 3 ? [0] : [-0.45]));
      if (o.exhaustCenter) { // 中央四出排气（上下左右排成一簇）
        var cyq = lerp(S.y0(-0.95), S.y1(-0.95), 0.5);
        [[-0.07, 0.07], [0.07, 0.07], [-0.07, -0.07], [0.07, -0.07]].forEach(function (q) {
          B.add(g, 'chrome', '#d5d5d5', mat(q[0], cyq + q[1], S.faceZ(0, cyq, -1) - 0.04));
        });
        var rg = new T.TorusGeometry(0.19, 0.025, 6, 20);
        B.add(rg, 'chrome', '#bbbbbb', mat(0, cyq, S.faceZ(0, cyq, -1) + 0.06));
      } else
      xs.forEach(function (fx) { B.add(g, 'chrome', '#d5d5d5', mat(fx * P.W / 2, ey, S.faceZ(fx * P.W / 2, ey + 0.03, -1) - 0.02)); });
    }
    if (o.diffuser) {
      for (var i = -2; i <= 2; i++) box(B, 'matte', '#0c0c0c', 0.03, 0.16, 0.4, i * 0.25, S.y0(-0.95) + 0.06, S.faceZ(0.6, S.y0(-0.95) + 0.1, -1) + 0.1);
    }
  }
  function mirrors(B, S, G, gh, color) {
    var u = G.gF - 0.05, y = gh.yb(u) + 0.1, x = gh.wb(u), z = S.z(u);
    for (var s = -1; s <= 1; s += 2) {
      beam(B, 'matte', '#101012', V(s * (x - 0.02), y - 0.05, z + 0.01), V(s * (x + 0.1), y - 0.02, z - 0.01), 0.05, 0.03);
      var pod = new T.SphereGeometry(1, 12, 8);
      pod.scale(0.1, 0.062, 0.065);
      B.add(pod, 'paint', color, mat(s * (x + 0.15), y + 0.01, z - 0.005, 0, s * 0.18, 0));
      var gl = new T.CircleGeometry(1, 12);
      gl.scale(0.082, 0.05, 1);
      B.add(gl, 'glass', '#56616e', mat(s * (x + 0.15), y + 0.01, z - 0.058, 0, Math.PI + s * 0.18, 0));
    }
  }
  // 车门缝：沿车身侧面的细线
  function seams(B, S, gh, us) {
    var P = S.P, list = us.slice().sort(function (a, b) { return a - b; });
    function sill(u) { var y0 = S.y0(u), y1 = S.y1(u); return (y0 + y1) / 2 + (y1 - y0) / 2 * (P.band !== undefined && P.band !== null ? P.band : -0.7) + 0.035; }
    for (var s = -1; s <= 1; s += 2) {
      list.forEach(function (u) {
        var z = S.z(u);
        sq(B, 'matte', '#1b1c1f', S, s, rect(z - 0.007, sill(u), z + 0.007, gh.yb(u) - 0.015), 0.004, 1, 7);
      });
      // 车门下沿
      if (list.length >= 2) {
        var ua = list[0], ub = list[list.length - 1], n = 10;
        for (var i = 0; i < n; i++) {
          var u1 = lerp(ua, ub, i / n), u2 = lerp(ua, ub, (i + 1) / n);
          sq(B, 'matte', '#1b1c1f', S, s, [[S.z(u1), sill(u1) - 0.007], [S.z(u2), sill(u2) - 0.007], [S.z(u2), sill(u2) + 0.007], [S.z(u1), sill(u1) + 0.007]], 0.004, 1, 1);
        }
      }
    }
  }
  function handles(B, S, gh, us) {
    us.forEach(function (u) {
      var y = gh.yb(u) - 0.12, x = S.sideX(u, y) + 0.008;
      for (var s = -1; s <= 1; s += 2) box(B, 'chrome', '#d0d0d0', 0.025, 0.035, 0.16, s * x, y, S.z(u));
    });
  }
  // 雨刮、天线、雾灯、侧转向灯、后扩散器等小细节
  function details(B, S, G, gh, o, car) {
    var P = S.P, W = P.W;
    // 雨刮
    var uw = G.gF - 0.035, yw = gh.yb(uw) + 0.05, zw = S.z(uw);
    for (var s = -1; s <= 1; s += 2) {
      var x0 = s > 0 ? -W * 0.32 : 0.02;
      beam(B, 'matte', '#0c0c0c', V(x0, yw, zw), V(x0 + W * 0.3, yw + 0.06, zw - 0.06), 0.02, 0.015);
    }
    // 鲨鱼鳍天线
    if (car.type !== 'micro' && car.type !== 'microvan' && !o.police && !o.taxi && TYPES[car.type].grip < 1.1) {
      var ua = G.rR + 0.03;
      box(B, 'paint', G.roofColor || car.color, 0.06, 0.07, 0.18, 0, gh.yt(ua) + 0.04, S.z(ua), -0.25);
    }
    // 雾灯
    if (/suv|offroad|pickup|sedan|mpv|hatch/.test(car.type)) {
      var fy0 = S.y0(0.95), fH = S.y1(0.95) - fy0, fy = fy0 + fH * 0.3;
      for (var f = -1; f <= 1; f += 2) {
        fq(B, 'matte', '#0a0a0c', S, 1, rect(f * W * 0.33, fy - 0.045, f * W * 0.45, fy + 0.045), 0.008);
        fq(B, 'light', '#fff4d6', S, 1, rect(f * W * 0.35, fy - 0.025, f * W * 0.43, fy + 0.025), 0.013);
      }
    }
    // 机盖缝线：两条纵缝 + 前缘横缝
    var seamC = '#1d1e21';
    var uA = Math.min(0.9, G.gF + 0.04), uB = 0.9;
    if (uB - uA > 0.12) {
      var xa = gh.wb(G.gF) * 0.96, xb = S.w(uB) * 0.74;
      for (var hs = -1; hs <= 1; hs += 2) {
        tq(B, 'matte', seamC, S, [[hs * xa - 0.006, S.z(uA)], [hs * xa + 0.006, S.z(uA)], [hs * xb + 0.006, S.z(uB)], [hs * xb - 0.006, S.z(uB)]], 0.004, 1, 12);
      }
      tq(B, 'matte', seamC, S, rect(-xb, S.z(uB) - 0.006, xb, S.z(uB) + 0.006), 0.004, 14, 1);
    }
    // 后备箱盖缝线（有独立尾箱的车型）
    var uC = G.gR - 0.04, uD = -0.9;
    if (uC - uD > 0.12 && !o.louvers && !o.bed) {
      var xc = gh.wb(G.gR) * 0.94, xd = S.w(uD) * 0.76;
      for (var ts = -1; ts <= 1; ts += 2) {
        tq(B, 'matte', seamC, S, [[ts * xc - 0.006, S.z(uC)], [ts * xc + 0.006, S.z(uC)], [ts * xd + 0.006, S.z(uD)], [ts * xd - 0.006, S.z(uD)]], 0.004, 1, 10);
      }
    }
    // 侧转向灯
    var us = 0.72;
    var ys = lerp(S.y0(us), S.y1(us), 0.7);
    for (var t = -1; t <= 1; t += 2) box(B, 'light', '#ffa020', 0.02, 0.035, 0.1, t * (S.sideX(us, ys) + 0.005), ys, S.z(us));
    // 后窗刹车灯
    if (TYPES[car.type].grip < 1.1 && car.type !== 'offroad') {
      var ub = G.rR - 0.01;
      box(B, 'light', '#ff1a1a', W * 0.22, 0.03, 0.04, 0, gh.yt(ub) - 0.03, S.z(ub) - 0.02);
    }
  }

  function sideSkirt(B, S, color) {
    var P = S.P;
    if (!P.axles || P.axles.length < 2) return;
    var z1 = P.axles[0] - P.wR - 0.12, z2 = P.axles[P.axles.length - 1] + P.wR + 0.12;
    var y = Math.max(P.clear + 0.06, S.y0(0) + 0.05), x = S.sideX(0, y) * 0.995;
    boxPair(B, 'matte', color || '#0e0e0e', 0.05, 0.08, z1 - z2, x, y, (z1 + z2) / 2);
  }
  function wing(B, S, o, color) {
    var P = S.P, kind = o.wing;
    var u = -0.88, deck = S.y1(u), z = S.z(u);
    if (kind === 'lip') { box(B, 'paint', color, P.W * 0.7, 0.05, 0.18, 0, deck + 0.02, S.z(-0.93), -0.2); return; }
    if (kind === 'duck') { box(B, 'paint', color, P.W * 0.8, 0.08, 0.32, 0, deck + 0.05, S.z(-0.9), -0.25); return; }
    var h = kind === 'big' ? 0.52 : (kind === 'swan' ? 0.42 : 0.3), ww = P.W * (kind === 'big' ? 0.98 : 0.85);
    var wc = o.wingColor || (kind === 'big' ? '#111111' : color);
    var bucket = wc === color ? 'paint' : 'matte';
    box(B, bucket, wc, ww, 0.04, 0.38, 0, deck + h, z, -0.12);
    box(B, bucket, wc, ww * 0.98, 0.03, 0.16, 0, deck + h + 0.06, z - 0.14, -0.35);
    for (var s = -1; s <= 1; s += 2) {
      box(B, 'matte', '#141414', 0.04, h, 0.12, s * P.W * 0.28, deck + h / 2, z + 0.05);
      if (kind === 'big' || kind === 'swan') box(B, 'matte', '#141414', 0.03, 0.28, 0.48, s * ww / 2, deck + h + 0.02, z - 0.02);
    }
  }
  function lightbar(B, x, y, z, len, depth) {
    box(B, 'matte', '#1a1a1a', len, 0.06, depth, x, y, z);
    box(B, 'flashA', '#ff0000', len * 0.46, 0.1, depth * 0.85, x - len * 0.25, y + 0.07, z);
    box(B, 'flashB', '#0000ff', len * 0.46, 0.1, depth * 0.85, x + len * 0.25, y + 0.07, z);
  }
  function sideDecal(B, S, key, u, y, len, h, out) {
    var x = S.sideX(u, y) + (out || 0.015);
    B.decal(key, len, h, mat(x, y, S.z(u), 0, Math.PI / 2, 0));
    B.decal(key, len, h, mat(-x, y, S.z(u), 0, -Math.PI / 2, 0));
  }

  // ---------- 车型模板 ----------
  // 每种车型给出车身/座舱参数（单位：米）
  var TYPES = {
    micro: { L: 3.05, W: 1.58, clear: 0.2, wR: 0.28, tw: 0.17, ax: [0.66, -0.68], pF: 3.6, pR: 5, nTop: 2.8, nBot: 4,
      top: [[-1, 0.54], [-0.95, 0.86], [0.55, 0.88], [0.9, 0.8], [1, 0.52]], bumpF: 0.08, bumpR: 0.08,
      gh: { gR: -0.92, rR: -0.82, rF: 0.18, gF: 0.58, roof: 1.58, tumble: 0.84, bU: [-0.12] }, grip: 0.95, rims: 'steel' },
    hatch: { L: 4.1, W: 1.78, clear: 0.17, wR: 0.31, tw: 0.2, ax: [0.63, -0.66], pF: 4, pR: 6, nTop: 2.8, nBot: 4,
      top: [[-1, 0.56], [-0.95, 0.87], [0.5, 0.9], [0.9, 0.8], [1, 0.5]], bumpF: 0.08, bumpR: 0.06,
      gh: { gR: -0.9, rR: -0.7, rF: 0.08, gF: 0.52, roof: 1.46, tumble: 0.8, bU: [-0.12] }, grip: 1.0 },
    sedan: { L: 4.75, W: 1.83, clear: 0.15, wR: 0.32, tw: 0.21, ax: [0.6, -0.6], pF: 4.2, pR: 5, nTop: 2.6, nBot: 4,
      top: [[-1, 0.6], [-0.95, 0.9], [-0.62, 0.95], [0.48, 0.92], [0.92, 0.8], [1, 0.52]], bumpF: 0.08, bumpR: 0.08,
      gh: { gR: -0.6, rR: -0.3, rF: 0.1, gF: 0.48, roof: 1.45, tumble: 0.78, bU: [-0.08], trim: true }, grip: 1.0 },
    suv: { L: 4.75, W: 1.92, clear: 0.28, wR: 0.38, tw: 0.24, ax: [0.6, -0.62], pF: 4.2, pR: 6, nTop: 3.8, nBot: 5,
      top: [[-1, 0.72], [-0.95, 1.08], [0.42, 1.1], [0.9, 1.04], [1, 0.74]], bumpF: 0.1, bumpR: 0.06, archGap: 0.08,
      grilleW: 0.95, grilleH: 0.28,
      gh: { gR: -0.94, rR: -0.82, rF: 0.08, gF: 0.42, roof: 1.75, tumble: 0.86, bU: [-0.14, -0.52], cW: 0.18 }, grip: 0.9,
      cladding: true, rails: true },
    offroad: { L: 4.45, W: 1.9, clear: 0.34, wR: 0.42, tw: 0.27, ax: [0.62, -0.62], pF: 9, pR: 12, nTop: 7, nBot: 7,
      top: [[-1, 0.8], [-0.97, 1.12], [0.65, 1.15], [0.95, 1.08], [1, 0.82]], archGap: 0.1,
      gh: { gR: -0.97, rR: -0.94, rF: 0.36, gF: 0.46, roof: 1.98, tumble: 0.94, n: 8, bU: [-0.06, -0.55], cW: 0.14, wsCurve: 1 },
      grip: 0.85, lights: 'round', spare: true, flares: true, rims: 'steel', tails: 'tall' },
    pickup: { L: 5.7, W: 2.02, clear: 0.36, wR: 0.42, tw: 0.27, ax: [0.62, -0.58], pF: 7, pR: 14, nTop: 6, nBot: 7,
      top: [[-1, 1.12], [-0.15, 1.12], [-0.1, 1.16], [0.7, 1.24], [0.95, 1.2], [1, 0.95]], archGap: 0.1, grilleW: 1.1, grilleH: 0.36,
      gh: { gR: -0.13, rR: -0.09, rF: 0.18, gF: 0.46, roof: 1.98, tumble: 0.9, n: 6, bU: [0.04], cW: 0.12 },
      grip: 0.85, bed: true, flares: true, tails: 'tall' },
    mpv: { L: 5.05, W: 1.88, clear: 0.17, wR: 0.34, tw: 0.22, ax: [0.62, -0.6], pF: 4.2, pR: 7, nTop: 3.4, nBot: 5,
      top: [[-1, 0.62], [-0.97, 0.98], [0.62, 1.0], [0.92, 0.84], [1, 0.52]],
      gh: { gR: -0.96, rR: -0.9, rF: 0.36, gF: 0.68, roof: 1.82, tumble: 0.9, n: 6, bU: [0.25, -0.25] }, grip: 0.88 },
    microvan: { L: 3.9, W: 1.62, clear: 0.18, wR: 0.28, tw: 0.17, ax: [0.6, -0.68], pF: 5, pR: 10, nTop: 5, nBot: 6,
      top: [[-1, 0.55], [-0.97, 0.9], [0.8, 0.92], [0.97, 0.85], [1, 0.55]],
      gh: { gR: -0.97, rR: -0.94, rF: 0.6, gF: 0.86, roof: 1.86, tumble: 0.94, n: 8, bU: [0.32, -0.3] }, grip: 0.85, rims: 'steel' },
    muscle: { L: 4.85, W: 1.94, clear: 0.14, wR: 0.36, tw: 0.26, ax: [0.6, -0.6], pF: 5, pR: 6.5, nTop: 3.4, nBot: 4,
      top: [[-1, 0.62], [-0.94, 0.92], [-0.55, 0.9], [0.28, 0.98], [0.92, 0.86], [1, 0.55]], bumpF: 0.04,
      gh: { gR: -0.56, rR: -0.24, rF: 0.0, gF: 0.33, roof: 1.36, tumble: 0.72 }, grip: 0.92, scoop: true, exhaust: 2 },
    coupe: { L: 4.6, W: 1.96, clear: 0.12, wR: 0.36, tw: 0.27, ax: [0.6, -0.62], pF: 3.6, pR: 4.6, nTop: 2.5, nBot: 4,
      top: [[-1, 0.58], [-0.95, 0.84], [-0.7, 0.86], [0.22, 0.84], [0.93, 0.63], [1, 0.44]], bumpF: 0.03,
      gh: { gR: -0.72, rR: -0.3, rF: -0.02, gF: 0.3, roof: 1.29, tumble: 0.7, rwCurve: 0.8 }, grip: 1.05, exhaust: 2, lights: 'slim' },
    mid: { L: 4.55, W: 2.0, clear: 0.1, wR: 0.36, tw: 0.28, ax: [0.58, -0.6], pF: 3.2, pR: 5, nTop: 2.4, nBot: 4,
      top: [[-1, 0.62], [-0.95, 0.86], [-0.6, 0.88], [0.15, 0.8], [0.92, 0.53], [1, 0.36]],
      gh: { gR: -0.56, rR: -0.22, rF: 0.04, gF: 0.5, roof: 1.18, tumble: 0.64, wsCurve: 1.5 }, grip: 1.15,
      intakes: true, louvers: true, lights: 'slim', exhaust: 2, diffuser: true, intake: true },
    hyper: { L: 4.75, W: 2.06, clear: 0.09, wR: 0.37, tw: 0.3, ax: [0.58, -0.6], pF: 3.0, pR: 4.6, nTop: 2.2, nBot: 4,
      top: [[-1, 0.62], [-0.95, 0.8], [-0.6, 0.8], [0.15, 0.72], [0.92, 0.45], [1, 0.3]],
      gh: { gR: -0.6, rR: -0.24, rF: 0.02, gF: 0.52, roof: 1.12, tumble: 0.6, wsCurve: 1.6 }, grip: 1.25,
      intakes: true, louvers: true, lights: 'slim', exhaust: 3, diffuser: true, fin: true, splitter: true, tails: 'bar', intake: true }
  };

  // 乘用车通用生成
  // 按等级生成确定性的随机数，让同类车型各有差异
  function seeded(seed) {
    var a = seed * 2654435761 >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function buildPassenger(B, car) {
    var base = TYPES[car.type];
    var rnd = seeded(car.level * 97 + 13);
    var jr = function (a) { return (rnd() * 2 - 1) * a; };
    var vary = car.opts && car.opts.noVary ? 0 : 1;
    // 车身轮廓微调
    var top = base.top.map(function (k, i) {
      var edge = i === 0 || i === base.top.length - 1;
      return [k[0], k[1] * (1 + vary * jr(edge ? 0.08 : 0.045))];
    });
    var gh = Object.assign({}, base.gh);
    gh.gF += vary * jr(0.04); gh.rF += vary * jr(0.05); gh.rR += vary * jr(0.05);
    gh.roof *= 1 + vary * jr(0.035);
    gh.tumble = Math.min(0.97, gh.tumble * (1 + vary * jr(0.05)));
    var o = Object.assign({}, base, {
      top: top, gh: gh,
      pF: base.pF * (1 + vary * jr(0.12)), pR: base.pR * (1 + vary * jr(0.12)),
      nTop: base.nTop * (1 + vary * jr(0.1))
    }, car.opts || {});
    var sporty = base.grip >= 1.05 || car.type === 'muscle';
    if (!car.opts.rims && !base.rims) o.rims = ['five', 'multi', 'y', 'mesh', 'turbine', 'five'][Math.floor(rnd() * 6)];
    if (!car.opts.rimColor && o.rims !== 'steel') {
      var rc = ['#c8c8c8', '#c8c8c8', '#2b2b2b', '#8d8d8d', '#1a1a1a'][Math.floor(rnd() * 5)];
      if (rc !== '#c8c8c8') o.rimColor = rc;
    }
    if (!car.opts.caliper && sporty) o.caliper = ['#cc0000', '#f0c419', '#1846b8', '#ff6a00', null][Math.floor(rnd() * 5)] || undefined;
    var L = o.L * (o.sL || 1), W = o.W * (o.sW || 1);
    var hl = L / 2;
    var P = {
      L: L, W: W, clear: o.clear, wR: o.wR, archGap: o.archGap || 0.06, pF: o.pF, pR: o.pR, nTop: o.nTop, nBot: o.nBot,
      top: o.top.map(function (k) { return [k[0], k[1] * (o.sH || 1)]; }), bumpF: o.bumpF, bumpR: o.bumpR,
      bulge: o.bulge !== undefined ? o.bulge : ({ mid: 0.07, hyper: 0.08, coupe: 0.05, muscle: 0.045, offroad: 0.03 }[car.type] || 0.025),
      axles: o.ax.map(function (a) { return a * hl; })
    };
    // 截面：硬派车型接近方盒子，收放小；跑车腰线低、上半部收得多
    var boxy = o.nTop >= 5;
    P.sS = o.sS !== undefined ? o.sS : (boxy ? 0.45 : (sporty ? 0.22 : 0.32));
    P.sR = -0.5;
    P.gT = boxy ? 0.985 : (sporty ? 0.9 : 0.93);
    P.gR = boxy ? 0.99 : 0.975;
    P.gB = boxy ? 0.95 : 0.9;
    P.band = o.cladding ? -0.3 : (boxy ? -0.55 : -0.62);
    var S = new Shape(P);
    var color = car.color, accent = car.accent;
    lowerBody(B, S, color, o.split);
    var G = Object.assign({}, o.gh);
    G.roof *= (o.sH || 1);
    if (o.roofColor) G.roofColor = o.roofColor;
    if (o.pillar) G.pillar = o.pillar;
    if (o.ghOverride) Object.assign(G, o.ghOverride);
    var gh = greenhouse(B, S, G, color);
    o.level = car.level;
    var W8 = { R: o.wR, tw: o.tw, style: o.rims || 'five', rim: o.rimColor, caliper: o.caliper, rimBucket: o.rimColor && o.rimColor !== '#c8c8c8' ? 'paint' : 'chrome',
      ri: o.rims === 'steel' ? 0.62 : (car.type === 'offroad' || car.type === 'pickup' ? 0.64 : (sporty ? 0.74 : 0.69)), capColor: accent || '#1a1a1a', dish: sporty ? 0.045 : 0.03 };
    wheels(B, P, W8, S);
    headlights(B, S, o);
    taillights(B, S, o);
    grille(B, S, o);
    rearDetails(B, S, o);
    mirrors(B, S, G, gh, color);
    handles(B, S, gh, [lerp(G.gR, G.gF, 0.62)].concat(G.bU && G.bU.length ? [G.bU[0] - 0.12] : []));
    if (!o.noSeams) seams(B, S, gh, [Math.min(G.gF - 0.02, G.rF + 0.06)].concat(G.bU || []).concat(G.bU && G.bU.length && car.type !== 'micro' ? [G.rR - 0.02] : []));
    details(B, S, G, gh, o, car);

    // 包围/护板
    if (o.cladding || o.flares) {
      P.axles.forEach(function (za) {
        var ar = P.wR + P.archGap + 0.05;
        for (var s = -1; s <= 1; s += 2) {
          var x = S.sideX(za / hl, P.wR + ar * 0.6);
          var tor = new T.TorusGeometry(ar, o.flares ? 0.07 : 0.045, 6, 18, Math.PI);
          tor.rotateY(Math.PI / 2);
          B.add(tor, 'matte', '#1a1a1a', mat(s * (x + 0.01), P.wR, za));
        }
      });
    }
    if (o.rails) {
      for (var rs = -1; rs <= 1; rs += 2) {
        var x1 = gh.wtop(G.rR) * 0.85, x2 = gh.wtop(G.rF) * 0.85;
        beam(B, 'matte', '#202020', V(rs * x1, gh.yt(G.rR) + 0.06, S.z(G.rR + 0.02)), V(rs * x2, gh.yt(G.rF) + 0.06, S.z(G.rF - 0.02)), 0.05, 0.05);
      }
    }
    if (o.spare) {
      var tg = tireGeo(o.wR * 0.95, o.tw, o.wR * 0.95 * 0.62);
      B.add(tg, 'matte', '#141414', mat(0, S.y1(-0.98) * 0.62 + 0.15, S.rearZ(0) - o.tw / 2 + 0.02, 0, Math.PI / 2, 0));
      var cv = new T.CylinderGeometry(o.wR * 0.65, o.wR * 0.65, 0.04, 20);
      cv.rotateX(Math.PI / 2);
      B.add(cv, 'paint', accent || color, mat(0, S.y1(-0.98) * 0.62 + 0.15, S.rearZ(0) - o.tw - 0.0));
    }
    if (o.bed) {
      // 货斗：内衬 + 尾门
      var zb1 = S.z(-0.97), zb2 = S.z(-0.16), by = S.y1(-0.5);
      box(B, 'matte', '#1b1b1b', W * 0.84, 0.04, zb2 - zb1, 0, by + 0.005, (zb1 + zb2) / 2);
      if (o.rollbar) {
        for (var bs = -1; bs <= 1; bs += 2) beam(B, 'matte', '#151515', V(bs * W * 0.4, by, zb2 - 0.1), V(bs * W * 0.4, by + 0.45, zb2 - 0.1), 0.06, 0.06);
        beam(B, 'matte', '#151515', V(-W * 0.4, by + 0.45, zb2 - 0.1), V(W * 0.4, by + 0.45, zb2 - 0.1), 0.06, 0.06);
      }
    }
    if (o.scoop) box(B, 'paint', accent || color, 0.5, 0.08, 0.6, 0, S.y1(0.55) + 0.03, S.z(0.55), 0.05);
    if (o.stripes) {
      // 赛车条纹：机盖和后备箱盖贴合曲面，车顶部分沿顶线铺
      var stc = o.stripes;
      for (var ss = -1; ss <= 1; ss += 2) {
        var sx0 = ss * 0.07, sx1 = ss * 0.25;
        if (G.gF + 0.03 < 0.97) tq(B, 'paint', stc, S, rect(sx0, S.z(G.gF + 0.03), sx1, S.z(0.975)), 0.006, 2, 16);
        if (G.gR - 0.03 > -0.97) tq(B, 'paint', stc, S, rect(sx0, S.z(-0.975), sx1, S.z(G.gR - 0.03)), 0.006, 2, 12);
        var segs = 10;
        for (var q = 0; q < segs; q++) {
          var u1 = lerp(G.rR, G.rF, q / segs), u2 = lerp(G.rR, G.rF, (q + 1) / segs);
          beam(B, 'paint', stc, V(ss * 0.16, gh.yt(u1) + 0.012, S.z(u1)), V(ss * 0.16, gh.yt(u2) + 0.012, S.z(u2)), 0.18, 0.008);
        }
      }
    }
    if (o.intakes) {
      // 车门后方的侧进气口：前尖后宽
      for (var is = -1; is <= 1; is += 2) {
        var iu0 = -0.36, iu1 = -0.02, iyA = S.y0(-0.2), iyB = S.y1(-0.2), iH = iyB - iyA;
        var ic = [[S.z(iu0), iyA + iH * 0.3], [S.z(iu1), iyA + iH * 0.5], [S.z(iu1), iyA + iH * 0.56], [S.z(iu0), iyA + iH * 0.74]];
        sq(B, 'matte', '#08080a', S, is, ic, 0.006);
        sq(B, 'paint', color, S, is, sub(ic, 0.0, 0.9, 0.44, 0.56), 0.012, 6, 1);
      }
    }
    if (o.louvers) {
      for (var li = 0; li < 5; li++) {
        var lu = lerp(-0.86, -0.62, li / 4), lw = Math.min(W * 0.24, S.w(lu) * 0.55);
        tq(B, 'matte', '#09090b', S, rect(-lw, S.z(lu) - 0.03, lw, S.z(lu) + 0.03), 0.005, 8, 1);
      }
    }
    if (o.horseshoe) {
      // 马蹄形格栅：车头正中的镀铬拱形框 + 深色网
      var ny0 = S.y0(0.95), ny1 = S.y1(0.95), hr = Math.min(0.15, (ny1 - ny0) * 0.36);
      var hy = lerp(ny0, ny1, 0.6), hz = S.frontZ(0) - 0.01;
      var hs = new T.TorusGeometry(hr, 0.02, 6, 16, Math.PI);
      B.add(hs, 'chrome', '#e0e0e0', mat(0, hy, hz + 0.03));
      box(B, 'chrome', '#e0e0e0', 0.028, hr, 0.03, hr, hy - hr / 2, hz + 0.03);
      box(B, 'chrome', '#e0e0e0', 0.028, hr, 0.03, -hr, hy - hr / 2, hz + 0.03);
      box(B, 'matte', '#0a0a0a', hr * 1.9, hr * 1.7, 0.04, 0, hy - hr * 0.2, hz + 0.005);
    }
    if (o.fin) {
      // 竖直尾鳍：从车顶延伸到车尾
      var zr = S.z(G.rR), yr = gh.yt(G.rR) - 0.01, zt = S.z(-0.9), yd = S.y1(-0.9);
      var fs = new T.Shape();
      fs.moveTo(zr, yr); fs.lineTo(zt, Math.max(yd + 0.22, yr - 0.12)); fs.lineTo(zt, yd - 0.02); fs.lineTo(zr - 0.4, gh.yb(G.rR - 0.05));
      fs.closePath();
      var fg = new T.ExtrudeGeometry(fs, { depth: 0.03, bevelEnabled: false });
      fg.translate(0, 0, -0.015);
      fg.rotateY(-Math.PI / 2);
      B.add(fg, 'paint', o.finColor || color);
    }
    if (o.splitter) {
      var spw = S.w(0.9) * 1.9;
      box(B, 'matte', '#0b0b0b', spw, 0.03, 0.3, 0, S.y0(0.95) + 0.02, S.z(0.95));
    }
    if (o.wing) wing(B, S, o, color);
    if (o.police) {
      lightbar(B, 0, gh.yt((G.rR + G.rF) / 2) + 0.03, S.z((G.rR + G.rF) / 2 + 0.05), W * 0.62, 0.26);
      var pu = (G.gR + G.gF) / 2 - 0.05, py = lerp(S.y0(pu), S.y1(pu), 0.52);
      sideDecal(B, S, 'police', pu, py, (G.gF - G.gR) * hl * 1.15, 0.36);
      B.decal('policeHood', 0.7, 0.35, mat(0, S.y1(0.62) + 0.02, S.z(0.62), -Math.PI / 2, 0, 0));
    }
    if (o.taxi) {
      var tu = (G.rR + G.rF) / 2, ty = gh.yt(tu) + 0.12;
      box(B, 'light', '#ffd21f', 0.62, 0.2, 0.26, 0, ty, S.z(tu));
      B.decal('taxi', 0.6, 0.2, mat(0, ty, S.z(tu) + 0.135, 0, 0, 0));
      B.decal('taxi', 0.6, 0.2, mat(0, ty, S.z(tu) - 0.135, 0, Math.PI, 0));
    }
    if (o.rescue) {
      lightbar(B, 0, gh.yt((G.rR + G.rF) / 2) + 0.05, S.z((G.rR + G.rF) / 2), W * 0.6, 0.24);
      var ru = -0.05, ry = lerp(S.y0(ru), S.y1(ru), 0.5);
      sideDecal(B, S, 'rescue', ru, ry, L * 0.42, 0.36);
    }
    return { L: L, W: W, H: Math.max(G.roof + (o.police || o.taxi ? 0.25 : 0), 1) };
  }

  // 箱形大车身（公交、厢货、消防车车厢）
  function boxBody(B, z1, z2, W, y0, y1, color, pF, pR, n, bucket) {
    var S = new Shape({ L: z2 - z1, W: W, zc: (z1 + z2) / 2, clear: y0, wR: 0.1, top: [[-1, y1], [1, y1]], pF: pF, pR: pR, nTop: n, nBot: n, axles: [] });
    var us = sampleU(S.P), RING = 22;
    B.add(loft(us.map(function (u) { return S.z(u); }), function (z, k) {
      var u = us[k], w = S.w(u), yc = (y0 + y1) / 2, h = (y1 - y0) / 2, pts = [];
      for (var j = 0; j < RING; j++) {
        var t = -Math.PI / 2 + j / RING * Math.PI * 2;
        pts.push([w * spow(Math.cos(t), 2 / n), yc + h * spow(Math.sin(t), 2 / n)]);
      }
      return pts;
    }, true), bucket || 'paint', color);
    return S;
  }

  // 大车车尾：保险杠、组合尾灯、牌照。S 是车尾所在的车身，yb 是保险杠高度
  function heavyRear(B, S, W, yb, o) {
    var z = S.faceZ(0, yb + 0.3, -1);
    // 保险杠
    box(B, 'matte', '#16171a', W * 0.98, 0.18, 0.14, 0, yb, z - 0.05);
    for (var s = -1; s <= 1; s += 2) {
      // 组合尾灯：从下到上 白（倒车）、黄（转向）、红（刹车）
      var x0 = W / 2 - 0.36, x1 = W / 2 - 0.06, ly = yb + 0.16, lh = o.tall ? 0.62 : 0.4, step = lh / 3;
      fq(B, 'matte', '#0c0c0e', S, -1, rect(s * (x0 - 0.03), ly - 0.03, s * (x1 + 0.03), ly + lh + 0.03), 0.008);
      fq(B, 'glass', '#d6dae0', S, -1, rect(s * x0, ly, s * x1, ly + step - 0.02), 0.014);
      fq(B, 'light', '#ffa020', S, -1, rect(s * x0, ly + step, s * x1, ly + step * 2 - 0.02), 0.014);
      fq(B, 'light', '#ff1a1a', S, -1, rect(s * x0, ly + step * 2, s * x1, ly + lh), 0.014);
      // 示廓灯
      fq(B, 'light', '#ff3020', S, -1, rect(s * (W / 2 - 0.2), o.top - 0.12, s * (W / 2 - 0.08), o.top - 0.06), 0.014);
    }
    plate(B, S, { level: o.level, plateKind: 'big' }, -1, yb + 0.26);
    if (o.chevron) {
      var cz = S.faceZ(0, yb + 0.5, -1) - 0.015;
      B.decal('chevron', W * 0.5, 0.22, mat(-W * 0.24, yb + 0.12, z - 0.125, 0, Math.PI, 0));
      B.decal('chevron', W * 0.5, 0.22, mat(W * 0.24, yb + 0.12, z - 0.125, 0, Math.PI, 0));
    }
  }

  // 公交车 / 双层巴士 / 校车
  function buildBus(B, car) {
    var o = car.opts || {}, kind = car.type;
    var L = o.L || (kind === 'dbus' ? 10.8 : (kind === 'schoolbus' ? 10.2 : 11.6)), W = 2.5, hl = L / 2;
    var R = 0.5;
    var hood = kind === 'schoolbus' ? 1.5 : 0;
    var axF = hl - (kind === 'schoolbus' ? 1.1 : 2.4), axR = -hl + (kind === 'dbus' ? 2.6 : 2.9);
    var top = kind === 'schoolbus' ? [[-1, 1.25], [1 - hood * 2 / L - 0.01, 1.25], [1 - hood * 2 / L + 0.03, 1.38], [0.97, 1.3], [1, 0.9]] : [[-1, 1.2], [1, 1.2]];
    var P = { L: L, W: W, clear: 0.32, wR: R, archGap: 0.08, top: top, pF: kind === 'schoolbus' ? 5 : 16, pR: 16, nTop: 9, nBot: 9, axles: [axF, axR],
      sS: 0.6, sR: -0.5, gT: 1, gR: 1, gB: 0.98, band: kind === 'schoolbus' ? -0.72 : -0.55 };
    var S = new Shape(P);
    var c = car.color, a = car.accent;
    lowerBody(B, S, c);
    var bodyEnd = hl - hood;
    var decks = kind === 'dbus' ? [[1.2, 2.25], [2.6, 3.85]] : [[kind === 'schoolbus' ? 1.25 : 1.2, kind === 'schoolbus' ? 2.6 : 2.75]];
    var roofTop = kind === 'dbus' ? 4.25 : (kind === 'schoolbus' ? 2.95 : 3.1);
    decks.forEach(function (d, i) {
      boxBody(B, -hl + 0.02, bodyEnd - 0.02, W * 0.985, d[0], d[1], '#1c2733', 14, 14, 12, 'glass');
      // 立柱
      var step = kind === 'schoolbus' ? 0.85 : 1.3;
      for (var z = -hl + 0.6; z < bodyEnd - 0.8; z += step) {
        for (var s = -1; s <= 1; s += 2) box(B, 'paint', i === 0 && kind !== 'dbus' ? c : c, 0.06, d[1] - d[0], 0.16, s * W * 0.495, (d[0] + d[1]) / 2, z);
      }
      // 楼层之间车身
      var nextBottom = i < decks.length - 1 ? decks[i + 1][0] : roofTop;
      boxBody(B, -hl, bodyEnd, W, d[1] - 0.02, nextBottom, i === decks.length - 1 && o.roofColor ? o.roofColor : c, 14, 14, i === decks.length - 1 ? 5 : 12);
    });
    // 前风挡框、腰线
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      box(B, 'paint', a || c, 0.03, 0.12, L - hood - 0.4, s2 * (W / 2 + 0.005), 1.0, -hood / 2);
    }
    if (kind === 'schoolbus') {
      for (var s3 = -1; s3 <= 1; s3 += 2) {
        box(B, 'matte', '#111111', 0.03, 0.06, L - hood - 0.4, s3 * (W / 2 + 0.01), 0.75, -hood / 2);
        box(B, 'matte', '#111111', 0.03, 0.06, L - hood - 0.4, s3 * (W / 2 + 0.01), 1.18, -hood / 2);
      }
      B.decal('school', 1.9, 0.4, mat(0, 2.78, bodyEnd + 0.02));
      B.decal('school', 1.9, 0.4, mat(0, 2.78, -hl - 0.02, 0, Math.PI, 0));
      // 停车臂
      box(B, 'paint', '#d01010', 0.04, 0.4, 0.4, -W / 2 - 0.05, 1.7, bodyEnd - 1.2);
    } else {
      // 线路屏
      var sy = decks[decks.length - 1][1] + 0.18;
      box(B, 'matte', '#0a0a0a', W * 0.8, 0.3, 0.05, 0, sy, bodyEnd + 0.01);
      B.decal('bus', W * 0.76, 0.26, mat(0, sy, bodyEnd + 0.04));
      // 空调
      box(B, 'paint', '#e8e8e8', 1.4, 0.25, 2.4, 0, roofTop + 0.12, -hl * 0.2);
      if (kind === 'dbus') sideDecal(B, S, 'tour', -0.2, 2.42, 4, 0.5, 0.03);
    }
    // 车门（右侧）
    box(B, 'glass', '#22313f', 0.04, 1.85, 1.1, W / 2 + 0.01, 1.3, axF - 1.3);
    if (kind === 'bus') box(B, 'glass', '#22313f', 0.04, 1.85, 1.1, W / 2 + 0.01, 1.3, -0.4);
    var lights = { lights: 'bus', lightY: kind === 'schoolbus' ? 0.95 : 0.7, tails: 'tall', tailY: 1.0, grilleW: 1.2, grilleH: 0.3, grilleY: kind === 'schoolbus' ? 0.95 : 0.55, grilleChrome: kind === 'schoolbus', plateKind: 'big', level: car.level, noIntake: true, plateY: kind === 'schoolbus' ? 0.6 : 0.48, noReflector: true, exhaust: 0 };
    headlights(B, S, lights);
    grille(B, S, lights);
    // 车尾：发动机舱百叶 + 组合灯 + 保险杠
    if (kind !== 'schoolbus') {
      for (var lv = 0; lv < 5; lv++) {
        var ly = 0.62 + lv * 0.1;
        fq(B, 'matte', '#101114', S, -1, rect(-0.55, ly, 0.55, ly + 0.05), 0.008, 10, 1);
      }
    }
    heavyRear(B, S, W, 0.4, { level: car.level, top: 1.18, tall: true });
    // 后视镜
    for (var m = -1; m <= 1; m += 2) beam(B, 'matte', '#111111', V(m * W / 2, 2.2, bodyEnd - 0.1), V(m * (W / 2 + 0.35), 1.9, bodyEnd + 0.25), 0.05, 0.05);
    for (var m2 = -1; m2 <= 1; m2 += 2) box(B, 'matte', '#111111', 0.1, 0.38, 0.18, m2 * (W / 2 + 0.36), 1.75, bodyEnd + 0.27);
    wheels(B, P, { R: R, tw: 0.3, style: 'truck', dual: true, inset: 0.05 });
    return { L: L, W: W, H: roofTop };
  }

  // 消防车 / 救护车 / 厢式货车：驾驶室 + 车厢
  function buildTruck(B, car) {
    var o = car.opts || {}, kind = car.type;
    var isFire = kind === 'fire' || kind === 'aerial';
    var L = isFire ? (kind === 'aerial' ? 10 : 8.4) : 6.2, W = isFire ? 2.5 : 2.1, hl = L / 2;
    var R = isFire ? 0.55 : 0.38;
    var c = car.color, a = car.accent;
    var cabL = isFire ? 2.4 : 2.0;
    var cabZ1 = hl - cabL, ax = isFire ? [hl - 1.2, -hl + 2.4, -hl + 1.1] : [hl - 0.95, -hl + 1.4];
    // 驾驶室
    var cabTop = isFire ? 1.65 : 1.0;
    var P = { L: cabL, W: W, zc: hl - cabL / 2, clear: isFire ? 0.5 : 0.25, wR: R, archGap: 0.08, axles: [ax[0]],
      top: isFire ? [[-1, cabTop], [1, cabTop - 0.05]] : [[-1, 1.05], [0.2, 1.05], [0.85, 0.95], [1, 0.6]],
      pF: isFire ? 10 : 3.2, pR: 12, nTop: isFire ? 8 : 4, nBot: 8 };
    var S = new Shape(P);
    lowerBody(B, S, c);
    var G = isFire ? { gR: -0.97, rR: -0.93, rF: 0.88, gF: 0.96, roof: 2.85, tumble: 0.97, n: 9, bU: [0.1], pillarW: 0.1, wsCurve: 1 }
      : { gR: -0.97, rR: -0.93, rF: 0.0, gF: 0.62, roof: 2.15, tumble: 0.92, n: 7, bU: [-0.3] };
    var gh = greenhouse(B, S, G, c);
    mirrors(B, S, G, gh, '#1a1a1a');
    // 车厢
    var bodyTop = isFire ? 2.9 : 2.6, bodyBot = isFire ? 0.55 : 0.4;
    var bz2 = cabZ1 - 0.08, bz1 = -hl;
    var BS = boxBody(B, bz1, bz2, W, bodyBot, bodyTop, isFire ? c : (o.boxColor || '#f4f4f4'), 14, 14, 10);
    // 车厢底盘、轮拱
    box(B, 'matte', '#141414', W * 0.9, 0.35, L - 0.4, 0, bodyBot - 0.05, -0.2);
    ax.slice(1).forEach(function (za) { box(B, 'matte', '#0d0d0f', W + 0.02, R * 0.7, R * 2.3, 0, R * 1.55 + 0.05, za); });
    if (isFire) {
      // 卷帘门分格
      for (var s = -1; s <= 1; s += 2) {
        for (var z = bz1 + 0.5; z < bz2 - 0.2; z += 1.25) box(B, 'chrome', '#c9c9c9', 0.03, bodyTop - bodyBot - 0.4, 0.05, s * (W / 2 + 0.005), (bodyTop + bodyBot) / 2 + 0.05, z);
        box(B, 'matte', '#f2f2f2', 0.03, 0.14, bz2 - bz1, s * (W / 2 + 0.01), 1.05, (bz1 + bz2) / 2);
        box(B, 'chrome', '#d9d9d9', 0.03, 0.06, bz2 - bz1, s * (W / 2 + 0.01), bodyTop - 0.1, (bz1 + bz2) / 2);
      }
      sideDecal(B, BS, 'fire', 0.15, 1.75, 3.2, 0.8, 0.03);
      var cu = 0.0, cy = 1.15;
      sideDecal(B, S, 'fire', cu, cy, 1.6, 0.4, 0.02);
      // 云梯 / 梯子
      var lz1 = kind === 'aerial' ? bz1 + 0.3 : bz1 + 0.4, lz2 = kind === 'aerial' ? hl + 1.2 : bz2 - 0.3;
      var ly = bodyTop + (kind === 'aerial' ? 0.55 : 0.15);
      if (kind === 'aerial') {
        var tb = new T.CylinderGeometry(0.6, 0.7, 0.35, 16);
        B.add(tb, 'paint', '#d8d8d8', mat(0, bodyTop + 0.18, bz1 + 1.3));
        box(B, 'paint', '#e6e6e6', 0.9, 0.5, 0.8, 0, bodyTop + 0.55, bz1 + 1.3);
      }
      for (var rs = -1; rs <= 1; rs += 2) {
        box(B, 'chrome', '#e0e0e0', 0.06, 0.14, lz2 - lz1, rs * 0.45, ly, (lz1 + lz2) / 2);
        if (kind === 'aerial') box(B, 'chrome', '#e0e0e0', 0.05, 0.1, lz2 - lz1 - 1, rs * 0.38, ly + 0.18, (lz1 + lz2) / 2 + 0.3);
      }
      for (var rz = lz1 + 0.2; rz < lz2; rz += 0.32) box(B, 'chrome', '#d6d6d6', 0.9, 0.04, 0.04, 0, ly, rz);
      lightbar(B, 0, G.roof + 0.04, hl - 0.6, W * 0.8, 0.3);
      // 镀铬保险杠
      box(B, 'chrome', '#d0d0d0', W + 0.06, 0.25, 0.2, 0, 0.62, hl + 0.06);
    } else {
      // 救护车 / 厢货
      if (o.ambulance) {
        sideDecal(B, BS, 'ambulance', 0.05, 1.5, 3.2, 1.0, 0.03);
        lightbar(B, 0, bodyTop + 0.03, bz2 - 0.3, W * 0.75, 0.25);
        box(B, 'flashA', '#ff0000', 0.15, 0.15, 0.1, -W * 0.4, bodyTop - 0.12, bz1 - 0.02);
        box(B, 'flashB', '#0000ff', 0.15, 0.15, 0.1, W * 0.4, bodyTop - 0.12, bz1 - 0.02);
      } else if (o.decal) {
        sideDecal(B, BS, o.decal, 0.05, 1.6, 3.2, 0.8, 0.03);
      }
      // 对开后门：中缝、铰链、锁杆、把手
      var dz = BS.faceZ(0, 1.5, -1);
      box(B, 'matte', '#2a2a2a', 0.025, bodyTop - bodyBot - 0.2, 0.02, 0, (bodyTop + bodyBot) / 2, dz - 0.008);
      for (var ds = -1; ds <= 1; ds += 2) {
        box(B, 'chrome', '#b8b8b8', 0.035, bodyTop - bodyBot - 0.3, 0.035, ds * W * 0.24, (bodyTop + bodyBot) / 2, dz - 0.02);
        box(B, 'chrome', '#b8b8b8', 0.14, 0.04, 0.04, ds * W * 0.2, (bodyTop + bodyBot) / 2, dz - 0.03);
        for (var hg = 0; hg < 3; hg++) box(B, 'matte', '#3a3a3a', 0.14, 0.06, 0.03, ds * (W / 2 - 0.1), lerp(bodyBot + 0.3, bodyTop - 0.3, hg / 2), dz - 0.012);
      }
    }
    var lo = { lights: isFire ? 'round' : 'rect', lightY: isFire ? 0.95 : 0.72, lightX: W * 0.36, grilleW: W * 0.5, grilleH: isFire ? 0.5 : 0.22,
      grilleY: isFire ? 1.15 : 0.62, grilleChrome: isFire, plateKind: isFire ? 'big' : 'blue', level: car.level, noIntake: true, plateY: isFire ? 0.82 : 0.42, exhaust: 0 };
    headlights(B, S, lo);
    grille(B, S, lo);
    // 车尾：保险杠、组合灯、牌照（消防车加反光警示条）
    heavyRear(B, BS, W, bodyBot - 0.12, { level: car.level, top: bodyTop, chevron: isFire });
    var allAx = { L: L, W: W, axles: ax, wR: R };
    wheels(B, allAx, { R: R, tw: isFire ? 0.32 : 0.24, style: isFire ? 'truck' : 'steel', rim: isFire ? undefined : '#bdbdbd', dual: isFire, inset: 0.05 });
    return { L: L, W: W, H: isFire ? (kind === 'aerial' ? bodyTop + 1 : G.roof + 0.2) : bodyTop };
  }

  var _blobGeo = null, _blobMat = null;
  function blobGeo() {
    if (!_blobGeo) { _blobGeo = new T.PlaneGeometry(1, 1); _blobGeo.rotateX(-Math.PI / 2); }
    return _blobGeo;
  }
  function blobMat() {
    if (!_blobMat) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 64;
      var x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      _blobMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, opacity: 0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
      _blobMat.visible = false;
    }
    return _blobMat;
  }
  DC.setBlobShadows = function (on) { var m = blobMat(); m.visible = on; m.opacity = on ? 0.55 : 0; };

  function buildCar(level) {
    var car = DC.carOf(level);
    var B = new Builder(), dims;
    if (car.type === 'bus' || car.type === 'dbus' || car.type === 'schoolbus') dims = buildBus(B, car);
    else if (car.type === 'fire' || car.type === 'aerial' || car.type === 'boxvan') dims = buildTruck(B, car);
    else dims = buildPassenger(B, car);
    var g = B.build();
    // 车底的柔和假阴影：只在关闭实时阴影时显示
    var blob = new T.Mesh(blobGeo(), blobMat());
    blob.scale.set(dims.W * 1.25, 1, dims.L * 1.12);
    blob.position.y = 0.04;
    blob.renderOrder = 1;
    g.add(blob);
    g.userData = { level: level, length: dims.L, width: dims.W, height: dims.H, wheels: [] };
    return g;
  }

  var cache = {};
  DC.makeCar = function (level, steerable) {
    var key = steerable ? 's' + level : level;
    if (!cache[key]) {
      steerMode = !!steerable;
      try { cache[key] = buildCar(level); } finally { steerMode = false; }
    }
    var src = cache[key];
    var c = src.clone();
    var fw = [];
    c.traverse(function (o) { if (o.name === 'frontWheel') fw.push(o); });
    c.userData = Object.assign({}, src.userData, { wheels: [], frontWheels: fw });
    return c;
  };
  // 空闲时预先生成车型，避免比赛中首次出现时卡顿
  var warmQueue = [], warming = false;
  function warmStep(deadline) {
    var t0 = performance.now();
    while (warmQueue.length) {
      var l = warmQueue.shift();
      if (!cache[l]) {
        var steer = typeof l === 'string';
        steerMode = steer;
        try { cache[l] = buildCar(steer ? +l.slice(1) : l); } finally { steerMode = false; }
      }
      var left = deadline && deadline.timeRemaining ? deadline.timeRemaining() : 8 - (performance.now() - t0);
      if (left < 4) break;
    }
    if (warmQueue.length) schedule(); else warming = false;
  }
  function schedule() {
    if (window.requestIdleCallback) window.requestIdleCallback(warmStep, { timeout: 300 });
    else setTimeout(warmStep, 30);
  }
  DC.warmCars = function (from, to, steerable) {
    for (var l = Math.max(1, from); l <= Math.min(DC.MAX_LEVEL, to); l++) {
      var key = steerable ? 's' + l : l;
      if (!cache[key] && warmQueue.indexOf(key) < 0) warmQueue.push(key);
    }
    if (!warming && warmQueue.length) { warming = true; schedule(); }
  };

  DC.carDims = function (level) {
    if (!cache[level]) cache[level] = buildCar(level);
    return cache[level].userData;
  };
  DC.carGrip = function (level) {
    var t = DC.carOf(level).type;
    var g = { bus: 0.85, dbus: 0.84, schoolbus: 0.85, fire: 0.85, aerial: 0.84, boxvan: 0.9 }[t];
    if (g) return g;
    var base = TYPES[t].grip;
    // 车型的轮胎摩擦系数倍率（跑车更高、重型车更低）
    return Math.sqrt(base) * (1 + (level - 1) / 99 * 0.06);
  };

  // ---------- 环境反射贴图（让车漆、镀铬、玻璃有反光） ----------
  DC.makeEnvMap = function (renderer) {
    var s = new T.Scene();
    var geo = new T.SphereGeometry(50, 32, 16);
    var cols = [], pos = geo.attributes.position, c = new T.Color();
    var top = new T.Color('#c9dcf2'), hor = new T.Color('#f4efe6'), gnd = new T.Color('#3d3a38');
    for (var i = 0; i < pos.count; i++) {
      var y = pos.getY(i) / 50;
      if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.pow(-y, 0.4));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    s.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    // 柔光灯箱
    var lm = new T.MeshBasicMaterial({ color: '#ffffff' });
    [[0, 40, 0, 40, 1, 14], [30, 18, -20, 1, 10, 30], [-30, 18, 20, 1, 10, 30]].forEach(function (b) {
      var m = new T.Mesh(new T.BoxGeometry(b[3], b[4], b[5]), lm);
      m.position.set(b[0], b[1], b[2]);
      s.add(m);
    });
    var pm = new T.PMREMGenerator(renderer);
    var rt = pm.fromScene(s, 0.02);
    pm.dispose();
    return rt.texture;
  };

  // ---------- 等级徽章 ----------
  var badgeCache = {};
  DC.badgeTexture = function (level) {
    if (badgeCache[level]) return badgeCache[level];
    var cv = document.createElement('canvas');
    cv.width = 160; cv.height = 72;
    var x = cv.getContext('2d');
    var col = DC.tierOf(level).color;
    x.fillStyle = 'rgba(10,12,20,0.82)';
    roundRect(x, 4, 4, 152, 64, 18); x.fill();
    x.lineWidth = 6; x.strokeStyle = col;
    roundRect(x, 4, 4, 152, 64, 18); x.stroke();
    x.fillStyle = col;
    x.font = 'bold 42px "Segoe UI", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Lv' + level, 80, 39);
    var tex = new T.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.encoding = T.sRGBEncoding;
    badgeCache[level] = tex;
    return tex;
  };
  DC.makeBadge = function (level, scale) {
    var m = new T.SpriteMaterial({ map: DC.badgeTexture(level), depthTest: false, transparent: true });
    var s = new T.Sprite(m);
    var k = scale || 1;
    s.scale.set(2.4 * k, 1.08 * k, 1);
    s.renderOrder = 10;
    return s;
  };
  function roundRect(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  }

  // ---------- 车库缩略图 ----------
  var thumbRenderer = null, thumbScene = null, thumbCam = null, thumbCache = {};
  DC.carThumb = function (level) {
    if (thumbCache[level]) return thumbCache[level];
    if (!thumbRenderer) {
      thumbRenderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbRenderer.setSize(264, 156);
      thumbRenderer.outputEncoding = T.sRGBEncoding;
      thumbRenderer.toneMapping = T.ACESFilmicToneMapping;
      thumbScene = new T.Scene();
      thumbScene.environment = DC.makeEnvMap(thumbRenderer);
      thumbScene.add(new T.HemisphereLight('#ffffff', '#555566', 0.6));
      var d = new T.DirectionalLight('#ffffff', 1.4); d.position.set(4, 8, 5); thumbScene.add(d);
      thumbCam = new T.PerspectiveCamera(26, 264 / 156, 0.1, 200);
    }
    var car = DC.makeCar(level);
    var ud = car.userData;
    var size = Math.max(ud.length, ud.height * 1.6);
    var dist = size * 1.75;
    thumbCam.position.set(dist * 0.62, dist * 0.36 + ud.height * 0.3, dist * 0.72);
    thumbCam.lookAt(0, ud.height * 0.42, 0);
    thumbScene.add(car);
    thumbRenderer.render(thumbScene, thumbCam);
    var url = thumbRenderer.domElement.toDataURL('image/png');
    thumbScene.remove(car);
    thumbCache[level] = url;
    return url;
  };
})(window.DC);

/* 调试：从指定角度渲染车辆大图 */
(function (DC) {
  'use strict';
  var r = null, s = null, c = null;
  DC.debugRender = function (level, w, h, yaw, pitch) {
    var T = THREE;
    if (!r) {
      r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping;
      s = new T.Scene(); s.environment = DC.makeEnvMap(r);
      s.add(new T.HemisphereLight('#ffffff', '#555566', 0.6));
      var d = new T.DirectionalLight('#ffffff', 1.4); d.position.set(4, 8, 5); s.add(d);
      c = new T.PerspectiveCamera(26, 1, 0.1, 200);
    }
    r.setSize(w, h); c.aspect = w / h; c.updateProjectionMatrix();
    var car = DC.makeCar(level), ud = car.userData;
    var dist = Math.max(ud.length, ud.height * 1.6) * 1.9;
    var y = (yaw === undefined ? 0.7 : yaw), pt = (pitch === undefined ? 0.35 : pitch);
    c.position.set(Math.sin(y) * Math.cos(pt) * dist, Math.sin(pt) * dist + ud.height * 0.4, Math.cos(y) * Math.cos(pt) * dist);
    c.lookAt(0, ud.height * 0.42, 0);
    s.add(car); r.render(s, c); s.remove(car);
    return r.domElement.toDataURL('image/png');
  };
})(window.DC);
