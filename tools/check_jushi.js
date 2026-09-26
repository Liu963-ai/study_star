#!/usr/bin/env node
/* ============================================================
   词语乐园数据校验 · tools/check_jushi.js
   ------------------------------------------------------------
   造句板块的每一轮是「who 2 × where 2 × what 2 ＝ 8 种组合」，
   页面允许小朋友任意挑词拼句。因此只要有一轮配词不当，就会有若干
   组合读出来是错的（v21 修掉的「熊猫在云上打滚」「小狗在树上」
   即属此类）。语义是否通顺无法自动判定，但**结构**与**资源**可以：

     1) 恰好 20 轮，每轮 who/where/what 各 2 个候选
     2) 每项必须是 [词, emoji] 二元组，词非空
     3) 同一轮的同一槽位不得出现重复词（否则 8 种组合里有两组一模一样）
     4) where 词必须以「在」或「从」开头（页面按「谁+在哪+做什么」拼句）
     5) 每个词都必须有词卡 assets/jushi-words/<词>.jpg（缺卡会退化成 emoji，
        画面上只剩一个表情符号，对认字的低年级学生等于没有内容）
     6) 报告未被任何轮使用的词卡（提示项，不算失败）

   语义层面的约束写不进断言，只能在改数据时人工遵守，规则见
   项目说明书.md §16 与 js/data.js 中 jushi 上方的注释。

   用法：node tools/check_jushi.js     退出码 0 通过 / 1 有失败项
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CARD_DIR = path.join(ROOT, 'assets', 'jushi-words');
const SLOTS = ['who', 'where', 'what'];

const fails = [];
const notes = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };

/* 加载真实内容：js/data.js（顶层 const DATA = {...}） */
function loadData() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  // eslint-disable-next-line no-eval
  return eval(src + '\nDATA;');
}

const DATA = loadData();
const rounds = DATA && DATA.jushi;

if (!ok(Array.isArray(rounds) && rounds.length > 0, 'js/data.js 里找不到 jushi 数组')) {
  console.log(rounds && rounds.length ? '' : '');
  console.log(fails.join('\n'));
  process.exit(1);
}

ok(rounds.length === 20, `词语乐园应为 20 轮，实际 ${rounds.length} 轮`);

const cards = new Set(
  fs.readdirSync(CARD_DIR).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).map(f => path.basename(f, path.extname(f)))
);
const used = { who: new Set(), where: new Set(), what: new Set() };

rounds.forEach((r, ri) => {
  const tag = `第 ${ri + 1} 轮`;
  SLOTS.forEach(slot => {
    const arr = r[slot];
    if (!ok(Array.isArray(arr) && arr.length === 2,
            `${tag} 的 ${slot} 应有 2 个候选，实际 ${Array.isArray(arr) ? arr.length : '非数组'}`)) return;

    const words = [];
    arr.forEach((item, i) => {
      if (!ok(Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && item[0].trim() !== '',
              `${tag} 的 ${slot}[${i}] 不是 [词, emoji] 二元组：${JSON.stringify(item)}`)) return;
      const w = item[0].trim();
      words.push(w);
      used[slot].add(w);

      if (!cards.has(w)) fails.push(`${tag} 的词「${w}」没有词卡（assets/jushi-words/${w}.jpg 缺失）`);
      if (/\s/.test(item[0])) fails.push(`${tag} 的词「${w}」含空白字符，会出现断句异常`);
    });

    if (new Set(words).size !== words.length) {
      fails.push(`${tag} 的 ${slot} 出现重复词：${words.join('/')}`);
    }
  });

  /* where 词表形态：必须能接在主语后面（「小鸟 / 在云上 / 飞翔」） */
  (r.where || []).forEach(item => {
    if (Array.isArray(item) && typeof item[0] === 'string' && !/^[在从]/.test(item[0])) {
      fails.push(`${tag} 的地点词「${item[0]}」不以「在」或「从」开头，拼出的句子不通顺`);
    }
  });
});

notes.push(`词语乐园 ${rounds.length} 轮，每轮 8 种组合，合计 ${rounds.length * 8} 句`);
notes.push(`使用中的词：${SLOTS.map(s => s + ' ' + used[s].size).join(' / ')}，词卡目录共 ${cards.size} 张`);

const unused = [...cards].filter(w => !SLOTS.some(s => used[s].has(w))).sort();
if (unused.length) notes.push('未被任何轮使用（词卡仍在磁盘，不算失败）：' + unused.join('、'));

/* ---------- 输出 ---------- */
notes.forEach(n => console.log('  · ' + n));
if (fails.length) {
  console.log('\n  失败项 ' + fails.length + '：');
  fails.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  console.log('\n结果：FAIL');
  process.exit(1);
}
console.log('\n结果：PASS —— 轮次结构、重复词与词卡资源全部一致');
