/* ============================================================
   拼音星球逻辑 · pinyin.js（任务书 §6.4 + 拼音全表扩容）
   ------------------------------------------------------------
   · 拼音全表分组（23 声母 / 24 韵母 / 16 整体认读），胶囊切换，
     点击字母卡切下一个；
   · 朗读一律走「呼读音汉字」（data.js read 字段）——TTS 读汉字，
     不再把 b/p/m 读成英文字母；
   · 右侧组字卡：当前拼音可组成的汉字 + 词语，字/词/拼音均可点击
     朗读（词语拼音由 pinyin-pro 运行时标注）；
   · 长按说话：真实采集麦克风音量驱动声波柱（可按「保留录音」落盘）。
   ============================================================ */
(function () {
  'use strict';
  const { speak, sfx } = window.HH;
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
     呼读音/拼音音节走拼音安全音色（与 speak 路由一致）；
     组字卡的字/词是普通词语，用用户所选音色。 */
  function pinyinVid() {
    return window.HHTTS ? window.HHTTS.pinyinVoiceId() : undefined;
  }
  function prewarmTexts(texts, opt) {
    if (window.HHTTS && window.HHTTS.prewarm) window.HHTTS.prewarm(texts, opt);
  }
  function prewarmGroup() {
    if (book) return;
    prewarmTexts(GROUPS[gi].list.map(x => x.read), { voiceId: pinyinVid() });
  }
  function prewarmCurrent() {
    const it = cur();
    if (book) {
      prewarmTexts([it.say, it.char, ...(it.words || [])]);
      return;
    }
    /* 延迟 300ms：让当前点击的呼读音优先合成，再做四声与组字词预热 */
    setTimeout(() => {
      const tones = toneList();
      prewarmTexts([
        ...tones.map(t => t.mark),                                       /* 连读用裸音节 */
        ...tones.map(t => t.mark + '，第' + CN_TONE[t.tone - 1] + '声'),
        '欢迎来到拼音星球，先听我读，再跟着读一遍。'
      ], { voiceId: pinyinVid() });
      prewarmTexts((it.chars || []).map(x => x.c).concat((it.chars || []).map(x => x.w)));
    }, 1500);
  }

  /* ---- 标调：给音节加第 tone(1-4) 声的声调符号 ----
     规则（与教材一致）：按最长后缀找到韵母，标在其主元音上
     （iu/ui 标在后一个字母；ü 用 ǖ ǘ ǚ ǜ）。
     声母的四声练习＝「声母 + a」的拼读四声（bā bá bǎ bà）。 */
  const FINAL_VOWEL = { 'üe':'e','ai':'a','ei':'e','ui':'i','ao':'a','ou':'o','iu':'u',
                        'ie':'e','er':'e','an':'a','en':'e','in':'i','un':'u','ün':'ü',
                        'ang':'a','eng':'e','ing':'i','ong':'o',
                        'a':'a','o':'o','e':'e','i':'i','u':'u','ü':'ü' };
  const SUFFIXES = Object.keys(FINAL_VOWEL).sort((x, y) => y.length - x.length);
  const TONE_CHAR = { 'a':'āáǎà', 'o':'ōóǒò', 'e':'ēéěè', 'i':'īíǐì',
                      'u':'ūúǔù', 'ü':'ǖǘǚǜ' };
  function addTone(syl, tone) {
    for (const suf of SUFFIXES) {
      if (syl.endsWith(suf)) {
        const vowel = FINAL_VOWEL[suf];
        const voiced = TONE_CHAR[vowel][tone - 1];
        return syl.slice(0, syl.length - suf.length) + suf.replace(vowel, voiced);
      }
    }
    return syl;
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
    const vid = window.HHTTS ? window.HHTTS.pinyinVoiceId() : undefined;
    const next = i => {
      if (i >= marks.length) return;
      const isLast = i === marks.length - 1;
      speak(marks[i], isLast ? { voiceId: vid } : { voiceId: vid, onend: () => next(i + 1) });
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
        const vid = window.HHTTS ? window.HHTTS.pinyinVoiceId() : undefined;
        if (liandu) {
          /* 连读：从第一声读到所点的声调 */
          chainSpeak(toneList().slice(0, t.tone).map(x => x.mark));
        } else {
          /* edge-tts 会把带调拼音读成对应音节（已按音高轮廓验证） */
          speak(t.mark + '，第' + CN_TONE[t.tone - 1] + '声', { voiceId: vid });
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
         绝不把单个字母或汉字直接传给 TTS */
      speak(window.HHTTS.syllableOf(it.p), {
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
  [btnRec, btnFollow].forEach(btn => {
    btn.addEventListener('pointerdown', pressStart);
    btn.addEventListener('pointerup', pressEnd);
    btn.addEventListener('pointerleave', () => { if (pressing) pressEnd(); });
    btn.addEventListener('pointercancel', pressEnd);
  });

  /* ---- 全页预热：当前内容优先，其次整组呼读音；
     注册到 HHTTS，换音色/语速后自动重新预热 ---- */
  function prewarmAll() {
    prewarmCurrent();
    prewarmGroup();
  }
  if (window.HHTTS && window.HHTTS.addPrewarmer) {
    window.HHTTS.addPrewarmer(prewarmAll);
  }

  /* ---- 进入页面：先引导，再读当前拼音（呼读音） ---- */
  paint();
  setTimeout(() => {
    speak('欢迎来到拼音星球，先听我读，再跟着读一遍。', { onend: playLetter });
  }, 500);
})();
