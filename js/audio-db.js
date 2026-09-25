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
    /* 打开失败（隐私模式/配额/多标签版本变更）时清掉缓存：
       否则这个 Promise 会带着 rejected 状态被永久复用，本次会话后续
       所有读写全部失败且无法自愈。 */
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  function req(rq) {
    return new Promise((res, rej) => {
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }

  /* 写入失败（配额满等）不抛给上层：录音存不下不该连带把「读完一篇的星星」吃掉 */
  async function put(rec) {
    try {
      const db = await open();
      const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
      return await req(st.put(rec));
    } catch (e) {
      return null;
    }
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
  /* 条数（不读 blob，家长页显示「将删除 N 条」用） */
  async function count() {
    try {
      const db = await open();
      const st = db.transaction(STORE, 'readonly').objectStore(STORE);
      return await req(st.count());
    } catch (e) { return 0; }
  }
  /* 当前占用（字节） */
  async function usage() {
    try {
      const arr = await all();
      return arr.reduce((s, r) => s + (r.blob ? r.blob.size : 0), 0);
    } catch (e) { return 0; }
  }
  /* 30 天自动过期：初始化时清理，返回清理条数。
     只用游标逐个取「键 + 时间戳」，避免把几十 MB 的录音 blob 全量读进内存。 */
  async function purgeExpired() {
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    let n = 0;
    try {
      const db = await open();
      const st = db.transaction(STORE, 'readwrite').objectStore(STORE);
      n = await new Promise((res, rej) => {
        let c = 0;
        const rq = st.openCursor();
        rq.onsuccess = () => {
          const cur = rq.result;
          if (!cur) { res(c); return; }
          if ((cur.value && cur.value.ts) < cutoff) { cur.delete(); c++; }
          cur.continue();
        };
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) { /* 清理失败不影响主流程 */ }
    return n;
  }
  /* 彻底删除整库（家长「删除本机全部数据」时调用，与 localStorage 清理口径一致） */
  async function wipe() {
    try {
      if ('indexedDB' in window && indexedDB.deleteDatabase) {
        await new Promise(res => {
          const rq = indexedDB.deleteDatabase(DB);
          rq.onsuccess = rq.onerror = rq.onblocked = () => res();
        });
      }
    } catch (e) {}
    dbp = null;
  }
  /* 某条剩余保留天数 */
  function daysLeft(ts) {
    return Math.max(0, KEEP_DAYS - Math.floor((Date.now() - ts) / 86400000));
  }

  return { put: put, all: all, del: del, clear: clear, count: count, wipe: wipe,
           usage: usage, purgeExpired: purgeExpired, daysLeft: daysLeft, KEEP_DAYS: KEEP_DAYS };
})();
