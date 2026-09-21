/* ============================================================
   闯关地图逻辑 · ditu.js（v2 重做：可玩的关卡答题）
   ------------------------------------------------------------
   · 10 个关卡沿小路排布，每关一道选择题，题目从四站内容随机生成：
     看图选词 / 听音选声母 / 字选拼音 / 拼音选字 / 诗句出处（第 10 关）
   · 状态 hh_mapLevel（当前关卡 1-10）：答对解锁下一关；
     10 关全过 → 庆祝弹层 → 领星星（gotoSettle），新一轮重新随机出题
   · 答错不惩罚：轻摇 + 「再想一想」，可继续选
   · 小火车 🚂 停在当前关卡，过关后开往下一站
   ============================================================ */
(function () {
  'use strict';
  const { speak, sfx, store, icon } = HH;
  const $ = id => document.getElementById(id);
  const stage = $('mapStage'), train = $('train');

  const TOTAL = 10;
  /* 节点坐标（百分比），大致沿既有虚线路径 */
  const NODE_XY = [
    [14, 72], [23, 50], [31, 43], [40, 47], [47, 57],
    [54, 58], [60, 42], [67, 35], [76, 40], [88, 58]
  ];
  /* 每关的题型池（由易到难） */
  const LEVEL_TYPES = [
    ['emoji'], ['sound'], ['emoji', 'sound'],
    ['char2py'], ['py2char'], ['sound', 'char2py'],
    ['py2char', 'emoji'], ['char2py', 'sound'],
    ['py2char', 'char2py'], ['poem']
  ];

  let level = Math.min(Math.max(store.get('mapLevel', 1), 1), TOTAL);   /* 当前关卡 */

  /* ================= 题库生成 ================= */
  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pickOthers(arr, exclude, n) {
    const pool = arr.filter(x => x !== exclude);
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
      const it = rnd(SHENGMU);
      const others = pickOthers(SHENGMU, it.p, 2);
      return {
        big: '🔊',
        bigCls: 'emoji',
        say: '听一听，是哪个声母？' + it.read,
        autoSayDelay: 500,
        opts: shuffle([it.p, ...others]).map(p => ({ label: p, right: p === it.p, speak: it.read }))
      };
    }
    if (type === 'char2py') {
      const it = rnd(SZ);
      const others = pickOthers(SZ, it, 2).map(x => x.py);
      return {
        big: it.char,
        bigCls: 'hanzi',
        say: '「' + it.char + '」的拼音是哪个？',
        opts: shuffle([it.py, ...others]).map(p => ({ label: p, right: p === it.py, speak: p }))
      };
    }
    if (type === 'py2char') {
      const it = rnd(PY_CHARS);
      const others = pickOthers(PY_CHARS.filter(x => x.py !== it.py), it, 2).map(x => x.c);
      return {
        big: it.py,
        bigCls: 'pinyin',
        say: '哪个字读' + it.py + '？',
        opts: shuffle([it.c, ...others]).map(c => ({ label: c, right: c === it.c, speak: c }))
      };
    }
    /* poem：诗句出处 */
    const t = rnd(DATA.langdu.list);
    const others = pickOthers(DATA.langdu.list, t, 2);
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
      if (n < level) el.classList.add('done');
      else if (n === level) el.classList.add('current');
      else el.classList.add('locked');
    });
    const xy = NODE_XY[level - 1];
    train.style.left = xy[0] + '%';
    train.style.top = 'calc(' + xy[1] + '% - 74px)';
  }

  function onNode(n) {
    if (n > level) { speak('先通过第' + level + '关，小火车才能开到这里'); return; }
    openQuest(n);
  }

  /* ================= 答题任务卡 ================= */
  const quest = $('quest');
  let curQ = null, curLevel = 0, answered = false;

  function openQuest(n) {
    curLevel = n;
    answered = false;
    const types = LEVEL_TYPES[n - 1];
    curQ = buildQuestion(rnd(types));
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
    setTimeout(() => speak(curQ.say), 350);
    /* 预热题目与选项语音（答对/答错反馈也提前合成） */
    if (window.HHTTS && window.HHTTS.prewarm) {
      window.HHTTS.prewarm([curQ.say,
        ...curQ.opts.map(o => o.speak || o.label),
        '答对啦！小火车出发喽', '再想一想']);
    }
  }
  $('questListen').addEventListener('click', () => { if (curQ) speak(curQ.say); });
  $('questClose').addEventListener('click', () => quest.classList.add('hidden'));

  function choose(btn, o) {
    sfx.tap();
    speak(o.speak || o.label);
    if (answered) return;
    if (o.right) {
      answered = true;
      sfx.star();
      btn.classList.add('right');
      setTimeout(() => {
        quest.classList.add('hidden');
        levelComplete();
      }, 700);
    } else {
      sfx.hmm();
      btn.classList.remove('wobble'); void btn.offsetWidth;
      btn.classList.add('wobble');
      speak('再想一想');
    }
  }

  function levelComplete() {
    sfx.ok();
    speak('答对啦！小火车出发喽');
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
  paint();
  setTimeout(() => speak('欢迎来到闯关地图，点击发光的关卡，答对题目小火车就出发！'), 500);
})();
