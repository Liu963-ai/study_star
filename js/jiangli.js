/* ============================================================
   奖励中心逻辑 · jiangli.js（任务书 §6.8）
   星星 / 徽章 / 成长树 / 商店 四个页签。
   徽章已获得条件（需求方确认）：对应模块通关进度 hh_progress ≥ 4。
   商店兑换：星星足够扣星并播报「兑换好啦」；不足保持可用，播报
   「星星还不够，再去探险吧」（不置灰、不变红）。
   ============================================================ */
(function () {
  'use strict';
  const { store, speak, sfx, icon, getStars, getProgress } = HH;

  /* ---- 四枚模块徽章定义（图标 = 模块图标，白色描边） ---- */
  const BADGES = [
    { id: 'pinyin',  name: '拼音小达人', mod: 'pinyin',  ico: 'planet', c: 'var(--c-pinyin)'  },
    { id: 'shengzi', name: '识字小能手', mod: 'shengzi', ico: 'tree',   c: 'var(--c-shengzi)' },
    { id: 'langdu',  name: '朗读小明星', mod: 'langdu',  ico: 'mask',   c: 'var(--c-langdu)'  },
    { id: 'jushi',   name: '造句小诗人', mod: 'jushi',   ico: 'blocks', c: 'var(--primary)'   }
  ];

  function badgeEl(b) {
    const earned = getProgress(b.mod) >= HH.PROGRESS_MAX;
    const el = document.createElement('div');
    el.className = 'badge ' + (earned ? 'earned' : 'locked');
    el.setAttribute('aria-label', b.name);
    el.innerHTML =
      '<span class="badge-ball">' + icon(b.ico) + '</span>' +
      '<span class="badge-name">' + b.name + '</span>';
    el.style.setProperty('--bc', b.c);
    return el;
  }
  document.getElementById('badgeGrid').append(...BADGES.map(badgeEl));
  document.getElementById('badgeGrid2').append(...BADGES.map(badgeEl));

  /* ---- 成长树页签：组件 B（hh_treeStage，idle，风力 1）+ 累计数据 ---- */
  TreeMotion.mount('#tree', { stage: store.get('treeStage', 1), mode: 'idle', wind: 1 });
  const ta = store.get('treeAssets', { leaf: 0, flower: 0, fruit: 0, branch: 0 });
  document.getElementById('taLeaf').textContent = ta.leaf;
  document.getElementById('taFlower').textContent = ta.flower;
  document.getElementById('taFruit').textContent = ta.fruit;
  document.getElementById('taBranch').textContent = ta.branch;

  /* ---- 商店页签：4 件装饰商品（DATA.shop 缺失时不阻断页面其余功能） ---- */
  const grid = document.getElementById('shopGrid');
  (DATA.shop || []).forEach(item => {
    const el = document.createElement('div');
    el.className = 'shop-item';
    el.innerHTML =
      '<span class="shop-emoji">' + item.emoji + '</span>' +
      '<span class="shop-name">' + item.name + '</span>' +
      '<span class="shop-price">⭐ ' + item.price + '</span>' +
      '<button class="shop-buy pressable">兑换</button>';
    el.querySelector('.shop-buy').addEventListener('click', () => {
      if (getStars() >= item.price) {
        store.set('stars', getStars() - item.price);
        HH.refreshStarUI();                     /* 只刷新角标数字，不再走 addStars(0) */
        /* 记录已兑换装饰：首页小树会把它挂到树枝上展示 */
        const owned = store.get('owned', []);
        if (owned.indexOf(item.id) < 0) owned.push(item.id);
        store.set('owned', owned);
        sfx.star();
        speak('兑换好啦，' + item.name + '已经挂到你的小树上啦');
      } else {
        speak('星星还不够，再去探险吧');       /* 按钮保持可用，不置灰不变红 */
      }
    });
    grid.appendChild(el);
  });

  /* ---- 本周收集：按周键读取（跨周自动归零）。
         以前读的是 hh_weekStars 裸值且默认 36，新用户一进奖励页就
         凭空看到「本周收集 36」，而星星罐是 0，两处自相矛盾。 ---- */
  document.getElementById('weekN').textContent = HH.getWeekStars();

  /* ---- 预热固定播报（兑换反馈），点击时秒播 ---- */
  if (window.HHTTS && window.HHTTS.prewarm) {
    window.HHTTS.prewarm(['兑换好啦', '星星还不够，再去探险吧']);
  }

  /* ---- 切页签 ---- */
  document.getElementById('tabbar').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    sfx.tap();
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b === btn));
    document.querySelectorAll('.panel').forEach(p => {
      p.classList.toggle('on', p.dataset.panel === btn.dataset.tab);
    });
  });
})();
