/* 界面：主菜单、HUD、商店、改装、弹窗 */
(function (DC) {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function UI(game, camera) {
    this.game = game;
    this.camera = camera;
    game.ui = this;
    this.screen = 'menu';
    this.focusLevel = DC.Save.data.selected;
    this.tierFilter = -1;
    this.floaters = [];
    this.tailSig = '';
    this.bind();
    this.applySettings();
    // 触屏设备的操作提示
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      $('hint').innerHTML = '按住屏幕 向左漂移 · 松开向右漂移';
      $('btnStart').textContent = '开始游戏';
      $('btnRetry').textContent = '再来一局';
    }
    this.showMenu();
  }

  UI.prototype.bind = function () {
    var self = this;
    var click = function (id, fn) {
      $(id).addEventListener('click', function (e) { e.stopPropagation(); DC.Audio.unlock(); DC.Audio.click(); fn(e); });
    };
    click('btnStart', function () { self.startGame(); });
    click('btnGarage', function () { self.showShop('cars'); });
    click('btnMods', function () { self.showShop('mods'); });
    click('btnTires', function () { self.showShop('tires'); });
    click('btnSettings', function () { self.openModal('settingsModal'); });
    click('btnSettingsClose', function () { self.closeModal('settingsModal'); });
    click('btnFullscreen', function () { DC.toggleFullscreen(); });
    click('btnShopBack', function () { self.showMenu(); });
    click('btnPause', function () { self.pauseGame(); });
    click('btnResume', function () { self.resumeGame(); });
    click('btnQuit', function () {
      self.closeModal('pauseModal');
      self.game.state = 'running';
      self.game.finishRun(true);
    });
    click('btnRetry', function () { self.startGame(); });
    click('btnRestart', function () {
      self.closeModal('pauseModal');
      self.game.state = 'running';
      self.game.bankCombo();
      // 重新开始前先结算本局已得的金币
      var st = self.game.stats;
      if (st) { DC.Save.data.coins += Math.floor(st.coins); DC.Save.save(); }
      self.startGame();
    });
    click('btnPauseSettings', function () { self.openModal('settingsModal'); });
    click('btnOverShop', function () { self.closeModal('overModal'); self.showShop('cars'); });
    click('btnOverSuggest', function () {
      self.closeModal('overModal');
      if (self.suggestLevel) { self.focusLevel = self.suggestLevel; self.tierFilter = -1; }
      self.showShop('cars');
    });
    click('btnOverMenu', function () { self.closeModal('overModal'); self.showMenu(); });
    click('btnDetAction', function () { self.detailAction(); });
    click('btnReset', function () {
      self.confirm('重置存档', '金币、车辆和改装都会清空，确定吗？', function () {
        DC.Save.reset();
        self.focusLevel = 1;
        self.applySettings();
        self.closeModal('settingsModal');
        self.showMenu();
      });
    });
    click('btnTutorial', function () {
      DC.Save.data.tutorialDone = false; DC.Save.save();
      self.toast('下一局会重新进行新手引导', '#ffd34d');
    });
    click('btnAch', function () { self.renderAch(); $('achDot').classList.add('hidden'); self.openModal('achModal'); });
    click('btnAchClose', function () { self.closeModal('achModal'); });
    click('confirmNo', function () { self.closeModal('confirmModal'); });
    click('confirmYes', function () { self.closeModal('confirmModal'); if (self.confirmFn) self.confirmFn(); });

    $('optSound').addEventListener('change', function (e) {
      DC.Save.data.settings.sound = e.target.checked; DC.Save.save(); self.applySettings();
    });
    $('optMusic').addEventListener('change', function (e) {
      DC.Save.data.settings.music = e.target.checked; DC.Save.save(); self.applySettings();
    });
    $('optGuide').addEventListener('change', function (e) {
      DC.Save.data.settings.guide = e.target.checked; DC.Save.save();
    });
    $('optCamFx').addEventListener('change', function (e) {
      DC.Save.data.settings.camFx = e.target.checked; DC.Save.save();
    });
    $('optVibrate').addEventListener('change', function (e) {
      DC.Save.data.settings.vibrate = e.target.checked; DC.Save.save();
      if (e.target.checked) DC.vibrate(30);
    });
    $('optAutoQ').addEventListener('change', function (e) {
      DC.Save.data.settings.autoQuality = e.target.checked; DC.Save.save();
      if (!e.target.checked && DC.resetQuality) DC.resetQuality();
    });
    $('optShadows').addEventListener('change', function (e) {
      DC.Save.data.settings.shadows = e.target.checked; DC.Save.save(); self.applySettings();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { DC.Audio.click(); self.setTab(t.getAttribute('data-tab')); });
    });

    // 档次筛选
    var tf = $('tierFilter');
    var all = document.createElement('button');
    all.textContent = '全部'; all.className = 'active'; all.dataset.tier = -1;
    tf.appendChild(all);
    DC.TIERS.forEach(function (t) {
      var b = document.createElement('button');
      b.textContent = t.name; b.style.color = t.color; b.dataset.tier = t.id;
      tf.appendChild(b);
    });
    tf.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      DC.Audio.click();
      self.tierFilter = +b.dataset.tier;
      Array.prototype.forEach.call(tf.children, function (c) { c.classList.toggle('active', c === b); });
      self.renderCarGrid();
    });

    $('carGrid').addEventListener('click', function (e) {
      var tile = e.target.closest('.car-tile'); if (!tile) return;
      DC.Audio.click();
      self.focusCar(+tile.dataset.level);
    });
    $('carGrid').addEventListener('dblclick', function (e) {
      var tile = e.target.closest('.car-tile'); if (!tile) return;
      self.focusCar(+tile.dataset.level);
      self.detailAction();
    });
    $('tireList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tire]'); if (!b) return;
      self.tireAction(b.dataset.tire);
    });
    $('modList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mod]'); if (!b) return;
      self.buyMod(b.dataset.mod);
    });
  };

  UI.prototype.applySettings = function () {
    var s = DC.Save.data.settings;
    $('optSound').checked = s.sound;
    $('optShadows').checked = s.shadows;
    $('optVibrate').checked = s.vibrate !== false;
    $('optCamFx').checked = s.camFx !== false;
    $('optGuide').checked = s.guide !== false;
    $('optAutoQ').checked = s.autoQuality !== false;
    $('optMusic').checked = s.music !== false;
    DC.Audio.setMusicEnabled(s.music !== false);
    DC.Audio.setEnabled(s.sound);
    if (DC.applyQuality) DC.applyQuality(); else if (DC.setShadows) DC.setShadows(s.shadows);
  };

  UI.prototype.updateViewShift = function () {
    if (!DC.setViewShift) return;
    var wide = window.innerWidth > 820;
    document.body.classList.toggle('shop-mode', this.screen === 'shop' && wide);
    var portrait = window.innerWidth < window.innerHeight;
    this.game.orbitRadius = this.screen === 'shop' ? (wide ? 11 : (portrait ? 14 : 12)) : (portrait ? 14 : 9.5);
    if (this.screen === 'menu') DC.setViewShift(wide ? 0.2 : 0, wide ? 0.04 : 0.08);
    else if (this.screen === 'shop') DC.setViewShift(wide ? -0.24 : 0, wide ? 0.05 : 0.31);
    else DC.setViewShift(0, 0);
  };

  UI.prototype.hideAll = function () {
    $('coach').classList.add('hidden');
    this.clearFloaters();
    $('toasts').innerHTML = '';
    ['menu', 'shop', 'hud'].forEach(function (id) { $(id).classList.add('hidden'); });
    $('countdown').classList.add('hidden');
  };

  UI.prototype.openModal = function (id) { $(id).classList.remove('hidden'); };
  UI.prototype.closeModal = function (id) { $(id).classList.add('hidden'); };
  UI.prototype.anyModal = function () {
    return ['pauseModal', 'overModal', 'settingsModal', 'confirmModal', 'achModal'].some(function (id) { return !$(id).classList.contains('hidden'); });
  };
  UI.prototype.confirm = function (title, text, fn) {
    $('confirmTitle').textContent = title; $('confirmText').textContent = text;
    this.confirmFn = fn; this.openModal('confirmModal');
  };

  // ---------- 主菜单 ----------
  UI.prototype.showMenu = function () {
    this.hideAll();
    this.screen = 'menu';
    var save = DC.Save.data;
    this.game.enterShowroom(save.selected);
    $('menu').classList.remove('hidden');
    this.updateViewShift();
    DC.Audio.setMusicMode('menu');
    this.fillCarCard('menu', save.selected);
    $('menuBest').textContent = 'Lv' + save.best.level;
    $('menuCoins').textContent = DC.fmt(save.coins);
  };

  UI.prototype.fillCarCard = function (prefix, level) {
    var c = DC.carOf(level);
    var lv = $(prefix + 'Level');
    lv.textContent = 'Lv' + level; lv.style.color = c.tier.color;
    var tier = $(prefix + 'Tier');
    tier.textContent = c.tier.name + ' · ' + c.typeName; tier.style.color = c.tier.color;
    $(prefix + 'Name').textContent = c.name;
    $(prefix + 'Speed').textContent = DC.kmhOf(level);
    $(prefix + 'Income').textContent = DC.fmtIncome(DC.incomeOf(level));
  };

  // ---------- 比赛 ----------
  UI.prototype.startGame = function () {
    DC.Audio.unlock();
    DC.requestFullscreen();
    ['overModal', 'pauseModal', 'settingsModal', 'confirmModal'].forEach(this.closeModal.bind(this));
    this.hideAll();
    this.screen = 'hud';
    $('hud').classList.remove('hidden');
    this.updateViewShift();
    $('hudLevel').textContent = '';
    this.roadText = '';
    this.meterBank = 0; this.meterLost = 0;
    $('driftMeter').classList.add('hidden');
    $('hint').style.opacity = 1;
    this.hintTimer = 6;
    this.tailSig = null;
    $('toasts').innerHTML = '';
    this.clearFloaters();
    this.game.startRun();
    DC.Audio.setMusicMode('race');
    var sl = DC.Save.modLevel('shield');
    $('hudShield').classList.toggle('hidden', sl <= 0);
    $('hudShield').querySelector('span').textContent = sl;
  };

  UI.prototype.pauseGame = function () {
    if (this.game.state !== 'running' && this.game.state !== 'countdown') return;
    this.game.pause();
    this.openModal('pauseModal');
  };
  UI.prototype.resumeGame = function () {
    this.closeModal('pauseModal');
    this.game.resume();
  };

  UI.prototype.toast = function (html, color) {
    var box = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast';
    el.style.color = color || '#fff';
    el.innerHTML = html;
    box.appendChild(el);
    while (box.children.length > 2) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2300);
  };

  UI.prototype.floater = function (x, y, z, text, color) {
    var el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.color = color || '#fff';
    $('floaters').appendChild(el);
    var stack = 0;
    for (var i = 0; i < this.floaters.length; i++) if (this.floaters[i].t < 0.3) stack++;
    this.floaters.push({ el: el, x: x, y: y + stack * 1.2, z: z, t: 0 });
    while (this.floaters.length > 6) { this.floaters[0].el.remove(); this.floaters.shift(); }
  };
  UI.prototype.clearFloaters = function () {
    this.floaters.forEach(function (f) { f.el.remove(); });
    this.floaters = [];
  };

  UI.prototype.onGameEvent = function (type, d) {
    var self = this;
    if (type === 'count') {
      var cd = $('countdown');
      cd.classList.remove('hidden', 'anim');
      void cd.offsetWidth;
      cd.textContent = d.n > 0 ? d.n : 'GO!';
      cd.classList.add('anim');
      if (d.n === 0) setTimeout(function () { cd.classList.add('hidden'); }, 900);
    } else if (type === 'eat') {
      this.floater(d.x, (d.y || 0) + 2.5, d.z, '+Lv' + d.level, DC.tierOf(d.level).color);
    } else if (type === 'merge') {
      var hh = this.game.head;
      this.floater(hh.x, hh.y + 4.5, hh.z, '合成 Lv' + d.level + '  +' + DC.fmt(d.bonus), DC.tierOf(d.level).color);
    } else if (type === 'levelup') {
      var c = DC.carOf(d.level);
      this.toast('升级！Lv' + d.level + ' ' + c.name + '<small>' + c.tier.name + ' · 极速 ' + DC.kmhOf(d.level) + ' km/h · +' + DC.fmt(d.bonus) + ' 金币</small>', c.tier.color);
      if (d.newTier) {
        var nt = d.newTier;
        setTimeout(function () { self.toast('🎉 进入新档次：' + nt.name + '<small>Lv' + nt.from + '-' + nt.to + ' · 奖励 ' + DC.fmt(d.tierBonus) + ' 金币</small>', nt.color); }, 450);
      }
      var ti = DC.themeIndexOf(d.level);
      if (DC.THEMES[ti].from === d.level) setTimeout(function () { self.toast('进入新场景：' + DC.THEMES[ti].name + '<small>' + DC.SURFACES[DC.THEMES[ti].surface].name + '，注意侧滑距离变化</small>', '#ffffff'); }, 900);
    } else if (type === 'land') {
      if (d.air > 0.5) this.floater(this.game.head.x, this.game.head.y + 3, this.game.head.z, '飞跃 ' + d.air.toFixed(1) + 's', '#ffd34d');
    } else if (type === 'boost') {
      this.floater(this.game.head.x, this.game.head.y + 3, this.game.head.z, '加速！', '#3df5ff');
    } else if (type === 'slick') {
      this.floater(this.game.head.x, this.game.head.y + 3, this.game.head.z, '打滑！', '#c9a8ff');
    } else if (type === 'edge') {
      this.floater(this.game.head.x, this.game.head.y + 4.5, this.game.head.z, '极限救车！+' + DC.fmt(d.bonus), '#ff8a3d');
      DC.Audio.comboUp(3);
      DC.vibrate([15, 30, 15]);
    } else if (type === 'power') {
      this.floater(this.game.head.x, this.game.head.y + 4, this.game.head.z, d.icon + ' ' + d.name, d.color);
      if (d.type === 'shield') { $('hudShield').classList.remove('hidden'); $('hudShield').querySelector('span').textContent = d.shield; }
    } else if (type === 'coach') {
      var co = $('coach');
      if (!d.action) {
        co.classList.add('hidden');
        if (d.done) this.toast('上手了！接下来靠你自己<small>绿色辅助线会显示现在转向后的滑行轨迹</small>', '#3ddc84');
      } else {
        var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        $('coachIcon').textContent = d.action === 'hold' ? '⬅️' : '➡️';
        $('coachText').textContent = d.action === 'hold' ? (touch ? '现在按住屏幕！' : '现在按住空格！') : (touch ? '现在松开手指！' : '现在松开空格！');
        co.classList.remove('hidden');
      }
    } else if (type === 'comboUp') {
      var dm = $('driftMeter');
      dm.classList.remove('pulse'); void dm.offsetWidth; dm.classList.add('pulse');
      DC.Audio.comboUp(d.mult);
    } else if (type === 'comboBank') {
      var grade = d.points > 2500 ? '传奇漂移！' : d.points > 900 ? '超级漂移！' : d.points > 300 ? '漂亮的漂移！' : '漂移';
      var h2 = this.game.head;
      this.floater(h2.x, h2.y + 4, h2.z, grade + ' +' + DC.fmt(d.coins), '#ffd34d');
      DC.Audio.cash(d.points > 900);
      DC.vibrate(d.points > 900 ? [25, 40, 25, 40, 40] : [20, 30, 20]);
      this.meterBank = 0.9;
      $('driftMeter').classList.add('bank');
    } else if (type === 'comboLost') {
      DC.Audio.comboLost();
      this.meterLost = 1.0;
      $('dmLabel').textContent = '连击中断';
      $('driftMeter').classList.add('lost');
    } else if (type === 'legend') {
      this.toast('传奇合成！+' + DC.fmt(d.bonus), '#3df5ff');
    } else if (type === 'shield') {
      this.toast('护盾生效！剩余 ' + d.left + ' 次', '#7fd3ff');
      $('hudShield').querySelector('span').textContent = d.left;
    } else if (type === 'over') {
      this.showGameOver(d.stats, d.records, d.quit);
    }
  };

  UI.prototype.showGameOver = function (st, rec, quit) {
    this.announceAch(this.checkAchievements(st));
    $('overTitle').textContent = quit ? '本局结束' : '坠入悬崖！';
    $('overCoins').textContent = '+' + DC.fmt(st.coins);
    $('overTime').textContent = fmtTime(st.time);
    $('overLevel').textContent = 'Lv' + st.maxLevel;
    $('overEaten').textContent = st.eaten;
    $('overMerges').textContent = st.merges;
    $('overJumps').textContent = st.jumps || 0;
    $('overDrift').textContent = DC.fmt(st.driftPoints || 0);
    // 购车建议：买得起的最高级新车，或者距离下一辆还差多少
    var save = DC.Save.data, best = 0, next = 0;
    for (var lv = DC.MAX_LEVEL; lv > save.selected; lv--) {
      if (DC.Save.owns(lv)) continue;
      if (DC.priceOf(lv) <= save.coins) { best = lv; break; }
    }
    if (!best) for (var nl = save.selected + 1; nl <= DC.MAX_LEVEL; nl++) if (!DC.Save.owns(nl)) { next = nl; break; }
    var sg = $('btnOverSuggest');
    this.suggestLevel = best || next;
    if (best) { sg.textContent = '💡 金币够买 Lv' + best + ' ' + DC.carOf(best).name + ' 了，去看看'; sg.className = 'btn good'; }
    else if (next) { sg.textContent = '再攒 ' + DC.fmt(DC.priceOf(next) - save.coins) + ' 金币可买 Lv' + next + ' ' + DC.carOf(next).name; sg.className = 'btn'; }
    else sg.className = 'btn hidden';
    $('overCar').textContent = '最终座驾：' + DC.carOf(st.maxLevel).name + ' · 钱包 ' + DC.fmt(DC.Save.data.coins);
    var r = [];
    if (rec.level) r.push('最高等级'); if (rec.time) r.push('最长时间'); if (rec.coins) r.push('单局金币');
    $('overRecord').classList.toggle('hidden', r.length === 0);
    $('overRecord').textContent = '新纪录：' + r.join(' · ');
    this.openModal('overModal');
    this.overShownAt = performance.now();
    DC.Audio.setMusicMode('menu');
  };

  UI.prototype.update = function (dt) {
    var g = this.game;
    if (this.screen === 'hud' && g.stats) {
      var h = g.head;
      var c = DC.carOf(h.level);
      var lv = $('hudLevel');
      if (lv.textContent !== 'Lv' + h.level) { lv.textContent = 'Lv' + h.level; lv.style.color = c.tier.color; $('hudName').textContent = c.name; $('hudTier').textContent = c.tier.name; $('hudTier').style.color = c.tier.color; }
      $('hudSpeed').textContent = Math.round(DC.toKmh(h.v, h.level));
      $('hudCoins').textContent = DC.fmt(g.stats.coins);
      $('hudIncome').textContent = '+' + DC.fmtIncome(DC.incomeOf(h.level) * g.turbo) + '/秒';
      $('hudTime').textContent = fmtTime(g.stats.time);
      var hdl = g.handling();
      var road = DC.SURFACES[hdl.surface].name + ' · ' + hdl.tire.name + (g.lastEffect === 'slick' ? ' · 打滑!' : '') + (g.boostTimer > 0 ? ' · 加速中' : '') +
        (g.driftAngle > 6 ? ' · 漂移角 ' + Math.round(g.driftAngle) + '°' : '');
      if (road !== this.roadText) { this.roadText = road; $('hudRoad').textContent = road; }

      var sig = h.level + '|' + g.tail.map(function (t) { return t.level; }).join(',');
      if (sig !== this.tailSig) {
        var prev = this.tailSig ? this.tailSig.split('|')[1].split(',') : [];
        this.tailSig = sig;
        var bar = $('tailBar');
        bar.innerHTML = '';
        // 提示车尾要合成到几级才能让车头升级
        var tip = document.createElement('span');
        tip.className = 'tail-tip';
        tip.textContent = h.level < DC.MAX_LEVEL ? '车尾合成到 Lv' + h.level + ' 即升级 ▸' : '已是最高等级 ▸';
        bar.appendChild(tip);
        g.tail.forEach(function (t, i) {
          var chip = document.createElement('span');
          chip.className = 'lv-chip' + (prev[i] !== String(t.level) ? ' pop' : '');
          chip.style.color = DC.tierOf(t.level).color;
          chip.textContent = 'Lv' + t.level;
          bar.appendChild(chip);
        });
      }
      this.updateMeter(dt);
      var pw = '';
      if (g.boostTimer > 0) pw += '<span style="color:#ff8a5c">🔥 ' + g.boostTimer.toFixed(1) + 's</span>';
      if (g.magnetTimer > 0) pw += '<span style="color:#ff7a9a">🧲 ' + Math.ceil(g.magnetTimer) + 's</span>';
      if (g.doubleTimer > 0) pw += '<span style="color:#ffd34d">×2 ' + Math.ceil(g.doubleTimer) + 's</span>';
      if (pw !== this.powerHtml) { this.powerHtml = pw; $('hudPower').innerHTML = pw; }
      if (this.hintTimer > 0 && g.state === 'running') {
        this.hintTimer -= dt;
        if (this.hintTimer <= 0) $('hint').style.opacity = 0;
      }
    }
    this.updateSpeedLines(dt);
    // 漂浮文字
    var v = new THREE.Vector3();
    for (var i = this.floaters.length - 1; i >= 0; i--) {
      var f = this.floaters[i];
      f.t += dt;
      if (f.t > 1.1) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      v.set(f.x, f.y + f.t * 3, f.z).project(this.camera);
      if (v.z > 1 || v.y > 0.92) { f.el.style.display = 'none'; continue; }
      f.el.style.display = '';
      f.el.style.left = ((v.x + 1) / 2 * window.innerWidth) + 'px';
      f.el.style.top = ((1 - v.y) / 2 * window.innerHeight) + 'px';
      f.el.style.opacity = Math.min(1, (1.1 - f.t) * 3);
    }
  };

  // 漂移连击计分表
  var MULT_COLORS = ['#ffffff', '#ffffff', '#ffe066', '#ffb03d', '#ff6b4a', '#d36bff'];
  UI.prototype.updateMeter = function (dt) {
    var g = this.game, c = g.combo, dm = $('driftMeter');
    if (this.meterBank > 0 || this.meterLost > 0) {
      this.meterBank = Math.max(0, (this.meterBank || 0) - dt);
      this.meterLost = Math.max(0, (this.meterLost || 0) - dt);
      if (this.meterBank <= 0 && this.meterLost <= 0) {
        dm.classList.add('hidden'); dm.classList.remove('bank', 'lost');
        $('dmLabel').textContent = '漂移';
      }
      if (!(c && c.active && c.drifting)) return;
      dm.classList.remove('bank', 'lost'); this.meterBank = 0; this.meterLost = 0;
      $('dmLabel').textContent = '漂移';
    }
    if (!c || !c.active) { if (!dm.classList.contains('hidden')) dm.classList.add('hidden'); return; }
    dm.classList.remove('hidden');
    dm.style.setProperty('--mc', MULT_COLORS[Math.min(5, c.mult)]);
    $('dmMult').textContent = '×' + c.mult;
    $('dmPts').textContent = DC.fmt(c.points);
    $('dmBar').style.width = Math.min(100, (g.driftAngle || 0) / 60 * 100).toFixed(0) + '%';
    dm.style.opacity = c.drifting ? 1 : Math.max(0.35, 1 - c.idle / 1.6);
  };

  // 速度线：高速和加速时从画面中心向外飞出的线条
  UI.prototype.updateSpeedLines = function (dt) {
    var cv = $('speedFx');
    if (!this.slCtx) {
      this.slCtx = cv.getContext('2d');
      this.lines = [];
      for (var i = 0; i < 46; i++) this.lines.push({ a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.6 + Math.random() * 0.8 });
    }
    var g = this.game, h = g.head;
    var on = this.screen === 'hud' && g.state === 'running';
    var top = DC.speedOf(h.level);
    var k = on ? Math.max(0, Math.min(1, (h.v / top - 0.8) * 4)) * (0.35 + 0.65 * Math.min(1, top / 60)) : 0;
    if (g.boostTimer > 0) k = Math.max(k, 1);
    this.slK = (this.slK || 0) + (k - (this.slK || 0)) * Math.min(1, dt * 4);
    var W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var x = this.slCtx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    if (this.slK < 0.02) return;
    var cx = W / 2, cy = H * 0.42, R = Math.hypot(W, H) * 0.6;
    x.lineCap = 'round';
    for (var i = 0; i < this.lines.length; i++) {
      var l = this.lines[i];
      l.r += dt * l.s * (1.2 + this.slK * 2.2);
      if (l.r > 1) { l.r = 0.25 + Math.random() * 0.2; l.a = Math.random() * Math.PI * 2; }
      var r0 = R * l.r, r1 = r0 + R * (0.05 + 0.12 * this.slK) * l.s;
      var al = this.slK * 0.35 * Math.min(1, (l.r - 0.25) * 4);
      x.strokeStyle = g.boostTimer > 0 ? 'rgba(160,250,255,' + al + ')' : 'rgba(255,255,255,' + al + ')';
      x.lineWidth = 1 + l.s * 1.5;
      x.beginPath();
      x.moveTo(cx + Math.cos(l.a) * r0, cy + Math.sin(l.a) * r0 * 0.75);
      x.lineTo(cx + Math.cos(l.a) * r1, cy + Math.sin(l.a) * r1 * 0.75);
      x.stroke();
    }
  };

  // ---------- 成就 ----------
  // run：刚结束的一局统计；返回新达成的成就列表并发放奖励
  UI.prototype.checkAchievements = function (run) {
    var save = DC.Save.data, got = [];
    save.ach = save.ach || {}; save.records = save.records || {};
    if (run) ['eaten', 'time', 'driftPoints', 'jumps', 'merges', 'coinsPicked'].forEach(function (k) {
      if ((run[k] || 0) > (save.records[k] || 0)) save.records[k] = Math.floor(run[k]);
    });
    DC.ACHIEVEMENTS.forEach(function (a) {
      if (save.ach[a.id]) return;
      if (a.val(save, run) >= a.goal) { save.ach[a.id] = true; save.coins += a.reward; got.push(a); }
    });
    if (got.length) { DC.Save.save(); $('achDot').classList.remove('hidden'); this.refreshWallet(); }
    return got;
  };
  UI.prototype.announceAch = function (got) {
    var self = this;
    got.slice(0, 3).forEach(function (a, i) {
      setTimeout(function () { self.toast(a.icon + ' 成就达成：' + a.name + '<small>' + a.desc + ' · 奖励 ' + DC.fmt(a.reward) + ' 金币</small>', '#ffd34d'); DC.Audio.levelUp(); }, 300 + i * 900);
    });
  };
  UI.prototype.renderAch = function () {
    var save = DC.Save.data, list = $('achList'), done = 0;
    list.innerHTML = '';
    DC.ACHIEVEMENTS.forEach(function (a) {
      var ok = !!(save.ach && save.ach[a.id]);
      if (ok) done++;
      var v = Math.min(a.goal, Math.floor(a.val(save, null)));
      var el = document.createElement('div');
      el.className = 'ach' + (ok ? ' done' : '');
      el.innerHTML = '<div class="ach-icon">' + a.icon + '</div><div><div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc +
        (ok ? '' : '（' + DC.fmt(v) + ' / ' + DC.fmt(a.goal) + '）') + '</div><div class="ach-bar"><i style="width:' + (ok ? 100 : v / a.goal * 100).toFixed(0) + '%"></i></div></div>' +
        '<div class="ach-reward">' + (ok ? '✓ 已领取' : '<span class="coin-icon"></span>' + DC.fmt(a.reward)) + '</div>';
      list.appendChild(el);
    });
    $('achCount').textContent = done + ' / ' + DC.ACHIEVEMENTS.length;
  };

  // ---------- 商店 ----------
  UI.prototype.showShop = function (tab) {
    this.hideAll();
    this.screen = 'shop';
    if (this.game.state !== 'menu') this.game.enterShowroom(DC.Save.data.selected);
    $('shop').classList.remove('hidden');
    this.updateViewShift();
    this.focusLevel = this.focusLevel || DC.Save.data.selected;
    this.setTab(tab || 'cars');
    this.focusCar(this.focusLevel, true);
  };

  UI.prototype.setTab = function (tab) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
    $('tabCars').classList.toggle('hidden', tab !== 'cars');
    $('tabMods').classList.toggle('hidden', tab !== 'mods');
    $('tabTires').classList.toggle('hidden', tab !== 'tires');
    this.tab = tab;
    if (tab === 'cars') this.renderCarGrid(); else if (tab === 'tires') this.renderTires(); else this.renderMods();
    this.refreshWallet();
  };

  UI.prototype.refreshWallet = function () {
    $('shopCoins').textContent = DC.fmt(DC.Save.data.coins);
    $('menuCoins').textContent = DC.fmt(DC.Save.data.coins);
  };

  UI.prototype.renderCarGrid = function () {
    var grid = $('carGrid');
    grid.innerHTML = '';
    var save = DC.Save.data;
    var self = this;
    var lastTier = -1;
    var pending = [];
    DC.CARS.forEach(function (c) {
      if (self.tierFilter >= 0 && c.tier.id !== self.tierFilter) return;
      if (c.tier.id !== lastTier) {
        lastTier = c.tier.id;
        var head = document.createElement('div');
        head.className = 'tier-head';
        head.style.color = c.tier.color;
        head.style.gridColumn = '1 / -1';
        head.textContent = c.tier.name + '  Lv' + c.tier.from + '-' + c.tier.to;
        grid.appendChild(head);
      }
      var tile = document.createElement('div');
      tile.className = 'car-tile';
      tile.dataset.level = c.level;
      var owned = DC.Save.owns(c.level);
      if (save.selected === c.level) tile.classList.add('selected');
      if (self.focusLevel === c.level) tile.classList.add('focus');
      var price = DC.priceOf(c.level);
      var priceHtml = owned ? '<div class="t-price own">已拥有</div>'
        : '<div class="t-price' + (save.coins >= price ? '' : ' no') + '"><span class="coin-icon"></span>' + DC.fmt(price) + '</div>';
      tile.innerHTML = '<div class="ph"></div><div class="t-lv" style="color:' + c.tier.color + '">Lv' + c.level + '</div>' +
        '<div class="t-name" title="' + c.name + '">' + c.name + '</div>' + priceHtml;
      grid.appendChild(tile);
      pending.push(tile);
    });
    // 分批生成缩略图，避免卡顿；从当前选中的车开始向两边生成
    var fl = this.focusLevel || 1;
    pending.sort(function (a, b) { return Math.abs(+a.dataset.level - fl) - Math.abs(+b.dataset.level - fl); });
    var token = this.gridToken = {};
    var step = function () {
      if (token !== self.gridToken) return;
      for (var k = 0; k < 6 && pending.length; k++) {
        var t = pending.shift();
        var img = new Image();
        img.alt = '';
        img.src = DC.carThumb(+t.dataset.level);
        var ph = t.querySelector('.ph');
        if (ph) t.replaceChild(img, ph);
      }
      if (pending.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  UI.prototype.focusCar = function (level, scrollInto) {
    this.focusLevel = level;
    this.game.showCar(level);
    this.fillCarCard('det', level);
    $('detGrip').textContent = Math.round(DC.carGrip(level) * 100);
    var btn = $('btnDetAction');
    var save = DC.Save.data;
    var price = DC.priceOf(level);
    btn.disabled = false;
    btn.className = 'btn primary big';
    if (save.selected === level) { btn.textContent = '✓ 当前起步车辆'; btn.disabled = true; }
    else if (DC.Save.owns(level)) { btn.textContent = '选用此车起步'; }
    else if (save.coins >= price) { btn.innerHTML = '购买 <span class="coin-icon"></span>' + DC.fmt(price); }
    else { btn.innerHTML = '金币不足 <span class="coin-icon"></span>' + DC.fmt(price); btn.disabled = true; }
    Array.prototype.forEach.call(document.querySelectorAll('.car-tile'), function (t) {
      var on = +t.dataset.level === level;
      t.classList.toggle('focus', on);
      if (on && scrollInto) t.scrollIntoView({ block: 'center' });
    });
  };

  UI.prototype.detailAction = function () {
    var level = this.focusLevel;
    var save = DC.Save.data;
    if (save.selected === level) return;
    if (!DC.Save.owns(level)) {
      var price = DC.priceOf(level);
      if (save.coins < price) { DC.Audio.deny(); return; }
      save.coins -= price;
      save.owned.push(level);
      DC.Audio.buy();
      this.toast('购入 ' + DC.carOf(level).name, DC.tierOf(level).color);
    }
    save.selected = level;
    DC.Save.save();
    this.announceAch(this.checkAchievements(null));
    this.refreshWallet();
    this.renderCarGrid();
    this.focusCar(level);
  };

  UI.prototype.renderMods = function () {
    var list = $('modList');
    list.innerHTML = '';
    var save = DC.Save.data;
    DC.MODS.forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'mod-card' + (m.locked ? ' locked' : '');
      if (m.locked) {
        card.innerHTML = '<div class="mod-icon">' + m.icon + '</div><div><div class="mod-name">' + m.name + '</div><div class="mod-desc">' + m.desc + '</div></div>' +
          '<button class="btn" disabled>未开放</button>';
      } else {
        var lv = DC.Save.modLevel(m.id);
        var bars = '';
        for (var i = 0; i < m.max; i++) bars += '<i class="' + (i < lv ? 'on' : '') + '"></i>';
        var maxed = lv >= m.max;
        var cost = maxed ? 0 : m.cost(lv);
        var eff = lv > 0 ? '当前：' + m.effectText(lv) : '未安装';
        if (!maxed) eff += ' → ' + m.effectText(lv + 1);
        card.innerHTML = '<div class="mod-icon">' + m.icon + '</div><div><div class="mod-name">' + m.name + '  <small class="muted">' + lv + '/' + m.max + '</small></div>' +
          '<div class="mod-desc">' + m.desc + '</div><div class="mod-effect">' + eff + '</div><div class="mod-lv">' + bars + '</div></div>' +
          (maxed ? '<button class="btn good" disabled>已满级</button>'
            : '<button class="btn ' + (save.coins >= cost ? 'primary' : '') + '" data-mod="' + m.id + '"' + (save.coins >= cost ? '' : ' disabled') + '><span class="coin-icon"></span>' + DC.fmt(cost) + '</button>');
      }
      list.appendChild(card);
    });
  };

  UI.prototype.renderTires = function () {
    var list = $('tireList');
    list.innerHTML = '';
    var save = DC.Save.data;
    function bar(label, v, max) {
      return '<span>' + label + '</span><span class="track"><i style="width:' + Math.min(100, v / max * 100).toFixed(0) + '%"></i></span>';
    }
    var surfs = { snow: '雪地', ice: '冰面', sand: '沙土', wet: '湿滑' };
    DC.TIRES.forEach(function (t) {
      var owned = DC.Save.ownsTire(t.id), eq = save.tire === t.id;
      var card = document.createElement('div');
      card.className = 'mod-card' + (eq ? ' equipped' : '');
      var extra = [];
      if (t.surf) for (var k in t.surf) extra.push(surfs[k] + (t.surf[k] >= 1 ? ' +' : ' ') + Math.round((t.surf[k] - 1) * 100) + '%');
      var btn;
      if (eq) btn = '<button class="btn good" disabled>使用中</button>';
      else if (owned) btn = '<button class="btn" data-tire="' + t.id + '">装备</button>';
      else btn = '<button class="btn ' + (save.coins >= t.price ? 'primary' : '') + '" data-tire="' + t.id + '"' + (save.coins >= t.price ? '' : ' disabled') + '><span class="coin-icon"></span>' + DC.fmt(t.price) + '</button>';
      card.innerHTML = '<div class="tire-swatch" style="--tc:' + t.color + '"></div><div><div class="mod-name" style="color:' + t.color + '">' + t.name + '</div>' +
        '<div class="mod-desc">' + t.desc + '</div>' +
        '<div class="stat-bars">' + bar('抓地力', t.grip, 1.8) + bar('转向响应', t.resp, 1.5) + bar('滑行距离', 1 / (t.grip * t.kin), 2.1) + '</div>' +
        (extra.length ? '<div class="mod-effect">' + extra.join(' · ') + '</div>' : '') + '</div>' + btn;
      list.appendChild(card);
    });
  };

  UI.prototype.tireAction = function (id) {
    var t = DC.tireOf(id), save = DC.Save.data;
    if (!DC.Save.ownsTire(id)) {
      if (save.coins < t.price) { DC.Audio.deny(); return; }
      save.coins -= t.price;
      save.tires.push(id);
      DC.Audio.buy();
      this.toast('购入 ' + t.name, t.color);
    } else DC.Audio.click();
    save.tire = id;
    DC.Save.save();
    this.announceAch(this.checkAchievements(null));
    this.renderTires();
    this.refreshWallet();
  };

  UI.prototype.buyMod = function (id) {
    var m = DC.modOf(id);
    var save = DC.Save.data;
    var lv = DC.Save.modLevel(id);
    if (!m || m.locked || lv >= m.max) return;
    var cost = m.cost(lv);
    if (save.coins < cost) { DC.Audio.deny(); return; }
    save.coins -= cost;
    save.mods[id] = lv + 1;
    DC.Save.save();
    DC.Audio.buy();
    this.toast(m.name + ' 升至 ' + (lv + 1) + ' 级', '#ffb03d');
    this.renderMods();
    this.refreshWallet();
  };

  // ---------- 键盘 ----------
  // 返回 true 表示按键已被界面处理
  UI.prototype.onKeyDown = function (e) {
    var g = this.game;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!$('confirmModal').classList.contains('hidden')) { this.closeModal('confirmModal'); return true; }
      if (!$('settingsModal').classList.contains('hidden')) { this.closeModal('settingsModal'); return true; }
      if (!$('achModal').classList.contains('hidden')) { this.closeModal('achModal'); return true; }
      if (g.state === 'paused') { this.resumeGame(); return true; }
      if (this.screen === 'hud' && (g.state === 'running' || g.state === 'countdown')) { this.pauseGame(); return true; }
      if (this.screen === 'shop' && e.code === 'Escape') { this.showMenu(); return true; }
      return false;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      if (e.repeat) return true;
      if (!$('confirmModal').classList.contains('hidden') || !$('settingsModal').classList.contains('hidden') || !$('achModal').classList.contains('hidden')) return e.code === 'Space';
      if (this.screen === 'menu') { this.startGame(); return true; }
      if (g.state === 'paused') { this.resumeGame(); return true; }
      if (g.state === 'over' && performance.now() - (this.overShownAt || 0) > 600) { this.startGame(); return true; }
    }
    return false;
  };

  DC.UI = UI;
})(window.DC);
