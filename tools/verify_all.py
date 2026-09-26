#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""汉字小星球 · 一键全量回归
------------------------------------------------------------
把散落在 tools/ 下的验证脚本串成一条命令，作为改动前后的统一安全网。
任何一步失败即中止后续高风险步骤，并给出非零退出码。

步骤：
  1. 语法    node --check 全部 js/*.js、sw.js、tools/*.js
  2. 一致性  tools/lint_static.js       引用 / 预缓存清单 / 版本号 / 禁止项
  3. 内容    tools/check_pinyin_bank.js  拼音标注与朗读调用的一致性断言
             tools/check_jushi.js        词语乐园轮次结构、重复词与词卡资源
  4. 冒烟    tools/smoke_test.js         11 页浏览器加载 + 行为断言（真断言，非只看退出码）
  5. 体积    tools/measure_weight.js     同源静态资源字节数

用法：
  python tools/verify_all.py                # 全量
  python tools/verify_all.py --no-browser   # 跳过需要浏览器的 4、5（秒级返回）
  python tools/verify_all.py --port 8791    # 临时静态服务端口

可用环境变量覆盖：
  HH_NODE   node 可执行文件路径（本机 PATH 里没有 node，故内置探测）
  HH_NODE_MODULES  puppeteer-core 所在的 node_modules 目录
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NODE_CANDIDATES = [
    os.environ.get("HH_NODE") or "",
    r"C:\Users\14738\.workbuddy\binaries\node\versions\22.22.2-3\node.exe",
    r"C:\Users\14738\.workbuddy\binaries\node\versions\22.22.2\bin\node",
    shutil.which("node") or "",
]
NODE_MODULES_CANDIDATES = [
    os.environ.get("HH_NODE_MODULES") or "",
    r"C:\Users\14738\.workbuddy\binaries\node\workspace\node_modules",
]


def _first_existing(paths):
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


NODE = _first_existing(NODE_CANDIDATES)
NODE_MODULES = _first_existing(NODE_MODULES_CANDIDATES)

NO_BROWSER = "--no-browser" in sys.argv
PORT = 8791
if "--port" in sys.argv:
    PORT = int(sys.argv[sys.argv.index("--port") + 1])

results = []          # (步骤名, 是否通过, 摘要)


def banner(title):
    print("\n" + "=" * 62)
    print(title)
    print("=" * 62)


def run(cmd, timeout=600, cwd=ROOT, env=None, capture=True):
    """跑一条命令，返回 (returncode, stdout+stderr)。超时视为失败。"""
    e = dict(os.environ)
    if NODE_MODULES:
        e["NODE_PATH"] = NODE_MODULES
    if env:
        e.update(env)
    try:
        r = subprocess.run(cmd, cwd=cwd, env=e, timeout=timeout,
                           capture_output=capture, text=True,
                           encoding="utf-8", errors="replace")
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired as exc:
        got = ""
        for s in (exc.stdout, exc.stderr):
            if s:
                got += s if isinstance(s, str) else s.decode("utf-8", "replace")
        return 124, got + "\n[超时 %ds]" % timeout


# ---------------------------------------------------------------- 1 语法
def step_syntax():
    banner("步骤 1/5 · 语法检查（node --check）")
    files = []
    for d, pat in (("js", r"\.js$"), ("tools", r"\.js$")):
        p = os.path.join(ROOT, d)
        if os.path.isdir(p):
            files += [os.path.join(d, f) for f in sorted(os.listdir(p)) if re.search(pat, f)]
    files.append("sw.js")

    bad = []
    for f in files:
        code, out = run([NODE, "--check", f], timeout=60)
        if code != 0:
            bad.append((f, out.strip().splitlines()[:3]))
    if bad:
        for f, lines in bad:
            print("  ✗ " + f)
            for ln in lines:
                print("      " + ln)
        results.append(("语法检查", False, "%d/%d 个文件语法错误" % (len(bad), len(files))))
        return False
    print("  ✓ %d 个文件全部通过" % len(files))
    results.append(("语法检查", True, "%d 个文件" % len(files)))
    return True


# --------------------------------------------------- 2/3 静态一致性 + 语音库
def step_script(name, script, title):
    banner(title)
    code, out = run([NODE, script], timeout=300)
    print(out.rstrip())
    ok = code == 0
    results.append((name, ok, _tail_verdict(out)))
    return ok


def _tail_verdict(out):
    m = re.search(r"结果：\s*(PASS|FAIL)([^\n]*)", out)
    return (m.group(1) + m.group(2)).strip() if m else "(无结论行)"


# ---------------------------------------------------------------- 4 冒烟
class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def _serve(directory, port):
    handler = partial(_Quiet, directory=directory)
    for p in range(port, port + 20):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", p), handler)
        except OSError:
            continue
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv, p
    raise RuntimeError("找不到可用端口（%d 起 20 个都占用了）" % port)


def step_smoke():
    banner("步骤 4/5 · 浏览器冒烟（11 页 + 行为断言）")
    try:
        srv, port = _serve(ROOT, PORT)
    except RuntimeError as exc:
        print("  ✗ " + str(exc))
        results.append(("浏览器冒烟", False, str(exc)))
        return False
    base = "http://127.0.0.1:%d/" % port
    try:
        code, out = run([NODE, os.path.join("tools", "smoke_test.js"), base], timeout=300)
    finally:
        srv.shutdown()

    try:
        data = json.loads(out[out.index("{"):out.rindex("}") + 1])
    except Exception:
        print(out.rstrip())
        results.append(("浏览器冒烟", False, "输出无法解析为 JSON（见上）"))
        return False

    fails = []

    # 4.1 每页：无运行时错误、无脏文本
    for pg in data.get("pages", []):
        if pg.get("errors"):
            fails.append("%s 运行时错误：%s" % (pg["page"], "; ".join(pg["errors"])))
        if pg.get("dirty"):
            fails.append("%s 出现 %d 处脏文本（[object Object]/undefined/NaN）" % (pg["page"], pg["dirty"]))

    # 4.2 记账与进度
    b = data.get("behavior", {})
    exact = [
        ("starsAfterDoubleSettle", 3, "gotoSettle 重入锁失效（连点两次记了多次星星）"),
        ("urlUnchangedAfterRecord", True, "record 触发了跳页"),
        ("legacyWeekStars", 0, "旧格式周星星未按非本周处理"),
        ("weekStarsAfterAdd", 5, "本周星星累加错误"),
        ("progressMax", 4, "PROGRESS_MAX 不再是 4（首页进度点会与之脱节）"),
        ("pinyinProgressCapped", 4, "进度封顶失效"),
        ("syllable_b", "bō", "声母呼读音转换错误"),
        ("syllable_zh", "zhī", "zh 的呼读音转换错误"),
    ]
    for k, want, why in exact:
        if b.get(k) != want:
            fails.append("%s = %r，期望 %r —— %s" % (k, b.get(k), want, why))

    # 4.3 语音库覆盖与四声不退化
    bank = b.get("bank", {})
    if bank.get("size", 0) < 266:
        fails.append("语音库条目 %s < 266（覆盖回退）" % bank.get("size"))
    if bank.get("noDup") is not True:
        fails.append("语音库存在重复标注")
    for k in ("hasZha1", "hasA4", "hasZhi4", "hasU1", "hasUn1", "hasYue1"):
        if bank.get(k) is not True:
            fails.append("语音库缺少关键标注：%s" % k)
    for k, v in (b.get("toneVariety") or {}).items():
        if v != 4:
            fails.append("拼音 %s 的四声只有 %s 种（历史退化缺陷复发）" % (k, v))

    # 4.4 降级通道：绝不把拼音标注读成拉丁串
    spoken = b.get("fallbackSpoken") or []
    if "玻" not in spoken:
        fails.append("音卡降级未读汉字（实际读出：%r）" % spoken)
    latin = [s for s in spoken if re.search(r"[A-Za-z]", s)]
    if latin:
        fails.append("降级通道读出了拉丁串：%r" % latin)

    # 4.5 闯关选项
    q = data.get("quest", {})
    if q.get("hasObject"):
        fails.append("闯关选项渲染出 [object Object]")
    if q.get("unique") is not True:
        fails.append("闯关选项存在重复")

    # 4.6 拼音页降级行为
    pf = data.get("pyFallback", {})
    if "玻" not in (pf.get("cardSpoken") or []):
        fails.append("拼音页音卡降级未读汉字（实际：%r）" % pf.get("cardSpoken"))
    if (pf.get("toneSpoken") or []):
        fails.append("拼音页四声降级未静音（实际：%r）" % pf.get("toneSpoken"))
    if (pf.get("toneBtnCount") or 0) < 4:
        fails.append("拼音页四声按钮少于 4 个（实际 %s）" % pf.get("toneBtnCount"))

    # 4.7 闯关新玩法：限时挑战 + 连读辨调
    g = data.get("gameplay") or {}
    if not g.get("toggleExists"):
        fails.append("闯关页缺少限时挑战开关 #timedToggle")
    else:
        if g.get("afterClickPressed") != "true":
            fails.append("点击限时挑战开关后 aria-pressed 未变为 true（实际 %r）"
                         % g.get("afterClickPressed"))
        if g.get("storedFlag") != "true":
            fails.append("限时挑战开关状态未写入 hh_mapTimed（实际 %r）" % g.get("storedFlag"))
    if g.get("timerVisibleOnQuest") is not True:
        fails.append("开启限时挑战后题目里没有出现剩余时间条")
    if g.get("timerCountsDown") is not True:
        fails.append("剩余时间条没有倒数（transform 没有变化）")
    if g.get("timerStopsOnClose") is not True:
        fails.append("关闭题目后剩余时间条没有停表")

    tone = g.get("tone")
    if not tone:
        fails.append("第 5 关连开 %s 次都没出现「连读辨调」题（题型池或随机分支有问题）"
                     % g.get("opened"))
    else:
        if tone.get("dirty"):
            fails.append("辨调题里出现脏文本（[object Object]/undefined/NaN）")
        if tone.get("timerVisible") is not True:
            fails.append("辨调题的剩余时间条未显示")
        if not re.search(r"[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]", tone.get("big") or ""):
            fails.append("辨调题题干「%s」不是带声调的拼音标注" % tone.get("big"))

    for e in (data.get("gameplayErrors") or []):
        fails.append("闯关新玩法运行时错误：%s" % e)

    pages = data.get("pages", [])
    total_kb = sum(p.get("KB", 0) for p in pages)
    print("  页面数 %d · 累计传输 %d KB" % (len(pages), total_kb))
    if g.get("tone"):
        print("  限时挑战：开关可用、时间条%s、辨调题「%s」结构正确（第 %s 次开题命中）"
              % ("倒数正常" if g.get("timerCountsDown") else "未倒数",
                 tone.get("big"), g.get("opened")))
    if fails:
        print("\n  断言失败 %d 项：" % len(fails))
        for i, f in enumerate(fails, 1):
            print("   %d. %s" % (i, f))
        results.append(("浏览器冒烟", False, "%d 项断言失败" % len(fails)))
        return False

    print("  ✓ %d 页无运行时错误、无脏文本；行为、语音降级与闯关新玩法断言全部通过" % len(pages))
    results.append(("浏览器冒烟", True, "%d 页 · %d KB" % (len(pages), total_kb)))
    return True


# ---------------------------------------------------------------- 5 体积
def step_weight():
    banner("步骤 5/5 · 首屏体积（同源静态资源）")
    try:
        srv, port = _serve(ROOT, PORT + 100)
    except RuntimeError as exc:
        print("  ✗ " + str(exc))
        results.append(("首屏体积", False, str(exc)))
        return False
    base = "http://127.0.0.1:%d/" % port
    try:
        code, out = run([NODE, os.path.join("tools", "measure_weight.js"), base, "verify-all"], timeout=300)
    finally:
        srv.shutdown()
    print(out.rstrip())
    m = re.search(r"合计\s*([\d.]+)\s*MB", out)
    if code != 0 or not m:
        results.append(("首屏体积", False, "未能测得合计值"))
        return False
    results.append(("首屏体积", True, "合计 %s MB" % m.group(1)))
    return True


# ---------------------------------------------------------------- 主流程
def main():
    t0 = time.time()
    print("汉字小星球 · 一键全量回归")
    print("项目根目录：" + ROOT)
    print("node：" + str(NODE))
    if not NODE:
        print("!! 找不到 node，请设置环境变量 HH_NODE 指向 node.exe")
        return 2
    print("node_modules：" + str(NODE_MODULES))
    if NO_BROWSER:
        print("模式：--no-browser（跳过冒烟与体积）")

    if not step_syntax():
        _summary(t0)
        return 1
    if not step_script("静态一致性", os.path.join("tools", "lint_static.js"),
                       "步骤 2/5 · 静态一致性（引用 / 预缓存 / 版本号 / 禁止项）"):
        _summary(t0)
        return 1
    if not step_script("内容断言", os.path.join("tools", "check_pinyin_bank.js"),
                       "步骤 3/5 · 内容断言（拼音标注与朗读调用 / 词语乐园结构）"):
        _summary(t0)
        return 1

    # 第 3 步的第二只脚本：与上一步合并为同一编号，失败即中止
    banner("步骤 3/5 · 词语乐园数据（轮次结构 / 重复词 / 词卡资源）")
    code, out = run([NODE, os.path.join("tools", "check_jushi.js")], timeout=120)
    print(out.rstrip())
    if code != 0:
        results.append(("词语乐园数据", False, _tail_verdict(out)))
        _summary(t0)
        return 1
    results.append(("词语乐园数据", True, _tail_verdict(out)))

    if not NO_BROWSER:
        if not step_smoke():
            _summary(t0)
            return 1
        step_weight()
    else:
        results.append(("浏览器冒烟", None, "已跳过"))
        results.append(("首屏体积", None, "已跳过"))

    return _summary(t0)


def _summary(t0):
    banner("汇总")
    for name, ok, brief in results:
        mark = "✓" if ok is True else ("–" if ok is None else "✗")
        print("  %s %-12s %s" % (mark, name, brief))
    failed = [r for r in results if r[0] and r[1] is False]
    print("\n耗时 %.1fs" % (time.time() - t0))
    if failed:
        print("结果：FAIL（%d 项未通过）" % len(failed))
        return 1
    print("结果：PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
