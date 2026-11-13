/* Z 字形悬空赛道：分段生成、碰撞判断、回收 */
(function (DC) {
  'use strict';
  var T = THREE;
  var LEFT = Math.PI / 4, RIGHT = -Math.PI / 4;
  DC.ANGLE_LEFT = LEFT; DC.ANGLE_RIGHT = RIGHT;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function stripeTexture(colors, n) {
    var cv = document.createElement('canvas');
    cv.width = 64 * n; cv.height = 8;
    var x = cv.getContext('2d');
    for (var i = 0; i < n; i++) { x.fillStyle = colors[i % colors.length]; x.fillRect(i * 64, 0, 64, 8); }
    var t = new T.CanvasTexture(cv);
    t.wrapS = T.RepeatWrapping;
    t.encoding = T.sRGBEncoding;
    return t;
  }
  function dashTexture() {
    var cv = document.createElement('canvas');
    cv.width = 64; cv.height = 8;
    var x = cv.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 34, 8);
    var t = new T.CanvasTexture(cv);
    t.wrapS = T.RepeatWrapping;
    return t;
  }

  function Track(scene, world) {
    this.scene = scene;
    this.world = world;
    this.segs = [];
    this.base = 0;
    this.group = new T.Group();
    scene.add(this.group);
    this.onSegment = null; // 新赛道段回调（用于刷车）

    this.boxGeo = new T.BoxGeometry(1, 1, 1);
    this.boxGeo.translate(0, -0.5, 0); // 顶面在 y=0
    this.pillarGeo = new T.ConeGeometry(1, 1, 5, 1);
    this.pillarGeo.rotateX(Math.PI); // 尖朝下
    this.pillarGeo.translate(0, -0.5, 0);

    var m = world.mats;
    // 交替使用 polygonOffset 避免转角重叠处的 z-fighting
    this.asphaltB = m.asphalt.clone();
    this.asphaltB.polygonOffset = true; this.asphaltB.polygonOffsetFactor = -1; this.asphaltB.polygonOffsetUnits = -2;
    this.topMatsA = [m.rock, m.rock, m.asphalt, m.rock, m.rock, m.rock];
    this.topMatsB = [m.rock, m.rock, this.asphaltB, m.rock, m.rock, m.rock];
    this.curbMat = new T.MeshStandardMaterial({ map: stripeTexture(['#e03131', '#f5f5f5'], 2), roughness: 0.7,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
    this.dashMat = new T.MeshBasicMaterial({ map: dashTexture(), transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.planeGeo = new T.PlaneGeometry(1, 1);
    this.planeGeo.rotateX(-Math.PI / 2);
  }

  Track.prototype.syncThemeMats = function () {
    this.asphaltB.color.copy(this.world.mats.asphalt.color);
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

  DC.trackWidthOf = function (level) { var p = (level - 1) / 99; return 10.5 - 3.2 * p; };

  Track.prototype.reset = function (level) {
    this.clear();
    this.addSegment(0, 0, RIGHT, 70, DC.trackWidthOf(level), true);
  };

  Track.prototype.addSegment = function (ax, az, angle, len, w, first) {
    var idx = this.base + this.segs.length;
    var dx = Math.sin(angle), dz = Math.cos(angle);
    var s = {
      idx: idx, ax: ax, az: az, angle: angle, dx: dx, dz: dz, len: len, w: w,
      ex: ax + dx * len, ez: az + dz * len, first: !!first
    };
    s.obj = this.buildMesh(s);
    this.group.add(s.obj);
    this.segs.push(s);
    if (this.onSegment) this.onSegment(s);
    return s;
  };

  Track.prototype.buildMesh = function (s) {
    var g = new T.Group();
    g.position.set(s.ax, 0, s.az);
    g.rotation.y = s.angle; // 局部 +Z 为前进方向，+X 为左侧
    var w = s.w, L = s.len, hw = w / 2;
    var thick = 1.6;

    // 路面（延伸 w/2 覆盖转角）
    var box = new T.Mesh(this.boxGeo, s.idx % 2 ? this.topMatsB : this.topMatsA);
    box.scale.set(w, thick, L + w);
    box.position.set(0, 0, L / 2);
    box.receiveShadow = true;
    g.add(box);

    // 左转为正：本段终点处的转向。交替：右行段结束时左转，左行段结束时右转
    var endTurnLeft = s.angle < 0;
    // 两侧边线：内侧缩短，外侧延伸
    var em = this.world.mats.edge;
    for (var side = -1; side <= 1; side += 2) { // side=+1 左侧（局部 +X）
      var isLeft = side > 0;
      var startOuter = s.first ? true : (isLeft === endTurnLeft); // 起点处的转向与终点相反
      var endOuter = isLeft !== endTurnLeft;
      var z0 = startOuter ? -hw : hw;
      var z1 = endOuter ? L + hw : L - hw;
      var e = new T.Mesh(this.boxGeo, em);
      e.scale.set(0.35, 0.12, z1 - z0);
      e.position.set(side * (hw - 0.2), 0.1, (z0 + z1) / 2);
      g.add(e);
    }

    // 中线虚线
    var dl = Math.max(1, L - w);
    var dgeo = this.planeGeo.clone();
    var uv = dgeo.attributes.uv;
    for (var i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * dl / 5);
    var dash = new T.Mesh(dgeo, this.dashMat);
    dash.userData.ownGeo = true;
    dash.rotation.y = Math.PI / 2;
    dash.scale.set(dl, 1, 0.25);
    dash.position.set(0, 0.01, L / 2);
    g.add(dash);

    // 终点转角外侧的红白路肩
    var outerSide = endTurnLeft ? -1 : 1;
    var c1geo = this.planeGeo.clone();
    var uv1 = c1geo.attributes.uv;
    for (var j = 0; j < uv1.count; j++) uv1.setX(j, uv1.getX(j) * w / 2);
    var curbA = new T.Mesh(c1geo, this.curbMat);
    curbA.userData.ownGeo = true;
    curbA.rotation.y = Math.PI / 2;
    curbA.scale.set(w, 1, 0.9);
    curbA.position.set(outerSide * (hw - 0.45), 0.012, L);
    g.add(curbA);
    var curbB = new T.Mesh(c1geo, this.curbMat);
    curbB.scale.set(w, 1, 0.9);
    curbB.position.set(0, 0.012, L + hw - 0.45);
    g.add(curbB);

    // 赛道下方的岩柱
    var pil = new T.Mesh(this.pillarGeo, this.world.mats.rock);
    var ph = rand(18, 40);
    pil.scale.set(w * 0.62, ph, w * 0.62);
    pil.position.set(0, -thick, L);
    pil.rotation.y = Math.random() * 3;
    g.add(pil);
    if (L > 30) {
      var pil2 = new T.Mesh(this.pillarGeo, this.world.mats.rock);
      var ph2 = rand(8, 20);
      pil2.scale.set(w * 0.4, ph2, w * 0.35);
      pil2.position.set(rand(-1, 1), -thick, L * rand(0.3, 0.6));
      g.add(pil2);
    }
    return g;
  };

  // 根据难度生成后续路段
  Track.prototype.extend = function (fromIdx, level, count) {
    var p = (level - 1) / 99;
    var v = DC.speedOf(level);
    var w = DC.trackWidthOf(level);
    while (this.lastIndex() < fromIdx + count) {
      var last = this.segs[this.segs.length - 1];
      var angle = last.angle > 0 ? RIGHT : LEFT;
      var t = rand(0.85 - 0.3 * p, 2.3 - 0.8 * p);
      var len = Math.max(w * 1.9, v * t);
      // 避免赛道在横向上漂得太远
      var dirX = Math.sin(angle);
      if (dirX * last.ex > 0 && Math.abs(last.ex) > 35) len = Math.max(w * 1.9, len * 0.55);
      this.addSegment(last.ex, last.ez, angle, len, w, false);
    }
  };

  // 点是否在某段内（含转角延伸），返回局部坐标
  Track.prototype.contains = function (s, x, z, tol) {
    var rx = x - s.ax, rz = z - s.az;
    var along = rx * s.dx + rz * s.dz;
    var lat = rx * s.dz - rz * s.dx;
    var hw = s.w / 2 + (tol || 0);
    return along >= -hw && along <= s.len + hw && Math.abs(lat) <= hw;
  };

  Track.prototype.localOf = function (s, x, z) {
    var rx = x - s.ax, rz = z - s.az;
    return { along: rx * s.dx + rz * s.dz, lat: rx * s.dz - rz * s.dx };
  };

  // 从提示段开始查找包含该点的段，找不到返回 -1
  Track.prototype.locate = function (x, z, hint, tol) {
    var best = -1;
    for (var i = Math.max(this.base, hint - 1); i <= Math.min(this.lastIndex(), hint + 3); i++) {
      if (this.contains(this.get(i), x, z, tol)) { best = i; if (i >= hint) break; }
    }
    return best;
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
