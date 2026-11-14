/* 本地存档 */
(function (DC) {
  'use strict';
  var KEY = 'driftChallenge.save.v1';

  function defaults() {
    return {
      coins: 0,
      owned: [1],
      selected: 1,
      mods: {},
      tires: ['stock'],
      tire: 'stock',
      best: { level: 1, time: 0, coins: 0, eaten: 0 },
      totalRuns: 0,
      settings: { sound: true, shadows: true, vibrate: true }
    };
  }

  var data = defaults();

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var d = defaults();
        for (var k in d) if (parsed[k] !== undefined) d[k] = parsed[k];
        d.settings = Object.assign(defaults().settings, parsed.settings || {});
        d.best = Object.assign(defaults().best, parsed.best || {});
        if (!Array.isArray(d.owned) || d.owned.indexOf(1) < 0) d.owned = [1].concat(d.owned || []);
        if (d.owned.indexOf(d.selected) < 0) d.selected = 1;
        if (!Array.isArray(d.tires) || d.tires.indexOf('stock') < 0) d.tires = ['stock'].concat(d.tires || []);
        if (d.tires.indexOf(d.tire) < 0) d.tire = 'stock';
        data = d;
      }
    } catch (e) { data = defaults(); }
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式等情况下忽略 */ }
  }

  DC.Save = {
    load: load,
    save: save,
    get data() { return data; },
    reset: function () { data = defaults(); save(); },
    modLevel: function (id) { return data.mods[id] || 0; },
    owns: function (level) { return data.owned.indexOf(level) >= 0; },
    ownsTire: function (id) { return data.tires.indexOf(id) >= 0; }
  };
  load();
})(window.DC);
