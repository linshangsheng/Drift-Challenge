/* 游戏数据：车辆、等级档次、主题、改装、经济公式 */
window.DC = window.DC || {};
// 使用正确的 sRGB 色彩管理，避免画面发灰
if (window.THREE && THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

(function (DC) {
  'use strict';

  // ---------- 车辆档次 ----------
  // from/to 为等级区间（含）
  DC.TIERS = [
    { id: 0, name: '入门微型车', from: 1, to: 10, color: '#9aa4b1' },
    { id: 1, name: '家用代步车', from: 11, to: 25, color: '#5cc96b' },
    { id: 2, name: '性能小钢炮', from: 26, to: 40, color: '#3fa7ff' },
    { id: 3, name: '运动跑车', from: 41, to: 55, color: '#a66bff' },
    { id: 4, name: '高性能跑车', from: 56, to: 70, color: '#ff8a3d' },
    { id: 5, name: '超级跑车', from: 71, to: 85, color: '#ff4d5e' },
    { id: 6, name: '顶级超跑', from: 86, to: 95, color: '#ffc93d' },
    { id: 7, name: '传奇 Hypercar', from: 96, to: 100, color: '#3df5ff' }
  ];

  // ---------- 100 辆车（从低到高） ----------
  // [品牌, 车型]
  var RAW = [
    // 1-10 入门微型车
    ['五菱', '宏光 MINI EV'], ['长安', '奔奔'], ['奇瑞', 'QQ'], ['比亚迪', '海鸥'], ['Smart', 'ForTwo'],
    ['菲亚特', '500'], ['铃木', 'Swift'], ['本田', '飞度'], ['丰田', 'Yaris'], ['MINI', 'Cooper'],
    // 11-25 家用代步车
    ['大众', 'Polo'], ['福特', '福克斯'], ['大众', '高尔夫'], ['丰田', '卡罗拉'], ['本田', '思域'],
    ['马自达', '3 昂克赛拉'], ['现代', '伊兰特'], ['丰田', '凯美瑞'], ['本田', '雅阁'], ['大众', '帕萨特'],
    ['马自达', 'MX-5'], ['斯巴鲁', 'BRZ'], ['丰田', 'GR86'], ['比亚迪', '汉'], ['特斯拉', 'Model 3'],
    // 26-40 性能小钢炮
    ['大众', '高尔夫 GTI'], ['本田', '思域 Type R'], ['丰田', 'GR Yaris'], ['斯巴鲁', 'WRX STI'], ['三菱', 'Lancer Evo X'],
    ['福特', 'Mustang GT'], ['雪佛兰', 'Camaro SS'], ['道奇', 'Challenger SRT'], ['宝马', 'M2'], ['奥迪', 'RS3'],
    ['梅赛德斯-AMG', 'A45 S'], ['日产', '370Z'], ['丰田', 'GR Supra'], ['宝马', 'M3'], ['奥迪', 'RS5'],
    // 41-55 运动跑车
    ['雷克萨斯', 'RC F'], ['梅赛德斯-AMG', 'C63 S'], ['凯迪拉克', 'CT5-V Blackwing'], ['阿尔法·罗密欧', 'Giulia QV'], ['保时捷', '718 Cayman GTS'],
    ['路特斯', 'Emira'], ['捷豹', 'F-Type R'], ['宝马', 'M4 CSL'], ['日产', 'GT-R Nismo'], ['雪佛兰', 'Corvette C8'],
    ['本田', 'NSX Type S'], ['阿斯顿·马丁', 'Vantage'], ['保时捷', '911 Carrera S'], ['奥迪', 'R8 V10'], ['梅赛德斯-AMG', 'GT Black Series'],
    // 56-70 高性能跑车
    ['宾利', 'Continental GT Speed'], ['玛莎拉蒂', 'MC20'], ['特斯拉', 'Model S Plaid'], ['保时捷', 'Taycan Turbo S'], ['保时捷', '911 Turbo S'],
    ['迈凯伦', 'Artura'], ['法拉利', 'Roma'], ['兰博基尼', 'Huracán EVO'], ['法拉利', '296 GTB'], ['迈凯伦', '720S'],
    ['保时捷', '911 GT3 RS'], ['法拉利', 'F8 Tributo'], ['兰博基尼', 'Huracán STO'], ['阿斯顿·马丁', 'DBS Superleggera'], ['法拉利', '812 Superfast'],
    // 71-85 超级跑车
    ['迈凯伦', '765LT'], ['兰博基尼', 'Aventador SVJ'], ['法拉利', 'SF90 Stradale'], ['兰博基尼', 'Revuelto'], ['福特', 'GT'],
    ['法拉利', 'Enzo'], ['保时捷', '918 Spyder'], ['迈凯伦', 'P1'], ['法拉利', 'LaFerrari'], ['梅赛德斯-AMG', 'ONE'],
    ['迈凯伦', 'Senna'], ['帕加尼', 'Huayra R'], ['帕加尼', 'Utopia'], ['柯尼塞格', 'Regera'], ['法拉利', 'Daytona SP3'],
    // 86-95 顶级超跑
    ['兰博基尼', 'Sián FKP 37'], ['Gordon Murray', 'T.50'], ['路特斯', 'Evija'], ['Pininfarina', 'Battista'], ['Rimac', 'Nevera'],
    ['阿斯顿·马丁', 'Valkyrie AMR Pro'], ['迈凯伦', 'Speedtail'], ['布加迪', 'Divo'], ['Hennessey', 'Venom F5'], ['SSC', 'Tuatara'],
    // 96-100 传奇 Hypercar
    ['柯尼塞格', 'Jesko'], ['布加迪', 'Chiron Super Sport 300+'], ['布加迪', 'Bolide'], ['布加迪', 'Tourbillon'], ['柯尼塞格', 'Jesko Absolut']
  ];

  DC.MAX_LEVEL = RAW.length; // 100

  // 车身颜色调色板
  var PALETTE = [
    '#e63946', '#f1faee', '#1d3557', '#457b9d', '#ffb703', '#fb8500', '#2a9d8f', '#8338ec',
    '#ff006e', '#3a86ff', '#06d6a0', '#ef476f', '#118ab2', '#073b4c', '#c0c0c0', '#222831',
    '#ffd60a', '#7209b7', '#f72585', '#4cc9f0', '#80ed99', '#d00000', '#ff7b00', '#5e60ce'
  ];
  // 传奇级别的专属配色
  var LEGEND_COLORS = {
    96: ['#f5f5f5', '#ff2a2a'],
    97: ['#0b1c3d', '#ff8c00'],
    98: ['#1450c8', '#e8e8e8'],
    99: ['#c7ccd6', '#1a5cff'],
    100: ['#ffffff', '#ffcc33']
  };

  function tierOf(level) {
    for (var i = 0; i < DC.TIERS.length; i++) {
      if (level >= DC.TIERS[i].from && level <= DC.TIERS[i].to) return DC.TIERS[i];
    }
    return DC.TIERS[DC.TIERS.length - 1];
  }
  DC.tierOf = tierOf;

  // ---------- 经济 / 性能公式 ----------
  function p(level) { return (level - 1) / (DC.MAX_LEVEL - 1); }

  // 游戏内速度（米/秒）
  DC.speedOf = function (level) { return 18 + 50 * Math.pow(p(level), 0.85); };
  // 仪表显示的极速（km/h）
  DC.kmhOf = function (level) { return Math.round(60 + 440 * Math.pow(p(level), 0.9)); };
  // 每秒金币收益
  DC.incomeOf = function (level) { return Math.pow(1.1, level - 1); };
  // 合成奖励
  DC.mergeBonusOf = function (level) { return Math.round(DC.incomeOf(level) * 3); };

  function niceRound(n) {
    if (n < 100) return Math.round(n);
    var mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / mag) * mag;
  }
  DC.niceRound = niceRound;
  DC.priceOf = function (level) {
    if (level <= 1) return 0;
    return niceRound(100 * Math.pow(1.13, level - 2));
  };

  DC.CARS = RAW.map(function (r, i) {
    var level = i + 1;
    var colors = LEGEND_COLORS[level] || [PALETTE[(level * 7) % PALETTE.length], PALETTE[(level * 11 + 3) % PALETTE.length]];
    return {
      level: level,
      brand: r[0],
      model: r[1],
      name: r[0] + ' ' + r[1],
      tier: tierOf(level),
      color: colors[0],
      accent: colors[1]
    };
  });
  DC.carOf = function (level) { return DC.CARS[Math.max(1, Math.min(DC.MAX_LEVEL, level)) - 1]; };

  // ---------- 改装（框架 + 部分已实装） ----------
  DC.MODS = [
    {
      id: 'magnet', name: '磁力吸附器', icon: '🧲', max: 5,
      desc: '扩大吃车范围，附近车辆会被自动吸过来',
      effectText: function (lv) { return '吸附半径 +' + (lv * 0.8).toFixed(1) + 'm'; },
      cost: function (lv) { return niceRound(600 * Math.pow(3, lv)); }
    },
    {
      id: 'turbo', name: '涡轮增收', icon: '💰', max: 10,
      desc: '每局获得的金币增加',
      effectText: function (lv) { return '金币收益 +' + (lv * 15) + '%'; },
      cost: function (lv) { return niceRound(400 * Math.pow(2.3, lv)); }
    },
    {
      id: 'grip', name: '竞技轮胎', icon: '🛞', max: 5,
      desc: '转弯半径更小，漂移更跟手',
      effectText: function (lv) { return '转向灵敏度 +' + (lv * 7) + '%'; },
      cost: function (lv) { return niceRound(900 * Math.pow(3, lv)); }
    },
    {
      id: 'shield', name: '坠崖护盾', icon: '🛡️', max: 3,
      desc: '冲出赛道时自动拉回赛道（每局次数）',
      effectText: function (lv) { return '每局免死 ' + lv + ' 次'; },
      cost: function (lv) { return niceRound(3000 * Math.pow(6, lv)); }
    },
    { id: 'nitro', name: '氮气加速', icon: '🔥', locked: true, desc: '敬请期待' },
    { id: 'paint', name: '车身涂装', icon: '🎨', locked: true, desc: '敬请期待' },
    { id: 'engine', name: '引擎调校', icon: '⚙️', locked: true, desc: '敬请期待' },
    { id: 'aero', name: '空力套件', icon: '🪽', locked: true, desc: '敬请期待' }
  ];
  DC.modOf = function (id) {
    for (var i = 0; i < DC.MODS.length; i++) if (DC.MODS[i].id === id) return DC.MODS[i];
    return null;
  };

  // ---------- 场景主题（按车头等级切换） ----------
  DC.THEMES = [
    { name: '黄昏峡谷', from: 1, skyTop: '#2b4c8c', skyBottom: '#ffb38a', fog: '#f4a582', sun: '#ffd2a1', sunI: 1.25,
      hemiSky: '#ffe2c4', hemiGround: '#6b4a3a', hemiI: 0.75, cloud: '#ffd7c2', mountain: '#8a5a4a', rock: '#7a5240',
      asphalt: '#3a3a40', edge: '#ffffff', edgeGlow: 0.15, stars: 0 },
    { name: '雪山之巅', from: 21, skyTop: '#3d7bd9', skyBottom: '#dff1ff', fog: '#d6ebff', sun: '#ffffff', sunI: 1.3,
      hemiSky: '#e8f4ff', hemiGround: '#7d8ea3', hemiI: 0.85, cloud: '#ffffff', mountain: '#e9f2fb', rock: '#8c97a6',
      asphalt: '#2f3540', edge: '#7fd3ff', edgeGlow: 0.25, stars: 0 },
    { name: '沙漠烈日', from: 41, skyTop: '#2f8fe0', skyBottom: '#fbe3a6', fog: '#f2d38e', sun: '#fff1c9', sunI: 1.45,
      hemiSky: '#fff3d6', hemiGround: '#a7743d', hemiI: 0.8, cloud: '#f7dca0', mountain: '#d49a55', rock: '#b9773e',
      asphalt: '#40372f', edge: '#ffd166', edgeGlow: 0.2, stars: 0 },
    { name: '霓虹夜城', from: 61, skyTop: '#070720', skyBottom: '#4a1170', fog: '#2a0b45', sun: '#b38cff', sunI: 0.7,
      hemiSky: '#8a6cff', hemiGround: '#1a0a2a', hemiI: 0.65, cloud: '#5a2a8a', mountain: '#24124a', rock: '#2a1d45',
      asphalt: '#15151f', edge: '#ff2bd6', edgeGlow: 1.6, stars: 1 },
    { name: '极光云端', from: 81, skyTop: '#020814', skyBottom: '#0f5a5a', fog: '#0b3a44', sun: '#9ffff0', sunI: 0.85,
      hemiSky: '#7fffe0', hemiGround: '#0a1a24', hemiI: 0.7, cloud: '#1f6f78', mountain: '#0d2a38', rock: '#1b3442',
      asphalt: '#101820', edge: '#3df5ff', edgeGlow: 1.8, stars: 1 }
  ];
  DC.themeIndexOf = function (level) {
    var idx = 0;
    for (var i = 0; i < DC.THEMES.length; i++) if (level >= DC.THEMES[i].from) idx = i;
    return idx;
  };

  // ---------- 数字格式化 ----------
  DC.fmt = function (n) {
    n = Math.floor(n);
    if (n < 10000) return n.toLocaleString('en-US');
    if (n < 99995000) return parseFloat((n / 1e4).toFixed(n < 1e5 ? 2 : 1)) + '万';
    if (n < 1e12) return parseFloat((n / 1e8).toFixed(2)) + '亿';
    return parseFloat((n / 1e12).toFixed(2)) + '万亿';
  };
  DC.fmtIncome = function (n) {
    if (n < 10) return n.toFixed(1);
    return DC.fmt(n);
  };
})(window.DC);
