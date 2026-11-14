/* 场景景物：每个主题有自己的近景浮岛和远景地标，沿途循环摆放 */
(function (DC) {
  'use strict';
  var T = THREE;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ---------- 带顶点色的几何合并器 ----------
  var tmpC = new T.Color();
  function GB() { this.p = []; this.c = []; }
  GB.prototype.add = function (geo, color, m) {
    var g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    var a = g.attributes.position.array;
    tmpC.set(color);
    for (var i = 0; i < a.length; i += 3) { this.p.push(a[i], a[i + 1], a[i + 2]); this.c.push(tmpC.r, tmpC.g, tmpC.b); }
    g.dispose();
  };
  GB.prototype.build = function () {
    if (!this.p.length) return null;
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  function M(x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new T.Matrix4();
    m.compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)),
      new T.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
    return m;
  }
  // 让石头表面不规则：同一位置的顶点得到相同的偏移
  function jitter(geo, amt) {
    var a = geo.attributes.position.array;
    for (var i = 0; i < a.length; i += 3) {
      var h = Math.sin(a[i] * 12.9898 + a[i + 1] * 78.233 + a[i + 2] * 37.719) * 43758.5453;
      var f = h - Math.floor(h), h2 = Math.sin(h) * 9631.7, f2 = h2 - Math.floor(h2);
      a[i] += (f - 0.5) * amt; a[i + 2] += (f2 - 0.5) * amt; a[i + 1] += (f * f2 - 0.25) * amt * 0.6;
    }
    return geo;
  }
  var cyl = function (rt, rb, h, seg) { return new T.CylinderGeometry(rt, rb, h, seg || 7, 1); };
  var box = function (w, h, d) { return new T.BoxGeometry(w, h, d); };

  // 浮岛：顶面在 y=0，下方是倒锥形岩体
  function island(gb, r, depth, topC, rockC, rockC2) {
    gb.add(jitter(cyl(r, r * 0.88, depth * 0.22, 8), r * 0.12), topC, M(0, -depth * 0.11, 0));
    gb.add(jitter(cyl(r * 0.9, r * 0.45, depth * 0.4, 7), r * 0.14), rockC, M(0, -depth * 0.42, 0));
    gb.add(jitter(cyl(r * 0.47, r * 0.06, depth * 0.5, 6), r * 0.1), rockC2 || rockC, M(0, -depth * 0.85, 0));
  }
  function rocks(gb, r, color, n) {
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.28), d = rnd(0.2, 0.8) * r, s = rnd(0.5, 1.4);
      gb.add(jitter(new T.DodecahedronGeometry(s, 0), 0.3), color, M(Math.cos(a) * d, s * 0.4, Math.sin(a) * d, rnd(0, 3), rnd(0, 3), 0));
    }
  }

  // ---------- 各主题的景物 ----------
  var KITS = [
    // 0 黄昏峡谷
    {
      near: function () {
        var gb = new GB(), r = rnd(5, 10);
        island(gb, r, r * 2.4, '#c98a5c', '#a05c40', '#7c4532');
        var n = Math.floor(rnd(1, 4));
        for (var i = 0; i < n; i++) {
          var a = rnd(0, 6.28), d = rnd(0, 0.6) * r, h = rnd(2.5, 5), x = Math.cos(a) * d, z = Math.sin(a) * d;
          gb.add(cyl(0.38, 0.45, h, 7), '#3f7d4a', M(x, h / 2, z));
          gb.add(new T.SphereGeometry(0.38, 7, 4), '#3f7d4a', M(x, h, z));
          for (var s = -1; s <= 1; s += 2) {
            if (Math.random() < 0.25) continue;
            var ay = rnd(0.35, 0.6) * h, al = rnd(0.8, 1.6);
            gb.add(cyl(0.24, 0.24, 0.9, 6), '#3a7345', M(x + s * 0.55, ay, z, 0, 0, Math.PI / 2));
            gb.add(cyl(0.24, 0.26, al, 6), '#3a7345', M(x + s * 0.95, ay + al / 2, z));
          }
        }
        rocks(gb, r, '#8f5038', 3);
        return { solid: gb.build() };
      },
      far: function () {
        var gb = new GB(), r = rnd(16, 34), h = rnd(70, 130);
        var cols = ['#b5664a', '#c98058', '#9c5038', '#d08e62'];
        var y = 0, layers = 5;
        for (var i = 0; i < layers; i++) {
          var lh = h / layers * rnd(0.8, 1.2), rr = r * (1 - i * 0.03) * rnd(0.92, 1.05);
          gb.add(jitter(cyl(rr, rr * rnd(0.95, 1.08), lh, 9), r * 0.08), cols[i % cols.length], M(0, y - lh / 2, 0));
          y -= lh;
        }
        if (Math.random() < 0.5) { // 石拱
          var tor = new T.TorusGeometry(r * 0.55, r * 0.16, 5, 9, Math.PI);
          gb.add(jitter(tor, r * 0.05), '#b5664a', M(0, 0, 0));
        } else gb.add(jitter(cyl(r * 0.25, r * 0.4, r * 0.9, 7), r * 0.06), '#a85a40', M(r * 0.3, r * 0.45, 0));
        return { solid: gb.build(), top: rnd(-5, 28) };
      }
    },
    // 1 雪山之巅
    {
      near: function () {
        var gb = new GB(), r = rnd(5, 10);
        island(gb, r, r * 2.2, '#f4f8ff', '#9aa6b5', '#7b8797');
        var n = Math.floor(rnd(2, 6));
        for (var i = 0; i < n; i++) {
          var a = rnd(0, 6.28), d = rnd(0, 0.7) * r, x = Math.cos(a) * d, z = Math.sin(a) * d, s = rnd(0.7, 1.4);
          gb.add(cyl(0.18 * s, 0.24 * s, 1.2 * s, 6), '#5a4030', M(x, 0.6 * s, z));
          for (var k = 0; k < 3; k++) {
            gb.add(new T.ConeGeometry((1.5 - k * 0.38) * s, 1.9 * s, 7), k === 2 ? '#e9f2fb' : '#2f5d50', M(x, (1.6 + k * 1.15) * s, z));
          }
        }
        gb.add(jitter(new T.SphereGeometry(r * 0.35, 6, 4), 0.5), '#ffffff', M(rnd(-2, 2), 0.1, rnd(-2, 2), 0, 0, 0, 1, 0.45, 1));
        return { solid: gb.build() };
      },
      far: function () {
        var gb = new GB(), r = rnd(22, 42), h = rnd(60, 120);
        gb.add(jitter(new T.ConeGeometry(r, h, 7), r * 0.14), '#8f9bab', M(0, h / 2 - 50, 0));
        gb.add(jitter(new T.ConeGeometry(r * 0.5, h * 0.5, 7), r * 0.07), '#f6faff', M(0, h * 0.75 - 50 + 0.5, 0));
        for (var i = 0; i < 4; i++) {
          var a = rnd(0, 6.28), d = r * rnd(0.5, 0.9), sh = rnd(18, 40);
          gb.add(new T.ConeGeometry(rnd(2.5, 5), sh, 5), '#bfe6ff', M(Math.cos(a) * d, -50 + sh / 2 + rnd(0, 15), Math.sin(a) * d, rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2)));
        }
        return { solid: gb.build(), top: 0 };
      }
    },
    // 2 沙漠烈日
    {
      near: function () {
        var gb = new GB(), r = rnd(5.5, 10);
        island(gb, r, r * 2.2, '#e6c283', '#c08a4c', '#a06a36');
        if (Math.random() < 0.6) gb.add(cyl(r * 0.35, r * 0.35, 0.1, 10), '#3aa7c9', M(rnd(-1, 1), 0.06, rnd(-1, 1)));
        var n = Math.floor(rnd(1, 4));
        for (var i = 0; i < n; i++) {
          var a = rnd(0, 6.28), d = rnd(0.3, 0.75) * r, x = Math.cos(a) * d, z = Math.sin(a) * d;
          var lean = rnd(-0.25, 0.25), th = rnd(4, 6.5), px = x, py = 0;
          for (var k = 0; k < 4; k++) { // 弯曲的树干
            gb.add(cyl(0.22, 0.26, th / 4 + 0.1, 6), '#8a6a45', M(px, py + th / 8, z, 0, 0, -lean * k * 0.5));
            px += lean * 0.55; py += th / 4;
          }
          for (var l = 0; l < 7; l++) {
            var la = l / 7 * 6.28;
            gb.add(new T.ConeGeometry(0.5, 3.2, 4), '#3f8f4f', M(px + Math.cos(la) * 1.3, py - 0.3, z + Math.sin(la) * 1.3, 0, -la, -Math.PI / 2 - 0.45, 1, 1, 0.35));
          }
        }
        rocks(gb, r, '#b5814a', 2);
        return { solid: gb.build() };
      },
      far: function () {
        var gb = new GB(), r = rnd(34, 60);
        island(gb, r, 90, '#e2bd7c', '#bf8748', '#9c6832');
        var n = Math.floor(rnd(1, 3.2));
        for (var i = 0; i < n; i++) {
          var s = rnd(14, 30) * (i ? 0.6 : 1), x = (i - (n - 1) / 2) * r * 0.55, z = rnd(-0.2, 0.2) * r;
          var py = new T.ConeGeometry(s, s * 1.25, 4);
          gb.add(py, '#dcb06a', M(x, s * 0.62, z, 0, Math.PI / 4, 0));
          gb.add(new T.ConeGeometry(s * 0.16, s * 0.2, 4), '#f6e6b4', M(x, s * 1.16, z, 0, Math.PI / 4, 0));
        }
        if (Math.random() < 0.5) gb.add(cyl(0.9, 1.4, 16, 4), '#caa060', M(r * 0.6, 8, r * 0.3, 0, Math.PI / 4, 0));
        return { solid: gb.build(), top: rnd(-12, 6) };
      }
    },
    // 3 霓虹夜城
    {
      near: function () { return tower(rnd(9, 17), rnd(9, 17), rnd(45, 80), true); },
      far: function () {
        var o = tower(rnd(16, 30), rnd(16, 30), rnd(150, 260), false);
        o.top = rnd(25, 120);
        return o;
      }
    },
    // 4 极光冰原
    {
      near: function () {
        var gb = new GB(), gl = new GB(), r = rnd(5, 9.5);
        island(gb, r, r * 2.2, '#e4f8ff', '#86b9cb', '#5b8ea3');
        var n = Math.floor(rnd(3, 7)), gc = pick(['#5dffd2', '#6fd6ff', '#b58bff']);
        for (var i = 0; i < n; i++) {
          var a = rnd(0, 6.28), d = rnd(0, 0.65) * r, h = rnd(2.5, 8), w = rnd(0.5, 1.2);
          var m = M(Math.cos(a) * d, h / 2 - 0.3, Math.sin(a) * d, rnd(-0.3, 0.3), rnd(0, 3), rnd(-0.3, 0.3));
          gb.add(cyl(w * 0.15, w, h, 6), '#c9f6ff', m);
          gl.add(cyl(w * 0.1, w * 0.55, h * 0.96, 6), gc, m);
        }
        return { solid: gb.build(), glow: gl.build() };
      },
      far: function () {
        var gb = new GB(), gl = new GB(), n = Math.floor(rnd(3, 6)), gc = pick(['#3dffc6', '#4fc3ff', '#a070ff']);
        gb.add(jitter(new T.ConeGeometry(rnd(26, 40), 70, 7), 4), '#5f93a8', M(0, -45, 0));
        for (var i = 0; i < n; i++) {
          var a = rnd(0, 6.28), d = rnd(0, 16), h = rnd(40, 110), w = rnd(5, 11);
          var m = M(Math.cos(a) * d, h / 2 - 30, Math.sin(a) * d, rnd(-0.25, 0.25), rnd(0, 3), rnd(-0.25, 0.25));
          gb.add(cyl(w * 0.12, w, h, 6), '#bdf3ff', m);
          gl.add(cyl(w * 0.08, w * 0.5, h * 0.97, 6), gc, m);
        }
        return { solid: gb.build(), glow: gl.build(), top: rnd(-10, 20) };
      }
    }
  ];

  // 霓虹城市的楼：深色楼体 + 发光的窗户、霓虹灯条和楼顶设施
  function tower(w, d, h, roofDetail) {
    var gb = new GB(), gl = new GB();
    var body = pick(['#141a2e', '#1a1430', '#101b2a', '#1c1c28']);
    gb.add(box(w, h, d), body, M(0, -h / 2, 0));
    var neon = pick(['#ff2bd6', '#3df5ff', '#ffe14d', '#7a5cff', '#ff6a3d']);
    var winC = ['#ffe9a8', '#bfe9ff', '#ffd27a', neon];
    // 窗户：只铺上部（下面被云海遮住）
    var rows = Math.min(16, Math.floor(h / 5)), colsX = Math.max(2, Math.floor(w / 3.2)), colsZ = Math.max(2, Math.floor(d / 3.2));
    for (var r = 0; r < rows; r++) {
      var y = -3 - r * 4.6;
      for (var f = 0; f < 4; f++) {
        var cols = f % 2 ? colsZ : colsX, span = f % 2 ? d : w;
        for (var c = 0; c < cols; c++) {
          if (Math.random() < 0.45) continue;
          var u = (c + 0.5) / cols * span - span / 2;
          var q = new T.PlaneGeometry(span / cols * 0.62, 2.0);
          var m = f === 0 ? M(u, y, d / 2 + 0.05) : f === 1 ? M(w / 2 + 0.05, y, u, 0, Math.PI / 2, 0)
            : f === 2 ? M(u, y, -d / 2 - 0.05, 0, Math.PI, 0) : M(-w / 2 - 0.05, y, u, 0, -Math.PI / 2, 0);
          gl.add(q, pick(winC), m);
        }
      }
    }
    // 楼顶霓虹边线
    var e = 0.35;
    gl.add(box(w + 0.3, e, e), neon, M(0, 0.1, d / 2));
    gl.add(box(w + 0.3, e, e), neon, M(0, 0.1, -d / 2));
    gl.add(box(e, e, d + 0.3), neon, M(w / 2, 0.1, 0));
    gl.add(box(e, e, d + 0.3), neon, M(-w / 2, 0.1, 0));
    // 竖向灯条
    if (Math.random() < 0.6) gl.add(box(0.5, Math.min(h * 0.6, 50), 0.5), pick(['#ff2bd6', '#3df5ff', '#ffe14d']), M(w / 2 + 0.2, -Math.min(h * 0.3, 25), d / 2 + 0.2));
    if (roofDetail) {
      gb.add(box(w * 0.3, 1.6, d * 0.25), '#23283a', M(-w * 0.2, 0.8, d * 0.15));
      gb.add(box(w * 0.18, 1.1, d * 0.18), '#2a3046', M(w * 0.22, 0.55, -d * 0.2));
      if (Math.random() < 0.5) { // 停机坪
        var ring = new T.RingGeometry(w * 0.16, w * 0.2, 20);
        gl.add(ring, '#ffe14d', M(w * 0.15, 0.12, d * 0.15, -Math.PI / 2, 0, 0));
      } else { // 广告牌
        gb.add(box(0.3, 3.2, 0.3), '#2a3046', M(0, 1.6, 0));
        gl.add(box(w * 0.55, 2.6, 0.25), neon, M(0, 4.3, 0));
      }
    } else {
      // 天线和航空障碍灯
      var ah = rnd(10, 30);
      gb.add(cyl(0.3, 0.6, ah, 5), '#2a3046', M(0, ah / 2, 0));
      gl.add(new T.SphereGeometry(0.9, 6, 4), '#ff3030', M(0, ah + 0.5, 0));
      if (Math.random() < 0.5) gb.add(box(w * 0.6, h * 0.12, d * 0.6), body, M(0, h * 0.06, 0));
    }
    return { solid: gb.build(), glow: gl.build() };
  }

  // ---------- 景物管理 ----------
  var NEAR_N = 34, FAR_N = 22, VARIANTS = 6;

  function Scenery(scene) {
    this.scene = scene;
    this.solidMat = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.25 });
    this.glowMat = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.cache = {};
    this.props = [];
    for (var i = 0; i < NEAR_N + FAR_N; i++) {
      var g = new T.Group();
      g.visible = false;
      scene.add(g);
      this.props.push({ group: g, far: i >= NEAR_N, key: null });
    }
    this.theme = 0;
  }

  Scenery.prototype.variant = function (theme, far) {
    var k = theme + (far ? 'f' : 'n') + Math.floor(Math.random() * VARIANTS);
    if (!this.cache[k]) this.cache[k] = (far ? KITS[theme].far : KITS[theme].near)();
    return { key: k, v: this.cache[k] };
  };

  Scenery.prototype.place = function (p, cx, cz, initial, theme) {
    var pv = this.variant(theme, p.far);
    if (p.key !== pv.key) {
      while (p.group.children.length) p.group.remove(p.group.children[0]);
      if (pv.v.solid) p.group.add(new T.Mesh(pv.v.solid, this.solidMat));
      if (pv.v.glow) p.group.add(new T.Mesh(pv.v.glow, this.glowMat));
      p.key = pv.key;
    }
    var side = Math.random() < 0.5 ? -1 : 1, x, y, z;
    if (p.far) {
      // 远景地标：放在赛道活动范围之外
      x = side * rnd(120, 330);
      y = pv.v.top !== undefined ? pv.v.top : rnd(-10, 25);
      z = initial ? cz + rnd(-80, 620) : cz + rnd(480, 660);
    } else {
      // 近景浮岛：比赛道低，可以出现在赛道附近和下方
      x = cx + side * rnd(14, 95);
      y = theme === 3 ? rnd(-30, -12) : rnd(-26, -10);
      z = initial ? cz + rnd(-60, 420) : cz + rnd(330, 460);
    }
    p.group.position.set(x, y, z);
    p.group.rotation.y = theme === 3 ? Math.floor(rnd(0, 4)) * Math.PI / 2 + rnd(-0.15, 0.15) : rnd(0, 6.28);
    var s = p.far ? 1 : rnd(0.8, 1.3);
    p.group.scale.set(s, s, s);
    p.group.visible = true;
  };

  Scenery.prototype.reset = function (cx, cz, theme) {
    this.theme = theme;
    for (var i = 0; i < this.props.length; i++) this.place(this.props[i], cx, cz, true, theme);
  };

  Scenery.prototype.update = function (cam, theme) {
    this.theme = theme;
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i], g = p.group;
      if (g.position.z < cam.position.z - (p.far ? 160 : 70) || (!p.far && Math.abs(g.position.x - cam.position.x) > 170)) {
        this.place(p, cam.position.x, cam.position.z, false, theme);
      }
    }
  };

  DC.Scenery = Scenery;
})(window.DC);
