# -*- coding: utf-8 -*-
"""
test_tone_pinyin.py —— 验证 edge-tts 能否把「带调拼音」读成正确的中文音节
方法：合成 参照汉字（妈/马/麻/骂）与 带调拼音（mā/má/mǎ/mà），
对每段音频提取基频(F0)轮廓，比较两者的音高走势是否一致。
一致 => TTS 支持带调拼音，可直接用于四声教学。

安全约束（SSRF 防护）：请求地址为字面量 http://127.0.0.1:7860/tts
（本机 tts_server，IP 直连不经 DNS、无重定向面）。
"""
import io, json, urllib.request
import numpy as np
import soundfile as sf

VOICE = "zh-CN-XiaoyiNeural"


def synth(text):
    body = json.dumps({"text": text, "voice": VOICE, "rate": -10, "pitch": 0}).encode()
    with urllib.request.urlopen("http://127.0.0.1:7860/tts", data=body, timeout=30) as r:
        return r.read()


def f0_contour(mp3, n=24):
    x, sr = sf.read(io.BytesIO(mp3))
    if x.ndim > 1:
        x = x.mean(axis=1)
    x = x.astype(np.float64)
    frame = int(sr * 0.025)
    hop = int(sr * 0.010)
    f0s = []
    lo, hi = 70, 500
    for start in range(0, len(x) - frame, hop):
        seg = x[start:start + frame]
        if np.sqrt((seg ** 2).mean()) < 0.01:      # 静音帧跳过
            continue
        seg = seg - seg.mean()
        corr = np.correlate(seg, seg, mode='full')[frame - 1:]
        corr /= (corr[0] + 1e-9)
        lag_lo, lag_hi = int(sr / hi), int(sr / lo)
        if lag_hi >= len(corr):
            continue
        lag = lag_lo + np.argmax(corr[lag_lo:lag_hi])
        if corr[lag] < 0.5:                        # 无明显周期性（清音）
            continue
        f0s.append(sr / lag)
    if not f0s:
        return None
    f0s = np.array(f0s)
    idx = np.linspace(0, len(f0s) - 1, n)
    prof = np.interp(idx, np.arange(len(f0s)), f0s)
    return prof / np.median(prof)


pairs = [("妈", "mā"), ("麻", "má"), ("马", "mǎ"), ("骂", "mà")]
results = {}
for hanzi, pinyin in pairs:
    h = f0_contour(synth(hanzi))
    p = f0_contour(synth(pinyin))
    if h is None or p is None:
        results[pinyin] = "F0 extract failed"
        continue
    diff = float(np.abs(h - p).mean())
    results[pinyin] = {"hanzi_profile": [round(v, 3) for v in h[::4]],
                       "pinyin_profile": [round(v, 3) for v in p[::4]],
                       "mean_abs_diff": round(diff, 4),
                       "similar": diff < 0.10}
print(json.dumps(results, ensure_ascii=False, indent=1))
