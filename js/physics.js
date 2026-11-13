/* 车辆动力学：基于轮胎滑移与摩擦的漂移物理（可在浏览器和 Node 中运行）
 *
 * 状态（单位质量，水平面）：位置 x,z；速度向量 vx,vz；车头朝向 psi；横摆角速度 r
 * 轮胎：按接地点滑移速度（侧向滑移 + 后轮空转）求摩擦力，大小受 μ·N 限制（摩擦圆）
 *   - 滑移率小于峰值：静摩擦线性区，抓地
 *   - 超过峰值：滑动摩擦，系数下降到 μk/μs，持续侧滑
 * 驱动：油门让后轮转速高于车速（空转），摩擦力随之偏向车头方向，提供推进与转向的合力
 * 驾驶员：玩家给出目标行进方向（±45°），驾驶员控制车头领先速度方向一个漂移角，
 *        车头不会转过目标方向；转动受转动惯量限制
 */
(function (root) {
  'use strict';
  var G = 30; // 游戏世界的重力加速度（与跳跃一致）

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  var Physics = { G: G };

  // 生成车辆参数
  // o: { top 极速, accel 发动机最大加速度, mu 总摩擦系数, kin 滑动/静摩擦比, D 下压力系数,
  //      len 车长, resp 转向响应, drift 漂移角倾向 }
  Physics.params = function (o) {
    var lenF = Math.pow(Math.max(1, o.len / 4.6), 0.9);
    return {
      top: o.top, accel: o.accel, mu: o.mu, kin: o.kin, D: o.D,
      yawK: 1.1 * o.resp / lenF,           // 最大横摆角加速度 = yawK * 抓地加速度
      rmaxK: o.resp / Math.sqrt(lenF),      // 最大横摆角速度系数（随车速提高）
      bmax: 0.7 * (o.drift || 1),           // 最大漂移角（rad）
      sp: 0.11,                             // 峰值滑移率
      air: false, slopeA: 0
    };
  };

  Physics.state = function (x, z, psi, v) {
    return { x: x, z: z, vx: Math.sin(psi) * v, vz: Math.cos(psi) * v, psi: psi, r: 0, wheel: v,
      out: { beta: 0, slipX: 0, slideV: 0, latA: 0, lonA: 0, wheelSpin: 0, v: v } };
  };

  // 单步积分；target 为目标行进方向
  Physics.step = function (st, P, target, h) {
    var vx = st.vx, vz = st.vz;
    var v = Math.sqrt(vx * vx + vz * vz);
    var chi = v > 0.5 ? Math.atan2(vx, vz) : st.psi;
    var A = P.mu * (G + P.D * v * v); // 轮胎能提供的最大摩擦加速度
    var out = st.out;

    // ---- 驾驶员：控制车头 ----
    if (!P.air) {
      var e = wrap(target - chi);
      var bd = clamp(e * 1.6, -P.bmax, P.bmax);
      var psiD = chi + bd;
      // 车头不超过目标方向
      if (e >= 0 && psiD > target) psiD = target;
      if (e < 0 && psiD < target) psiD = target;
      var rmax = P.rmaxK * (6 + 0.25 * v);
      var rd = clamp(wrap(psiD - st.psi) * 22, -rmax, rmax);
      var Y = P.yawK * A;
      var ra = clamp((rd - st.r) * 25, -Y, Y);
      st.r += ra * h;
      var before = wrap(target - st.psi);
      st.psi += st.r * h;
      var after = wrap(target - st.psi);
      if (before * after < 0 && Math.abs(before) < 1) { st.psi = target; st.r = 0; }
    } else {
      st.psi += st.r * h; // 空中保持角动量
    }

    var sn = Math.sin(st.psi), cs = Math.cos(st.psi);
    var fx = sn, fz = cs, sx = cs, sz = -sn;
    var u = vx * fx + vz * fz;   // 纵向速度
    var w = vx * sx + vz * sz;   // 侧向速度
    var beta = Math.atan2(w, Math.max(Math.abs(u), 0.5));

    if (P.air) {
      out.beta = beta; out.slipX = 0; out.slideV = 0; out.latA = 0; out.lonA = 0; out.wheelSpin = 0; out.v = v;
      st.x += vx * h; st.z += vz * h;
      return;
    }

    // ---- 油门：决定后轮转速（空转程度） ----
    var cb = Math.max(0.4, Math.cos(beta));
    var wheel;
    if (v < P.top) wheel = v / cb + Math.max(1.5, 0.22 * (P.top - v));
    else wheel = Math.max(0, u - 0.03 * v - (v - P.top) * 0.5);
    st.wheel += (wheel - st.wheel) * Math.min(1, h * 30);

    // ---- 轮胎摩擦（接地点滑移速度） ----
    var vref = Math.max(v, 4);
    var sl = w / vref, sk = (u - st.wheel) / vref;
    var sm = Math.sqrt(sl * sl + sk * sk);
    var x = sm / P.sp;
    var g = x <= 1 ? x : P.kin + (1 - P.kin) * Math.exp(-(x - 1) * 0.55);
    var Fl = 0, Fk = 0;
    if (sm > 1e-6) { Fl = -A * g * sl / sm; Fk = -A * g * sk / sm; }
    // 发动机功率限制推进力
    if (Fk > P.accel) Fk = P.accel;
    // 积分稳定：本步内不把侧向速度反向
    if (Math.abs(Fl * h) > Math.abs(w)) Fl = -w / h;
    Fk += P.slopeA;

    st.vx += (Fl * sx + Fk * fx) * h;
    st.vz += (Fl * sz + Fk * fz) * h;
    st.x += st.vx * h; st.z += st.vz * h;

    out.beta = beta; out.slipX = x; out.slideV = sm * vref; out.latA = Fl; out.lonA = Fk;
    out.wheelSpin = Math.max(0, st.wheel - u); out.v = v; out.A = A;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
  else root.DC.Physics = Physics;
})(typeof window !== 'undefined' ? window : this);
