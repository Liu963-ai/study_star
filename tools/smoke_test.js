/* 汉字小星球 · 页面冒烟测试（只读运行，不修改项目文件）
   用系统 Edge + puppeteer-core 逐页加载，收集：
   1) JS 运行时错误 / 未捕获 Promise
   2) 每页实际传输字节（粗测，精确值见 measure_weight.js）
   3) DOM 里的 [object Object] / NaN / undefined 脏文本
   4) 关键行为断言（星星记账锁、周星星、记录不跳页、闯关选项、视频按需加载、
      拼音语音库覆盖与四声不退化、降级通道读汉字/静音）
   用法：node smoke_test.js http://127.0.0.1:8788/

   v18 调整：等待条件由 waitUntil:'load' 改为 'domcontentloaded' + 更短超时。
   原版在本机 7860 语音服务同时运行时会被拖住——页面会真的发起 edge-tts 合成
   请求，'load' 迟迟不触发，11 页串行曾跑 10 分钟不返回。JS 逻辑在
   DOMContentLoaded 之前就已执行完，故该等待方式对"验证运行时错误"已足够。

   v19 新增：拼音语音库覆盖断言与降级通道行为断言（hook speechSynthesis.speak
   记录被朗读的文本）。凡拼音朗读都必须证明其读的是汉字或干脆不出声。
*/
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://127.0.0.1:8788/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGES = ['index.html', 'home.html', 'pinyin.html', 'shengzi.html', 'langdu.html',
  'jushi.html', 'ditu.html', 'jiangli.html', 'jiesuan.html', 'parent.html', 'jiaocai.html'];

const NAV = { waitUntil: 'domcontentloaded', timeout: 12000 };
const SETTLE = 1500;          /* DOMContentLoaded 后留出的异步渲染时间 */

/* 本机 7860 语音服务未启动时的失败属预期，不计入问题 */
const EXPECTED = /7860|tts|favicon|ERR_CONNECTION_REFUSED|Failed to fetch|net::ERR/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 屏蔽本机语音服务（7860）。
   测试不需要真实音频；而页面开着 7860 时会批量预加载语音（拼音页约 273 条语音库），
   大量 pending 请求会把 headless 浏览器拖垮——原版 11 页跑 10 分钟不返回，根因即此。
   屏蔽后 JS 走既有的降级分支（speechSynthesis / 静默），不影响运行时错误检测。 */
async function harden(page) {
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().includes(':7860')) { r.abort(); } else { r.continue(); }
  });
}

