/* 环境：天空、云海、远山、星空、灯光、主题切换 */
(function (DC) {
  'use strict';
  var T = THREE;

  function cloudTexture() {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    var x = cv.getContext('2d');
    x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 260; i++) {
      var px = Math.random() * 512, py = Math.random() * 512, r = 20 + Math.random() * 70;
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var g = x.createRadialGradient(px + dx * 512, py + dy * 512, 0, px + dx * 512, py + dy * 512, r);
        var a = 0.12 + Math.random() * 0.15;
        g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(px + dx * 512 - r, py + dy * 512 - r, r * 2, r * 2);
      }
    }
    var t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(10, 10);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  function World(scene) {
    this.scene = scene;
    var th = DC.THEMES[0];
    this.themeIdx = 0;
    this.cur = {};
    var self = this;
    ['skyTop', 'skyBottom', 'fog', 'sun', 'hemiSky', 'hemiGround', 'cloud', 'mountain', 'rock', 'asphalt', 'edge'].forEach(function (k) {
      self.cur[k] = new T.Color(th[k]);
    });
    this.cur.sunI = th.sunI; this.cur.hemiI = th.hemiI; this.cur.edgeGlow = th.edgeGlow; this.cur.stars = th.stars; this.cur.env = th.env; this.cur.aurora = th.aurora; this.cur.sunSize = th.sunSize;

    scene.fog = new T.Fog(this.cur.fog.clone(), 80, 520);

    // 天空球
    this.skyMat = new T.ShaderMaterial({
      uniforms: { top: { value: this.cur.skyTop.clone() }, bottom: { value: this.cur.skyBottom.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)),1.0); \n#include <encodings_fragment>\n}',
      side: T.BackSide, depthWrite: false, fog: false
    });
    this.sky = new T.Mesh(new T.SphereGeometry(950, 24, 16), this.skyMat);
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // 星空
    var sp = [];
    for (var i = 0; i < 700; i++) {
      var u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.05;
      var r = 900;
      sp.push(Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r);
    }
    var sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    this.starMat = new T.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new T.Points(sg, this.starMat);
    scene.add(this.stars);

    // 云海
    this.cloudTex = cloudTexture();
    this.cloudMat = new T.MeshBasicMaterial({ color: this.cur.cloud.clone(), map: this.cloudTex });
    this.cloud = new T.Mesh(new T.PlaneGeometry(3000, 3000), this.cloudMat);
    this.cloud.rotation.x = -Math.PI / 2;
    this.cloud.position.y = -60;
    scene.add(this.cloud);
    this.cloudTile = 300; // 3000 / repeat(10)

    // 远山
    this.mountainMat = new T.MeshStandardMaterial({ color: this.cur.mountain.clone(), flatShading: true, roughness: 1 });
    this.mountainGeo = new T.ConeGeometry(1, 1, 6, 1);
    this.mountainGeo.translate(0, 0.5, 0);
    // 远山用实例化网格，一次绘制
    this.mountains = [];
    this.mountainMesh = new T.InstancedMesh(this.mountainGeo, this.mountainMat, 70);
    this.mountainMesh.frustumCulled = false;
    scene.add(this.mountainMesh);
    for (var m = 0; m < 70; m++) {
      var mt = { idx: m, position: new T.Vector3() };
      this.mountains.push(mt);
      this.placeMountain(mt, 0, 0, true);
    }

    // 太阳 / 月亮
    var sunCv = document.createElement('canvas');
    sunCv.width = sunCv.height = 256;
    var sx = sunCv.getContext('2d');
    var sgd = sx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sgd.addColorStop(0, 'rgba(255,255,255,1)'); sgd.addColorStop(0.12, 'rgba(255,255,255,0.95)');
    sgd.addColorStop(0.2, 'rgba(255,255,255,0.4)'); sgd.addColorStop(0.5, 'rgba(255,255,255,0.1)'); sgd.addColorStop(1, 'rgba(255,255,255,0)');
    sx.fillStyle = sgd; sx.fillRect(0, 0, 256, 256);
    this.sunSprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(sunCv), color: this.cur.sun.clone(), fog: false,
      depthWrite: false, blending: T.AdditiveBlending, transparent: true }));
    this.sunSprite.renderOrder = -9;
    scene.add(this.sunSprite);

    // 极光：几条随时间摆动的光幕
    this.auroraMat = new T.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacity: { value: 0 } },
      vertexShader: [
        'uniform float time; varying vec2 vUv;',
        'void main(){ vUv = uv; vec3 p = position;',
        '  p.z += sin(p.x * 0.012 + time * 0.35) * 60.0 + sin(p.x * 0.031 - time * 0.2) * 25.0;',
        '  p.y += sin(p.x * 0.02 + time * 0.5) * 12.0;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform float time; uniform float opacity; varying vec2 vUv;',
        'void main(){',
        '  float band = 0.55 + 0.45 * sin(vUv.x * 40.0 + time * 0.8) * sin(vUv.x * 13.0 - time * 0.3);',
        '  float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);',
        '  vec3 c = mix(vec3(0.1, 1.0, 0.55), vec3(0.45, 0.3, 1.0), clamp(vUv.y * 1.3 + 0.2 * sin(vUv.x * 9.0 + time * 0.4), 0.0, 1.0));',
        '  gl_FragColor = vec4(c, fade * band * opacity * 0.75);',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false
    });
    this.aurora = new T.Group();
    for (var au = 0; au < 3; au++) {
      var am = new T.Mesh(new T.PlaneGeometry(1500, 300, 80, 1), this.auroraMat);
      am.position.set((au - 1) * 260, 330 + au * 50, 650 - au * 110);
      am.rotation.y = (au - 1) * 0.35;
      this.aurora.add(am);
    }
    this.aurora.renderOrder = -8;
    this.aurora.visible = false;
    scene.add(this.aurora);

    this.scenery = new DC.Scenery(scene);

    // 天气：跟随镜头的一团粒子（雪/沙尘/冰晶）和雨丝
    var WN = 420, wp = new Float32Array(WN * 3);
    this.wSeed = [];
    for (var w = 0; w < WN; w++) {
      wp[w * 3] = (Math.random() - 0.5) * 120; wp[w * 3 + 1] = Math.random() * 45 - 8; wp[w * 3 + 2] = Math.random() * 140 - 30;
      this.wSeed.push(Math.random());
    }
    var wg = new T.BufferGeometry();
    wg.setAttribute('position', new T.BufferAttribute(wp, 3).setUsage(T.DynamicDrawUsage));
    wg.boundingSphere = new T.Sphere(new T.Vector3(), 1e7);
    var fl = document.createElement('canvas'); fl.width = fl.height = 32;
    var fx2 = fl.getContext('2d'), fg = fx2.createRadialGradient(16, 16, 0, 16, 16, 16);
    fg.addColorStop(0, 'rgba(255,255,255,1)'); fg.addColorStop(0.5, 'rgba(255,255,255,0.5)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
    fx2.fillStyle = fg; fx2.fillRect(0, 0, 32, 32);
    this.flakeMat = new T.PointsMaterial({ map: new T.CanvasTexture(fl), size: 0.5, transparent: true, opacity: 0, depthWrite: false, color: '#ffffff', sizeAttenuation: true });
    this.flakes = new T.Points(wg, this.flakeMat);
    this.flakes.frustumCulled = false; this.flakes.renderOrder = 6;
    scene.add(this.flakes);
    var RN = 320, rp = new Float32Array(RN * 6);
    this.rainPos = [];
    for (var r2 = 0; r2 < RN; r2++) this.rainPos.push((Math.random() - 0.5) * 110, Math.random() * 45 - 8, Math.random() * 130 - 25);
    var rg = new T.BufferGeometry();
    rg.setAttribute('position', new T.BufferAttribute(rp, 3).setUsage(T.DynamicDrawUsage));
    rg.boundingSphere = new T.Sphere(new T.Vector3(), 1e7);
    this.rainMat = new T.LineBasicMaterial({ color: '#bcd0ff', transparent: true, opacity: 0, depthWrite: false });
    this.rain = new T.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false; this.rain.renderOrder = 6;
    scene.add(this.rain);
    this.weather = { flake: 0, rain: 0 };

    // 灯光
    this.hemi = new T.HemisphereLight(this.cur.hemiSky.clone(), this.cur.hemiGround.clone(), th.hemiI);
    scene.add(this.hemi);
    this.sun = new T.DirectionalLight(this.cur.sun.clone(), th.sunI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    var sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // 赛道材质（由主题控制颜色）
    this.mats = {
      asphalt: new T.MeshStandardMaterial({ color: this.cur.asphalt.clone(), roughness: 0.85 }),
      rock: new T.MeshStandardMaterial({ color: this.cur.rock.clone(), roughness: 1, flatShading: true }),
      edge: new T.MeshStandardMaterial({ color: this.cur.edge.clone(), emissive: this.cur.edge.clone(), emissiveIntensity: th.edgeGlow }),
      curbRed: new T.MeshStandardMaterial({ color: '#e03131', roughness: 0.7 }),
      curbWhite: new T.MeshStandardMaterial({ color: '#f1f1f1', roughness: 0.7 }),
      dash: new T.MeshStandardMaterial({ color: '#cfcfcf', roughness: 0.8, transparent: true, opacity: 0.6 })
    };
    this.mats.top = [this.mats.rock, this.mats.rock, this.mats.asphalt, this.mats.rock, this.mats.rock, this.mats.rock];
  }

  var mtx = new T.Matrix4(), mq = new T.Quaternion(), msc = new T.Vector3(), yAxis = new T.Vector3(0, 1, 0);
  World.prototype.placeMountain = function (mesh, cx, cz, initial) {
    var side = Math.random() < 0.5 ? -1 : 1;
    var r = 30 + Math.random() * 70;
    var x = side * (r + 150 + Math.random() * 330); // 放在赛道横向活动范围之外
    var z = initial ? cz - 100 + Math.random() * 800 : cz + 550 + Math.random() * 250;
    var h = 50 + Math.random() * 150;
    mesh.position.set(x, -75, z);
    mtx.compose(mesh.position, mq.setFromAxisAngle(yAxis, Math.random() * Math.PI), msc.set(r, h, r));
    this.mountainMesh.setMatrixAt(mesh.idx, mtx);
    this.mountainMesh.instanceMatrix.needsUpdate = true;
  };

  World.prototype.setThemeByLevel = function (level, instant) {
    this.themeIdx = DC.themeIndexOf(level);
    if (instant) this.update(100, null, true);
  };

  World.prototype.resetMountains = function (cx, cz) {
    for (var i = 0; i < this.mountains.length; i++) this.placeMountain(this.mountains[i], cx, cz, true);
    this.scenery.reset(cx, cz, this.themeIdx);
  };

  var tmpC = new T.Color();
  World.prototype.update = function (dt, cam, instant) {
    var th = DC.THEMES[this.themeIdx];
    var k = instant ? 1 : Math.min(1, dt * 0.8);
    var c = this.cur;
    for (var key in c) {
      if (c[key] && c[key].isColor) c[key].lerp(tmpC.set(th[key]), k);
      else c[key] += (th[key] - c[key]) * k;
    }
    this.skyMat.uniforms.top.value.copy(c.skyTop);
    this.skyMat.uniforms.bottom.value.copy(c.skyBottom);
    this.scene.fog.color.copy(c.fog);
    this.hemi.color.copy(c.hemiSky); this.hemi.groundColor.copy(c.hemiGround); this.hemi.intensity = c.hemiI;
    this.sun.color.copy(c.sun); this.sun.intensity = c.sunI;
    this.cloudMat.color.copy(c.cloud);
    this.mountainMat.color.copy(c.mountain);
    this.mats.asphalt.color.copy(c.asphalt);
    this.mats.rock.color.copy(c.rock);
    this.mats.edge.color.copy(c.edge); this.mats.edge.emissive.copy(c.edge); this.mats.edge.emissiveIntensity = c.edgeGlow;
    this.starMat.opacity = c.stars;
    if (DC.carMaterials) {
      var cm = DC.carMaterials();
      cm.paint.envMapIntensity = c.env; cm.chrome.envMapIntensity = c.env * 1.2; cm.glass.envMapIntensity = c.env * 1.3; cm.matte.envMapIntensity = c.env * 0.6;
      this.mats.asphalt.envMapIntensity = c.env * 0.35; this.mats.rock.envMapIntensity = c.env * 0.3;
    }
    this.stars.visible = c.stars > 0.02;
    this.sunSprite.material.color.copy(c.sun);
    this.auroraMat.uniforms.opacity.value = c.aurora;
    this.auroraMat.uniforms.time.value = performance.now() * 0.001;
    this.aurora.visible = c.aurora > 0.02;
    this.scenery.solidMat.envMapIntensity = c.env * 0.25;

    if (cam) {
      this.sky.position.copy(cam.position);
      this.stars.position.copy(cam.position);
      this.aurora.position.set(cam.position.x, 0, cam.position.z);
      // 太阳在前方偏右的低空
      this.sunSprite.position.set(cam.position.x + 330, cam.position.y + 150 + c.sunSize * 0.2, cam.position.z + 780);
      this.sunSprite.scale.set(c.sunSize, c.sunSize, 1);
      this.scenery.update(cam, this.themeIdx);
      this.updateWeather(dt, cam);
      // 云海跟随相机，贴图偏移让云保持在世界坐标中
      this.cloud.position.x = cam.position.x;
      this.cloud.position.z = cam.position.z;
      this.cloudTex.offset.set(cam.position.x / this.cloudTile, -cam.position.z / this.cloudTile);
      this.cloudTex.offset.x += (performance.now() * 0.000004);
      for (var i = 0; i < this.mountains.length; i++) {
        var m = this.mountains[i];
        if (m.position.z < cam.position.z - 120) {
          this.placeMountain(m, cam.position.x, cam.position.z, false);
        }
      }
    }
  };

  // 各主题的天气：flake 粒子（颜色、大小、下落与横飘速度）、rain 雨丝强度
  var WEATHER = [
    { flake: 0.25, color: '#ffd9b0', size: 0.22, fall: 0.6, wind: 5 },   // 峡谷：浮尘
    { flake: 0.9, color: '#ffffff', size: 0.55, fall: 5, wind: 3 },      // 雪山：下雪
    { flake: 0.6, color: '#e9c98e', size: 0.3, fall: 0.8, wind: 16 },    // 沙漠：风沙
    { flake: 0, color: '#ffffff', size: 0.3, fall: 2, wind: 1, rain: 0.5 }, // 夜城：下雨
    { flake: 0.7, color: '#bff6ff', size: 0.35, fall: 1.6, wind: 2 }     // 冰原：冰晶
  ];
  World.prototype.updateWeather = function (dt, cam) {
    var W = WEATHER[this.themeIdx], wt = this.weather;
    var k = Math.min(1, dt * 1.2);
    wt.flake += (W.flake - wt.flake) * k;
    wt.rain += ((W.rain || 0) - wt.rain) * k;
    dt = Math.min(dt, 0.05);
    var cx = cam.position.x, cy = cam.position.y - 14, cz = cam.position.z;
    this.flakes.visible = wt.flake > 0.02;
    if (this.flakes.visible) {
      this.flakeMat.opacity = wt.flake;
      this.flakeMat.color.set(W.color);
      this.flakeMat.size = W.size;
      var p = this.flakes.geometry.attributes.position.array, t = performance.now() * 0.001;
      for (var i = 0; i < p.length; i += 3) {
        var sd = this.wSeed[i / 3];
        p[i] += (W.wind * (0.6 + sd * 0.8) + Math.sin(t * 1.3 + sd * 20) * 1.2) * dt;
        p[i + 1] -= W.fall * (0.6 + sd * 0.8) * dt;
        // 超出镜头周围的范围就绕回另一侧
        if (p[i] - cx > 60) p[i] -= 120; else if (p[i] - cx < -60) p[i] += 120;
        if (p[i + 1] - cy < -8) p[i + 1] += 45; else if (p[i + 1] - cy > 37) p[i + 1] -= 45;
        if (p[i + 2] - cz < -30) p[i + 2] += 140; else if (p[i + 2] - cz > 110) p[i + 2] -= 140;
      }
      this.flakes.geometry.attributes.position.needsUpdate = true;
    }
    this.rain.visible = wt.rain > 0.02;
    if (this.rain.visible) {
      this.rainMat.opacity = wt.rain;
      var rp = this.rainPos, a = this.rain.geometry.attributes.position.array;
      for (var j = 0; j < rp.length; j += 3) {
        rp[j] += 6 * dt; rp[j + 1] -= 48 * dt;
        if (rp[j] - cx > 55) rp[j] -= 110; else if (rp[j] - cx < -55) rp[j] += 110;
        if (rp[j + 1] - cy < -8) rp[j + 1] += 45;
        if (rp[j + 2] - cz < -25) rp[j + 2] += 130; else if (rp[j + 2] - cz > 105) rp[j + 2] -= 130;
        var o = j * 2;
        a[o] = rp[j]; a[o + 1] = rp[j + 1]; a[o + 2] = rp[j + 2];
        a[o + 3] = rp[j] - 0.2; a[o + 4] = rp[j + 1] + 1.6; a[o + 5] = rp[j + 2];
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  };

  // 让太阳光的阴影范围跟随目标
  World.prototype.followSun = function (x, z) {
    this.sun.position.set(x + 30, 60, z - 25);
    this.sun.target.position.set(x, 0, z + 8);
  };

  DC.World = World;
})(window.DC);
