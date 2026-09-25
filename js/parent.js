/* ============================================================
   家长端逻辑 · parent.js（任务书 §6.10–§6.12）
   门禁弹层（算术题校验）→ 三屏报告（趋势呈现）→ 设置（含一键删除）。
   ============================================================ */
(function () {
  'use strict';
  const { store, speak, stopSpeak, sfx } = HH;
  const $ = id => document.getElementById(id);

  /* ================= 门禁（§6.10） ================= */
  const gate = $('gate');
  const input = $('gateInput');
  const answer = String(DATA.parent.gate.answer);

  $('gateQuiz').textContent = DATA.parent.gate.a + ' + ' + DATA.parent.gate.b + ' = ?';

  function openReport() {
    gate.remove();
    reveal();
  }
  /* 启动：先显示门禁弹层；报告内容验证通过后才可见 */
  $('report').style.visibility = 'hidden';
  $('gatePad').addEventListener('click', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (k === 'clear') { input.value = ''; return; }
    if (k === 'del') { input.value = input.value.slice(0, -1); return; }
    input.value += k;
    /* 输入位数够了即校验（答案最多两位） */
    if (input.value.length >= answer.length) {
      if (input.value === answer) {
        openReport();
      } else {
        /* 答错：轻微左右摆动 + 播报「再试一次」，不清空、不变红 */
        sfx.hmm();
        input.classList.remove('shake'); void input.offsetWidth;
        input.classList.add('shake');
        speak('再试一次');
        if (input.value.length > answer.length) input.value = input.value.slice(0, answer.length);
      }
    }
  });
  /* 取消：回首页（需求方确认：不露出报告内容） */
  $('gateCancel').addEventListener('click', () => { location.href = 'home.html'; });

  /* ================= 三屏报告（§6.11） ================= */
  let screen = 0;
  const TITLES = ['今天的记录', '学得怎么样', '我可以做什么'];

  function showScreen(i) {
    screen = Math.max(0, Math.min(2, i));
    document.querySelectorAll('.rs').forEach(el => {
      el.classList.toggle('on', +el.dataset.rs === screen);
    });
    document.querySelectorAll('.rdot').forEach(d => {
      d.classList.toggle('on', +d.dataset.s === screen);
    });
    $('repTitle').textContent = TITLES[screen];
    if (screen === 2) renderRecList();              /* 第 3 屏显示录音管理 */
  }
  $('btnPrev').addEventListener('click', () => showScreen(screen - 1));
  $('btnNext').addEventListener('click', () => showScreen(screen + 1));
  $('repDots').addEventListener('click', e => {
    if (e.target.dataset.s != null) showScreen(+e.target.dataset.s);
  });

  /* ---- 第 1 屏数据：全部来自孩子端真实 localStorage（js/report.js 汇总） ---- */
  const d = Report.get();
  $('kvMin').textContent = d.zero ? '还没开始' : (d.minutes + ' 分钟');
  $('kvChars').textContent = d.newChars + ' 个';
  $('kvStations').textContent = d.stations + ' 站';
  /* 今天读了什么：有当日朗读记录才显示课文名，否则如实说 */
  $('readTitle').textContent = d.readToday ? '《' + d.readToday + '》' : '今天还没有朗读记录';
  /* 「听孩子读的」：优先播放真实录音（IndexedDB 最新一条），没有则如实提示 */
  $('btnPlayRead').addEventListener('click', async () => {
    let arr = [];
    try { arr = await AudioDB.all(); } catch (e) {}
    if (arr.length) {
      const a = new Audio(URL.createObjectURL(arr[0].blob));
      a.play();
      return;
    }
    speak(d.readToday ? '这是孩子今天读的' : '今天还没朗读，去朗读剧场试试吧');
  });
  /* 多天未学：如实注明上次探险日期（不用假数据填充） */
  if (d.lastActive && d.lastActive !== Report.todayKey()) {
    const note = document.createElement('div');
    note.className = 'p-note';
    note.textContent = '上次探险是 ' + d.lastActive + '，今天回来继续就好。';
    document.querySelector('#kvMin').parentElement.appendChild(note);
  } else if (d.zero) {
    const note = document.createElement('div');
    note.className = 'p-note';
    note.textContent = '今天还没开始探险，陪孩子一起试试吧。';
    document.querySelector('#kvMin').parentElement.appendChild(note);
  }

  /* ---- 第 2 屏：四条横向进度条 + 薄弱项（真实进度，只呈现趋势） ---- */
  d.bars.forEach(b => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const name = document.createElement('span'); name.className = 'bar-name'; name.textContent = b.name;
    const track = document.createElement('span'); track.className = 'bar-track';
    const fill = document.createElement('span'); fill.className = 'bar-fill';
    fill.style.width = b.v + '%'; fill.style.background = b.color;
    track.appendChild(fill);
    const val = document.createElement('span'); val.className = 'bar-val'; val.textContent = b.v + '%';
    row.append(name, track, val);
    $('bars').appendChild(row);
  });
  const weakUl = $('weakList');
  if (d.zero) {
    const li = document.createElement('li');
    li.textContent = '先陪孩子玩一轮，这里就会出现练习情况。';
    weakUl.appendChild(li);
  } else if (d.weak.length) {
    d.weak.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      weakUl.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = '四个模块都完成通关啦！';
    weakUl.appendChild(li);
  }

  /* ---- 第 3 屏：学习建议（基于真实薄弱项与今日表现生成） ---- */
  Report.advice(d).forEach(a => {
    const li = document.createElement('li');
    li.textContent = a;
    $('adviceList').appendChild(li);
  });
  /* 每日学习时长上限：自由设置
     · 预设档 0（不限制）/10/15/20/30/45/60/90/120/180 分钟
     · 「自定义…」可输入任意 1–600 分钟
     · 写入 hh_dailyLimit，学习页由 report.js 按分钟拦截；0＝当天不限制 */
  const selLimit = $('selLimit');
  const limitCustom = $('limitCustom');
  const limitCustomInput = $('limitCustomInput');
  const LIMIT_PRESETS = [0, 10, 15, 20, 30, 45, 60, 90, 120, 180];

  function limitSay(v) {
    speak(v === 0 ? '好的，今天不限制时长' : '已设置为每天' + v + '分钟');
  }
  (function initLimit() {
    const v = store.get('dailyLimit', 20);
    if (LIMIT_PRESETS.indexOf(v) >= 0) {
      selLimit.value = String(v);
    } else {
      selLimit.value = 'custom';
      limitCustom.classList.remove('hidden');
      limitCustomInput.value = v;
    }
  })();
  selLimit.addEventListener('change', () => {
    if (selLimit.value === 'custom') {
      limitCustom.classList.remove('hidden');
      limitCustomInput.focus();
      return;
    }
    limitCustom.classList.add('hidden');
    const v = parseInt(selLimit.value, 10) || 0;
    store.set('dailyLimit', v);          /* 0 = 不限制，原样保存 */
    limitSay(v);
  });
  function saveCustomLimit() {
    const v = Math.round(parseFloat(limitCustomInput.value));
    if (!v || v < 1 || v > 600) {
      HH.toast('请输入 1–600 之间的分钟数');
      return;
    }
    store.set('dailyLimit', v);
    selLimit.value = LIMIT_PRESETS.indexOf(v) >= 0 ? String(v) : 'custom';
    limitSay(v);
  }
  $('btnLimitOk').addEventListener('click', saveCustomLimit);
  limitCustomInput.addEventListener('change', saveCustomLimit);
  /* 语音引导开关：与学生端静音状态共用 hh_muted */
  const swVoice = $('swVoice'), swRec = $('swRec');
  swVoice.classList.toggle('on', !store.get('muted', false));
  swVoice.addEventListener('click', () => {
    const on = !swVoice.classList.contains('on');
    swVoice.classList.toggle('on', on);
    store.set('muted', !on);
    if (on) speak('声音打开啦');
  });
  swRec.addEventListener('click', () => {
    const turnOn = !swRec.classList.contains('on');
    if (turnOn && !HHRec.consented()) {
      /* 首次开启：监护人知情同意弹层（录什么/存哪里/存多久/如何删除） */
      openRecConsent(() => { swRec.classList.add('on'); renderRecList(); });
      swRec.classList.remove('on');
      return;
    }
    HHRec.setKeep(turnOn);
    swRec.classList.toggle('on', turnOn);
    renderRecList();
  });
  /* 监护人知情同意弹层（§2.3 第二层） */
  function openRecConsent(onAgree) {
    const ov = document.createElement('div');
    ov.className = 'gate';
    ov.innerHTML =
      '<div class="gate-card">' +
      '  <h2 class="gate-title">监护人知情同意</h2>' +
      '  <div class="consent-text">' +
      '    <p>· 录什么：只录孩子在朗读剧场发出的朗读声音</p>' +
      '    <p>· 存哪里：仅保存在本机浏览器中，绝不上传</p>' +
      '    <p>· 存多久：保留 30 天，到期自动删除</p>' +
      '    <p>· 如何删除：随时在本页「录音管理」逐条删除或一键清空</p>' +
      '  </div>' +
      '  <div class="gate-pad2">' +
      '    <button class="p-btn" data-ok="1">同意并开启</button>' +
      '    <button class="p-btn" data-ok="0">先不开</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-ok]');
      if (!b) return;
      const agree = b.dataset.ok === '1';
      if (agree) { HHRec.setConsent(true); HHRec.setKeep(true); onAgree(); }
      ov.remove();
    });
  }
  /* 一键删除本机数据：confirm 二次确认 → 清空所有 hh_ 前缀键 + 录音库 → 回启动页
     （录音存在 IndexedDB，不在 localStorage 里；以前只清 localStorage，
       「删除全部数据」之后录音其实还在，与给家长的承诺不一致。） */
  $('btnWipe').addEventListener('click', async () => {
    const recN = (window.AudioDB && AudioDB.count) ? await AudioDB.count() : 0;
    const tip = '确定删除本机全部练习数据吗？此操作不可恢复。' +
                (recN ? '\n\n将同时删除 ' + recN + ' 条孩子录音。' : '');
    if (!confirm(tip)) return;
    Object.keys(localStorage).filter(k => k.indexOf('hh_') === 0).forEach(k => localStorage.removeItem(k));
    if (window.AudioDB && AudioDB.wipe) await AudioDB.wipe();
    location.href = 'index.html';
  });
  /* 语音设置：打开大图标设置弹窗（js/voice.js） */
  $('btnVoiceSet').addEventListener('click', () => { HHVoice.open(); });

  /* ================= 录音管理（真实录音列表 / 回放 / 删除） ================= */
  async function renderRecList() {
    const list = $('recList');
    if (!list) return;
    await AudioDB.purgeExpired();                 /* 30 天自动清理 */
    const arr = await AudioDB.all();
    const usage = await AudioDB.usage();
    $('recUsage').textContent = usage > 0 ? (usage / 1024).toFixed(1) + ' KB' : '0 KB';
    list.innerHTML = '';
    if (!arr.length) {
      const p = document.createElement('p');
      p.className = 'p-note';
      p.textContent = '还没有录音。孩子在朗读剧场点话筒录的音会出现在这里。';
      list.appendChild(p);
      return;
    }
    arr.forEach(r => {
      const row = document.createElement('div');
      row.className = 'rec-row';
      const title = document.createElement('span');
      title.className = 'rec-title';
      title.textContent = r.title + '（剩 ' + AudioDB.daysLeft(r.ts) + ' 天）';
      const play = document.createElement('button');
      play.className = 'p-btn p-btn-sm';
      play.textContent = '▶';
      play.setAttribute('aria-label', '播放录音');
      play.addEventListener('click', () => {
        const a = new Audio(URL.createObjectURL(r.blob));
        a.play();
      });
      const del = document.createElement('button');
      del.className = 'p-btn p-btn-sm';
      del.textContent = '删除';
      del.setAttribute('aria-label', '删除这条录音');
      del.addEventListener('click', async () => {
        await AudioDB.del(r.id);
        renderRecList();
      });
      row.append(title, play, del);
      list.appendChild(row);
    });
  }
  /* 一键清空录音：先告知条数并要求确认（录音是本机唯一副本，删了不可恢复） */
  $('btnRecClear').addEventListener('click', async () => {
    const n = await AudioDB.count();
    if (!n) { renderRecList(); return; }
    if (!confirm('将删除全部 ' + n + ' 条孩子录音，删除后无法恢复。确定吗？')) return;
    await AudioDB.clear();
    renderRecList();
  });

  /* ---- 返回：回首页并停语音（与公共返回按钮一致） ---- */
  document.querySelector('.back-btn').addEventListener('click', () => {
    stopSpeak(); location.href = 'home.html';
  });
  document.querySelector('.back-btn').addEventListener('pointerdown', () => sfx.tap());

  /* ---- 启动：先显示门禁弹层；报告内容验证通过后才可见 ---- */
  $('report').style.visibility = 'hidden';
  function reveal() { $('report').style.visibility = 'visible'; showScreen(0); }
  AudioDB.purgeExpired();                           /* 录音 30 天自动过期 */
})();
