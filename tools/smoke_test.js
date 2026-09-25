/* 汉字小星球 · 页面冒烟测试（只读运行，不修改项目文件）
   用系统 Edge + puppeteer-core 逐页加载，收集：
   1) JS 运行时错误 / 未捕获 Promise
   2) 每页实际传输字节（验证首屏瘦身）
   3) DOM 里的 [object Object] / NaN / undefined 脏文本
   4) 关键行为断言（星星记账锁、周星星、闯关选项、纪念品视频懒加载）
   用法：node smoke.js http://127.0.0.1:8788/
*/
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://127.0.0.1:8788/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGES = ['index.html', 'home.html', 'pinyin.html', 'shengzi.html', 'langdu.html',
  'jushi.html', 'ditu.html', 'jiangli.html', 'jiesuan.html', 'parent.html', 'jiaocai.html'];

/* 本机 7860 语音服务未启动时的失败属预期，不计入问题 */
const EXPECTED = /7860|tts|favicon|ERR_CONNECTION_REFUSED|Failed to fetch|net::ERR/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    const errors = [];
    let bytes = 0;
    const big = [];
    page.on('pageerror', e => errors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('response', async r => {
      try {
        const len = Number(r.headers()['content-length'] || 0);
        bytes += len;
        if (len > 300 * 1024) big.push(r.url().split('/').pop() + '=' + Math.round(len / 1024) + 'KB');
      } catch (e) {}
    });
    try {
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 25000 });
      await sleep(3000);
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
  await page.goto(BASE + 'home.html', { waitUntil: 'load' });
  await sleep(600);
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

    return out;
  });

  /* ---------- 闯关「听音选声母」选项渲染（第 2 关固定为该题型） ---------- */
  const page2 = await browser.newPage();
  await page2.goto(BASE + 'ditu.html', { waitUntil: 'load' });
  await page2.evaluate(() => localStorage.setItem('hh_mapLevel', '2'));
  await page2.reload({ waitUntil: 'load' });
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

  await page.close();
  await page2.close();
  await browser.close();

  console.log(JSON.stringify({ pages: results, behavior, quest }, null, 1));
})().catch(e => { console.error('SMOKE FAILED:', e); process.exit(1); });
