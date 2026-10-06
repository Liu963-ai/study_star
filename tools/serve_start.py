# -*- coding: utf-8 -*-
"""
serve_start.py —— 以完全脱离父进程的方式启动 8767/7860 两个服务
用法：python tools/serve_start.py   （父进程退出后子服务继续运行）
"""
import os
import subprocess
import sys

ROOT = r"D:\ZCODE\汉字小星球"
DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP

specs = [
    ("static-8767", [sys.executable, "-m", "http.server", "8767", "--bind", "0.0.0.0"]),
    ("tts-7860", [sys.executable, os.path.join(ROOT, "tts_server.py")]),
]

for name, cmd in specs:
    subprocess.Popen(
        cmd, cwd=ROOT,
        creationflags=DETACHED,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print("started", name)
