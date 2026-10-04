# -*- coding: utf-8 -*-
"""
fill_by_same_sound.py —— 用「同音同调常用字」的现成音频补齐缺失标注
原理：tts_cache 里已有大量汉字音频（此前页面使用与预热产生）。对 43 条
缺失标注给出同音同调的候选汉字列表，逐个探测缓存键，命中即复制为
assets/pinyin-audio/<标注>.wav。全部候选都不命中则跳过（运行时回落本
机备用声），绝不使用不同调的音频（避免教学错误）。
只读缓存，不发任何网络请求。
"""
import hashlib
import json
import os
import shutil

ROOT = r"D:\ZCODE\汉字小星球"
CACHE = os.path.normpath(os.path.join(ROOT, "tts_cache"))
OUT = os.path.normpath(os.path.join(ROOT, "assets", "pinyin-audio"))
VOICE, RATE = "zh-CN-XiaoyiNeural", -5

# 缺失标注 → 同音同调候选汉字（按常用度排序）
SAME_SOUND = {
    "ī":  ["一", "衣", "医", "依"],
    "í":  ["姨", "移", "疑", "遗"],
    "ǐ":  ["以", "已", "蚁", "椅"],
    "ì":  ["意", "易", "亿", "艺", "义", "议"],
    "ū":  ["乌", "屋", "污", "呜"],
    "ú":  ["无", "吴", "梧"],
    "ǔ":  ["五", "伍", "午", "舞", "武"],
    "ù":  ["物", "误", "雾", "悟", "务"],
    "ǖ":  ["迂"],
    "ǘ":  ["鱼", "渔", "余"],
    "ǚ":  ["雨", "语", "羽", "宇"],
    "ǜ":  ["玉", "育", "预", "遇", "元"],
    "uī": ["威", "微", "危", "委"],
    "uí": ["为", "围", "维", "违"],
    "uǐ": ["伟", "尾", "委", "伪"],
    "uì": ["位", "未", "味", "卫", "喂"],
    "iū": ["优", "忧", "悠"],
    "iú": ["游", "邮", "油", "由"],
    "iǔ": ["友", "有", "引"],
    "iù": ["又", "右", "幼", "诱"],
    "iē": ["耶", "掖"],
    "ié": ["爷", "角", "杰"],
    "iě": ["也", "写", "姐"],
    "iè": ["夜", "叶", "页", "液", "业"],
    "üē": ["约", "曰"],
    "üé": ["学", "雪", "决", "觉"],
    "üě": ["雪", "觉"],
    "üè": ["月", "乐", "越", "岳", "学"],
    "īn": ["音", "因", "姻", "阴"],
    "ín": ["银", "林", "邻", "民"],
    "ǐn": ["引", "饮", "隐"],
    "ìn": ["印", "进", "近", "尽"],
    "ūn": ["温", "瘟", "文"],
    "ún": ["文", "蚊", "闻"],
    "ǔn": ["稳", "吻"],
    "ùn": ["问", "文的"],
    "ǖn": ["晕", "军", "君"],
    "īng": ["英", "鹰", "应", "莺"],
    "íng": ["迎", "营", "蝇", "赢"],
    "ǐng": ["影", "颖"],
    "ìng": ["硬", "映", "另", "令"],
}

hit, partial, none_ = [], [], []
for ann, chars in sorted(SAME_SOUND.items()):
    dst = os.path.normpath(os.path.join(OUT, ann + ".wav"))
    if os.path.exists(dst):
        hit.append(ann)
        continue
    done = False
    for ch in chars:
        k = hashlib.sha256(f"{ch}|{VOICE}|{RATE}|0".encode("utf-8")).hexdigest()
        src = os.path.normpath(os.path.join(CACHE, k + ".wav"))
        if os.path.exists(src):
            shutil.copyfile(src, dst)
            hit.append(ann)
            done = True
            break
    if not done:
        none_.append(ann)

covered = len(hit)
total = len(SAME_SOUND)
print(f"同音字补齐: {covered}/{total} 条已就绪")
if none_:
    print("仍缺（运行时回落备用声）:", " ".join(none_))
