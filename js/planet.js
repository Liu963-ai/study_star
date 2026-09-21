/* ============================================================
   组件 A：小星球动态吉祥物 · planet.js（任务书 §4）
   ------------------------------------------------------------
   三支 mp4（smile / happy / curious）状态轮播。
   实测：视频无透明通道，底色 #FDF7EE 与 --planet-bg 一致，
   直接贴页面无接缝；禁止抠图/混合模式/圆形裁切/描边。
   对外接口：
     const p = HHPlanet.mount('#planetBox', { size: 220, state: 'smile' });
     p.setState('happy');   // 同一时刻只显示一支
     p.destroy();
   ============================================================ */
window.HHPlanet = (function () {
  'use strict';

  /* 三个状态键与对应视频文件（assets/planets/） */
  const STATES = ['smile', 'happy', 'curious'];

  function mount(container, options) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) throw new Error('HHPlanet: 容器不存在');
    const opts = options || {};
    const size = (opts.size || 220) + 'px';
    let state = STATES.indexOf(opts.state) >= 0 ? opts.state : 'smile';
    const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* 容器：底色与视频底色一致，彻底消除接缝；禁止圆形裁切 */
    const box = document.createElement('div');
    box.className = 'hh-planet';
    box.style.width = size;
    box.style.height = size;
    box.style.background = 'var(--planet-bg, #FDF7EE)';
    host.innerHTML = '';
    host.appendChild(box);

    /* 一次性创建 3 个 <video>，同一时刻只显示一支 */
    const videos = {};
    STATES.forEach(key => {
      const v = document.createElement('video');
      v.src = 'assets/planets/planet-' + key + '.mp4';
      /* 属性必须同时具备：autoplay muted loop playsinline preload=auto；不得有 controls/poster */
      v.autoplay = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('preload', 'auto');
      v.setAttribute('aria-hidden', 'true');   /* 吉祥物是装饰，语义由 TTS 承担 */
      v.style.width = '100%';
      v.style.height = '100%';
      v.style.objectFit = 'contain';
      v.style.display = (key === state) ? 'block' : 'none';
      box.appendChild(v);
      videos[key] = v;
    });

    /* 减少动态：保留视频元素但暂停在首帧（不隐藏、不删除） */
    function applyReduced() {
      if (!reduced) return;
      STATES.forEach(k => { videos[k].pause(); try { videos[k].currentTime = 0; } catch (e) {} });
    }
    STATES.forEach(k => {
      videos[k].addEventListener('loadeddata', () => { if (reduced) applyReduced(); });
    });

    const api = {
      /* 切状态：只显示目标一支，其余 display:none */
      setState(name) {
        if (STATES.indexOf(name) < 0) return state;
        state = name;
        STATES.forEach(k => {
          const v = videos[k];
          if (k === state) {
            v.style.display = 'block';
            if (!reduced) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
          } else {
            v.style.display = 'none';
            v.pause();
          }
        });
        applyReduced();
        return state;
      },
      getState() { return state; },
      destroy() { box.remove(); }
    };

    /* 初始播放当前状态；隐藏的两支暂停（同一时刻只解码一支，§4.2） */
    STATES.forEach(k => { if (k !== state) videos[k].pause(); });
    if (!reduced) {
      const p = videos[state].play();
      if (p && p.catch) p.catch(() => {});
    } else {
      applyReduced();
    }
    return api;
  }

  return { mount: mount };
})();
