/* 游戏数据：车辆、档次、轮胎、路面、主题、改装、经济公式 */
window.DC = window.DC || {};
// 使用正确的 sRGB 色彩管理，避免画面发灰
if (window.THREE && THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

(function (DC) {
  'use strict';

  // ---------- 车辆档次 ----------
  DC.TIERS = [
    { id: 0, name: '入门代步车', from: 1, to: 10, color: '#9aa4b1' },
    { id: 1, name: '城市家用车', from: 11, to: 22, color: '#5cc96b' },
    { id: 2, name: '城市特种车', from: 23, to: 34, color: '#3fd0c9' },
    { id: 3, name: 'SUV 越野', from: 35, to: 44, color: '#3fa7ff' },
    { id: 4, name: '性能跑车', from: 45, to: 58, color: '#a66bff' },
    { id: 5, name: '高性能跑车', from: 59, to: 72, color: '#ff8a3d' },
    { id: 6, name: '超级跑车', from: 73, to: 86, color: '#ff4d5e' },
    { id: 7, name: '顶级超跑', from: 87, to: 95, color: '#ffc93d' },
    { id: 8, name: '传奇 Hypercar', from: 96, to: 100, color: '#3df5ff' }
  ];

  // 911 系列的车身轮廓
  var F911 = { lights: 'round', tails: 'bar', pF: 2.1, ghOverride: { gR: -0.9, rR: -0.36, rF: -0.02, gF: 0.3, roof: 1.3, rwCurve: 0.62 } };
  function m(a, b) { return Object.assign({}, a, b); }

  // ---------- 100 辆车（从低到高）：[品牌, 车型, 车身类型, 主色, 辅色, 选项] ----------
  var RAW = [
    // 1-10 入门代步车
    ['五菱', '宏光 MINI EV', 'micro', '#f3b5c4', '#ffffff', { ev: true, roofColor: '#ffffff', sL: 0.95 }],
    ['奇瑞', 'QQ 冰淇淋', 'micro', '#9ed9c4', '#ffffff', { ev: true, roofColor: '#ffffff', lights: 'round' }],
    ['Smart', 'ForTwo', 'micro', '#f2c318', '#1a1a1a', { roofColor: '#1a1a1a', pillar: '#1a1a1a', sL: 0.84, lights: 'round' }],
    ['长安', '奔奔', 'hatch', '#e6e8eb', '#333333', { sL: 0.86, rims: 'steel' }],
    ['五菱', '宏光 面包车', 'microvan', '#f4f4f4', '#c0392b', {}],
    ['菲亚特', '500', 'micro', '#8fd1c4', '#ffffff', { sL: 1.1, lights: 'round', tails: 'round', roofColor: '#ffffff' }],
    ['大众', '甲壳虫', 'micro', '#f2c14e', '#ffffff', { sL: 1.3, sW: 1.08, lights: 'round', pF: 1.9, pR: 1.9, nTop: 2.2,
      ghOverride: { gR: -0.78, rR: -0.4, rF: -0.02, gF: 0.38, roof: 1.5, rwCurve: 0.7 } }],
    ['MINI', 'Cooper S', 'hatch', '#1f5240', '#ffffff', { sL: 0.94, roofColor: '#ffffff', lights: 'round', stripes: '#ffffff', rims: 'multi' }],
    ['铃木', '吉姆尼', 'offroad', '#6b8f3a', '#1a1a1a', { sL: 0.82, sW: 0.88, sH: 0.95 }],
    ['本田', '飞度', 'hatch', '#c8302c', '#222222', {}],
    // 11-22 城市家用车
    ['大众', '桑塔纳 出租车', 'sedan', '#2e9e5b', '#f2c200', { taxi: true, roofColor: '#f2c200', rims: 'steel' }],
    ['丰田', '卡罗拉', 'sedan', '#d9dde3', '#333333', {}],
    ['本田', '思域', 'sedan', '#1f3d7a', '#111111', { ghOverride: { gR: -0.72, rR: -0.32 } }],
    ['大众', '高尔夫', 'hatch', '#2b2b2b', '#cccccc', { rims: 'multi' }],
    ['丰田', '凯美瑞', 'sedan', '#8c1f28', '#cccccc', { sL: 1.03, grilleChrome: true }],
    ['本田', 'CR-V', 'suv', '#b8bec6', '#333333', {}],
    ['大众', '途观', 'suv', '#2f4a6e', '#cccccc', { grilleChrome: true }],
    ['别克', 'GL8 商务车', 'mpv', '#1d1d1f', '#cccccc', { grilleChrome: true, sL: 1.03 }],
    ['比亚迪', '汉', 'sedan', '#0f3b5f', '#cccccc', { ev: true, sL: 1.05, tails: 'bar', grilleChrome: true }],
    ['特斯拉', 'Model 3', 'sedan', '#e8e8ea', '#111111', { ev: true, grilleW: 0.05, grilleH: 0.02, ghOverride: { gR: -0.72, rR: -0.4 }, rims: 'turbine', roofColor: '#151a20' }],
    ['理想', 'L9', 'suv', '#5b6068', '#111111', { ev: true, sL: 1.1, sH: 1.03, tails: 'bar', lights: 'slim' }],
    ['小米', 'SU7', 'sedan', '#7fb8d9', '#111111', { ev: true, sH: 0.93, tails: 'bar', lights: 'slim', ghOverride: { gR: -0.78, rR: -0.36 }, caliper: '#f0c419', rims: 'multi' }],
    // 23-34 城市特种车
    ['江铃', '全顺 厢式货车', 'boxvan', '#ffffff', '#ff7a00', { decal: 'cargo' }],
    ['福特', 'F-150 皮卡', 'pickup', '#a3262a', '#cccccc', { grilleChrome: true }],
    ['宇通', '城市公交', 'bus', '#1f8f5a', '#ffffff', { roofColor: '#f0f0f0' }],
    ['宇通', '校车', 'schoolbus', '#f5c400', '#111111', {}],
    ['丰田', '海狮 救护车', 'boxvan', '#ffffff', '#e01e1e', { ambulance: true }],
    ['大众', '帕萨特 警车', 'sedan', '#ffffff', '#1846b8', { police: true, sL: 1.02 }],
    ['长城', '炮 越野皮卡', 'pickup', '#3d4a3a', '#111111', { rollbar: true }],
    ['亚历山大·丹尼斯', '双层观光巴士', 'dbus', '#c81d25', '#ffffff', {}],
    ['解放', 'J6 水罐消防车', 'fire', '#c40d0d', '#ffffff', {}],
    ['福特', 'Explorer 警车', 'suv', '#ffffff', '#1846b8', { police: true }],
    ['奔驰', 'Atego 云梯消防车', 'aerial', '#b80f0f', '#ffffff', {}],
    ['雪佛兰', 'Tahoe 道路救援', 'suv', '#f5f5f5', '#ffd400', { rescue: true, sL: 1.1, sH: 1.04 }],
    // 35-44 SUV 越野
    ['Jeep', '牧马人', 'offroad', '#d35400', '#1a1a1a', { roofColor: '#1a1a1a', grilleW: 0.9 }],
    ['丰田', '兰德酷路泽', 'suv', '#f0f0f0', '#cccccc', { sL: 1.04, sH: 1.05, grilleChrome: true }],
    ['路虎', '卫士', 'offroad', '#5a6b4f', '#f0f0f0', { roofColor: '#f0f0f0', sL: 1.05, lights: 'round', tails: 'round' }],
    ['福特', 'F-150 猛禽', 'pickup', '#2b6cb0', '#111111', { sW: 1.04 }],
    ['奔驰', 'G63 AMG', 'offroad', '#1b1b1b', '#cccccc', { sL: 1.06, exhaust: 2, rims: 'multi' }],
    ['GMC', '悍马 EV', 'pickup', '#e8e8e8', '#111111', { ev: true, sW: 1.06, lights: 'slim', tails: 'bar' }],
    ['保时捷', 'Cayenne Turbo GT', 'suv', '#4b4f54', '#111111', { sH: 0.93, rims: 'multi', caliper: '#d9a400', exhaust: 2, lights: 'slim', tails: 'bar' }],
    ['宝马', 'X5 M', 'suv', '#123b75', '#111111', { sH: 0.97, exhaust: 4, caliper: '#1846b8' }],
    ['劳斯莱斯', '库里南', 'suv', '#2a2a2e', '#c9c9c9', { roofColor: '#c9c9c9', grilleChrome: true, grilleW: 0.7, grilleH: 0.42, sL: 1.12, sH: 1.05, rims: 'multi' }],
    ['兰博基尼', 'Urus', 'suv', '#f2b705', '#111111', { sH: 0.86, rims: 'multi', caliper: '#111111', lights: 'slim', intake: true, exhaust: 4 }],
    // 45-58 性能跑车
    ['大众', '高尔夫 GTI', 'hatch', '#d7d7d7', '#cc0000', { wing: 'lip', rims: 'multi', caliper: '#cc0000', sporty: true, exhaust: 2 }],
    ['本田', '思域 Type R', 'hatch', '#f4f4f4', '#cc0000', { wing: 'wing', sL: 1.1, exhaust: 3, caliper: '#cc0000', sporty: true }],
    ['斯巴鲁', 'WRX STI', 'sedan', '#1f4fbf', '#d4af37', { wing: 'wing', rimColor: '#d4af37', scoop: true, exhaust: 4 }],
    ['福特', 'Mustang GT', 'muscle', '#1e5bd8', '#ffffff', { stripes: '#ffffff' }],
    ['雪佛兰', 'Camaro SS', 'muscle', '#f2b705', '#111111', { stripes: '#111111' }],
    ['道奇', 'Challenger SRT', 'muscle', '#8a0f0f', '#111111', { sL: 1.05, tails: 'bar' }],
    ['丰田', 'GR Supra', 'coupe', '#e03a1e', '#111111', { wing: 'duck', caliper: '#cc0000' }],
    ['宝马', 'M3', 'sedan', '#2f6b4f', '#111111', { wing: 'lip', exhaust: 4, sporty: true, caliper: '#1846b8', rims: 'y' }],
    ['日产', 'GT-R Nismo', 'coupe', '#e8e8e8', '#c00000', { wing: 'wing', sH: 1.06, tails: 'round', caliper: '#c00000', exhaust: 4, rims: 'multi' }],
    ['保时捷', '718 Cayman GTS', 'mid', '#c62828', '#111111', { sL: 0.95, exhaust: 3 }],
    ['雪佛兰', 'Corvette C8', 'mid', '#c4161c', '#111111', { exhaust: 4, caliper: '#f0c419' }],
    ['宝马', 'M4 CSL', 'coupe', '#e9e9e9', '#cc0000', { wing: 'duck', caliper: '#cc0000', exhaust: 4 }],
    ['保时捷', '911 Carrera S', 'coupe', '#2f78c4', '#111111', m(F911, {})],
    ['奥迪', 'R8 V10', 'mid', '#9aa0a6', '#111111', { caliper: '#cc0000' }],
    // 59-72 高性能跑车
    ['宾利', 'Continental GT', 'coupe', '#163a2d', '#cccccc', { sL: 1.06, grilleChrome: true, grilleW: 0.62, grilleH: 0.3, lights: 'round', rims: 'multi' }],
    ['特斯拉', 'Model S Plaid', 'sedan', '#b30f1f', '#111111', { ev: true, sL: 1.05, grilleW: 0.05, grilleH: 0.02, ghOverride: { gR: -0.82, rR: -0.38 }, rims: 'turbine', exhaust: 0 }],
    ['保时捷', 'Taycan Turbo S', 'sedan', '#4a7fb5', '#111111', { ev: true, sH: 0.9, tails: 'bar', lights: 'slim', ghOverride: { gR: -0.8, rR: -0.36 }, exhaust: 0, caliper: '#d9a400' }],
    ['梅赛德斯-AMG', 'GT Black Series', 'coupe', '#e86f00', '#111111', { wing: 'big', splitter: true, intake: true, caliper: '#d9a400' }],
    ['阿斯顿·马丁', 'DBS Superleggera', 'coupe', '#3c4a52', '#111111', { sL: 1.04, grilleW: 0.75, grilleH: 0.28, rims: 'y' }],
    ['法拉利', 'Roma', 'coupe', '#7f8f9a', '#111111', { caliper: '#d9a400' }],
    ['迈凯伦', 'Artura', 'mid', '#ff6a00', '#111111', { tails: 'bar' }],
    ['兰博基尼', 'Huracán EVO', 'mid', '#79b800', '#111111', { rims: 'y' }],
    ['兰博基尼', 'Huracán 警车', 'mid', '#ffffff', '#1846b8', { police: true }],
    ['法拉利', '296 GTB', 'mid', '#c00000', '#111111', { caliper: '#d9a400' }],
    ['保时捷', '911 GT3 RS', 'coupe', '#00b386', '#111111', m(F911, { wing: 'swan', splitter: true, rims: 'y' })],
    ['迈凯伦', '720S', 'mid', '#ff8c00', '#111111', { wing: 'lip' }],
    ['法拉利', 'F8 Tributo', 'mid', '#d40000', '#111111', { tails: 'round', caliper: '#d9a400' }],
    ['法拉利', '812 Superfast', 'coupe', '#a80000', '#111111', { sL: 1.04, tails: 'round' }],
    // 73-86 超级跑车
    ['迈凯伦', '765LT', 'mid', '#ff7a00', '#111111', { wing: 'lip', exhaust: 4, splitter: true }],
    ['兰博基尼', 'Aventador SVJ', 'mid', '#3fbf3f', '#111111', { wing: 'wing', sW: 1.02, sL: 1.05, tails: 'bar', exhaust: 3 }],
    ['法拉利', 'SF90 Stradale', 'mid', '#c8102e', '#111111', { caliper: '#d9a400' }],
    ['兰博基尼', 'Revuelto', 'mid', '#e64100', '#111111', { wing: 'lip', sL: 1.05, tails: 'bar' }],
    ['福特', 'GT', 'mid', '#1e4fd8', '#ffffff', { stripes: '#ffffff', wing: 'wing' }],
    ['法拉利', 'Enzo', 'hyper', '#d40000', '#111111', { fin: false, wing: 'lip' }],
    ['保时捷', '918 Spyder', 'mid', '#c0c4c8', '#111111', { wing: 'lip', tails: 'bar' }],
    ['迈凯伦', 'P1', 'hyper', '#ffcc00', '#111111', { wing: 'wing', fin: false }],
    ['法拉利', 'LaFerrari', 'hyper', '#c8102e', '#111111', { fin: false }],
    ['梅赛德斯-AMG', 'ONE', 'hyper', '#9ea4aa', '#111111', { wing: 'big' }],
    ['迈凯伦', 'Senna', 'hyper', '#ff6a00', '#111111', { wing: 'big', fin: false }],
    ['帕加尼', 'Huayra R', 'hyper', '#2a2d34', '#c8102e', { exhaustCenter: true, wing: 'lip' }],
    ['柯尼塞格', 'Regera', 'hyper', '#ffffff', '#111111', { pillar: '#0c0c0e', roofColor: '#0c0c0e', fin: false }],
    ['法拉利', 'Daytona SP3', 'hyper', '#c8102e', '#111111', { fin: false, tails: 'bar' }],
    // 87-95 顶级超跑
    ['Gordon Murray', 'T.50', 'hyper', '#2f6fb3', '#111111', { fin: false }],
    ['路特斯', 'Evija', 'hyper', '#d8dde2', '#ffcc00', { ev: true }],
    ['Rimac', 'Nevera', 'hyper', '#1f3f6b', '#111111', { ev: true, fin: false, tails: 'bar' }],
    ['阿斯顿·马丁', 'Valkyrie', 'hyper', '#0e5a4a', '#c0c0c0', { wing: 'big' }],
    ['迈凯伦', 'Speedtail', 'hyper', '#e6e6e6', '#111111', { sL: 1.12, fin: false }],
    ['布加迪', 'Divo', 'hyper', '#1a1a1a', '#3fa9f5', { split: { u: -0.12, color: '#3fa9f5' }, horseshoe: true, noPlate: true, wing: 'wing', stripes: '#3fa9f5' }],
    ['Hennessey', 'Venom F5', 'hyper', '#ff7a00', '#111111', { wing: 'lip' }],
    ['SSC', 'Tuatara', 'hyper', '#c0c0c0', '#111111', {}],
    ['帕加尼', 'Utopia', 'hyper', '#c9a14a', '#111111', { exhaustCenter: true, fin: false, tails: 'round' }],
    // 96-100 传奇 Hypercar
    ['柯尼塞格', 'Jesko', 'hyper', '#f5f5f5', '#ff2a2a', { pillar: '#0c0c0e', roofColor: '#0c0c0e', wing: 'big' }],
    ['布加迪', 'Chiron Super Sport 300+', 'hyper', '#111111', '#ff8c00', { split: { u: -0.1, color: '#2b2b2b' }, horseshoe: true, noPlate: true, stripes: '#ff8c00', sL: 1.05, fin: false }],
    ['布加迪', 'Bolide', 'hyper', '#1450c8', '#e8e8e8', { split: { u: -0.15, color: '#111111' }, horseshoe: true, noPlate: true, wing: 'big' }],
    ['布加迪', 'Tourbillon', 'hyper', '#c7ccd6', '#1a5cff', { split: { u: -0.1, color: '#1a5cff' }, horseshoe: true, noPlate: true, fin: false }],
    ['柯尼塞格', 'Jesko Absolut', 'hyper', '#ffffff', '#ffcc33', { pillar: '#0c0c0e', roofColor: '#0c0c0e', caliper: '#ffcc33' }]
  ];

  DC.MAX_LEVEL = RAW.length; // 100

  var TYPE_NAMES = {
    micro: '微型车', hatch: '两厢车', sedan: '轿车', suv: 'SUV', offroad: '硬派越野', pickup: '皮卡', mpv: 'MPV',
    microvan: '微型面包车', boxvan: '厢式车', bus: '公交车', dbus: '双层巴士', schoolbus: '校车', fire: '消防车',
    aerial: '云梯消防车', muscle: '肌肉车', coupe: 'GT 跑车', mid: '中置跑车', hyper: 'Hypercar'
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
  // 极速（米/秒），车越高级上限越高
  DC.speedOf = function (level) { return 20 + 46 * Math.pow(p(level), 0.9); };
  // 仪表显示的极速（km/h）
  DC.kmhOf = function (level) { return Math.round(60 + 440 * Math.pow(p(level), 0.9)); };
  DC.toKmh = function (v, level) { return v / DC.speedOf(level) * DC.kmhOf(level); };
  // 加速度（米/秒²）
  DC.accelOf = function (level) { return 16 + 45 * p(level); };
  // 下压力系数：车速越高轮胎法向载荷越大（高级车空气动力学更强）
  DC.downforceOf = function (level) { var v = DC.speedOf(level); return Math.max(0.04, 1 / 6.5 - 30 / (v * v)); };
  DC.incomeOf = function (level) { return Math.pow(1.1, level - 1); };
  DC.mergeBonusOf = function (level) { return Math.round(DC.incomeOf(level) * 3); };

  function niceRound(n) {
    if (n < 100) return Math.round(n);
    var mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / mag) * mag;
  }
  DC.niceRound = niceRound;
  DC.priceOf = function (level) {
    if (level <= 1) return 0;
    return niceRound(100 * Math.pow(1.14, level - 2));
  };

  DC.CARS = RAW.map(function (r, i) {
    var level = i + 1;
    return {
      level: level, brand: r[0], model: r[1], name: r[0] + ' ' + r[1],
      type: r[2], typeName: TYPE_NAMES[r[2]], color: r[3], accent: r[4], opts: r[5] || {},
      tier: tierOf(level)
    };
  });
  // 引擎类型（决定引擎声）：电动 / 柴油 / V8 / 高转跑车 / 普通四缸
  DC.engineTypeOf = function (level) {
    var c = DC.CARS[Math.max(1, Math.min(DC.MAX_LEVEL, level)) - 1];
    if (c.opts.ev) return 'ev';
    if (/^(bus|dbus|schoolbus|fire|aerial|boxvan|microvan)$/.test(c.type)) return 'diesel';
    if (/^(muscle|pickup|offroad)$/.test(c.type)) return 'v8';
    if (/^(coupe|mid|hyper)$/.test(c.type)) return 'exotic';
    return 'i4';
  };
  DC.ENGINE_NAMES = { ev: '⚡ 电动', diesel: '柴油机', v8: 'V8', exotic: '高转自吸/涡轮', i4: '四缸' };
  DC.carOf = function (level) { return DC.CARS[Math.max(1, Math.min(DC.MAX_LEVEL, level)) - 1]; };

  // ---------- 路面（随场景变化） ----------
  // mu：静摩擦系数倍率；kin：滑动摩擦相对静摩擦的比例倍率
  DC.SURFACES = {
    asphalt: { name: '干燥柏油', mu: 1.0, kin: 1.0 },
    snow: { name: '积雪路面', mu: 0.7, kin: 0.9 },
    sand: { name: '沙土路面', mu: 0.78, kin: 0.92 },
    wet: { name: '湿滑路面', mu: 0.8, kin: 0.9 },
    ice: { name: '结冰路面', mu: 0.6, kin: 0.85 }
  };

  // ---------- 轮胎 ----------
  // grip: 抓地力（越高滑行越短）；resp: 转向响应；surf: 不同路面的额外系数
  DC.TIRES = [
    { id: 'stock', kin: 0.78, drift: 1.0, name: '原厂轮胎', price: 0, grip: 1.0, resp: 1.0, color: '#8a8a8a', desc: '均衡的日常轮胎' },
    { id: 'eco', kin: 0.7, drift: 1.1, name: '节能轮胎', price: 300, grip: 0.8, resp: 0.9, color: '#5cc96b', desc: '硬胎面，抓地弱，滑得又远又飘' },
    { id: 'drift', kin: 0.62, drift: 1.3, name: '漂移专用胎', price: 1500, grip: 0.82, resp: 1.35, color: '#ff4d5e', desc: '转向极快、甩尾滑行长，最爽的漂移手感' },
    { id: 'allseason', kin: 0.8, drift: 1.0, name: '全天候轮胎', price: 4000, grip: 1.08, resp: 1.05, color: '#3fa7ff', desc: '各种路面都比较稳定', surf: { snow: 1.12, wet: 1.12, sand: 1.05, ice: 1.08 } },
    { id: 'sport', kin: 0.8, drift: 0.95, name: '高性能运动胎', price: 12000, grip: 1.2, resp: 1.15, color: '#ffb03d', desc: '干地抓地力强，湿地一般', surf: { wet: 0.92, snow: 0.85, ice: 0.85 } },
    { id: 'winter', kin: 0.8, drift: 1.0, name: '雪地胎', price: 20000, grip: 1.0, resp: 1.0, color: '#bfe6ff', desc: '雪地、冰面抓地大幅提升', surf: { snow: 1.45, ice: 1.4 } },
    { id: 'offroad', kin: 0.76, drift: 1.05, name: '全地形越野胎', price: 20000, grip: 0.95, resp: 0.95, color: '#a87b4f', desc: '沙土路面如履平地', surf: { sand: 1.5, snow: 1.15 } },
    { id: 'rain', kin: 0.8, drift: 1.0, name: '赛车雨胎', price: 60000, grip: 1.15, resp: 1.15, color: '#5ad0ff', desc: '湿滑路面的王者', surf: { wet: 1.5 } },
    { id: 'semislick', kin: 0.84, drift: 0.9, name: '半热熔轮胎', price: 150000, grip: 1.35, resp: 1.25, color: '#ff8a3d', desc: '赛道级抓地，过弯几乎不滑', surf: { wet: 0.9, snow: 0.8, ice: 0.8 } },
    { id: 'slick', kin: 0.86, drift: 0.85, name: '全热熔赛道胎', price: 800000, grip: 1.6, resp: 1.35, color: '#ff2a6d', desc: '干地极限抓地，雨雪天很危险', surf: { wet: 0.7, snow: 0.6, ice: 0.55, sand: 0.8 } },
    { id: 'legend', kin: 0.88, drift: 0.9, name: '传奇竞速胎', price: 5000000, grip: 1.8, resp: 1.45, color: '#3df5ff', desc: '全路面顶级抓地与响应', surf: { wet: 1.1, snow: 1.1, ice: 1.1, sand: 1.1 } }
  ];
  DC.tireOf = function (id) {
    for (var i = 0; i < DC.TIRES.length; i++) if (DC.TIRES[i].id === id) return DC.TIRES[i];
    return DC.TIRES[0];
  };
  DC.tireGrip = function (tire, surface) { return tire.grip * ((tire.surf && tire.surf[surface]) || 1); };

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
      id: 'engine', name: '引擎调校', icon: '⚙️', max: 5,
      desc: '提升加速度和极速上限',
      effectText: function (lv) { return '极速 +' + (lv * 3) + '% · 加速 +' + (lv * 10) + '%'; },
      cost: function (lv) { return niceRound(1500 * Math.pow(4, lv)); }
    },
    {
      id: 'shield', name: '坠崖护盾', icon: '🛡️', max: 3,
      desc: '冲出赛道时自动拉回赛道（每局次数）',
      effectText: function (lv) { return '每局免死 ' + lv + ' 次'; },
      cost: function (lv) { return niceRound(3000 * Math.pow(6, lv)); }
    },
    { id: 'nitro', name: '氮气加速', icon: '🔥', locked: true, desc: '敬请期待' },
    { id: 'paint', name: '车身涂装', icon: '🎨', locked: true, desc: '敬请期待' },
    { id: 'aero', name: '空力套件', icon: '🪽', locked: true, desc: '敬请期待' },
    { id: 'suspension', name: '悬挂系统', icon: '🔩', locked: true, desc: '敬请期待' }
  ];
  DC.modOf = function (id) {
    for (var i = 0; i < DC.MODS.length; i++) if (DC.MODS[i].id === id) return DC.MODS[i];
    return null;
  };

  // ---------- 场景主题（按车头等级切换，各自对应一种路面） ----------
  DC.THEMES = [
    { name: '黄昏峡谷', surface: 'asphalt', from: 1, skyTop: '#2b4c8c', skyBottom: '#ffb38a', fog: '#f4a582', sun: '#ffd2a1', sunI: 1.25,
      hemiSky: '#ffe2c4', hemiGround: '#6b4a3a', hemiI: 0.75, cloud: '#ffd7c2', mountain: '#8a5a4a', rock: '#7a5240',
      asphalt: '#3a3a40', edge: '#ffffff', edgeGlow: 0.15, stars: 0, env: 0.9, aurora: 0, sunSize: 420 },
    { name: '雪山之巅', surface: 'snow', from: 21, skyTop: '#3d7bd9', skyBottom: '#dff1ff', fog: '#d6ebff', sun: '#ffffff', sunI: 1.3,
      hemiSky: '#e8f4ff', hemiGround: '#7d8ea3', hemiI: 0.85, cloud: '#ffffff', mountain: '#e9f2fb', rock: '#8c97a6',
      asphalt: '#c9d3df', edge: '#2f8fd8', edgeGlow: 0.25, stars: 0, env: 1.0, aurora: 0, sunSize: 300 },
    { name: '沙漠烈日', surface: 'sand', from: 41, skyTop: '#2f8fe0', skyBottom: '#fbe3a6', fog: '#f2d38e', sun: '#fff1c9', sunI: 1.45,
      hemiSky: '#fff3d6', hemiGround: '#a7743d', hemiI: 0.8, cloud: '#f7dca0', mountain: '#d49a55', rock: '#b9773e',
      asphalt: '#b08a5a', edge: '#ffffff', edgeGlow: 0.2, stars: 0, env: 0.9, aurora: 0, sunSize: 460 },
    { name: '霓虹夜城', surface: 'wet', from: 61, skyTop: '#070720', skyBottom: '#4a1170', fog: '#2a0b45', sun: '#b38cff', sunI: 0.7,
      hemiSky: '#8a6cff', hemiGround: '#1a0a2a', hemiI: 0.65, cloud: '#5a2a8a', mountain: '#24124a', rock: '#2a1d45',
      asphalt: '#15151f', edge: '#ff2bd6', edgeGlow: 1.6, stars: 1, env: 0.45, aurora: 0, sunSize: 150 },
    { name: '极光冰原', surface: 'ice', from: 81, skyTop: '#020814', skyBottom: '#0f5a5a', fog: '#0b3a44', sun: '#9ffff0', sunI: 0.85,
      hemiSky: '#7fffe0', hemiGround: '#0a1a24', hemiI: 0.7, cloud: '#1f6f78', mountain: '#0d2a38', rock: '#1b3442',
      asphalt: '#3a6a7a', edge: '#3df5ff', edgeGlow: 1.8, stars: 1, env: 0.5, aurora: 1, sunSize: 120 }
  ];
  DC.themeIndexOf = function (level) {
    var idx = 0;
    for (var i = 0; i < DC.THEMES.length; i++) if (level >= DC.THEMES[i].from) idx = i;
    return idx;
  };

  // ---------- 成就 ----------
  // val(save, run) 返回当前进度；run 为刚结束的一局统计（可能为空）
  function ach(id, icon, name, desc, goal, reward, val) { return { id: id, icon: icon, name: name, desc: desc, goal: goal, reward: reward, val: val }; }
  var bestLv = function (s) { return s.best.level; };
  var runOf = function (key) { return function (s, r) { return Math.max(s.records ? (s.records[key] || 0) : 0, r ? (r[key] || 0) : 0); }; };
  DC.ACHIEVEMENTS = [
    ach('lv10', '🚗', '初出茅庐', '车头升到 Lv10', 10, 300, bestLv),
    ach('lv25', '🚌', '城市老司机', '车头升到 Lv25', 25, 3000, bestLv),
    ach('lv50', '🏎️', '赛道新星', '车头升到 Lv50', 50, 60000, bestLv),
    ach('lv75', '🔥', '超跑收割机', '车头升到 Lv75', 75, 1500000, bestLv),
    ach('lv100', '👑', '传奇车神', '车头升到 Lv100', 100, 30000000, bestLv),
    ach('eat20', '🍴', '开胃小菜', '单局吃到 20 辆车', 20, 200, runOf('eaten')),
    ach('eat60', '🍽️', '大胃王', '单局吃到 60 辆车', 60, 2000, runOf('eaten')),
    ach('eat150', '🐍', '贪吃长龙', '单局吃到 150 辆车', 150, 40000, runOf('eaten')),
    ach('time60', '⏱️', '站稳脚跟', '单局坚持 1 分钟', 60, 200, runOf('time')),
    ach('time180', '⏳', '稳如老狗', '单局坚持 3 分钟', 180, 3000, runOf('time')),
    ach('time420', '🧘', '人车合一', '单局坚持 7 分钟', 420, 80000, runOf('time')),
    ach('drift1k', '💨', '甩尾入门', '单局漂移得分 1,000', 1000, 300, runOf('driftPoints')),
    ach('drift10k', '🌪️', '漂移高手', '单局漂移得分 10,000', 10000, 5000, runOf('driftPoints')),
    ach('drift60k', '🌀', '秋名山车神', '单局漂移得分 60,000', 60000, 120000, runOf('driftPoints')),
    ach('jump10', '🦘', '飞行员', '单局飞跃 10 次', 10, 500, runOf('jumps')),
    ach('merge30', '🧬', '合成大师', '单局合成 30 次', 30, 1500, runOf('merges')),
    ach('coin100', '🪙', '捡钱达人', '单局捡到 100 个金币', 100, 800, runOf('coinsPicked')),
    ach('own5', '🅿️', '小车库', '拥有 5 辆车', 5, 500, function (s) { return s.owned.length; }),
    ach('own20', '🏢', '私人车库', '拥有 20 辆车', 20, 20000, function (s) { return s.owned.length; }),
    ach('own50', '🏛️', '汽车博物馆', '拥有 50 辆车', 50, 2000000, function (s) { return s.owned.length; }),
    ach('tire4', '🛞', '轮胎控', '拥有 4 种轮胎', 4, 2000, function (s) { return s.tires.length; }),
    ach('runs20', '🎮', '停不下来', '累计完成 20 局', 20, 1000, function (s) { return s.totalRuns; })
  ];

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
