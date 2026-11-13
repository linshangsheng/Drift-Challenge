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
    this.cur.sunI = th.sunI; this.cur.hemiI = th.hemiI; this.cur.edgeGlow = th.edgeGlow; this.cur.stars = th.stars;

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
    this.mountains = [];
    for (var m = 0; m < 70; m++) {
      var mesh = new T.Mesh(this.mountainGeo, this.mountainMat);
      this.mountains.push(mesh);
      scene.add(mesh);
      this.placeMountain(mesh, 0, 0, true);
    }

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

  World.prototype.placeMountain = function (mesh, cx, cz, initial) {
    var side = Math.random() < 0.5 ? -1 : 1;
    var r = 30 + Math.random() * 70;
    var x = cx + side * (r + 75 + Math.random() * 320); // 与赛道保持距离
    var z = initial ? cz - 100 + Math.random() * 800 : cz + 550 + Math.random() * 250;
    var h = 50 + Math.random() * 150;
    mesh.scale.set(r, h, r);
    mesh.position.set(x, -75, z);
    mesh.rotation.y = Math.random() * Math.PI;
  };

  World.prototype.setThemeByLevel = function (level, instant) {
    this.themeIdx = DC.themeIndexOf(level);
    if (instant) this.update(100, null, true);
  };

  World.prototype.resetMountains = function (cx, cz) {
    for (var i = 0; i < this.mountains.length; i++) this.placeMountain(this.mountains[i], cx, cz, true);
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
    this.stars.visible = c.stars > 0.02;

    if (cam) {
      this.sky.position.copy(cam.position);
      this.stars.position.copy(cam.position);
      // 云海跟随相机，贴图偏移让云保持在世界坐标中
      this.cloud.position.x = cam.position.x;
      this.cloud.position.z = cam.position.z;
      this.cloudTex.offset.set(cam.position.x / this.cloudTile, -cam.position.z / this.cloudTile);
      this.cloudTex.offset.x += (performance.now() * 0.000004);
      for (var i = 0; i < this.mountains.length; i++) {
        var m = this.mountains[i];
        if (m.position.z < cam.position.z - 120 || Math.abs(m.position.x - cam.position.x) > 520) {
          this.placeMountain(m, cam.position.x, cam.position.z, false);
        }
      }
    }
  };

  // 让太阳光的阴影范围跟随目标
  World.prototype.followSun = function (x, z) {
    this.sun.position.set(x + 30, 60, z - 25);
    this.sun.target.position.set(x, 0, z + 8);
  };

  DC.World = World;
})(window.DC);
