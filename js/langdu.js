/* ============================================================
   朗读剧场逻辑 · langdu.js（任务书 §6.6 + P1 内容扩容）
   课文 10 篇（‹ › 切换），拼音由 pinyin-pro 运行时逐字标注；
   卡拉OK高亮（TTS boundary + 匀速兜底）；慢速/点字发音/分句循环；
   真实录音（HHRec）驱动音量波纹，失败降级假波纹；自评三选。
   ============================================================ */
(function () {
  'use strict';
  const { speak, sfx, gotoSettle, reduceMotion, toast } = window.HH;
  const $ = id => document.getElementById(id);
  const poemCard = $('poemCard');
  const recWave = $('recWave');
  const btnMic = $('btnMic');
  const btnSlow = $('btnSlow');
  const btnTap = $('btnTap');
  const btnLoop = $('btnLoop');
  const btnPrevText = $('btnPrevText');
  const btnNextText = $('btnNextText');
  const textLabel = $('textLabel');

  /* ---- 按句末标点切句（保留标点，与 split(/(?<=[。！？])/) 等价）----
     不用后行断言：Safari 16.4 之前 lookbehind 属语法错误，会让整个
     langdu.js 无法解析、朗读页整页空白。 */
  const SENT_END = '。！？';
  function splitSentences(text) {
    const clean = String(text || '').replace(/\s+/g, '');
    const out = [];
    let buf = '';
    for (const ch of clean) {
      buf += ch;
      if (SENT_END.indexOf(ch) >= 0) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    return out;
  }

  /* ---- 课文列表：内置 15 篇；教材模式＝教材整册一句一句来 ---- */
  const book = window.HHBooks && HHBooks.active();
  const TEXTS = book
    ? [{ title: '我的教材', text: '（教材课文按导入顺序逐句朗读）', segs: book.lines }]
    : DATA.langdu.list.map(t => {
        const PY = window.pinyinPro;      /* 库缺失时降级为「只显示汉字」而不是整页报错 */
        const segs = splitSentences(t.text)
          .filter(seg => seg.replace(/[，、：]/g, '').length >= 2)
          .map(seg => {
            let arr = null;
            try { arr = PY ? PY.pinyin(seg, { type: 'array', toneType: 'symbol' }) : null; }
            catch (e) { arr = null; }
            return [...seg].map((ch, i) => ({
              ch: ch,
              py: /[\u4e00-\u9fa5]/.test(ch) ? ((arr && arr[i]) || ch) : ch
            }));
          });
        return { title: t.title, segs: segs };
      });
  let textIdx = 0;

  /* ---- 当前句状态 ---- */
  let sentIdx = 0;
  let line = [];
  let sentenceText = '';
  let chars = [];
  let slow = false, tapMode = false, loopMode = false, speaking = false;

  function render() {
    clearHlTimers();                 /* 换句/换篇时先清掉上一句的匀速高亮定时器 */
    const t = TEXTS[textIdx];
    const segs = t.segs;
    if (sentIdx >= segs.length) sentIdx = segs.length - 1;
    if (sentIdx < 0) sentIdx = 0;
    line = segs[sentIdx];
    sentenceText = line.map(w => w.ch).join('');
    poemCard.innerHTML = '';
    line.forEach(w => {
      const word = document.createElement('span');
      word.className = 'word';
      word.innerHTML = '<span class="py"></span><span class="ch"></span>';
      /* 汉字标拼音；标点上方留空，避免出现重复的「，，」 */
      word.querySelector('.py').textContent = /[\u4e00-\u9fa5]/.test(w.ch) ? w.py : '';
      word.querySelector('.ch').textContent = w.ch;
      poemCard.appendChild(word);
    });
    chars = [...poemCard.querySelectorAll('.ch')];
    $('textLabel').textContent = '《' + t.title + '》 ' + (sentIdx + 1) + '/' + segs.length;
    renderIllus(t);
    /* 预热本篇全部分句语音（后台合成，点「听一听」/自动播放秒播） */
    if (window.HHTTS && window.HHTTS.prewarm) {
      window.HHTTS.prewarm(t.segs.map(s => s.map(w => w.ch).join('')).slice(0, 8));
    }
  }

  /* ---- 课文插图：生图工具按课文场景预生成（assets/langdu-img/），
     缺图时回退到星月小舟 SVG，功能不中断 ---- */
  function renderIllus(t) {
    const box = $('illusCard');
    if (!box) return;
    box.innerHTML = '';
    const src = t.img || (DATA.langdu.list[textIdx] && DATA.langdu.list[textIdx].img);
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '《' + t.title + '》插图';
      img.draggable = false;
      img.loading = 'lazy';          /* 图片不抢首屏带宽 */
      img.decoding = 'async';        /* 低端安卓上避免同步解码卡主线程 */
      img.addEventListener('error', () => {
        box.innerHTML = FALLBACK_SVG;
      });
      box.appendChild(img);
    } else {
      box.innerHTML = FALLBACK_SVG;
    }
  }
  const FALLBACK_SVG =
    '<svg viewBox="0 0 200 150" aria-hidden="true">' +
    '<path d="M150 22a30 30 0 1 0 22 42 24 24 0 1 1-22-42z" fill="var(--c-jiangli)" opacity=".9"/>' +
    '<circle cx="40" cy="26" r="3" fill="var(--c-jiangli)"/>' +
    '<circle cx="66" cy="14" r="2.4" fill="var(--c-jiangli)"/>' +
    '<circle cx="30" cy="48" r="2" fill="var(--c-jiangli)"/>' +
    '<path d="M2 118q25-10 50 0t50 0 50 0 46 0" fill="none" stroke="#9AD1F5" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M60 104l44-6-8 12H68z" fill="#C98A5B"/>' +
    '<path d="M84 66v32" stroke="#7A5236" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M84 68c14 2 22 12 20 26H84z" fill="#FFF6E3" stroke="#7A5236" stroke-width="2.5"/></svg>';

  function nextSentence() {
    const t = TEXTS[textIdx];
    if (sentIdx < t.segs.length - 1) { sentIdx++; render(); return true; }
    return false;
  }

  /* ---- 卡拉OK高亮 ---- */
  let hlTimers = [];
  function clearHlTimers() { hlTimers.forEach(clearTimeout); hlTimers = []; }
  function highlightTo(n) {
    chars.forEach((c, i) => {
      c.classList.toggle('read', i < n);
      c.classList.toggle('hl', i === n);
    });
  }

  /* ---- 播整句：TTS boundary 驱动，匀速兜底 ---- */
  function playSentence() {
    speaking = true;
    clearHlTimers();
    clearHighlight();
    speak(sentenceText, {
      rate: slow ? 0.8 : 0.95,
      onstart: () => highlightTo(0),
      onboundary: e => { if (typeof e.charIndex === 'number') highlightTo(Math.min(e.charIndex, chars.length - 1)); },
      onend: () => {
        speaking = false;
        highlightTo(chars.length);
        if (loopMode) setTimeout(playSentence, 600);
      }
    });
    if (!reduceMotion) {
      const step = slow ? 480 : 380;
      /* 定时器句柄要留住：一句 20 字就是 20 个定时器，切句后它们仍会
         按旧下标去高亮新句子的字（表现为「字在别处闪」），还会逐句累积 */
      hlTimers = chars.map((_, i) =>
        setTimeout(() => { if (speaking) highlightTo(i); }, step * i));
    }
  }
  function clearHighlight() { highlightTo(-1); }

  /* ---- 点课文：点字发音（开关开）或播整句 ---- */
  poemCard.addEventListener('click', e => {
    const ch = e.target.closest('.ch');
    if (tapMode && ch) speak(ch.textContent);
    else if (!speaking) playSentence();
  });

  /* ---- 三胶囊控件 ---- */
  btnSlow.addEventListener('click', () => {
    slow = !slow;
    btnSlow.classList.toggle('on', slow);
    /* 开启慢速后预热当前课文全部句子的慢速变体（换语速＝换缓存键，
       不预热则每次点「听一听」都要现场合成 3-5 秒） */
    if (slow && window.HHTTS && window.HHTTS.prewarm) {
      window.HHTTS.prewarm(TEXTS[textIdx].segs.map(s => s.map(w => w.ch).join('')).slice(0, 8), { rate: 0.8 });
    }
  });
  btnTap.addEventListener('click', () => { tapMode = !tapMode; btnTap.classList.toggle('on', tapMode); });
  btnLoop.addEventListener('click', () => { loopMode = !loopMode; btnLoop.classList.toggle('on', loopMode); });

  /* ---- 下一句：手动推进；本篇末句则翻到下一篇第一句 ---- */
  const btnNextLine = $('btnNextLine');
  btnNextLine.addEventListener('click', () => {
    sfx.tap();
    stopWave();
    const t = TEXTS[textIdx];
    if (sentIdx < t.segs.length - 1) {
      sentIdx++;
      render();
      playSentence();
    } else {
      /* 已是本篇最后一句：切下一篇（回到其第一句并朗读） */
      textIdx = (textIdx + 1) % TEXTS.length;
      sentIdx = 0;
      render();
      playSentence();
      speak(TEXTS[textIdx].title ? '下一篇，' + TEXTS[textIdx].title : '');
    }
  });

  /* ---- 课文切换：‹ 上一篇 / 下一篇 ›（回到该篇第一句） ---- */
  function switchText(delta) {
    if (TEXTS.length < 2) return;
    stopWave();
    textIdx = (textIdx + delta + TEXTS.length) % TEXTS.length;
    sentIdx = 0;
    render();
    playSentence();
  }
  btnPrevText.addEventListener('click', () => switchText(-1));
  btnNextText.addEventListener('click', () => switchText(1));

  /* ---- 录音：HHRec 采集（可选落盘）+ AnalyserNode 音量波纹 ---- */
  const BARS = 24;
  for (let i = 0; i < BARS; i++) recWave.appendChild(document.createElement('span'));
  const bars = [...recWave.children];
  let recHandle = null, audioCtx = null, raf = 0, fakeTimer = 0;

  function setBars(lv) {
    bars.forEach((b, i) => {
      const h = 8 + lv * 44 * (0.55 + 0.45 * Math.sin(i * 0.9 + Date.now() / 180));
      b.style.height = Math.max(6, Math.min(52, h)) + 'px';
      b.style.opacity = 0.4 + lv * 0.6;
    });
  }
  function fakeWave() {
    let t = 0;
    fakeTimer = setInterval(() => { t += 0.25; setBars(0.35 + 0.25 * Math.abs(Math.sin(t))); }, 110);
  }
  function stopWave() {
    clearInterval(fakeTimer); cancelAnimationFrame(raf);
    if (recStream) { recStream.getTracks().forEach(t => t.stop()); recStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    bars.forEach(b => { b.style.height = '8px'; b.style.opacity = .4; });
    btnMic.classList.remove('on');
  }
  let recStream = null;
  async function startRec() {
    btnMic.classList.add('on');
    try {
      recHandle = await HHRec.start();
      recStream = recHandle.stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(recStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      (function tick() {
        analyser.getByteFrequencyData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
        setBars(Math.min(1, (sum / buf.length) / 90));
        raf = requestAnimationFrame(tick);
      })();
    } catch (e) {
      recHandle = null;
      fakeWave();
      speak('我没听清楚，靠近一点再说一次好吗');
    }
  }
  btnMic.addEventListener('click', () => {
    if (btnMic.classList.contains('on')) stopWave();
    else startRec();
  });

  /* ---- 收尾：停采集；开启「保留录音」时把本次音频存入 IndexedDB ---- */
  async function stopAll() {
    let blob = null;
    if (recHandle) { blob = await recHandle.stop(); recHandle = null; }
    stopWave();
    if (blob && window.AudioDB && HHRec && HHRec.keepOn()) {
      const t = TEXTS.length > 1 ? TEXTS[textIdx].title : '《' + DATA.langdu.list[0].title + '》跟读';
      await window.AudioDB.put({ id: 'ld' + Date.now(), ts: Date.now(), title: t, blob: blob });
      HH.toast('录音已保存');
    }
  }

  /* ---- 自评三选：😀 3 星 / 🙂 2 星 / 😴 直接重读（0 星无惩罚） ----
     得星后推进到下一句；整篇读完才走结算。 */
  let rated = false;          /* 一次自评只结算一次：防连点造成双份星星 + 双跳转 */
  document.querySelectorAll('.rate-opt').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (rated) return;
      rated = true;
      await stopAll();
      const stars = +btn.dataset.stars;
      if (stars > 0) {
        sfxStar();
        const title = TEXTS[textIdx] ? TEXTS[textIdx].title : '';
        const finished = !nextSentence();
        if (finished) {
          /* 星星只由 gotoSettle 统一记账（以前这里先手工加一次，
             结算里再加一次 → 一次自评拿双份星星，家长报告也随之虚高） */
          gotoSettle({
            title: '你完成了 1 关',
            stars: stars,
            readTitle: title,
            module: 'langdu', task: 'langdu'
          });
        } else {
          rated = false;
          speak('太棒了，我们读下一句');
          setTimeout(playSentence, 500);
        }
      } else {
        rated = false;
        speak('没关系，我们再读一次！');
        setTimeout(playSentence, 400);
      }
    });
  });

  /* 星星音效（HH.sfx） */
  function sfxStar() { if (window.HH && HH.sfx) HH.sfx.star(); }

  /* ---- 启动：先渲染第一篇第一句（修复打开空白），并自动听一遍 ---- */
  render();
  /* 注册预热：换音色/语速后自动重新预热当前课文（慢速开启则含慢速变体） */
  if (window.HHTTS && window.HHTTS.addPrewarmer) {
    window.HHTTS.addPrewarmer(() => {
      if (!(window.HHTTS && window.HHTTS.prewarm)) return;
      const sents = TEXTS[textIdx].segs.map(s => s.map(w => w.ch).join('')).slice(0, 8);
      window.HHTTS.prewarm(sents);
      if (slow) window.HHTTS.prewarm(sents, { rate: 0.8 });
    });
  }
  setTimeout(() => speak('欢迎来到朗读剧场，我们先听一听', { onend: playSentence }), 400);
})();
