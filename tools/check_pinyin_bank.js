#!/usr/bin/env node
/* ============================================================
   拼音语音覆盖校验 · tools/check_pinyin_bank.js
   ------------------------------------------------------------
   验证「语音库预合成的标注」是否覆盖「拼音页实际播放的标注」。

   为什么需要它：
     拼音朗读由 edge-tts 读「标准拼音标注」（b → bō、a → ā、zhi → zhī）。
     若某标注不在语音库里，点击时就要现场合成（1–4s 延迟）；服务不可用时
     更会降级到系统语音 —— 系统语音读不准带调标注（丢声调或按英文字母读）。
     历史上 js/tts.js 与 js/pinyin.js 各写了一份标调算法且表项不一致
     （tts.js 缺 'ü'/'ün'，声母判定漏掉 zh/ch/sh），导致 129 条（41%）
     播放标注不在库中、36 个拼音的四声全部退化成第一声。

   本脚本不是复刻算法，而是**在最小 mock 环境里加载真实 js/tts.js**，
   因此能捕获任何一处真实实现的变化。

   用法：node tools/check_pinyin_bank.js
   退出码：0 全部通过 / 1 有失败项
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fails = [];
const notes = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };

/* ---------- 1) 加载真实实现：js/tts.js ---------- */
function loadTTS() {
  global.window = {};
  global.location = { hostname: '127.0.0.1', pathname: '/pinyin.html' };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.indexedDB = { open: () => ({}) };
  global.fetch = () => Promise.reject(new Error('offline'));
  global.AbortController = class { constructor() { this.signal = {}; } abort() {} };
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(ROOT, 'js', 'tts.js'), 'utf8'));
  return global.window.HHTTS;
}

/* ---------- 2) 加载真实内容：js/data.js（顶层 const DATA = {...}） ---------- */
function loadData() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  // eslint-disable-next-line no-eval
  return eval(src + '\nDATA;');
}

const T = loadTTS();
const DATA = loadData();

if (!ok(T && typeof T.addTone === 'function' && typeof T.pinyinBankList === 'function',
        'js/tts.js 未导出 addTone / pinyinBankList（拼音标调统一实现缺失）')) {
  report(); process.exit(1);
}

/* ---------- 3) 取教材拼音全表（页面会遍历的全部拼音） ---------- */
const groups = DATA.pinyin;
const groupOf = [];
['shengmu', 'yunmu', 'zhengti'].forEach(g => {
  (groups[g] || []).forEach(x => groupOf.push({ group: g, p: x.p, read: x.read }));
});
ok(groupOf.length === 63, `拼音全表应为 63 项，实际 ${groupOf.length}`);
notes.push(`拼音全表 ${groupOf.length} 项（声母 ${groups.shengmu.length} / 韵母 ${groups.yunmu.length} / 整体认读 ${groups.zhengti.length}）`);

/* ---------- 4) 每个拼音都必须有标注映射（否则会读成英文字母） ---------- */
const unmapped = groupOf.filter(x => T.syllableOf(x.p) === x.p).map(x => x.p);
ok(unmapped.length === 0,
   `以下拼音没有标准标注映射，会被 TTS 读成英文字母：${unmapped.join(' ')}`);

/* ---------- 5) 语音库必须覆盖：音卡标注 + 四声变体 ---------- */
const bank = new Set(T.pinyinBankList());
const bankList = T.pinyinBankList();
const dup = bankList.filter((x, i) => bankList.indexOf(x) !== i);
ok(dup.length === 0, `语音库清单有重复项：${[...new Set(dup)].join(' ')}`);

let missing = [];
for (const { p } of groupOf) {
  if (!bank.has(T.syllableOf(p))) missing.push(`${p}→${T.syllableOf(p)}（音卡）`);
  for (let t = 1; t <= 4; t++) {
    const mark = T.addTone(T.toneBase(p), t);
    if (!bank.has(mark)) missing.push(`${p}→${mark}（第${t}声）`);
  }
}
ok(missing.length === 0,
   `语音库缺失 ${missing.length} 条播放标注：\n      ` + missing.slice(0, 20).join('\n      ') +
   (missing.length > 20 ? `\n      …（其余 ${missing.length - 20} 条）` : ''));