/* 全局兜底：无论卡在哪一步都保证退出并给出可诊断信息（unref 使其不阻止正常退出） */
const HARD_MS = 150000;
const hard = setTimeout(() => {
  console.error('SMOKE HARD TIMEOUT after ' + HARD_MS + 'ms');
  process.exit(2);
}, HARD_MS);
if (hard.unref) hard.unref();

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', '--disable-features=Translate']
  });
  const results = [];

  for (const p of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await harden(page);
    const errors = [];
    let bytes = 0;
    const big = [];
    page.on('pageerror', e => errors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('response', r => {
      try {
        const len = Number(r.headers()['content-length'] || 0);
        bytes += len;
        if (len > 300 * 1024) big.push(r.url().split('/').pop() + '=' + Math.round(len / 1024) + 'KB');
      } catch (e) {}
    });
    try {
      await page.goto(BASE + p, NAV);
      await sleep(SETTLE);
    } catch (e) { errors.push('NAV: ' + e.message); }

    let dom = {};
    try {
      dom = await page.evaluate(() => {
        const txt = document.body ? document.body.innerText : '';
        return {
          dirty: (txt.match(/\[object Object\]|undefined|NaN/g) || []).length,
          videos: [...document.querySelectorAll('video')].map(v => ({
            src: v.getAttribute('src') || v.dataset.src || '(无)',
            preload: v.getAttribute('preload'),
            display: v.style.display
          })),
          dots: document.querySelectorAll('.module-dots .pd').length,
          imgs: document.querySelectorAll('img').length
        };
      });
    } catch (e) { dom = { evalFail: e.message }; }

    results.push({
      page: p,
      KB: Math.round(bytes / 1024),
      bigFiles: big,
      errors: errors.filter(e => !EXPECTED.test(e)),
      dirty: dom.dirty,
      videos: dom.videos,
      dots: dom.dots,
      imgs: dom.imgs
    });
    await page.close();
  }

  /* ---------- 行为断言（在 home.html 的干净上下文里跑） ---------- */
  const page = await browser.newPage();
  await harden(page);
  await page.goto(BASE + 'home.html', NAV);
  await sleep(800);
  const behavior = await page.evaluate(async () => {
    const out = {};
    Object.keys(localStorage).filter(k => k.startsWith('hh_')).forEach(k => localStorage.removeItem(k));

    /* 1) gotoSettle 重入锁：连调两次只能记一次星星 */
    const before = location.href;
    HH.gotoSettle({ stars: 3, module: 'langdu', task: 'langdu' });
    HH.gotoSettle({ stars: 3, module: 'langdu', task: 'langdu' });
    out.starsAfterDoubleSettle = JSON.parse(localStorage.getItem('hh_stars'));

    /* 2) HH.record 不跳页、不上锁 */
    out.urlUnchangedAfterRecord = (location.href === before);

    /* 3) 本周星星：跨周归零 + 旧格式（裸数字）兼容 */
    localStorage.setItem('hh_weekStars', '36');
    out.legacyWeekStars = HH.getWeekStars();               /* 期望 0（旧数据按非本周处理） */
    HH.addStars(5);
    out.weekStarsAfterAdd = HH.getWeekStars();             /* 期望 5 */

    /* 4) 进度上限常量与首页进度点数一致 */
    out.progressMax = HH.PROGRESS_MAX;

    /* 5) record 可累加进度、封顶在 PROGRESS_MAX */
    for (let i = 0; i < 9; i++) HH.record({ module: 'pinyin', stars: 0 });
    out.pinyinProgressCapped = HH.getProgress('pinyin');

    /* 6) 拼音音节转换仍走标准标注（不受本次改动影响） */
    out.syllable_b = HHTTS.syllableOf('b');
    out.syllable_zh = HHTTS.syllableOf('zh');

    /* 7) 语音库：条目数与关键标注（回归 v19 修复的四声退化缺陷） */
    const bank = HHTTS.pinyinBankList();
    out.bank = {
      size: bank.length,
      noDup: new Set(bank).size === bank.length,
      hasZha1: bank.includes('zhā'),
      hasA4: bank.includes('à'),
      hasZhi4: bank.includes('zhì'),
      hasU1: bank.includes('ǖ'),
      hasUn1: bank.includes('ǖn'),
      hasYue1: bank.includes('yuē')
    };
    /* 四声必须互不相同（历史上 36 个拼音的四声全部等于第一声） */
    const spread = p => new Set([1, 2, 3, 4].map(t => HHTTS.addTone(HHTTS.toneBase(p), t))).size;
    out.toneVariety = { a: spread('a'), zhi: spread('zhi'), zh: spread('zh'), u: spread('ü') };

    /* 8) 降级通道保护：拼音标注绝不能交给系统语音读成拉丁串 */
    const spoken = [];
    const synth = window.speechSynthesis;
    if (synth) synth.speak = u => spoken.push(u.text);
    localStorage.setItem('hh_ttsFailAt', String(Date.now()));   /* 模拟语音服务不可用 */
    HHTTS.speak('bō', { pinyinVoice: true, fallbackText: '玻' });   /* 音卡：应降级读汉字 */
    HHTTS.speak('à', { pinyinVoice: true });                        /* 四声：无替代，应静音 */
    await new Promise(r => setTimeout(r, 300));
    out.fallbackSpoken = spoken.slice();
    localStorage.removeItem('hh_ttsFailAt');

    return out;
  });

  /* ---------- 闯关「听音选声母」选项渲染（第 2 关固定为该题型） ---------- */
  const page2 = await browser.newPage();
  await harden(page2);
  await page2.goto(BASE + 'ditu.html', NAV);
  await page2.evaluate(() => localStorage.setItem('hh_mapLevel', '2'));
  await page2.reload(NAV);
  await sleep(1200);
  const quest = await page2.evaluate(async () => {
    const nodes = [...document.querySelectorAll('.node')];
    nodes[1].click();                                     /* 第 2 关 */
    await new Promise(r => setTimeout(r, 500));
    const opts = [...document.querySelectorAll('.quest-opt')].map(b => b.textContent);
    return {
      labels: opts,
      hasObject: opts.some(t => /\[object/.test(t)),
      unique: new Set(opts).size === opts.length,
      lockedAria: nodes[5] && nodes[5].getAttribute('aria-label')
    };
  });

  /* ---------- 拼音页降级行为：音卡读汉字、四声静音（绝不读拉丁串） ---------- */
  const page3 = await browser.newPage();
  await harden(page3);
  await page3.goto(BASE + 'pinyin.html', NAV);
  await sleep(1200);
  const pyFallback = await page3.evaluate(async () => {
    const spoken = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = u => spoken.push(u.text);
    const off = () => localStorage.setItem('hh_ttsFailAt', String(Date.now()));

    /* 音卡：有呼读音汉字，降级应读「玻」 */
    off();
    const replay = document.getElementById('btnReplay');
    if (replay) replay.click();
    await new Promise(r => setTimeout(r, 400));
    const cardSpoken = spoken.slice();

    /* 四声：无同音汉字，降级应静音而不是读「à」 */
    spoken.length = 0;
    off();
    const toneBtns = [...document.querySelectorAll('.tone-btn')];
    if (toneBtns[3]) toneBtns[3].click();
    await new Promise(r => setTimeout(r, 400));
    const toneSpoken = spoken.slice();

    localStorage.removeItem('hh_ttsFailAt');
    return {
      cardSpoken, toneSpoken,
      toneBtnCount: toneBtns.length,
      cardText: (document.getElementById('bigLetter') || {}).textContent || null
    };
  });

  await page.close();
  await page2.close();
  await page3.close();
  await browser.close();
  clearTimeout(hard);

  console.log(JSON.stringify({ pages: results, behavior, quest, pyFallback }, null, 1));
})().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
