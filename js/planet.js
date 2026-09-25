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

    /* 一次性创建 3 个 <video>，同一时刻只显示一支。
       只给「当前状态」挂 src，其余两支把地址存在 data-src 里、preload=none：
       三支 mp4 合计约 13MB，全量挂 src 会让 index/home/jiesuan 三个页面
       首屏白白多下 8MB 以上（手机 4G 约多等 6-10 秒）。
       切到某个状态时才真正开始下载那一支。 */
    const videos = {};
    STATES.forEach(key => {
      const v = document.createElement('video');
      /* 属性必须同时具备：autoplay muted loop playsinline；不得有 controls/poster */
      v.autoplay = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute('aria-hidden', 'true');   /* 吉祥物是装饰，语义由 TTS 承担 */
      if (key === state) {
        v.src = 'assets/planets/planet-' + key + '.mp4';
        v.setAttribute('preload', 'auto');
      } else {
        v.dataset.src = 'assets/planets/planet-' + key + '.mp4';
        v.setAttribute('preload', 'none');
      }
      v.style.width = '100%';
      v.style.height = '100%';
      v.style.objectFit = 'contain';
      v.style.display = (key === state) ? 'block' : 'none';
      box.appendChild(v);
      videos[key] = v;
    });
    /* 需要时才下载该状态的视频（只下载一次，之后复用） */
    function ensureSrc(v) {
      if (!v.src && v.dataset.src) {
        v.src = v.dataset.src;
        delete v.dataset.src;
      }
    }

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
            ensureSrc(v);
            v.style.display = 'block';
            if (!reduced && !document.hidden) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
          } else {
            v.style.display = 'none';
            v.pause();
          }
        });
        applyReduced();
        return state;
      },
      getState() { return state; },
      destroy() {
        document.removeEventListener('visibilitychange', onVisible);
        STATES.forEach(k => { try { videos[k].pause(); } catch (e) {} });
        box.remove();
      }
    };

    /* 页面不可见（切到别的 App / 锁屏）时暂停解码：
       吉祥物是 loop 视频，后台继续解码会白耗流量与电。 */
    function onVisible() {
      const v = videos[state];
      if (!v) return;
      if (document.hidden) { try { v.pause(); } catch (e) {} }
      else if (!reduced) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    }
    document.addEventListener('visibilitychange', onVisible);

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