notes.push(`语音库条目 ${bankList.length} 条，播放标注 ${groupOf.length * 5} 条，缺失 ${missing.length} 条`);

/* ---------- 6) 四声不得退化（历史缺陷：四声全部等于第一声） ---------- */
const degenerate = [];
for (const { p } of groupOf) {
  const marks = [1, 2, 3, 4].map(t => T.addTone(T.toneBase(p), t));
  if (new Set(marks).size < 4) degenerate.push(`${p} → ${marks.join(' ')}`);
}
ok(degenerate.length === 0,
   `以下拼音的四声退化（不足 4 个不同标注）：\n      ` + degenerate.slice(0, 10).join('\n      '));
notes.push(`四声正常的拼音 ${groupOf.length - degenerate.length}/${groupOf.length}`);

/* ---------- 7) 关键标注抽查（历史缺陷点；这里列的是「标注」不是拼音本体） ---------- */
const MUST = ['bō', 'pō', 'zhī', 'ā', 'ē', 'ī', 'bā', 'bà', 'zhā', 'zhà', 'à',
              'ǖ', 'ǜ', 'ǖn', 'üē', 'yuē', 'yuān', 'yīng', 'zhì', 'wú', 'yè'];
const lost = MUST.filter(t => !bank.has(t));
ok(lost.length === 0, `语音库缺少关键标注：${lost.join(' ')}`);

/* ---------- 8) 静态检查：标调实现必须只有一份 ---------- */
const pySrc = fs.readFileSync(path.join(ROOT, 'js', 'pinyin.js'), 'utf8');
for (const sym of ['FINAL_VOWEL', 'TONE_CHAR', 'SUFFIXES']) {
  ok(!new RegExp('\\b' + sym + '\\b').test(pySrc),
     `js/pinyin.js 又出现了自有标调表 ${sym} —— 标调实现必须只用 js/tts.js 的 addTone，否则两份表会再次不一致`);
}
ok(/HHTTS\.addTone/.test(pySrc) || /addTone\(syl, tone\)/.test(pySrc),
   'js/pinyin.js 未调用 HHTTS.addTone');

/* ---------- 9) 静态检查：拼音朗读必须声明 pinyinVoice（安全音色 + 降级保护） ---------- */
const py1 = pySrc;
ok((py1.match(/pinyinVoice:\s*true/g) || []).length >= 3,
   'js/pinyin.js 的拼音朗读未充分声明 pinyinVoice（应覆盖音卡、四声、连读、预热）');
ok(!/voiceId:/.test(py1),
   'js/pinyin.js 仍在传 voiceId —— 会被 speak() 覆盖并绕过拼音安全音色判定，应改用 pinyinVoice');

/* ---------- 10) 静态检查：ditu.js 的拼音选项必须标记 ---------- */
const dituSrc = fs.readFileSync(path.join(ROOT, 'js', 'ditu.js'), 'utf8');
ok(/pinyin:\s*true/.test(dituSrc),
   'js/ditu.js 的 char2py 选项未标记 pinyin:true（拼音标注会被读成英文字母）');
ok(!/say:\s*'哪个字读'\s*\+\s*it\.py/.test(dituSrc),
   'js/ditu.js 的 py2char 题干仍内嵌拼音标注（应拆成 say + sayPy）');

/* ---------- 输出 ---------- */
function report() {
  notes.forEach(n => console.log('  · ' + n));
  if (fails.length) {
    console.log('\n  失败项 ' + fails.length + '：');
    fails.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
    console.log('\n结果：FAIL');
  } else {
    console.log('\n结果：PASS —— 语音库与页面播放标注完全一致');
  }
}
report();
process.exit(fails.length ? 1 : 0);
