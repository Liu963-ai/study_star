/* ============================================================
   闯关地图逻辑 · ditu.js（v2 重做：可玩的关卡答题）
   ------------------------------------------------------------
   · 10 个关卡沿小路排布，每关一道选择题，题目从各站内容随机生成：
     看图选词 / 听音选声母 / 字选拼音 / 拼音选字 / 连读辨调 /
     诗句出处（第 10 关）
   · 状态 hh_mapLevel（当前关卡 1-10）：答对解锁下一关；
     10 关全过 → 庆祝弹层 → 领星星（gotoSettle），新一轮重新随机出题
   · 答错不惩罚：轻摇 + 「再想一想」，可继续选
   · 小火车 🚂 停在当前关卡，过关后开往下一站
   · 限时挑战（顶栏 ⏱ 开关，状态 hh_mapTimed）：每道题一根剩余时间条，
     时间用完不判错、不关题，只温柔提示；10 秒内答对额外奖 1 颗星。
     奖励只加不减，符合「一年级不出现惩罚性反馈」的约束。
   ============================================================ */
(function () {
  'use strict';
  const { speak, sfx, store, icon, toast } = HH;
  const $ = id => document.getElementById(id);
  const stage = $('mapStage'), train = $('train');
  const T = window.HHTTS;                    /* 标调与拼音安全音色（tts.js） */

  /* 节点坐标（百分比），大致沿既有虚线路径 */
  const NODE_XY = [
    [14, 72], [23, 50], [31, 43], [40, 47], [47, 57],
    [54, 58], [60, 42], [67, 35], [76, 40], [88, 58]
  ];
  const TOTAL = NODE_XY.length;      /* 关数由坐标表派生：加一关只需加一行坐标 */
  /* 每关的题型池（由易到难）；关数超过池长度时取模复用 */
  const LEVEL_TYPES = [
    ['emoji'], ['sound'], ['emoji', 'sound'],
    ['char2py'], ['py2char', 'tone'], ['sound', 'char2py'],
    ['py2char', 'emoji'], ['char2py', 'sound', 'tone'],
    ['py2char', 'char2py'], ['poem']
  ];
  function typesOf(n) { return LEVEL_TYPES[(n - 1) % LEVEL_TYPES.length]; }

  let level = Math.min(Math.max(store.get('mapLevel', 1), 1), TOTAL);   /* 当前关卡 */

  /* ================= 题库生成 ================= */
  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  /* 取 n 个干扰项。sameKey 用来排除「与正确答案同值」的项——
     否则同音字（十/石 shí、力/立 lì…）会生成两个一模一样的选项，
     而且两个都被判正确，题面自相矛盾。 */
  function pickOthers(arr, exclude, n, sameKey) {
    const key = sameKey || (x => x);
    const eq = key(exclude);
    const pool = arr.filter(x => x !== exclude && key(x) !== eq);
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* 词→emoji 表（看图选词用） */
  const WORD_EMOJI = {};
  DATA.jushi.forEach(r => ['who', 'where', 'what'].forEach(t =>
    r[t].forEach(c => { WORD_EMOJI[c[0]] = c[1]; })));
  const ALL_WORDS = Object.keys(WORD_EMOJI);
  /* 拼音组字数据拉平：[{c, py}] */
  const PY_CHARS = [];
  ['shengmu', 'yunmu', 'zhengti'].forEach(g =>
    DATA.pinyin[g].forEach(it => it.chars.forEach(x => PY_CHARS.push({ c: x.c, py: x.py }))));
  /* 声母呼读音表 */
  const SHENGMU = DATA.pinyin.shengmu;
  /* 拼音全表 63 项（连读辨调取音节用；与拼音站同源，改数据即同步） */
  const ALL_PINYIN = [];
  ['shengmu', 'yunmu', 'zhengti'].forEach(g =>
    DATA.pinyin[g].forEach(x => ALL_PINYIN.push({ p: x.p, read: x.read })));
  /* 生字表 [{char, pinyin}] */
  const SZ = DATA.shengzi.map(s => ({ char: s.char, py: s.pinyin }));

  /* 每种题型返回：{ askNode(挂题目 DOM), say(朗读文本), opts:[{label, right, speak}] } */
  function buildQuestion(type) {
    if (type === 'emoji') {
      const word = rnd(ALL_WORDS);
      const others = pickOthers(ALL_WORDS, word, 2);
      return {
        big: WORD_EMOJI[word],
        bigCls: 'emoji',
        say: '看图片，选词语',
        opts: shuffle([word, ...others]).map(w => ({ label: w, right: w === word, speak: w }))
      };
    }
    if (type === 'sound') {
      /* 选项是「声母字母」，每个选项点下去要念它自己的呼读音。
         以前 speak 恒等于正确答案的呼读音（it.read），而且干扰项直接
         把 {p,read,chars} 对象塞进 label —— 界面上显示两个 [object Object]，
         点错还会听到正确答案的读音，属于反向教学。 */
      const it = rnd(SHENGMU);
      const others = pickOthers(SHENGMU, it, 2, x => x.p);
      return {
        big: '🔊',
        bigCls: 'emoji',
        say: '听一听，是哪个声母？' + it.read,
        autoSayDelay: 500,
        opts: shuffle([it, ...others]).map(o => ({
          label: o.p, right: o.p === it.p, speak: o.read
        }))
      };
    }
    if (type === 'tone') {
      /* 语音模块缺失时不硬撑，退回同族的看字选拼音（标调全靠 tts.js） */
      if (!(T && typeof T.addTone === 'function' && typeof T.toneBase === 'function')) {
        return buildQuestion('char2py');
      }
      /* 连读辨调：给出一个带声调的标注（如 bǎ），选出它是第几声。
         四个选项固定为四个声调，选项里朗读的是「同一个音节在该声调下的
         读法」（bā / bá / bǎ / bà）——点错也能听到声调对比，是可听的
         反馈；标注统一走拼音安全音色，服务不可用时静音，绝不读成英文字母。 */
      const it = rnd(ALL_PINYIN);
      const base = T.toneBase(it.p);
      const tone = 1 + Math.floor(Math.random() * 4);
      const TONE_CN = ['第一声', '第二声', '第三声', '第四声'];
      return {
        big: T.addTone(base, tone),
        bigCls: 'pinyin',
        say: '这个音是第几声？',
        sayPy: T.addTone(base, tone),
        opts: TONE_CN.map((name, i) => ({
          label: name, right: i + 1 === tone,
          speak: T.addTone(base, i + 1), pinyin: true
        }))
      };
    }
    if (type === 'char2py') {
      const it = rnd(SZ);
      const others = pickOthers(SZ, it, 2, x => x.py).map(x => x.py);
      return {
        big: it.char,
        bigCls: 'hanzi',
        say: '「' + it.char + '」的拼音是哪个？',
        /* pinyin:true —— 选项本身就是拼音标注（bà/shān…），
           朗读时必须走拼音安全音色并在服务不可用时静音，否则会读成英文字母 */
        opts: shuffle([it.py, ...others]).map(p => ({ label: p, right: p === it.py, speak: p, pinyin: true }))
      };
    }
    if (type === 'py2char') {
      const it = rnd(PY_CHARS);
      /* 排除同音的字（否则「哪个字读 yī？」会出现两个正确选项），
         同时排除同一个字（同一字可能出现在多个分组） */
      const others = pickOthers(PY_CHARS.filter(x => x.py !== it.py), it, 2, x => x.c).map(x => x.c);
      return {
        big: it.py,
        bigCls: 'pinyin',
        /* 题干含拼音标注，不能拼进整句：混排时 TTS 可能把 yī 读成英文字母。
           拆成「引导语 + 单独读标注」，标注用拼音安全音色（见 sayQuestion）。 */
        say: '下面这个音，是哪个字？',
        sayPy: it.py,
        opts: shuffle([it.c, ...others]).map(c => ({ label: c, right: c === it.c, speak: c }))
      };
    }
    /* poem：诗句出处 */
    const t = rnd(DATA.langdu.list);
    const others = pickOthers(DATA.langdu.list, t, 2, x => x.title);
    const frag = t.text.replace(/[，。！？、：“”]/g, '').slice(0, 6);
    return {
      big: frag + '……',
      bigCls: 'hanzi',
      say: '「' + frag + '」出自哪篇课文？',
      opts: shuffle([t.title, ...others.map(x => x.title)]).map(ti => ({
        label: ti, right: ti === t.title, speak: ti
      }))
    };
  }

  /* ================= 地图节点 ================= */
  const nodeEls = [];
  for (let i = 0; i < TOTAL; i++) {
    const el = document.createElement('button');
    el.className = 'node pressable';
    el.style.setProperty('--nx', NODE_XY[i][0] + '%');
    el.style.setProperty('--ny', NODE_XY[i][1] + '%');
    el.setAttribute('aria-label', '第' + (i + 1) + '关');
    el.innerHTML = '<span class="node-ball"><span class="node-num">' + (i + 1) + '</span></span>' +
                   '<span class="node-star hidden"><span class="ico" data-ico="star"></span></span>';
    el.addEventListener('click', () => onNode(i + 1));
    stage.appendChild(el);
    nodeEls.push(el);
  }
  HH.injectIcons(stage);

  function paint() {
    nodeEls.forEach((el, i) => {
      const n = i + 1;
      el.classList.remove('done', 'current', 'locked');
      el.querySelector('.node-star').classList.toggle('hidden', n >= level);
      let stateCn;
      if (n < level) { el.classList.add('done'); stateCn = '已通关'; }
      else if (n === level) { el.classList.add('current'); stateCn = '当前关卡'; }
      else { el.classList.add('locked'); stateCn = '还没有解锁'; }
      /* 状态不只靠颜色：读屏与色觉障碍用户也能分辨 */
      el.setAttribute('aria-label', '第' + n + '关，' + stateCn);
      if (n === level) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });
    const xy = NODE_XY[level - 1];
    train.style.left = xy[0] + '%';
    train.style.top = 'calc(' + xy[1] + '% - 74px)';
    /* 预热点未解锁提示（含关卡数字，动态文本，不预热则点击冷合成 3-5s） */
    if (window.HHTTS && window.HHTTS.prewarm) {
      window.HHTTS.prewarm(['先通过第' + level + '关，小火车才能开到这里']);
    }
  }

  function onNode(n) {
    if (n > level) { speak('先通过第' + level + '关，小火车才能开到这里'); return; }
    openQuest(n);
  }

  /* ================= 答题任务卡 ================= */
  const quest = $('quest');
  let curQ = null, curLevel = 0, answered = false;

  /* ================= 限时挑战（正向激励，无惩罚） =================
     顶栏 ⏱ 开关（状态 hh_mapTimed）开启后，每道题显示一根剩余时间条：
       · 时间用完不判错、不关闭题目，只温柔提示「时间到啦，慢慢想也可以」，
         题目继续可答 —— 一年级不出现惩罚性反馈（任务书 §7.1）；
       · 奖励只加不减：10 秒内答对额外奖 1 颗星，答对本身照常走关卡记账；
       · 时间条只改 transform，逐帧不触发重排。 */
  const TIMED_LIMIT_MS = 20000;      /* 一根条跑完的时间 */
  const TIMED_FAST_MS = 10000;       /* 在这个时间内答对算「又快又准」 */
  let timedOn = store.get('mapTimed', false) === true;
  let timedId = null, timedStart = 0;
  const timedToggle = $('timedToggle'), timedEl = $('questTimer'), timedBar = $('questTimerBar');

  function paintTimedToggle() {
    timedToggle.setAttribute('aria-pressed', timedOn ? 'true' : 'false');
    timedToggle.setAttribute('aria-label', timedOn ? '限时挑战已开启' : '限时挑战已关闭');
  }
  timedToggle.addEventListener('click', () => {
    timedOn = !timedOn;
    store.set('mapTimed', timedOn);
    paintTimedToggle();
    sfx.tap();
    speak(timedOn ? '限时挑战开始，答得快还有奖励哦' : '限时挑战关掉啦，慢慢想也可以');
  });

  function stopTimer() {
    if (timedId !== null) { clearInterval(timedId); timedId = null; }
    timedEl.classList.add('hidden');
    timedBar.style.transform = 'scaleX(1)';
  }
  function startTimer() {
    stopTimer();
    if (!timedOn) return;
    timedStart = Date.now();
    timedEl.classList.remove('hidden');
    timedId = setInterval(() => {
      const left = TIMED_LIMIT_MS - (Date.now() - timedStart);
      if (left <= 0) {                       /* 时间到：停表、提示，但不判错 */
        clearInterval(timedId);
        timedId = null;
        timedBar.style.transform = 'scaleX(0)';
        toast('时间到啦，慢慢想也可以');
        speak('时间到啦，慢慢想也可以');
        return;
      }
      timedBar.style.transform = 'scaleX(' + (left / TIMED_LIMIT_MS).toFixed(3) + ')';
    }, 100);
  }
  /* 是否「又快又准」：必须在 stopTimer 之前调用（停表会把定时器清掉） */
  function answeredFast() {
    return timedOn && timedId !== null && (Date.now() - timedStart) <= TIMED_FAST_MS;
  }

  function openQuest(n) {
    curLevel = n;
    answered = false;
    curQ = buildQuestion(rnd(typesOf(n)));
    $('questLevel').textContent = '第 ' + n + ' 关';
    const ask = $('questAsk');
    ask.innerHTML = '';
    const big = document.createElement('div');
    big.className = 'quest-big ' + (curQ.bigCls || 'hanzi');
    big.textContent = curQ.big;
    ask.appendChild(big);
    const opts = $('questOpts');
    opts.innerHTML = '';
    curQ.opts.forEach(o => {
      const b = document.createElement('button');
      b.className = 'quest-opt pressable';
      b.textContent = o.label;
      b.addEventListener('click', () => choose(b, o));
      opts.appendChild(b);
    });
    quest.classList.remove('hidden');
    /* autoSayDelay：题干音频的延迟（听音题需要稍等遮罩动画再出声）——
       此前这个字段被声明却从未生效，一律写死 350ms */
    setTimeout(sayQuestion, curQ.autoSayDelay || 350);
    startTimer();
    /* 预热题目与选项语音（答对/答错反馈也提前合成）。
       拼音标注与汉字必须分开预热：音色不同，混在一起会导致缓存键错配，
       点击时仍要现场合成。 */
    if (window.HHTTS && window.HHTTS.prewarm) {
      const plain = curQ.opts.filter(o => !o.pinyin).map(o => o.speak || o.label);
      const pyOpts = curQ.opts.filter(o => o.pinyin).map(o => o.speak || o.label);
      window.HHTTS.prewarm([curQ.say, ...plain, '答对啦！小火车出发喽',
                            '答对啦，又快又准！小火车出发喽',
                            '再想一想', '时间到啦，慢慢想也可以']);
      if (curQ.sayPy) window.HHTTS.prewarm([curQ.sayPy], { pinyinVoice: true });
      if (pyOpts.length) window.HHTTS.prewarm(pyOpts, { pinyinVoice: true });
    }
  }

  /* 题干播报：py2char 的题干带一个拼音标注（如 yī），必须用拼音安全音色
     单独读，不能拼进整句——混排时引擎可能把标注读成英文字母。
     用 onend 链式保证顺序；降级通道也会补一次 onend（见 tts.js）。 */
  function sayQuestion() {
    if (!curQ) return;
    if (curQ.sayPy) {
      speak(curQ.say, { onend: () => speak(curQ.sayPy, { pinyinVoice: true }) });
    } else {
      speak(curQ.say);
    }
  }
  $('questListen').addEventListener('click', () => sayQuestion());
  $('questClose').addEventListener('click', () => { stopTimer(); quest.classList.add('hidden'); });

  function choose(btn, o) {
    sfx.tap();
    /* 选项若是拼音标注（char2py / tone：bà、ǎ…），必须走拼音安全音色 +
       降级保护，否则会被读成英文字母或丢失声调 */
    speak(o.speak || o.label, o.pinyin ? { pinyinVoice: true } : undefined);
    if (answered) return;
    if (o.right) {
      answered = true;
      sfx.star();
      btn.classList.add('right');
      const fast = answeredFast();          /* 必须先判定：stopTimer 会清掉计时器 */
      stopTimer();
      if (fast) {
        /* 只加不减：又快又准额外奖 1 颗星（答对本身的关卡记账照旧） */
        HH.record({ stars: 1 });
        toast('又快又准，多奖 1 颗星！');
      }
      setTimeout(() => {
        quest.classList.add('hidden');
        levelComplete(fast);
      }, 700);
    } else {
      sfx.hmm();
      btn.classList.remove('wobble'); void btn.offsetWidth;
      btn.classList.add('wobble');
      speak('再想一想');
    }
  }

  function levelComplete(fast) {
    stopTimer();
    sfx.ok();
    /* 重玩旧关（curLevel < level）：答对只给鼓励，不推进关卡，
       否则重玩第 1 关会把关卡数跳到未学过的关（越级 bug） */
    if (curLevel < level) {
      speak('答对啦！这是复习，再往前挑战新关卡吧');
      paint();
      return;
    }
    speak(fast ? '答对啦，又快又准！小火车出发喽' : '答对啦！小火车出发喽');
    if (level < TOTAL) {
      level++;
      store.set('mapLevel', level);
      paint();
    } else {
      store.set('mapLevel', TOTAL);
      paint();
      setTimeout(() => {
        $('party').classList.remove('hidden');
        speak('小火车到站啦！十关全部通过，你真棒！');
      }, 800);
    }
  }

  /* 10 关全部完成：领星星走结算，新一轮重新随机出题 */
  $('btnPartyOk').addEventListener('click', () => {
    sfx.star();
    store.set('mapLevel', 1);
    level = 1;
    paint();
    $('party').classList.add('hidden');
    HH.gotoSettle({
      title: '你完成了闯关地图！',
      sub: '小火车跑完了全程',
      stars: 5, module: 'jushi', task: 'jushi'
    });
  });

  /* ---- 启动 ---- */
  paintTimedToggle();
  paint();
  /* 引导音改由「教程」按钮按需播放 */
})();
