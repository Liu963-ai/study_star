/* ============================================================
   语音设置弹窗 · voice.js（统一发音人版）
   发音人/语速/音调已全局固定为小艺姐姐（tts.js GLOBAL 全局配置），
   本面板仅提供：统一发音人信息 / 试听 / 服务状态。
   入口：家长端「设置」卡中的「语音设置」按钮（HHVoice.open()）。
   ============================================================ */
window.HHVoice = (function () {
  'use strict';
  const { sfx } = HH;

  let box = null;      /* 弹窗 DOM（懒创建） */

  function build() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'voice-set hidden';
    box.innerHTML =
      '<div class="voice-mask"></div>' +
      '<div class="voice-card">' +
      '  <button class="voice-close pressable" data-act="close">✕</button>' +
      '  <p class="voice-title">语音伙伴</p>' +
      '  <p class="voice-sub">全软件使用同一个温柔的声音，宝贝听起来更稳定！</p>' +
      '  <div class="voice-list" id="vvVoices"></div>' +
      '  <div class="voice-status" id="vvStatus">检查语音服务…</div>' +
      '</div>';
    document.body.appendChild(box);

    box.querySelector('.voice-mask').addEventListener('click', close);
    box.querySelector('[data-act="close"]').addEventListener('click', close);

    /* 统一发音人卡片（唯一，试听走 AudioManager 统一参数） */
    const list = box.querySelector('#vvVoices');
    const card = document.createElement('button');
    card.className = 'voice-opt pressable on';
    card.innerHTML =
      '<span class="vo-avatar">👧</span>' +
      '<span class="vo-info"><b>小艺姐姐</b><i>统一发音人 · 活泼女声</i></span>' +
      '<span class="vo-try"><span class="ico" data-ico="speaker"></span>试听</span>';
    card.addEventListener('click', () => {
      sfx.tap();
      HH.speak('你好呀，我是你的学习伙伴！');
    });
    list.appendChild(card);

    HH.injectIcons(box);
    return box;
  }

  /* ---- 服务状态：已连接 / 未连接（未连接时朗读自动用备用声音） ---- */
  async function paintStatus() {
    const el = box.querySelector('#vvStatus');
    el.textContent = '检查语音服务…';
    const ok = await AudioManager.ping();
    el.textContent = ok ? '✅ 语音服务已连接' : '⚠ 语音服务未连接，请在电脑上运行 tts_server.py（已改用备用声音）';
    el.classList.toggle('bad', !ok);
  }

  function open() {
    build();
    box.classList.remove('hidden');
    paintStatus();
    /* 预热试听句，点「试听」秒播 */
    if (window.AudioManager && AudioManager.prewarm) {
      AudioManager.prewarm(['你好呀，我是你的学习伙伴！']);
    }
  }
  function close() {
    if (box) box.classList.add('hidden');
    HH.stopSpeak();
  }

  return { open: open, close: close };
})();
