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

  /* ---- 音色常量（角色化命名，新增音色只改这里） ----
     默认音色选 Xiaoxiao（最自然清晰的女声）；云扬为新闻播音腔，吐字最清楚 */
  const VOICES = [
    { id: 'zh-CN-XiaoxiaoNeural', name: '小霞老师',   desc: '自然清晰女声', emoji: '👩‍🏫', def: true },
    { id: 'zh-CN-XiaoyiNeural',   name: '小艺姐姐',   desc: '活泼女声',     emoji: '👧' },
    { id: 'zh-CN-YunyangNeural',  name: '云扬叔叔',   desc: '播音腔男声',   emoji: '🧑‍🏫' },
    { id: 'zh-CN-YunxiNeural',    name: '阳光小哥哥', desc: '活泼男声',     emoji: '👦' },
    { id: 'zh-CN-YunxiaNeural',   name: '萌萌弟弟',   desc: '可爱男声',     emoji: '🧒' }
  ];
  /* 语速三档（映射 edge-tts 的 rate 百分比）；-5 比旧默认更快更自然 */
  const RATES = [{ v: -20, name: '慢' }, { v: -5, name: '正常' }, { v: 5, name: '快' }];
  /* 音调三档（映射 pitch Hz） */
  const PITCHES = [{ v: -5, name: '低' }, { v: 0, name: '正常' }, { v: 5, name: '高' }];
  const DEF = { voice: VOICES[0].id, rate: -5, pitch: 0 };

  /* ---- 存量设置一次性迁移：旧默认（小艺/慢速）切到新默认（更清晰） ----
     用户若手动选过其他音色则保持不动。 */
  (function migrateVoice() {
    if (localStorage.getItem('hh_voiceMigrated') === 'v2') return;
    const s = JSON.parse(localStorage.getItem('hh_voice') || 'null') || {};
    if (!s.voice || s.voice === 'zh-CN-XiaoyiNeural') {
      localStorage.setItem('hh_voice', JSON.stringify({ voice: DEF.voice, rate: DEF.rate, pitch: DEF.pitch }));
    }
    localStorage.setItem('hh_voiceMigrated', 'v2');
  })();

  /* ---- 设置读写：hh_voice，保存后立即生效（每次朗读都读最新值） ---- */
  function getSettings() {
    const s = JSON.parse(localStorage.getItem('hh_voice') || 'null') || {};
    return {
      voice: VOICES.some(v => v.id === s.voice) ? s.voice : DEF.voice,
      rate: RATES.some(r => r.v === s.rate) ? s.rate : DEF.rate,
      pitch: PITCHES.some(p => p.v === s.pitch) ? s.pitch : DEF.pitch
    };
  }
  /* ---- 预热注册表：各页注册自己的预热函数，
     音色/语速/音调一变，缓存键全部变化——自动触发全站重新预热，
     避免「换音色后每次点击都要现场合成 2 秒」 ---- */
  const prewarmers = new Set();
  function addPrewarmer(fn) {
    if (typeof fn === 'function') prewarmers.add(fn);
  }
  function runPrewarmers() {
    setTimeout(() => {
      prewarmers.forEach(fn => { try { fn(); } catch (e) {} });
    }, 400);
  }

  function setSettings(patch) {
    const before = getSettings();
    const s = Object.assign(before, patch || {});
    localStorage.setItem('hh_voice', JSON.stringify(s));
    /* 声音参数变化 → 缓存键全变 → 触发各页重新预热 */
    if (s.voice !== before.voice || s.rate !== before.rate || s.pitch !== before.pitch) {
      runPrewarmers();
    }
    return s;
  }

  /* ---- 服务可用性探测（结果缓存 30s，失败自动降级） ---- */
  let avail = null, availAt = 0;
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
  function markDown() { avail = false; availAt = Date.now(); }

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

  /* ---- 取音频 url：内存命中秒回；合成中并发去重；失败重试一次 ---- */
  function getUrl(text, voice, rate, pitch) {
    const key = keyFor(text, voice, rate, pitch);
    if (mem.has(key)) return Promise.resolve(mem.get(key));
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      let res = null, lastErr = null;
      for (let i = 0; i < 2; i++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          res = await fetch(TTS_BASE + '/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, voice: voice, rate: rate, pitch: pitch }),
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
      if (!res || !res.ok) throw (lastErr || new Error('tts-fail'));
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
    let done = 0;
    for (const t of list) {
      try {
        await getUrl(t, voice, rate, s.pitch);
        done++;
      } catch (e) { /* 预热失败静默，点击时仍可现场合成/降级 */ }
    }
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
     opt.voiceId：临时试听指定音色（语音设置弹窗用），不影响已存设置 */
  function speak(text, opt, fallback) {
    opt = opt || {};
    const my = ++seq;
    if (curAbort) { try { curAbort.abort(); } catch (e) {} curAbort = null; }
    if (curAudio) { curAudio.pause(); curAudio = null; }

    (async () => {
      try {
        if (await ping() === false) throw new Error('tts-down');
        const s = getSettings();
        const voice = (opt.voiceId && VOICES.some(v => v.id === opt.voiceId)) ? opt.voiceId : s.voice;
        const rate = effRate(s, opt), pitch = effPitch(s);
        const url = await getUrl(String(text), voice, rate, pitch);
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
           pinyinVoiceId: pinyinVoiceId, addPrewarmer: addPrewarmer,
           getSettings: getSettings, setSettings: setSettings,
           VOICES: VOICES, RATES: RATES, PITCHES: PITCHES, DEF: DEF };
})();
