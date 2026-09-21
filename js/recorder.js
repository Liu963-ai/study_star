/* ============================================================
   录音采集 · recorder.js（任务书 §2.3）
   ------------------------------------------------------------
   职责：麦克风授权 + MediaRecorder 录制 + 「保留录音」开关状态。
   原则：默认不持久化；仅声音、不录视频；不支持时返回 recording:false
   （调用方降级为假波纹，不中断学习流程）。
   ============================================================ */
window.HHRec = (function () {
  'use strict';

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  /* 「保留录音」开关（默认关） */
  function keepOn() {
    try { return !!JSON.parse(localStorage.getItem('hh_keepRec')); } catch (e) { return false; }
  }
  function setKeep(v) { localStorage.setItem('hh_keepRec', JSON.stringify(!!v)); }
  /* 监护人知情同意（首次开启保留录音前必须为 true） */
  function consented() {
    try { return !!JSON.parse(localStorage.getItem('hh_recConsent')); } catch (e) { return false; }
  }
  function setConsent(v) { localStorage.setItem('hh_recConsent', JSON.stringify(!!v)); }

  /* 开始采集：返回 { stream, recording, stop():Promise<Blob|null> }
     stop() 返回录到的音频 Blob；未开启保留录音时仅用于可视化，stop 返回 null。 */
  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let recorder = null;
    const chunks = [];
    const shouldRecord = keepOn();          /* 开关关闭 → 只可视化，不落盘 */
    if (shouldRecord && window.MediaRecorder) {
      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.start();
      } catch (e) { recorder = null; }
    }
    return {
      stream: stream,
      recording: !!recorder,
      stop: function () {
        return new Promise(res => {
          const finish = blob => {
            stream.getTracks().forEach(t => t.stop());
            res(blob && blob.size > 0 ? blob : null);
          };
          if (!recorder) { finish(null); return; }
          recorder.onstop = () => finish(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
          try { recorder.stop(); } catch (e) { finish(null); }
        });
      }
    };
  }

  return { supported: supported, start: start,
           keepOn: keepOn, setKeep: setKeep, consented: consented, setConsent: setConsent };
})();
