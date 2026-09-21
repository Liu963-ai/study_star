/* ============================================================
   成长树动态形象 · tree-motion.js
   ------------------------------------------------------------
   依赖：js/tree-motion-data.js（阶段元数据）+ css/tree-motion.css
   把「地面/树干/树冠/果实」分层图叠回原位，交给 CSS 分层驱动动效。

   用法：
     const tm = TreeMotion.mount('#box', {
       stage: 3,              // 初始阶段 1-6
       mode: 'idle',          // idle 待机摇曳 | grow 生长循环 | gallery 六阶一览
       wind: 1,               // 风力倍率（0.55 微风 / 1 和风 / 1.6 劲风）
     });
     tm.setStage(5);  tm.setMode('grow');  tm.setWind(1.6);
     tm.on('stage', fn);  tm.destroy();
   ============================================================ */
window.TreeMotion = (function () {
  'use strict';

  var STAGES = window.TREE_MOTION_DATA.stages;
  var ASSET = 'assets/tree-motion/';
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function h(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function img(src, cls, parent) {
    var e = h('img', cls, parent);
    e.src = src; e.alt = ''; e.draggable = false;
    return e;
  }
  function pct(v) { return (v * 100).toFixed(3) + '%'; }
  function clampStage(n) { return Math.min(6, Math.max(1, n | 0)); }

  /* ---------- 单阶段实例：地面 + 摆动系统(干/冠/呼吸/果实) ---------- */
  function buildStage(meta) {
    var root = h('div', 'gtm');
    root.dataset.stage = meta.id;
    root.style.setProperty('--px', meta.pivot.x);
    root.style.setProperty('--py', meta.pivot.y);
    root.style.setProperty('--leaf-a', meta.palette[0]);
    root.style.setProperty('--leaf-b', meta.palette[1] || meta.palette[0]);

    var base = ASSET + meta.dir + '/';
    img(base + 'ground.png', 'gtm__lyr', root);

    var sway = h('div', 'gtm__sway', root);
    var tg = h('div', 'gtm__trunkg', sway);
    img(base + 'trunk.png', 'gtm__lyr', tg);

    var cg = h('div', 'gtm__canopyg', sway);
    var br = h('div', 'gtm__breath', cg);
    img(base + 'canopy.png', 'gtm__lyr', br);
    (meta.fruits || []).forEach(function (f, i) {
      var d = h('div', 'gtm__fruit', br);
      d.style.left = pct(f.x); d.style.top = pct(f.y);
      d.style.width = pct(f.w); d.style.height = pct(f.h);
      d.style.setProperty('--fd', (-i * 1.15) + 's');
      img(base + 'fruit-' + i + '.png', '', d);
    });
    return root;
  }

  /* ---------- 待机氛围粒子：3 落叶 + 3 星尘 ---------- */
  function buildFx(meta, root) {
    var fx = h('div', 'gtm__fx', root);
    var cp = meta.canopy;
    for (var i = 0; i < 3; i++) {
      var lx = cp.x + cp.w * (0.62 - 0.24 * i);
      var ly = cp.y + cp.h * (0.10 + 0.06 * i);
      var fallY = 0.905 - ly;                       /* 落到草皮上沿附近 */
      var L = h('div', 'gtm__leaf', fx);
      L.style.setProperty('--lx', pct(lx));
      L.style.setProperty('--ly', pct(ly));
      L.style.setProperty('--dx-mid', pct(-0.05 - 0.03 * i));
      L.style.setProperty('--dy-mid', pct(fallY * 0.55));
      L.style.setProperty('--dx-end', pct(-0.10 - 0.045 * i));
      L.style.setProperty('--dy-end', pct(fallY));
      L.style.setProperty('--ld', (-i * 2.4) + 's');
      L.style.setProperty('--ls', pct(0.030 + 0.007 * (i % 2)));
      h('i', '', L);
    }
    [[0.16, 0.20], [0.86, 0.12], [0.52, -0.03]].forEach(function (p, i) {
      var T = h('div', 'gtm__tw', fx);
      T.style.setProperty('--sx', pct(cp.x + cp.w * p[0]));
      T.style.setProperty('--sy', pct(Math.max(0.01, cp.y + cp.h * p[1])));
      T.style.setProperty('--td', (-i * 1.6) + 's');
      T.style.setProperty('--ss', pct(0.020 + 0.007 * (i % 2)));
      h('span', '', T);
    });
    return fx;
  }

  /* ---------- 生长循环的转场星尘（六组 × 六颗，向外辐射） ---------- */
  function buildBursts(root) {
    for (var g = 0; g < 6; g++) {
      var meta = STAGES[(g + 1) % 6];              /* 在“下一阶登场”处迸发 */
      var cp = meta.canopy;
      var cx = cp.x + cp.w / 2, cy = cp.y + cp.h * 0.42;
      for (var k = 0; k < 6; k++) {
        var W = h('div', 'gtm__burst', root);
        W.style.setProperty('--bd', 'calc(' + (g * 4) + 's + ' + (k * 0.05).toFixed(2) + 's)');
        var a = (k / 6) * Math.PI * 2 + g * 0.7;
        var r = 0.13 + 0.05 * (((k + g) % 3) / 2);
        W.style.setProperty('--bx', pct(Math.cos(a) * r));
        W.style.setProperty('--by', pct(Math.sin(a) * r * 0.9));
        W.style.setProperty('--sx', pct(cx));
        W.style.setProperty('--sy', pct(cy));
        W.style.setProperty('--ss', pct(0.015 + 0.011 * ((k + g) % 2)));
        h('span', '', W);
      }
    }
  }

  /* ---------- 组件主体 ---------- */
  function mount(container, options) {
    var host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) throw new Error('TreeMotion: 容器不存在');
    var opts = options || {};
    var state = {
      stage: clampStage(opts.stage || 3),
      mode: opts.mode || 'idle',
      wind: opts.wind || 1
    };
    var listeners = {};

    var root = h('div', 'tm-root', host);
    root.style.setProperty('--wind', state.wind);

    function emit(ev, a, b) {
      (listeners[ev] || []).forEach(function (fn) { try { fn(a, b); } catch (e) {} });
    }
    function render() {
      root.innerHTML = '';
      if (state.mode === 'grow') {
        var wrap = h('div', 'gtm-cycle', root);
        wrap.classList.add('gtm--grow-clock');
        STAGES.forEach(function (m, i) {
          var s = buildStage(m);
          s.classList.add('gtm--grow-clock');
          s.style.setProperty('--i', i);
          if (i + 1 === state.stage) s.dataset.current = '1';
          wrap.appendChild(s);
        });
        buildBursts(wrap);
      } else if (state.mode === 'gallery') {
        var grid = h('div', 'gtm-gallery', root);
        STAGES.forEach(function (m) {
          var cell = h('div', 'gtm-cell', grid);
          var s = buildStage(m);
          s.appendChild(buildFx(m, s));
          cell.appendChild(s);
          h('div', 'gtm-cap', cell).textContent = '0' + m.id + ' ' + m.name;
        });
      } else {
        var meta = STAGES[state.stage - 1];
        var s = buildStage(meta);
        buildFx(meta, s);
        root.setAttribute('role', 'img');
        root.setAttribute('aria-label', '成长树·第' + meta.id + '阶段 ' + meta.name + '（动态）');
        root.appendChild(s);
      }
    }

    var api = {
      el: root,
      getStage: function () { return state.stage; },
      getMode: function () { return state.mode; },
      setStage: function (n) {
        var next = clampStage(n);
        var prev = state.stage;
        state.stage = next;
        if (state.mode !== 'idle') { state.mode = 'idle'; render(); }
        else { render(); }
        emit('stage', next, prev);
        return next;
      },
      setMode: function (m) {
        if (REDUCED && m === 'grow') m = 'idle';   /* 减少动态：循环退化为待机 */
        if (['idle', 'grow', 'gallery'].indexOf(m) < 0) m = 'idle';
        state.mode = m;
        render();
        emit('mode', m);
        return m;
      },
      setWind: function (w) {
        state.wind = Math.max(0, w || 1);
        root.style.setProperty('--wind', state.wind);
        emit('wind', state.wind);
        return state.wind;
      },
      on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      destroy: function () { root.remove(); }
    };

    render();
    return api;
  }

  return { mount: mount, STAGES: STAGES };
})();
