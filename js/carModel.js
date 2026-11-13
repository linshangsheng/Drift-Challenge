/* 程序化生成 100 种低多边形车辆模型（车头朝 +Z） */
(function (DC) {
  'use strict';
  var T = THREE;
  var cache = {};
  var matCache = {};
  var badgeCache = {};

  function mat(key, make) {
    if (!matCache[key]) matCache[key] = make();
    return matCache[key];
  }

  function paintMat(color, level) {
    return mat('paint' + color + '_' + (level >= 56 ? 1 : 0), function () {
      return new T.MeshStandardMaterial({
        color: color, roughness: level >= 56 ? 0.28 : 0.45, metalness: level >= 56 ? 0.45 : 0.25, flatShading: true
      });
    });
  }
  var glassMat = function () { return mat('glass', function () { return new T.MeshStandardMaterial({ color: '#10161f', roughness: 0.1, metalness: 0.6 }); }); };
  var tireMat = function () { return mat('tire', function () { return new T.MeshStandardMaterial({ color: '#151515', roughness: 0.9, flatShading: true }); }); };
  var rimMat = function (c) { return mat('rim' + c, function () { return new T.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.8 }); }); };
  var darkMat = function () { return mat('dark', function () { return new T.MeshStandardMaterial({ color: '#1b1b1f', roughness: 0.6 }); }); };
  var headMat = function () { return mat('head', function () { return new T.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 1.2 }); }); };
  var tailMat = function () { return mat('tail', function () { return new T.MeshStandardMaterial({ color: '#ff2030', emissive: '#ff1020', emissiveIntensity: 1.4 }); }); };
  var glowMat = function (c) {
    return mat('glow' + c, function () {
      return new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false });
    });
  };
  var trimMat = function (c) { return mat('trim' + c, function () { return new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9 }); }); };

  // 侧面轮廓（x=车身长度方向，y=高度）挤出成几何体，宽度沿世界 X
  function profileGeo(points, width, bevel) {
    var shape = new T.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    var b = bevel || 0;
    var g = new T.ExtrudeGeometry(shape, {
      depth: width - b * 2, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, steps: 1
    });
    g.translate(0, 0, -(width - b * 2) / 2);
    g.rotateY(-Math.PI / 2); // shape.x -> world z
    return g;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // 根据等级计算外形参数
  function shapeParams(level) {
    var t = (level - 1) / 99;
    var tier = DC.tierOf(level).id;
    var p = {
      len: lerp(3.4, 4.7, Math.pow(t, 0.7)),
      wid: lerp(1.6, 2.15, t),
      ground: lerp(0.28, 0.16, t),
      bodyH: lerp(0.75, 0.5, t),
      cabinH: lerp(0.78, 0.36, Math.pow(t, 0.8)),
      cabinStart: 0, cabinEnd: 0, roofStart: 0, roofEnd: 0,
      wheelR: lerp(0.32, 0.44, t),
      wheelW: lerp(0.24, 0.38, t),
      noseDrop: lerp(0.12, 0.32, t),
      spoiler: tier >= 2 ? (tier >= 4 ? (tier >= 6 ? 3 : 2) : 1) : 0,
      intakes: tier >= 5,
      underglow: tier >= 6,
      trim: tier >= 7,
      fins: tier >= 6
    };
    var L = p.len;
    if (tier <= 0) { // 微型车：高顶、短头
      p.cabinStart = -0.42 * L; p.cabinEnd = 0.22 * L; p.roofStart = -0.38 * L; p.roofEnd = 0.08 * L;
    } else if (tier <= 2) { // 两厢/三厢
      p.cabinStart = -0.32 * L; p.cabinEnd = 0.2 * L; p.roofStart = -0.22 * L; p.roofEnd = 0.02 * L;
    } else if (tier <= 4) { // 前置/中置跑车：长车头
      p.cabinStart = -0.3 * L; p.cabinEnd = 0.12 * L; p.roofStart = -0.18 * L; p.roofEnd = -0.04 * L;
    } else { // 中置超跑：座舱靠前，泪滴形
      p.cabinStart = -0.22 * L; p.cabinEnd = 0.26 * L; p.roofStart = -0.08 * L; p.roofEnd = 0.08 * L;
    }
    // 同档次内做些差异
    var v = (level * 37) % 10 / 10;
    p.cabinH *= lerp(0.92, 1.08, v);
    p.len *= lerp(0.97, 1.03, (level * 13) % 7 / 7);
    return p;
  }

  function buildCar(level) {
    var info = DC.carOf(level);
    var p = shapeParams(level);
    var g = new T.Group();
    var L = p.len, W = p.wid, gy = p.ground, bh = p.bodyH;
    var paint = paintMat(info.color, level);
    var accent = paintMat(info.accent, level);

    // 车身
    var hz = L / 2;
    var body = [
      [-hz, gy + 0.08], [-hz, gy + bh * 0.95], [-hz + 0.25, gy + bh],
      [hz - L * 0.28, gy + bh], [hz - 0.15, gy + bh - p.noseDrop], [hz, gy + bh * 0.45], [hz - 0.05, gy + 0.05]
    ];
    var bodyMesh = new T.Mesh(profileGeo(body, W, 0.06), paint);
    bodyMesh.castShadow = true;
    g.add(bodyMesh);

    // 座舱（车漆）+ 车窗（玻璃）
    var top = gy + bh;
    var cab = [[p.cabinStart, top - 0.02], [p.roofStart, top + p.cabinH], [p.roofEnd, top + p.cabinH], [p.cabinEnd, top - 0.02]];
    var cabMesh = new T.Mesh(profileGeo(cab, W * 0.82, 0.04), paint);
    cabMesh.castShadow = true;
    g.add(cabMesh);
    var inset = 0.08;
    var glass = [
      [p.cabinStart + 0.12, top + 0.03], [p.roofStart + 0.04, top + p.cabinH - inset],
      [p.roofEnd - 0.04, top + p.cabinH - inset], [p.cabinEnd - 0.1, top + 0.03]
    ];
    g.add(new T.Mesh(profileGeo(glass, W * 0.86, 0), glassMat()));

    // 车轮
    var tireGeo = new T.CylinderGeometry(p.wheelR, p.wheelR, p.wheelW, 12);
    tireGeo.rotateZ(Math.PI / 2);
    var rimGeo = new T.CylinderGeometry(p.wheelR * 0.6, p.wheelR * 0.6, p.wheelW + 0.02, 8);
    rimGeo.rotateZ(Math.PI / 2);
    var rimColor = level >= 71 ? '#ffd166' : (level >= 41 ? '#d9d9d9' : '#9a9a9a');
    var wx = W / 2 - p.wheelW / 2 + 0.04;
    var wz = [hz - L * 0.2, -hz + L * 0.2];
    g.userData.wheels = [];
    for (var i = 0; i < 2; i++) {
      for (var s = -1; s <= 1; s += 2) {
        var wheel = new T.Group();
        wheel.add(new T.Mesh(tireGeo, tireMat()));
        wheel.add(new T.Mesh(rimGeo, rimMat(rimColor)));
        wheel.position.set(s * wx, p.wheelR, wz[i]);
        g.add(wheel);
        g.userData.wheels.push(wheel);
      }
    }

    // 灯
    var lightGeo = new T.BoxGeometry(W * 0.22, 0.08, 0.06);
    for (var k = -1; k <= 1; k += 2) {
      var hl = new T.Mesh(lightGeo, headMat());
      hl.position.set(k * W * 0.3, gy + bh * 0.62, hz - 0.02);
      g.add(hl);
      var tl = new T.Mesh(lightGeo, tailMat());
      tl.position.set(k * W * 0.3, gy + bh * 0.8, -hz + 0.01);
      g.add(tl);
    }

    // 车顶/引擎盖装饰条
    if (level >= 26) {
      var stripe = new T.Mesh(new T.BoxGeometry(W * 0.12, 0.02, L * 0.35), accent);
      stripe.position.set(0, top + 0.005, hz - L * 0.2);
      g.add(stripe);
    }

    // 尾翼
    if (p.spoiler) {
      var sw = W * (p.spoiler >= 3 ? 1.0 : 0.85);
      var sh = [0, 0.06, 0.28, 0.45][p.spoiler];
      var wing = new T.Mesh(new T.BoxGeometry(sw, 0.05, p.spoiler >= 2 ? 0.45 : 0.25), p.spoiler >= 3 ? accent : paint);
      wing.position.set(0, top + sh + 0.03, -hz + 0.22);
      wing.castShadow = true;
      g.add(wing);
      if (p.spoiler >= 2) {
        var postGeo = new T.BoxGeometry(0.05, sh, 0.12);
        for (var q = -1; q <= 1; q += 2) {
          var post = new T.Mesh(postGeo, darkMat());
          post.position.set(q * W * 0.3, top + sh / 2, -hz + 0.25);
          g.add(post);
        }
      }
      if (p.spoiler >= 3) {
        var plateGeo = new T.BoxGeometry(0.04, 0.22, 0.5);
        for (var r = -1; r <= 1; r += 2) {
          var plate = new T.Mesh(plateGeo, darkMat());
          plate.position.set(r * sw / 2, top + sh, -hz + 0.22);
          g.add(plate);
        }
      }
    }

    // 侧面进气口
    if (p.intakes) {
      var inGeo = new T.BoxGeometry(0.04, bh * 0.45, L * 0.18);
      for (var m = -1; m <= 1; m += 2) {
        var intake = new T.Mesh(inGeo, darkMat());
        intake.position.set(m * (W / 2 + 0.005), gy + bh * 0.55, -L * 0.08);
        g.add(intake);
      }
    }

    // 鲨鱼鳍
    if (p.fins) {
      var fd = p.roofStart - p.cabinStart + 0.7;
      var fin = new T.Mesh(profileGeo([[0, 0], [fd, 0], [fd, p.cabinH * 0.85]], 0.05, 0), accent);
      fin.position.set(0, top - 0.02, p.cabinStart - 0.7);
      g.add(fin);
    }

    // 车底霓虹
    if (p.underglow) {
      var glow = new T.Mesh(new T.PlaneGeometry(W * 1.25, L * 1.1), glowMat(info.tier.color));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.03;
      g.add(glow);
    }

    // 发光腰线
    if (p.trim) {
      var trimGeo = new T.BoxGeometry(0.03, 0.04, L * 0.8);
      for (var n = -1; n <= 1; n += 2) {
        var tr = new T.Mesh(trimGeo, trimMat(info.accent));
        tr.position.set(n * (W / 2 + 0.01), gy + bh * 0.35, 0);
        g.add(tr);
      }
    }

    g.userData.level = level;
    g.userData.length = L;
    g.userData.width = W;
    return g;
  }

  // 获取模型实例（共享几何体和材质）
  DC.makeCar = function (level) {
    if (!cache[level]) cache[level] = buildCar(level);
    var c = cache[level].clone();
    c.userData = Object.assign({}, cache[level].userData);
    // 复制后的车轮引用
    c.userData.wheels = [];
    c.traverse(function (o) { if (o.isGroup && o !== c) c.userData.wheels.push(o); });
    return c;
  };

  // 等级徽章贴图
  DC.badgeTexture = function (level) {
    if (badgeCache[level]) return badgeCache[level];
    var cv = document.createElement('canvas');
    cv.width = 160; cv.height = 72;
    var x = cv.getContext('2d');
    var col = DC.tierOf(level).color;
    x.fillStyle = 'rgba(10,12,20,0.82)';
    roundRect(x, 4, 4, 152, 64, 18); x.fill();
    x.lineWidth = 6; x.strokeStyle = col;
    roundRect(x, 4, 4, 152, 64, 18); x.stroke();
    x.fillStyle = col;
    x.font = 'bold 42px "Segoe UI", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Lv' + level, 80, 39);
    var tex = new T.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.encoding = T.sRGBEncoding;
    badgeCache[level] = tex;
    return tex;
  };

  DC.makeBadge = function (level, scale) {
    var m = new T.SpriteMaterial({ map: DC.badgeTexture(level), depthTest: false, transparent: true });
    var s = new T.Sprite(m);
    var k = scale || 1;
    s.scale.set(2.4 * k, 1.08 * k, 1);
    s.renderOrder = 10;
    return s;
  };

  function roundRect(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  }

  // 车库缩略图
  var thumbRenderer = null, thumbScene = null, thumbCam = null, thumbCache = {};
  DC.carThumb = function (level) {
    if (thumbCache[level]) return thumbCache[level];
    if (!thumbRenderer) {
      thumbRenderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      thumbRenderer.setSize(220, 130);
      thumbRenderer.outputEncoding = T.sRGBEncoding;
      thumbScene = new T.Scene();
      thumbScene.add(new T.HemisphereLight('#ffffff', '#555566', 1.0));
      var d = new T.DirectionalLight('#ffffff', 1.0); d.position.set(4, 6, 5); thumbScene.add(d);
      thumbCam = new T.PerspectiveCamera(30, 220 / 130, 0.1, 100);
      thumbCam.position.set(7.5, 4.2, 8.5);
      thumbCam.lookAt(0, 0.5, 0);
    }
    var car = DC.makeCar(level);
    thumbScene.add(car);
    thumbRenderer.render(thumbScene, thumbCam);
    var url = thumbRenderer.domElement.toDataURL('image/png');
    thumbScene.remove(car);
    thumbCache[level] = url;
    return url;
  };
})(window.DC);
