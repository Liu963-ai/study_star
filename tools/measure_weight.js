/* 首屏体积实测：只统计「同源静态资源」字节数（排除 7860 语音服务的音频流量），
   用于对比优化前后的真实页面重量。
   用法：node measure.js <base-url> <标签> */
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2];
const TAG = process.argv[3] || BASE;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PAGES = ['index.html', 'home.html', 'pinyin.html', 'shengzi.html', 'langdu.html',
  'jushi.html', 'ditu.html', 'jiangli.html', 'jiesuan.html', 'parent.html', 'jiaocai.html'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio']
  });
  const rows = [];
  for (const p of PAGES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    const seen = new Map();
    page.on('response', r => {
      try {
        const u = new URL(r.url());
        if (u.origin !== new URL(BASE).origin) return;      /* 排除语音服务 */
        const len = Number(r.headers()['content-length'] || 0);
        const key = u.pathname;
        if (!seen.has(key) || seen.get(key) < len) seen.set(key, len);
      } catch (e) {}
    });
    try {
      await page.goto(BASE + p, { waitUntil: 'load', timeout: 25000 });
      await sleep(3500);
    } catch (e) {}
    const total = [...seen.values()].reduce((a, b) => a + b, 0);
    rows.push({ page: p, KB: Math.round(total / 1024), req: seen.size });
    await page.close();
  }
  await browser.close();
  console.log('== ' + TAG + ' ==');
  rows.forEach(r => console.log(r.page.padEnd(14) + String(r.KB).padStart(7) + ' KB   ' + r.req + ' 请求'));
  console.log('合计 ' + Math.round(rows.reduce((a, b) => a + b.KB, 0) / 1024 * 10) / 10 + ' MB');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
