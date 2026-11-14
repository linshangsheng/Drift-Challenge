/* 入口：渲染器、主循环、输入、全屏 */
(function (DC) {
  'use strict';
  var T = THREE;

  var stage = document.getElementById('stage');
  var renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 2000);

  scene.environment = DC.makeEnvMap(renderer);
  var world = new DC.World(scene);
  var track = new DC.Track(scene, world);
  var effects = new DC.Effects(scene);
  var game = new DC.Game({ scene: scene, camera: camera, world: world, track: track, effects: effects });

  DC.setShadows = function (on) {
    if (DC.setBlobShadows) DC.setBlobShadows(!on);
    renderer.shadowMap.enabled = on;
    world.sun.castShadow = on;
    scene.traverse(function (o) { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; }); } });
  };

  // ---------- 全屏 ----------
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  DC.requestFullscreen = function () {
    if (isFullscreen()) return;
    var el = document.documentElement;
    try {
      var p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen && el.webkitRequestFullscreen());
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* 不支持全屏的环境 */ }
  };
  DC.toggleFullscreen = function () {
    if (isFullscreen()) {
      var p = document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen && document.webkitExitFullscreen());
      if (p && p.catch) p.catch(function () {});
    } else DC.requestFullscreen();
  };

  var ui = new DC.UI(game, camera);

  // ---------- 输入 ----------
  // 空格、方向键左、A 键都可以操作
  var HOLD_KEYS = { Space: 1, ArrowLeft: 1, KeyA: 1 }, keysDown = {};
  function anyKeyDown() { for (var k in keysDown) if (keysDown[k]) return true; return false; }
  window.addEventListener('keydown', function (e) {
    if (HOLD_KEYS[e.code]) e.preventDefault();
    DC.Audio.unlock();
    if (ui.onKeyDown(e)) return;
    if (HOLD_KEYS[e.code] && !e.repeat) { keysDown[e.code] = true; game.setHolding(true); }
  });
  window.addEventListener('keyup', function (e) {
    if (HOLD_KEYS[e.code]) { e.preventDefault(); keysDown[e.code] = false; if (!anyKeyDown() && pointers === 0) game.setHolding(false); }
  });

  // 触屏 / 鼠标：按住屏幕 = 按住空格
  var pointers = 0;
  function isPlayArea(t) { return t === renderer.domElement || (t.closest && t.closest('#hud') && !t.closest('button')); }
  window.addEventListener('pointerdown', function (e) {
    DC.Audio.unlock();
    if (ui.screen !== 'hud' || ui.anyModal() || !isPlayArea(e.target)) return;
    pointers++;
    game.setHolding(true);
  });
  function release() { if (pointers > 0) { pointers = Math.max(0, pointers - 1); if (pointers === 0 && !anyKeyDown()) game.setHolding(false); } }
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('blur', function () {
    pointers = 0; keysDown = {};
    game.setHolding(false);
    if (ui.screen === 'hud') ui.pauseGame();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && ui.screen === 'hud') ui.pauseGame();
  });

  // ---------- 尺寸 ----------
  var viewShift = { x: 0, y: 0 };
  function applyViewShift() {
    var w = window.innerWidth, h = window.innerHeight;
    if (viewShift.x || viewShift.y) camera.setViewOffset(w, h, -viewShift.x * w, viewShift.y * h, w, h);
    else camera.clearViewOffset();
  }
  // 让车辆在画面中偏移显示（x>0 向右，y>0 向上），给界面面板让位
  DC.setViewShift = function (x, y) { viewShift.x = x; viewShift.y = y; applyViewShift(); };
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    ui.updateViewShift();
  }
  window.addEventListener('resize', resize);

  // ---------- 自动画质：持续掉帧时逐级降低分辨率，最后关闭阴影 ----------
  var baseDpr = Math.min(window.devicePixelRatio || 1, 2);
  var QUALITY = [
    { pr: baseDpr, shadows: true },
    { pr: Math.min(baseDpr, 1.5), shadows: true },
    { pr: Math.min(baseDpr, 1), shadows: true },
    { pr: Math.min(baseDpr, 1), shadows: false },
    { pr: 0.75, shadows: false }
  ];
  var qLevel = 0, slowTime = 0, emaDt = 1 / 60;
  function applyQuality() {
    var q = QUALITY[qLevel], wantShadows = q.shadows && DC.Save.data.settings.shadows !== false;
    renderer.setPixelRatio(q.pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (renderer.shadowMap.enabled !== wantShadows) DC.setShadows(wantShadows);
  }
  DC.applyQuality = applyQuality;
  DC.resetQuality = function () { qLevel = 0; slowTime = 0; applyQuality(); };
  function watchFps(rawDt) {
    // 自动化测试环境（软件渲染）不参与自动降画质
    if (DC.Save.data.settings.autoQuality === false || rawDt > 0.25 || document.hidden || navigator.webdriver) return;
    emaDt += (rawDt - emaDt) * 0.05;
    if (emaDt > 1 / 40) slowTime += rawDt; else slowTime = Math.max(0, slowTime - rawDt * 2);
    if (slowTime > 2.5 && qLevel < QUALITY.length - 1) {
      // 跳过与当前效果相同的档位
      var prev = QUALITY[qLevel];
      do { qLevel++; } while (qLevel < QUALITY.length - 1 && QUALITY[qLevel].pr === prev.pr && QUALITY[qLevel].shadows === prev.shadows);
      slowTime = 0; emaDt = 1 / 60;
      applyQuality();
      if (ui.screen !== 'hud') ui.toast('已自动降低画质以保持流畅', '#9aa3b5');
    }
  }

  // ---------- 主循环 ----------
  var last = performance.now();
  function frame(now) {
    var raw = (now - last) / 1000;
    var dt = Math.min(0.05, raw);
    last = now;
    watchFps(raw);
    game.update(dt);
    ui.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  ui.updateViewShift();
  document.getElementById('loading').classList.add('hidden');

  // 调试用
  DC.app = { renderer: renderer, scene: scene, camera: camera, world: world, track: track, game: game, ui: ui };
})(window.DC);
