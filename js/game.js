/* 游戏核心：车辆控制、吃车合成、车尾跟随、坠崖、收益 */
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

  function Game(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.world = opts.world;
    this.track = opts.track;
    this.fx = opts.effects;
    this.ui = null; // 由 UI 设置
    this.state = 'menu';
    this.holding = false;
    this.ignoreHold = false;

    this.head = { x: 0, z: 0, velA: DC.ANGLE_RIGHT, bodyA: DC.ANGLE_RIGHT, slip: 0, v: 0, mesh: null, level: 1, vy: 0, y: 0 };
    this.tail = [];
    this.roadCars = [];
    this.hx = []; this.hz = []; this.hd = [];
    this.headDist = 0;
    this.curSeg = 0;
    this.orbit = 0;
    this.camLook = new T.Vector3();
    this.smokeTimer = 0;

    var self = this;
    this.track.onSegment = function (s) { self.spawnOnSegment(s); };
  }

  // ---------- 外部接口 ----------
  Game.prototype.setHolding = function (on) {
    if (!on) this.ignoreHold = false;
    this.holding = on;
  };

  Game.prototype.isHolding = function () { return this.holding && !this.ignoreHold; };

  // 进入菜单 / 展示车辆
  Game.prototype.enterShowroom = function (level) {
    this.state = 'menu';
    this.clearRun();
    this.head.level = level;
    this.world.setThemeByLevel(level, true);
    this.track.reset(level);
    this.track.extend(0, level, 10);
    this.placeHeadAtStart();
    this.setHeadMesh(level);
    this.world.resetMountains(0, 0);
    this.removeRoadCars();
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
    this.stats = { time: 0, coins: 0, eaten: 0, merges: 0, startLevel: level, maxLevel: level };
    this.world.setThemeByLevel(level, true);
    this.track.reset(level);
    this.track.extend(0, level, 16);
    this.placeHeadAtStart();
    this.setHeadMesh(level);
    this.world.resetMountains(0, 0);
    this.shieldLeft = DC.Save.modLevel('shield');
    this.turbo = 1 + DC.Save.modLevel('turbo') * 0.15;
    this.magnet = DC.Save.modLevel('magnet');
    this.grip = DC.Save.modLevel('grip');
    this.ignoreHold = this.holding;
    this.countdown = 3.0;
    this.lastCount = 4;
    this.state = 'countdown';
    this.autopilot = 0;
    this.snapCamera();
  };

  Game.prototype.pause = function () { if (this.state === 'running' || this.state === 'countdown') { this.pausedFrom = this.state; this.state = 'paused'; } };
  Game.prototype.resume = function () { if (this.state === 'paused') { this.state = this.pausedFrom; this.ignoreHold = this.holding; } };

  // ---------- 内部 ----------
  Game.prototype.clearRun = function () {
    var self = this;
    this.tail.forEach(function (t) { self.scene.remove(t.mesh); });
    this.tail = [];
    this.removeRoadCars();
    this.fx.clear();
    this.hx = []; this.hz = []; this.hd = [];
    this.headDist = 0;
    this.curSeg = 0;
    this.head.vy = 0; this.head.y = 0;
    this.falling = false;
  };

  Game.prototype.removeRoadCars = function () {
    var self = this;
    this.roadCars.forEach(function (c) { self.scene.remove(c.mesh); });
    this.roadCars = [];
  };

  Game.prototype.placeHeadAtStart = function () {
    var s = this.track.get(0);
    var h = this.head;
    h.x = s.ax + s.dx * 8; h.z = s.az + s.dz * 8;
    h.velA = h.bodyA = s.angle; h.slip = 0; h.v = 0; h.y = 0; h.vy = 0;
    this.curSeg = 0;
    this.hx = [h.x]; this.hz = [h.z]; this.hd = [0];
    this.headDist = 0;
  };

  Game.prototype.setHeadMesh = function (level) {
    var h = this.head;
    if (h.mesh) this.scene.remove(h.mesh);
    h.mesh = DC.makeCar(level);
    h.mesh.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    h.mesh.position.set(h.x, h.y, h.z);
    h.mesh.rotation.set(0, h.bodyA, 0);
    this.scene.add(h.mesh);
    h.pop = 1;
  };

  Game.prototype.makeTailCar = function (level, x, z) {
    var mesh = DC.makeCar(level);
    mesh.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    var badge = DC.makeBadge(level, 0.7);
    badge.position.y = 2.3;
    mesh.add(badge);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    return { level: level, mesh: mesh, len: mesh.userData.length, blend: 0, fx: x, fz: z, pop: 0.6, falling: false, vy: 0, vx: 0, vz: 0, y: 0 };
  };

  // 刷车：根据车头等级与车尾组成随机选择等级
  Game.prototype.spawnLevel = function () {
    var L = this.head.level;
    if (this.tail.length && Math.random() < 0.35) {
      return this.tail[Math.floor(Math.random() * this.tail.length)].level;
    }
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

  Game.prototype.spawnOnSegment = function (s) {
    if (this.state === 'menu') return;
    var n;
    var r = Math.random();
    if (s.first) n = 1;
    else n = r < 0.15 ? 0 : (r < 0.8 ? 1 : 2);
    var margin = s.w * 0.7;
    if (s.len - margin * 2 < 4) n = Math.min(n, 1);
    for (var i = 0; i < n; i++) {
      var along = s.first ? s.len * 0.7 : margin + Math.random() * Math.max(1, s.len - margin * 2);
      var latMax = s.w / 2 - 1.5;
      var lat = (Math.random() * 2 - 1) * latMax;
      var x = s.ax + s.dx * along + s.dz * lat;
      var z = s.az + s.dz * along - s.dx * lat;
      var level = s.first ? Math.max(1, this.head.level - 1) : this.spawnLevel();
      var mesh = DC.makeCar(level);
      mesh.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      var badge = DC.makeBadge(level, 1);
      badge.position.y = 2.8;
      mesh.add(badge);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = s.angle + (Math.random() - 0.5) * 0.6;
      this.scene.add(mesh);
      this.roadCars.push({ level: level, mesh: mesh, x: x, z: z, seg: s.idx, phase: Math.random() * 6 });
    }
  };

  // 车尾插入（按等级从高到低排列）并处理合成
  Game.prototype.addToTail = function (level, x, z) {
    var entry = this.makeTailCar(level, x, z);
    var i = 0;
    while (i < this.tail.length && this.tail[i].level >= level) i++;
    this.tail.splice(i, 0, entry);
    this.resolveMerges();
  };

  Game.prototype.resolveMerges = function () {
    var changed = true;
    while (changed) {
      changed = false;
      // 与车头合成
      if (this.tail.length && this.tail[0].level >= this.head.level) {
        var t0 = this.tail.shift();
        this.scene.remove(t0.mesh);
        if (this.head.level < DC.MAX_LEVEL) {
          this.upgradeHead();
        } else {
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
          var px = a.mesh.position.x, pz = a.mesh.position.z;
          this.scene.remove(a.mesh); this.scene.remove(b2.mesh);
          var ne = this.makeTailCar(nl, px, pz);
          ne.blend = 0.4; ne.pop = 1;
          this.tail.splice(i, 2, ne);
          // 合并后保持有序
          var j = i;
          while (j > 0 && this.tail[j - 1].level < this.tail[j].level) {
            var tmp = this.tail[j - 1]; this.tail[j - 1] = this.tail[j]; this.tail[j] = tmp; j--;
          }
          this.stats.merges++;
          var bonus = DC.mergeBonusOf(nl) * this.turbo;
          this.stats.coins += bonus;
          this.fx.burst(px, 1.2, pz, DC.tierOf(nl).color, 26, 9);
          DC.Audio.merge(nl);
          this.notify('merge', { level: nl, bonus: bonus, x: px, z: pz });
          changed = true;
          break;
        }
      }
    }
  };

  Game.prototype.upgradeHead = function () {
    var h = this.head;
    h.level++;
    this.stats.maxLevel = Math.max(this.stats.maxLevel, h.level);
    this.setHeadMesh(h.level);
    var bonus = DC.mergeBonusOf(h.level) * 2 * this.turbo;
    this.stats.coins += bonus;
    this.fx.burst(h.x, 1.5, h.z, DC.tierOf(h.level).color, 60, 14);
    DC.Audio.levelUp();
    this.world.setThemeByLevel(h.level, false);
    this.shake = 0.5;
    this.notify('levelup', { level: h.level, bonus: bonus });
  };

  Game.prototype.notify = function (type, data) {
    if (this.ui && this.ui.onGameEvent) this.ui.onGameEvent(type, data);
  };

  Game.prototype.pushHistory = function () {
    var h = this.head;
    var n = this.hx.length;
    var lx = this.hx[n - 1], lz = this.hz[n - 1];
    var dx = h.x - lx, dz = h.z - lz;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d >= 0.3) {
      this.headDist = this.hd[n - 1] + d;
      this.hx.push(h.x); this.hz.push(h.z); this.hd.push(this.headDist);
    }
    // 修剪过旧的轨迹
    if (this.hx.length > 4000) {
      var keepFrom = this.headDist - this.tailLength() - 60;
      var cut = 0;
      while (cut < this.hd.length - 2 && this.hd[cut] < keepFrom) cut++;
      if (cut > 500) { this.hx.splice(0, cut); this.hz.splice(0, cut); this.hd.splice(0, cut); }
    }
  };

  Game.prototype.tailLength = function () {
    var total = this.head.mesh ? this.head.mesh.userData.length / 2 : 2;
    for (var i = 0; i < this.tail.length; i++) total += this.tail[i].len + 1.0;
    return total + 4;
  };

  // 在轨迹上按距离采样
  Game.prototype.sampleAt = function (d, out) {
    var hd = this.hd, n = hd.length;
    if (n < 2 || d <= hd[0]) {
      out.x = this.hx[0]; out.z = this.hz[0];
      out.a = n >= 2 ? Math.atan2(this.hx[1] - this.hx[0], this.hz[1] - this.hz[0]) : this.head.velA;
      if (d < hd[0] && n >= 2) { // 轨迹起点之前：沿起始方向外推
        var back = hd[0] - d;
        out.x -= Math.sin(out.a) * back; out.z -= Math.cos(out.a) * back;
      }
      return out;
    }
    if (d >= hd[n - 1]) { out.x = this.hx[n - 1]; out.z = this.hz[n - 1]; out.a = Math.atan2(this.hx[n - 1] - this.hx[n - 2], this.hz[n - 1] - this.hz[n - 2]); return out; }
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (hd[mid] <= d) lo = mid; else hi = mid; }
    var t = (d - hd[lo]) / (hd[hi] - hd[lo] || 1);
    out.x = this.hx[lo] + (this.hx[hi] - this.hx[lo]) * t;
    out.z = this.hz[lo] + (this.hz[hi] - this.hz[lo]) * t;
    // 用前后几个点平滑朝向
    var a0 = Math.max(0, lo - 3), a1 = Math.min(n - 1, hi + 3);
    out.a = Math.atan2(this.hx[a1] - this.hx[a0], this.hz[a1] - this.hz[a0]);
    return out;
  };

  var S = { x: 0, z: 0, a: 0 };

  Game.prototype.updateTail = function (dt, virtualDist, fallDist) {
    var off = this.head.mesh ? this.head.mesh.userData.length / 2 : 2;
    for (var i = 0; i < this.tail.length; i++) {
      var t = this.tail[i];
      off += t.len / 2 + (i === 0 ? 0.9 : 1.0);
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
        m.position.y = Math.sin(t.blend * Math.PI) * 1.5;
      } else {
        m.position.x = S.x; m.position.z = S.z; m.position.y = 0;
      }
      // 车尾轻微摆动，体现被拖拽的感觉
      m.rotation.y = S.a + Math.sin(this.time * 6 + i) * 0.06;
      if (t.pop > 0) { t.pop = Math.max(0, t.pop - dt * 3); var sc = 1 + t.pop * 0.5; m.scale.set(sc, sc, sc); }
      else m.scale.set(1, 1, 1);
      this.spinWheels(m, this.head.v, dt);
    }
  };

  Game.prototype.spinWheels = function (mesh, v, dt) {
    var w = mesh.userData.wheels;
    if (!w) return;
    for (var i = 0; i < w.length; i++) w[i].rotation.x += v * dt / 0.4;
  };

  Game.prototype.updateRoadCars = function (dt) {
    var h = this.head;
    var eatR = 2.5;
    var magR = this.magnet > 0 ? eatR + 1.5 + this.magnet * 0.8 : 0;
    for (var i = this.roadCars.length - 1; i >= 0; i--) {
      var c = this.roadCars[i];
      var dx = c.x - h.x, dz = c.z - h.z;
      var d2 = dx * dx + dz * dz;
      if (c.seg < this.track.base || (dz < -40)) {
        this.scene.remove(c.mesh); this.roadCars.splice(i, 1); continue;
      }
      if (this.state === 'running') {
        if (magR && d2 < magR * magR && d2 > 0.01) {
          var d = Math.sqrt(d2);
          var step = Math.min(d, (h.v + 12) * dt);
          c.x -= dx / d * step; c.z -= dz / d * step;
          dx = c.x - h.x; dz = c.z - h.z; d2 = dx * dx + dz * dz;
        }
        if (d2 < eatR * eatR) {
          this.scene.remove(c.mesh);
          this.roadCars.splice(i, 1);
          this.stats.eaten++;
          DC.Audio.pickup();
          this.fx.burst(c.x, 1, c.z, '#ffffff', 12, 6);
          this.notify('eat', { level: c.level, x: c.x, z: c.z });
          this.addToTail(c.level, c.x, c.z);
          continue;
        }
      }
      c.phase += dt;
      c.mesh.position.set(c.x, Math.abs(Math.sin(c.phase * 3)) * 0.06, c.z);
    }
  };

  // 自动驾驶（护盾复活后短暂接管）
  Game.prototype.autoTarget = function () {
    var s = this.track.get(this.curSeg);
    if (!s) return this.head.velA;
    var loc = this.track.localOf(s, this.head.x, this.head.z);
    var R = s.w * 0.42;
    if (loc.along > s.len - R) {
      var n = this.track.get(this.curSeg + 1);
      if (n) return n.angle;
    }
    return s.angle;
  };

  Game.prototype.revive = function () {
    var h = this.head;
    var s = this.track.get(this.curSeg);
    var loc = this.track.localOf(s, h.x, h.z);
    var along = clamp(loc.along, 2, s.len - 2);
    h.x = s.ax + s.dx * along; h.z = s.az + s.dz * along;
    h.velA = h.bodyA = s.angle; h.slip = 0;
    this.autopilot = 1.3;
    this.shieldLeft--;
    this.fx.burst(h.x, 1.2, h.z, '#7fd3ff', 50, 10);
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
    h.fvx = Math.sin(h.velA) * h.v; h.fvz = Math.cos(h.velA) * h.v; h.vy = 2;
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

  Game.prototype.update = function (dt) {
    this.time = (this.time || 0) + dt;
    var h = this.head;

    if (this.state === 'menu') {
      this.orbit += dt * 0.25;
      if (h.mesh) {
        h.mesh.position.set(h.x, 0, h.z);
        h.mesh.rotation.set(0, h.bodyA, 0);
        if (h.pop > 0) { h.pop = Math.max(0, h.pop - dt * 3); var ps = 1 + h.pop * 0.25; h.mesh.scale.set(ps, ps, ps); }
      }
      var r = this.orbitRadius || 9.5;
      this.camera.position.set(h.x + Math.sin(this.orbit) * r, 3.6, h.z + Math.cos(this.orbit) * r);
      this.camLook.set(h.x, 0.8, h.z);
      this.camera.lookAt(this.camLook);
      this.camera.fov = 45; this.camera.updateProjectionMatrix();
      this.world.followSun(h.x, h.z);
      this.world.update(dt, this.camera);
      this.track.syncThemeMats();
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
    }

    if (this.state === 'running') {
      this.stats.time += dt;
      var targetV = DC.speedOf(h.level);
      h.v = approach(h.v, targetV, (h.v < 10 ? 22 : 9) * dt);

      var seg = this.track.get(this.curSeg) || this.track.get(this.track.base);
      var target;
      if (this.autopilot > 0) { this.autopilot -= dt; target = this.autoTarget(); }
      else target = this.isHolding() ? DC.ANGLE_LEFT : DC.ANGLE_RIGHT;
      var R = seg.w * 0.42 / (1 + this.grip * 0.07);
      var omega = Math.max(2.5, h.v / R);
      h.velA = approach(h.velA, target, omega * dt);
      var slipT = clamp((target - h.velA) * 1.35, -0.8, 0.8);
      h.slip += (slipT - h.slip) * damp(14, dt);
      h.bodyA = h.velA + h.slip;
      h.x += Math.sin(h.velA) * h.v * dt;
      h.z += Math.cos(h.velA) * h.v * dt;
      this.pushHistory();

      // 赛道判定
      var found = this.track.locate(h.x, h.z, this.curSeg, 0.35);
      if (found < 0) {
        if (this.shieldLeft > 0) this.revive();
        else this.startFall();
      } else {
        this.curSeg = found;
        this.track.extend(this.curSeg, h.level, 16);
        this.track.prune(this.curSeg);
      }

      // 收益
      this.stats.coins += DC.incomeOf(h.level) * this.turbo * dt;

      // 漂移特效
      var drift = Math.min(1, Math.abs(h.slip) / 0.6);
      this.smokeTimer -= dt;
      if (this.state === 'running') {
        var L = h.mesh.userData.length, W = h.mesh.userData.width;
        var ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
        for (var wI = 0; wI < 2; wI++) {
          var side = wI ? 1 : -1;
          var wx = h.x - sa * L * 0.3 + ca * side * W * 0.45;
          var wz = h.z - ca * L * 0.3 - sa * side * W * 0.45;
          if (drift > 0.25) {
            this.fx.skid(wI, wx, wz);
            if (this.smokeTimer <= 0) this.fx.puff(wx, 0.3, wz, -Math.sin(h.velA) * 3, -Math.cos(h.velA) * 3, 0.9 + drift, '#d9d9d9');
          } else if (wI === 1) this.fx.endSkid();
        }
        if (this.smokeTimer <= 0) this.smokeTimer = 0.035;
      }
      DC.Audio.update(h.v / 68, drift, true);
    } else if (this.state === 'countdown') {
      DC.Audio.update(0.05, 0, true);
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

    // 车头模型
    if (h.mesh) {
      h.mesh.position.set(h.x, h.y, h.z);
      if (this.falling) {
        h.mesh.rotation.x += h.spinX * dt;
        h.mesh.rotation.z += h.spinZ * dt;
      } else {
        h.mesh.rotation.set(0, h.bodyA, -h.slip * 0.12);
      }
      if (h.pop > 0) { h.pop = Math.max(0, h.pop - dt * 2.5); var s2 = 1 + h.pop * 0.35; h.mesh.scale.set(s2, s2, s2); }
      else h.mesh.scale.set(1, 1, 1);
      this.spinWheels(h.mesh, h.v, dt);
    }

    this.updateTail(dt, this.falling ? this.virtualDist : this.headDist, this.falling ? this.fallDist : undefined);
    this.updateRoadCars(dt);
    this.updateCamera(dt);
    this.world.followSun(this.falling ? this.camLook.x : h.x, this.falling ? this.camLook.z : h.z);
    this.world.update(dt, this.camera);
    this.track.syncThemeMats();
    this.fx.update(dt);
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
    var h = this.head;
    var cam = this.camera;
    var sf = clamp((h.v - 18) / 50, 0, 1);
    if (this.falling) {
      // 坠落时镜头停住，看着车往下掉
      this.camLook.x += (h.x - this.camLook.x) * damp(4, dt);
      this.camLook.y += (h.y - this.camLook.y) * damp(4, dt);
      this.camLook.z += (h.z - this.camLook.z) * damp(4, dt);
      cam.lookAt(this.camLook);
      return;
    }
    var back = 17 + sf * 7, up = 16 + sf * 5, ahead = 11 + sf * 10;
    // 竖屏时视野较窄，把镜头拉远拉高
    var asp = cam.aspect;
    if (asp < 1.3) {
      var k = Math.pow(Math.min(2.2, 1.3 / asp), 0.75);
      back *= k; up *= k; ahead *= k;
    }
    if (!this.camInit) {
      cam.position.set(h.x, up, h.z - back);
      this.camX = h.x; this.camZ = h.z;
      this.camInit = true;
    }
    this.camX += (h.x - this.camX) * damp(2.6, dt);
    this.camZ += (h.z - this.camZ) * damp(10, dt);
    var shake = 0;
    if (this.shake > 0) { this.shake -= dt; shake = this.shake * 0.6; }
    cam.position.set(this.camX + (Math.random() - 0.5) * shake, up + (Math.random() - 0.5) * shake, this.camZ - back);
    this.camLook.set(this.camX * 0.6 + h.x * 0.4, 0, this.camZ + ahead);
    cam.lookAt(this.camLook);
    var fov = 55 + sf * 14;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * damp(3, dt); cam.updateProjectionMatrix(); }
  };

  DC.Game = Game;
})(window.DC);
