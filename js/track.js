/* Z 字形悬空赛道：宽窄变化、飞跃坡、断桥、起伏坡、加速带、打滑区 */
(function (DC) {
  'use strict';
  var T = THREE;
  var LEFT = Math.PI / 4, RIGHT = -Math.PI / 4;
  DC.ANGLE_LEFT = LEFT; DC.ANGLE_RIGHT = RIGHT;
  var THICK = 1.6;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function canvasTex(w, h, draw, repeatX) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    var t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  DC.FEATURE_NAMES = { hill: '起伏坡', jump: '飞跃坡', gap: '断桥飞跃', boost: '加速带', slick: '打滑区' };

  function Track(scene, world) {
    this.scene = scene;
    this.world = world;
    this.segs = [];
    this.base = 0;
    this.group = new T.Group();
    scene.add(this.group);
    this.surface = 'asphalt';

    this.pillarGeo = new T.ConeGeometry(1, 1, 5, 1);
    this.pillarGeo.rotateX(Math.PI);
    this.pillarGeo.translate(0, -0.5, 0);

    var m = world.mats;
    this.asphaltB = m.asphalt.clone();
    this.asphaltB.polygonOffset = true; this.asphaltB.polygonOffsetFactor = -1; this.asphaltB.polygonOffsetUnits = -2;
    var po = function (mat, f) { mat.polygonOffset = true; mat.polygonOffsetFactor = f; mat.polygonOffsetUnits = f * 2; return mat; };
    this.curbMat = po(new T.MeshStandardMaterial({ map: canvasTex(128, 8, function (x) {
      x.fillStyle = '#e03131'; x.fillRect(0, 0, 64, 8); x.fillStyle = '#f5f5f5'; x.fillRect(64, 0, 64, 8);
    }), roughness: 0.7 }), -3);
    this.dashMat = po(new T.MeshBasicMaterial({ map: canvasTex(64, 8, function (x) {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 34, 8);
    }), transparent: true, opacity: 0.55, depthWrite: false }), -2);
    this.rampMat = po(new T.MeshStandardMaterial({ map: canvasTex(128, 128, function (x, w, h) {
      x.fillStyle = '#ffcc00'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#151515';
      for (var i = -2; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, h); x.lineTo(i * 64 + 32, h); x.lineTo(i * 64 + 96, 0); x.lineTo(i * 64 + 64, 0); x.closePath(); x.fill(); }
    }), roughness: 0.6 }), -2);
    this.boostTex = canvasTex(128, 128, function (x, w, h) {
      x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#3df5ff'; x.lineWidth = 16; x.lineCap = 'round';
      x.beginPath(); x.moveTo(20, 40); x.lineTo(64, 90); x.lineTo(108, 40); x.stroke();
    });
    this.boostMat = po(new T.MeshBasicMaterial({ map: this.boostTex, transparent: true, depthWrite: false, toneMapped: false, color: '#9ffcff' }), -3);
    this.boostBase = po(new T.MeshBasicMaterial({ color: '#0a4a66', transparent: true, opacity: 0.85, depthWrite: false }), -2);
    this.slickMat = po(new T.MeshStandardMaterial({ map: canvasTex(256, 256, function (x, w, h) {
      x.clearRect(0, 0, w, h);
      for (var i = 0; i < 26; i++) {
        var px = rand(30, w - 30), py = rand(30, h - 30), r = rand(18, 60);
        var g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(10,10,14,0.95)'); g.addColorStop(0.7, 'rgba(25,20,40,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      }
    }), transparent: true, roughness: 0.05, metalness: 0.6, depthWrite: false }), -3);
    this.topMatsA = [m.asphalt, m.rock];
    this.topMatsB = [this.asphaltB, m.rock];
    this.time = 0;
  }

  Track.prototype.syncThemeMats = function (dt) {
    this.asphaltB.color.copy(this.world.mats.asphalt.color);
    this.time += dt || 0;
    this.boostTex.offset.y = -this.time * 1.5;
  };

  Track.prototype.get = function (i) { return this.segs[i - this.base]; };
  Track.prototype.lastIndex = function () { return this.base + this.segs.length - 1; };

  Track.prototype.clear = function () {
    for (var i = 0; i < this.segs.length; i++) this.disposeSeg(this.segs[i]);
    this.segs = [];
    this.base = 0;
  };
  Track.prototype.disposeSeg = function (s) {
    this.group.remove(s.obj);
    s.obj.traverse(function (o) { if (o.userData.ownGeo) o.geometry.dispose(); });
  };

  DC.trackWidthOf = function (level) { var p = (level - 1) / 99; return 10.5 + 2.5 * p; };

  Track.prototype.reset = function (level, surface) {
    this.clear();
    this.surface = surface || 'asphalt';
    this.addSegment(0, 0, RIGHT, 75, DC.trackWidthOf(level), null, true, 0);
  };

  // ---------- 路段高度 ----------
  Track.prototype.heightAt = function (s, along) {
    var f = s.feat;
    if (!f || along < f.a || along > f.end) return 0;
    var t;
    if (f.type === 'hill') { t = (along - f.a) / (f.b - f.a); var sn = Math.sin(Math.PI * t); return f.H * sn * sn; }
    if (f.type === 'jump' || f.type === 'gap') {
      if (along <= f.b) { t = (along - f.a) / (f.b - f.a); return f.H * Math.pow(t, 1.6); }
      if (f.type === 'gap' && along < f.c) return null;
      return 0;
    }
    return 0;
  };
  Track.prototype.effectAt = function (s, along) {
    var f = s.feat;
    if (!f || along < f.a || along > f.b) return null;
    return f.type === 'boost' || f.type === 'slick' ? f.type : null;
  };

  Track.prototype.addSegment = function (ax, az, angle, len, w, feat, first, cum) {
    var idx = this.base + this.segs.length;
    var dx = Math.sin(angle), dz = Math.cos(angle);
    var s = {
      idx: idx, ax: ax, az: az, angle: angle, dx: dx, dz: dz, len: len, w: w,
      ex: ax + dx * len, ez: az + dz * len, first: !!first, feat: feat, cum: cum
    };
    s.obj = this.buildMesh(s);
    this.group.add(s.obj);
    this.segs.push(s);
    return s;
  };

  // ---------- 生成 ----------
  Track.prototype.extend = function (fromIdx, level, count) {
    var p = (level - 1) / 99;
    var v = DC.speedOf(level);
    var baseW = DC.trackWidthOf(level);
    while (this.lastIndex() < fromIdx + count) {
      var last = this.segs[this.segs.length - 1];
      var angle = last.angle > 0 ? RIGHT : LEFT;
      // 宽窄变化
      var r = Math.random(), wf;
      if (r < 0.16) wf = rand(0.68, 0.78);
      else if (r < 0.32) wf = rand(1.25, 1.45);
      else wf = rand(0.9, 1.1);
      var w = Math.max(6.5, baseW * wf);
      // 长短变化
      var t = Math.random() < 0.2 ? rand(2.2, 3.2) : rand(0.8 - 0.25 * p, 2.1 - 0.6 * p);
      var len = Math.max(w * 1.9, v * t);
      var feat = null;
      var n = this.segs.length + this.base;
      if (n > 2 && !last.feat && Math.random() < Math.min(0.5, 0.2 + 0.35 * p + (level > 1 ? 0.05 : 0))) {
        feat = this.makeFeature(level, v, w, p);
        if (feat) len = Math.max(len, feat.minLen);
      }
      // 避免赛道横向漂得太远
      var dirX = Math.sin(angle);
      if (!feat && dirX * last.ex > 0 && Math.abs(last.ex) > 40) len = Math.max(w * 1.9, len * 0.55);
      this.addSegment(last.ex, last.ez, angle, len, w, feat, false, last.cum + last.len);
    }
  };

  Track.prototype.makeFeature = function (level, v, w, p) {
    var pool = [['hill', 30], ['boost', 18]];
    if (level >= 3) pool.push(['jump', 22]);
    if (level >= 8) pool.push(['gap', 14 + 10 * p]);
    if (level >= 10) pool.push(['slick', 16]);
    var tot = 0; pool.forEach(function (x) { tot += x[1]; });
    var r = Math.random() * tot, type = pool[0][0];
    for (var i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r <= 0) { type = pool[i][0]; break; } }
    var f = { type: type };
    var a0 = w * 0.8 + v * 0.3;
    if (type === 'hill') {
      f.a = a0; f.b = f.a + Math.max(14, v * 0.85); f.H = rand(1.4, 2.6); f.end = f.b;
      f.minLen = f.b + w * 0.8 + v * 0.45;
    } else if (type === 'jump' || type === 'gap') {
      f.a = a0; f.b = f.a + Math.max(9, v * 0.42); f.H = 1.7; f.end = f.b;
      if (type === 'gap') { f.c = f.b + Math.max(5, v * 0.28); f.end = f.c; }
      f.minLen = f.b + v * 1.25 + w * 0.8;
    } else if (type === 'boost') {
      f.a = a0; f.b = f.a + 7; f.end = f.b; f.minLen = f.b + w + v * 0.3;
    } else {
      f.a = a0 * 0.8; f.b = f.a + Math.max(12, v * 0.7); f.end = f.b; f.minLen = f.b + w + v * 0.2;
    }
    return f;
  };

  // ---------- 网格 ----------
  // 沿路段方向采样剖面 [along, h]，跳台末端插入垂直落差
  Track.prototype.profile = function (s, from, to) {
    var pts = [], f = s.feat, self = this;
    var marks = [from, to];
    for (var a = Math.ceil(from / 3) * 3; a < to; a += 3) marks.push(a);
    if (f) {
      for (var i = 0; i <= 24; i++) marks.push(f.a + (f.b - f.a) * i / 24);
      if (f.c !== undefined) marks.push(f.c);
    }
    marks = marks.filter(function (m) { return m >= from && m <= to; }).sort(function (x, y) { return x - y; });
    var prev = -1e9;
    marks.forEach(function (m) {
      if (m - prev < 0.02) return;
      prev = m;
      if (f && (f.type === 'jump') && Math.abs(m - f.b) < 0.03) { pts.push([f.b, f.H]); pts.push([f.b + 0.01, 0]); return; }
      var h = self.heightAt(s, m);
      if (h === null) h = 0;
      if (f && f.type === 'gap' && Math.abs(m - f.b) < 0.03) h = f.H;
      pts.push([m, h]);
    });
    return pts;
  };

  function quad(arr, a, b, c, d) { arr.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], a[0], a[1], a[2], d[0], d[1], d[2], c[0], c[1], c[2]); }

  Track.prototype.roadPiece = function (s, from, to) {
    var hw = s.w / 2, pts = this.profile(s, from, to);
    var top = [], side = [], uvTop = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var z0 = pts[i][0], h0 = pts[i][1], z1 = pts[i + 1][0], h1 = pts[i + 1][1];
      quad(top, [hw, h0, z0], [hw, h1, z1], [-hw, h1, z1], [-hw, h0, z0]);
      for (var k = 0; k < 6; k++) uvTop.push(0, 0);
      quad(side, [hw, h0 - THICK, z0], [hw, h1 - THICK, z1], [hw, h1, z1], [hw, h0, z0]);
      quad(side, [-hw, h0, z0], [-hw, h1, z1], [-hw, h1 - THICK, z1], [-hw, h0 - THICK, z0]);
      quad(side, [-hw, h0 - THICK, z0], [-hw, h1 - THICK, z1], [hw, h1 - THICK, z1], [hw, h0 - THICK, z0]);
    }
    var f0 = pts[0], f1 = pts[pts.length - 1];
    quad(side, [-hw, f0[1] - THICK, f0[0]], [hw, f0[1] - THICK, f0[0]], [hw, f0[1], f0[0]], [-hw, f0[1], f0[0]]);
    quad(side, [hw, f1[1] - THICK, f1[0]], [-hw, f1[1] - THICK, f1[0]], [-hw, f1[1], f1[0]], [hw, f1[1], f1[0]]);
    var g = new T.BufferGeometry();
    var all = top.concat(side);
    g.setAttribute('position', new T.Float32BufferAttribute(all, 3));
    g.addGroup(0, top.length / 3, 0);
    g.addGroup(top.length / 3, side.length / 3, 1);
    g.computeVertexNormals();
    var mesh = new T.Mesh(g, s.idx % 2 ? this.topMatsB : this.topMatsA);
    mesh.receiveShadow = true;
    mesh.userData.ownGeo = true;
    return mesh;
  };

  // 贴着路面的条带（边线、虚线、加速带等）
  Track.prototype.ribbon = function (s, lat, width, from, to, lift, mat, uvLen) {
    if (to - from < 0.05) return null;
    var pts = this.profile(s, from, to), pos = [], uv = [];
    var x0 = lat - width / 2, x1 = lat + width / 2, acc = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var z0 = pts[i][0], h0 = pts[i][1] + lift, z1 = pts[i + 1][0], h1 = pts[i + 1][1] + lift;
      var v0 = acc / (uvLen || 1); acc += Math.abs(z1 - z0); var v1 = acc / (uvLen || 1);
      quad(pos, [x1, h0, z0], [x1, h1, z1], [x0, h1, z1], [x0, h0, z0]);
      uv.push(1, v0, 0, v1, 1, v1, 1, v0, 0, v0, 0, v1);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    var m = new T.Mesh(g, mat);
    m.userData.ownGeo = true;
    m.receiveShadow = true;
    return m;
  };

  Track.prototype.buildMesh = function (s) {
    var g = new T.Group();
    g.position.set(s.ax, 0, s.az);
    g.rotation.y = s.angle; // 局部 +Z 前进，+X 左侧
    var w = s.w, L = s.len, hw = w / 2, f = s.feat, self = this;
    var pieces = f && f.type === 'gap' ? [[-hw, f.b], [f.c, L + hw]] : [[-hw, L + hw]];
    function inter(a, b, fn) { pieces.forEach(function (pc) { var x = Math.max(a, pc[0]), y = Math.min(b, pc[1]); if (y > x) fn(x, y); }); }
    pieces.forEach(function (pc) { g.add(self.roadPiece(s, pc[0], pc[1])); });

    // 边线：内侧缩短、外侧延伸
    var endTurnLeft = s.angle < 0;
    var em = this.world.mats.edge;
    for (var side = -1; side <= 1; side += 2) {
      var isLeft = side > 0;
      var startOuter = s.first ? true : (isLeft === endTurnLeft);
      var endOuter = isLeft !== endTurnLeft;
      var z0 = startOuter ? -hw : hw, z1 = endOuter ? L + hw : L - hw;
      inter(z0, z1, function (a, b) { var r = self.ribbon(s, side * (hw - 0.25), 0.35, a, b, 0.03, em); if (r) g.add(r); });
    }
    // 中线
    inter(hw, L - hw, function (a, b) { var r = self.ribbon(s, 0, 0.25, a, b, 0.015, self.dashMat, 5); if (r) g.add(r); });

    // 弯道外侧路肩
    var outerSide = endTurnLeft ? -1 : 1;
    var curbA = this.ribbon(s, outerSide * (hw - 0.5), 0.9, L - hw, L + hw, 0.02, this.curbMat, 2);
    if (curbA) {
      // 让红白块沿路肩方向排列
      var uvA = curbA.geometry.attributes.uv;
      for (var i = 0; i < uvA.count; i++) { var vv = uvA.getY(i); uvA.setXY(i, vv, uvA.getX(i)); }
      g.add(curbA);
    }
    var cg = new T.PlaneGeometry(w, 0.9);
    cg.rotateX(-Math.PI / 2);
    var uvc = cg.attributes.uv;
    for (var j = 0; j < uvc.count; j++) uvc.setX(j, uvc.getX(j) * w / 2);
    var curbB = new T.Mesh(cg, this.curbMat);
    curbB.userData.ownGeo = true;
    curbB.position.set(0, 0.02, L + hw - 0.45);
    g.add(curbB);

    // 特殊路段装饰
    if (f) {
      if (f.type === 'jump' || f.type === 'gap') {
        var rr = this.ribbon(s, 0, w - 0.9, f.a, f.b, 0.025, this.rampMat, 4);
        if (rr) g.add(rr);
        var pr = new T.Mesh(this.pillarGeo, this.world.mats.rock);
        pr.scale.set(w * 0.45, 14 + f.H, w * 0.45);
        pr.position.set(0, f.H - THICK, f.b - 1);
        g.add(pr);
        if (f.type === 'gap') {
          var pg = new T.Mesh(this.pillarGeo, this.world.mats.rock);
          pg.scale.set(w * 0.45, 18, w * 0.45);
          pg.position.set(0, -THICK, f.c + 1.5);
          g.add(pg);
        }
      } else if (f.type === 'hill') {
        var ph = new T.Mesh(this.pillarGeo, this.world.mats.rock);
        ph.scale.set(w * 0.5, 16 + f.H, w * 0.5);
        ph.position.set(0, f.H - THICK, (f.a + f.b) / 2);
        g.add(ph);
      } else if (f.type === 'boost') {
        var bb = this.ribbon(s, 0, w * 0.55, f.a, f.b, 0.02, this.boostBase, 1); if (bb) g.add(bb);
        var ba = this.ribbon(s, 0, w * 0.5, f.a, f.b, 0.03, this.boostMat, 2.3); if (ba) g.add(ba);
      } else if (f.type === 'slick') {
        var sl = this.ribbon(s, 0, w * 0.86, f.a, f.b, 0.02, this.slickMat, w * 0.9);
        if (sl) {
          var uvs = sl.geometry.attributes.uv;
          for (var q = 0; q < uvs.count; q++) uvs.setX(q, uvs.getX(q) * w * 0.86 / (w * 0.9));
          g.add(sl);
        }
      }
    }

    // 岩柱
    var pil = new T.Mesh(this.pillarGeo, this.world.mats.rock);
    pil.scale.set(w * 0.62, rand(18, 40), w * 0.62);
    pil.position.set(0, -THICK, L);
    pil.rotation.y = Math.random() * 3;
    g.add(pil);
    if (L > 30 && !f) {
      var pil2 = new T.Mesh(this.pillarGeo, this.world.mats.rock);
      pil2.scale.set(w * 0.4, rand(8, 20), w * 0.35);
      pil2.position.set(rand(-1, 1), -THICK, L * rand(0.3, 0.6));
      g.add(pil2);
    }
    return g;
  };

  // ---------- 查询 ----------
  Track.prototype.localOf = function (s, x, z) {
    var rx = x - s.ax, rz = z - s.az;
    return { along: rx * s.dx + rz * s.dz, lat: rx * s.dz - rz * s.dx };
  };
  // 点是否落在某段路面上（断桥缺口不算）
  Track.prototype.contains = function (s, x, z, tol) {
    var rx = x - s.ax, rz = z - s.az;
    var along = rx * s.dx + rz * s.dz;
    var lat = rx * s.dz - rz * s.dx;
    var hw = s.w / 2 + (tol || 0);
    if (!(along >= -hw && along <= s.len + hw && Math.abs(lat) <= hw)) return false;
    if (s.feat && s.feat.type === 'gap' && along > s.feat.b && along < s.feat.c) return false;
    return true;
  };
  Track.prototype.locate = function (x, z, hint, tol) {
    var best = -1;
    for (var i = Math.max(this.base, hint - 1); i <= Math.min(this.lastIndex(), hint + 3); i++) {
      if (this.contains(this.get(i), x, z, tol)) { best = i; if (i >= hint) break; }
    }
    return best;
  };
  // 地面信息：{seg, along, lat, h, effect}；不在路面上返回 null
  Track.prototype.groundAt = function (x, z, hint) {
    var i = this.locate(x, z, hint, 0);
    if (i < 0) return null;
    var s = this.get(i), l = this.localOf(s, x, z);
    var h = this.heightAt(s, l.along);
    if (h === null) return null;
    return { seg: i, along: l.along, lat: l.lat, h: h, effect: this.effectAt(s, l.along) };
  };
  // 沿赛道的位置（用于路上车辆行驶）
  Track.prototype.pointAt = function (segIdx, along, lat) {
    var s = this.get(segIdx);
    if (!s) return null;
    return { x: s.ax + s.dx * along + s.dz * lat, z: s.az + s.dz * along - s.dx * lat, angle: s.angle };
  };
  // 按里程查找路段
  Track.prototype.segAtProgress = function (prog) {
    for (var i = 0; i < this.segs.length; i++) {
      var s = this.segs[i];
      if (prog >= s.cum && prog < s.cum + s.len) return s;
    }
    return null;
  };

  Track.prototype.prune = function (cur) {
    while (this.segs.length && this.base < cur - 5) {
      var s = this.segs.shift();
      this.disposeSeg(s);
      this.base++;
    }
  };

  DC.Track = Track;
})(window.DC);
