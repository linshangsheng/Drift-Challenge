/* 特效：合批粒子（烟雾/飞溅/火花）、连续胎痕带 */
(function (DC) {
  'use strict';
  var T = THREE;

  function canvasTex(size, draw) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    var t = new T.CanvasTexture(cv);
    return t;
  }
  // 蓬松的烟团贴图（多个柔和圆斑叠加）
  function smokeTexture() {
    return canvasTex(128, function (x, S) {
      x.clearRect(0, 0, S, S);
      for (var i = 0; i < 14; i++) {
        var a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.18;
        var px = S / 2 + Math.cos(a) * d, py = S / 2 + Math.sin(a) * d, r = S * (0.18 + Math.random() * 0.16);
        var g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, S, S);
      }
    });
  }
  function dotTexture() {
    return canvasTex(64, function (x, S) {
      var g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, S, S);
    });
  }

  var VERT = [
    'attribute vec3 center; attribute vec2 corner; attribute vec4 pcol; attribute vec2 sr;',
    'varying vec2 vUv; varying vec4 vCol;',
    '#include <fog_pars_vertex>',
    'void main(){',
    '  vUv = corner + 0.5; vCol = pcol;',
    '  vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);',
    '  float c = cos(sr.y), s = sin(sr.y);',
    '  mvPosition.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * sr.x;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');
  var FRAG = [
    'uniform sampler2D map; uniform float light;',
    'varying vec2 vUv; varying vec4 vCol;',
    '#include <fog_pars_fragment>',
    'void main(){',
    '  vec4 t = texture2D(map, vUv);',
    '  gl_FragColor = vec4(vCol.rgb * light, t.a * vCol.a);',
    '  if (gl_FragColor.a < 0.004) discard;',
    '  #include <encodings_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  // 合批粒子系统：所有粒子一次绘制
  function Particles(scene, max, tex, additive) {
    this.max = max;
    this.next = 0;
    var g = new T.BufferGeometry();
    var center = new Float32Array(max * 12), corner = new Float32Array(max * 8), col = new Float32Array(max * 16), sr = new Float32Array(max * 8);
    var idx = [];
    var cs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for (var i = 0; i < max; i++) {
      for (var k = 0; k < 4; k++) { corner[(i * 4 + k) * 2] = cs[k][0]; corner[(i * 4 + k) * 2 + 1] = cs[k][1]; }
      var b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('center', new T.BufferAttribute(center, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('corner', new T.BufferAttribute(corner, 2));
    g.setAttribute('pcol', new T.BufferAttribute(col, 4).setUsage(T.DynamicDrawUsage));
    g.setAttribute('sr', new T.BufferAttribute(sr, 2).setUsage(T.DynamicDrawUsage));
    // 位置属性只用于包围盒，设为很大避免被裁剪
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(max * 12), 3));
    g.setIndex(idx);
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e7);
    this.mat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { map: { value: tex }, light: { value: 1 } }]),
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      blending: additive ? T.AdditiveBlending : T.NormalBlending
    });
    this.mesh = new T.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.geo = g;
    this.p = [];
    for (var j = 0; j < max; j++) this.p.push({ life: 0 });
  }
  Particles.prototype.emit = function (o) {
    var p = this.p[this.next];
    this.next = (this.next + 1) % this.max;
    p.life = p.max = o.life;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.s0 = o.s0; p.s1 = o.s1; p.a = o.a;
    p.r = o.r || 0; p.g = o.g || 0; p.b = o.b || 0;
    p.rot = Math.random() * 6.28; p.spin = (Math.random() - 0.5) * (o.spin || 1.5);
    p.grav = o.grav || 0; p.drag = o.drag || 0; p.lift = o.lift || 0;
    p.fadeIn = o.fadeIn || 0.08; p.ground = o.ground; p.linger = !!o.linger;
  };
  Particles.prototype.clear = function () { for (var i = 0; i < this.max; i++) this.p[i].life = 0; };
  Particles.prototype.update = function (dt) {
    var c = this.geo.attributes.center.array, col = this.geo.attributes.pcol.array, sr = this.geo.attributes.sr.array;
    for (var i = 0; i < this.max; i++) {
      var p = this.p[i], ci = i * 12, oi = i * 16, si = i * 8, k;
      if (p.life <= 0) {
        if (col[oi + 3] !== 0) for (k = 0; k < 4; k++) col[oi + k * 4 + 3] = 0;
        continue;
      }
      p.life -= dt;
      var t = 1 - Math.max(0, p.life) / p.max;
      var dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.grav * dt + p.lift * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.ground !== undefined && p.y < p.ground) { p.y = p.ground; p.vy *= -0.25; p.vx *= 0.6; p.vz *= 0.6; }
      p.rot += p.spin * dt;
      var size = p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - t, 2.2));
      var alpha = p.a * Math.min(1, t / p.fadeIn) * (p.linger ? (1 - t * t) : (1 - t) * (1 - t * 0.3));
      if (p.life <= 0) alpha = 0;
      for (k = 0; k < 4; k++) {
        c[ci + k * 3] = p.x; c[ci + k * 3 + 1] = p.y; c[ci + k * 3 + 2] = p.z;
        col[oi + k * 4] = p.r; col[oi + k * 4 + 1] = p.g; col[oi + k * 4 + 2] = p.b; col[oi + k * 4 + 3] = alpha;
        sr[si + k * 2] = size; sr[si + k * 2 + 1] = p.rot;
      }
    }
    this.geo.attributes.center.needsUpdate = true;
    this.geo.attributes.pcol.needsUpdate = true;
    this.geo.attributes.sr.needsUpdate = true;
  };

  // ---------- 连续胎痕带 ----------
  var MARK_VERT = [
    'attribute vec4 mcol; attribute float birth;',
    'uniform float now; uniform float fade;',
    'varying vec4 vCol;',
    '#include <fog_pars_vertex>',
    'void main(){',
    '  float age = now - birth;',
    '  vCol = vec4(mcol.rgb, mcol.a * clamp(1.0 - age / fade, 0.0, 1.0));',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');
  var MARK_FRAG = [
    'varying vec4 vCol;',
    '#include <fog_pars_fragment>',
    'void main(){',
    '  gl_FragColor = vCol;',
    '  #include <encodings_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');

  function Marks(scene, max) {
    this.max = max; this.next = 0; this.time = 0;
    var g = new T.BufferGeometry();
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 16);
    this.birth = new Float32Array(max * 4);
    var idx = [];
    for (var i = 0; i < max; i++) { var b = i * 4; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('mcol', new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage));
    g.setAttribute('birth', new T.BufferAttribute(this.birth, 1).setUsage(T.DynamicDrawUsage));
    g.setIndex(idx);
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e7);
    this.mat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { now: { value: 0 }, fade: { value: 14 } }]),
      vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, transparent: true, depthWrite: false, fog: true,
      side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8
    });
    this.mesh = new T.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.geo = g;
    this.last = {};
    this.dirty = false;
  }
  // 每个轮子一条连续印带：key 区分轮子
  Marks.prototype.add = function (key, x, y, z, ax, az, width, color, alpha) {
    var L = this.last[key];
    var hx = ax * width / 2, hz = az * width / 2; // 左右边缘偏移（垂直于行进方向）
    var cur = { lx: x + hx, lz: z + hz, rx: x - hx, rz: z - hz, y: y, x: x, z: z };
    if (!L) { this.last[key] = cur; return; }
    var dx = x - L.x, dz = z - L.z, d2 = dx * dx + dz * dz;
    if (d2 < 0.16) return;
    if (d2 > 36 || Math.abs(y - L.y) > 1) { this.last[key] = cur; return; }
    var i = this.next; this.next = (this.next + 1) % this.max;
    var p = this.pos, o = i * 12;
    p[o] = L.lx; p[o + 1] = L.y; p[o + 2] = L.lz;
    p[o + 3] = L.rx; p[o + 4] = L.y; p[o + 5] = L.rz;
    p[o + 6] = cur.lx; p[o + 7] = y; p[o + 8] = cur.lz;
    p[o + 9] = cur.rx; p[o + 10] = y; p[o + 11] = cur.rz;
    for (var k = 0; k < 4; k++) {
      this.col[i * 16 + k * 4] = color.r; this.col[i * 16 + k * 4 + 1] = color.g; this.col[i * 16 + k * 4 + 2] = color.b;
      this.col[i * 16 + k * 4 + 3] = alpha;
      this.birth[i * 4 + k] = this.time;
    }
    this.last[key] = cur;
    this.dirty = true;
  };
  Marks.prototype.end = function (key) { if (key === undefined) this.last = {}; else delete this.last[key]; };
  Marks.prototype.clear = function () {
    for (var i = 0; i < this.col.length; i += 4) this.col[i + 3] = 0;
    this.geo.attributes.mcol.needsUpdate = true;
    this.last = {};
  };
  Marks.prototype.update = function (dt) {
    this.time += dt;
    this.mat.uniforms.now.value = this.time;
    if (this.dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.mcol.needsUpdate = true;
      this.geo.attributes.birth.needsUpdate = true;
      this.dirty = false;
    }
  };

  // ---------- 对外接口 ----------
  var tmpC = new T.Color();
  function Effects(scene) {
    this.scene = scene;
    this.smoke = new Particles(scene, 520, smokeTexture(), false);
    this.spray = new Particles(scene, 420, dotTexture(), false);
    this.sparks = new Particles(scene, 260, dotTexture(), true);
    this.marks = new Marks(scene, 2600);
    // 冲击波光环（升级、合成时在地面扩散）
    var cv = document.createElement('canvas'); cv.width = cv.height = 128;
    var x = cv.getContext('2d'), g = x.createRadialGradient(64, 64, 38, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    var tex = new T.CanvasTexture(cv), geo = new T.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (var i = 0; i < 6; i++) {
      var m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending,
        toneMapped: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }));
      m.visible = false; m.renderOrder = 4;
      scene.add(m);
      this.rings.push({ m: m, t: 1, dur: 1, size: 1 });
    }
    this.ringNext = 0;
  }
  Effects.prototype.shockwave = function (x, y, z, color, size, dur) {
    var r = this.rings[this.ringNext++ % this.rings.length];
    r.m.material.color.set(color);
    r.m.position.set(x, y + 0.08, z);
    r.t = 0; r.dur = dur || 0.6; r.size = size || 14;
    r.m.visible = true;
  };

  Effects.prototype.clear = function () {
    this.rings.forEach(function (r) { r.t = r.dur; r.m.visible = false; });
    this.smoke.clear(); this.spray.clear(); this.sparks.clear(); this.marks.clear();
  };

  // 轮胎烟雾：intensity 0~1，carryX/Z 为车速带动的初速度
  Effects.prototype.puff = function (x, y, z, vx, vz, size, color, intensity) {
    tmpC.set(color || '#d8d8d8');
    var it = intensity === undefined ? 0.6 : intensity;
    this.smoke.emit({
      x: x + (Math.random() - 0.5) * 0.3, y: y, z: z + (Math.random() - 0.5) * 0.3,
      vx: vx + (Math.random() - 0.5) * 2.5, vy: 0.6 + Math.random() * 1.2, vz: vz + (Math.random() - 0.5) * 2.5,
      s0: (size || 1) * 1.3, s1: (size || 1) * (3.5 + it * 3.5), life: 1.0 + it * 1.8 + Math.random() * 0.5,
      a: 0.22 + it * 0.33, r: tmpC.r, g: tmpC.g, b: tmpC.b, drag: 1.8, lift: 0.5, spin: 1.2, fadeIn: 0.03, linger: true
    });
  };
  // 路面飞溅物（雪、沙、水花、冰屑）
  Effects.prototype.debris = function (x, y, z, vx, vz, color, n, size, opts) {
    tmpC.set(color);
    opts = opts || {};
    for (var i = 0; i < n; i++) {
      this.spray.emit({
        x: x, y: y + 0.1, z: z,
        vx: vx + (Math.random() - 0.5) * (opts.spread || 4), vy: (opts.up || 3) * (0.5 + Math.random()), vz: vz + (Math.random() - 0.5) * (opts.spread || 4),
        s0: size * (0.6 + Math.random() * 0.6), s1: size * (opts.grow || 1.3), life: (opts.life || 0.6) * (0.6 + Math.random() * 0.8),
        a: opts.alpha || 0.9, r: tmpC.r, g: tmpC.g, b: tmpC.b, grav: opts.grav === undefined ? 22 : opts.grav, drag: opts.drag || 1.2,
        ground: y + 0.05, spin: 4, fadeIn: 0.02
      });
    }
  };
  Effects.prototype.burst = function (x, y, z, color, n, speed) {
    tmpC.set(color);
    for (var i = 0; i < (n || 30); i++) {
      var a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = (speed || 10) * (0.4 + Math.random() * 0.8);
      this.sparks.emit({
        x: x, y: y, z: z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 3, vz: Math.sin(a) * Math.cos(e) * sp,
        s0: 0.5 + Math.random() * 0.7, s1: 0.1, life: 0.5 + Math.random() * 0.6, a: 1, r: tmpC.r, g: tmpC.g, b: tmpC.b, grav: 18, fadeIn: 0.01
      });
    }
  };
  // 胎痕：key 区分轮子，(ax, az) 为横向单位向量
  Effects.prototype.mark = function (key, x, y, z, ax, az, width, color, alpha) {
    tmpC.set(color);
    this.marks.add(key, x, y + 0.03, z, ax, az, width, tmpC, alpha);
  };
  Effects.prototype.endMark = function (key) { this.marks.end(key); };
  // 兼容旧接口
  Effects.prototype.skid = function (wheelIdx, x, z, y) { this.mark('w' + wheelIdx, x, y || 0, z, 1, 0, 0.3, '#000000', 0.5); };
  Effects.prototype.endSkid = function () { this.marks.end(); };

  Effects.prototype.setLight = function (l) {
    this.smoke.mat.uniforms.light.value = l;
  };

  Effects.prototype.update = function (dt) {
    this.smoke.update(dt);
    this.spray.update(dt);
    this.sparks.update(dt);
    this.marks.update(dt);
    for (var i = 0; i < this.rings.length; i++) {
      var r = this.rings[i];
      if (!r.m.visible) continue;
      r.t += dt;
      var k = r.t / r.dur;
      if (k >= 1) { r.m.visible = false; continue; }
      var s = r.size * (0.15 + 0.85 * (1 - Math.pow(1 - k, 3)));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = 0.85 * (1 - k);
    }
  };

  DC.Effects = Effects;
})(window.DC);
