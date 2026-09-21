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
})();
