# -*- coding: utf-8 -*-
"""
tts_server.py —— 本地语音合成服务（edge-tts → mp3，带磁盘缓存）

职责：接收文本 → 调用 edge_tts.Communicate → 生成 mp3 → 返回音频。
接口：
  GET  /ping  → {"ok":true,"voices":{...}}          健康检查
  POST /tts   → body: {"text","voice","rate","pitch"}（JSON）
                返回 audio/mpeg（相同内容命中磁盘缓存，不重复合成）
  POST /llm   → 代理转发智谱 LLM（仅限环回地址调用）
缓存：以 (text + voice + rate + pitch) 的 sha1 哈希为文件名，存 tts_cache/。
运行：python tts_server.py
  监听 0.0.0.0:7860 —— 本机与同一局域网内的手机/平板均可访问；
  /tts 与 /ping 对局域网开放（CORS 只放行本机与私网来源，见 _origin_allowed），
  /llm 代理携带 API Key，仅允许环回地址调用。
"""
import asyncio
import hashlib
import heapq
import ipaddress
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import edge_tts
import numpy as np
import soundfile as sf

# ---- 固化配置（本工程内路径，字面量） ----
CACHE_DIR = r"D:\ZCODE\汉字小星球\tts_cache"
HOST = "0.0.0.0"      # 监听所有网卡：手机/平板可通过电脑局域网 IP 访问语音
PORT = 7860

# ================= 音质增强（解决机械感与听不清） =================
def _biquad(x, b0, b1, b2, a0, a1, a2):
    """RBJ 双二阶滤波器（scipy.signal.lfilter，C 速实现；系数按 a0 归一）。"""
    from scipy.signal import lfilter
    return lfilter([b0 / a0, b1 / a0, b2 / a0], [1.0, a1 / a0, a2 / a0], x)


def _coeffs_highpass(fc, fs, q=0.707):
    w0 = 2 * np.pi * fc / fs
    alpha = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    a0 = 1 + alpha
    return ((1 + c) / 2, -(1 + c), (1 + c) / 2, a0, -2 * c, 1 - alpha)


def _coeffs_peaking(fc, fs, q=1.0, gain_db=4.0):
    w0 = 2 * np.pi * fc / fs
    alpha = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    A = 10 ** (gain_db / 40)
    a0 = 1 + alpha / A
    return ((1 + alpha * A), -(2 * c), (1 - alpha * A), a0, -2 * c, 1 - alpha / A)


def enhance_file(path):
    """对已落盘的 mp3 做音质增强：高通 80Hz 去浑浊，3.2kHz 提升 5dB 让辅音
    更清晰，6.3kHz 提升 2dB 增加明亮空气感（更接近真人录音），
    响度归一 RMS -15dBFS（峰值限幅 -1dBFS）。失败保留原样。"""
    try:
        x, sr = sf.read(path, dtype="float64")
        if x.ndim > 1:
            x = x.mean(axis=1)
        hp = _biquad(x, *_coeffs_highpass(80.0, sr))
        pk = _biquad(_biquad(hp, *_coeffs_peaking(3200.0, sr, 0.9, 5.0)),
                     *_coeffs_peaking(6300.0, sr, 1.2, 2.0))
        rms = np.sqrt(np.mean(pk ** 2)) + 1e-9
        gain = min((10 ** (-15 / 20)) / rms,
                   (10 ** (-1 / 20)) / (np.max(np.abs(pk)) + 1e-9))
        # 写无损 WAV（本机服务，避免 mp3 二次有损编码）
        sf.write(path, (pk * gain).astype("float32"), sr, format="WAV", subtype="PCM_16")
    except Exception:
        pass

# ---- 音色白名单（与 js/tts.js 的 VOICES 一致，便于后续增删） ----
VOICES = [
    "zh-CN-XiaoxiaoNeural",   # 小霞老师（默认，自然清晰女声）
    "zh-CN-XiaoyiNeural",     # 小艺姐姐（活泼女声）
    "zh-CN-YunyangNeural",    # 云扬叔叔（新闻播音，字正腔圆）
    "zh-CN-YunxiNeural",      # 阳光小哥哥（活泼男声）
    "zh-CN-YunxiaNeural",     # 萌萌弟弟（可爱男声）
]
MAX_TEXT = 200        # 单次合成文本上限（字符）
MAX_BODY = 4096       # 请求体上限（字节）

# 每 key 一把锁：同一内容的并发请求合并为一次合成（双检锁模式）；
# 不同 key 互不阻塞——避免单条云端卡死拖垮整站语音。
_KEY_LOCKS_GUARD = threading.Lock()
_KEY_LOCKS = {}


