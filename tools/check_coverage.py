# -*- coding: utf-8 -*-
"""
check_coverage.py —— 核查每个页面的全部语音字符串是否已缓存（毫秒级出声）
原理：服务器缓存文件名 = sha256(text|voice|rate|pitch).wav，直接比对磁盘，
不发任何请求。用法：python tools/check_coverage.py [voice] [rate]
输出每页覆盖率与缺失样例；未命中项由后台批次陆续补齐，客户端未命中时
4.5s 内回落备用声音，保证任何按键都有反馈。
"""
import hashlib, json, os, sys

ROOT = r"D:\ZCODE\汉字小星球"
CACHE = os.path.join(ROOT, "tts_cache")
VOICE = sys.argv[1] if len(sys.argv) > 1 else "zh-CN-XiaoyiNeural"
RATE = int(sys.argv[2]) if len(sys.argv) > 2 else -5

page_strings = json.load(open(os.path.join(ROOT, "tools", "page_strings.json"), encoding="utf-8"))

def wav_exists(text, rate=RATE):
    k = hashlib.sha256(f"{text}|{VOICE}|{rate}|0".encode("utf-8")).hexdigest()
    return os.path.exists(os.path.join(CACHE, k + ".wav"))

total_ok = total_all = 0
for page in sorted(page_strings):
    strings = sorted(set(page_strings[page]))
    hit = [s for s in strings if wav_exists(s)]
    miss = [s for s in strings if not wav_exists(s)]
    total_ok += len(hit); total_all += len(strings)
    pct = 100 * len(hit) // len(strings) if strings else 100
    flag = "✅" if pct == 100 else ("🟡" if pct >= 70 else "🔴")
    print(f"{flag} {page}: {len(hit)}/{len(strings)} ({pct}%) 即时")
    for m in miss[:6]:
        print(f"     缺: {m[:36]}")
    if len(miss) > 6:
        print(f"     …等共 {len(miss)} 条未缓存")
print(f"\n合计: {total_ok}/{total_all} ({100*total_ok//max(1,total_all)}%) 已缓存=点击毫秒级出声")
