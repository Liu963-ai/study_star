/* ============================================================
   语音服务 · tts.js（Edge-TTS 客户端 + 语音设置 + 预热缓存）
   ------------------------------------------------------------
   统一出口：文本 → 本地 edge-tts 服务（tts_server.py）→ mp3 → 播放。
   · 音色/语速/音调收敛在 VOICES/RATES/PITCHES 常量，设置存 hh_voice
   · 相同内容在内存与磁盘双层缓存，重复朗读零等待
   · prewarm(texts)：后台预合成（并发 1），点击时秒播——解决
     「点击播放有延迟」（首次合成需经云端 1-4s）
   · 自动播放策略适配：页面未交互时浏览器会拒绝播放，此类文本
     会排队，首次点击（解锁）后自动补播——解决「打开没声音」
   · 错误分类：自动播放拒绝不再误判「服务宕机」；网络类失败
     重试一次后才降级浏览器 speechSynthesis，不阻塞主流程
   注意：本模块只访问配置常量 TTS_BASE 指定的第一方本地服务，
   不请求任何其他地址（协议限 http/https）。
   ============================================================ */
window.HHTTS = (function () {
  'use strict';

  /* ---- 服务地址（唯一出口，修改端口只改这里） ----
     跟随页面访问地址：电脑上用 127.0.0.1 打开时走本机；
     手机/平板通过电脑局域网 IP 打开时，自动指向电脑，语音在手机上也能出声。 */
  const TTS_BASE = 'http://' + (location.hostname || '127.0.0.1') + ':7860';

  /* ---- 全局统一发音人参数（全软件唯一配置，任何页面不得单独覆盖） ----
     唯一发音人＝小艺姐姐；语速/音调全局固定。所有场景（声母、韵母、
     课文、界面）都经由本工具类的同一套参数发声。 */
  const GLOBAL = {
    voice: 'zh-CN-XiaoyiNeural',   // 小艺姐姐（全局唯一发音人）
    rate: -5,                      // 全局统一语速
    pitch: 0                       // 全局统一音调
  };
  const VOICES = [{ id: GLOBAL.voice, name: '小艺姐姐', desc: '统一发音人 · 活泼女声', emoji: '👧', def: true }];
  const RATES = [{ v: GLOBAL.rate, name: '正常' }];
  const PITCHES = [{ v: GLOBAL.pitch, name: '正常' }];
  const DEF = { voice: GLOBAL.voice, rate: GLOBAL.rate, pitch: GLOBAL.pitch };

  /* ---- 全局配置只读出口：所有调用方拿到的永远是同一套参数 ---- */
  function getSettings() {
    return { voice: GLOBAL.voice, rate: GLOBAL.rate, pitch: GLOBAL.pitch };
  }

  /* ================= 标准拼音标注表（63 个，绝不把单个字母发给 TTS） =================
     声母＝呼读音标准标注（bō/pō…），韵母＝第一声标准标注（ā/āi/uī…），
     整体认读＝音节标注（zhī/yì…）。 */
  const SYLLABLES = {
    b: 'bō', p: 'pō', m: 'mō', f: 'fó', d: 'dé', t: 'tè', n: 'nè', l: 'lè',
    g: 'gē', k: 'kē', h: 'hē', j: 'jī', q: 'qī', x: 'xī',
    zh: 'zhī', ch: 'chī', sh: 'shī', r: 'rì', z: 'zī', c: 'cī', s: 'sī',
    y: 'yī', w: 'wū',
    a: 'ā', o: 'ō', e: 'ē', i: 'ī', u: 'ū', ü: 'yū',
    ai: 'āi', ei: 'ēi', ui: 'uī', ao: 'āo', ou: 'ōu', iu: 'iū',
    ie: 'iē', üe: 'yuē', er: 'ēr',
    an: 'ān', en: 'ēn', in: 'īn', un: 'ūn', ün: 'yūn',
    ang: 'āng', eng: 'ēng', ing: 'īng', ong: 'ōng',
    zhi: 'zhī', chi: 'chī', shi: 'shī', ri: 'rì', zi: 'zī', ci: 'cì', si: 'sì',
    yi: 'yī', wu: 'wǔ', yu: 'yú', ye: 'yè', yue: 'yuè', yuan: 'yuán',
    yin: 'yīn', yun: 'yún', ying: 'yīng'
  };
  function syllableOf(p) { return SYLLABLES[p] || p; }

  /* ================= 拼音标调（全站唯一实现） =================
     教材规则：按最长后缀定位韵母，声调标在其主元音上（iu/ui 标在后一个
     字母；ü 用 ǖǘǚǜ）。
     这里必须只有一份实现：pinyin.js 的四声按钮与语音库预合成（见
     pinyinBankList）都调用 addTone。历史上 tts.js 与 pinyin.js 各写了一份
     且表项不一致——tts.js 缺 'ü'/'ün' 两项、声母判定又漏掉 zh/ch/sh，
     导致语音库有 129 条与页面实际播放的标注对不上（占 41%），
     其中 36 个拼音的四声在库里退化成「同一个标注重复 4 次」。 */
  const FINAL_VOWEL = { 'üe': 'e', 'ai': 'a', 'ei': 'e', 'ui': 'i', 'ao': 'a', 'ou': 'o', 'iu': 'u',
                        'ie': 'e', 'er': 'e', 'an': 'a', 'en': 'e', 'in': 'i', 'un': 'u', 'ün': 'ü',
                        'ang': 'a', 'eng': 'e', 'ing': 'i', 'ong': 'o',
                        'a': 'a', 'o': 'o', 'e': 'e', 'i': 'i', 'u': 'u', 'ü': 'ü' };
  const SUFFIXES = Object.keys(FINAL_VOWEL).sort((x, y) => y.length - x.length);
  const TONE_CHAR = { 'a': 'āáǎà', 'o': 'ōóǒò', 'e': 'ēéěè', 'i': 'īíǐì',
                      'u': 'ūúǔù', 'ü': 'ǖǘǚǜ' };
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
  /* ---- 非独立音节的合成替身（synthForm） ----
     edge-tts（Azure）对「不能独立成音节的孤立韵母标注」直接返回
     NoAudioReceived（无音频、0 字节）。实测（edge-tts 7.2.8 / 小艺姐姐）：
       成功  ā bā bà zhī 玻 一 爸爸
       失败  ī í ǐ ì ū（全部 NoAudioReceived）
     原因见《汉语拼音方案》：a/o/e 可以独立成音节，i/u/ü 独立时必须写成
     yi/wu/yu（i 行改 y、u 行改 w、ü 行加 y 并去两点）。
     后果很严重：这些标注**永远合成不出来**（不是慢，是拿不到音频）→
     语音库缺条 → 每次点击都现场合成并失败 → 降级到系统语音 →
     孩子听到丢声调或按英文字母读的错误读音。
     这里按正字法给出「读音完全相同」的合法写法，只替换送往 TTS 的文本：
     页面显示、语音库键、内存缓存键仍用原标注（缓存键经 keyFor 统一，见下）。 */
  const STANDALONE = {
    'i': 'yi', 'ia': 'ya', 'ie': 'ye', 'iao': 'yao', 'iu': 'you', 'ian': 'yan',
    'in': 'yin', 'iang': 'yang', 'ing': 'ying', 'iong': 'yong',
    'u': 'wu', 'ua': 'wa', 'uo': 'wo', 'uai': 'wai', 'ui': 'wei', 'uan': 'wan',
    'un': 'wen', 'uang': 'wang', 'ueng': 'weng',
    'ü': 'yu', 'üe': 'yue', 'üan': 'yuan', 'ün': 'yun'
  };
  const TONE_OF = {};                        /* 'ǐ' → ['i', 3] 反向查表 */
  Object.keys(TONE_CHAR).forEach(v => {
    for (let t = 0; t < 4; t++) TONE_OF[TONE_CHAR[v][t]] = [v, t + 1];
  });
  /* 只对「整体就是一个独立韵母」的标注生效：bā/zhī/玻/一 一律原样返回 */
  function synthForm(text) {
    const s = String(text);
    let base = '', tone = 0;
    for (const ch of s) {
      const info = TONE_OF[ch];
      if (info) { base += info[0]; tone = info[1]; }
      else base += ch;
    }
    const fixed = STANDALONE[base];
    return fixed ? addTone(fixed, tone || 1) : s;
  }
  /* 声母判定：必须覆盖 zh/ch/sh 双字母（旧正则 [bpmfdtnlgkhjqxzhchszywr]
     是单字符集合，'zh' 长度 2 永远不匹配），同时不能把 zhi/chi/shi
     等整体认读误判成声母——正则整体加 (?:…) 与 $ 锚定。 */
  const SHENG_MU_RE = /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])$/;
  function isShengmuPinyin(p) { return SHENG_MU_RE.test(p); }
  /* 四声练习的基础音节：声母与 a 相拼（b → bā bá bǎ bà），其余用拼音本体。
     注意传进来的是无调形式（SYLLABLES 的键），不是 SYLLABLES 的值
     ——旧代码把已带声调的 'ā'/'zhī' 再送进 addTone，找不到后缀就原样返回，
     四声因此全部退化成第一声。 */
  function toneBase(p) { return isShengmuPinyin(p) ? p + 'a' : p; }
  /* 语音库应预合成的全部标注：呼读音 + 四声变体（供 ensurePinyinBank 与测试用） */
  function pinyinBankList() {
    const wanted = [];
    Object.keys(SYLLABLES).forEach(p => {
      wanted.push(SYLLABLES[p]);
      for (let t = 1; t <= 4; t++) wanted.push(addTone(toneBase(p), t));
    });
    return [...new Set(wanted)];
  }

  /* ---- 官方标准录音包接入位（人教社/国家中小学智慧教育平台等官方出品） ----
     把官方下载的拼音录音按「拼音标注.mp3」命名（如 bō.mp3、zhī.mp3）放入
     assets/pinyin-audio/，即自动优先播放官方录音；目录为空时使用 TTS 合成。
     官方资源需在官方平台登录后下载，软件不做自动抓取。 */
  const OFFICIAL_DIR = 'assets/pinyin-audio';
  /* 官方录音包是否已放置：目录里没有 mp3 时，逐条 fetch 会稳定产生
     约 273 次 404（每个标注一次），把首屏 I/O 全占满。
     只要第一条就 404，就认为整个目录为空并在本机记下来，之后不再探测。 */
  const OFFICIAL_FLAG = 'hh_officialAudioMissing';
  function officialAudioMissing() {
    try { return localStorage.getItem(OFFICIAL_FLAG) === '1'; } catch (e) { return false; }
  }
  function markOfficialAudioMissing() {
    try { localStorage.setItem(OFFICIAL_FLAG, '1'); } catch (e) {}
  }

  /* ---- 拼音语音库：IndexedDB 持久化（blob），启动全量加载进内存 ----
     命中后点击零网络请求。库存键＝标准拼音标注。 */
  const BANK_DB = 'hh_tts', BANK_STORE = 'syllables';
  let bankDbp = null;
  function bankOpen() {
    if (bankDbp) return bankDbp;
    bankDbp = new Promise((res, rej) => {
      const rq = indexedDB.open(BANK_DB, 1);
      rq.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(BANK_STORE)) db.createObjectStore(BANK_STORE);
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return bankDbp;
  }
  async function bankPut(ann, blob) {
    const db = await bankOpen();
    return new Promise((res, rej) => {
      const st = db.transaction(BANK_STORE, 'readwrite').objectStore(BANK_STORE);
      st.put(blob, ann).onsuccess = () => res();
      st.transaction.onerror = () => rej(st.transaction.error);
    });
  }
  async function bankGet(ann) {
    const db = await bankOpen();
    return new Promise((res, rej) => {
      const st = db.transaction(BANK_STORE, 'readonly').objectStore(BANK_STORE);
      st.get(ann).onsuccess = () => res(st.result || null);
      st.transaction.onerror = () => rej(st.transaction.error);
    });
  }

  /* ---- 启动全量预加载：官方录音包优先 → 本地库存 → 云端合成（一次性） ---- */
  let bankInFlight = false;
  let bankRounds = 0;                 /* 未铺满时的补轮次数（最多 3 轮） */
  async function ensurePinyinBank() {
    if (bankInFlight) return 0;
    bankInFlight = true;
    let filled = 0;
    try {
      /* 全部需要的标注：呼读音 + 四声变体（标调算法与 pinyin.js 共用一份，见 addTone） */
      const uniq = pinyinBankList();

      /* 官方录音包是否启用：由内容总控的开关决定（js/data.js 的
         pinyinAudioPack）。未启用时连第一次探测都不发——否则每次首访
         都会产生一次 404（目录里只有说明文件），既白跑一个往返又在
         控制台留下一条红色报错，看起来像 bug。 */
      const packOn = !!(window.DATA && window.DATA.pinyinAudioPack);

      /* 先探测云端是否可用：限流/断网时本轮只装官方包与本地库存，
         不逐条空等（避免一次预热拖几十分钟），90s 后自动重试 */
      let cloudOk = true;
      try {
        await fetchOnce('预', GLOBAL.rate, GLOBAL.pitch, 0, 8000);
      } catch (e) { cloudOk = false; }

      for (const ann of uniq) {
        const key = keyFor(ann, GLOBAL.rate, GLOBAL.pitch);
        if (mem.has(key)) { filled++; continue; }
        /* ① 打包/官方录音包：先找 .wav（本地提取的 TTS 打包），再找
              .mp3（未来放入的官方录音），命中即入库不再依赖云端 */
        if (packOn && !officialAudioMissing()) {
          try {
            const base = OFFICIAL_DIR + '/' + encodeURIComponent(ann);
            let r = await fetch(base + '.wav');
            if (!r.ok) r = await fetch(base + '.mp3');
            if (r.ok) {
              const blob = await r.blob();
              await bankPut(ann, blob);
              bankKeys.add(key);
              mem.set(key, URL.createObjectURL(blob));
              filled++; continue;
            }
            markOfficialAudioMissing();
          } catch (e) {}
        }
        /* ② 本地库存（上次已下载） */
        try {
          const blob = await bankGet(ann);
          if (blob) {
            bankKeys.add(key);
            mem.set(key, URL.createObjectURL(blob));
            filled++; continue;
          }
        } catch (e) {}
        /* ③ 云端合成 → 存入本地库存 */
        if (!cloudOk) { setFailAt(Date.now()); continue; }
        try {
          const blob = await fetchOnce(ann, GLOBAL.rate, GLOBAL.pitch, 0, 8000);
          await bankPut(ann, blob);
          bankKeys.add(key);
          mem.set(key, URL.createObjectURL(blob));
          filled++;
        } catch (e) { setFailAt(Date.now()); }
      }
      /* 没铺满：按 90s → 3min → 6min 退避补一轮，最多 3 轮。
         （以前是无上限每 90s 重来一次，服务长时间不可用时能空转一整夜，
            后台标签页也照跑。） */
      if (filled < uniq.length && bankRounds < 3) {
        const delay = 90000 * Math.pow(2, bankRounds);
        bankRounds++;
        setTimeout(ensurePinyinBank, delay);
        return filled;
      }
    } finally {
      bankInFlight = false;
    }
    return filled;
  }

  /* ---- 单次合成请求（供语音库/重试链使用） ---- */
  function fetchOnce(text, rate, pitch, prio, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(TTS_BASE + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: synthForm(text), voice: GLOBAL.voice, rate: rate, pitch: pitch, prio: prio || 0 }),
      signal: ctrl.signal
    }).then(res => {
      clearTimeout(timer);
      if (!res.ok) throw new Error('tts-http-' + res.status);
      return res.blob();
    });
  }

  /* ---- 服务可用性探测（结果缓存 30s，失败自动降级） ---- */
  let avail = null, availAt = 0;
  /* 最近一次服务失败时刻：跨页面持久化（localStorage）——
     90s 内任何页面的未缓存文本直接走备用声，保证即时反馈 */
  function lastFailAt() {
    try { return parseInt(localStorage.getItem('hh_ttsFailAt'), 10) || 0; }
    catch (e) { return 0; }
  }
  function setFailAt(ms) {
    try { localStorage.setItem('hh_ttsFailAt', String(ms)); } catch (e) {}
  }
  async function ping() {
    if (avail !== null && Date.now() - availAt < 30000) return avail;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(TTS_BASE + '/ping', { signal: ctrl.signal });
      clearTimeout(timer);
      avail = res.ok;
    } catch (e) { avail = false; }
    availAt = Date.now();
    return avail;
  }
  function markDown() { avail = false; availAt = Date.now(); setFailAt(Date.now()); }
  function markUp() { setFailAt(0); }

  /* ---- 朗读会话管理：新朗读顶替旧朗读（与原 HH.speak 行为一致） ---- */
  let seq = 0, curAudio = null;
  const mem = new Map();          /* 进程内音频缓存：key → objectURL */
  const pending = new Map();      /* 合成中去重：key → Promise<url>（防并发重复合成） */
  const bankKeys = new Set();     /* 语音库条目：内存淘汰时必须跳过（见 evict） */

  function stop() {
    seq++;
    if (curAudio) { curAudio.pause(); curAudio = null; }
    /* 降级通道此前不受 stop 管辖：新朗读顶替旧朗读时，系统语音会把上一句
       念完再念新的，孩子会听到两个声音叠在一起。 */
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
  }

  /* 内存缓存淘汰：按条数控制长会话膨胀，但**绝不淘汰语音库条目**。
     语音库约 273 条，是「点击零网络请求」的基础；按固定 60 条上限淘汰，
     会把刚装好的语音库逐条 revoke 掉，语音库等于白装。 */
  function evict() {
    const limit = Math.max(60, bankKeys.size + 60);
    while (mem.size > limit) {
      let victim = null;
      for (const k of mem.keys()) { if (!bankKeys.has(k)) { victim = k; break; } }
      if (!victim) break;
      URL.revokeObjectURL(mem.get(victim));
      mem.delete(victim);
    }
  }

  /* 语速映射：设置档位为基准；学习页慢速朗读（opt.rate ≤0.85）再降 10% */
  function effRate(s, opt) {
    let v = s.rate;
    if (opt && opt.rate != null) {
      if (opt.rate <= 0.85) v -= 10;
      else if (opt.rate >= 1) v += 5;
    }
    return Math.max(-50, Math.min(20, v));
  }
  function effPitch(s) { return s.pitch; }

  /* 缓存键用「合成文本」：孤立韵母标注（ǐ）与其合法写法（yǐ）读音相同、
     服务端产物也相同，共用一份缓存，避免重复合成与语音库虚胖。 */
  function keyFor(text, voice, rate, pitch) {
    return [synthForm(text), voice, rate, pitch].join('|');
  }

  /* ---- 取音频 url：内存命中秒回；合成中并发去重；失败重试一次 ----
     prio：1=点击朗读（服务端插队），0=预热（让位给点击） */
  function getUrl(text, voice, rate, pitch, prio) {
    const key = keyFor(text, voice, rate, pitch);
    if (mem.has(key)) return Promise.resolve(mem.get(key));
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      let res = null, lastErr = null;
      for (let i = 0; i < 2; i++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4500);   /* 云端限流/卡顿时快速回落备用声音 */
          res = await fetch(TTS_BASE + '/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: synthForm(text), voice: voice, rate: rate, pitch: pitch, prio: prio || 0 }),
            signal: ctrl.signal
          });
          clearTimeout(timer);
          if (res.ok) break;
          lastErr = new Error('tts-http-' + res.status);
        } catch (err) {
          lastErr = err;
          if (String(err && err.name) === 'AbortError') { res = null; break; }
        }
        await new Promise(r => setTimeout(r, 350));   /* 退避后重试 */
      }
      pending.delete(key);
      if (!res || !res.ok) {
        setFailAt(Date.now());                   /* 失败证据跨页面生效：下一页直接走快速通道 */
        throw (lastErr || new Error('tts-fail'));
      }
      setFailAt(0);                              /* 成功＝服务恢复 */
      const url = URL.createObjectURL(await res.blob());
      mem.set(key, url);
      evict();                               /* 内存缓存上限，防长会话膨胀 */
      return url;
    })();
    pending.set(key, job);
    return job;
  }

  /* ---- 预热：后台批量预合成（并发 1），点击时秒播 ----
     opt.voiceId：为特殊文本（如拼音音节）指定音色，与 speak 的路由一致；
     opt.rate：为慢速朗读等变体预热（与 speak 的 effRate 计算保持一致）。 */
  async function prewarm(texts, opt) {
    opt = opt || {};
    try { if (await ping() === false) return 0; } catch (e) { return 0; }
    const s = getSettings();
    /* 音色判定必须与 speak 完全一致，否则预热出的缓存键与播放时对不上，
       「点击零网络请求」的语音库等于白建（历史上正是拼音预热用安全音色、
       播放却用普通音色，导致拼音每次都要现场合成）。 */
    const voice = opt.pinyinVoice ? pinyinVoiceId()
      : (opt.voiceId && VOICES.some(v => v.id === opt.voiceId)) ? opt.voiceId : s.voice;
    const rate = effRate(s, opt);
    const list = [...new Set((texts || []).filter(Boolean).map(String))].slice(0, 40);
    let done = 0, i = 0;
    /* 3 路并发预热（服务端 4 路并行 + 点击可插队），铺满缓存更快 */
    const worker = async () => {
      while (i < list.length) {
        const t = list[i++];
        try {
          await getUrl(t, voice, rate, s.pitch, 0);
          done++;
        } catch (e) { /* 预热失败静默，点击时仍可现场合成/降级 */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return done;
  }

  /* ---- 自动播放策略：未交互时 play() 被浏览器拒绝。
     把文本排队，首次点击（unlockAudio）后自动补播，不再静默丢失。 ---- */
  let unlocked = false;
  let pendingAuto = null;                  /* 只保留最后一条（新顶旧语义） */
  const SILENT_WAV =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      const a = new Audio(SILENT_WAV);
      a.volume = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
    if (pendingAuto) {
      const p = pendingAuto; pendingAuto = null;
      speak(p.text, p.opt, p.fallback);
    }
  }

  /* ---- 拼音音节的专用音色 ----
     部分音色（如云扬播音腔）会把带调拼音 mā/ǎ 读成英文字母，
     实测小霞/小艺/阳光会按中文音节朗读。拼音音节一律路由到安全音色。
     兜底必须是一个「确定安全」的音色：旧代码兜底到 DEF.voice，而 DEF.voice
     就是全局音色本身——等于没兜底，一旦全局音色换成云扬，
     pinyinVoiceId() 会原样返回不安全音色，拼音仍被读成英文字母。 */
  const PINYIN_SAFE = new Set(['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunxiNeural']);
  const PINYIN_SAFE_DEFAULT = 'zh-CN-XiaoyiNeural';   /* 安全集成员，与全局音色解耦 */
  function pinyinVoiceId() {
    const s = getSettings();
    return PINYIN_SAFE.has(s.voice) ? s.voice : PINYIN_SAFE_DEFAULT;
  }

  /* ---- 请求合成并播放；任何失败走 fallback（浏览器 TTS），不阻塞 ----
     opt.voiceId：临时试听指定音色（语音设置弹窗用），不影响已存设置
     即时反馈保证：
     · 已缓存（内存/磁盘）→ 高质量音色毫秒级播放
     · 未缓存但服务健康   → 服务器合成（点击插队，最长 4.5s）
     · 服务限流/故障期    → 立即用本机备用声音即时播报（90s 失败记忆期），
       同时后台继续补拉高质量音频，恢复后自动升级音质 */
  /* 本机离线备用声（浏览器 speechSynthesis，中文）：保证任何情况都有声音 */
  function browserSpeak(text, opt) {
    if (!('speechSynthesis' in window) || !text) return;
    /* 系统里没有中文语音时不要硬读：其它语种的引擎会把汉字念成乱码或整句跳过。
       实测无头环境 getVoices() 返回 0 个语音，此时 speak() 是静默的空操作。
       首次调用 getVoices() 可能返回空数组（异步加载），为空则放行保持原行为。 */
    try {
      const vs = speechSynthesis.getVoices();
      if (vs.length && !vs.some(v => /^zh/i.test(v.lang || ''))) {
        /* 不出声，但必须补一次 onend：依赖它推进的流程（拼音连读、声波动画、
           跟读引导）否则会永久卡住。 */
        if (opt && typeof opt.onend === 'function') { try { opt.onend(); } catch (e) {} }
        return;
      }
    } catch (e) {}
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'zh-CN';
    u.rate = 0.95;
    u.pitch = 1.05;
    if (opt && opt.onstart) u.onstart = opt.onstart;
    if (opt && opt.onend) u.onend = opt.onend;
    speechSynthesis.speak(u);
  }

  /* 拼音在降级通道下无法保证正确读音：宁可不出声，也不教错。
     只在首次提示一次（提示面向家长，孩子看不懂文字），并补一次 onend
     让调用链继续（连读、声波动画、跟读引导都依赖它）。 */
  let pinyinWarned = false;
  function pinyinNoFallback(opt) {
    if (!pinyinWarned) {
      pinyinWarned = true;
      try {
        if (window.HH && window.HH.toast) window.HH.toast('语音服务未连接，拼音示范暂时无法播放');
      } catch (e) {}
    }
    if (opt && typeof opt.onend === 'function') { try { opt.onend(); } catch (e) {} }
  }

  function speak(text, opt, fallback) {
    opt = opt || {};
    /* 统一发音人：除拼音音节外，忽略外部传入的音色差异，永远使用全局唯一发音人。
       拼音音节（opt.pinyinVoice）必须路由到能正确朗读音节的音色，见 pinyinVoiceId。 */
    opt = Object.assign({}, opt, { voiceId: opt.pinyinVoice ? pinyinVoiceId() : GLOBAL.voice });
    /* 失败兜底：未传 fallback（如经 common.js 转发）时用本机备用声 */
    if (typeof fallback !== 'function') fallback = browserSpeak;
    /* ---- 降级通道保护 ----
       系统语音无法可靠还原带声调符号的拼音标注（bō/à/zhā）：中文引擎通常丢掉
       声调，非中文引擎直接按英文字母读——两者都会教错。故拼音音节分两路降级：
         · 有汉字替代文本（音卡：b → 玻）→ 读汉字，读音正确
         · 无替代文本（四声 ā/á/ǎ/à 没有同音汉字）→ 静音 + 提示，不糊弄 */
    const fbText = opt.fallbackText ? String(opt.fallbackText) : String(text);
    const fb = (opt.pinyinVoice && !opt.fallbackText)
      ? function (t, o) { pinyinNoFallback(o); }
      : function (t, o) { return fallback(fbText, o); };
    const my = ++seq;
    if (curAudio) { curAudio.pause(); curAudio = null; }

    const textS = String(text);
    const s = getSettings();
    const voice = (opt.voiceId && VOICES.some(v => v.id === opt.voiceId)) ? opt.voiceId : s.voice;
    const rate = effRate(s, opt), pitch = effPitch(s);
    const key = keyFor(textS, voice, rate, pitch);
    const cached = mem.get(key);

    /* 限流/故障期（90s 内有过失败，跨页面记忆）且未缓存：立即备用声音 */
    if (!cached && Date.now() - lastFailAt() < 90000) {
      fb(textS, opt);
      getUrl(textS, voice, rate, pitch, 0).then(() => markUp()).catch(() => {});   /* 后台补拉 */
      return { cancel: stop };
    }

    (async () => {
      try {
        if (await ping() === false) throw new Error('tts-down');
        const url = await getUrl(textS, voice, rate, pitch, 1);
        markUp();
        if (my !== seq) return;                  /* 已被新朗读顶替 */
        const audio = new Audio(url);
        curAudio = audio;
        audio.onplay = () => { if (my === seq && opt.onstart) opt.onstart(); };
        audio.onended = () => { if (my === seq && opt.onend) opt.onend(); };
        audio.onerror = () => { if (my === seq) fb(String(text), opt); };
        try {
          await audio.play();
        } catch (playErr) {
          if (String(playErr && playErr.name) === 'NotAllowedError') {
            /* 自动播放被拦：服务是好的，排队等首次点击后补播，绝不 markDown */
            if (my === seq) pendingAuto = { text: String(text), opt: opt, fallback: fallback };
            return;
          }
          throw playErr;
        }
      } catch (e) {
        if (my !== seq) return;
        if (String(e && e.name) === 'AbortError') return;
        if (String(e && e.message) !== 'tts-down') markDown();   /* 仅网络类失败才降级 30s */
        fb(String(text), opt);
      }
    })();
    return { cancel: stop };
  }

  /* 对外接口 */
  return { speak: speak, stop: stop, ping: ping, prewarm: prewarm, unlockAudio: unlockAudio,
           pinyinVoiceId: pinyinVoiceId,
           getSettings: getSettings,
           ensurePinyinBank: ensurePinyinBank, syllableOf: syllableOf,
           /* 标调与语音库清单：与 pinyin.js 共用同一份实现，勿在别处另写一份 */
           addTone: addTone, toneBase: toneBase, pinyinBankList: pinyinBankList,
           synthForm: synthForm,
           VOICES: VOICES, RATES: RATES, PITCHES: PITCHES, DEF: DEF, GLOBAL: GLOBAL };
})();
/* 全局统一工具类别名：所有页面通过 window.AudioManager 调用语音 */
window.AudioManager = window.HHTTS;
