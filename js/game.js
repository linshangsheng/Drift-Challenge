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
    this.slideTime = 0.2;
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
    this.clearRun();
    this.head.level = level;
    this.world.setThemeByLevel(level, true);
    this.track.reset(level, this.surfaceKey());
    this.track.extend(0, level, 8);
    this.placeHeadAtStart();
    this.setHeadMesh(level);
    this.world.resetMountains(0, 0);
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
    this.hx = []; this.hz = []; this.hy = []; this.hd = [];
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
    this.curSeg = 0;
    this.hx = [h.x]; this.hz = [h.z]; this.hy = [0]; this.hd = [0];
    this.headDist = 0;
  };

  // 夜间车灯照在路面上的光斑
  var beamMat = null;
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
    var geo = new T.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI);
    var m = new T.Mesh(geo, beamMat);
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
    h.mesh = DC.makeCar(level);
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
      this.hx.push(h.x); this.hz.push(h.z); this.hy.push(h.y); this.hd.push(this.headDist);
    }
    if (this.hx.length > 4000) {
      var keepFrom = this.headDist - this.tailLength() - 60, cut = 0;
      while (cut < this.hd.length - 2 && this.hd[cut] < keepFrom) cut++;
      if (cut > 500) { this.hx.splice(0, cut); this.hz.splice(0, cut); this.hy.splice(0, cut); this.hd.splice(0, cut); }
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
      out.x = this.hx[0]; out.z = this.hz[0]; out.y = this.hy[0];
      out.a = n >= 2 ? Math.atan2(this.hx[1] - this.hx[0], this.hz[1] - this.hz[0]) : this.head.velA;
      if (d < hd[0] && n >= 2) { var back = hd[0] - d; out.x -= Math.sin(out.a) * back; out.z -= Math.cos(out.a) * back; }
      return out;
    }
    if (d >= hd[n - 1]) {
      out.x = this.hx[n - 1]; out.z = this.hz[n - 1]; out.y = this.hy[n - 1];
      out.a = Math.atan2(this.hx[n - 1] - this.hx[n - 2], this.hz[n - 1] - this.hz[n - 2]);
      return out;
    }
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (hd[mid] <= d) lo = mid; else hi = mid; }
    var t = (d - hd[lo]) / (hd[hi] - hd[lo] || 1);
    out.x = this.hx[lo] + (this.hx[hi] - this.hx[lo]) * t;
    out.z = this.hz[lo] + (this.hz[hi] - this.hz[lo]) * t;
    out.y = this.hy[lo] + (this.hy[hi] - this.hy[lo]) * t;
    var a0 = Math.max(0, lo - 3), a1 = Math.min(n - 1, hi + 3);
    out.a = Math.atan2(this.hx[a1] - this.hx[a0], this.hz[a1] - this.hz[a0]);
    return out;
  };

  var S = { x: 0, z: 0, y: 0, a: 0 };

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
      m.rotation.y = S.a + Math.sin(this.time * 6 + i) * 0.05;
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
      if (mdx * mdx + mdz * mdz > 1e-5) c.angle += wrapAngle(Math.atan2(mdx, mdz) - c.angle) * damp(10, dt);
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
      c.mesh.rotation.set(c.air ? -c.vy * 0.015 : 0, c.angle, 0, 'YXZ');
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

  // 自动驾驶（护盾复活后短暂接管，也用于测试）
  Game.prototype.autoTarget = function () {
    var s = this.track.get(this.curSeg);
    if (!s) return this.head.velA;
    var loc = this.track.localOf(s, this.head.x, this.head.z);
    var lead = this.head.v * (this.slideTime + 0.07) + 0.5;
    if (loc.along > s.len - lead) {
      var n = this.track.get(this.curSeg + 1);
      if (n) return n.angle;
    }
    return s.angle + clamp(-loc.lat * 0.04, -0.15, 0.15);
  };

  Game.prototype.revive = function () {
    var h = this.head;
    var s = this.track.get(this.curSeg);
    var loc = this.track.localOf(s, h.x, h.z);
    var along = clamp(loc.along, 2, s.len - 2);
    if (s.feat && along > s.feat.a - 2 && along < s.feat.end + 2) along = Math.max(2, s.feat.a - 3);
    h.x = s.ax + s.dx * along; h.z = s.az + s.dz * along;
    h.velA = h.bodyA = s.angle;
    h.y = this.track.heightAt(s, along) || 0; h.vy = 0; h.air = false;
    this.autopilot = 1.3;
    this.shieldLeft--;
    this.fx.burst(h.x, h.y + 1.2, h.z, '#7fd3ff', 50, 10);
    DC.Audio.shield();
    this.notify('shield', { left: this.shieldLeft });
    this.fx.endSkid();
  };

  Game.prototype.startFall = function () {
    var h = this.head;
    this.state = 'falling';
    this.falling = true;
    this.fallTimer = 0;
    this.fallDist = this.headDist;
    this.virtualDist = this.headDist;
    h.fvx = Math.sin(h.velA) * h.v; h.fvz = Math.cos(h.velA) * h.v;
    if (!h.air) h.vy = 1;
    h.spinX = 1.2 + Math.random(); h.spinZ = (Math.random() - 0.5) * 3;
    DC.Audio.fall();
    this.fx.endSkid();
    this.notify('fall', {});
  };

  Game.prototype.finishRun = function (quit) {
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
    var grip = DC.carGrip(h.level) * DC.tireGrip(tire, surf);
    if (this.lastEffect === 'slick') grip *= 0.45;
    return { grip: grip, surface: surf, tire: tire };
  };

  Game.prototype.updateHead = function (dt) {
    var h = this.head;
    var hd = this.handling();
    var surf = DC.SURFACES[hd.surface];
    // 滑行时间：车速越快、路面越滑、抓地越差，侧滑持续越久
    this.slideTime = clamp(4.2 / Math.max(h.v, 8), 0.1, 0.36) * surf.slide / hd.grip;
    var top = DC.speedOf(h.level) * (1 + this.engine * 0.03);
    if (this.boostTimer > 0) { this.boostTimer -= dt; top *= 1.35; }

    var target;
    if (this.autopilot > 0) { this.autopilot -= dt; target = this.autoTarget(); }
    else target = this.isHolding() ? DC.ANGLE_LEFT : DC.ANGLE_RIGHT;

    // 车头转向：最多 90°，不会超过目标方向
    var bodyRate = (6.5 + h.v * 0.12) * hd.tire.resp * (h.heavy ? 0.7 : 1);
    h.bodyA = approach(h.bodyA, target, bodyRate * dt * (h.air ? 0.5 : 1));
    // 速度方向靠轮胎摩擦慢慢追上车头方向 → 侧滑
    if (!h.air) h.velA += (h.bodyA - h.velA) * damp(1 / this.slideTime, dt);
    var slip = h.bodyA - h.velA;
    var slipAbs = Math.abs(Math.sin(slip));

    // 车速：加速到极速上限，侧滑会损失速度
    if (!h.air) {
      h.v -= h.v * slipAbs * 0.7 * dt;
      var acc = DC.accelOf(h.level) * (1 + this.engine * 0.1) * (h.v < 8 ? 2.2 : 1);
      if (h.v < top) h.v = Math.min(top, h.v + acc * dt * (1 - 0.6 * (h.v / top) * (h.v / top)));
      else h.v = Math.max(top, h.v - 10 * dt);
    }
    h.x += Math.sin(h.velA) * h.v * dt;
    h.z += Math.cos(h.velA) * h.v * dt;

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

    this.track.extend(this.curSeg, h.level, 16);
    this.track.prune(this.curSeg);
    this.pushHistory();
    this.stats.coins += DC.incomeOf(h.level) * this.turbo * dt;

    // 漂移特效
    var drift = h.air ? 0 : Math.min(1, slipAbs / 0.5);
    if (drift > 0.15) this.stats.drift += h.v * dt;
    this.smokeTimer -= dt;
    var L = h.mesh.userData.length, W = h.mesh.userData.width;
    var ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
    for (var wI = 0; wI < 2; wI++) {
      var side = wI ? 1 : -1;
      var wx = h.x - sa * L * 0.32 + ca * side * W * 0.42;
      var wz = h.z - ca * L * 0.32 - sa * side * W * 0.42;
      if (drift > 0.12) {
        this.fx.skid(wI, wx, wz, h.y);
        if (this.smokeTimer <= 0) this.fx.puff(wx, h.y + 0.3, wz, -Math.sin(h.velA) * 2, -Math.cos(h.velA) * 2, 0.8 + drift * 1.6, this.smokeColor());
      } else if (wI === 1) this.fx.endSkid();
    }
    if (this.smokeTimer <= 0) this.smokeTimer = 0.03;
    this.drift = drift;
    DC.Audio.update(h.v / top, drift, true, this.boostTimer > 0);
  };

  Game.prototype.smokeColor = function () {
    return { asphalt: '#dcdcdc', snow: '#ffffff', sand: '#e2c38e', wet: '#c9d6ff', ice: '#e0fbff' }[this.surfaceKey()];
  };

  Game.prototype.landed = function (impact) {
    var h = this.head;
    if (impact > 6) {
      this.shake = Math.min(0.6, impact * 0.03);
      DC.Audio.land(impact);
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
      DC.Audio.update(0, 0, false);
      return;
    }

    if (this.state === 'paused' || this.state === 'over') {
      DC.Audio.update(0, 0, false);
      if (this.state === 'over') { if (this.falling) this.updateFallingBodies(dt); this.fx.update(dt); }
      return;
    }

    if (this.state === 'countdown') {
      this.countdown -= dt;
      var c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c > 0) { this.lastCount = c; DC.Audio.countdown(false); this.notify('count', { n: c }); }
      if (this.countdown <= 0) { this.state = 'running'; DC.Audio.countdown(true); this.notify('count', { n: 0 }); }
      DC.Audio.update(0.05, 0, true);
    }

    if (this.state === 'running') {
      this.stats.time += dt;
      this.updateHead(dt);
    }

    if (this.state === 'falling') {
      this.fallTimer += dt;
      h.vy -= GRAVITY * dt;
      h.x += h.fvx * dt; h.z += h.fvz * dt; h.y += h.vy * dt;
      h.fvx *= 0.995; h.fvz *= 0.995;
      this.virtualDist += h.v * dt;
      DC.Audio.update(0, 0, false);
      if (this.fallTimer > 2.3) this.finishRun();
    }

    if (h.mesh) {
      h.mesh.position.set(h.x, h.y, h.z);
      if (this.falling) {
        h.mesh.rotation.x += h.spinX * dt;
        h.mesh.rotation.z += h.spinZ * dt;
      } else {
        var slip = h.bodyA - h.velA;
        var pitch = h.air ? clamp(-h.vy * 0.02, -0.35, 0.35) : clamp(-h.vy * 0.012, -0.2, 0.2);
        h.mesh.rotation.set(pitch, h.bodyA, clamp(-slip * 0.12, -0.12, 0.12), 'YXZ');
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
    var sf = clamp((h.v - 20) / 56, 0, 1);
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
    var shake = 0;
    if (this.shake > 0) { this.shake -= dt; shake = this.shake * 0.6; }
    cam.position.set(this.camX + (Math.random() - 0.5) * shake, this.camY + up + (Math.random() - 0.5) * shake, this.camZ - back);
    this.camLook.set(this.camX * 0.6 + h.x * 0.4, this.camY, this.camZ + ahead);
    cam.lookAt(this.camLook);
    var fov = 55 + sf * 14 + (this.boostTimer > 0 ? 8 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * damp(3, dt); cam.updateProjectionMatrix(); }
  };

  DC.Game = Game;
})(window.DC);
