/* ============================================================
   语音设置弹窗 · voice.js（需求二）
   小学生友好的大图标设置面板：音色卡片（带试听）/ 语速三档 / 音调三档。
   设置即点即存（hh_voice），全局朗读立即生效。
   入口：家长端「设置」卡中的「语音设置」按钮（HHVoice.open()）。
   ============================================================ */
window.HHVoice = (function () {
  'use strict';
  const { sfx } = HH;

  let box = null;      /* 弹窗 DOM（懒创建） */

  /* ---- 构建弹窗骨架（只创建一次） ---- */
  function build() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'voice-set hidden';
    box.innerHTML =
      '<div class="voice-mask"></div>' +
      '<div class="voice-card">' +
      '  <button class="voice-close pressable" data-act="close">✕</button>' +
      '  <p class="voice-title">语音伙伴</p>' +
      '  <p class="voice-sub">选一个你喜欢的小星球声音吧！</p>' +
      '  <div class="voice-list" id="vvVoices"></div>' +
      '  <p class="voice-sec">说话速度</p>  <div class="seg-row" id="vvRates"></div>' +
      '  <p class="voice-sec">声音高低</p>  <div class="seg-row" id="vvPitches"></div>' +
      '  <div class="voice-status" id="vvStatus">检查语音服务…</div>' +
      '</div>';
    document.body.appendChild(box);

    /* 遮罩 / 关闭按钮 */
    box.querySelector('.voice-mask').addEventListener('click', close);
    box.querySelector('[data-act="close"]').addEventListener('click', close);

    /* 音色卡片：大头像 + 名字 + 试听 */
    const list = box.querySelector('#vvVoices');
    HHTTS.VOICES.forEach(v => {
      const card = document.createElement('button');
      card.className = 'voice-opt pressable';
      card.dataset.voice = v.id;
      card.innerHTML =
        '<span class="vo-avatar">' + v.emoji + '</span>' +
        '<span class="vo-info"><b>' + v.name + '</b><i>' + v.desc + '</i></span>' +
        '<span class="vo-try"><span class="ico" data-ico="speaker"></span>试听</span>';
      /* 点卡片＝选它；点试听＝用这个音色播示例句 */
      card.addEventListener('click', e => {
        const isTry = e.target.closest('.vo-try');
        HHTTS.setSettings({ voice: v.id });
        paint();
        sfx.tap();
        if (isTry) HHTTS.speak('你好呀，我是你的学习伙伴！', { voiceId: v.id });
      });
      list.appendChild(card);
    });

    /* 语速 / 音调 三档按钮 */
    function buildSeg(boxId, items, key) {
      const seg = box.querySelector('#' + boxId);
      items.forEach(it => {
        const b = document.createElement('button');
        b.className = 'seg pressable';
        b.textContent = it.name;
        b.dataset.v = it.v;
        b.addEventListener('click', () => {
          HHTTS.setSettings({ [key]: it.v });
          paint();
          sfx.tap();
        });
        seg.appendChild(b);
      });
    }
    buildSeg('vvRates', HHTTS.RATES, 'rate');
    buildSeg('vvPitches', HHTTS.PITCHES, 'pitch');

    HH.injectIcons(box);
    return box;
  }

  /* ---- 按当前设置刷新选中态 ---- */
  function paint() {
    const s = HHTTS.getSettings();
    box.querySelectorAll('.voice-opt').forEach(c => {
      c.classList.toggle('on', c.dataset.voice === s.voice);
    });
    box.querySelectorAll('#vvRates .seg').forEach(b => {
      b.classList.toggle('on', +b.dataset.v === s.rate);
    });
    box.querySelectorAll('#vvPitches .seg').forEach(b => {
      b.classList.toggle('on', +b.dataset.v === s.pitch);
    });
  }

  /* ---- 服务状态：已连接 / 未连接（未连接时朗读自动用备用声音） ---- */
  async function paintStatus() {
    const el = box.querySelector('#vvStatus');
    el.textContent = '检查语音服务…';
    const ok = await HHTTS.ping();
    el.textContent = ok ? '✅ 语音服务已连接' : '⚠ 语音服务未连接，请在电脑上运行 tts_server.py（已改用备用声音）';
    el.classList.toggle('bad', !ok);
  }

  function open() {
    build();
    box.classList.remove('hidden');
    paint();
    paintStatus();
    /* 预热试听句（当前音色），点「试听」秒播 */
    if (window.HHTTS && window.HHTTS.prewarm) {
      window.HHTTS.prewarm(['你好呀，我是你的学习伙伴！']);
    }
  }
  function close() {
    if (box) box.classList.add('hidden');
    HHTTS.stop();
  }

  return { open: open, close: close };
})();
