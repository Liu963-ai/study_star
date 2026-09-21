/* ============================================================
   录音存储 · audio-db.js（IndexedDB 封装，任务书 §2.3）
   ------------------------------------------------------------
   音频体积大，一律存 IndexedDB（hh_audio 库），绝不进 localStorage、
   绝不上传服务器。保留 30 天自动过期；提供逐条删除与一键清空。
   记录结构：{ id, ts, title, blob }
   ============================================================ */
window.AudioDB = (function () {
  'use strict';
  const DB = 'hh_audio', STORE = 'records';
  const KEEP_DAYS = 30;                 /* 自动过期天数 */
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return dbp;
  }
  function req(rq) {
    return new Promise((res, rej) => {
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }

  async function put(rec) {
    const db = await open();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    return req(st.put(rec));
  }
  async function all() {
    const db = await open();
    const st = db.transaction(STORE, 'readonly').objectStore(STORE);
    const arr = await req(st.getAll());
    return (arr || []).sort((a, b) => b.ts - a.ts);     /* 新的在前 */
  }
  async function del(id) {
    const db = await open();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    return req(st.delete(id));
  }
  async function clear() {
    const db = await open();
    const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
    return req(st.clear());
  }
  /* 当前占用（字节） */
  async function usage() {
    const arr = await all();
    return arr.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0);
  }
  /* 30 天自动过期：初始化时清理，返回清理条数 */
  async function purgeExpired() {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    const arr = await all();
    let n = 0;
    for (const r of arr) {
      if (r.ts < cutoff) { await del(r.id); n++; }
    }
    return n;
  }
  /* 某条剩余保留天数 */
  function daysLeft(ts) {
    return Math.max(0, KEEP_DAYS - Math.floor((Date.now() - ts) / 86400000));
  }

  return { put: put, all: all, del: del, clear: clear, usage: usage,
           purgeExpired: purgeExpired, daysLeft: daysLeft, KEEP_DAYS: KEEP_DAYS };
})();