def _key_lock(key):
    with _KEY_LOCKS_GUARD:
        if key not in _KEY_LOCKS:
            _KEY_LOCKS[key] = threading.Lock()
        return _KEY_LOCKS[key]


# ---- 合成优先级调度器 ----
# 4 个工作线程；点击朗读（prio=1）随时插队，预热（prio=0）最多占 2 路，
# 始终保留 2 路空余——孩子点击新内容时无需等待预热队列，立即开始合成。
#
# 看门狗（v20 新增）：edge-tts 的 WebSocket 在 Windows 上偶发无法被 asyncio
# 取消，连 synth_to_file 的 40s 硬超时也拦不住，worker 线程会永久卡在 await。
# 实测曾把 4 路全部卡死，后果是双重的：
#   · 队列里的新任务永远不被领取（连 .part 都不再创建），前端全部 60s 后 504；
#   · 卡死的是预热任务时 _active_low 不会归还，预热通道被永久饿死；
#   · 只能重启进程才能恢复。
# 线程无法 kill，但可以「不再信任它」：超过 JOB_TIMEOUT 就把它从 _running
# 摘除、归还它占用的低优先额度，并补一个新的 worker 接管队列。
class _PriorityScheduler:
    JOB_TIMEOUT = 120       # 单次「领取任务 → 执行完」的上限（秒）；正常最坏约 80s
    WATCH_INTERVAL = 5      # 看门狗巡检间隔（秒）
    MAX_WORKERS = 12        # 线程泄漏上限（卡死才补，避免上游长期故障时无限膨胀）

    def __init__(self, workers=4, low_slots=2):
        self._cv = threading.Condition()
        self._heap = []          # (-prio, seq, fn)
        self._seq = 0
        self._active_low = 0     # 正在执行的预热数
        self._low_slots = low_slots
        self._running = {}       # wid -> [领取时刻, prio]
        self._wid_seq = 0
        self._total = 0          # 已创建（含被放弃的）worker 数
        self._spawn(workers)
        threading.Thread(target=self._watchdog, daemon=True).start()

    def _spawn(self, n):
        for _ in range(n):
            with self._cv:
                if self._total >= self.MAX_WORKERS:
                    print("[watchdog] worker 数已达上限 " + str(self.MAX_WORKERS) +
                          "，不再补线程（建议重启服务）", flush=True)
                    return
                self._total += 1
                self._wid_seq += 1
                wid = self._wid_seq
            threading.Thread(target=self._worker, args=(wid,), daemon=True).start()

    def submit(self, prio, fn):
        with self._cv:
            self._seq += 1
            heapq.heappush(self._heap, (-prio, self._seq, (prio, fn)))
            self._cv.notify_all()

    def _watchdog(self):
        while True:
            time.sleep(self.WATCH_INTERVAL)
            stuck = []
            with self._cv:
                now = time.time()
                for wid in list(self._running.keys()):
                    if now - self._running[wid][0] > self.JOB_TIMEOUT:
                        rec = self._running.pop(wid)
                        if rec[1] < 1:
                            self._active_low -= 1     # 归还被卡死的预热额度
                        stuck.append((wid, now - rec[0]))
                if stuck:
                    self._cv.notify_all()
            for wid, dt in stuck:
                print("[watchdog] worker %d 卡死 %.0fs，已放弃该线程并补一个新线程"
                      % (wid, dt), flush=True)
            if stuck:
                self._spawn(len(stuck))

    def _worker(self, wid):
        while True:
            with self._cv:
                while True:
                    if not self._heap:
                        self._cv.wait()
                        continue
                    # 挑选可执行的最高优先级任务：
                    #   prio>=1 永远可执行；prio=0 受 low_slots 限制（给点击留通道）
                    pick = None
                    for i, (_, _, (prio, fn)) in enumerate(self._heap):
                        if prio >= 1 or self._active_low < self._low_slots:
                            pick = (i, prio, fn)
                            break
                    if pick is None:
                        self._cv.wait()          # 只有预热在排队且已占满低优先通道
                        continue
                    i, prio, fn = pick
                    self._heap.pop(i)
                    if prio < 1:
                        self._active_low += 1
                    self._running[wid] = [time.time(), prio]
                    break
            try:
                fn()
            finally:
                with self._cv:
                    rec = self._running.pop(wid, None)
                    # rec 为 None 表示本线程已被看门狗判定卡死并归还过额度，
                    # 此处绝不能重复递减，否则 _active_low 会被减成负数。
                    if rec and rec[1] < 1:
                        self._active_low -= 1
                    self._cv.notify_all()


