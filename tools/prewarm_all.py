# -*- coding: utf-8 -*-
"""
prewarm_all.py —— 全语料离线预合成（构建期/维护期一次性工具）
把软件所有已知播报文本（拼音呼读音/四声/组字词/生字导语/课文全句/
词语组合/闯关播报/界面语音）按当前默认音色批量预合成进磁盘缓存，
之后孩子点击任何按钮都是缓存命中、毫秒级出声。
另含朗读慢速变体（rate=-15）与 5 个音色的试听句。

安全约束：唯一请求目标是字面量 http://127.0.0.1:7860/tts（本机
tts_server，IP 直连不经 DNS，无重定向面），启动前做协议/主机/回环
逐项断言。
"""
import ipaddress
import json
import threading
import time
import urllib.parse
import urllib.request

# ---- 目标守卫：断言唯一目标为本机环回 7860（协议/主机/端口逐项核对） ----
_ALLOWED = urllib.parse.urlsplit("http://127.0.0.1:7860/tts")


def _assert_allowed():
    p = urllib.parse.urlsplit("http://127.0.0.1:7860/tts")
    if (p.scheme, p.hostname, p.port) != (_ALLOWED.scheme, _ALLOWED.hostname, _ALLOWED.port):
        raise ValueError("blocked url")
    ip = ipaddress.ip_address(p.hostname)
    if not ip.is_loopback:
        raise ValueError("non-loopback blocked")


_assert_allowed()

VOICE = "zh-CN-XiaoyiNeural"      # 用户当前所选音色
RATE = -5                          # 默认语速档
CONC = 1                           # 上游限流期降为单并发温和续跑（缓存命中秒过，断点可续）

corpus = json.load(open(r"D:\ZCODE\汉字小星球\tools\prewarm_corpus.json", encoding="utf-8"))
texts = corpus["texts"]

jobs = [(t, VOICE, RATE, 0) for t in texts]
# 朗读慢速变体（rate=-15）：句子较长的部分
slow_jobs = [(t, VOICE, -15, 0) for t in texts if len(t) >= 6]
# 5 个音色的试听句
trial = "你好呀，我是你的学习伙伴！"
for v in ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunyangNeural",
          "zh-CN-YunxiNeural", "zh-CN-YunxiaNeural"]:
    jobs.append((trial, v, RATE, 0))

jobs.extend(slow_jobs)

lock = threading.Lock()
idx = {"i": 0}
ok = {"n": 0}
fail = []


def worker():
    while True:
        with lock:
            if idx["i"] >= len(jobs):
                return
            text, voice, rate, pitch = jobs[idx["i"]]
            idx["i"] += 1
        body = json.dumps({"text": text, "voice": voice, "rate": rate,
                           "pitch": pitch, "prio": 0}).encode("utf-8")
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    "http://127.0.0.1:7860/tts", data=body,
                    headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(
                        "http://127.0.0.1:7860/tts", data=body, timeout=90) as r:
                    r.read()
                with lock:
                    ok["n"] += 1
                break
            except Exception as e:
                if attempt == 2:
                    with lock:
                        fail.append((text[:16], str(e)[:40]))
                time.sleep(2)


threads = [threading.Thread(target=worker, daemon=True) for _ in range(CONC)]
for t in threads:
    t.start()
start = time.time()
while any(t.is_alive() for t in threads):
    time.sleep(10)
    print(f"progress {idx['i']}/{len(jobs)} ok={ok['n']} elapsed={int(time.time()-start)}s", flush=True)
for t in threads:
    t.join()
print(f"DONE total={len(jobs)} ok={ok['n']} fail={len(fail)} in {int(time.time()-start)}s", flush=True)
for f in fail[:10]:
    print("FAILED:", f)
