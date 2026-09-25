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

  /* ---- 官方标准录音包接入位（人教社/国家中小学智慧教育平台等官方出品） ----
     把官方下载的拼音录音按「拼音标注.mp3」命名（如 bō.mp3、zhī.mp3）放入
     assets/pinyin-audio/，即自动优先播放官方录音；目录为空时使用 TTS 合成。
     官方资源需在官方平台登录后下载，软件不做自动抓取。 */
  const OFFICIAL_DIR = 'assets/pinyin-audio';

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
  async function ensurePinyinBank() {
    if (bankInFlight) return 0;
    bankInFlight = true;
    let filled = 0;
    try {
      /* 构建全部需要的标注：呼读音 + 四声变体（声母与 a 相拼） */
      const FINAL_VOWEL = { 'üe': 'e', 'ai': 'a', 'ei': 'e', 'ui': 'i', 'ao': 'a', 'ou': 'o', 'iu': 'u',
                            'ie': 'e', 'er': 'e', 'an': 'a', 'en': 'e', 'in': 'i', 'un': 'u',
                            'ang': 'a', 'eng': 'e', 'ing': 'i', 'ong': 'o',
                            'a': 'a', 'o': 'o', 'e': 'e', 'i': 'i', 'u': 'u' };
      const SUFFIXES = Object.keys(FINAL_VOWEL).sort((x, y) => y.length - x.length);
      const TONE_CHAR = { 'a': 'āáǎà', 'o': 'ōóǒò', 'e': 'ēéěè', 'i': 'īíǐì', 'u': 'ūúǔù' };
      const addTone = (syl, tone) => {
        for (const suf of SUFFIXES) {
          if (syl.endsWith(suf)) {
            const v = FINAL_VOWEL[suf];
            return syl.slice(0, syl.length - suf.length) + suf.replace(v, TONE_CHAR[v][tone - 1]);
          }
        }
        return syl;
      };
      const isShengmu = p => /^[bpmfdtnlgkhjqxzhchszywr]$/.test(p);
      const wanted = [];
      Object.keys(SYLLABLES).forEach(p => {
        wanted.push(SYLLABLES[p]);
        const base = isShengmu(p) ? p + 'a' : SYLLABLES[p];
        for (let t = 1; t <= 4; t++) wanted.push(addTone(base, t));
      });
      const uniq = [...new Set(wanted)];

      /* 先探测云端是否可用：限流/断网时本轮只装官方包与本地库存，
         不逐条空等（避免一次预热拖几十分钟），90s 后自动重试 */
      let cloudOk = true;
      try {
        await fetchOnce('预', GLOBAL.rate, GLOBAL.pitch, 0, 8000);
      } catch (e) { cloudOk = false; }

      for (const ann of uniq) {
        const key = keyFor(ann, GLOBAL.rate, GLOBAL.pitch);
        if (mem.has(key)) { filled++; continue; }
        /* ① 官方录音包 */
        try {
          const r = await fetch(OFFICIAL_DIR + '/' + encodeURIComponent(ann) + '.mp3');
          if (r.ok) {
            const blob = await r.blob();
            await bankPut(ann, blob);
            mem.set(key, URL.createObjectURL(blob));
            filled++; continue;
          }
        } catch (e) {}
        /* ② 本地库存（上次已下载） */
        try {
          const blob = await bankGet(ann);
          if (blob) {
            mem.set(key, URL.createObjectURL(blob));
            filled++; continue;
          }
        } catch (e) {}
        /* ③ 云端合成 → 存入本地库存 */
        if (!cloudOk) { setFailAt(Date.now()); continue; }
        try {
          const blob = await fetchOnce(ann, GLOBAL.rate, GLOBAL.pitch, 0, 8000);
          await bankPut(ann, blob);
          mem.set(key, URL.createObjectURL(blob));
          filled++;
        } catch (e) { setFailAt(Date.now()); }
      }
      /* 没铺满：90s 后自动补一轮（直到全量进库） */
      if (filled < uniq.length) {
        setTimeout(() => { bankInFlight = false; ensurePinyinBank(); }, 90000);
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
      body: JSON.stringify({ text: text, voice: GLOBAL.voice, rate: rate, pitch: pitch, prio: prio || 0 }),
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
  let seq = 0, curAudio = null, curAbort = null;
  const mem = new Map();          /* 进程内音频缓存：key → objectURL */
  const pending = new Map();      /* 合成中去重：key → Promise<url>（防并发重复合成） */

  function stop() {
    seq++;
    if (curAbort) { try { curAbort.abort(); } catch (e) {} curAbort = null; }
    if (curAudio) { curAudio.pause(); curAudio = null; }
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

  function keyFor(text, voice, rate, pitch) {
    return [text, voice, rate, pitch].join('|');
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
            body: JSON.stringify({ text: text, voice: voice, rate: rate, pitch: pitch, prio: prio || 0 }),
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
      if (mem.size > 60) {                   /* 内存缓存上限，防长会话膨胀 */
        const first = mem.keys().next().value;
        URL.revokeObjectURL(mem.get(first));
        mem.delete(first);
      }
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
    const voice = (opt.voiceId && VOICES.some(v => v.id === opt.voiceId)) ? opt.voiceId : s.voice;
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
     实测小霞/小艺/阳光会按中文音节朗读。拼音音节一律路由到安全音色。 */
  const PINYIN_SAFE = new Set(['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural', 'zh-CN-YunxiNeural']);
  function pinyinVoiceId() {
    const s = getSettings();
    return PINYIN_SAFE.has(s.voice) ? s.voice : DEF.voice;
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
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'zh-CN';
    u.rate = 0.95;
    u.pitch = 1.05;
    if (opt && opt.onstart) u.onstart = opt.onstart;
    if (opt && opt.onend) u.onend = opt.onend;
    speechSynthesis.speak(u);
  }

  function speak(text, opt, fallback) {
    opt = opt || {};
    /* 统一发音人：忽略外部传入的音色差异，永远使用全局唯一发音人 */
    opt = Object.assign({}, opt, { voiceId: GLOBAL.voice });
    /* 失败兜底：未传 fallback（如经 common.js 转发）时用本机备用声 */
    if (typeof fallback !== 'function') fallback = browserSpeak;
    const my = ++seq;
    if (curAbort) { try { curAbort.abort(); } catch (e) {} curAbort = null; }
    if (curAudio) { curAudio.pause(); curAudio = null; }

    const textS = String(text);
    const s = getSettings();
    const voice = (opt.voiceId && VOICES.some(v => v.id === opt.voiceId)) ? opt.voiceId : s.voice;
    const rate = effRate(s, opt), pitch = effPitch(s);
    const key = keyFor(textS, voice, rate, pitch);
    const cached = mem.get(key);

    /* 限流/故障期（90s 内有过失败，跨页面记忆）且未缓存：立即备用声音 */
    if (!cached && Date.now() - lastFailAt() < 90000) {
      fallback(textS, opt);
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
        audio.onerror = () => { if (my === seq) fallback(String(text), opt); };
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
        fallback(String(text), opt);
      }
    })();
    return { cancel: stop };
  }

  /* 对外接口 */
  return { speak: speak, stop: stop, ping: ping, prewarm: prewarm, unlockAudio: unlockAudio,
           pinyinVoiceId: pinyinVoiceId,
           getSettings: getSettings,
           ensurePinyinBank: ensurePinyinBank, syllableOf: syllableOf,
           VOICES: VOICES, RATES: RATES, PITCHES: PITCHES, DEF: DEF, GLOBAL: GLOBAL };
})();
/* 全局统一工具类别名：所有页面通过 window.AudioManager 调用语音 */
window.AudioManager = window.HHTTS;
