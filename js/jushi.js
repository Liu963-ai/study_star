/* ============================================================
   词语乐园逻辑 · jushi.js（任务书 §6.7 + 按轮出题修复）
   ------------------------------------------------------------
   20 轮题目逐轮推进：每轮托盘给出三类积木（谁/在哪里/做什么）各
   2 个候选，拖进凹槽（吸附容错 ±30px，倾斜 ≤6°）；三槽填满即成句，
   播报整句并展示该轮的 AI 生成场景插图（data.js img 字段，本地
   assets/jushi/ 图片，由生图工具预生成）。「再拼一句」进入下一轮，
   20 轮全部拼完走 HH.gotoSettle 结算。
   ============================================================ */
(function () {
  'use strict';
  const { speak, sfx, toast, gotoSettle } = HH;

  const tray = document.getElementById('tray');
  const sentenceEl = document.getElementById('jsSentence');
  const sceneEl = document.getElementById('scene');
  const btnAgain = document.getElementById('btnAgain');
  const roundEl = document.getElementById('jsRound');

  const slotTypes = ['who', 'where', 'what'];

  /* 内容源：启用教材包 → 用教材词表合成一轮（缺的类型用内置词补位） */
  const book = window.HHBooks && HHBooks.active();
  const ROUNDS = (function () {
    if (!book) return DATA.jushi;
    const byType = { who: [], where: [], what: [] };
    book.words.forEach(w => {
      if (byType[w.type]) byType[w.type].push([w.word, { who: '🐱', where: '🌳', what: '🎵' }[w.type]]);
    });
    ['who', 'where', 'what'].forEach(t => {
      if (!byType[t].length) byType[t] = DATA.jushi[0][t];
    });
    return [byType];
  })();
  /* 教材模式：拼满 3 句即走结算（内置模式按轮次数） */
  const settleAt = book ? 3 : ROUNDS.length;
  const filled = { who: null, where: null, what: null };   /* 槽内已放的词 */
  let snappedCount = 0;                                    /* 当前已吸附的槽数 */
  let round = 0;                                           /* 当前第几轮（0 起） */

  function updateRoundLabel() {
    roundEl.textContent = book ? '用教材词语拼句子' : ('第 ' + (round + 1) + ' 题 · 共 ' + ROUNDS.length + ' 题');
  }

  /* ---- 生成一轮积木（清空托盘后放回该轮全部候选词） ---- */
  function renderTray(r) {
    tray.innerHTML = '';
    slotTypes.forEach(type => {
      ROUNDS[r][type].forEach(cand => {
        const b = document.createElement('button');
        b.className = 'block ' + type;
        /* 候选词结构：[词, emoji配图] */
        b.innerHTML = '<span class="b-emoji">' + cand[1] + '</span><span>' + cand[0] + '</span>';
        b.dataset.word = cand[0];
        b.dataset.type = type;
        tray.appendChild(b);
        bindDrag(b);
        /* 点一下已放进凹槽的积木 = 取回托盘重选（原来放进去就再也拿不出来） */
        b.addEventListener('click', () => takeBack(b));
      });
    });
    /* 预热本轮 8 种候选组合的成句语音 + 引导语（后台合成，成句时秒播） */
    if (window.HHTTS && window.HHTTS.prewarm) {
      const combos = [];
      ROUNDS[r].who.forEach(w => ROUNDS[r].where.forEach(s => ROUNDS[r].what.forEach(a =>
        combos.push(w[0] + s[0] + a[0]))));
      window.HHTTS.prewarm([...combos, '再拼一句']);
    }
  }
  /* 注册预热：换音色/语速后自动重新预热当前轮 */
  if (window.HHTTS && window.HHTTS.addPrewarmer) {
    window.HHTTS.addPrewarmer(() => renderTrayPrewarmOnly());
  }
  function renderTrayPrewarmOnly() {
    if (!(window.HHTTS && window.HHTTS.prewarm)) return;
    const r = round;
    const combos = [];
    ROUNDS[r].who.forEach(w => ROUNDS[r].where.forEach(s => ROUNDS[r].what.forEach(a =>
      combos.push(w[0] + s[0] + a[0]))));
    window.HHTTS.prewarm([...combos, '再拼一句']);
  }

  /* ---- 清空三个凹槽 ---- */
  function clearSlots() {
    document.querySelectorAll('.slot').forEach(s => {
      s.innerHTML = '<span class="slot-hint">把积木放到这里</span>';
    });
    filled.who = filled.where = filled.what = null;
    snappedCount = 0;
  }

  /* ---- 拖拽：Pointer Events + 固定定位 + 轻微倾斜 ---- */
  function bindDrag(block) {
    block.addEventListener('pointerdown', e => {
      if (block.dataset.snapped) return;        /* 已进凹槽：只用点击取回，不再拖拽 */
      e.preventDefault();
      const rect = block.getBoundingClientRect();
      const ghost = block;                       /* 直接把原块变成 fixed 跟随 */
      const ox = e.clientX - rect.left, oy = e.clientY - rect.top;
      ghost.classList.add('dragging');
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      let lastX = e.clientX;

      function move(ev) {
        ghost.style.left = (ev.clientX - ox) + 'px';
        ghost.style.top = (ev.clientY - oy) + 'px';
        const tilt = Math.max(-6, Math.min(6, (ev.clientX - lastX) * 0.6));  /* ≤6° */
        ghost.style.transform = 'rotate(' + tilt + 'deg)';
        lastX = ev.clientX;
        /* 悬停槽位高亮 */
        document.querySelectorAll('.slot').forEach(s => {
          const r = s.getBoundingClientRect();
          const near = Math.abs(ev.clientX - (r.left + r.width / 2)) < 60 &&
                       Math.abs(ev.clientY - (r.top + r.height / 2)) < 60;
          s.classList.toggle('hover', near);
        });
      }
      function cleanup() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        document.querySelectorAll('.slot').forEach(s => s.classList.remove('hover'));
      }
      function up(ev) {
        if (ev.pointerId != null && ev.pointerId !== pid) return;   /* 多指串扰：只认自己那根手指 */
        cleanup();
        ghost.style.transform = '';
        /* 被系统手势/来电打断（pointercancel）：直接弹回原位，不做吸附判定，
           否则积木会永远停在 .dragging 的 fixed 位置上，同屏多个之后整页卡死 */
        const cancelled = ev.type === 'pointercancel';
        /* 找同类型的最近槽：吸附容错 ±30px（槽内已有积木则不可再放） */
        let target = null;
        if (!cancelled) {
          document.querySelectorAll('.slot').forEach(s => {
            if (s.dataset.type !== ghost.dataset.type || s.querySelector('.block-in')) return;
            const r = s.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            if (Math.abs(ev.clientX - cx) <= 30 + r.width / 2 &&
                Math.abs(ev.clientY - cy) <= 30 + r.height / 2) target = s;
          });
        }
        if (target) snapInto(ghost, target);
        else {
          /* 拖错/没对上：弹回托盘 + 温和提示（§7.1 再试一次，无惩罚） */
          ghost.classList.add('returning');
          ghost.style.left = rect.left + 'px';
          ghost.style.top = rect.top + 'px';
          setTimeout(() => {
            ghost.classList.remove('dragging', 'returning');
            ghost.style.cssText = '';
          }, 260);
          if (!cancelled && nearAnySlot(ev)) {
            sfx.hmm();
            toast('差一点点，再来一次');
            ghost.classList.add('wobble');
            setTimeout(() => ghost.classList.remove('wobble'), 900);
          }
        }
      }
      const pid = e.pointerId;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);   /* 手势被打断也要走清理 */
    });
  }

  /* ---- 取回：点一下凹槽里的积木，放回托盘重新选 ---- */
  function takeBack(block) {
    if (!block.dataset.snapped) return;
    const slot = block.closest('.slot');
    if (!slot) return;
    delete block.dataset.snapped;
    filled[slot.dataset.type] = null;
    snappedCount = Math.max(0, snappedCount - 1);
    slot.innerHTML = '<span class="slot-hint">把积木放到这里</span>';
    sentenceEl.classList.add('hidden');
    sceneEl.classList.add('hidden');
    btnAgain.classList.add('hidden');
    renderTray(round);                 /* 托盘重建：候选词（含刚取回的）全部回来 */
    sfx.tap();
    speak('换一个');
  }
  /* 判断松手时是否悬在某个槽附近（用于区分「拖错槽」与「随手放下」） */
  function nearAnySlot(ev) {
    return [...document.querySelectorAll('.slot')].some(s => {
      const r = s.getBoundingClientRect();
      return Math.abs(ev.clientX - (r.left + r.width / 2)) < 60 &&
             Math.abs(ev.clientY - (r.top + r.height / 2)) < 60;
    });
  }

  /* ---- 吸附进槽：弹一下 + 计数 ---- */
  function snapInto(block, slot) {
    slot.innerHTML = '';
    block.classList.remove('dragging');
    block.style.cssText = '';
    block.classList.add('block-in', 'pop');
    block.dataset.snapped = '1';
    slot.appendChild(block);
    filled[slot.dataset.type] = block.dataset.word;
    snappedCount++;
    if (snappedCount === 3) sentenceFormed();
  }

  /* ---- 三槽填满：成句 + 播报 + 与句子对应的三联词图 ---- */
  function sentenceFormed() {
    const text = filled.who + filled.where + filled.what;
    sentenceEl.textContent = text;
    sentenceEl.classList.remove('hidden');
    renderScene();
    speak(text);
    /* 即时反馈：每拼成一句就给 1 颗星 + 今日任务打勾。
       原来 20 轮里前 19 轮没有任何奖励，只有全部拼完才给 3 颗星，
       对一年级孩子来说反馈间隔太长。 */
    window.HH.record({ stars: 1, task: 'jushi' });
    const isLast = book ? (round + 1 >= settleAt) : (round + 1 >= ROUNDS.length);
    if (isLast) {
      /* 全部轮次拼完：走结算流程（与需求方确认的规则） */
      setTimeout(() => gotoSettle({
        title: '你完成了 1 关',
        sub: '', stars: 3, module: 'jushi', task: 'jushi'
      }), 1600);
    } else {
      btnAgain.classList.remove('hidden');
    }
  }

  /* ---- 场景插图：与拼出的句子一一对应 ----
     「谁 | 在哪里 | 做什么」三联，每格为该词的 AI 生成插图
     （assets/jushi-words/<词>.jpg，生图工具预生成）；
     图片缺失时退回该词的 emoji 大图，功能不中断。 */
  function renderScene() {
    sceneEl.innerHTML = '';
    const parts = [
      { word: filled.who, type: 'who' },
      { word: filled.where, type: 'where' },
      { word: filled.what, type: 'what' }
    ].filter(p => p.word);
    const emojiOf = {};
    if (ROUNDS[round]) {
      ['who', 'where', 'what'].forEach(t => {
        (ROUNDS[round][t] || []).forEach(c => { emojiOf[c[0]] = c[1]; });
      });
    }
    parts.forEach(p => {
      const cell = document.createElement('button');
      cell.className = 'scene-cell pressable';
      cell.addEventListener('click', () => { sfx.tap(); speak(p.word); });
      const img = document.createElement('img');
      img.src = 'assets/jushi-words/' + encodeURIComponent(p.word) + '.jpg';
      img.alt = p.word;
      img.draggable = false;
      img.loading = 'lazy';
      img.decoding = 'async';
      /* 加载失败退回 emoji */
      img.addEventListener('error', () => {
        const em = document.createElement('span');
        em.className = 'scene-emoji';
        em.textContent = (emojiOf[p.word] || '⭐');
        img.replaceWith(em);
      });
      const label = document.createElement('span');
      label.className = 'scene-label';
      label.textContent = p.word;
      cell.append(img, label);
      sceneEl.appendChild(cell);
    });
    sceneEl.classList.remove('hidden');
  }

  /* ---- 再拼一句：进入下一轮（换全部三类候选词），修复原 nextRound 未定义 bug ---- */
  btnAgain.addEventListener('click', () => {
    btnAgain.classList.add('hidden');
    sentenceEl.classList.add('hidden');
    sceneEl.classList.add('hidden');
    clearSlots();
    round = (round + 1) % ROUNDS.length;
    updateRoundLabel();
    renderTray(round);
    speak('再拼一句');
  });

  /* ---- 启动：第一轮候选词进托盘 ---- */
  updateRoundLabel();
  renderTray(0);
})();
