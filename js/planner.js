/* ============================================================
   教材包存取与出题规划器 · planner.js
   ------------------------------------------------------------
   教材包结构（存 localStorage: hh_books 数组，hh_activeBook 为启用包 id）：
     { id, name, createdAt, active:true?,
       chars: [ { char:"妈", pinyin:"mā", words:["妈妈","姨妈"] } ],
       words: [ { word:"小猫", type:"who" } ],        type ∈ who|where|what
       lines:  [ [ {ch:"弯",py:"wān"}, ... ], ... ]   课文按标点分句、逐字标拼音
     }
   出题规划（本文件内实现，规则型）：
     1) 没学过的字优先（hh_charDone 记录已学）
     2) 学过的字按间隔复习（尾部轮转）
     3) 每次取 limit 个（默认 6，一年级认知负荷）
   ============================================================ */
window.HHBooks = (function () {
  'use strict';

  function list() { return JSON.parse(localStorage.getItem('hh_books') || '[]'); }
  function saveAll(arr) { localStorage.setItem('hh_books', JSON.stringify(arr)); }

  function active() {
    const id = localStorage.getItem('hh_activeBook');
    if (!id) return null;
    return list().find(b => b.id === id) || null;
  }
  function setActive(id) {
    if (id) localStorage.setItem('hh_activeBook', id);
    else localStorage.removeItem('hh_activeBook');
  }
  function save(pkg) {
    const arr = list();
    const i = arr.findIndex(b => b.id === pkg.id);
    if (i >= 0) arr[i] = pkg; else arr.unshift(pkg);
    saveAll(arr);
    setActive(pkg.id);
    return pkg;
  }
  function remove(id) {
    saveAll(list().filter(b => b.id !== id));
    if (localStorage.getItem('hh_activeBook') === id) setActive(null);
  }

  /* ---- 字级已学记录（生字站写完一个字记一次） ---- */
  function charDone() { return JSON.parse(localStorage.getItem('hh_charDone') || '{}'); }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function markCharDone(ch) {
    const m = charDone();
    m[ch] = (m[ch] || 0) + 1;
    localStorage.setItem('hh_charDone', JSON.stringify(m));
    /* 今日新学字记录（家长报告用；同一字当天只记一次） */
    const log = JSON.parse(localStorage.getItem('hh_charLog') || 'null');
    const today = todayKey();
    const cur = log && log.date === today ? log : { date: today, list: [] };
    if (cur.list.indexOf(ch) < 0) cur.list.push(ch);
    localStorage.setItem('hh_charLog', JSON.stringify(cur));
  }

  /* ---- 出题规划：未学优先，已学轮转复习 ---- */
  function pickChars(limit) {
    const book = active();
    if (!book) return [];
    const done = charDone();
    const unseen = book.chars.filter(c => !done[c.char]);
    const seen = book.chars.filter(c => done[c.char]);
    const pick = unseen.slice(0, limit);
    if (pick.length < limit) {
      /* 未学不足则用已学字轮转补位（复习） */
      const need = limit - pick.length;
      const start = (parseInt(localStorage.getItem('hh_review') || '0', 10)) % Math.max(1, seen.length);
      for (let i = 0; i < need && seen.length; i++) {
        pick.push(seen[(start + i) % seen.length]);
      }
      localStorage.setItem('hh_review', start + 1);
    }
    return pick;
  }

  return { list: list, active: active, setActive: setActive, save: save, remove: remove,
           markCharDone: markCharDone, pickChars: pickChars };
})();
