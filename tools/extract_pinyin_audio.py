# -*- coding: utf-8 -*-
"""
extract_pinyin_audio.py —— 从本地 TTS 缓存提取拼音语音打包进应用（零网络）
原理：tts_cache 文件名 = sha256(text|voice|rate|pitch).wav。遍历 252 个
拼音标注（含四声变体），用当前统一参数（小艺/ -5/ 0）计算缓存键，
命中即复制为 assets/pinyin-audio/<标注>.wav——打包进应用后，拼音板块
在手机上完全离线可用（AudioManager 预加载优先读本目录）。
未命中的标注列出到 stdout，可由 prewarm_all 合成后重跑本脚本提取。
用法：python tools/extract_pinyin_audio.py [voice] [rate]

安全约束：标注名由脚本内置拼音表派生（无外部输入）；输出路径经
os.path.normpath + 目录边界断言，杜绝路径穿越。
"""
import hashlib
import os
import shutil
import sys

ROOT = r"D:\ZCODE\汉字小星球"
CACHE = os.path.normpath(os.path.join(ROOT, "tts_cache"))
OUT = os.path.normpath(os.path.join(ROOT, "assets", "pinyin-audio"))
VOICE = sys.argv[1] if len(sys.argv) > 1 else "zh-CN-XiaoyiNeural"
RATE = int(sys.argv[2]) if len(sys.argv) > 2 else -5

# ---- 内置拼音表（与 js/tts.js SYLLABLES 同源）----
SHENGMU = ["b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x",
           "zh", "ch", "sh", "r", "z", "c", "s", "y", "w"]
YUNMU = ["a", "o", "e", "i", "u", "ü", "ai", "ei", "ui", "ao", "ou", "iu",
         "ie", "üe", "er", "an", "en", "in", "un", "ün", "ang", "eng", "ing", "ong"]
ZHENGTI = ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu",
           "ye", "yue", "yuan", "yin", "yun", "ying"]

FINAL_VOWEL = {"üe": "e", "ai": "a", "ei": "e", "ui": "i", "ao": "a", "ou": "o", "iu": "u",
               "ie": "e", "er": "e", "an": "a", "en": "e", "in": "i", "un": "u",
               "ang": "a", "eng": "e", "ing": "i", "ong": "o",
               "a": "a", "o": "o", "e": "e", "i": "i", "u": "u"}
SUFFIXES = sorted(FINAL_VOWEL, key=len, reverse=True)
TONE_CHAR = {"a": "āáǎà", "o": "ōóǒò", "e": "ēéěè", "i": "īíǐì", "u": "ūúǔù"}


def add_tone(syl, tone):
    for suf in SUFFIXES:
        if syl.endswith(suf):
            v = FINAL_VOWEL[suf]
            return syl[: len(syl) - len(suf)] + suf.replace(v, TONE_CHAR[v][tone - 1])
    return syl


def build_annotations():
    out = []
    for p in SHENGMU:
        base = p + "a"
        out.extend(add_tone(base, t) for t in range(1, 5))
    for p in YUNMU:
        out.extend(add_tone(p, t) for t in range(1, 5))
    for p in ZHENGTI:
        out.extend(add_tone(p, t) for t in range(1, 5))
    return out


os.makedirs(OUT, exist_ok=True)
hit, miss = [], []
for ann in build_annotations():
    k = hashlib.sha256(f"{ann}|{VOICE}|{RATE}|0".encode("utf-8")).hexdigest()
    src = os.path.normpath(os.path.join(CACHE, k + ".wav"))
    dst = os.path.normpath(os.path.join(OUT, ann + ".wav"))
    # 路径边界断言：规范化后必须仍在缓存/输出目录内
    if os.path.commonpath([CACHE, src]) != CACHE or os.path.commonpath([OUT, dst]) != OUT:
        raise ValueError("path escapes allowed dir")
    if os.path.exists(src):
        shutil.copyfile(src, dst)
        hit.append(ann)
    else:
        miss.append(ann)

print(f"已打包 {len(hit)}/{len(hit) + len(miss)} 条拼音语音 → assets/pinyin-audio/")
if miss:
    print("未命中（需先合成再重跑本脚本）：", " ".join(miss[:40]), "..." if len(miss) > 40 else "")
