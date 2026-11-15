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
    this.items = [];
    var self = this;
    this.track.onSegment = function (s) { self.spawnItems(s); };
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
    this.countdown = save.totalRuns > 0 ? 2.0 : 3.0; // 再来一局时倒计时短一些
    this.lastCount = 4;
    this.autopilot = 0;
    this.boostTimer = 0;
    this.turboTimer = 0; this.turboK = 0; this.charge = { t: 0, stage: 0, off: 0, live: false };
    this.fovKick = 0; this.camKick = 0; this.camAir = 0;
    this.bigAir = false; this.airScale = 1; this.grazeT = 0; this.signSeg = -1;
    this.spawnTimer = 0;
    this.lastEffect = null;
    this.avgV = 0;
    this.combo = null;
    this.sus = null;
    this.timeScale = 1;
    this.magnetTimer = 0; this.doubleTimer = 0; this.coinChain = 0; this.coinChainT = 0; this.edgeT = 0;
    this.coachCorner = -1;
    this.coach = DC.Save.data.tutorialDone ? null : { until: 5, action: null };
    this.snapCamera();
    // 开局先放几辆车
    this.spawnRoadCar(rand(45, 60));
    this.spawnRoadCar(rand(105, 130));
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
    this.clearItems();
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
  // 玩家车脚下的光环，方便在车队里认出自己
  var ringMat = null, ringGeo = null;
  function headRing(L, W, color) {
    if (!ringMat) {
      var cv = document.createElement('canvas'); cv.width = cv.height = 128;
      var x = cv.getContext('2d');
      x.strokeStyle = '#ffffff'; x.lineWidth = 9; x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.stroke();
      x.globalAlpha = 0.35; x.lineWidth = 20; x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.stroke();
      ringMat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending,
        toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 });
      ringGeo = new T.PlaneGeometry(1, 1); ringGeo.rotateX(-Math.PI / 2);
    }
    ringMat.color.set(color);
    var m = new T.Mesh(ringGeo, ringMat);
    m.scale.set(W * 2.1, 1, L * 1.45);
    m.position.y = 0.05;
    m.renderOrder = 2;
    return m;
  }
  Game.prototype.updateBeam = function () {
    if (ringMat) {
      var cs = this.state === 'running' && this.charge ? this.charge.stage : 0;
      ringMat.opacity = this.state === 'menu' ? 0 : (cs ? 0.95 : 0.55 + Math.sin(this.time * 4) * 0.2);
      if (cs !== this.ringStage) { this.ringStage = cs; ringMat.color.set(cs ? CHARGE_C[cs].hex : DC.tierOf(this.head.level).color); }
    }
    if (beamMat) beamMat.opacity = Math.min(1, this.world.cur.stars) * 0.6;
  };

  Game.prototype.setHeadMesh = function (level) {
    var h = this.head;
    if (h.mesh) this.scene.remove(h.mesh);
    h.mesh = DC.makeCar(level, true);
    h.mesh.add(headBeam(h.mesh.userData.length, h.mesh.userData.width));
    h.mesh.add(headRing(h.mesh.userData.length, h.mesh.userData.width, DC.tierOf(level).color));
    this.ringStage = 0;
    h.mesh.position.set(h.x, h.y, h.z);
    h.mesh.rotation.set(0, h.bodyA, 0);
    this.scene.add(h.mesh);
    h.pop = 1;
    h.heavy = !!HEAVY[DC.carOf(level).type];
    DC.Audio.setEngine(DC.engineTypeOf(level));
    // 提前校准下一级的下压力，升级时不卡顿
    if (level < DC.MAX_LEVEL && this.state !== 'menu') setTimeout(function () { DC.downforceOf(level + 1); }, 500);
  };

  Game.prototype.makeTailCar = function (level, x, z, y) {
    var mesh = DC.makeCar(level);
    var badge = DC.makeBadge(level, 0.7 * this.badgeScale());
    badge.position.y = mesh.userData.height + 0.6;
    mesh.add(badge);
    mesh.position.set(x, y || 0, z);
    this.scene.add(mesh);
    return { level: level, mesh: mesh, len: mesh.userData.length, blend: 0, fx: x, fz: z, fy: y || 0, pop: 0.6, falling: false, vy: 0, vx: 0, vz: 0 };
  };

  // 等级越高镜头越远，等级牌相应放大，保证看得清
  Game.prototype.badgeScale = function () { return 1 + (this.head.level - 1) / 99 * 0.8; };

  // 刷车等级
  Game.prototype.spawnLevel = function () {
    var L = this.head.level;
    // 路上的车不多，所以每辆都更有分量：多半与车尾某辆同级（吃到就能合成，优先是车尾最高级的那辆），其余接近车头等级
    if (this.tail.length && Math.random() < 0.58) return this.tail[Math.random() < 0.6 ? 0 : Math.floor(Math.random() * this.tail.length)].level;
    var r = Math.random(), d;
    if (r < 0.16) d = 0;
    else if (r < 0.66) d = 1;
    else if (r < 0.9) d = 2;
    else d = 3 + Math.floor(Math.random() * 3);
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
    var badge = DC.makeBadge(level, this.badgeScale());
    badge.position.y = dims.height + 0.9;
    mesh.add(badge);
    var latMax = Math.max(0, s.w / 2 - dims.width / 2 - 0.5);
    var lat = rand(-latMax, latMax) * 0.7;
    var p = this.track.pointAt(s.idx, along, lat);
    var y0 = this.track.heightAt(s, along) || 0;
    mesh.position.set(p.x, y0, p.z);
    mesh.rotation.y = s.angle;
    mesh.scale.set(0.01, 0.01, 0.01);
    this.scene.add(mesh);
    this.roadCars.push({
      level: level, mesh: mesh, seg: s.idx, along: along, lat: lat, latT: lat,
      ratio: rand(0.74, 0.9), x: p.x, z: p.z, y: y0, vy: 0, air: false, angle: s.angle,
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
          this.fx.shockwave(px, py, pz, DC.tierOf(nl).color, 11, 0.45);
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
    this.fx.shockwave(h.x, h.y, h.z, DC.tierOf(h.level).color, 26, 0.7);
    DC.Audio.levelUp();
    this.world.setThemeByLevel(h.level, false);
    if (DC.themeIndexOf(h.level) !== oldTheme) this.track.surface = this.surfaceKey();
    this.shake = 0.5;
    // 进入新档次：额外奖励
    var tier = DC.tierOf(h.level), tierBonus = 0;
    if (tier.from === h.level) { tierBonus = Math.round(DC.incomeOf(h.level) * 25 * this.turbo); this.stats.coins += tierBonus; }
    this.notify('levelup', { level: h.level, bonus: bonus, newTier: tier.from === h.level ? tier : null, tierBonus: tierBonus });
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
      out.x = this.hx[0]; out.z = this.hz[0]; out.y = this.hy[0]; out.b = 0; out.p = 0;
      out.a = n >= 2 ? Math.atan2(this.hx[1] - this.hx[0], this.hz[1] - this.hz[0]) : this.head.velA;
      if (d < hd[0] && n >= 2) { var back = hd[0] - d; out.x -= Math.sin(out.a) * back; out.z -= Math.cos(out.a) * back; }
      return out;
    }
    if (d >= hd[n - 1]) {
      out.x = this.hx[n - 1]; out.z = this.hz[n - 1]; out.y = this.hy[n - 1]; out.b = this.hb[n - 1] || 0; out.p = 0;
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
    out.p = Math.atan2(this.hy[a1] - this.hy[a0], Math.max(0.5, hd[a1] - hd[a0]));
    return out;
  };

  var S = { x: 0, z: 0, y: 0, a: 0, b: 0, p: 0 };

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
      m.rotation.set(-clamp(S.p, -0.6, 0.6), S.a + S.b * 0.9 + Math.sin(this.time * 6 + i) * 0.03, 0, 'YXZ');
      if (t.pop > 0) { t.pop = Math.max(0, t.pop - dt * 3); var sc = 1 + t.pop * 0.5; m.scale.set(sc, sc, sc); }
      else m.scale.set(1, 1, 1);
    }
  };

  // 车辆的垂直运动（跟随路面起伏，起跳、落地）
  Game.prototype.vertical = function (o, ground, dt) {
    if (o.air) {
      o.vy -= GRAVITY * dt;
      o.y += o.vy * dt;
      if (ground && o.y <= ground.h && o.y > ground.h - 2.6) {
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
    var mg = Math.max(this.magnet, this.magnetTimer > 0 ? 5 : 0);
    var magR = 2.2 + (mg > 0 ? 0.6 + mg * 0.8 : 0);
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
          var eb = DC.eatBonusOf(c.level) * this.turbo * (this.doubleTimer > 0 ? 2 : 1);
          this.stats.coins += eb;
          this.notify('eat', { level: c.level, x: c.x, z: c.z, y: c.y, bonus: eb });
          this.addToTail(c.level, c.x, c.z, c.y);
          continue;
        }
      }
      c.mesh.position.set(c.x, c.y, c.z);
      // 车身随坡度俯仰
      var pt = c.air ? -c.vy * 0.015 : -Math.atan2(c.vy, Math.max(roadV * c.ratio, 5));
      c.pitch = (c.pitch || 0) + (clamp(pt, -0.5, 0.5) - (c.pitch || 0)) * damp(12, dt);
      c.mesh.rotation.set(c.pitch, c.angle + (c.slip || 0), 0, 'YXZ');
    }
    // 维持前方车流
    if (this.state === 'running') {
      this.spawnTimer -= dt;
      var ahead = 0;
      for (var k = 0; k < this.roadCars.length; k++) {
        var rc = this.roadCars[k], rs = this.track.get(rc.seg);
        if (rs && rs.cum + rc.along > prog) ahead++;
      }
      // 前方只保持两三辆车，间隔拉开
      var want = h.level >= 40 ? 3 : 2;
      if (ahead < want && this.spawnTimer <= 0) {
        this.spawnTimer = rand(1.6, 3.2);
        this.spawnRoadCar(rand(1.8, 2.6) * Math.max(h.v, 25) + 30);
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
    // autoBias：测试用的时机误差（米），正值表示转晚了
    if (lat * k >= -0.3 + (this.autoBias || 0) || remain < -s.eE + 1) { this.autoCorner = n.idx; return n.angle; }
    return s.angle;
  };

  // ---------- 路上的道具：金币、磁铁、护盾、氮气、双倍金币 ----------
  var POWER = {
    nitro: { color: '#ff6a3d', icon: '🔥', name: '氮气加速' },
    magnet: { color: '#ff4d7a', icon: '🧲', name: '磁铁' },
    shield: { color: '#6fd6ff', icon: '🛡️', name: '护盾 +1' },
    double: { color: '#ffd34d', icon: '×2', name: '双倍金币' }
  };
  var COIN_MAX = 160, itemMtx = new T.Matrix4(), itemQ = new T.Quaternion(), itemS = new T.Vector3(), itemP = new T.Vector3(), yAx = new T.Vector3(0, 1, 0);
  Game.prototype.ensureItems = function () {
    if (this.coinMesh) return;
    var cg = new T.CylinderGeometry(0.6, 0.6, 0.14, 16);
    cg.rotateX(Math.PI / 2);
    var cm = new T.MeshStandardMaterial({ color: '#ffcf33', metalness: 0.9, roughness: 0.25, emissive: '#7a5200', emissiveIntensity: 0.6 });
    this.coinMesh = new T.InstancedMesh(cg, cm, COIN_MAX);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.scene.add(this.coinMesh);
    this.powerGeo = new T.OctahedronGeometry(0.85, 0);
    this.powerMats = {};
    this.powerIcons = {};
    for (var k in POWER) {
      this.powerMats[k] = new T.MeshStandardMaterial({ color: POWER[k].color, emissive: POWER[k].color, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.3, flatShading: true });
      var cv = document.createElement('canvas'); cv.width = cv.height = 96;
      var x = cv.getContext('2d');
      x.font = (k === 'double' ? '900 54px Arial' : '60px serif'); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#ffffff'; x.strokeStyle = 'rgba(0,0,0,0.7)'; x.lineWidth = 6;
      if (k === 'double') x.strokeText(POWER[k].icon, 48, 52);
      x.fillText(POWER[k].icon, 48, 52);
      var tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding;
      this.powerIcons[k] = new T.SpriteMaterial({ map: tx, depthTest: false, transparent: true });
    }
  };
  Game.prototype.clearItems = function () {
    for (var i = 0; i < this.items.length; i++) if (this.items[i].mesh) this.scene.remove(this.items[i].mesh);
    this.items = [];
    if (this.coinMesh) this.coinMesh.count = 0;
  };
  Game.prototype.spawnItems = function (s) {
    if (this.state === 'menu' || s.first) return;
    this.ensureItems();
    var f = s.feat, self = this;
    function free(al) { return al > s.eS + 1 && al < s.len - s.eE - 1 && !(f && al > f.a - 4 && al < f.end + 4); }
    function put(type, along, lat) {
      var h = self.track.heightAt(s, along);
      if (h === null || !free(along)) return;
      var p = self.track.pointAt(s.idx, along, lat);
      var it = { type: type, x: p.x, z: p.z, y: h, seg: s.idx, ph: Math.random() * 6 };
      if (type !== 'coin') {
        var g = new T.Group();
        g.add(new T.Mesh(self.powerGeo, self.powerMats[type]));
        var sp = new T.Sprite(self.powerIcons[type]); sp.scale.set(1.5, 1.5, 1); sp.position.y = 1.5; sp.renderOrder = 9;
        g.add(sp);
        g.position.set(p.x, h + 1.3, p.z);
        self.scene.add(g);
        it.mesh = g;
      }
      self.items.push(it);
    }
    var latMax = s.w / 2 - 1.6;
    // 一排金币，沿路段略带弧线
    if (Math.random() < 0.6) {
      var n = 4 + Math.floor(Math.random() * 5), a0 = rand(s.w * 0.7, Math.max(s.w * 0.8, s.len - s.w * 0.7 - n * 3.6));
      var l0 = rand(-latMax, latMax), l1 = rand(-latMax, latMax);
      for (var i = 0; i < n; i++) put('coin', a0 + i * 3.6, l0 + (l1 - l0) * i / n);
    }
    // 偶尔出现限时道具
    if (this.head.level >= 2 && Math.random() < 0.085) {
      var r = Math.random();
      put(r < 0.3 ? 'nitro' : r < 0.6 ? 'magnet' : r < 0.85 ? 'double' : 'shield', rand(0.35, 0.65) * s.len, rand(-latMax, latMax));
    }
  };
  Game.prototype.updateItems = function (dt) {
    if (!this.coinMesh) return;
    var h = this.head, n = 0, running = this.state === 'running';
    var W = h.mesh ? h.mesh.userData.width : 2;
    var pickR = 1.7 + W * 0.5, pullR = this.magnetTimer > 0 ? 13 : (this.magnet > 0 ? 2.5 + this.magnet * 1.2 : 0);
    if (this.coinChainT > 0) { this.coinChainT -= dt; if (this.coinChainT <= 0) this.coinChain = 0; }
    for (var i = this.items.length - 1; i >= 0; i--) {
      var it = this.items[i];
      if (it.seg < this.track.base) { if (it.mesh) this.scene.remove(it.mesh); this.items.splice(i, 1); continue; }
      var dx = it.x - h.x, dz = it.z - h.z, d2 = dx * dx + dz * dz;
      if (running && Math.abs(it.y - h.y) < 3) {
        if (pullR && it.type === 'coin' && d2 < pullR * pullR && d2 > 0.01) {
          var d = Math.sqrt(d2), st = Math.min(d, (h.v + 18) * dt);
          it.x -= dx / d * st; it.z -= dz / d * st; it.y += (h.y - it.y) * Math.min(1, dt * 8);
          dx = it.x - h.x; dz = it.z - h.z; d2 = dx * dx + dz * dz;
        }
        if (d2 < pickR * pickR) {
          this.pickItem(it);
          if (it.mesh) this.scene.remove(it.mesh);
          this.items.splice(i, 1);
          continue;
        }
      }
      it.ph += dt * 3;
      if (it.type === 'coin') {
        if (n < COIN_MAX) {
          itemMtx.compose(itemP.set(it.x, it.y + 1.0 + Math.sin(it.ph) * 0.12, it.z), itemQ.setFromAxisAngle(yAx, it.ph), itemS.set(1, 1, 1));
          this.coinMesh.setMatrixAt(n++, itemMtx);
        }
      } else {
        it.mesh.children[0].rotation.y = it.ph * 0.7;
        it.mesh.position.set(it.x, it.y + 1.3 + Math.sin(it.ph) * 0.2, it.z);
      }
    }
    this.coinMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;
  };
  Game.prototype.pickItem = function (it) {
    var h = this.head;
    if (it.type === 'coin') {
      var v = Math.max(1, DC.incomeOf(h.level) * 1.5) * this.turbo * (this.doubleTimer > 0 ? 2 : 1);
      this.stats.coins += v;
      this.stats.coinsPicked = (this.stats.coinsPicked || 0) + 1;
      this.coinChain = Math.min(12, this.coinChain + 1); this.coinChainT = 0.6;
      DC.Audio.coin(this.coinChain);
      this.fx.burst(it.x, it.y + 1, it.z, '#ffd34d', 5, 5);
      return;
    }
    if (it.type === 'nitro') { this.boostTimer = 2.6; DC.Audio.boost(); }
    else if (it.type === 'magnet') this.magnetTimer = 9;
    else if (it.type === 'double') this.doubleTimer = 12;
    else if (it.type === 'shield') this.shieldLeft = Math.min(3, this.shieldLeft + 1);
    DC.Audio.power();
    DC.vibrate(30);
    this.fx.burst(it.x, it.y + 1.3, it.z, POWER[it.type].color, 30, 10);
    this.notify('power', { type: it.type, name: POWER[it.type].name, color: POWER[it.type].color, icon: POWER[it.type].icon, shield: this.shieldLeft });
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
    if (lat * k >= -0.3 || remain < -s.eE + 1) { this.coachCorner = n.idx; return n.angle; }
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
    this.charge = { t: 0, stage: 0, off: 0, live: false }; this.turboTimer = 0;
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

  // 下压力按车校准：原厂轮胎、在该等级所在的路面上过 90° 弯时，
  // 侧滑距离约为路宽的 SLIDE_RATIO 倍（slide90 在 Game 定义之后才会被调用）。这样各等级的漂移都够长，又不会滑出赛道的几何范围
  var SLIDE_RATIO = DC.SLIDE_RATIO = 0.88, dfCache = {};
  function slide90(o) {
    var Ph = DC.Physics, P = Ph.params(o), A = Math.PI / 4, B = -A, hh = 1 / 120;
    var st = Ph.state(0, 0, A, o.top), i, m = 0;
    for (i = 0; i < 40; i++) Ph.step(st, P, A, hh);
    var x0 = st.x, z0 = st.z, nx = Math.cos(B), nz = -Math.sin(B);
    for (i = 0; i < 300; i++) {
      Ph.step(st, P, B, hh);
      var lat = (st.x - x0) * nx + (st.z - z0) * nz;
      if (lat > m) m = lat; else if (i > 30 && lat < m - 0.01) break;
    }
    return m;
  }
  DC.downforceOf = function (level) {
    if (dfCache[level] !== undefined) return dfCache[level];
    var surf = DC.SURFACES[DC.THEMES[DC.themeIndexOf(level)].surface], tire = DC.tireOf('stock');
    var heavy = !!HEAVY[DC.carOf(level).type];
    var o = { top: DC.speedOf(level), accel: DC.accelOf(level) * (heavy ? 0.7 : 1),
      mu: DC.carGrip(level) * DC.tireGrip(tire, DC.THEMES[DC.themeIndexOf(level)].surface) * surf.mu, kin: Math.min(0.95, tire.kin * surf.kin),
      len: DC.carDims(level).length, resp: tire.resp * (heavy ? 0.85 : 1), drift: tire.drift, D: 0 };
    var want = SLIDE_RATIO * DC.trackWidthOf(level), lo = 0, hi = 0.6;
    for (var i = 0; i < 16; i++) { o.D = (lo + hi) / 2; if (slide90(o) > want) lo = o.D; else hi = o.D; }
    return (dfCache[level] = (lo + hi) / 2);
  };

  // 车辆动力学参数
  Game.prototype.physParams = function () {
    var h = this.head, hd = this.handling(), surf = DC.SURFACES[hd.surface], tire = hd.tire;
    var boost = this.boostTimer > 0, turbo = this.turboTimer > 0 ? this.turboK : 0;
    var P = DC.Physics.params({
      top: DC.speedOf(h.level) * (1 + this.engine * 0.03) * (boost ? 1.35 : 1 + turbo),
      accel: DC.accelOf(h.level) * (1 + this.engine * 0.1) * (boost ? 1.6 : (turbo ? 1.5 : 1)) * (h.heavy ? 0.7 : 1),
      mu: hd.grip, kin: Math.min(0.95, tire.kin * surf.kin),
      D: DC.downforceOf(h.level),
      len: h.mesh ? h.mesh.userData.length : 4.5,
      resp: tire.resp * (h.heavy ? 0.85 : 1), drift: tire.drift
    });
    P.air = h.air;
    return P;
  };

  // 按住 / 松开对应的行进方向：当前路段和下一段各占一个（弯角不固定是 90°）
  var DIRS = { left: 0, right: 0 };
  Game.prototype.dirs = function () {
    var s = this.track.get(this.curSeg), n = this.track.get(this.curSeg + 1);
    if (!s) { DIRS.left = DC.ANGLE_LEFT; DIRS.right = DC.ANGLE_RIGHT; return DIRS; }
    var other = n ? n.angle : s.nAngle;
    if (s.angle > 0) { DIRS.left = s.angle; DIRS.right = other; } else { DIRS.right = s.angle; DIRS.left = other; }
    return DIRS;
  };

  Game.prototype.updateHead = function (dt) {
    var h = this.head;
    if (this.boostTimer > 0) this.boostTimer -= dt;
    if (this.turboTimer > 0) this.turboTimer -= dt;
    var P = this.physParams();
    // 坡道上重力沿行进方向的分量
    if (!h.air) {
      var slope = clamp(h.vy / Math.max(h.v, 3), -0.6, 0.6);
      P.slopeA = -DC.Physics.G * slope;
      // 下坡时重力帮忙，极速更高；上坡极速降低
      P.top *= 1 - clamp(slope, -0.25, 0.25) * 0.6;
    }
    var target;
    if (this.autopilot > 0) { this.autopilot -= dt; target = this.autoTarget(P); }
    else target = this.isHolding() ? this.dirs().left : this.dirs().right;

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
    if (this.curSeg !== this.signSeg) this.roadSign();
    var wasAir = h.air;
    var impact = this.vertical(h, ground, dt);
    if (impact > 0) this.landed(impact);
    else if (impact < 0 && !wasAir) {
      this.stats.jumps++;
      var js = this.track.get(this.curSeg);
      this.bigAir = !!(js && js.feat && js.feat.big && ground && ground.along > js.feat.b - 3); // 大跳台：滞空时进入慢镜头
      this.notify('air', { big: this.bigAir });
    }
    if (h.air) this.airTime = (this.airTime || 0) + dt; else this.airTime = 0;

    // 掉崖判定：车身完全离开路面才算。离开后先按抛物线飞行，落回路面就没事
    if (!h.air && !ground && !this.touchesTrack()) {
      h.air = true;
      if (!wasAir) { this.stats.jumps++; this.notify('air', {}); }
    }
    if (h.air && (ground ? h.y < ground.h - 2.6 : h.y < this.track.floorNear(this.curSeg) - 2.5)) {
      this.edgeT = 0;
      if (this.shieldLeft > 0) this.revive();
      else { this.startFall(); return; }
    }
    // 极限救车：车身中心已经悬空、只靠边缘压着路面，最后又回到路上
    if (!h.air && !ground) this.edgeT = (this.edgeT || 0) + dt;
    else if (ground && !h.air && this.edgeT > 0.1) {
      var eb = Math.round(Math.max(3, DC.incomeOf(h.level) * 4) * (1 + this.edgeT * 4) * this.turbo * (this.doubleTimer > 0 ? 2 : 1));
      this.stats.coins += eb;
      this.stats.saves = (this.stats.saves || 0) + 1;
      this.notify('edge', { bonus: eb });
      this.edgeT = 0;
    } else if (ground) this.edgeT = 0;
    // 特殊路段效果
    var eff = ground ? ground.effect : null;
    if (eff === 'boost' && this.lastEffect !== 'boost') {
      this.boostTimer = 1.6;
      DC.Audio.boost();
      this.notify('boost', {});
    }
    if (eff === 'slick' && this.lastEffect !== 'slick') this.notify('slick', {});
    this.lastEffect = eff;
    this.updateGraze(dt, ground, o);
    if (this.autoCorner >= 0 && this.curSeg >= this.autoCorner) this.autoCorner = -1;

    this.track.extend(this.curSeg, h.level, 16);
    this.track.prune(this.curSeg);
    this.pushHistory();
    if (this.magnetTimer > 0) this.magnetTimer -= dt;
    if (this.doubleTimer > 0) this.doubleTimer -= dt;
    this.stats.coins += DC.incomeOf(h.level) * this.turbo * dt * (this.doubleTimer > 0 ? 2 : 1);

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
    this.updateCharge(dt, sliding, drift);
    // 氮气加速期间排气管持续喷蓝色火焰
    if (this.boostTimer > 0 && !DC.carOf(h.level).opts.ev) {
      var udb = h.mesh.userData, cab = Math.cos(h.bodyA), sab = Math.sin(h.bodyA), bk = -udb.length / 2 - 0.1;
      for (var bs = -1; bs <= 1; bs += 2) {
        this.fx.sparks.emit({ x: h.x + sab * bk + cab * bs * udb.width * 0.22, y: h.y + 0.35, z: h.z + cab * bk - sab * bs * udb.width * 0.22,
          vx: ph.vx * 0.9 - sab * rand(5, 10), vy: rand(-0.3, 0.6), vz: ph.vz * 0.9 - cab * rand(5, 10),
          s0: rand(0.4, 0.75), s1: 0.05, life: rand(0.08, 0.18), a: 1, r: 0.3, g: rand(0.6, 0.85), b: 1, fadeIn: 0.01 });
      }
    }
    this.drift = drift;
    this.tireEffects(dt, o, sliding);
    this.updateCombo(dt);
    this.haptics(dt);
    DC.Audio.update({ speedN: h.v / P.top, wheelN: (h.v + o.wheelSpin) / P.top, slip: h.air ? 0 : o.slipX,
      slideV: h.air ? 0 : o.slideV, surface: this.surfaceKey(), running: true, boost: this.boostTimer > 0, air: h.air });
  };

  var SPORTY = { hatch: 1, sedan: 1, muscle: 1, coupe: 1, mid: 1, hyper: 1 };

  // 进入新路段时的提示：前面是急弯或大跳台
  Game.prototype.roadSign = function () {
    this.signSeg = this.curSeg;
    var s = this.track.get(this.curSeg);
    if (!s || s.first) return;
    if (s.feat && s.feat.big) this.notify('sign', { text: '大跳台！', color: '#ffd34d' });
    else if (s.turn > 1.88) this.notify('sign', { text: '前方急弯', color: '#ff8a5c' });
  };

  // 贴边漂移：漂移时车身外侧已经探出路面，车还在路上。结束时给金币，并额外增加蓄力
  Game.prototype.updateGraze = function (dt, ground, o) {
    var h = this.head, on = false;
    if (ground && !h.air && o.slipX > 1 && Math.abs(o.beta) > 0.2 && h.v > 8) {
      var ud = h.mesh.userData, ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
      var side = o.beta > 0 ? 1 : -1; // 车身滑向的一侧（侧向速度的方向）
      var reach = ud.width * 0.5 + 0.55, back = -ud.length * 0.3;
      var px = h.x + sa * back + ca * side * reach, pz = h.z + ca * back - sa * side * reach;
      if (this.track.locate(px, pz, this.curSeg, 0) < 0) {
        on = true;
        this.grazeT += dt;
        this.charge.t = Math.min(2.0, this.charge.t + dt * 0.9);
        // 悬空一侧的后轮擦着路沿冒火花
        this.grazeAcc = (this.grazeAcc || 0) + dt * 90;
        var wx = h.x + sa * back + ca * side * ud.width * 0.42, wz = h.z + ca * back - sa * side * ud.width * 0.42;
        while (this.grazeAcc >= 1) {
          this.grazeAcc -= 1;
          this.fx.sparks.emit({ x: wx, y: h.y + 0.08, z: wz, vx: h.ph.vx * 0.4 + rand(-3, 3), vy: rand(2, 6), vz: h.ph.vz * 0.4 + rand(-3, 3),
            s0: rand(0.14, 0.26), s1: 0.03, life: rand(0.15, 0.4), a: 1, r: 1, g: rand(0.6, 0.9), b: 0.3, fadeIn: 0.01, grav: 16 });
        }
      }
    }
    if (!on && this.grazeT > 0) {
      if (this.grazeT > 0.12 && this.state === 'running' && (ground || !h.air)) {
        var bonus = Math.round(Math.max(2, DC.incomeOf(h.level) * 3) * (1 + this.grazeT * 5) * this.turbo * (this.doubleTimer > 0 ? 2 : 1));
        this.stats.coins += bonus;
        this.stats.grazes = (this.stats.grazes || 0) + 1;
        this.notify('graze', { bonus: bonus, t: this.grazeT });
      }
      this.grazeT = 0;
    }
  };

  // 漂移蓄力：侧滑时累积，连续过弯会一直叠加（蓝 → 橙 → 紫），直道上逐渐消退。
  // 每次回正抓地的瞬间按当前档位喷射加速
  var CHARGE_T = [0.25, 0.85, 1.55], CHARGE_MAX = 2.0;
  var CHARGE_C = [null, { r: 0.35, g: 0.75, b: 1, hex: '#59c2ff' }, { r: 1, g: 0.62, b: 0.15, hex: '#ffa02e' }, { r: 0.85, g: 0.4, b: 1, hex: '#d76bff' }];
  DC.CHARGE_COLORS = ['#ffffff', CHARGE_C[1].hex, CHARGE_C[2].hex, CHARGE_C[3].hex];
  DC.CHARGE_T = CHARGE_T;
  function stageOf(t) { return t >= CHARGE_T[2] ? 3 : t >= CHARGE_T[1] ? 2 : t >= CHARGE_T[0] ? 1 : 0; }
  Game.prototype.updateCharge = function (dt, sliding, drift) {
    var h = this.head, ch = this.charge;
    if (sliding && this.driftAngle > 10 && h.v > 8) {
      ch.t = Math.min(CHARGE_MAX, ch.t + dt * (0.8 + 0.4 * drift)); ch.off = 0; ch.live = true;
      var stg = stageOf(ch.t);
      if (stg > ch.stage) {
        DC.Audio.charge(stg);
        DC.vibrate(8 + stg * 6);
        var c = CHARGE_C[stg], ud = h.mesh.userData, ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA);
        for (var sd = -1; sd <= 1; sd += 2) {
          this.fx.burst(h.x - sa * ud.length * 0.32 + ca * sd * ud.width * 0.42, h.y + 0.3, h.z - ca * ud.length * 0.32 - sa * sd * ud.width * 0.42, c.hex, 10, 7);
        }
        this.notify('charge', { stage: stg });
      }
      ch.stage = stg;
      return;
    }
    if (ch.t <= 0) return;
    if (h.air) return; // 腾空时保留蓄力，落地后再结算
    ch.off += dt;
    // 直道上保持一小会儿，然后逐渐消退
    var stage = ch.stage;
    if (ch.off > 0.25) { ch.t = Math.max(0, ch.t - dt * 1.1); ch.stage = stageOf(ch.t); }
    if (!ch.live || ch.off < 0.09) return;
    ch.live = false;
    if (!stage) return;
    // 喷射：沿车头方向给一个速度增量，并在短时间内提高极速和加速度
    var ph = h.ph, kick = [0, 0.8, 1.5, 2.4][stage] + h.v * [0, 0.01, 0.02, 0.03][stage];
    ph.vx += Math.sin(ph.psi) * kick; ph.vz += Math.cos(ph.psi) * kick;
    this.turboTimer = [0, 0.5, 0.75, 1.0][stage];
    this.turboK = [0, 0.06, 0.1, 0.15][stage];
    this.turboStage = stage;
    this.stats.turbos = (this.stats.turbos || 0) + 1;
    if (stage === 3) this.stats.turbo3 = (this.stats.turbo3 || 0) + 1;
    var bonus = Math.round(Math.max(1, DC.incomeOf(h.level)) * [0, 1, 2, 4][stage] * this.turbo * (this.doubleTimer > 0 ? 2 : 1));
    this.stats.coins += bonus;
    this.fovKick = stage * 3.2; this.camKick = stage * 1.1;
    if (this.sus) this.sus.pitchV -= 0.5 + stage * 0.35; // 车尾下蹲
    this.shake = Math.max(this.shake || 0, 0.08 + stage * 0.06);
    this.turboFlame(stage);
    DC.Audio.turbo(stage);
    DC.vibrate(stage === 3 ? [30, 20, 50] : 18 + stage * 10);
    this.notify('turbo', { stage: stage, bonus: bonus });
  };
  // 喷射瞬间排气管喷出对应颜色的火焰
  Game.prototype.turboFlame = function (stage) {
    var h = this.head, ud = h.mesh.userData, ca = Math.cos(h.bodyA), sa = Math.sin(h.bodyA), c = CHARGE_C[stage];
    var back = -ud.length / 2 - 0.1;
    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var x = h.x + sa * back + ca * s2 * ud.width * 0.22, z = h.z + ca * back - sa * s2 * ud.width * 0.22;
      for (var i = 0; i < 6 + stage * 5; i++) {
        this.fx.sparks.emit({ x: x, y: h.y + 0.35, z: z,
          vx: h.ph.vx * 0.8 - sa * rand(5, 14) + ca * rand(-1.5, 1.5), vy: rand(-0.4, 1.4), vz: h.ph.vz * 0.8 - ca * rand(5, 14) - sa * rand(-1.5, 1.5),
          s0: rand(0.45, 0.9) * (1 + stage * 0.15) * this.badgeScale(), s1: 0.05, life: rand(0.12, 0.3), a: 1, r: c.r, g: c.g, b: c.b, fadeIn: 0.01 });
      }
    }
    this.fx.shockwave(h.x - sa * ud.length * 0.5, h.y, h.z - ca * ud.length * 0.5, c.hex, 4 + stage * 2.5, 0.3);
  };

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
    var alt = target > 0 ? this.dirs().right : this.dirs().left; // 反方向
    var pos = this.guide.geometry.attributes.position.array, col = this.guide.geometry.attributes.color.array;
    var off = false, seg = this.curSeg, hw = 0.32, lastY = h.y;
    for (var i = 0; i < GUIDE_N; i++) {
      if (i > 0) for (var k = 0; k < 4; k++) DC.Physics.step(st, PP, alt, 1 / 100);
      var sp = Math.sqrt(st.vx * st.vx + st.vz * st.vz) || 1;
      var nx = st.vz / sp, nz = -st.vx / sp;
      var gi = this.track.locate(st.x, st.z, seg, 0);
      if (gi >= 0) seg = gi; else off = true;
      if (gi >= 0) { var sg = this.track.get(gi); var hh = this.track.heightAt(sg, this.track.localOf(sg, st.x, st.z).along); if (hh !== null) lastY = hh; }
      var gy = lastY + 0.06;
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
    var acc = this.fxAcc || (this.fxAcc = { s: [0, 0], d: [0, 0], k: [0, 0] });
    var cs = sliding && this.charge ? this.charge.stage : 0, cc = CHARGE_C[cs];
    var vs = this.badgeScale(); // 等级越高镜头越远，火花和烟相应放大
    var light = this.world.cur ? clamp(0.3 + (this.world.cur.sunI + this.world.cur.hemiI) * 0.4, 0.45, 1.1) : 1;
    this.fx.setLight(light);
    var tw = 0.22 + W * 0.05;
    var slope = h.air ? 0 : clamp(h.vy / Math.max(h.v, 6), -0.5, 0.5); // 路面坡度，胎痕贴着坡面
    for (var wI = 0; wI < 4; wI++) {
      var rear = wI < 2, side = wI % 2 ? 1 : -1, key = (rear ? 'r' : 'f') + side;
      var fwd = rear ? -L * 0.32 : L * 0.3;
      var wx = h.x + sa * fwd + ca * side * W * 0.42;
      var wz = h.z + ca * fwd - sa * side * W * 0.42;
      var on = rear ? rearOn : (!h.air && sliding && Math.abs(o.beta) > 0.3);
      if (!on) { this.fx.endMark(key); continue; }
      var alpha = Math.min(0.92, F.markA * 1.3 * (0.5 + 0.5 * e)) * (rear ? 1 : 0.6);
      var wy = h.y + slope * (rear ? -L * 0.32 : L * 0.3) * Math.cos(o.beta || 0);
      this.fx.mark(key, wx, wy, wz, ca, -sa, tw, F.markC, alpha);
      if (!rear) continue;
      if (cs) {
        acc.k[wI] += (50 + cs * 35) * dt;
        while (acc.k[wI] >= 1) {
          acc.k[wI] -= 1;
          this.fx.sparks.emit({ x: wx + rand(-0.15, 0.15), y: h.y + 0.08, z: wz + rand(-0.15, 0.15),
            vx: ph.vx * 0.35 + ca * w * rand(0.15, 0.5) - sa * rand(0, 4), vy: rand(1.5, 4.5 + cs), vz: ph.vz * 0.35 - sa * w * rand(0.15, 0.5) - ca * rand(0, 4),
            s0: rand(0.16, 0.3) * (1 + cs * 0.2) * vs, s1: 0.03, life: rand(0.14, 0.34), a: 1, r: cc.r, g: cc.g, b: cc.b, fadeIn: 0.01, grav: 14 });
        }
      }
      acc.s[wI] += F.smoke * e * 60 * dt;
      acc.d[wI] += F.debris * e * 70 * dt;
      while (acc.s[wI] >= 1) {
        acc.s[wI] -= 1;
        this.fx.puff(wx, h.y + 0.25, wz, ph.vx * 0.22, ph.vz * 0.22, F.smokeS * (0.7 + 0.3 * vs), F.smokeC, e);
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
    var coins = Math.round(c.points * DC.incomeOf(this.head.level) * 0.025 * this.turbo * (this.doubleTimer > 0 ? 2 : 1));
    if (coins > 0) {
      this.stats.coins += coins;
      this.stats.driftPoints = (this.stats.driftPoints || 0) + c.points;
      this.notify('comboBank', { points: c.points, mult: c.mult, coins: coins });
    }
    this.combo = { active: false, points: 0, mult: 1, idle: 0, drifting: false, cur: 0 };
  };
  Game.prototype.loseCombo = function () {
    if (this.combo && this.combo.active && this.stats) this.stats.driftPoints = (this.stats.driftPoints || 0) + this.combo.points;
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
    this.bigAir = false;
    if (this.airTime > 0.55 && this.state === 'running') {
      var ab = Math.round(Math.max(2, DC.incomeOf(h.level) * 4) * this.airTime * this.turbo * (this.doubleTimer > 0 ? 2 : 1));
      this.stats.coins += ab;
      this.stats.airBest = Math.max(this.stats.airBest || 0, this.airTime);
      this.notify('airBonus', { air: this.airTime, bonus: ab });
    }
    if (this.sus) { this.sus.heaveV -= Math.min(6, impact * 0.35); this.sus.pitchV += Math.min(2, impact * 0.08); }
    if (impact > 6) {
      this.shake = Math.min(0.6, impact * 0.03);
      DC.Audio.land(impact);
      DC.vibrate(Math.round(20 + impact * 3));
      for (var i = 0; i < 8; i++) this.fx.puff(h.x + rand(-1, 1), h.y + 0.2, h.z + rand(-1, 1), rand(-4, 4), rand(-4, 4), 1.4, this.smokeColor());
      this.fx.shockwave(h.x, h.y, h.z, this.smokeColor(), 6 + impact * 0.5, 0.4);
      this.notify('land', { air: this.airTime, impact: impact });
    }
  };

  Game.prototype.update = function (dt) {
    this.time += dt;
    var h = this.head;
    DC.updateCarFx(this.time);

    if (this.state === 'menu') {
      if (this.orbitHold > 0) this.orbitHold -= dt; else this.orbit += dt * 0.25;
      if (h.mesh) {
        h.mesh.position.set(h.x, 0, h.z);
        h.mesh.rotation.set(0, h.bodyA, 0);
        if (h.pop > 0) { h.pop = Math.max(0, h.pop - dt * 3); var ps = 1 + h.pop * 0.25; h.mesh.scale.set(ps, ps, ps); }
      }
      var ud = h.mesh ? h.mesh.userData : { length: 4.5, height: 1.4 };
      var r = (this.orbitRadius || 9.5) * (this.orbitZoom || 1) * Math.max(1, Math.pow(Math.max(ud.length, ud.height * 2.2) / 4.6, 0.85));
      this.camera.position.set(h.x + Math.sin(this.orbit) * r, ud.height * 0.9 + r * 0.22, h.z + Math.cos(this.orbit) * r);
      this.camLook.set(h.x, ud.height * 0.45, h.z);
      this.camera.lookAt(this.camLook);
      if (this.camera.fov !== 45) { this.camera.fov = 45; this.camera.updateProjectionMatrix(); }
      this.world.followSun(h.x, h.z);
      this.world.update(dt, this.camera);
      this.track.syncThemeMats(dt);
      this.fx.update(dt);
      this.updateBeam();
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
      // 大跳台滞空：短暂的慢镜头
      var slow = this.bigAir && h.air && this.airTime > 0.1 && DC.Save.data.settings.camFx !== false ? 0.5 : 1;
      this.airScale += (slow - this.airScale) * damp(slow < this.airScale ? 10 : 5, dt);
      if (this.airScale < 0.995) dt *= this.airScale;
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
        var pitchT = h.air ? clamp(-h.vy * 0.02, -0.35, 0.35) : clamp(-Math.atan2(h.vy, Math.max(h.v, 6)) - (h.lonA || 0) * 0.0022, -0.4, 0.4);
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
    this.updateItems(dt);
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
    var camFx = DC.Save.data.settings.camFx !== false;
    var dr = camFx ? (this.drift || 0) : 0;
    // 漂移时镜头压低贴近，喷射时被甩在后面再追上
    this.camDr = (this.camDr || 0) + (dr - (this.camDr || 0)) * damp(dr > (this.camDr || 0) ? 5 : 2, dt);
    if (this.camKick > 0.01) this.camKick *= Math.exp(-2.6 * dt); else this.camKick = 0;
    if (this.fovKick > 0.01) this.fovKick *= Math.exp(-2.2 * dt); else this.fovKick = 0;
    var airT = camFx && h.air && this.state === 'running' ? Math.min(1, (this.airTime || 0) * 2.2) : 0;
    this.camAir = (this.camAir || 0) + (airT - (this.camAir || 0)) * damp(airT > (this.camAir || 0) ? 4 : 2.5, dt);
    var lowK = 1 - 0.1 * this.camDr + 0.22 * this.camAir;
    var back = (14 + sf * 11) * big * (1 - 0.06 * this.camDr) + (camFx ? this.camKick : 0), up = (12 + sf * 9) * big * lowK, ahead = 10 + sf * 14;
    back *= 1 + 0.12 * this.camAir;
    var asp = cam.aspect;
    if (asp < 1.3) {
      var k = Math.pow(Math.min(2.2, 1.3 / asp), 0.75);
      back *= k; up *= k; ahead *= k;
    }
    if (!this.camInit) { this.camX = h.x; this.camZ = h.z; this.camY = h.y; this.groundY = h.y; this.camInit = true; }
    this.camX += (h.x - this.camX) * damp(2.6, dt);
    this.camZ += (h.z - this.camZ) * damp(10, dt);
    if (!h.air) this.groundY = h.y;
    var gy = this.groundY || 0;
    this.camY += (gy + (h.y - gy) * 0.5 - this.camY) * damp(3, dt);
    // 漂移时镜头：向滑动方向偏移、轻微侧倾、平滑震动
    var beta = camFx && this.state === 'running' && !h.air ? wrapAngle(h.bodyA - h.velA) : 0;
    this.camSlide = (this.camSlide || 0) + (clamp(-Math.sin(beta) * 3, -2.2, 2.2) - (this.camSlide || 0)) * damp(2.5, dt);
    this.camRoll = (this.camRoll || 0) + (clamp(beta * 0.1, -0.075, 0.075) - (this.camRoll || 0)) * damp(3.5, dt);
    var shake = 0;
    if (this.shake > 0) { this.shake -= dt; shake = camFx ? this.shake * 0.6 : 0; }
    // 接近极速和加速时的高频抖动
    var fast = camFx && this.state === 'running' ? clamp((h.v / DC.speedOf(h.level) - 0.92) * 6, 0, 1) * 0.025 + (this.boostTimer > 0 || this.turboTimer > 0 ? 0.035 : 0) : 0;
    var t = this.time, amp = shake + dr * 0.07 + fast;
    var sx = (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.7) * 0.4) * amp;
    var sy = (Math.sin(t * 41.3) * 0.5 + Math.sin(t * 19.9) * 0.5) * amp;
    cam.position.set(this.camX + this.camSlide + sx, this.camY + up + sy, this.camZ - back);
    this.camLook.set(this.camX * 0.6 + h.x * 0.4 + this.camSlide * 0.4, this.camY, this.camZ + ahead);
    cam.lookAt(this.camLook);
    cam.rotateZ(this.camRoll);
    this.fovDrift = (this.fovDrift || 0) + (dr * 4 - (this.fovDrift || 0)) * damp(2, dt);
    var fov = 55 + sf * 14 + (this.boostTimer > 0 ? 8 : 0) + this.fovDrift + (camFx ? this.fovKick || 0 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * damp(fov > cam.fov ? 7 : 3, dt); cam.updateProjectionMatrix(); }
  };

  DC.Game = Game;
})(window.DC);
