# -*- coding: utf-8 -*-
"""
fill_missing_loop.py —— 缺失拼音标注自动补齐循环（后台无人值守）
每 5 分钟探测一轮：对仍缺失的标注请求合成（写入服务器缓存），
全部成功后自动调用 extract_pinyin_audio.py 提取打包，任务完成。
限流解除后一轮即可补完；日志写入 tools/fill_log.txt。
安全约束：仅访问字面量 http://127.0.0.1:7860/tts（本机服务，启动时断言）。
"""
import ipaddress
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

_ALLOWED = urllib.parse.urlsplit("http://127.0.0.1:7860/tts")


def _assert_allowed():
    p = urllib.parse.urlsplit("http://127.0.0.1:7860/tts")
    if (p.scheme, p.hostname, p.port) != (_ALLOWED.scheme, _ALLOWED.hostname, _ALLOWED.port):
        raise ValueError("blocked url")
    ip = ipaddress.ip_address(p.hostname)
    if not ip.is_loopback:
        raise ValueError("non-loopback blocked")


_assert_allowed()

ROOT = r"D:\ZCODE\汉字小星球"
LOG = os.path.join(ROOT, "tools", "fill_log.txt")
ROUNDS = 30
ROUND_WAIT = 300

anns = json.load(open(os.path.join(ROOT, "tools", "pinyin_annotations.json"), encoding="utf-8"))


def log(msg):
    line = time.strftime("[%H:%M:%S] ") + msg
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def synth(ann):
    body = json.dumps({"text": ann, "voice": "zh-CN-XiaoyiNeural",
                       "rate": -5, "pitch": 0, "prio": 0}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:7860/tts", data=body,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen("http://127.0.0.1:7860/tts", data=body, timeout=90) as r:
        r.read()


def missing_list():
    missing = []
    for ann in anns:
        k = ann + ".wav"
        if not os.path.exists(os.path.join(ROOT, "assets", "pinyin-audio", k)):
            missing.append(ann)
    return missing


log("自动补齐循环启动：共 %d 条标注待检查" % len(anns))
for rnd in range(1, ROUNDS + 1):
    missing = missing_list()
    if not missing:
        log("全部标注已打包，循环结束")
        break
    log("第 %d 轮：剩余 %d 条待补" % (rnd, len(missing)))
    ok = 0
    for ann in missing:
        try:
            synth(ann)
            ok += 1
        except Exception as e:
            log("  失败 %s: %s" % (ann, str(e)[:40]))
        time.sleep(1)
    if ok == len(missing):
        # 全部成功：提取打包
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "extract_pinyin_audio.py")],
                       cwd=ROOT)
        log("第 %d 轮全部成功并已提取打包，任务完成" % rnd)
        break
    if rnd < ROUNDS:
        log("第 %d 轮结束（成功 %d/%d），%d 秒后重试" % (rnd, ok, len(missing), ROUND_WAIT))
        time.sleep(ROUND_WAIT)
log("循环结束")
