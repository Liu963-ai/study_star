/* ============================================================
   启动欢迎页逻辑 · splash.js（任务书 §6.1）
   挂组件 A（smile 260×260）；开始按钮 → home.html。
   任务书 §7.2 话术表无启动页句子，本页不播报。
   ============================================================ */
(function () {
  'use strict';

  /* 主视觉：组件 A，状态 smile */
  HHPlanet.mount('#planetBox', { size: 260, state: 'smile' });

  /* 开始探险 → 首页 */
  document.getElementById('btnStart').addEventListener('click', () => {
    setTimeout(() => { location.href = 'home.html'; }, 200);
  });
})();
