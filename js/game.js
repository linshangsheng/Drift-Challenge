/* 游戏核心：漂移物理、飞跃、吃车合成、车尾跟随、路上车流、坠崖、收益 */
(function (DC) {
  'use strict';
  var T = THREE;
  var GRAVITY = 30;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function approach(cur, target, maxStep) {
    var d = target - cur;
    if (Math.abs(d) <= maxStep) return target;
    return cur + Math.sign(d) * maxStep;
  }
  function damp(rate, dt) { return 1 - Math.exp(-rate * dt); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function wrapAngle(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  var HEAVY = { bus: 1, dbus: 1, schoolbus: 1, fire: 1, aerial: 1, boxvan: 1 };

  function Game(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.world = opts.world;
    this.track = opts.track;
    this.fx = opts.effects;
    this.ui = null;
    this.state = 'menu';
    this.holding = false;
    this.ignoreHold = false;
    this.head = { x: 0, z: 0, y: 0, vy: 0, velA: DC.ANGLE_RIGHT, bodyA: DC.ANGLE_RIGHT, v: 0, mesh: null, level: 1, air: false };
    this.tail = [];
    this.roadCars = [];
    this.hx = []; this.hz = []; this.hy = []; this.hd = [];
    this.headDist = 0;
    this.curSeg = 0;
    this.orbit = 0;
    this.camLook = new T.Vector3();
    this.smokeTimer = 0;
    this.time = 0;
    this.engine = 0;
  }

  // ---------- 外部接口 ----------
  Game.prototype.setHolding = function (on) {
    if (!on) this.ignoreHold = false;
    this.holding = on;
  };
  Game.prototype.isHolding = function () { return this.holding && !this.ignoreHold; };

  Game.prototype.surfaceKey = function () { return DC.THEMES[DC.themeIndexOf(this.head.level)].surface; };

  Game.prototype.enterShowroom = function (level) {
    this.state = 'menu';
    if (this.guide) this.guide.visible = false;
    this.clearRun();
    this.head.level = level;
    this.world.setThemeByLevel(level, true);
    this.track.reset(level, this.surfaceKey());
    this.track.extend(0, level, 8);
    this.placeHeadAtStart();
    this.setHeadMesh(level);
    this.world.resetMountains(0, 0);
    DC.warmCars(level - 10, level + 3);
  };

  Game.prototype.showCar = function (level) {
    if (this.head.level === level && this.head.mesh) return;
    this.head.level = level;
    this.setHeadMesh(level);
    this.world.setThemeByLevel(level, false);
  };

  Game.prototype.startRun = function () {
    var save = DC.Save.data;
    var level = save.selected;
    this.clearRun();
    this.state = 'countdown';
    this.head.level = level;
    this.stats = { time: 0, coins: 0, eaten: 0, merges: 0, startLevel: level, maxLevel: level, jumps: 0, drift: 0 };
    this.world.setThemeByLevel(level, true);
    this.track.reset(level, this.surfaceKey());
    this.track.extend(0, level, 16);
    this.placeHeadAtStart();
    this.setHeadMesh(level);
    this.world.resetMountains(0, 0);
    DC.warmCars(level - 10, level + 3);
    DC.warmCars(level + 1, level + 2, true);
    this.shieldLeft = DC.Save.modLevel('shield');
    this.turbo = 1 + DC.Save.modLevel('turbo') * 0.15;
    this.magnet = DC.Save.modLevel('magnet');
    this.engine = DC.Save.modLevel('engine');
    this.tire = DC.tireOf(save.tire);
    this.ignoreHold = this.holding;
    this.countdown = 3.0;
    this.lastCount = 4;
    this.autopilot = 0;
    this.boostTimer = 0;
    this.spawnTimer = 0;
    this.lastEffect = null;
    this.avgV = 0;
    this.combo = null;
    this.sus = null;
    this.timeScale = 1;
    this.coachCorner = -1;
    this.coach = DC.Save.data.tutorialDone ? null : { until: 5, action: null };
    this.snapCamera();
    // 开局先放几辆车
    for (var i = 0; i < 4; i++) this.spawnRoadCar(30 + i * 22 + rand(0, 10));
  };

  Game.prototype.pause = function () { if (this.state === 'running' || this.state === 'countdown') { this.pausedFrom = this.state; this.state = 'paused'; } };
  Game.prototype.resume = function () { if (this.state === 'paused') { this.state = this.pausedFrom; this.ignoreHold = this.holding; } };

  // ---------- 内部 ----------
  Game.prototype.clearRun = function () {
    var self = this;
    this.tail.forEach(function (t) { self.scene.remove(t.mesh); });
    this.tail = [];
    this.roadCars.forEach(function (c) { self.scene.remove(c.mesh); });
    this.roadCars = [];
    this.fx.clear();
    this.hx = []; this.hz = []; this.hy = []; this.hd = []; this.hb = [];
    this.headDist = 0;
    this.curSeg = 0;
    this.head.vy = 0; this.head.y = 0; this.head.air = false;
    this.falling = false;
  };

  Game.prototype.placeHeadAtStart = function () {
    var s = this.track.get(0);
    var h = this.head;
    h.x = s.ax + s.dx * 8; h.z = s.az + s.dz * 8;
    h.velA = h.bodyA = s.angle; h.v = 0; h.y = 0; h.vy = 0; h.air = false;
    h.ph = DC.Physics.state(h.x, h.z, s.angle, 0);
    this.curSeg = 0;
    this.autoCorner = -1;
    this.hx = [h.x]; this.hz = [h.z]; this.hy = [0]; this.hd = [0]; this.hb = [0];
    this.headDist = 0;
  };

  // 夜间车灯照在路面上的光斑
  var beamMat = null, beamGeo = null;
  function headBeam(L, W) {
    if (!beamMat) {
      var cv = document.createElement('canvas');
      cv.width = 128; cv.height = 256;
      var x = cv.getContext('2d');
      var g = x.createRadialGradient(64, 40, 4, 64, 90, 150);
      g.addColorStop(0, 'rgba(255,245,215,1)'); g.addColorStop(0.45, 'rgba(255,235,190,0.45)'); g.addColorStop(1, 'rgba(255,230,180,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 256);
      var tex = new T.CanvasTexture(cv);
      beamMat = new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    }
    if (!beamGeo) {
      beamGeo = new T.PlaneGeometry(1, 1);
      beamGeo.rotateX(-Math.PI / 2);
      beamGeo.rotateY(Math.PI);
    }
    var m = new T.Mesh(beamGeo, beamMat);
    m.scale.set(W * 2.6, 1, 13);
    m.position.set(0, 0.06, L / 2 + 6);
    m.renderOrder = 2;
    return m;
  }
  Game.prototype.updateBeam = function () {
    if (beamMat) beamMat.opacity = Math.min(1, this.world.cur.stars) * 0.6;
  };

  Game.prototype.setHeadMesh = function (level) {
    var h = this.head;
    if (h.mesh) this.scene.remove(h.mesh);
    h.mesh = DC.makeCar(level, true);
    h.mesh.add(headBeam(h.mesh.userData.length, h.mesh.userData.width));
    h.mesh.position.set(h.x, h.y, h.z);
    h.mesh.rotation.set(0, h.bodyA, 0);
    this.scene.add(h.mesh);
    h.pop = 1;
    h.heavy = !!HEAVY[DC.carOf(level).type];
  };

  Game.prototype.makeTailCar = function (level, x, z, y) {
    var mesh = DC.makeCar(level);
    var badge = DC.makeBadge(level, 0.7);
    badge.position.y = mesh.userData.height + 0.6;
    mesh.add(badge);
    mesh.position.set(x, y || 0, z);
    this.scene.add(mesh);
    return { level: level, mesh: mesh, len: mesh.userData.length, blend: 0, fx: x, fz: z, fy: y || 0, pop: 0.6, falling: false, vy: 0, vx: 0, vz: 0 };
  };

  // 刷车等级
  Game.prototype.spawnLevel = function () {
    var L = this.head.level;
    if (this.tail.length && Math.random() < 0.35) return this.tail[Math.floor(Math.random() * this.tail.length)].level;
    var r = Math.random(), d;
    if (r < 0.03) d = 0;
    else if (r < 0.25) d = 1;
    else if (r < 0.47) d = 2;
    else if (r < 0.65) d = 3;
    else if (r < 0.78) d = 4;
    else if (r < 0.87) d = 5;
    else if (r < 0.94) d = 6;
    else d = 7 + Math.floor(Math.random() * 4);
    return Math.max(1, L - d);
  };

  Game.prototype.headProgress = function () {
    var s = this.track.get(this.curSeg);
    if (!s) return 0;
    return s.cum + this.track.localOf(s, this.head.x, this.head.z).along;
  };

  // 在车头前方 ahead 米处生成一辆沿赛道行驶的车
  Game.prototype.spawnRoadCar = function (ahead) {
    var prog = this.headProgress() + ahead;
    var s = this.track.segAtProgress(prog);
    if (!s) return;
    var along = prog - s.cum;
    if (s.feat && along > s.feat.a - 6 && along < s.feat.end + 6) return; // 不放在飞跃坡等特殊路段上
    var level = this.spawnLevel();
    var mesh = DC.makeCar(level);
    var dims = mesh.userData;
    var badge = DC.makeBadge(level, 1);
    badge.position.y = dims.height + 0.9;
    mesh.add(badge);
    var latMax = Math.max(0, s.w / 2 - dims.width / 2 - 0.5);
    var lat = rand(-latMax, latMax);
    var p = this.track.pointAt(s.idx, along, lat);
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = s.angle;
    mesh.scale.set(0.01, 0.01, 0.01);
    this.scene.add(mesh);
    this.roadCars.push({
      level: level, mesh: mesh, seg: s.idx, along: along, lat: lat, latT: lat,
      ratio: rand(0.74, 0.9), x: p.x, z: p.z, y: 0, vy: 0, air: false, angle: s.angle,
      len: dims.length, width: dims.width, grow: 0, laneTimer: rand(2, 5)
    });
  };

  Game.prototype.addToTail = function (level, x, z, y) {
    var entry = this.makeTailCar(level, x, z, y);
    var i = 0;
    while (i < this.tail.length && this.tail[i].level >= level) i++;
    this.tail.splice(i, 0, entry);
    this.resolveMerges();
  };

  Game.prototype.resolveMerges = function () {
    var changed = true;
    while (changed) {
      changed = false;
      if (this.tail.length && this.tail[0].level >= this.head.level) {
        var t0 = this.tail.shift();
        this.scene.remove(t0.mesh);
        if (this.head.level < DC.MAX_LEVEL) this.upgradeHead();
        else {
          var b = DC.incomeOf(DC.MAX_LEVEL) * 30 * this.turbo;
          this.stats.coins += b;
          this.notify('legend', { bonus: b });
        }
        changed = true;
        continue;
      }
      for (var i = 0; i < this.tail.length - 1; i++) {
        var a = this.tail[i], b2 = this.tail[i + 1];
        if (a.level === b2.level) {
          var nl = a.level + 1;
          var px = a.mesh.position.x, pz = a.mesh.position.z, py = a.mesh.position.y;
          this.scene.remove(a.mesh); this.scene.remove(b2.mesh);
          var ne = this.makeTailCar(nl, px, pz, py);
          ne.blend = 0.4; ne.pop = 1;
          this.tail.splice(i, 2, ne);
          var j = i;
          while (j > 0 && this.tail[j - 1].level < this.tail[j].level) {
            var tmp = this.tail[j - 1]; this.tail[j - 1] = this.tail[j]; this.tail[j] = tmp; j--;
          }
          this.stats.merges++;
          var bonus = DC.mergeBonusOf(nl) * this.turbo;
          this.stats.coins += bonus;
          this.fx.burst(px, py + 1.2, pz, DC.tierOf(nl).color, 26, 9);
          DC.Audio.merge(nl);
          this.notify('merge', { level: nl, bonus: bonus, x: px, z: pz, y: py });
          changed = true;
          break;
        }
      }
    }
  };

  Game.prototype.upgradeHead = function () {
    var h = this.head;
    var oldTheme = DC.themeIndexOf(h.level);
    h.level++;
    DC.warmCars(h.level - 8, h.level + 3);
    DC.warmCars(h.level + 1, h.level + 2, true);
    this.stats.maxLevel = Math.max(this.stats.maxLevel, h.level);
    this.setHeadMesh(h.level);
    var bonus = DC.mergeBonusOf(h.level) * 2 * this.turbo;
    this.stats.coins += bonus;
    this.fx.burst(h.x, h.y + 1.5, h.z, DC.tierOf(h.level).color, 60, 14);
    DC.Audio.levelUp();
    this.world.setThemeByLevel(h.level, false);
    if (DC.themeIndexOf(h.level) !== oldTheme) this.track.surface = this.surfaceKey();
    this.shake = 0.5;
    this.notify('levelup', { level: h.level, bonus: bonus });
  };

  Game.prototype.notify = function (type, data) {
    if (this.ui && this.ui.onGameEvent) this.ui.onGameEvent(type, data);
  };

  Game.prototype.pushHistory = function () {
    var h = this.head, n = this.hx.length;
    var dx = h.x - this.hx[n - 1], dz = h.z - this.hz[n - 1];
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d >= 0.3) {
      this.headDist = this.hd[n - 1] + d;
      this.hx.push(h.x); this.hz.push(h.z); this.hy.push(h.y); this.hd.push(this.headDist); this.hb.push(h.air ? 0 : wrapAngle(h.bodyA - h.velA));
    }
    if (this.hx.length > 4000) {
      var keepFrom = this.headDist - this.tailLength() - 60, cut = 0;
      while (cut < this.hd.length - 2 && this.hd[cut] < keepFrom) cut++;
      if (cut > 500) { this.hx.splice(0, cut); this.hz.splice(0, cut); this.hy.splice(0, cut); this.hd.splice(0, cut); this.hb.splice(0, cut); }
    }
  };

  Game.prototype.tailLength = function () {
    var total = this.head.mesh ? this.head.mesh.userData.length / 2 : 2;
    for (var i = 0; i < this.tail.length; i++) total += this.tail[i].len + 1.0;
    return total + 4;
  };

  Game.prototype.sampleAt = function (d, out) {
    var hd = this.hd, n = hd.length;
    if (n < 2 || d <= hd[0]) {
      out.x = this.hx[0]; out.z = this.hz[0]; out.y = this.hy[0]; out.b = 0;
      out.a = n >= 2 ? Math.atan2(this.hx[1] - this.hx[0], this.hz[1] - this.hz[0]) : this.head.velA;
      if (d < hd[0] && n >= 2) { var back = hd[0] - d; out.x -= Math.sin(out.a) * back; out.z -= Math.cos(out.a) * back; }
      return out;
    }
    if (d >= hd[n - 1]) {
      out.x = this.hx[n - 1]; out.z = this.hz[n - 1]; out.y = this.hy[n - 1]; out.b = this.hb[n - 1] || 0;
      out.a = Math.atan2(this.hx[n - 1] - this.hx[n - 2], this.hz[n - 1] - this.hz[n - 2]);
      return out;
    }
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (hd[mid] <= d) lo = mid; else hi = mid; }
    var t = (d - hd[lo]) / (hd[hi] - hd[lo] || 1);
    out.x = this.hx[lo] + (this.hx[hi] - this.hx[lo]) * t;
    out.z = this.hz[lo] + (this.hz[hi] - this.hz[lo]) * t;
    out.y = this.hy[lo] + (this.hy[hi] - this.hy[lo]) * t;
    out.b = (this.hb[lo] || 0) + ((this.hb[hi] || 0) - (this.hb[lo] || 0)) * t;
    var a0 = Math.max(0, lo - 3), a1 = Math.min(n - 1, hi + 3);
    out.a = Math.atan2(this.hx[a1] - this.hx[a0], this.hz[a1] - this.hz[a0]);
    return out;
  };

  var S = { x: 0, z: 0, y: 0, a: 0, b: 0 };

  Game.prototype.updateTail = function (dt, virtualDist, fallDist) {
    var off = this.head.mesh ? this.head.mesh.userData.length / 2 : 2;
    for (var i = 0; i < this.tail.length; i++) {
      var t = this.tail[i];
      off += t.len / 2 + 1.0;
      var d = virtualDist - off;
      off += t.len / 2;
      var m = t.mesh;
      if (t.falling) {
        t.vy -= GRAVITY * dt;
        m.position.x += t.vx * dt; m.position.z += t.vz * dt; m.position.y += t.vy * dt;
        m.rotation.x += dt * 1.5; m.rotation.z += dt * t.spin;
        continue;
      }
      if (fallDist !== undefined && d > fallDist) {
        this.sampleAt(fallDist, S);
        var sp = Math.max(this.head.v, 15);
        t.falling = true; t.vx = Math.sin(S.a) * sp; t.vz = Math.cos(S.a) * sp; t.vy = 0;
        t.spin = (Math.random() - 0.5) * 4;
        continue;
      }
      this.sampleAt(d, S);
      if (t.blend < 1) {
        t.blend = Math.min(1, t.blend + dt / 0.35);
        var k = easeOut(t.blend);
        m.position.x = t.fx + (S.x - t.fx) * k;
        m.position.z = t.fz + (S.z - t.fz) * k;
        m.position.y = t.fy + (S.y - t.fy) * k + Math.sin(t.blend * Math.PI) * 1.5;
      } else {
        m.position.set(S.x, S.y, S.z);
      }
      // 车尾车辆在同一位置复现车头的漂移姿态
      m.rotation.y = S.a + S.b * 0.9 + Math.sin(this.time * 6 + i) * 0.03;
      if (t.pop > 0) { t.pop = Math.max(0, t.pop - dt * 3); var sc = 1 + t.pop * 0.5; m.scale.set(sc, sc, sc); }
      else m.scale.set(1, 1, 1);
    }
  };

  // 车辆的垂直运动（跟随路面起伏，起跳、落地）
  Game.prototype.vertical = function (o, ground, dt) {
    if (o.air) {
      o.vy -= GRAVITY * dt;
      o.y += o.vy * dt;
      if (ground && o.y <= ground.h) {
        var impact = -o.vy;
        o.y = ground.h; o.vy = 0; o.air = false;
        return impact; // 落地冲击
      }
      return 0;
    }
    if (!ground) return 0;
    var free = o.y + (o.vy - GRAVITY * dt) * dt;
    if (ground.h < free - 0.04) { // 地面下降得比自由落体还快：腾空
      o.air = true; o.vy -= GRAVITY * dt; o.y = free;
      return -1;
    }
    o.vy = clamp((ground.h - o.y) / Math.max(dt, 1e-4), -20, 25);
    o.y = ground.h;
    return 0;
  };

  var FOOT = [[0, 0], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]];
  // 车身是否还有任何部分压在路面上
  Game.prototype.touchesTrack = function () {
    var h = this.head, ud = h.mesh.userData;
    var L = ud.length, W = ud.width, ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
    for (var i = 0; i < FOOT.length; i++) {
      var f = FOOT[i];
      var x = h.x + sa * f[0] * L + ca * f[1] * W;
      var z = h.z + ca * f[0] * L - sa * f[1] * W;
      if (this.track.locate(x, z, this.curSeg, 0) >= 0) return true;
    }
    return false;
  };

  Game.prototype.updateRoadCars = function (dt) {
    var h = this.head;
    var headLen = h.mesh ? h.mesh.userData.length : 4;
    var magR = this.magnet > 0 ? 1.5 + this.magnet * 0.8 : 0;
    var prog = this.headProgress();
    // 路上的车始终比玩家稍慢（按玩家平滑后的实际车速）
    this.avgV = (this.avgV || 0) + (h.v - (this.avgV || 0)) * damp(0.8, dt);
    var roadV = Math.max(this.avgV, DC.speedOf(h.level) * 0.35);
    for (var i = this.roadCars.length - 1; i >= 0; i--) {
      var c = this.roadCars[i];
      var s = this.track.get(c.seg);
      if (!s || c.seg < this.track.base || s.cum + c.along < prog - 45) {
        this.scene.remove(c.mesh); this.roadCars.splice(i, 1); continue;
      }
      if (this.state === 'running' || this.state === 'falling') {
        c.along += roadV * c.ratio * dt;
        while (c.along > s.len) {
          var nx = this.track.get(c.seg + 1);
          if (!nx) { c.along = s.len; break; }
          c.along -= s.len; c.seg++; s = nx;
          var lm = Math.max(0, s.w / 2 - c.width / 2 - 0.5);
          c.latT = clamp(c.latT, -lm, lm);
        }
        // 偶尔变道
        c.laneTimer -= dt;
        if (c.laneTimer <= 0) {
          c.laneTimer = rand(2.5, 6);
          var lmx = Math.max(0, s.w / 2 - c.width / 2 - 0.5);
          c.latT = rand(-lmx, lmx);
        }
        c.lat += (c.latT - c.lat) * damp(1.2, dt);
      }
      var p = this.track.pointAt(c.seg, c.along, c.lat);
      var px = c.x, pz = c.z;
      c.x += (p.x - c.x) * damp(9, dt);
      c.z += (p.z - c.z) * damp(9, dt);
      var hh = this.track.heightAt(s, c.along);
      this.vertical(c, hh === null ? null : { h: hh }, dt);
      if (!c.air && hh === null) c.air = true;
      var mdx = c.x - px, mdz = c.z - pz;
      if (mdx * mdx + mdz * mdz > 1e-5) {
        var na = c.angle + wrapAngle(Math.atan2(mdx, mdz) - c.angle) * damp(10, dt);
        var turn = wrapAngle(na - c.angle) / Math.max(dt, 1e-3);
        c.angle = na;
        // 转弯时车身甩出一个漂移角
        c.slip = (c.slip || 0) + (clamp(turn * 0.18, -0.6, 0.6) - (c.slip || 0)) * damp(6, dt);
      }
      if (c.grow < 1) { c.grow = Math.min(1, c.grow + dt * 3); var g = easeOut(c.grow); c.mesh.scale.set(g, g, g); }

      // 吃车
      if (this.state === 'running') {
        var dx = c.x - h.x, dz = c.z - h.z, dy = c.y - h.y;
        var d2 = dx * dx + dz * dz;
        var eatR = 1.0 + (headLen + c.len) * 0.24 + (c.width - 1.8) * 0.3;
        if (magR && d2 < (eatR + magR) * (eatR + magR) && Math.abs(dy) < 3) {
          var d = Math.sqrt(d2) || 1, step = Math.min(d, (h.v * 0.5 + 10) * dt);
          c.x -= dx / d * step; c.z -= dz / d * step;
          dx = c.x - h.x; dz = c.z - h.z; d2 = dx * dx + dz * dz;
        }
        if (d2 < eatR * eatR && Math.abs(dy) < 2.2) {
          this.scene.remove(c.mesh);
          this.roadCars.splice(i, 1);
          this.stats.eaten++;
          DC.Audio.pickup();
          this.fx.burst(c.x, c.y + 1, c.z, '#ffffff', 12, 6);
          this.notify('eat', { level: c.level, x: c.x, z: c.z, y: c.y });
          this.addToTail(c.level, c.x, c.z, c.y);
          continue;
        }
      }
      c.mesh.position.set(c.x, c.y, c.z);
      c.mesh.rotation.set(c.air ? -c.vy * 0.015 : 0, c.angle + (c.slip || 0), 0, 'YXZ');
    }
    // 维持前方车流
    if (this.state === 'running') {
      this.spawnTimer -= dt;
      var ahead = 0;
      for (var k = 0; k < this.roadCars.length; k++) {
        var rc = this.roadCars[k], rs = this.track.get(rc.seg);
        if (rs && rs.cum + rc.along > prog) ahead++;
      }
      var want = 6 + Math.round((h.level - 1) / 99 * 3);
      if (ahead < want && this.spawnTimer <= 0) {
        this.spawnTimer = rand(0.35, 0.8);
        this.spawnRoadCar(rand(55, 95));
      }
    }
  };

  // 自动驾驶（护盾复活后短暂接管，也用于测试）：只用左/右两种输入，
  // 预测“现在转向”后的物理轨迹，能落到下一段中线时才转
  Game.prototype.autoTarget = function (P) {
    var h = this.head, s = this.track.get(this.curSeg), n = this.track.get(this.curSeg + 1);
    if (!s) return h.bodyA;
    if (!n) return s.angle;
    if (this.autoCorner === n.idx) return n.angle;
    var loc = this.track.localOf(s, h.x, h.z), remain = s.len - loc.along;
    if (remain > h.v * 1.3 + 20) return s.angle;
    var src = h.ph;
    var st = { x: src.x, z: src.z, vx: src.vx, vz: src.vz, psi: src.psi, r: src.r, wheel: src.wheel, out: {} };
    var PP = Object.assign({}, P, { air: false, slopeA: 0 });
    for (var i = 0; i < 160; i++) DC.Physics.step(st, PP, n.angle, 1 / 110);
    var lat = this.track.localOf(n, st.x, st.z).lat;
    var k = s.dx * n.dz - s.dz * n.dx;
    if (lat * k >= -0.3 || remain < -s.w / 2 + 1) { this.autoCorner = n.idx; return n.angle; }
    return s.angle;
  };

  // 新手引导：前几个弯在该转向的时机进入慢动作并提示
  Game.prototype.coachTarget = function (P) {
    var h = this.head, s = this.track.get(this.curSeg), n = this.track.get(this.curSeg + 1);
    if (!s) return h.bodyA;
    if (!n) return s.angle;
    if (this.coachCorner === n.idx) return n.angle;
    var loc = this.track.localOf(s, h.x, h.z), remain = s.len - loc.along;
    if (remain > h.v * 1.3 + 20) return s.angle;
    var src = h.ph;
    var st = { x: src.x, z: src.z, vx: src.vx, vz: src.vz, psi: src.psi, r: src.r, wheel: src.wheel, out: {} };
    var PP = Object.assign({}, P, { air: false, slopeA: 0 });
    for (var i = 0; i < 160; i++) DC.Physics.step(st, PP, n.angle, 1 / 110);
    var lat = this.track.localOf(n, st.x, st.z).lat;
    var k = s.dx * n.dz - s.dz * n.dx;
    if (lat * k >= -0.3 || remain < -s.w / 2 + 1) { this.coachCorner = n.idx; return n.angle; }
    return s.angle;
  };
  Game.prototype.updateCoach = function (P, target) {
    if (!this.coach) return;
    if (this.curSeg >= this.coach.until) {
      this.coach = null; this.timeScale = 1;
      DC.Save.data.tutorialDone = true; DC.Save.save();
      this.notify('coach', { action: null, done: true });
      return;
    }
    var ideal = this.coachTarget(P);
    var wrong = Math.abs(ideal - target) > 0.1 && !this.head.air;
    var action = wrong ? (ideal > 0 ? 'hold' : 'release') : null;
    this.timeScale = wrong ? 0.22 : 1;
    if (action !== this.coach.action) { this.coach.action = action; this.notify('coach', { action: action }); }
  };

  Game.prototype.revive = function () {
    var h = this.head;
    var s = this.track.get(this.curSeg);
    var loc = this.track.localOf(s, h.x, h.z);
    var along = clamp(loc.along, 2, s.len - 2);
    if (s.feat && along > s.feat.a - 2 && along < s.feat.end + 2) along = Math.max(2, s.feat.a - 3);
    h.x = s.ax + s.dx * along; h.z = s.az + s.dz * along;
    h.velA = h.bodyA = s.angle;
    h.v = Math.max(h.v * 0.7, 10);
    h.ph = DC.Physics.state(h.x, h.z, s.angle, h.v);
    this.autoCorner = -1;
    h.y = this.track.heightAt(s, along) || 0; h.vy = 0; h.air = false;
    this.autopilot = 1.3;
    this.shieldLeft--;
    this.fx.burst(h.x, h.y + 1.2, h.z, '#7fd3ff', 50, 10);
    DC.Audio.shield();
    this.loseCombo();
    this.notify('shield', { left: this.shieldLeft });
    this.fx.endSkid();
  };

  Game.prototype.startFall = function () {
    var h = this.head;
    this.timeScale = 1;
    if (this.coach) { this.coach.action = null; this.notify('coach', { action: null }); }
    if (this.guide) this.guide.visible = false;
    this.state = 'falling';
    this.falling = true;
    this.fallTimer = 0;
    this.fallDist = this.headDist;
    this.virtualDist = this.headDist;
    h.fvx = Math.sin(h.velA) * h.v; h.fvz = Math.cos(h.velA) * h.v;
    if (!h.air) h.vy = 1;
    h.spinX = 1.2 + Math.random(); h.spinZ = (Math.random() - 0.5) * 3;
    DC.Audio.fall();
    DC.vibrate([60, 40, 120]);
    this.loseCombo();
    this.fx.endSkid();
    this.notify('fall', {});
  };

  Game.prototype.finishRun = function (quit) {
    if (quit) this.bankCombo();
    this.state = 'over';
    var st = this.stats;
    var save = DC.Save.data;
    st.coins = Math.floor(st.coins);
    save.coins += st.coins;
    save.totalRuns++;
    var rec = { level: false, time: false, coins: false };
    if (st.maxLevel > save.best.level) { save.best.level = st.maxLevel; rec.level = true; }
    if (st.time > save.best.time) { save.best.time = st.time; rec.time = true; }
    if (st.coins > save.best.coins) { save.best.coins = st.coins; rec.coins = true; }
    if (st.eaten > save.best.eaten) save.best.eaten = st.eaten;
    DC.Save.save();
    this.notify('over', { stats: st, records: rec, quit: !!quit });
  };

  // 当前抓地力（供物理与界面使用）
  Game.prototype.handling = function () {
    var h = this.head, surf = this.surfaceKey();
    var tire = this.tire || DC.tireOf(DC.Save.data.tire);
    var grip = DC.carGrip(h.level) * DC.tireGrip(tire, surf) * DC.SURFACES[surf].mu;
    if (this.lastEffect === 'slick') grip *= 0.6;
    return { grip: grip, surface: surf, tire: tire };
  };

  // 车辆动力学参数
  Game.prototype.physParams = function () {
    var h = this.head, hd = this.handling(), surf = DC.SURFACES[hd.surface], tire = hd.tire;
    var boost = this.boostTimer > 0;
    var P = DC.Physics.params({
      top: DC.speedOf(h.level) * (1 + this.engine * 0.03) * (boost ? 1.35 : 1),
      accel: DC.accelOf(h.level) * (1 + this.engine * 0.1) * (boost ? 1.6 : 1) * (h.heavy ? 0.7 : 1),
      mu: hd.grip, kin: Math.min(0.95, tire.kin * surf.kin),
      D: DC.downforceOf(h.level) * (h.heavy ? 0.85 : 1),
      len: h.mesh ? h.mesh.userData.length : 4.5,
      resp: tire.resp * (h.heavy ? 0.85 : 1), drift: tire.drift
    });
    P.air = h.air;
    return P;
  };

  Game.prototype.updateHead = function (dt) {
    var h = this.head;
    if (this.boostTimer > 0) this.boostTimer -= dt;
    var P = this.physParams();
    // 坡道上重力沿行进方向的分量
    if (!h.air) P.slopeA = -DC.Physics.G * clamp(h.vy / Math.max(h.v, 3), -0.6, 0.6);
    var target;
    if (this.autopilot > 0) { this.autopilot -= dt; target = this.autoTarget(P); }
    else target = this.isHolding() ? DC.ANGLE_LEFT : DC.ANGLE_RIGHT;

    var ph = h.ph, n = 6, sub = dt / n;
    ph.x = h.x; ph.z = h.z;
    for (var i = 0; i < n; i++) DC.Physics.step(ph, P, target, sub);
    this.updateGuide(P, target);
    if (this.autopilot <= 0) this.updateCoach(P, target);
    var o = ph.out;
    h.x = ph.x; h.z = ph.z;
    h.v = Math.sqrt(ph.vx * ph.vx + ph.vz * ph.vz);
    if (h.v > 0.5) h.velA = Math.atan2(ph.vx, ph.vz);
    h.bodyA = ph.psi;
    h.latA = o.latA; h.lonA = o.lonA;

    // 路面与高度
    var ground = this.track.groundAt(h.x, h.z, this.curSeg);
    if (ground) this.curSeg = ground.seg;
    var wasAir = h.air;
    var impact = this.vertical(h, ground, dt);
    if (impact > 0) this.landed(impact);
    else if (impact < 0 && !wasAir) { this.stats.jumps++; this.notify('air', {}); }
    if (h.air) this.airTime = (this.airTime || 0) + dt; else this.airTime = 0;

    // 掉崖判定：车身完全离开路面才算。离开后先按抛物线飞行，落回路面就没事
    if (!h.air && !ground && !this.touchesTrack()) {
      h.air = true;
      if (!wasAir) { this.stats.jumps++; this.notify('air', {}); }
    }
    if (h.air && !ground && h.y < -2.5) {
      if (this.shieldLeft > 0) this.revive();
      else { this.startFall(); return; }
    }
    // 特殊路段效果
    var eff = ground ? ground.effect : null;
    if (eff === 'boost' && this.lastEffect !== 'boost') {
      this.boostTimer = 1.6;
      DC.Audio.boost();
      this.notify('boost', {});
    }
    if (eff === 'slick' && this.lastEffect !== 'slick') this.notify('slick', {});
    this.lastEffect = eff;
    if (this.autoCorner >= 0 && this.curSeg >= this.autoCorner) this.autoCorner = -1;

    this.track.extend(this.curSeg, h.level, 16);
    this.track.prune(this.curSeg);
    this.pushHistory();
    this.stats.coins += DC.incomeOf(h.level) * this.turbo * dt;

    // 漂移表现：按轮胎接地点的滑动速度
    var sliding = !h.air && o.slipX > 1;
    var drift = sliding ? clamp(o.slideV / 14, 0.15, 1) : 0;
    this.driftAngle = sliding ? Math.abs(o.beta) * 57.3 : 0;
    if (sliding) this.stats.drift += h.v * dt;
    // 起漂瞬间：轮胎啾声，性能车排气回火
    if (sliding && !this.wasSliding && h.v > 10) {
      if (this.surfaceKey() === 'asphalt' || this.surfaceKey() === 'wet') DC.Audio.chirp(this.surfaceKey() === 'wet' ? 0.5 : 1);
      if (SPORTY[DC.carOf(h.level).type] && Math.random() < 0.75) this.backfire();
    }
    this.wasSliding = sliding;
    this.drift = drift;
    this.tireEffects(dt, o, sliding);
    this.updateCombo(dt);
    this.haptics(dt);
    DC.Audio.update({ speedN: h.v / P.top, wheelN: (h.v + o.wheelSpin) / P.top, slip: h.air ? 0 : o.slipX,
      slideV: h.air ? 0 : o.slideV, surface: this.surfaceKey(), running: true, boost: this.boostTimer > 0, air: h.air });
  };

  var SPORTY = { hatch: 1, sedan: 1, muscle: 1, coupe: 1, mid: 1, hyper: 1 };

  // 漂移辅助线：预测“现在转向”后的物理轨迹，落在路面上为绿色，冲出去的部分为红色
  var GUIDE_N = 36;
  Game.prototype.ensureGuide = function () {
    if (this.guide) return;
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(GUIDE_N * 2 * 3), 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(GUIDE_N * 2 * 4), 4).setUsage(T.DynamicDrawUsage));
    var idx = [];
    for (var i = 0; i < GUIDE_N - 1; i++) { var a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e7);
    var m = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    this.guide = new T.Mesh(g, m);
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 3;
    this.scene.add(this.guide);
  };
  Game.prototype.updateGuide = function (P, target) {
    var on = DC.Save.data.settings.guide !== false && this.state === 'running' && !this.head.air;
    if (!on) { if (this.guide) this.guide.visible = false; return; }
    this.ensureGuide();
    var h = this.head, src = h.ph;
    var st = { x: src.x, z: src.z, vx: src.vx, vz: src.vz, psi: src.psi, r: src.r, wheel: src.wheel, out: {} };
    var PP = Object.assign({}, P, { air: false, slopeA: 0 });
    var alt = target > 0 ? DC.ANGLE_RIGHT : DC.ANGLE_LEFT; // 反方向
    var pos = this.guide.geometry.attributes.position.array, col = this.guide.geometry.attributes.color.array;
    var off = false, seg = this.curSeg, hw = 0.32;
    for (var i = 0; i < GUIDE_N; i++) {
      if (i > 0) for (var k = 0; k < 4; k++) DC.Physics.step(st, PP, alt, 1 / 100);
      var sp = Math.sqrt(st.vx * st.vx + st.vz * st.vz) || 1;
      var nx = st.vz / sp, nz = -st.vx / sp;
      var gi = this.track.locate(st.x, st.z, seg, 0);
      if (gi >= 0) seg = gi; else off = true;
      var gy = 0.06;
      if (gi >= 0) { var sg = this.track.get(gi); var hh = this.track.heightAt(sg, this.track.localOf(sg, st.x, st.z).along); gy += hh || 0; }
      pos[i * 6] = st.x + nx * hw; pos[i * 6 + 1] = gy; pos[i * 6 + 2] = st.z + nz * hw;
      pos[i * 6 + 3] = st.x - nx * hw; pos[i * 6 + 4] = gy; pos[i * 6 + 5] = st.z - nz * hw;
      var a = 0.85 * (1 - 0.7 * i / GUIDE_N) * Math.min(1, i / 2);
      var r = off ? 1 : 0.25, gC = off ? 0.22 : 1, b = off ? 0.3 : 0.55;
      for (var e = 0; e < 2; e++) { var c = (i * 2 + e) * 4; col[c] = r; col[c + 1] = gC; col[c + 2] = b; col[c + 3] = a; }
    }
    this.guide.geometry.attributes.position.needsUpdate = true;
    this.guide.geometry.attributes.color.needsUpdate = true;
    this.guide.visible = true;
  };
  // 排气回火火焰
  Game.prototype.backfire = function () {
    var h = this.head, ud = h.mesh.userData, ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
    var back = -ud.length / 2 - 0.1;
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var x = h.x + sa * back + ca * s2 * ud.width * 0.22, z = h.z + ca * back - sa * s2 * ud.width * 0.22;
      for (var i = 0; i < 7; i++) {
        this.fx.sparks.emit({ x: x, y: h.y + 0.35, z: z,
          vx: h.ph.vx * 0.85 - sa * rand(4, 9), vy: rand(-0.5, 1), vz: h.ph.vz * 0.85 - ca * rand(4, 9),
          s0: rand(0.35, 0.7), s1: 0.05, life: rand(0.08, 0.2), a: 1, r: 1, g: rand(0.35, 0.7), b: 0.08, fadeIn: 0.01 });
      }
    }
    DC.Audio.backfire();
  };

  // 各路面的轮胎特效：烟雾/粉尘、飞溅物、胎痕
  var SURF_FX = {
    asphalt: { smoke: 1.0, smokeC: '#e6e6e6', smokeS: 1.0, debris: 0, debrisC: '#333333', debrisS: 0.1, markC: '#0b0b0b', markA: 0.55 },
    snow: { smoke: 0.5, smokeC: '#ffffff', smokeS: 1.25, debris: 1.0, debrisC: '#f4f8ff', debrisS: 0.3, markC: '#7f8ea3', markA: 0.6, up: 4 },
    sand: { smoke: 0.95, smokeC: '#d6b585', smokeS: 1.45, debris: 0.7, debrisC: '#b48852', debrisS: 0.17, markC: '#6c5031', markA: 0.5, up: 3.5 },
    wet: { smoke: 0.35, smokeC: '#dbe5ff', smokeS: 1.0, debris: 1.1, debrisC: '#cfe2ff', debrisS: 0.14, markC: '#000000', markA: 0.16, up: 2.5, alpha: 0.65 },
    ice: { smoke: 0.3, smokeC: '#e8fbff', smokeS: 1.0, debris: 0.6, debrisC: '#effdff', debrisS: 0.1, markC: '#ffffff', markA: 0.42, up: 2 }
  };
  Game.prototype.smokeColor = function () { return SURF_FX[this.surfaceKey()].smokeC; };

  Game.prototype.tireEffects = function (dt, o, sliding) {
    var h = this.head, ph = h.ph, F = SURF_FX[this.surfaceKey()];
    var L = h.mesh.userData.length, W = h.mesh.userData.width;
    var ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
    var it = clamp(o.slideV / 16, 0, 1), spinIt = clamp(o.wheelSpin / 10, 0, 1);
    var rearOn = !h.air && (sliding || o.wheelSpin > 3);
    var e = Math.max(sliding ? it : 0, spinIt * 0.8);
    // 接地点的横向滑动方向，飞溅物顺着它甩出去
    var w = ph.vx * ca - ph.vz * sa;
    var acc = this.fxAcc || (this.fxAcc = { s: [0, 0], d: [0, 0] });
    var light = this.world.cur ? clamp(0.3 + (this.world.cur.sunI + this.world.cur.hemiI) * 0.4, 0.45, 1.1) : 1;
    this.fx.setLight(light);
    var tw = 0.22 + W * 0.05;
    for (var wI = 0; wI < 4; wI++) {
      var rear = wI < 2, side = wI % 2 ? 1 : -1, key = (rear ? 'r' : 'f') + side;
      var fwd = rear ? -L * 0.32 : L * 0.3;
      var wx = h.x + sa * fwd + ca * side * W * 0.42;
      var wz = h.z + ca * fwd - sa * side * W * 0.42;
      var on = rear ? rearOn : (!h.air && sliding && Math.abs(o.beta) > 0.3);
      if (!on) { this.fx.endMark(key); continue; }
      var alpha = Math.min(0.92, F.markA * 1.3 * (0.5 + 0.5 * e)) * (rear ? 1 : 0.6);
      this.fx.mark(key, wx, h.y, wz, ca, -sa, tw, F.markC, alpha);
      if (!rear) continue;
      acc.s[wI] += F.smoke * e * 60 * dt;
      acc.d[wI] += F.debris * e * 70 * dt;
      while (acc.s[wI] >= 1) {
        acc.s[wI] -= 1;
        this.fx.puff(wx, h.y + 0.25, wz, ph.vx * 0.22, ph.vz * 0.22, F.smokeS, F.smokeC, e);
      }
      var nd = Math.floor(acc.d[wI]);
      if (nd > 0) {
        acc.d[wI] -= nd;
        this.fx.debris(wx, h.y, wz, ph.vx * 0.3 + ca * w * 0.35, ph.vz * 0.3 - sa * w * 0.35, F.debrisC, nd, F.debrisS,
          { up: F.up || 3, alpha: F.alpha || 0.95, spread: 3 + e * 4 });
      }
    }
    if (!rearOn) for (var q = 0; q < 2; q++) { acc.s[q] = Math.min(acc.s[q], 1); acc.d[q] = Math.min(acc.d[q], 1); }
  };

  // 漂移连击：漂移角 × 车速 × 时间计分，连续漂移倍率递增，结束后换成金币
  Game.prototype.updateCombo = function (dt) {
    var c = this.combo || (this.combo = { active: false, points: 0, mult: 1, idle: 0, drifting: false, cur: 0 });
    var h = this.head;
    var now = this.driftAngle > 12 && h.v > 8 && !h.air;
    if (now) {
      if (!c.drifting && c.active && c.idle < 1.6) {
        c.mult = Math.min(5, c.mult + 1);
        this.notify('comboUp', { mult: c.mult });
      }
      c.drifting = true; c.active = true; c.idle = 0;
      var pts = this.driftAngle * DC.toKmh(h.v, h.level) * dt * 0.012 * c.mult;
      c.points += pts; c.cur += pts;
    } else if (c.active) {
      if (c.drifting) { c.drifting = false; c.cur = 0; }
      if (!h.air) c.idle += dt;
      if (c.idle > 1.6) this.bankCombo();
    }
  };
  Game.prototype.bankCombo = function () {
    var c = this.combo;
    if (!c || !c.active) return;
    var coins = Math.round(c.points * DC.incomeOf(this.head.level) * 0.04 * this.turbo);
    if (coins > 0) {
      this.stats.coins += coins;
      this.stats.driftPoints = (this.stats.driftPoints || 0) + c.points;
      this.notify('comboBank', { points: c.points, mult: c.mult, coins: coins });
    }
    this.combo = { active: false, points: 0, mult: 1, idle: 0, drifting: false, cur: 0 };
  };
  Game.prototype.loseCombo = function () {
    if (this.combo && this.combo.active && this.combo.points > 5) this.notify('comboLost', {});
    this.combo = { active: false, points: 0, mult: 1, idle: 0, drifting: false, cur: 0 };
  };

  // 手机震动反馈
  Game.prototype.haptics = function (dt) {
    if (!navigator.vibrate || DC.Save.data.settings.vibrate === false) return;
    this.vibT = (this.vibT || 0) - dt;
    if (this.drift > 0.2 && this.vibT <= 0) {
      try { navigator.vibrate(Math.round(6 + this.drift * 18)); } catch (e) { /* 忽略 */ }
      this.vibT = 0.11;
    }
  };
  DC.vibrate = function (p) {
    if (navigator.vibrate && DC.Save.data.settings.vibrate !== false) { try { navigator.vibrate(p); } catch (e) { /* 忽略 */ } }
  };

  Game.prototype.landed = function (impact) {
    var h = this.head;
    if (this.sus) { this.sus.heaveV -= Math.min(6, impact * 0.35); this.sus.pitchV += Math.min(2, impact * 0.08); }
    if (impact > 6) {
      this.shake = Math.min(0.6, impact * 0.03);
      DC.Audio.land(impact);
      DC.vibrate(Math.round(20 + impact * 3));
      for (var i = 0; i < 8; i++) this.fx.puff(h.x + rand(-1, 1), h.y + 0.2, h.z + rand(-1, 1), rand(-4, 4), rand(-4, 4), 1.4, this.smokeColor());
      this.notify('land', { air: this.airTime });
    }
  };

  Game.prototype.update = function (dt) {
    this.time += dt;
    var h = this.head;
    DC.updateCarFx(this.time);

    if (this.state === 'menu') {
      this.orbit += dt * 0.25;
      if (h.mesh) {
        h.mesh.position.set(h.x, 0, h.z);
        h.mesh.rotation.set(0, h.bodyA, 0);
        if (h.pop > 0) { h.pop = Math.max(0, h.pop - dt * 3); var ps = 1 + h.pop * 0.25; h.mesh.scale.set(ps, ps, ps); }
      }
      var ud = h.mesh ? h.mesh.userData : { length: 4.5, height: 1.4 };
      var r = (this.orbitRadius || 9.5) * Math.max(1, Math.pow(Math.max(ud.length, ud.height * 2.2) / 4.6, 0.85));
      this.camera.position.set(h.x + Math.sin(this.orbit) * r, ud.height * 0.9 + r * 0.22, h.z + Math.cos(this.orbit) * r);
      this.camLook.set(h.x, ud.height * 0.45, h.z);
      this.camera.lookAt(this.camLook);
      if (this.camera.fov !== 45) { this.camera.fov = 45; this.camera.updateProjectionMatrix(); }
      this.world.followSun(h.x, h.z);
      this.world.update(dt, this.camera);
      this.track.syncThemeMats(dt);
      this.fx.update(dt);
      DC.Audio.update(null);
      return;
    }

    if (this.state === 'paused' || this.state === 'over') {
      DC.Audio.update(null);
      if (this.state === 'over') { if (this.falling) this.updateFallingBodies(dt); this.fx.update(dt); }
      return;
    }

    if (this.state === 'countdown') {
      this.countdown -= dt;
      var c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c > 0) { this.lastCount = c; DC.Audio.countdown(false); this.notify('count', { n: c }); }
      if (this.countdown <= 0) { this.state = 'running'; DC.Audio.countdown(true); this.notify('count', { n: 0 }); }
      DC.Audio.update({ speedN: 0.05, wheelN: 0.05, running: true });
    }

    if (this.state === 'running') {
      if (this.timeScale && this.timeScale !== 1) dt *= this.timeScale; // 新手引导慢动作
      this.stats.time += dt;
      this.updateHead(dt);
    }

    if (this.state === 'falling') {
      this.fallTimer += dt;
      h.vy -= GRAVITY * dt;
      h.x += h.fvx * dt; h.z += h.fvz * dt; h.y += h.vy * dt;
      h.fvx *= 0.995; h.fvz *= 0.995;
      this.virtualDist += h.v * dt;
      DC.Audio.update(null);
      if (this.fallTimer > 2.3) this.finishRun();
    }

    if (h.mesh) {
      h.mesh.position.set(h.x, h.y, h.z);
      if (this.falling) {
        h.mesh.rotation.x += h.spinX * dt;
        h.mesh.rotation.z += h.spinZ * dt;
      } else {
        // 车身姿态：加速后蹲、侧向力使车身外倾
        // 悬挂弹簧：侧倾、俯仰、落地下沉都有回弹
        var sus = this.sus || (this.sus = { roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0 });
        var pitchT = h.air ? clamp(-h.vy * 0.02, -0.35, 0.35) : clamp(-h.vy * 0.012 - (h.lonA || 0) * 0.0022, -0.2, 0.2);
        var rollT = h.air ? 0 : clamp((h.latA || 0) * 0.0012, -0.11, 0.11);
        var sdt = Math.min(dt, 1 / 30);
        sus.rollV += ((rollT - sus.roll) * 130 - sus.rollV * 12) * sdt; sus.roll += sus.rollV * sdt;
        sus.pitchV += ((pitchT - sus.pitch) * 100 - sus.pitchV * 11) * sdt; sus.pitch += sus.pitchV * sdt;
        sus.heaveV += (-sus.heave * 160 - sus.heaveV * 14) * sdt; sus.heave += sus.heaveV * sdt;
        h.mesh.position.y = h.y + sus.heave;
        h.mesh.rotation.set(sus.pitch, h.bodyA, sus.roll, 'YXZ');
        var fw = h.mesh.userData.frontWheels;
        if (fw && fw.length && h.ph) {
          var beta = clamp(wrapAngle(h.velA - h.bodyA), -0.9, 0.9);
          var tgt = this.state === 'running' && !h.air && h.v > 2 ? clamp(beta * 0.9 + h.ph.r * 0.035, -0.6, 0.6) : 0;
          this.steerVis = (this.steerVis || 0) + (tgt - (this.steerVis || 0)) * damp(14, dt);
          for (var wi = 0; wi < fw.length; wi++) fw[wi].rotation.y = this.steerVis;
        }
      }
      if (h.pop > 0) { h.pop = Math.max(0, h.pop - dt * 2.5); var s2 = 1 + h.pop * 0.35; h.mesh.scale.set(s2, s2, s2); }
      else h.mesh.scale.set(1, 1, 1);
    }

    this.updateTail(dt, this.falling ? this.virtualDist : this.headDist, this.falling ? this.fallDist : undefined);
    this.updateRoadCars(dt);
    this.updateCamera(dt);
    this.world.followSun(this.falling ? this.camLook.x : h.x, this.falling ? this.camLook.z : h.z);
    this.world.update(dt, this.camera);
    this.track.syncThemeMats(dt);
    this.fx.update(dt);
    this.updateBeam();
  };

  Game.prototype.updateFallingBodies = function (dt) {
    var h = this.head;
    h.vy -= GRAVITY * dt; h.x += h.fvx * dt; h.z += h.fvz * dt; h.y += h.vy * dt;
    if (h.mesh) { h.mesh.position.set(h.x, h.y, h.z); h.mesh.rotation.x += h.spinX * dt; }
    if (h.y > -400) this.updateTail(dt, (this.virtualDist += h.v * dt), this.fallDist);
  };

  Game.prototype.snapCamera = function () {
    this.camInit = false;
    this.updateCamera(1);
  };

  Game.prototype.updateCamera = function (dt) {
    var h = this.head, cam = this.camera;
    var sf = clamp((h.v - 20) / 46, 0, 1);
    if (this.falling) {
      this.camLook.x += (h.x - this.camLook.x) * damp(4, dt);
      this.camLook.y += (h.y - this.camLook.y) * damp(4, dt);
      this.camLook.z += (h.z - this.camLook.z) * damp(4, dt);
      cam.lookAt(this.camLook);
      return;
    }
    var ud = h.mesh ? h.mesh.userData : { length: 4.5 };
    var big = Math.max(1, Math.pow(ud.length / 4.6, 0.45));
    var back = (14 + sf * 7) * big, up = (12 + sf * 5) * big, ahead = 10 + sf * 10;
    var asp = cam.aspect;
    if (asp < 1.3) {
      var k = Math.pow(Math.min(2.2, 1.3 / asp), 0.75);
      back *= k; up *= k; ahead *= k;
    }
    if (!this.camInit) { this.camX = h.x; this.camZ = h.z; this.camY = h.y; this.camInit = true; }
    this.camX += (h.x - this.camX) * damp(2.6, dt);
    this.camZ += (h.z - this.camZ) * damp(10, dt);
    this.camY += (h.y * 0.7 - this.camY) * damp(3, dt);
    // 漂移时镜头：向滑动方向偏移、轻微侧倾、平滑震动
    var beta = this.state === 'running' && !h.air ? wrapAngle(h.bodyA - h.velA) : 0;
    var dr = this.drift || 0;
    this.camSlide = (this.camSlide || 0) + (clamp(-Math.sin(beta) * 2.2, -1.6, 1.6) - (this.camSlide || 0)) * damp(2.5, dt);
    this.camRoll = (this.camRoll || 0) + (clamp(beta * 0.07, -0.05, 0.05) - (this.camRoll || 0)) * damp(3, dt);
    var shake = 0;
    if (this.shake > 0) { this.shake -= dt; shake = this.shake * 0.6; }
    var t = this.time, amp = shake + dr * 0.07;
    var sx = (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.7) * 0.4) * amp;
    var sy = (Math.sin(t * 41.3) * 0.5 + Math.sin(t * 19.9) * 0.5) * amp;
    cam.position.set(this.camX + this.camSlide + sx, this.camY + up + sy, this.camZ - back);
    this.camLook.set(this.camX * 0.6 + h.x * 0.4 + this.camSlide * 0.4, this.camY, this.camZ + ahead);
    cam.lookAt(this.camLook);
    cam.rotateZ(this.camRoll);
    this.fovDrift = (this.fovDrift || 0) + (dr * 4 - (this.fovDrift || 0)) * damp(2, dt);
    var fov = 55 + sf * 14 + (this.boostTimer > 0 ? 8 : 0) + this.fovDrift;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * damp(3, dt); cam.updateProjectionMatrix(); }
  };

  DC.Game = Game;
})(window.DC);
