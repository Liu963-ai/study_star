/* ============================================================
   生字森林逻辑 · shengzi.js（任务书 §6.5 + P1 扩容修复）
   ------------------------------------------------------------
   统一多字推进：内置 100 字（unit 顺序）/ 教材规划字皆可逐字学习。
   每个字的笔顺二选一：
   · 有手绘 strokes（人/大/天/口）→ SVG 三层描红（700ms/笔）
   · 其余字 → Hanzi Writer 离线笔顺数据渲染（assets/hanzi-data/）
   控件：暂停/继续 · 单笔重播 · 整字重播 · 下一个字（两种模式都有）。
   学过的字自动记录（hh_charDone / hh_charLog），喂给家长报告。
   ============================================================ */
(function () {
  'use strict';
  const { speak, store, icon } = window.HH;   /* 注意：icon 在 HH 上，不在 window 上 */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DUR = 700;
  const $ = id => document.getElementById(id);

  /* ---- 字列表：教材模式＝规划器取字；内置模式＝data.js 全部 100 字 ---- */
  const book = window.HHBooks && HHBooks.active();
  const ITEMS = book
    ? HHBooks.pickChars(6).map(c => ({ char: c.char, pinyin: c.pinyin || '', words: c.words || [] }))
    : DATA.shengzi.map(s => ({ char: s.char, pinyin: s.pinyin || '', words: s.words || [], strokes: s.strokes || null }));
  let ci = 0;

  /* ---- 公共 UI 引用 ---- */
  const svg = $('strokesSvg');
  const hwBox = $('hwBox');
  const charShadow = $('charShadow');

  /* ============================================================
     模式 A：SVG 三层描红（有手绘笔顺的字）
     ============================================================ */
  const svgCtx = { paths: [], idx: 0, anim: null, paused: false, total: 0 };

  function svgBuild(item) {
    svg.innerHTML = '';
    svgCtx.paths = [];
    svg.classList.remove('hidden');
    charShadow.classList.remove('hidden');
    charShadow.textContent = item.char;
    hwBox.classList.add('hidden');
    hwBox.innerHTML = '';
    item.strokes.forEach(s => {
      const t = document.createElementNS(SVG_NS, 'path');
      t.setAttribute('d', s.d);
      t.setAttribute('class', 'trace');
      svg.appendChild(t);
    });
    item.strokes.forEach(s => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', s.d);
      p.setAttribute('class', 'top');
      svg.appendChild(p);
      svgCtx.paths.push(p);
    });
    svgCtx.total = item.strokes.length;
  }

  function svgPlayStroke(i) {
    svgCtx.idx = i;
    const p = svgCtx.paths[i];
    const len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.opacity = '1';
    svgCtx.anim = p.animate(
      [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
      { duration: DUR, easing: 'linear', fill: 'forwards' }
    );
    svgCtx.paused = false;
    svgSyncPause();
    svgDots(i);
    const name = strokeNameOf(i);
    $('strokeSay').textContent = '第' + (i + 1) + '笔，' + name;
    speak('第' + (i + 1) + '笔，' + name);
    svgCtx.anim.onfinish = () => {
      if (i + 1 < svgCtx.total) svgPlayStroke(i + 1);
      else charLearned(currentChar());          /* 播完停留静止确认帧 */
    };
  }
  function strokeNameOf(i) {
    const it = ITEMS[ci];
    return (it.strokes && it.strokes[i] && it.strokes[i].name) || '';
  }

  /* ============================================================
     模式 B：Hanzi Writer（离线笔顺数据，覆盖 9575 字）
     ============================================================ */
  const hwCtx = { writer: null, idx: 0, total: 0, paused: false, char: '' };

  function hwBuild(ch) {
    svg.classList.add('hidden');
    charShadow.classList.add('hidden');
    hwBox.classList.remove('hidden');
    hwBox.innerHTML = '';
    svgCtx.anim = null;
    fetchStrokeData(ch, 0);
  }

  /* ---- 笔顺数据加载：失败自动重试 + 本地缓存兜底 ----
     服务未启动/网络抖动时曾直接停在「数据异常」，笔画永远出不来。
     现在：优先用本机缓存（成功加载过的字离线也能写）；
     无缓存则每 3s 自动重试，恢复后立即演示。 */
  function fetchStrokeData(ch, attempt) {
    /* 若已切到别的字，放弃本次加载 */
    if (ITEMS[ci].char !== ch) return;
    const cached = localStorage.getItem('hh_stroke_' + ch);
    if (cached) {
      try {
        renderWriter(ch, JSON.parse(cached));
        return;
      } catch (e) { localStorage.removeItem('hh_stroke_' + ch); }
    }
    fetch('assets/hanzi-data/' + encodeURIComponent(ch) + '.json')
      .then(r => {
        if (!r.ok) throw new Error('http-' + r.status);
        return r.json();
      })
      .then(data => {
        try { localStorage.setItem('hh_stroke_' + ch, JSON.stringify(data)); } catch (e) {}
        renderWriter(ch, data);
      })
      .catch(() => {
        if (ITEMS[ci].char !== ch) return;      /* 已切字：不再提示 */
        $('strokeSay').textContent = '笔顺数据取不到，正在自动重试…';
        $('strokeTotal').textContent = '…';
        setTimeout(() => fetchStrokeData(ch, attempt + 1), 3000);
      });
  }

  function renderWriter(ch, data) {
    if (ITEMS[ci].char !== ch) return;          /* 已切字：放弃渲染 */
    $('strokeSay').textContent = ch + '，看老师写一遍';
    hwCtx.writer = HanziWriter.create(hwBox, ch, {
      width: 380, height: 380, padding: 12,
      strokeAnimationSpeed: 1, delayBetweenStrokes: 750,
      strokeColor: '#33691E',
      charDataLoader: function (c, onload) { onload(data); },
      onStrokeAnimationComplete: function (ev) {
        hwCtx.idx = Math.max(hwCtx.idx, ev.strokeNum + 1);
        hwDots(ev.strokeNum);
        speak('第' + (ev.strokeNum + 1) + '笔');
      },
      onComplete: function () {
        charLearned(ch);                     /* 播完记为已学 */
      }
    });
    hwCtx.total = data.strokes.length;
    $('strokeTotal').textContent = hwCtx.total;
    hwDots(0);
    hwCtx.writer.animateCharacter();         /* 首次自动演示整字笔顺 */
  }
  function hwDots(doneIdx) {
    [...$('strokeDots').children].forEach((d, i) => d.classList.toggle('full', i < doneIdx + 1));
    $('strokeNo').textContent = Math.min(doneIdx + 1, hwCtx.total || 1);
  }

  /* ============================================================
     公共：载入当前字（按有无手绘笔顺分流）
     ============================================================ */
  function currentChar() { return ITEMS[ci].char; }
  function charLearned(ch) {
    if (window.HHBooks) HHBooks.markCharDone(ch);
  }

  let beginTimer = null;     /* 读音播报兜底计时器（静音时直接开画） */
  let loadSeq = 0;           /* 载入序号：只允许最新一次载入触发笔顺演示 */

  function loadChar() {
    const it = ITEMS[ci];
    clearTimeout(beginTimer);
    const seq = ++loadSeq;
    $('zicardChar').textContent = it.char;
    $('strokeSay').textContent = it.char + '，看老师写一遍';
    $('btnNextChar').classList.remove('hidden');
    /* 本字信息卡：大字 + 拼音 + 组词（点击词语朗读）。
       元素判空：旧缓存页面可能没有新元素，缺了也不阻断翻页。 */
    const elBig = $('charInfoBig');
    if (elBig) elBig.textContent = it.char;
    const elPy = $('charInfoPy');
    if (elPy) elPy.textContent = it.pinyin || '';
    const info = $('charInfo');
    if (info) {
      info.innerHTML = '';
      (it.words || []).forEach(w => {
        const b = document.createElement('button');
        b.className = 'sz-word pressable';
        b.textContent = w;
        b.addEventListener('click', () => { speak(w); });
        info.appendChild(b);
      });
    }

    /* 播报短读音「字，拼音」，随后即开始笔顺演示（与语音并行）；
       began/loadSeq 双保险保证演示只启动一次，静音时立即开画。 */
    const readText = it.char + (it.pinyin ? '，' + it.pinyin : '') + '。看老师写一遍';
    const began = { done: false };
    const begin = () => {
      if (seq !== loadSeq || began.done) return;   /* 已切字/已开画 */
      began.done = true;
      clearTimeout(beginTimer);
      if (it.strokes) {
        svgBuild(it);
        $('strokeTotal').textContent = it.strokes.length;
        svgDots(0);
        svgPlayStroke(0);
      } else {
        $('strokeTotal').textContent = '…';
        $('strokeDots').innerHTML = '';
        hwBuild(it.char);
      }
    };
    const u = speak(readText);
    if (!u) begin();
    else beginTimer = setTimeout(begin, 2800);   /* 读音约 2s 播完即开画，不因 TTS 慢而久等 */

    /* 预热本字与下一个字的全部语音（导语/组词/笔画名），点击与切换秒播 */
    prewarmCurrentChar();

    /* 预热本字其余语音：组词、各笔画名（后台合成，演示时秒播） */
    function prewarmCurrentChar() {
      if (!(window.HHTTS && window.HHTTS.prewarm)) return;
      const strokeTexts = [];
      const total = it.strokes ? it.strokes.length : 0;
      for (let i = 0; i < total; i++) {
        strokeTexts.push('第' + (i + 1) + '笔，' + (it.strokes[i].name || ''));
      }
      const introOf = c => c.char + (c.pinyin ? '，' + c.pinyin : '') + '。看老师写一遍';
      const nxt = ITEMS[(ci + 1) % ITEMS.length];           /* 预取下一个字 */
      window.HHTTS.prewarm([readText, introOf(nxt), it.char, nxt.char,
        ...(it.words || []), ...strokeTexts]);
    }
  }

  /* ============================================================
     控件：暂停 / 单笔 / 整字 / 下一个字
     ============================================================ */
  let paused = false;
  function syncPauseBtn() {
    $('pauseText').textContent = paused ? '继续' : '暂停';
    document.querySelector('#btnPause .ico').innerHTML = icon(paused ? 'play' : 'pause');
  }
  $('btnPause').addEventListener('click', () => {
    clearTimeout(beginTimer);
    paused = !paused;
    if (ITEMS[ci].strokes) {
      if (svgCtx.anim) { if (paused) svgCtx.anim.pause(); else svgCtx.anim.play(); }
    } else if (hwCtx.writer) {
      if (paused) hwCtx.writer.pauseAnimation(); else hwCtx.writer.resumeAnimation();
    }
    syncPauseBtn();
  });
  $('btnOne').addEventListener('click', () => {
    clearTimeout(beginTimer);
    if (ITEMS[ci].strokes) svgPlayStroke(svgCtx.idx);
    else if (hwCtx.writer) { hwCtx.idx = 0; hwCtx.writer.animateStroke(0); }
  });
  $('btnAll').addEventListener('click', () => {
    clearTimeout(beginTimer);
    if (ITEMS[ci].strokes) svgPlayStroke(0);
    else if (hwCtx.writer) { hwCtx.idx = 0; hwDots(-1); hwCtx.writer.animateCharacter(); }
  });
  $('btnNextChar').addEventListener('click', () => {
    clearTimeout(beginTimer);
    charLearned(currentChar());                  /* 看过演示即记为已学 */
    ci = (ci + 1) % ITEMS.length;
    paused = false; syncPauseBtn();
    loadChar();
  });
  /* 上一个字：回到前一个生字重新学习（越界回绕到最后一个） */
  $('btnPrevChar').addEventListener('click', () => {
    clearTimeout(beginTimer);
    ci = (ci - 1 + ITEMS.length) % ITEMS.length;
    paused = false; syncPauseBtn();
    loadChar();
  });
  $('btnZicard').addEventListener('click', () => {
    speak('你已经收集了 ' + store.get('ziCount', 0) + ' 个字');
  });

  /* ---- 供两个模式共用的进度点渲染（按当前总笔数重建） ---- */
  function svgDots(doneIdx) { svgDotsGeneric(doneIdx, svgCtx.total); }
  function hwDots(doneIdx) { svgDotsGeneric(doneIdx, hwCtx.total || 1); }
  function svgDotsGeneric(doneIdx, total) {
    const dotsBox = $('strokeDots');
    if (+dotsBox.dataset.total !== total) {
      dotsBox.dataset.total = total;
      dotsBox.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const d = document.createElement('span');
        d.className = 'pdot';
        dotsBox.appendChild(d);
      }
    }
    [...dotsBox.children].forEach((d, i) => d.classList.toggle('full', i <= doneIdx));
    $('strokeNo').textContent = Math.min(doneIdx + 1, total);
  }

  /* ---- 启动 ---- */
  loadChar();
  /* 注册预热：换音色/语速后自动重新预热当前字 */
  if (window.HHTTS && window.HHTTS.addPrewarmer) {
    window.HHTTS.addPrewarmer(() => loadCharPrewarmOnly());
  }
  function loadCharPrewarmOnly() {
    const it = ITEMS[ci];
    if (!it || !(window.HHTTS && window.HHTTS.prewarm)) return;
    const strokeTexts = (it.strokes || []).map((s, i) => '第' + (i + 1) + '笔，' + (s.name || ''));
    const introOf = c => c.char + (c.pinyin ? '，' + c.pinyin : '') + '。看老师写一遍';
    const nxt = ITEMS[(ci + 1) % ITEMS.length];
    window.HHTTS.prewarm([introOf(it), introOf(nxt), it.char, nxt.char,
      ...(it.words || []), ...strokeTexts]);
  }
})();
