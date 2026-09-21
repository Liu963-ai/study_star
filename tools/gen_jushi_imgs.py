# -*- coding: utf-8 -*-
"""
gen_jushi_imgs.py —— 词语乐园 20 轮场景插图批量生成（构建期一次性工具）
用生图服务 image.pollinations.ai（免费文生图）生成儿童绘本水彩风格
场景图，裁掉底部水印条后存为 assets/jushi/r01..r20.jpg（640×480）。
图片为构建期产物，应用运行时只读本地文件，无外部依赖。

安全约束（SSRF 防护）：仅 https；目标域名白名单（image.pollinations.ai）；
请求前解析 DNS 并阻断私网/环回/链路本地/保留地址；禁止重定向。
"""
import io, os, socket, sys, time, urllib.parse, urllib.request, ipaddress
from PIL import Image

OUT = r"D:\ZCODE\汉字小星球\assets\jushi"
os.makedirs(OUT, exist_ok=True)

# ---- 唯一允许的生图服务（协议 + 域名白名单） ----
ALLOWED_HOST = "image.pollinations.ai"


def check_host(host):
    """协议与域名白名单校验 + DNS 解析 IP 边界校验（全部通过才放行）。"""
    infos = socket.getaddrinfo(host, 443)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError("blocked ip: %s" % ip)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """禁止重定向，防止跳转到白名单之外的地址。"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


STYLE = ("children's picture book illustration, soft watercolor, bright warm colors, "
         "simple clean composition, cute, kawaii, no text")

# 每轮 = 谁 + 在哪里 + 做什么（取每轮第一候选词，与 data.js jushi 对应）
SCENES = [
    ("a cute kitten singing happily on a tree branch", 1),
    ("a little bird flying above fluffy clouds in the blue sky", 2),
    ("a green frog swimming in a clear pond with lotus leaves", 3),
    ("a small orange fish blowing bubbles underwater", 4),
    ("a happy bee collecting honey among colorful flowers", 5),
    ("a white rabbit eating a carrot beside its burrow", 6),
    ("a kind grandpa telling a story at home in a cozy room", 7),
    ("a little girl dancing in a beautiful flower garden", 8),
    ("a big friendly elephant walking in the green mountains", 9),
    ("mom cooking delicious food in the kitchen", 10),
    ("a duckling catching a worm on the green grass", 11),
    ("a horse running on a sunny hillside", 12),
    ("twinkling stars and a crescent moon in the night sky", 13),
    ("dad and child playing with a ball in the park", 14),
    ("a dolphin dancing and jumping in the blue sea", 15),
    ("a little bird singing on a tree branch with flowers", 16),
    ("a cute teddy bear doll sleeping on a cozy bed", 17),
    ("raindrops dancing and falling from the sky", 18),
    ("happy children reading books in the classroom", 19),
    ("a smiling baby sleeping peacefully on the bed", 20),
]

_opener = urllib.request.build_opener(NoRedirect)


def gen(prompt, seed, path):
    q = urllib.parse.quote(prompt + ", " + STYLE)
    url = "https://%s/prompt/%s?width=640&height=560&nologo=true&seed=%d&model=flux" % (
        ALLOWED_HOST, q, seed)
    p = urllib.parse.urlparse(url)
    if p.scheme != "https" or (p.hostname or "") != ALLOWED_HOST:
        raise ValueError("blocked host: %s" % p.hostname)
    check_host(p.hostname)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with _opener.open(req, timeout=120) as r:
        data = r.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    # 裁掉底部 10%（水印条），再归一到 640×480（4:3）
    w, h = img.size
    img = img.crop((0, 0, w, int(h * 0.90)))
    img = img.resize((640, 480), Image.LANCZOS)
    img.save(path, "JPEG", quality=88)
    return img.size


only = [int(a) for a in sys.argv[1:]] if len(sys.argv) > 1 else None
for prompt, n in SCENES:
    if only and n not in only:
        continue
    path = os.path.join(OUT, "r%02d.jpg" % n)
    if os.path.exists(path) and os.path.getsize(path) > 20000:
        print("skip r%02d (exists)" % n); continue
    ok = False
    for attempt in range(4):
        try:
            size = gen(prompt, 1000 + n * 7 + attempt * 13, path)
            print("r%02d ok %s" % (n, size)); ok = True
            break
        except Exception as e:
            print("r%02d attempt %d failed: %s" % (n, attempt + 1, e))
            time.sleep(4)
    if not ok:
        print("r%02d FAILED" % n)
    time.sleep(1.5)
print("done")
