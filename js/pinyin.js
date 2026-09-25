/* ============================================================
   拼音星球逻辑 · pinyin.js（任务书 §6.4 + 拼音全表扩容）
   ------------------------------------------------------------
   · 拼音全表分组（23 声母 / 24 韵母 / 16 整体认读），胶囊切换，
     点击字母卡切下一个；
   · 朗读走「标准拼音标注」（AudioManager.SYLLABLES：b→bō、a→ā、
     zhi→zhī），绝不把单个字母直接发给 TTS；音色强制路由到拼音安全音色
     （opt.pinyinVoice），避免被某些音色读成英文字母；
   · 降级保护：若 edge-tts 服务不可用，音卡改用呼读音汉字（read 字段）
     朗读；四声（ā/á/ǎ/à）没有同音汉字，宁可静音也不出错误读音
     ——系统语音读不准带调标注，读错等于教错；
   · 右侧组字卡：当前拼音可组成的汉字 + 词语，字/词/拼音均可点击
     朗读（词语拼音由 pinyin-pro 运行时标注）；
   · 长按说话：真实采集麦克风音量驱动声波柱（可按「保留录音」落盘）。
   ============================================================ */
(function () {
  'use strict';
  const { speak, sfx, store } = window.HH;
  const HHRec = window.HHRec, AudioDB = window.AudioDB;
  const $ = id => document.getElementById(id);
  const bigLetter = $('bigLetter');
  const letterRead = $('letterRead');
  const ziTitle = $('ziTitle');
  const ziRows = $('ziRows');
  const toneRow = $('toneRow');
  const wave = $('wave');
  const btnRec = $('btnRec');
  const btnFollow = $('btnFollow');
  const recognizing = $('recognizing');

  const GROUP_NAME = { shengmu: '声母', yunmu: '韵母', zhengti: '整体认读' };
  const CN_TONE = ['一', '二', '三', '四'];
  /* 四声符号（展示用，随拼音颜色变化） */
  const TONE_MARKS = ['ˉ', 'ˊ', 'ˇ', 'ˋ'];

  /* ---- 语音预热：后台预合成，点击时秒播（解决首次合成 1-4s 延迟） ----
     拼音标注（呼读音/四声）走拼音安全音色，用 opt.pinyinVoice 声明，
     与 speak 的路由保持同一份判定；组字卡的字/词是普通词语，用普通音色。 */
  function prewarmTexts(texts, opt) {
    if (window.HHTTS && window.HHTTS.prewarm) window.HHTTS.prewarm(texts, opt);
  }
  function prewarmGroup() {
    if (book) return;
    /* 预热必须与真正的播放内容一致：playLetter 播的是标准拼音标注
       （syllableOf('b') → 'bō'），不是呼读音汉字「玻」。
       之前预热汉字，等于每次切分组白合成一整组音频，点击时仍要现合成。 */
    prewarmTexts(GROUPS[gi].list.map(x => window.HHTTS.syllableOf(x.p)), { pinyinVoice: true });
  }
  function prewarmCurrent() {
    const it = cur();
    if (book) {
      prewarmTexts([it.say, it.char, ...(it.words || [])]);
      return;
    }
    /* 延迟 1.5s：让当前点击的呼读音优先合成，再做四声与组字词预热 */
    setTimeout(() => {
      const tones = toneList();
      prewarmTexts([
        ...tones.map(t => t.mark),                                       /* 连读用裸音节 */
        ...tones.map(t => t.mark + '，第' + CN_TONE[t.tone - 1] + '声'),
        '欢迎来到拼音星球，先听我读，再跟着读一遍。'
      ], { pinyinVoice: true });
      prewarmTexts((it.chars || []).map(x => x.c).concat((it.chars || []).map(x => x.w)));
    }, 1500);
  }

  /* ---- 标调：给音节加第 tone(1-4) 声的声调符号 ----
     规则与实现只有一份，在 tts.js 的 addTone（语音库预合成调用的同一份）。
     历史上这里与 tts.js 各写一份、表项还不一致（tts.js 缺 'ü'/'ün' 两项），
     导致语音库约 41% 的标注与页面实际播放的对不上，
     36 个拼音的四声在库里全部退化成第一声。 */
  function addTone(syl, tone) {
    return (window.HHTTS && window.HHTTS.addTone) ? window.HHTTS.addTone(syl, tone) : syl;
  }

  /* ---- 当前拼音的四声列表（声母与 a 相拼；韵母/整体认读直接标调） ---- */
  function toneList() {
    const isShengmu = !book && GROUPS[gi] && GROUPS[gi].name === GROUP_NAME.shengmu;
    const syl = isShengmu ? cur().p + 'a' : cur().p;
    return [1, 2, 3, 4].map(t => ({ mark: addTone(syl, t), tone: t }));
  }

  /* ---- 内容源：教材包优先，否则拼音全表分组 ---- */
  const book = window.HHBooks && HHBooks.active();
  let bookList = null, bi = 0;
  const GROUPS = book ? [] : [
    { name: GROUP_NAME.shengmu, list: DATA.pinyin.shengmu },
    { name: GROUP_NAME.yunmu, list: DATA.pinyin.yunmu },
    { name: GROUP_NAME.zhengti, list: DATA.pinyin.zhengti }
  ];
  let gi = 0, si = 0;
  const cur = () => book
    ? bookList[bi % bookList.length]
    : GROUPS[gi].list[si % GROUPS[gi].list.length];

  /* ---- 词语拼音：pinyin-pro 运行时标注（含声调），失败退回字的拼音 ---- */
  function wordPy(word) {
    try {
      if (window.pinyinPro) return window.pinyinPro.pinyin(word, { toneType: 'symbol', type: 'string' });
    } catch (e) {}
    return '';
  }

  /* ---- 分组切换小胶囊（内置模式显示；教材模式没有分组概念） ---- */
  if (book) {
    bookList = HHBooks.pickChars(8).map(c => ({
      letter: c.pinyin,
      say: c.char + '。' + ((c.words && c.words[0]) || ''),
      char: c.char,
      words: c.words || []
    }));
  } else {
    const bar = $('pyGroups');
    GROUPS.forEach((g, i) => {
      const b = document.createElement('button');
      b.className = 'py-g pressable' + (i === 0 ? ' on' : '');
      b.textContent = g.name + ' ' + g.list.length;
      b.addEventListener('click', () => {
        sfx.tap();
        gi = i; si = 0;
        [...bar.children].forEach((c, j) => c.classList.toggle('on', j === i));
        paint();
        playLetter();
      });
      bar.appendChild(b);
    });
    prewarmGroup();     /* 进入页面即预热本组全部呼读音 */
  }

  /* ---- 渲染大字母卡（拼音 + 呼读音）与右侧组字卡 ---- */
  function paint() {
    const it = cur();
    bigLetter.textContent = it.p;
    if (book) {
      /* 教材模式：展示该音节的汉字与组词 */
      letterRead.textContent = it.char ? ('读作「' + it.char + '」') : '';
      ziTitle.textContent = it.char ? ('「' + it.char + '」可以组成') : '组字词';
      ziRows.innerHTML = '';
      (it.words || []).forEach(w => {
        ziRows.appendChild(ziRow(it.char, w, w));
      });
      prewarmCurrent();
      return;
    }
    letterRead.textContent = GROUPS[gi].name + ' ' + it.p + '，读作「' + it.read + '」';
    ziTitle.textContent = '「' + it.p + '」可以组成';
    ziRows.innerHTML = '';
    it.chars.forEach(x => {
      ziRows.appendChild(ziRow(x.c, x.py, x.w));
    });
    paintTones();
    prewarmCurrent();
  }

  /* ---- 四声练习行：四个带调音节按钮 + 连读开关 ----
     连读开：点第 N 声，从第一声连读到第 N 声（ā á ǎ）；
     连读关：点第 N 声，只读该声。 */
  let liandu = false;

  function chainSpeak(marks) {
    const next = i => {
      if (i >= marks.length) return;
      const isLast = i === marks.length - 1;
      speak(marks[i], isLast ? { pinyinVoice: true } : { pinyinVoice: true, onend: () => next(i + 1) });
    };
    next(0);
  }

  function paintTones() {
    if (!toneRow) return;
    if (book) { toneRow.innerHTML = ''; return; }   /* 教材模式：音节已带调，不重复练四声 */
    toneRow.innerHTML = '';
    /* 连读开关 */
    const ld = document.createElement('button');
    ld.className = 'tone-liandu pressable' + (liandu ? ' on' : '');
    ld.setAttribute('aria-pressed', liandu ? 'true' : 'false');
    ld.innerHTML = '<span class="tone-mark">1→4</span><span class="tone-syl">连读</span>';
    ld.addEventListener('click', () => {
      sfx.tap();
      liandu = !liandu;
      ld.classList.toggle('on', liandu);
      ld.setAttribute('aria-pressed', liandu ? 'true' : 'false');
      if (liandu) {
        /* 开启即示范：从第一声连读到第四声 */
        chainSpeak(toneList().map(t => t.mark));
      } else {
        speak('单声朗读');
      }
    });
    toneRow.appendChild(ld);
    toneList().forEach(t => {
      const b = document.createElement('button');
      b.className = 'tone-btn pressable';
      b.innerHTML = '<span class="tone-mark">' + TONE_MARKS[t.tone - 1] + '</span>' +
                    '<span class="tone-syl"></span>';
      b.querySelector('.tone-syl').textContent = t.mark;
      b.setAttribute('aria-label', '第' + CN_TONE[t.tone - 1] + '声');
      b.addEventListener('click', () => {
        sfx.tap();
        if (liandu) {
          /* 连读：从第一声读到所点的声调 */
          chainSpeak(toneList().slice(0, t.tone).map(x => x.mark));
        } else {
          /* edge-tts 会把带调拼音读成对应音节（已按音高轮廓验证）。
             四声没有同音汉字，无法提供降级替代文本 —— 服务不可用时
             tts.js 会静音并提示家长，而不是用系统语音读错声调。 */
          speak(t.mark + '，第' + CN_TONE[t.tone - 1] + '声', { pinyinVoice: true });
        }
      });
      toneRow.appendChild(b);
    });
  }

  /* 组字卡一行：[拼音+汉字]（点击读字） [词语+词语拼音]（点击读词） */
  function ziRow(ch, py, word) {
    const row = document.createElement('div');
    row.className = 'zi-row';

    const zi = document.createElement('button');
    zi.className = 'zi-zi pressable';
    zi.innerHTML = '<span class="zi-py"></span><span class="zi-char"></span>';
    zi.querySelector('.zi-py').textContent = py || ch;
    zi.querySelector('.zi-char').textContent = ch;
    zi.addEventListener('click', () => { sfx.tap(); speak(ch); });

    const w = document.createElement('button');
    w.className = 'zi-word pressable';
    w.innerHTML = '<span class="zi-w"></span><span class="zi-wpy"></span>';
    w.querySelector('.zi-w').textContent = word;
    w.querySelector('.zi-wpy').textContent = wordPy(word) || py || '';
    w.addEventListener('click', () => { sfx.tap(); speak(word); });

    row.append(zi, w);
    return row;
  }

  /* 降级替代文本：只有 read 真的是一个汉字时才有意义。
     ei/ün/eng/ong 的 read 本身就是拼音标注（教材里没有对应汉字），
     返回 null 即「无替代」→ 服务不可用时静音提示，不放错音。 */
  const CN_CHAR = /^[\u4e00-\u9fa5]$/;
  const cnRead = s => (CN_CHAR.test(s || '') ? s : null);

  /* ---- 播放示范音：声波柱与声音同步（标准拼音标注，非英文字母） ---- */
  function playLetter() {
    const it = cur();
    if (book) {
      speak(it.say, {
        onstart: () => wave.classList.add('playing'),
        onend:   () => wave.classList.remove('playing')
      });
    } else {
      /* 标准拼音标注（bō/pō/zhī/ēi…）：由 AudioManager.SYLLABLES 统一转换，
         绝不把单个字母直接传给 TTS。
         pinyinVoice：路由到能正确朗读音节的音色（否则某些音色读成英文字母）；
         fallbackText：服务不可用时改读呼读音汉字（b → 玻），读音仍然正确。 */
      speak(window.HHTTS.syllableOf(it.p), {
        pinyinVoice: true,
        fallbackText: cnRead(it.read),
        onstart: () => wave.classList.add('playing'),
        onend:   () => wave.classList.remove('playing')
      });
    }
  }
  $('btnReplay').addEventListener('click', playLetter);

  /* ---- 点字母卡：教材模式切下一个生字拼音；内置模式切下一个拼音 ---- */
  bigLetter.parentElement.addEventListener('click', () => {
    if (book) { bi++; paint(); }
    else { si++; paint(); }
    playLetter();
  });
  bigLetter.style.cursor = 'pointer';

  /* ---- 长按说话：真实采集麦克风 → 音量柱起伏；
          默认只可视化，家长开启「保留录音」后本次音频存入本机 ---- */
  let pressing = false;
  let pressHandle = null, pressCtx = null, pressRaf = 0;

  function setWaveLv(lv) {
    [...wave.children].forEach((b, i) => {
      b.style.height = (8 + lv * 46 * (0.5 + 0.5 * Math.abs(Math.sin(i * 0.9)))) + 'px';
    });
  }

  async function pressStart(e) {
    e.preventDefault();
    pressing = true;
    btnRec.classList.add('rec');
    if (HHRec.supported()) {
      try {
        pressHandle = await HHRec.start();
        /* 抬手可能比麦克风授权更快（孩子点一下就松手）：
           pressEnd 已经跑完并把 pressing 置回 false，这里若直接继续，
           录音流将永远没人释放——麦克风指示灯常亮，是隐私事故级问题。
           所以必须在 await 之后重新检查一次，过期就自己收尾。 */
        if (!pressing) {
          const h = pressHandle; pressHandle = null;
          try { await h.stop(); } catch (err) {}
          return;
        }
        pressCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = pressCtx.createMediaStreamSource(pressHandle.stream);
        const analyser = pressCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        (function tick() {
          if (!pressing) return;
          analyser.getByteFrequencyData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
          setWaveLv(Math.min(1, (sum / buf.length) / 90));
          pressRaf = requestAnimationFrame(tick);
        })();
      } catch (err) {
        pressHandle = null;              /* 授权被拒：保持闪烁视觉，不中断 */
      }
    }
  }
  async function pressEnd() {
    if (!pressing) return;
    pressing = false;
    btnRec.classList.remove('rec');
    cancelAnimationFrame(pressRaf);
    if (pressCtx) { pressCtx.close(); pressCtx = null; }
    [...wave.children].forEach(b => { b.style.height = '14px'; });
    let blob = null;
    if (pressHandle) { blob = await pressHandle.stop(); pressHandle = null; }
    if (blob) creditFollow();            /* 完成一次跟读：即时记星（拼音站此前完全不产生数据） */
    /* 识别态：3 个跳动小圆点，1200ms */
    recognizing.classList.remove('hidden');
    setTimeout(() => {
      recognizing.classList.add('hidden');
      if (blob && HHRec.keepOn()) {      /* 仅家长开启保留后落盘（IndexedDB，仅本机） */
        AudioDB.put({ id: 'py' + Date.now(), ts: Date.now(), title: '拼音跟读', blob: blob })
          .then(() => HH.toast('录音已保存'));
      }
      speak('那我再读一遍，你跟着来', { onend: playLetter });
    }, 1200);
  }

  /* ---- 跟读记账：1 次跟读 = 1 颗星 + 今日任务打勾；
          每 8 次跟读算通关 1 关（进度上限 4，与其它三站口径一致） ---- */
  const FOLLOW_PER_LEVEL = 8;
  function creditFollow() {
    const t = store.get('pyTrain', { n: 0, lv: 0 });
    t.n = (t.n || 0) + 1;
    const lv = Math.floor(t.n / FOLLOW_PER_LEVEL);
    const up = lv > (t.lv || 0);
    t.lv = lv;
    store.set('pyTrain', t);
    window.HH.record({ stars: 1, task: 'pinyin', module: up ? 'pinyin' : null });
  }
  [btnRec, btnFollow].forEach(btn => {
    btn.addEventListener('pointerdown', pressStart);
    btn.addEventListener('pointerup', pressEnd);
    btn.addEventListener('pointerleave', () => { if (pressing) pressEnd(); });
    btn.addEventListener('pointercancel', pressEnd);
  });

  /* ---- 进入页面：先引导，再读当前拼音（呼读音） ---- */
  paint();
  setTimeout(() => {
    speak('欢迎来到拼音星球，先听我读，再跟着读一遍。', { onend: playLetter });
  }, 500);
})();
