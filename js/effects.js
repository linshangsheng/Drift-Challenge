/* 特效：轮胎烟雾、刹车痕、合成火花 */
(function (DC) {
  'use strict';
  var T = THREE;

  function softTexture() {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var x = cv.getContext('2d');
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(cv);
  }

  function Effects(scene) {
    this.scene = scene;
    var tex = softTexture();

    this.smoke = [];
    for (var i = 0; i < 90; i++) {
      var m = new T.SpriteMaterial({ map: tex, color: '#dddddd', transparent: true, opacity: 0, depthWrite: false });
      var s = new T.Sprite(m);
      s.visible = false;
      scene.add(s);
      this.smoke.push({ s: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
    }
    this.smokeNext = 0;

    this.sparks = [];
    for (var j = 0; j < 160; j++) {
      var sm = new T.SpriteMaterial({ map: tex, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending });
      var sp = new T.Sprite(sm);
      sp.visible = false;
      scene.add(sp);
      this.sparks.push({ s: sp, life: 0, max: 1, vx: 0, vy: 0, vz: 0 });
    }
    this.sparkNext = 0;

    // 刹车痕
    this.skidGeo = new T.PlaneGeometry(0.32, 1);
    this.skidGeo.rotateX(-Math.PI / 2);
    this.skidMat = new T.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.skids = [];
    for (var k = 0; k < 500; k++) {
      var mesh = new T.Mesh(this.skidGeo, this.skidMat);
      mesh.visible = false;
      scene.add(mesh);
      this.skids.push(mesh);
    }
    this.skidNext = 0;
    this.lastSkid = [null, null];
  }

  Effects.prototype.clear = function () {
    this.smoke.forEach(function (p) { p.life = 0; p.s.visible = false; });
    this.sparks.forEach(function (p) { p.life = 0; p.s.visible = false; });
    this.skids.forEach(function (m) { m.visible = false; });
    this.lastSkid = [null, null];
  };

  Effects.prototype.puff = function (x, y, z, vx, vz, size, color) {
    var p = this.smoke[this.smokeNext++ % this.smoke.length];
    p.life = p.max = 0.7 + Math.random() * 0.5;
    p.s.position.set(x, y, z);
    p.vx = vx + (Math.random() - 0.5) * 2; p.vy = 0.8 + Math.random(); p.vz = vz + (Math.random() - 0.5) * 2;
    p.size = size || 1.2;
    p.s.material.color.set(color || '#d8d8d8');
    p.s.visible = true;
  };

  Effects.prototype.burst = function (x, y, z, color, n, speed) {
    for (var i = 0; i < (n || 30); i++) {
      var p = this.sparks[this.sparkNext++ % this.sparks.length];
      p.life = p.max = 0.5 + Math.random() * 0.6;
      p.s.position.set(x, y, z);
      var a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      var sp = (speed || 10) * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * Math.cos(e) * sp; p.vy = Math.sin(e) * sp + 3; p.vz = Math.sin(a) * Math.cos(e) * sp;
      p.s.material.color.set(color);
      p.size = 0.5 + Math.random() * 0.7;
      p.s.visible = true;
    }
  };

  // 在轮胎位置画一段刹车痕（wheelIdx 0/1 两个后轮）
  Effects.prototype.skid = function (wheelIdx, x, z, y) {
    var last = this.lastSkid[wheelIdx];
    if (!last) { this.lastSkid[wheelIdx] = { x: x, z: z }; return; }
    var dx = x - last.x, dz = z - last.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.6) return;
    if (d > 6) { this.lastSkid[wheelIdx] = { x: x, z: z }; return; }
    var m = this.skids[this.skidNext++ % this.skids.length];
    m.position.set((x + last.x) / 2, (y || 0) + 0.035, (z + last.z) / 2);
    m.rotation.y = Math.atan2(dx, dz);
    m.scale.set(1, 1, d);
    m.visible = true;
    last.x = x; last.z = z;
  };
  Effects.prototype.endSkid = function () { this.lastSkid = [null, null]; };

  Effects.prototype.update = function (dt) {
    var i, p;
    for (i = 0; i < this.smoke.length; i++) {
      p = this.smoke[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      var k = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.vx *= 0.94; p.vz *= 0.94;
      var sz = p.size * (1 + k * 3);
      p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = 0.5 * (1 - k);
    }
    for (i = 0; i < this.sparks.length; i++) {
      p = this.sparks[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      var q = p.life / p.max;
      p.vy -= 18 * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.scale.set(p.size * q + 0.1, p.size * q + 0.1, 1);
      p.s.material.opacity = q;
    }
  };

  DC.Effects = Effects;
})(window.DC);
