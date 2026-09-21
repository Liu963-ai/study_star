/* ============================================================
   我的教材逻辑 · jiaocai.js
   流程：PDF/粘贴文本 →（可选）AI 整理 → pinyin-pro 权威标音 + 校验
        → 家长预览（可改拼音）→ 确认入库（hh_books）。
   AI 不可用时走「手动整理」降级路径；教材包启用后学生端四站换数据源。
   ============================================================ */
(function () {
  'use strict';
  const { store, speak, icon } = HH;
  const $ = id => document.getElementById(id);

  /* 本地能力服务地址（P0 修复）：/llm 由 7860 端口的 tts_server.py 提供，
     8767 是纯静态服务、没有任何 API 路由——此前用相对路径 fetch('/llm')
     会 501，导致 AI 整理 100% 失效。端口只在这一处定义。
     地址跟随页面访问主机（本机 127.0.0.1 / 手机经局域网 IP 访问均可用）。 */
  const LLM_BASE = 'http://' + (location.hostname || '127.0.0.1') + ':7860';

  /* ================= AI 设置 ================= */
  $('llmKey').value = store.get('llmKey', '');
  $('llmModel').value = store.get('llmModel', 'glm-4-flash');
  $('llmKey').addEventListener('change', () => store.set('llmKey', $('llmKey').value.trim()));
  $('llmModel').addEventListener('change', () => store.set('llmModel', $('llmModel').value));

  $('btnLlmTest').addEventListener('click', async () => {
    const key = $('llmKey').value.trim();
    if (!key) { $('llmStatus').textContent = '请先粘贴 Key'; return; }
    store.set('llmKey', key);
    $('llmStatus').textContent = '测试中…';
    try {
      const res = await fetch(LLM_BASE + '/llm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, model: $('llmModel').value,
          messages: [{ role: 'user', content: '只回复：ok' }] })
      });
      const data = await res.json();
      let msg = data.msg || '';
      if (/401/.test(msg)) msg = 'Key 无效或未生效，请到 open.bigmodel.cn 核对后重试';
      $('llmStatus').textContent = data.ok ? ('✅ 连接成功：' + (data.content || '').slice(0, 20))
                                           : ('❌ ' + (msg || '失败'));
    } catch (e) {
      $('llmStatus').textContent = '❌ 本地服务未启动（python tts_server.py）';
    }
  });

  /* ================= PDF 提取（pdf.js，本地解析） ================= */
  $('pdfFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('pdfStatus').textContent = '提取中…';
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/lib/pdf.worker.min.js';
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const t = content.items.map(it => it.str).join('');
        if (t.trim()) text += t + '\n';
      }
      if (!text.trim()) {
        $('pdfStatus').textContent = '⚠ 这是扫描图片版 PDF（无文字层），请改用文字版，或手动粘贴课文';
        return;
      }
      $('jcText').value = text.trim().slice(0, 2000);
      $('pdfStatus').textContent = '✅ 提取成功（' + doc.numPages + ' 页，' + text.length + ' 字），可在下方删减';
    } catch (err) {
      $('pdfStatus').textContent = '解析失败：' + err.message;
    }
  });

  /* ================= 拼音权威标注（pinyin-pro） ================= */
  function annotate(text) {
    /* 整段标注以获得多音字上下文，返回 {汉字: 拼音}（取首次出现的读音） */
    const arr = window.pinyinPro.pinyin(text, { type: 'array', toneType: 'symbol' });
    const chars = [...text];
    const map = {};
    chars.forEach((ch, i) => {
      if (/[\u4e00-\u9fa5]/.test(ch) && !map[ch]) map[ch] = arr[i] || ch;
    });
    return map;
  }

  /* ================= AI 整理 ================= */
  let pending = null;      /* 待确认的教材包 */
  $('btnAI').addEventListener('click', async () => {
    const text = $('jcText').value.trim();
    const key = store.get('llmKey', '');
    if (text.length < 10) { $('genStatus').textContent = '课文太短，先粘贴或提取教材内容'; return; }
    if (!key) { $('genStatus').textContent = '请先在上方填写智谱 API Key'; return; }
    $('genStatus').textContent = 'AI 整理中（约 10-30 秒）…';
    try {
      const res = await fetch(LLM_BASE + '/llm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key, model: $('llmModel').value,
          messages: [
            { role: 'system', content: '你是小学一年级语文教研助手。只输出一个 JSON 对象，禁止 markdown 代码块与解释。结构：{"name":"不超过6字的单元名","chars":[{"char":"课文中的一个汉字","words":["常用词1","常用词2"]}],"words":[{"word":"课文中的词语","type":"who|where|what"}]}。要求：chars 挑 6-10 个适合一年级认读的生字（按出现顺序），每个配 1-2 个常用词；words 从课文挑 4-8 个词语，type 按语义标 who(谁)/where(在哪里)/what(做什么)，三类都必须出现。' },
            { role: 'user', content: text }
          ]
        })
      });
      const data = await res.json();
      if (!data.ok) { $('genStatus').textContent = 'AI 调用失败：' + (data.msg || ''); return; }
      const parsed = JSON.parse(data.content);       /* response_format=json_object 保证是 JSON */
      buildPreview(text, parsed);
      $('genStatus').textContent = '✅ AI 整理完成，请核对下方预览';
    } catch (err) {
      $('genStatus').textContent = '整理失败（' + err.message + '）。可改用「手动整理」。';
    }
  });

  /* ================= 手动整理（降级路径） ================= */
  $('btnManual').addEventListener('click', () => {
    $('manualBox').classList.toggle('hidden');
  });
  $('manualBox').addEventListener('input', () => {
    const text = $('jcText').value.trim();
    if (text.length < 10) return;
    const who = $('mWho').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const where = $('mWhere').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const what = $('mWhat').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    if (who.length && where.length && what.length) {
      buildPreview(text, {
        name: text.slice(0, 6),
        chars: [...new Set([...text].filter(c => /[\u4e00-\u9fa5]/.test(c)))].slice(0, 10).map(c => ({ char: c })),
        words: [].concat(
          who.map(w => ({ word: w, type: 'who' })),
          where.map(w => ({ word: w, type: 'where' })),
          what.map(w => ({ word: w, type: 'what' }))
        )
      });
      $('genStatus').textContent = '已按手动内容生成预览';
    }
  });

  /* ================= 预览与入库 ================= */
  function buildPreview(text, ai) {
    const pyMap = annotate(text);
    /* 生字：取 AI 挑的字（或手动的字），拼音一律用本地拼音库覆盖 */
    const seen = new Set();
    const chars = [];
    (ai.chars || []).forEach(c => {
      const ch = (c.char || '').trim();
      if (!ch || seen.has(ch) || !pyMap[ch]) return;   /* 必须是课文里的汉字 */
      seen.add(ch);
      chars.push({ char: ch, pinyin: pyMap[ch], words: (c.words || []).slice(0, 2) });
    });
    if (!chars.length) { $('genStatus').textContent = '没有可用的生字，请检查课文'; return; }

    /* 课文分句 + 逐字标拼音（确定性，与朗读站格式一致） */
    const lines = [];
    text.replace(/\s+/g, '').split(/[。！？；，、]/).forEach(seg => {
      if (!seg || seg.length < 2 || lines.length >= 12) return;
      lines.push([...seg].map(ch => ({ ch: ch, py: pyMap[ch] || ch })));
    });

    pending = {
      id: 'bk' + Date.now(),
      name: (ai.name || text.slice(0, 6)).slice(0, 8),
      createdAt: new Date().toLocaleDateString(),
      text: text.slice(0, 2000),
      chars: chars.slice(0, 12),
      words: (ai.words || []).filter(w => w.word && ['who', 'where', 'what'].includes(w.type)).slice(0, 10),
      lines: lines
    };

    /* 预览渲染：拼音可点击就地修改（多音字兜底） */
    $('bookName').value = pending.name;
    const pv = $('charPreview');
    pv.innerHTML = '';
    pending.chars.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'cp-item';
      d.innerHTML = '<div class="zi"></div><div class="py"></div><div class="ws"></div>';
      d.querySelector('.zi').textContent = c.char;
      d.querySelector('.py').textContent = c.pinyin;
      d.querySelector('.py').title = '点击修改拼音';
      d.querySelector('.py').addEventListener('click', function () {
        const v = prompt('修改「' + c.char + '」的拼音（含声调，如 mā）：', c.pinyin);
        if (v && v.trim()) {
          c.pinyin = v.trim();
          this.textContent = c.pinyin;
        }
      });
      d.querySelector('.ws').textContent = c.words.join('、');
      pv.appendChild(d);
    });
    $('statLine').textContent =
      '共 ' + pending.chars.length + ' 个生字 · ' + pending.words.length + ' 个词语 · ' + pending.lines.length + ' 个分句';
    $('previewCard').classList.remove('hidden');
  }

  $('btnSave').addEventListener('click', () => {
    if (!pending) return;
    pending.name = $('bookName').value.trim() || pending.name;
    HHBooks.save(pending);
    pending = null;
    $('previewCard').classList.add('hidden');
    $('genStatus').textContent = '✅ 已存入并启用，孩子端四个学习站已切换到这本教材';
    renderBooks();
    speak('教材导入成功！');
  });

  /* ================= 已存教材包管理 ================= */
  function renderBooks() {
    const box = $('bookList');
    const activeId = localStorage.getItem('hh_activeBook');
    box.innerHTML = '';
    const arr = HHBooks.list();
    if (!arr.length) {
      box.innerHTML = '<p class="jc-hint">还没有教材，先用上面的方式导入一份吧。</p>';
      return;
    }
    arr.forEach(b => {
      const row = document.createElement('div');
      row.className = 'book-item';
      row.innerHTML =
        '<span class="b-name"><span class="ico" data-ico="tree"></span> ' + b.name +
        (b.id === activeId ? '<span class="on-tag">使用中</span>' : '') +
        '<span class="cnt">' + b.chars.length + ' 字</span></span>';
      const use = document.createElement('button');
      use.className = 'p-btn';
      use.textContent = b.id === activeId ? '停用' : '启用';
      use.addEventListener('click', () => {
        HHBooks.setActive(b.id === activeId ? null : b.id);
        renderBooks();
      });
      const del = document.createElement('button');
      del.className = 'p-btn danger';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        if (confirm('删除教材「' + b.name + '」？')) { HHBooks.remove(b.id); renderBooks(); }
      });
      row.append(use, del);
      box.appendChild(row);
    });
    HH.injectIcons(box);
  }
  renderBooks();

  /* 返回 → 家长中心 */
  document.querySelector('.back-btn').addEventListener('click', () => { location.href = 'parent.html'; });
})();
