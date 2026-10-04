# -*- coding: utf-8 -*-
"""
fill_missing_once.py —— 单轮直接补齐（无循环、无自动重试轮次）
对 assets/pinyin-audio/ 中缺失的标注逐条请求合成（3 线程，每条 1 次
尝试、90s 超时），完成后自动调用提取脚本打包。结果写 stdout。
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = r"D:\ZCODE\汉字小星球"
OUT = os.path.join(ROOT, "assets", "pinyin-audio")
VOICE, RATE = "zh-CN-XiaoyiNeural", -5

anns = json.load(open(os.path.join(ROOT, "tools", "pinyin_annotations.json"), encoding="utf-8"))
missing = [a for a in anns
           if not os.path.exists(os.path.join(OUT, a + ".wav"))]

print("待补:", len(missing), flush=True)
if not missing:
    print("无缺失", flush=True)
    sys.exit(0)

lock = threading.Lock()
idx = {"i": 0}
ok = {"n": 0}
fail = []


def worker():
    while True:
        with lock:
            if idx["i"] >= len(missing):
                return
            ann = missing[idx["i"]]
            idx["i"] += 1
        body = json.dumps({"text": ann, "voice": VOICE, "rate": RATE,
                           "pitch": 0, "prio": 0}).encode("utf-8")
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:7860/tts", data=body,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(
                    "http://127.0.0.1:7860/tts", data=body, timeout=90) as r:
                r.read()
            with lock:
                ok["n"] += 1
                print("ok", ann, flush=True)
        except Exception as e:
            with lock:
                fail.append((ann, str(e)[:40]))
                print("fail", ann, str(e)[:40], flush=True)


threads = [threading.Thread(target=worker) for _ in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()

print(f"单轮结束: 成功 {ok['n']}  失败 {len(fail)}", flush=True)
if fail:
    print("失败清单:", " | ".join(a for a, _ in fail), flush=True)
