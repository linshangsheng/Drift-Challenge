/* Z 字形悬空赛道：宽窄变化、弯角变化（缓弯到发卡弯）、上下坡、飞跃坡、大跳台、断桥、起伏坡、加速带、打滑区 */
(function (DC) {
  'use strict';
  var T = THREE;
  var LEFT = Math.PI / 4, RIGHT = -Math.PI / 4;
  DC.ANGLE_LEFT = LEFT; DC.ANGLE_RIGHT = RIGHT;
  var THICK = 1.6, UVS = 13; // UVS：纹理每 13 米重复一次

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
  var Y_MIN = -4, Y_MAX = 24; // 赛道高度的活动范围
  var DEG = Math.PI / 180;

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
    // 路面细节纹理：颗粒、斑驳和细裂纹（与主题颜色相乘）
    m.asphalt.map = canvasTex(256, 256, function (x, w, h) {
      x.fillStyle = '#d2d2d2'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 26; i++) {
        var px = rand(0, w), py = rand(0, h), r = rand(20, 70), dark = Math.random() < 0.6;
        for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
          var g = x.createRadialGradient(px + ox * w, py + oy * h, 0, px + ox * w, py + oy * h, r);
          g.addColorStop(0, dark ? 'rgba(120,120,120,0.22)' : 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(160,160,160,0)');
          x.fillStyle = g; x.fillRect(px + ox * w - r, py + oy * h - r, r * 2, r * 2);
        }
      }
      for (var k = 0; k < 9000; k++) {
        var v = Math.random() < 0.5 ? 255 : 90;
        x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + rand(0.05, 0.22) + ')';
        x.fillRect(rand(0, w), rand(0, h), rand(1, 2.2), rand(1, 2.2));
      }
      x.strokeStyle = 'rgba(70,70,70,0.25)'; x.lineWidth = 1;
      for (var c = 0; c < 7; c++) {
        var cx = rand(0, w), cy = rand(0, h);
        x.beginPath(); x.moveTo(cx, cy);
        for (var q = 0; q < 6; q++) { cx += rand(-22, 22); cy += rand(-22, 22); x.lineTo(cx, cy); }
        x.stroke();
      }
    });
    m.asphalt.needsUpdate = true;
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
    // 路边参照物：急弯导向牌、加速带拱门、跳台旗杆
    this.chevronMat = new T.MeshBasicMaterial({ map: canvasTex(128, 64, function (x, w, h) {
      x.fillStyle = '#d81e2c'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#ffffff'; x.lineWidth = 13; x.lineJoin = 'miter';
      for (var i = 0; i < 2; i++) { x.beginPath(); x.moveTo(26 + i * 46, 8); x.lineTo(56 + i * 46, 32); x.lineTo(26 + i * 46, 56); x.stroke(); }
    }), toneMapped: false }); // 只画正面：从背后看不到牌子，也就不会看到反向的箭头
    this.chevronGeoR = new T.PlaneGeometry(2.5, 1.25);
    this.chevronGeoL = new T.PlaneGeometry(2.5, 1.25);
    var cuv = this.chevronGeoL.attributes.uv;
    for (var ci = 0; ci < cuv.count; ci++) cuv.setX(ci, 1 - cuv.getX(ci));
    this.gateMat = new T.MeshBasicMaterial({ color: '#58f2ff', toneMapped: false });
    this.flagMat = new T.MeshBasicMaterial({ color: '#ffcc00', toneMapped: false });
    this.poleMat = new T.MeshStandardMaterial({ color: '#d9dde3', roughness: 0.5, metalness: 0.4 });
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

  // 赛道随车速加宽，让允许的时机误差不至于随等级缩得太厉害
  DC.trackWidthOf = function (level) { var p = (level - 1) / 99; return 10.5 + (DC.TRACK_WIDEN || 14) * Math.pow(p, 0.8); };

  Track.prototype.reset = function (level, surface) {
    this.clear();
    this.surface = surface || 'asphalt';
    this.trend = 1; this.trendLeft = 3; this.chicane = 0;
    var w = DC.trackWidthOf(level);
    this.addSegment({ ax: 0, az: 0, angle: RIGHT, len: 75, w: w, feat: null, first: true, cum: 0, y0: 0, y1: 0, eS: w / 2, nAngle: LEFT, nW: w });
  };

  // ---------- 路段高度 ----------
  // 路面基准高度：弯道两端是平的，中间按 S 形曲线上坡或下坡；跳台、断桥的落点可以比起跳点低
  Track.prototype.baseAt = function (s, along) {
    if (s.y1 === s.y0) return s.y0;
    var f = s.feat;
    if (f && (f.type === 'jump' || f.type === 'gap')) return along <= f.b ? s.y0 : s.y1;
    var t = clamp((along - s.m0) / (s.m1 - s.m0), 0, 1);
    return s.y0 + (s.y1 - s.y0) * t * t * (3 - 2 * t);
  };
  // 路面高度；断桥缺口处返回 null
  Track.prototype.heightAt = function (s, along) {
    var f = s.feat, b = this.baseAt(s, along);
    if (!f || along < f.a || along > f.end) return b;
    var t;
    if (f.type === 'hill') { t = (along - f.a) / (f.b - f.a); var sn = Math.sin(Math.PI * t); return b + f.H * sn * sn; }
    if (f.type === 'jump' || f.type === 'gap') {
      if (along <= f.b) { t = (along - f.a) / (f.b - f.a); return b + f.H * Math.pow(t, 1.6); }
      if (f.type === 'gap' && along < f.c) return null;
    }
    return b;
  };
  // 附近路段的最低高度（判断是否已经掉到路面以下）
  Track.prototype.floorNear = function (hint) {
    var m = 1e9;
    for (var i = Math.max(this.base, hint - 1); i <= Math.min(this.lastIndex(), hint + 3); i++) { var s = this.get(i); m = Math.min(m, s.y0, s.y1); }
    return m === 1e9 ? 0 : m;
  };
  Track.prototype.effectAt = function (s, along) {
    var f = s.feat;
    if (!f || along < f.a || along > f.b) return null;
    return f.type === 'boost' || f.type === 'slick' ? f.type : null;
  };

  // o: { ax, az, angle, len, w, feat, first, cum, y0, y1, eS, nAngle, nW }
  // nAngle / nW 是下一段的方向和宽度：弯角的几何（外角延伸多少）取决于前后两段，所以要提前定好
  Track.prototype.addSegment = function (o) {
    var idx = this.base + this.segs.length;
    var dx = Math.sin(o.angle), dz = Math.cos(o.angle);
    var s = {
      idx: idx, ax: o.ax, az: o.az, angle: o.angle, dx: dx, dz: dz, len: o.len, w: o.w,
      ex: o.ax + dx * o.len, ez: o.az + dz * o.len, first: !!o.first, feat: o.feat, cum: o.cum,
      y0: o.y0, y1: o.y1, eS: o.eS, nAngle: o.nAngle, nW: o.nW
    };
    s.turn = Math.abs(o.nAngle - o.angle);          // 这一段末端的转角
    s.eE = cornerExt(o.w / 2, o.nW / 2, s.turn);    // 末端向前延伸的长度
    s.m0 = s.eS + 2; s.m1 = s.len - s.eE - 2;       // 坡道只在两个弯之间
    s.obj = this.buildMesh(s);
    this.group.add(s.obj);
    this.segs.push(s);
    if (this.onSegment) this.onSegment(s);
    return s;
  };

  // 弯角处，本段（半宽 hw）要越过交点延伸多远，外侧边线才能与另一段（半宽 hwo）的外侧边线相交
  function cornerExt(hw, hwo, turn) {
    return clamp((hwo - hw * Math.cos(turn)) / Math.sin(turn), 0.3, hw * 2.4);
  }
  DC.cornerExt = cornerExt;

  // 路段方向：大多数接近 45°，也有更陡（连起来就是发卡弯）和更缓（高速弯）的
  function pickAngle(sign, n, chicane, level) {
    var r = Math.random(), a;
    if (DC.debugAngle) a = DC.debugAngle(n); // 测试用
    else if (n < 4) a = 45;
    else if (level < 4) a = rand(41, 49); // 最初几级先熟悉接近 90° 的弯
    else if (chicane) a = rand(36, 46);
    else if (r < 0.5) a = rand(41, 49);
    else if (r < 0.76) a = rand(52, 59);
    else a = rand(32, 38);
    return sign * a * DEG;
  }
  function pickWidth(baseW) {
    var r = Math.random(), wf;
    if (r < 0.16) wf = rand(0.74, 0.84);
    else if (r < 0.32) wf = rand(1.25, 1.45);
    else wf = rand(0.9, 1.1);
    return Math.max(6.5, baseW * wf);
  }
  // 弯越急侧滑越远（约与 1 - cosθ 成正比），急弯两侧的路要够宽、够长才过得去
  function widthK(turn) {
    var rmax = 1 + Math.sqrt(Math.max(0, 1 - 0.85 * Math.sin(turn)));
    return 2 * (DC.SLIDE_RATIO || 0.88) * (1 - Math.cos(turn)) / (rmax * rmax) * 0.9;
  }
  function airTime(vy, drop) { return (vy + Math.sqrt(vy * vy + 60 * drop)) / 30; }

  // ---------- 生成 ----------
  Track.prototype.extend = function (fromIdx, level, count) {
    var p = (level - 1) / 99;
    var v = DC.speedOf(level);
    var baseW = DC.trackWidthOf(level);
    while (this.lastIndex() < fromIdx + count) {
      var last = this.segs[this.segs.length - 1];
      var n = last.idx + 1;
      var angle = last.nAngle, w = last.nW, hw = w / 2;
      var eS = cornerExt(hw, last.w / 2, last.turn);
      // 下一段的方向和宽度
      // 连续短弯：一连几段又短又密的弯，没有特殊路段
      if (this.chicane > 0) this.chicane--;
      else if (n > 6 && level >= 3 && Math.random() < 0.07) this.chicane = 3 + Math.floor(Math.random() * 3);
      var inCh = this.chicane > 0;
      var sg = angle > 0 ? -1 : 1, nAngle = pickAngle(sg, n + 1, inCh, level), nW = inCh ? baseW * rand(0.95, 1.1) : pickWidth(baseW);
      // 本段的宽度已经定了：太窄就把下一个弯放缓；下一段不够宽就加宽
      while (w < baseW * widthK(Math.abs(nAngle - angle)) && Math.abs(nAngle) > 34 * DEG) nAngle -= sg * 3 * DEG;
      var turn = Math.abs(nAngle - angle);
      nW = Math.max(nW, baseW * widthK(turn));
      var eE = cornerExt(hw, nW / 2, turn);
      // 路段长度要容得下前一个弯滑完、后一个弯开始滑
      var slideLen = (DC.SLIDE_RATIO || 0.88) * baseW * (Math.tan(last.turn / 2) + Math.tan(turn / 2));
      var minLen = Math.max(slideLen, eS + eE + w * 0.9);
      // 长短变化
      var t = inCh ? 0.5 : (Math.random() < 0.2 ? rand(2.2, 3.2) : rand(0.8 - 0.25 * p, 2.1 - 0.6 * p));
      var len = Math.max(minLen, v * t);
      var feat = null;
      if (n > 2 && !inCh && !last.feat && Math.random() < Math.min(0.5, 0.2 + 0.35 * p + (level > 1 ? 0.05 : 0))) {
        feat = this.makeFeature(level, v, w, p, eS, eE, last.y1);
        if (feat) len = Math.max(len, feat.minLen);
      }
      // 限制赛道的横向活动范围：向外的路段到边界就截短，放不下的特殊路段取消
      var dirX = Math.sin(angle), XMAX = 60;
      var room = (XMAX - last.ex * Math.sign(dirX)) / Math.abs(dirX); // 沿这个方向还能走多远
      if (len > room) {
        if (feat && feat.minLen > room) feat = null;
        len = Math.max(minLen, feat ? feat.minLen : 0, Math.min(len, room));
      }
      // 高度变化
      var y0 = last.y1, y1 = y0;
      if (feat && (feat.type === 'jump' || feat.type === 'gap')) y1 = y0 - (feat.drop || 0);
      else if (n > 3 && (!feat || feat.type !== 'hill')) {
        var Lp = len - eS - eE - 4, tt = Lp / v;
        // 坡顶的曲率不能让车在弯前意外腾空，所以路段越短（按行驶时间算）坡越小
        var dyMax = Math.min(9, 0.16 * Lp, 2.2 * tt * tt);
        // 高度有走势：连续几段下坡（山道俯冲）或连续上坡，到了范围边界就掉头
        if (--this.trendLeft <= 0 || (this.trend > 0 ? y0 > Y_MAX - 3 : y0 < Y_MIN + 3)) {
          this.trend = y0 > (Y_MIN + Y_MAX) / 2 ? -1 : 1;
          if (y0 > Y_MIN + 6 && y0 < Y_MAX - 6 && Math.random() < 0.35) this.trend = -this.trend;
          this.trendLeft = 3 + Math.floor(Math.random() * 5);
        }
        if (dyMax > 0.6 && Math.random() < 0.72) {
          var up = Math.random() < (this.trend > 0 ? 0.85 : 0.15);
          if (feat && feat.type === 'boost' && y0 > Y_MIN + 2) up = false; // 加速带配下坡俯冲
          y1 = clamp(y0 + (up ? 1 : -1) * dyMax * rand(0.55, 1), Y_MIN, Y_MAX);
          if (Math.abs(y1 - y0) < 0.4) y1 = y0;
        }
      }
      this.addSegment({ ax: last.ex, az: last.ez, angle: angle, len: len, w: w, feat: feat, first: false, cum: last.cum + last.len,
        y0: y0, y1: y1, eS: eS, nAngle: nAngle, nW: nW });
    }
  };

  Track.prototype.makeFeature = function (level, v, w, p, eS, eE, y) {
    var pool = [['hill', 28], ['boost', 18]];
    if (level >= 3) pool.push(['jump', 26]);
    if (level >= 8) pool.push(['gap', 14 + 10 * p]);
    if (level >= 10) pool.push(['slick', 14]);
    var tot = 0; pool.forEach(function (x) { tot += x[1]; });
    var r = Math.random() * tot, type = pool[0][0];
    for (var i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r <= 0) { type = pool[i][0]; break; } }
    var f = { type: type };
    var a0 = eS + w * 0.3 + v * 0.3, tail = eE + 2;
    if (type === 'hill') {
      f.a = a0; f.b = f.a + Math.max(14, v * 0.85); f.H = rand(1.4, 2.6); f.end = f.b;
      f.minLen = f.b + tail + v * 0.45;
    } else if (type === 'jump' || type === 'gap') {
      // 大跳台：坡更高，落点更低，滞空更久
      var big = type === 'jump' && level >= 6 && Math.random() < 0.4;
      var Lr = big ? Math.max(12, v * 0.5) : Math.max(9, v * 0.42);
      f.H = big ? 3.2 : 1.7; f.big = big;
      f.a = a0; f.b = f.a + Lr; f.end = f.b;
      var room = y - Y_MIN;
      f.drop = big ? clamp(rand(4.5, 7), 0, room) : (Math.random() < 0.6 ? clamp(rand(2, 4.5), 0, room) : 0);
      if (type === 'gap') { f.c = f.b + Math.max(5, v * 0.28); f.end = f.c; f.drop = Math.min(f.drop, 3); }
      if (f.drop < 1) f.drop = 0;
      // 按 1.2 倍车速估算飞行距离，落地后还要留出入弯的距离
      var vy = 1.2 * v * 1.6 * f.H / Lr;
      f.minLen = f.b + 1.2 * v * airTime(vy, f.drop) + v * 0.5 + tail;
    } else if (type === 'boost') {
      f.a = a0; f.b = f.a + 7; f.end = f.b; f.minLen = f.b + tail + w * 0.5 + v * 0.3;
    } else {
      // 油污放在上一个弯滑完之后，不让车还在侧滑时就压上去
      f.a = a0 + v * 0.35; f.b = f.a + Math.max(12, v * 0.7); f.end = f.b; f.minLen = f.b + tail + w * 0.5 + v * 0.2;
    }
    return f;
  };

  // ---------- 网格 ----------
  // 沿路段方向采样剖面 [along, h]，跳台末端插入垂直落差
  Track.prototype.profile = function (s, from, to) {
    var pts = [], f = s.feat, self = this;
    var marks = [from, to];
    for (var a = Math.ceil(from / 3) * 3; a < to; a += 3) marks.push(a);
    marks.push(s.m0, s.m1);
    if (f) {
      for (var i = 0; i <= 24; i++) marks.push(f.a + (f.b - f.a) * i / 24);
      if (f.c !== undefined) marks.push(f.c);
    }
    marks = marks.filter(function (m) { return m >= from && m <= to; }).sort(function (x, y) { return x - y; });
    var prev = -1e9;
    marks.forEach(function (m) {
      if (m - prev < 0.02) return;
      prev = m;
      if (f && (f.type === 'jump') && Math.abs(m - f.b) < 0.03) { pts.push([f.b, s.y0 + f.H]); pts.push([f.b + 0.01, s.y1]); return; }
      var h = self.heightAt(s, m);
      if (h === null) h = self.baseAt(s, m);
      if (f && f.type === 'gap' && Math.abs(m - f.b) < 0.03) h = s.y0 + f.H;
      pts.push([m, h]);
    });
    return pts;
  };

  // 往顶点数组里加一个长方体（中心 cx,cy,cz，尺寸 sx,sy,sz）
  var BOX_F = [[0, 1, 3, 2], [5, 4, 6, 7], [4, 0, 2, 6], [1, 5, 7, 3], [2, 3, 7, 6], [4, 5, 1, 0]];
  function box(arr, cx, cy, cz, sx, sy, sz) {
    var v = [];
    for (var i = 0; i < 8; i++) v.push([cx + (i & 1 ? 0.5 : -0.5) * sx, cy + (i & 2 ? 0.5 : -0.5) * sy, cz + (i & 4 ? 0.5 : -0.5) * sz]);
    for (var f = 0; f < 6; f++) {
      var q = BOX_F[f], a = v[q[0]], b = v[q[1]], c = v[q[2]], d = v[q[3]];
      arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    }
  }
  function boxMesh(arr, mat) {
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    var m = new T.Mesh(g, mat);
    m.userData.ownGeo = true;
    return m;
  }

  function quad(arr, a, b, c, d) { arr.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], a[0], a[1], a[2], d[0], d[1], d[2], c[0], c[1], c[2]); }

  Track.prototype.roadPiece = function (s, from, to) {
    var hw = s.w / 2, pts = this.profile(s, from, to);
    var top = [], side = [], uvTop = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var z0 = pts[i][0], h0 = pts[i][1], z1 = pts[i + 1][0], h1 = pts[i + 1][1];
      quad(top, [hw, h0, z0], [hw, h1, z1], [-hw, h1, z1], [-hw, h0, z0]);
      // 与 quad() 的顶点顺序一致：a, c, b, a, d, c
      var ua = hw / UVS, ub = -hw / UVS, va = z0 / UVS, vb = z1 / UVS;
      uvTop.push(ua, va, ub, vb, ua, vb, ua, va, ub, va, ub, vb);
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
    var uvAll = new Float32Array(all.length / 3 * 2);
    uvAll.set(uvTop, 0);
    g.setAttribute('uv', new T.BufferAttribute(uvAll, 2));
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
    var eS = s.eS, eE = s.eE;
    var pieces = f && f.type === 'gap' ? [[-eS, f.b], [f.c, L + eE]] : [[-eS, L + eE]];
    function inter(a, b, fn) { pieces.forEach(function (pc) { var x = Math.max(a, pc[0]), y = Math.min(b, pc[1]); if (y > x) fn(x, y); }); }
    pieces.forEach(function (pc) { g.add(self.roadPiece(s, pc[0], pc[1])); });

    // 边线：内侧缩短、外侧延伸
    var endTurnLeft = s.nAngle > s.angle;
    var em = this.world.mats.edge;
    for (var side = -1; side <= 1; side += 2) {
      var isLeft = side > 0;
      var startOuter = s.first ? true : (isLeft === endTurnLeft);
      var endOuter = isLeft !== endTurnLeft;
      var z0 = startOuter ? -eS : eS, z1 = endOuter ? L + eE : L - eE;
      inter(z0, z1, function (a, b) { var r = self.ribbon(s, side * (hw - 0.25), 0.35, a, b, 0.03, em); if (r) g.add(r); });
    }
    // 中线
    inter(eS, L - eE, function (a, b) { var r = self.ribbon(s, 0, 0.25, a, b, 0.015, self.dashMat, 5); if (r) g.add(r); });

    // 弯道外侧路肩
    var outerSide = endTurnLeft ? -1 : 1;
    var curbA = this.ribbon(s, outerSide * (hw - 0.5), 0.9, L - eE, L + eE, 0.02, this.curbMat, 2);
    if (curbA) {
      // 让红白块沿路肩方向排列
      var uvA = curbA.geometry.attributes.uv;
      for (var i = 0; i < uvA.count; i++) { var vv = uvA.getY(i); uvA.setXY(i, vv, uvA.getX(i)); }
      g.add(curbA);
    }
    // 末端的横向路肩：转角不小于 90° 时，这条边才是平台的外沿
    if (s.turn > 88 * DEG) {
      var cg = new T.PlaneGeometry(w, 0.9);
      cg.rotateX(-Math.PI / 2);
      var uvc = cg.attributes.uv;
      for (var j = 0; j < uvc.count; j++) uvc.setX(j, uvc.getX(j) * w / 2);
      var curbB = new T.Mesh(cg, this.curbMat);
      curbB.userData.ownGeo = true;
      curbB.position.set(0, s.y1 + 0.02, L + eE - 0.45);
      g.add(curbB);
    }

    // 特殊路段装饰
    if (f) {
      if (f.type === 'jump' || f.type === 'gap') {
        var rr = this.ribbon(s, 0, w - 0.9, f.a, f.b, 0.025, this.rampMat, 4);
        if (rr) g.add(rr);
        var pr = new T.Mesh(this.pillarGeo, this.world.mats.rock);
        pr.scale.set(w * 0.45, 14 + f.H, w * 0.45);
        pr.position.set(0, s.y0 + f.H - THICK, f.b - 1);
        g.add(pr);
        if (f.type === 'gap') {
          var pg = new T.Mesh(this.pillarGeo, this.world.mats.rock);
          pg.scale.set(w * 0.45, 18, w * 0.45);
          pg.position.set(0, s.y1 - THICK, f.c + 1.5);
          g.add(pg);
        }
      } else if (f.type === 'hill') {
        var ph = new T.Mesh(this.pillarGeo, this.world.mats.rock);
        ph.scale.set(w * 0.5, 16 + f.H, w * 0.5);
        ph.position.set(0, s.y0 + f.H - THICK, (f.a + f.b) / 2);
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

    this.roadside(s, g);

    // 岩柱
    var pil = new T.Mesh(this.pillarGeo, this.world.mats.rock);
    pil.scale.set(w * 0.62, rand(18, 40), w * 0.62);
    pil.position.set(0, s.y1 - THICK, L);
    pil.rotation.y = Math.random() * 3;
    g.add(pil);
    if (L > 30 && !f) {
      var pil2 = new T.Mesh(this.pillarGeo, this.world.mats.rock);
      pil2.scale.set(w * 0.4, rand(8, 20), w * 0.35);
      var pa = L * rand(0.3, 0.6);
      pil2.position.set(rand(-1, 1), this.baseAt(s, pa) - THICK, pa);
      g.add(pil2);
    }
    return g;
  };

  // 路边参照物（只是装饰，不参与碰撞）：飞快掠过的路沿反光桩带来速度感，
  // 急弯外侧立导向牌，加速带上方有拱门，跳台两侧有旗杆
  Track.prototype.roadside = function (s, g) {
    var w = s.w, hw = w / 2, L = s.len, f = s.feat, self = this;
    var posts = [], poles = [];
    // 反光桩：贴在路沿外侧
    var pk = clamp(w / 13, 1, 1.8); // 路越宽镜头越远，桩子相应加大
    var step = 9 * pk, a0 = s.eS + 3, a1 = L - s.eE - 3, n = Math.max(0, Math.floor((a1 - a0) / step));
    for (var i = 0; i <= n; i++) {
      var al = n ? a0 + (a1 - a0) * i / n : (a0 + a1) / 2;
      if (a1 < a0) break;
      var h = this.heightAt(s, al);
      if (h === null) continue;
      box(posts, hw + 0.1, h + 0.5 * pk - 0.2, al, 0.17 * pk, pk + 0.4, 0.17 * pk);
      box(posts, -hw - 0.1, h + 0.5 * pk - 0.2, al, 0.17 * pk, pk + 0.4, 0.17 * pk);
    }
    if (posts.length) g.add(boxMesh(posts, this.world.mats.edge));

    // 急弯导向牌：立在弯道尽头的外沿，箭头指向转弯方向
    if (s.turn > 97 * DEG) {
      var left = s.nAngle > s.angle, k = clamp(w / 13, 1, 1.9), cnt = s.turn > 108 * DEG ? 4 : 3;
      for (var c = 0; c < cnt; c++) {
        var px = (c - (cnt - 1) / 2) * 2.9 * k;
        var pm = new T.Mesh(left ? this.chevronGeoL : this.chevronGeoR, this.chevronMat);
        pm.rotation.y = Math.PI;
        pm.scale.set(k, k, 1);
        pm.position.set(px, s.y1 + 0.75 + 0.62 * k, L + s.eE + 0.25);
        g.add(pm);
        box(poles, px, s.y1 + 0.35, L + s.eE + 0.3, 0.14, 0.9, 0.14);
      }
    }
    // 加速带拱门
    if (f && f.type === 'boost') {
      var gate = [], gy = this.heightAt(s, f.a) || s.y0, gh = 7.2;
      box(gate, hw + 0.25, gy + gh / 2 - 0.5, f.a, 0.35, gh + 1, 0.35);
      box(gate, -hw - 0.25, gy + gh / 2 - 0.5, f.a, 0.35, gh + 1, 0.35);
      box(gate, 0, gy + gh, f.a, w + 0.85, 0.45, 0.45);
      g.add(boxMesh(gate, this.gateMat));
    }
    // 跳台旗杆
    if (f && (f.type === 'jump' || f.type === 'gap')) {
      var flags = [], fh = f.big ? 5.5 : 3.6, top = s.y0 + f.H;
      for (var sd = -1; sd <= 1; sd += 2) {
        box(poles, sd * (hw + 0.2), top + fh / 2 - 0.6, f.b - 0.3, 0.14, fh + 1.2, 0.14);
        box(flags, sd * (hw + 0.2), top + fh - 0.5, f.b - 1.1, 0.06, 0.9, 1.5);
        if (f.big) box(flags, sd * (hw + 0.2), top + fh - 1.8, f.b - 1.1, 0.06, 0.9, 1.5);
      }
      g.add(boxMesh(flags, this.flagMat));
    }
    // 岩石拱门：长直路上偶尔出现，从中间穿过去
    if (!f && !s.first && L - s.eS - s.eE > 46 && s.y1 === s.y0 && Math.random() < 0.3) {
      var arch = [], az = s.eS + (L - s.eS - s.eE) * rand(0.4, 0.6), ah = 9.5 + w * 0.12, ax = hw + 1.6, by = s.y0;
      for (var sd2 = -1; sd2 <= 1; sd2 += 2) {
        box(arch, sd2 * (ax + 0.9), by + ah * 0.25 - 2, az, 3.4, ah * 0.5 + 4, 4.2);
        box(arch, sd2 * (ax + 0.5), by + ah * 0.7, az + 0.3, 2.6, ah * 0.5, 3.4);
        box(arch, sd2 * (ax - 0.9), by + ah * 1.02, az, 3.6, 2.4, 3.8);
      }
      box(arch, 0, by + ah * 1.12, az, ax * 2 - 2, 2.2, 3.4);
      box(arch, rand(-2, 2), by + ah * 1.24, az + 0.4, ax * 1.1, 1.4, 2.6);
      var am = boxMesh(arch, this.world.mats.rock);
      am.castShadow = true;
      g.add(am);
    }
    // 起点拱门
    if (s.first) {
      var sg = [];
      box(sg, hw + 0.25, 3.2, 16, 0.35, 7.4, 0.35); box(sg, -hw - 0.25, 3.2, 16, 0.35, 7.4, 0.35); box(sg, 0, 6.9, 16, w + 0.85, 0.5, 0.5);
      g.add(boxMesh(sg, this.poleMat));
    }
    if (poles.length) g.add(boxMesh(poles, this.poleMat));
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
    var tl = tol || 0;
    if (!(along >= -s.eS - tl && along <= s.len + s.eE + tl && Math.abs(lat) <= s.w / 2 + tl)) return false;
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
