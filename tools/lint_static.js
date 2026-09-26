/* 汉字小星球 · 静态一致性检查（纯文件系统，无依赖、无浏览器）
   项目没有构建流程，HTML 手写引用 js/css，最容易出的问题是「改了名忘了改引用」
   与「加了个页面忘了进 sw.js 预缓存」。这类错误本地打开往往看不出（走网络能拿到
   文件），只在离线或被 Service Worker 接管后才暴露。故用一只轻量检查兜住。

   检查项：
     1) HTML 里 src/href 指向的本地文件必须存在（漏引用即失败）
     2) sw.js 的 CORE 清单每一项必须在磁盘上存在（写错路径即失败）
     3) CORE 覆盖全部页面 HTML（加页面忘进预缓存即失败）
     4) 页面引用的 js/css 是否已在 CORE（未进清单只提示，白名单内为刻意排除）
     5) sw.js 的缓存版本号格式统一为 hh-vN，且全局只出现一处定义
     6) 每个 HTML 内 id 不得重复
     7) HTML 不得出现内联事件句柄（项目统一用 addEventListener）
     8) js/ 下不得残留 eval / new Function / document.write / console.log
     9) script 开闭标签数量必须配平
    10) js/*.js 是否成为孤儿文件（无人引用且不在 CORE）

   用法：node tools/lint_static.js        退出码 0=通过 1=有失败项
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
const abs = p => path.join(ROOT, p);
const read = p => fs.readFileSync(abs(p), 'utf8');
const exists = p => fs.existsSync(abs(p));

const fails = [];
const notes = [];
const bad = m => fails.push(m);

/* ---------- 收集文件 ---------- */
const HTMLS = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const JSS = fs.readdirSync(abs('js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f).sort();
const CSSS = fs.readdirSync(abs('css')).filter(f => f.endsWith('.css')).map(f => 'css/' + f).sort();

/* 刻意不进预缓存的资源（低频、体积大，首次使用时由运行期 cache-first 自动收编） */
const NOT_CACHED_BY_DESIGN = new Set([
  'assets/lib/pdf.min.js',
  'assets/lib/pinyin-pro.min.js'
]);

/* ---------- 1) HTML 本地引用必须存在 ---------- */
const referenced = new Set();          /* 被页面引用的同源资源 */
const SKIP_SCHEME = /^(https?:|data:|blob:|mailto:|tel:|#|javascript:|\/\/)/i;

for (const h of HTMLS) {
  const html = read(h);
  const re = /(?:src|href)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw || SKIP_SCHEME.test(raw)) continue;
    const target = raw.split('#')[0].split('?')[0];
    if (!target) continue;
    if (!exists(target)) bad(`${h} 引用了不存在的文件：${raw}`);
    if (/\.(js|css)$/.test(target)) referenced.add(target);
  }
}

/* ---------- 2/3/4) sw.js 预缓存清单一致性 ---------- */
const sw = read('sw.js');
const coreBlock = sw.match(/const\s+CORE\s*=\s*\[([\s\S]*?)\];/);
if (!coreBlock) {
  bad('sw.js 中找不到 CORE 数组（结构变了？本检查需同步更新）');
} else {
  const core = [...coreBlock[1].matchAll(/'([^']+)'/g)].map(x => x[1]);

  for (const c of core) {
    if (!exists(c)) bad(`sw.js 预缓存清单里的文件不存在：${c}`);
  }

  /* 所有页面 HTML 都必须在预缓存里，否则离线时该页打不开 */
  for (const h of HTMLS) {
    if (!core.includes(h)) bad(`页面 ${h} 未进 sw.js 预缓存清单（离线将无法打开）`);
  }

  /* 反查：清单里有、磁盘没用的（陈旧条目） */
  for (const h of core.filter(x => x.endsWith('.html'))) {
    if (!HTMLS.includes(h)) bad(`sw.js 预缓存清单包含已不存在的页面：${h}`);
  }

  /* 页面引用的 js/css 是否已在清单 */
  const missing = [...referenced].filter(r => !core.includes(r) && !NOT_CACHED_BY_DESIGN.has(r)).sort();
  for (const x of missing) bad(`页面引用了 ${x}，但它不在 sw.js 预缓存清单里（离线将 404）`);

  const byDesign = [...referenced].filter(r => NOT_CACHED_BY_DESIGN.has(r)).sort();
  if (byDesign.length) notes.push('按设计不进预缓存：' + byDesign.join('、'));

  /* 清单里有哪些 js/css 从未被任何页面直接引用（多为动态加载，仅提示） */
  const unusedCore = core.filter(c => /\.(js|css)$/.test(c) && !referenced.has(c)).sort();
  if (unusedCore.length) notes.push('预缓存但页面未直接引用（可能为动态加载）：' + unusedCore.join('、'));
}

/* ---------- 5) 缓存版本号 ---------- */
const verDecl = [...sw.matchAll(/const\s+VER\s*=\s*'([^']+)'/g)];
if (verDecl.length !== 1) {
  bad(`sw.js 中 const VER 应恰好定义一次，实际 ${verDecl.length} 次`);
} else {
  const v = verDecl[0][1];
  if (!/^hh-v\d+$/.test(v)) bad(`sw.js 缓存版本号格式不合规（应形如 hh-v21）：${v}`);
  else notes.push('缓存版本号：' + v);
}

/* ---------- 6/7/9) 逐页 DOM 与标签检查 ---------- */
const INLINE_EVENT = /\son(click|change|input|submit|load|error|focus|blur|keydown|keyup|mouseover)\s*=/i;

for (const h of HTMLS) {
  const html = read(h);

  /* id 重复 */
  const ids = [...html.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  for (const d of dup) bad(`${h} 存在重复 id：${d}`);

  /* 内联事件句柄 */
  const ev = html.match(INLINE_EVENT);
  if (ev) bad(`${h} 出现内联事件句柄 ${ev[0].trim()}（项目统一用 addEventListener）`);

  /* script 开闭配平 */
  const opens = (html.match(/<script\b/gi) || []).length;
  const closes = (html.match(/<\/script\s*>/gi) || []).length;
  if (opens !== closes) bad(`${h} 的 <script> 标签未配平：开 ${opens} / 闭 ${closes}`);

  /* 引用自身相对路径的 js/css 是否都在 （已在 1 覆盖） */
}

/* ---------- 8) js/ 禁止项 ---------- */
const FORBIDDEN = [
  { re: /\beval\s*\(/, what: 'eval(' },
  { re: /new\s+Function\s*\(/, what: 'new Function(' },
  { re: /document\.write\s*\(/, what: 'document.write(' },
  { re: /\bconsole\.log\s*\(/, what: 'console.log(' }
];
for (const j of JSS) {
  const src = read(j);
  for (const f of FORBIDDEN) {
    if (f.re.test(src)) bad(`${j} 残留禁止项 ${f.what}`);
  }
}

/* ---------- 10) 孤儿 js ---------- */
{
  const orphan = JSS.filter(j => !referenced.has(j) && !sw.includes("'" + j + "'"));
  if (orphan.length) notes.push('可能已成孤儿（无页面引用、也不在预缓存）：' + orphan.join('、'));
}

/* ---------- 输出 ---------- */
console.log('静态一致性检查：' + HTMLS.length + ' 页 / ' + JSS.length + ' 个 js / ' + CSSS.length + ' 个 css');
notes.forEach(n => console.log('  · ' + n));
if (fails.length) {
  console.log('\n  失败项 ' + fails.length + '：');
  fails.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  console.log('\n结果：FAIL');
  process.exit(1);
}
console.log('\n结果：PASS —— 引用、预缓存、版本号与禁止项全部一致');
