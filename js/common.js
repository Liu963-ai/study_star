/* ============================================================
   「汉字小星球」公共逻辑 · common.js
   ------------------------------------------------------------
   各页共用能力：TTS 语音 / WebAudio 音效 / 星星任务进度 / 反馈条 /
   结算记账 gotoSettle / 图标注入 / 通用绑定。
   页面专属行为一律写在各自同名 js 里。
   ============================================================ */
window.HH = (function () {
  'use strict';

  /* ================= 本地存取：键名统一前缀 hh_（任务书 §7.5） ================= */
  const store = {
    get(key, def) {
      try { const v = localStorage.getItem('hh_' + key); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('hh_' + key, JSON.stringify(val)); } catch (e) {}
    },
    del(key) {
      try { localStorage.removeItem('hh_' + key); } catch (e) {}
    }
  };

  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let muted = store.get('muted', false);

  /* 浏览器自带 TTS（降级通道）：本地 edge-tts 服务不可用时自动启用 */
  let zhVoice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    zhVoice = vs.find(v => /zh[-_]CN/i.test(v.lang))
           || vs.find(v => /zh|chinese|中文/i.test(v.lang + v.name)) || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function browserSpeak(text, opt) {
    opt = opt || {};
    if (!('speechSynthesis' in window) || !text) return null;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'zh-CN';
    u.rate = opt.rate || 0.95;
    u.pitch = 1.1;
    if (zhVoice) u.voice = zhVoice;
    if (opt.onstart)    u.onstart = opt.onstart;
    if (opt.onend)      u.onend = opt.onend;
    if (opt.onboundary) u.onboundary = opt.onboundary;
    speechSynthesis.speak(u);
    return u;
  }
  /* 统一语音出口：默认走本地 edge-tts 服务（js/tts.js），
     服务未启动或合成出错时自动降级为 browserSpeak，不阻塞主流程。 */
  function speak(text, opt) {
    opt = opt || {};
    if (muted || !text) return null;
    stopSpeak();
    if (window.HHTTS) return window.HHTTS.speak(String(text), opt, browserSpeak);
    return browserSpeak(text, opt);
  }
  function stopSpeak() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (window.HHTTS) window.HHTTS.stop();
  }

  /* ================= 轻音效：WebAudio 现场合成（§7.3），不引音频文件 ================= */
  let audioCtx = null;
  function ctx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, t0, dur, vol, type) {
    const c = ctx();
    if (!c || muted) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const s = c.currentTime + t0;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(vol, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, s + dur);
    o.connect(g).connect(c.destination);
    o.start(s); o.stop(s + dur + 0.05);
  }
  const sfx = {
    tap()  { tone(520, 0, .08, .07, 'triangle'); },                                /* 按下 */
    ok()   { tone(660, 0, .15, .09); tone(880, .12, .25, .09); },                  /* 答对 */
    star() { tone(784, 0, .12, .08); tone(988, .09, .12, .08); tone(1175, .18, .3, .08); }, /* 星星 */
    hmm()  { tone(392, 0, .2, .05, 'triangle'); }                                  /* 再试一次 */
  };

  /* ================= 星星 / 任务 / 进度（键名表 §7.5） =================
     初始数值全部归零（P1 修复）：新用户从 0 开始积累，
     老用户已有 hh_ 存储值不受影响（仅改默认值）。 */
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function getStars() { return store.get('stars', 0); }
  function addStars(n) {
    const s = getStars() + n;
    store.set('stars', s);
    /* 本周与今日收集同步累计（只加不减） */
    store.set('weekStars', store.get('weekStars', 0) + n);
    const t = store.get('todayStars', { date: todayKey(), n: 0 });
    if (t.date !== todayKey()) { t.date = todayKey(); t.n = 0; }
    t.n += n;
    store.set('todayStars', t);
    refreshStarUI();
    return s;
  }
  /* 页面上所有 [data-star-count] 同步数字并跳动一下 */
  function refreshStarUI() {
    document.querySelectorAll('[data-star-count]').forEach(el => {
      el.textContent = getStars();
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    });
  }

  /* 今日任务（跨天自动清零）：{ pinyin:true, shengzi:true, langdu:true } */
  function getTasks() {
    const t = store.get('tasks', { date: todayKey(), done: {} });
    if (t.date !== todayKey()) { t.date = todayKey(); t.done = {}; store.set('tasks', t); }
    return t.done;
  }
  function completeTask(mod) {
    const done = getTasks();
    done[mod] = true;
    store.set('tasks', { date: todayKey(), done });
  }
  /* 各模块通关进度（0–4） */
  function getProgress(mod) { const p = store.get('progress', {}); return p[mod] || 0; }
  function addProgress(mod, max) {
    const p = store.get('progress', {});
    const before = p[mod] || 0;
    p[mod] = Math.min(before + 1, max || 4);
    store.set('progress', p);
    return { before, after: p[mod] };
  }

  /* ================= 反馈提示条（琥珀 + 🔶，绝不报错） ================= */
  function toast(text) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>🔶</span><span></span>';
    el.lastChild.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  /* ================= 结算记账 gotoSettle（§7.4） =================
     关数/星星/任务/通关进度/成长树阶段/徽章 一次性在这里记账，
     结算页只负责播动画——在结算页刷新不会重复得分。 */
  function gotoSettle(opt) {
    opt = opt || {};
    const n = opt.stars == null ? 3 : opt.stars;
    addStars(n);
    if (opt.task) completeTask(opt.task);
    const prog = opt.module ? addProgress(opt.module, 4) : null;

    /* 成长树阶段：每完成 2 关 +1，上限 6；关数 = 各模块进度总和（单调递增） */
    const p = store.get('progress', {});
    const totalDone = (p.pinyin || 0) + (p.shengzi || 0) + (p.langdu || 0) + (p.jushi || 0);
    const prevStage = store.get('treeStage', 1);
    const nowStage = Math.min(6, 1 + Math.floor(totalDone / 2));
    const grew = nowStage > prevStage;
    if (grew) store.set('treeStage', nowStage);
    if (grew) store.set('treeGrew', true);

    /* 本次新解锁的徽章：该模块进度恰好在本关达到 4/4 */
    let badge = null;
    const BADGE_NAME = { pinyin: '拼音小达人', shengzi: '识字小能手', langdu: '朗读小明星', jushi: '造句小诗人' };
    if (prog && prog.before < 4 && prog.after >= 4 && BADGE_NAME[opt.module]) {
      badge = { id: opt.module, name: BADGE_NAME[opt.module] };
    }

    /* 今日读了什么（家长报告用，按天记录最后一次朗读的课文） */
    if (opt.readTitle) {
      store.set('readLog', { date: todayKey(), title: opt.readTitle });
    }

    store.set('lastSession', {
      count: 1,                        /* 结算标题「你完成了 N 关」的 N */
      title: opt.title || '你完成了 1 关',
      sub: opt.sub || '',
      stars: n,
      stage: nowStage, prevStage: prevStage, grew: grew,
      badge: badge,
      readTitle: opt.readTitle || ''   /* 今天读了什么（家长报告用） */
    });
    setTimeout(() => { location.href = 'jiesuan.html'; }, 400);
  }

  /* ================= 图标库：13 个必备内联 SVG（§6.0） =================
     统一 viewBox 0 0 24 24、fill none、stroke currentColor、宽 2.5、圆头圆角 */
  const ICONS = {
    home:   '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    map:    '<path d="M9 4 15 6 21 4v14l-6 2-6-2-6 2V6z"/><path d="M9 4v14M15 6v14"/>',
    mic:    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
    jar:    '<ellipse cx="12" cy="10" rx="6" ry="2.4"/><path d="M7.2 12c.4 4.6 2 8 4.8 8s4.4-3.4 4.8-8"/><path d="M12 3.2l.8 1.5 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z"/>',
    lock:   '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    planet: '<circle cx="12" cy="12" r="5.5"/><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-18 12 12)"/>',
    tree:   '<path d="M12 3.2c2.7 0 4.9 1.9 5.2 4.4 1.9.6 3.3 2.3 3.3 4.3 0 2.5-2.1 4.6-4.7 4.6H8.2C5.6 16.5 3.5 14.5 3.5 12c0-2 1.4-3.7 3.3-4.3C7 5.1 9.3 3.2 12 3.2z"/><path d="M12 16.5V21"/><path d="M9 21h6"/>',
    mask:   '<path d="M4 4h16v8a8 8 0 0 1-16 0V4z"/><path d="M8.5 9h.01M15.5 9h.01"/><path d="M9 13c1 1.3 5 1.3 6 0"/>',
    blocks: '<rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><rect x="8" y="3" width="8" height="8" rx="1.5"/>',
    speaker:'<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/>',
    muted:  '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M16 9l6 6M22 9l-6 6"/>',
    star:   '<path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.3-.8L12 3z"/>',
    back:   '<path d="M15 4l-8 8 8 8"/>',
    smile:  '<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01"/><path d="M8.5 14c1.3 1.8 5.7 1.8 7 0"/>',
    play:   '<path d="M8 5v14l11-7-11-7z"/>',
    pause:  '<path d="M8 5v14M16 5v14"/>',
    replay1:'<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>',
    replay: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
    pen:    '<path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z"/>',
    train:  '<rect x="5" y="4" width="11" height="12" rx="3"/><path d="M5 12h11"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="19" r="1.6"/><path d="M16 7h4v5"/>'
  };
  /* 生成一个内联 SVG 图标字符串 */
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           (ICONS[name] || '') + '</svg>';
  }
  /* 把页面上所有 <i data-ico="名称"> 占位替换为内联 SVG */
  function injectIcons(root) {
    (root || document).querySelectorAll('[data-ico]').forEach(el => {
      if (el.dataset.icoDone) return;
      el.innerHTML = icon(el.dataset.ico);
      el.classList.add('ico');
      el.dataset.icoDone = '1';
    });
  }

  /* ---------- 语音可用性：首次点击解锁音频（自动播放策略）+ 预热 ---------- */
  function setupAudio() {
    /* 1) 首次任意点击：解锁音频（Chrome 在用户交互前会拒绝网页播放声音），
          并把排队中的自动播报补播出来 */
    const unlock = () => { if (window.HHTTS && window.HHTTS.unlockAudio) window.HHTTS.unlockAudio(); };
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    /* 2) 页面加载后预热：把本页所有 [data-say] 点击文案提前合成进缓存，
          孩子点击图标时秒播（预热在后台进行，不阻塞页面） */
    setTimeout(() => {
      if (!window.HHTTS || !window.HHTTS.prewarm) return;
      const texts = [...new Set(
        [...document.querySelectorAll('[data-say]')].map(e => e.getAttribute('data-say'))
      )];
      if (texts.length) window.HHTTS.prewarm(texts);
    }, 600);
  }

  /* ================= 通用绑定 ================= */
  function bindCommon() {
    /* 所有可按压元素：按下播放轻响 */
    document.querySelectorAll('.pressable').forEach(el => {
      el.addEventListener('pointerdown', () => sfx.tap());
    });
    /* 返回按钮 → 回首页并停语音 */
    document.querySelectorAll('.back-btn').forEach(el => {
      el.addEventListener('click', () => { stopSpeak(); location.href = 'home.html'; });
    });
    /* 音量开关：图标切换 + 打开时播报「声音打开啦」 */
    document.querySelectorAll('.btn-volume').forEach(el => {
      el.innerHTML = icon(muted ? 'muted' : 'speaker');
      el.addEventListener('click', () => {
        muted = !muted;
        store.set('muted', muted);
        document.querySelectorAll('.btn-volume').forEach(b => { b.innerHTML = icon(muted ? 'muted' : 'speaker'); });
        if (!muted) speak('声音打开啦');
      });
    });
    /* [data-say]：点击播报（话术只用任务书 §7.2 表内的句子） */
    document.querySelectorAll('[data-say]').forEach(el => {
      el.addEventListener('click', () => speak(el.getAttribute('data-say')));
    });
    /* [data-href]：有 data-say 先播报，稍候 350ms 再跳（避免语音被截断） */
    document.querySelectorAll('[data-href]').forEach(el => {
      el.addEventListener('click', () => {
        const say = el.getAttribute('data-say');
        if (say) speak(say);
        setTimeout(() => { location.href = el.getAttribute('data-href'); }, say ? 350 : 0);
      });
    });
    injectIcons(document);
    navLabels();
    refreshStarUI();
    registerSW();
    setupAudio();
  }

  /* ---------- 底部导航文字标签（P1 修复：一年级不识字，图标需配文字） ---------- */
  function navLabels() {
    const MAP = { 'home.html': '首页', 'ditu.html': '闯关', 'langdu.html': '朗读',
                  'pinyin.html': '朗读', 'shengzi.html': '朗读', 'jushi.html': '朗读',
                  'jiangli.html': '奖励', 'parent.html': '家长' };
    const here = MAP[location.pathname.split('/').pop()] || '首页';
    document.querySelectorAll('.navbar .nav-btn').forEach(btn => {
      if (btn.querySelector('.nav-txt')) return;
      const s = document.createElement('span');
      s.className = 'nav-txt';
      s.textContent = MAP[btn.getAttribute('data-href')] || here;
      btn.appendChild(s);
    });
  }

  /* ---------- PWA：Service Worker 注册（离线可用，仅 http/https 环境） ---------- */
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', bindCommon);
  window.addEventListener('beforeunload', stopSpeak);

  /* ---------- 对外接口 ---------- */
  return { store, reduceMotion, speak, stopSpeak, sfx, toast, icon, injectIcons,
           getStars, addStars, getTasks, completeTask, getProgress, addProgress,
           gotoSettle };
})();