_SCHED = _PriorityScheduler(4, low_slots=2)


def synth_to_file(text, voice, rate, pitch, path):
    """调用 edge-tts 合成一段 mp3 落盘到 path（调用方已构造缓存路径），
    随后原地做 DSP 音质增强。
    硬超时：云端 WebSocket 偶发卡死会无限挂起（曾把全局锁一起拖死，
    表现为全站「点击没声音」），这里对整次合成加 40s 上限，超时抛错
    由调用方返回 500，客户端随即降级浏览器语音，不再无限等待。"""
    async def run():
        communicate = edge_tts.Communicate(
            text, voice, rate=rate, pitch=pitch,
            connect_timeout=10, receive_timeout=30)
        await communicate.save(path)
    asyncio.run(asyncio.wait_for(run(), timeout=40))
    enhance_file(path)


def _origin_allowed(origin):
    """判断请求来源是否可放行。

    本服务监听 0.0.0.0，局域网设备要能调用 /tts，所以不能一刀切拒绝跨域；
    但也不能回显 "*"——否则用户浏览任意公网网页时，该网页可静默调用本机
    合成服务（消耗 edge-tts 配额、写满磁盘缓存）。故按来源做白名单：
      · 无 Origin（同源请求、curl 等非浏览器客户端）→ 放行
      · "null"（file:// 打开的页面）→ 放行
      · 主机为 localhost / 回环 / 私网 / 链路本地地址 → 放行
      · 其余（包含任何公网域名）→ 拒绝
    """
    if not origin or origin == "null":
        return True
    try:
        p = urlparse(origin)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False
    host = (p.hostname or "").lower()
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False            # 域名一律不放行（本服务的合法来源只有 localhost 与 IP）
    return ip.is_loopback or ip.is_private or ip.is_link_local


