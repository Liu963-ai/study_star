/* ============================================================
   学情计算模块 · report.js（P0-2：家长报告接入真实数据）
   ------------------------------------------------------------
   1) 学习时长追踪：在四个学习页自动记录在站时长（10s 心跳 +
      页面离开兜底，页面意外关闭最多丢 10 秒），存 hh_sessionLog
   2) 学情指标：全部由既有真实键计算——
      hh_charLog（今日新学字）/ hh_tasks（今日完成站数）/
      hh_progress（模块进度）/ hh_sessionLog（今日时长）/
      hh_readLog（今天读了什么）
   3) 原则：只呈现趋势与方向；零数据给鼓励引导；多天未学如实呈现；
      严禁虚构或补零美化。
   ============================================================ */
window.Report = (function () {
  'use strict';

  const LEARN_PAGES = ['pinyin.html', 'shengzi.html', 'langdu.html', 'jushi.html'];
  const MODS = [
    { id: 'pinyin',  cn: '拼音星球', short: '拼音', color: 'var(--c-pinyin)' },
    { id: 'shengzi', cn: '生字森林', short: '识字', color: 'var(--c-shengzi)' },
    { id: 'langdu',  cn: '朗读剧场', short: '朗读', color: 'var(--c-langdu)' },
    { id: 'jushi',   cn: '词语乐园', short: '词句', color: 'var(--primary)' }
  ];

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function readJSON(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v || def; }
    catch (e) { return def; }
  }
  function isLearnPage() {
    return LEARN_PAGES.some(p => location.pathname.endsWith(p));
  }

  /* ---- 在站时长追踪：仅在四个学习页生效（10s 心跳 + 离开兜底） ----
     达到家长设置的每日上限（hh_dailyLimit 分钟，默认 20）后，
     在学习页显示温和的收尾遮罩（不含任何惩罚意味）。

     只计「页面可见且在交互」的时间：
     · 页面切到后台（document.hidden）不计——Chrome 会把后台定时器节流到
       约 1 次/分，但每次仍会加上真实的 60s「停留」，一个后台标签页放一夜
       就能刷出几百分钟假数据，并把孩子当天的时长上限顶掉（被遮罩锁住）。
     · 连续 60s 没有触摸/点击/按键视为离开（去吃饭、睡着了）不计。 */
  const IDLE_MS = 60000;
  let lastTouch = Date.now();
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev =>
    document.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));

  function track() {
    if (!isLearnPage()) return;
    const s = readJSON('hh_sessionLog', { date: todayKey(), sec: 0, last: Date.now() });
    if (s.date !== todayKey()) { s.date = todayKey(); s.sec = 0; }
    const now = Date.now();
    let delta = Math.min(120, Math.round((now - (s.last || now)) / 1000));  /* 单次最多记 2 分钟，防时钟异常 */
    if (document.hidden || now - lastTouch > IDLE_MS) delta = 0;            /* 后台/闲置不计时 */
    s.sec += delta;
    s.last = now;
    try { localStorage.setItem('hh_sessionLog', JSON.stringify(s)); } catch (e) {}
    /* 最近使用日期：只在跨天时写一次，不必每 10 秒白写一遍 */
    if (readJSON('hh_lastActive', null) !== todayKey()) {
      try { localStorage.setItem('hh_lastActive', JSON.stringify(todayKey())); } catch (e) {}
    }
    checkLimit(s.sec);
  }

  /* ---- 读取家长设置的每日上限（分钟）：0 = 当天不限制；未设置时默认 20 ---- */
  function getLimit() {
    try {
      const v = JSON.parse(localStorage.getItem('hh_dailyLimit'));
      if (typeof v === 'number' && v >= 0) return v;
    } catch (e) {}
    return 20;
  }

  /* ---- 每日时长上限（家长中心可自由设置：预设档 / 自定义 / 不限制） ----
     达到上限后在学习页显示温和的收尾遮罩（不含任何惩罚意味）；
     家长把上限调大或改为「不限制」时，已出现的遮罩会随之解除。 */
  function checkLimit(sec) {
    const limit = getLimit();
    const ov = document.getElementById('hh-limit-overlay');
    if (limit <= 0) {                       /* 不限制：解除已出现的遮罩 */
      if (ov) ov.remove();
      return;
    }
    if (ov) return;                         /* 遮罩已显示，不重复创建 */
    if (sec < limit * 60) return;
    const overlay = document.createElement('div');
    overlay.id = 'hh-limit-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:70;background:var(--bg);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;';
    overlay.innerHTML =
      '<div style="font-size:72px" aria-hidden="true">🌙</div>' +
      '<p style="font-size:30px;font-weight:bold;color:var(--text)">今天的探险时间到啦</p>' +
      '<p style="font-size:20px;color:var(--text-soft)">小树要休息了，明天再来玩吧！' +
      '（家长可在「设置」里调整时长）</p>';
    const btn = document.createElement('button');
    btn.className = 'btn-main pressable';
    btn.style.setProperty('--mc', 'var(--primary)');
    btn.textContent = '🏠 回我的星球';
    btn.addEventListener('click', () => { location.href = 'home.html'; });
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
    if (window.HH) HH.speak('今天的探险时间到啦，明天再来玩吧');
  }

  /* ---- 汇总今日学情 ---- */
  function get() {
    const key = todayKey();
    const slog = readJSON('hh_sessionLog', { date: '', sec: 0 });
    const minutes = slog.date === key ? Math.round((slog.sec || 0) / 60) : 0;

    const clog = readJSON('hh_charLog', { date: '', list: [] });
    const newChars = clog.date === key ? clog.list.length : 0;

    const tasks = readJSON('hh_tasks', { date: '', done: {} });
    const stations = tasks.date === key ? Object.keys(tasks.done || {}).length : 0;

    const prog = readJSON('hh_progress', {});
    const bars = MODS.map(m => ({
      id: m.id, name: m.short, color: m.color,
      v: Math.round((prog[m.id] || 0) / 4 * 100)
    }));

    const zero = stations === 0 && newChars === 0 && minutes < 1;
    const lastActive = (function () {
      try { return JSON.parse(localStorage.getItem('hh_lastActive') || 'null'); }
      catch (e) { return null; }
    })();

    /* 薄弱项：进度最低且未满的模块（不显示为错误，用鼓励措辞） */
    const weak = bars.filter(b => b.v < 100)
                     .sort((a, b) => a.v - b.v)
                     .slice(0, 2)
                     .map(b => b.name + '这站还可以再玩一玩（' + b.v + '%）');

    const read = readJSON('hh_readLog', { date: '', title: '' });
    const readToday = read.date === key ? read.title : '';

    return { minutes, newChars, stations, bars, weak, zero, lastActive, readToday };
  }

  /* ---- 学习建议：基于真实薄弱项与今日表现生成（不虚构） ----
     时长相关文案跟随家长设置的每日上限（0＝不限制时不提达标） */
  function advice(d) {
    const limit = getLimit();
    if (d.zero) {
      const first = limit > 0 ? '每天 ' + limit + ' 分钟就够啦' : '想玩多久玩多久，注意休息眼睛哦';
      return ['今天还没开始探险，陪孩子一起试试吧', '从拼音星球开始最容易上手', first];
    }
    const out = [];
    const bars = [...d.bars].sort((a, b) => a.v - b.v);
    if (bars.length && bars[0].v < 100) {
      out.push('「' + bars[0].name + '」进度落后一点，陪孩子再玩一轮');
    }
    if (d.newChars > 0) {
      out.push('让孩子把今天新学的字读给你听，当一次小老师');
    }
    if (limit > 0) {
      if (d.minutes >= limit) {
        out.push('今天时长已达标，记得让孩子休息眼睛');
      } else {
        out.push('再玩一站就到今天的 ' + limit + ' 分钟啦');
      }
    } else {
      out.push('今天没限时长，也记得让孩子休息眼睛哦');
    }
    return out.slice(0, 3);
  }

  /* ---- 自动启动追踪（任意页面记录最近使用；学习页累计时长） ---- */
  function boot() {
    track();
    setInterval(track, 10000);
    window.addEventListener('pagehide', track);
    document.addEventListener('visibilitychange', () => { if (document.hidden) track(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { get: get, advice: advice, todayKey: todayKey };
})();
