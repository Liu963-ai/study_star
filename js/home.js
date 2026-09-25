/* ============================================================
   学生端首页逻辑 · home.js（任务书 §6.2 + §5.3）
   组件 A 头像 / 问候播报 / 组件 B 成长树 / 任务完成圈 / 模块进度点
   ============================================================ */
(function () {
  'use strict';
  const { store, speak, getTasks, getProgress } = HH;

  /* ---- 头像位：组件 A，smile，56×56 ---- */
  HHPlanet.mount('#avatarPlanet', { size: 56, state: 'smile' });

  /* ---- 问候气泡保留（纯视觉），不再自动播报语音（应用户要求移除） ---- */

  /* ---- 中央成长树（组件 B）：阶段取 hh_treeStage（默认 3），固定 idle / 风力 1 ----
     结算归来（hh_treeGrew=true）：先挂前一阶段，再 setStage(新阶段) 表现「长高一下」，
     随后清除该键；不额外叠加自定义动画。 */
  const stage = store.get('treeStage', 1);
  const grew = store.get('treeGrew', false) && stage > 1;
  const tm = TreeMotion.mount('#tree', {
    stage: grew ? stage - 1 : stage,
    mode: 'idle',
    wind: 1
  });
  if (grew) {
    setTimeout(() => tm.setStage(stage), 700);
    store.set('treeGrew', false);
  }

  /* ---- 今日任务完成圈（取 HH.getTasks） ---- */
  const done = getTasks();
  document.querySelectorAll('.task').forEach(el => {
    if (done[el.dataset.task]) el.classList.add('done');
  });

  /* ---- 四大模块按钮底部 7 个进度小点（已通关的按 hh_progress 填实） ---- */
  document.querySelectorAll('.module-dots').forEach(el => {
    const n = Math.min(getProgress(el.dataset.module), 7);
    for (let i = 0; i < 7; i++) {
      const d = document.createElement('span');
      d.className = 'pd' + (i < n ? ' full' : '');
      el.appendChild(d);
    }
  });

  /* ============================================================
     小树板块优化：昼夜氛围 / 成果统计 / 点击互动 / 装饰可见化
     ============================================================ */

  /* ---- 1) 昼夜氛围：按系统时间给首页铺晨/昼/黄昏/夜晚色调 ---- */
  (function skyByHour() {
    const h = new Date().getHours();
    const tint = document.getElementById('skyTint');
    if (!tint) return;
    let name = 'day';
    if (h >= 5 && h < 8) name = 'dawn';
    else if (h >= 17 && h < 19) name = 'dusk';
    else if (h >= 19 || h < 5) name = 'night';
    tint.classList.add('sky-' + name);
    /* 夜晚：树旁飞 3 只萤火虫 */
    if (name === 'night') {
      const ff = document.querySelector('.fireflies');
      if (ff) for (let i = 0; i < 3; i++) {
        const s = document.createElement('span');
        s.className = 'firefly';
        s.style.setProperty('--fx', (12 + i * 34) + '%');
        s.style.setProperty('--fd', (3 + i * 0.7) + 's');
        ff.appendChild(s);
      }
    }
  })();

  /* ---- 2) 成果统计：学过的字 / 拼音关 / 朗读关 挂在小树下面 ---- */
  (function treeStats() {
    const box = document.getElementById('treeStats');
    if (!box) return;
    let charN = 0;
    try { charN = Object.keys(JSON.parse(localStorage.getItem('hh_charDone') || '{}')).length; } catch (e) {}
    const items = [
      { emoji: '🍃', label: '生字', n: charN },
      { emoji: '🌸', label: '拼音', n: getProgress('pinyin') },
      { emoji: '🍎', label: '朗读', n: getProgress('langdu') },
      { emoji: '🧩', label: '词语', n: getProgress('jushi') }
    ];
    items.forEach(it => {
      const c = document.createElement('span');
      c.className = 'tstat';
      c.innerHTML = '<span class="ts-emoji">' + it.emoji + '</span>' +
                    it.label + ' <b>' + it.n + '</b>';
      box.appendChild(c);
    });
  })();

  /* ---- 3) 装饰可见化：奖励商店兑换的宝贝挂在树枝上 ---- */
  (function treeDeco() {
    const box = document.getElementById('treeDeco');
    if (!box) return;
    const EMOJI = { leaf: '🍃', flower: '🌸', fruit: '🍎', hat: '👒' };
    let owned = [];
    try { owned = JSON.parse(localStorage.getItem('hh_owned') || '[]'); } catch (e) {}
    owned.slice(0, 8).forEach((id, i) => {
      if (!EMOJI[id]) return;
      const s = document.createElement('span');
      s.className = 'deco';
      s.textContent = EMOJI[id];
      /* 绕树冠均匀挂放 */
      s.style.setProperty('--dx', (18 + (i % 4) * 22) + '%');
      s.style.setProperty('--dy', (18 + Math.floor(i / 4) * 26) + '%');
      s.style.setProperty('--dd', (2.6 + i * 0.5) + 's');
      box.appendChild(s);
    });
  })();

  /* ---- 4) 点击互动：摇一摇小树，读一个学过的生字 ---- */
  (function treePlay() {
    const wrap = document.querySelector('.tree-wrap');
    if (!wrap) return;
    let chars = [];
    try { chars = Object.keys(JSON.parse(localStorage.getItem('hh_charDone') || '{}')); } catch (e) {}
    wrap.style.cursor = 'pointer';
    wrap.addEventListener('click', () => {
      if (window.HH) HH.sfx.tap();
      wrap.classList.remove('tree-shake'); void wrap.offsetWidth;
      wrap.classList.add('tree-shake');
      if (chars.length) {
        const c = chars[Math.floor(Math.random() * chars.length)];
        const meta = DATA.shengzi.find(s => s.char === c);
        speak(c + (meta && meta.words && meta.words[0] ? '，' + meta.words[0] : ''));
      } else {
        speak('去生字森林认识新朋友，小树的叶子就会变多哦');
      }
    });
  })();
})();