class Handler(BaseHTTPRequestHandler):
    """只提供 /ping、/tts 与 /llm 三个接口。"""

    # 连接超时：客户端建连后不发（或慢速发送）请求会占住一个线程，
    # 默认无超时可被 slowloris 拖垮。正常请求远快于此值。
    timeout = 30

    def _cors(self):
        """页面端口与本服务端口不同源，需放行跨域；按来源回显而非 "*"。"""
        origin = self.headers.get("Origin", "")
        if origin and _origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """预检请求：直接放行。"""
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/ping":
            self._json(200, {"ok": True, "voices": VOICES})
        else:
            self._json(404, {"ok": False})

    def _forward_llm(self, data):
        """代理转发智谱 LLM 请求（浏览器直连会跨域，统一走本服务）。
        访问控制：该代理携带 API Key，仅允许电脑本机（环回地址）调用；
        局域网设备（手机/平板）只开放 /tts 与 /ping。
        SSRF 防护：仅 https；目标域名白名单；解析出的所有 IP 必须
        均为公网地址（阻断私网/环回/链路本地/保留地址）；禁止重定向。"""
        import urllib.request
        import ipaddress
        import socket
        from urllib.parse import urlparse

        client = ipaddress.ip_address(self.client_address[0])
        if not (client.is_loopback):
            self._json(403, {"ok": False, "msg": "llm proxy is local only"})
            return

        key = str(data.get("key", "")).strip()
        model = str(data.get("model", "glm-4-flash"))
        messages = data.get("messages")
        if not key or not isinstance(messages, list) or not messages:
            self._json(400, {"ok": False, "msg": "bad key/messages"})
            return

        url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        p = urlparse(url)
        host = (p.hostname or "").lower()
        if p.scheme != "https" or host != "open.bigmodel.cn":
            self._json(400, {"ok": False, "msg": "blocked host"})
            return
        try:
            infos = socket.getaddrinfo(host, 443)
        except Exception:
            self._json(502, {"ok": False, "msg": "dns fail"})
            return
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
                self._json(400, {"ok": False, "msg": "blocked ip"})
                return

        payload = json.dumps({
            "model": model if re.fullmatch(r"[\w.-]{1,60}", model) else "glm-4-flash",
            "messages": messages,
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }).encode("utf-8")

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None                       # 禁止重定向，防绕过校验

        opener = urllib.request.build_opener(NoRedirect)
        req = urllib.request.Request(url, data=payload, headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
            "Host": host
        })
        try:
            with opener.open(req, timeout=60) as resp:
                answer = json.loads(resp.read().decode("utf-8"))
            content = answer.get("choices", [{}])[0].get("message", {}).get("content", "")
            self._json(200, {"ok": True, "content": content})
        except Exception as exc:
            self._json(502, {"ok": False, "msg": str(exc)})

    def do_POST(self):
        if self.path == "/llm":
            try:
                length = int(self.headers.get("Content-Length", 0))
                if length <= 0 or length > 262144:
                    self._json(400, {"ok": False, "msg": "bad length"})
                    return
                raw = self.rfile.read(length)
                try:
                    data = json.loads(raw.decode("utf-8"))
                except UnicodeDecodeError:
                    data = json.loads(raw.decode("gb18030"))
                self._forward_llm(data)
            except Exception as exc:
                try:
                    self._json(500, {"ok": False, "msg": str(exc)})
                except Exception:
                    pass
            return
        if self.path != "/tts":
            self._json(404, {"ok": False})
            return
        # 跨域来源白名单：非白名单直接拒绝，避免被公网网页当免费合成代理
        if not _origin_allowed(self.headers.get("Origin", "")):
            self._json(403, {"ok": False, "msg": "origin not allowed"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > MAX_BODY:
                self._json(400, {"ok": False, "msg": "bad length"})
                return
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw.decode("utf-8"))       # 浏览器均为 UTF-8
            except UnicodeDecodeError:
                data = json.loads(raw.decode("gb18030"))     # 兼容本机命令行工具的 GBK

            text = str(data.get("text", "")).strip()
            voice = str(data.get("voice", ""))
            rate = int(data.get("rate", -10))
            pitch = int(data.get("pitch", 0))

            # ---- 参数校验（音色白名单 / 数值范围 / 文本长度） ----
            if not text or len(text) > MAX_TEXT:
                self._json(400, {"ok": False, "msg": "bad text"})
                return
            if voice not in VOICES:
                self._json(400, {"ok": False, "msg": "bad voice"})
                return
            rate = max(-50, min(20, rate))
            pitch = max(-20, min(20, pitch))

            # ---- 缓存键：内容哈希（十六进制，天然防路径穿越） ----
            key = hashlib.sha256(
                (text + "|" + voice + "|" + str(rate) + "|" + str(pitch)).encode("utf-8")
            ).hexdigest()
            if not re.fullmatch(r"[0-9a-f]{64}", key):
                self._json(400, {"ok": False, "msg": "bad key"})
                return
            path = CACHE_DIR + "/" + key + ".wav"

            # ---- 优先级：点击朗读 prio=1（插队），预热 prio=0 ----
            prio = 1 if int(data.get("prio", 0)) >= 1 else 0

            # ---- 相同内容命中缓存直接返回；未命中交给调度器合成 ----
            #      · 每 key 一把锁：同 key 请求合并等待
            #      · 4 路并行消费，点击任务插队在预热任务之前
            #      · 单条云端卡死由 synth_to_file 的 40s 硬超时兜底
            import os
            if not os.path.exists(path):
                done = threading.Event()

                def job():
                    tmp = None
                    try:
                        with _key_lock(key):
                            if not os.path.exists(path):
                                os.makedirs(CACHE_DIR, exist_ok=True)
                                tmp = path + ".part"
                                synth_to_file(text, voice,
                                              ("+" if rate >= 0 else "") + str(rate) + "%",
                                              ("+" if pitch >= 0 else "") + str(pitch) + "Hz",
                                              tmp)
                                os.replace(tmp, path)
                    finally:
                        # 合成失败/超时会留下 0 字节 .part（实测缓存目录已堆积多个），
                        # 这里兜底清理；os.replace 成功后 tmp 已不存在，remove 抛错即忽略。
                        if tmp:
                            try:
                                os.remove(tmp)
                            except OSError:
                                pass
                        done.set()

                _SCHED.submit(prio, job)
                if not done.wait(timeout=60):
                    self._json(504, {"ok": False, "msg": "synth timeout"})
                    return

            if not os.path.exists(path):
                self._json(500, {"ok": False, "msg": "synth failed"})
                return

            with open(path, "rb") as f:
                audio = f.read()
            ctype = "audio/wav" if audio[:4] == b"RIFF" else "audio/mpeg"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(audio)
        except Exception as exc:                      # 合成失败：返回错误，不阻塞调用方
            try:
                self._json(500, {"ok": False, "msg": str(exc)})
            except Exception:
                pass

    def log_message(self, fmt, *args):
        return                                        # 静默访问日志


if __name__ == "__main__":
    import os
    os.makedirs(CACHE_DIR, exist_ok=True)
    print("edge-tts 服务已启动: 本机 http://127.0.0.1:" + str(PORT) +
          "，局域网 http://<电脑IP>:" + str(PORT) + "（缓存目录 " + CACHE_DIR + "）")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
