/* ============================================================
   结算页逻辑 · jiesuan.js（任务书 §6.9）
   记账已在 common.js 的 gotoSettle 完成，本页只负责展示与动画：
   组件 A（happy）+ 成长树卡片 + 星星胶囊 + 新徽章卡 + 星星雨。
   ============================================================ */
(function () {
  'use strict';
  const { store, speak, reduceMotion, icon } = HH;
  const s = store.get('lastSession', null) || {
    count: 1, stars: 3, stage: store.get('treeStage', 1), grew: false, badge: null
  };

  /* ---- 主标题：N 取关数 ---- */
  const n = s.count || 1;
  document.getElementById('endTitle').textContent = '你完成了 ' + n + ' 关';
  document.getElementById('capsuleN').textContent = s.stars;

  /* ---- 组件 A：happy，200×200 ---- */
  HHPlanet.mount('#planetBox', { size: 200, state: 'happy' });

  /* ---- 成长树卡片：阶段标签取 TreeMotion.STAGES[i].name；跃迁则弹跳一次 ---- */
  const stage = Math.max(1, Math.min(6, store.get('treeStage', 1)));
  TreeMotion.mount('#tree', { stage: stage, mode: 'idle', wind: 1 });
  document.getElementById('stageLabel').textContent = TreeMotion.STAGES[stage - 1].name;
  if (s.grew) {
    const card = document.getElementById('treeCard');
    setTimeout(() => {
      card.classList.add('bounce');
      setTimeout(() => card.classList.remove('bounce'), 450);
    }, 900);
  }

  /* ---- 解锁徽章卡（仅本次有新徽章时出现） ---- */
  if (s.badge) {
    const COLORS = { pinyin: 'var(--c-pinyin)', shengzi: 'var(--c-shengzi)', langdu: 'var(--c-langdu)', jushi: 'var(--primary)' };
    const ICONS = { pinyin: 'planet', shengzi: 'tree', langdu: 'mask', jushi: 'blocks' };
    const ball = document.getElementById('badgeBall');
    ball.innerHTML = icon(ICONS[s.badge.id] || 'star');
    ball.style.background = COLORS[s.badge.id] || 'var(--primary)';
    document.getElementById('badgeName').textContent = s.badge.name;
    document.getElementById('badgeCard').classList.remove('hidden');
  }

  /* ---- 星星雨：18 颗，1100–2000ms 随机延迟，向右上角星星罐聚拢 ---- */
  const rain = document.getElementById('rain');
  if (!reduceMotion) {
    for (let i = 0; i < 18; i++) {
      const star = document.createElement('span');
      star.className = 'rain-star';
      star.textContent = '⭐';
      const left = 8 + Math.random() * 58;                       /* 出生横坐标 vw */
      star.style.left = left + 'vw';
      star.style.setProperty('--dx', (84 - left) + 'vw');        /* 终点：右上角星星罐 */
      star.style.setProperty('--dy', '-26vh');
      star.style.setProperty('--dur', (1.1 + Math.random() * 0.9) + 's');
      star.style.animationDelay = (1.1 + Math.random() * 0.9) + 's';
      rain.appendChild(star);
    }
  }

  /* ---- 进入播报（话术表内句子）---- */
  setTimeout(() => speak('今天的探险结束啦，小树又长高了一点。'), 400);

  /* ---- 回到我的星球 ---- */
  document.getElementById('endHome').addEventListener('click', () => {
    setTimeout(() => { location.href = 'home.html'; }, 150);
  });

  /* ---- 继续下一站（P1：四站动线串联）：指向第一个未通关的模块 ----
     全部通关则隐藏该按钮 */
  (function () {
    const ORDER = [['pinyin', 'pinyin.html'], ['shengzi', 'shengzi.html'],
                   ['langdu', 'langdu.html'], ['jushi', 'jushi.html']];
    const prog = store.get('progress', {});
    const next = ORDER.find(o => (prog[o[0]] || 0) < 4);
    const btn = document.getElementById('btnNextStop');
    if (!btn) return;
    if (next) {
      btn.classList.remove('hidden');
      btn.addEventListener('click', () => {
        speak('继续探险');
        setTimeout(() => { location.href = next[1]; }, 200);
      });
    } else {
      btn.classList.add('hidden');
    }
  })();
})();
