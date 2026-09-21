# -*- coding: utf-8 -*-
"""
gen_langdu_imgs.py —— 朗读剧场 15 篇课文配图批量生成（构建期一次性）
按每篇课文的场景生成水彩儿童绘本插图（assets/langdu-img/l01..l15.jpg，
640×480，裁掉底部水印条），朗读页右侧插画卡展示对应课文插图。

安全约束（SSRF 防护）：仅 https + 域名白名单 + DNS 解析 IP 边界
校验 + 禁止重定向（同 gen_jushi_imgs.py）。
"""
import io, os, socket, time, urllib.parse, urllib.request, ipaddress
from PIL import Image

OUT = r"D:\ZCODE\汉字小星球\assets\langdu-img"
os.makedirs(OUT, exist_ok=True)
ALLOWED_HOST = "image.pollinations.ai"


def check_host(host):
    infos = socket.getaddrinfo(host, 443)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError("blocked ip: %s" % ip)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(NoRedirect)

STYLE = ("children's picture book illustration, soft watercolor, warm colors, "
         "cute, beautiful scenery, no text")

# l01..l15 与 DATA.langdu.list 顺序一一对应
SCENES = [
    ("autumn scene: golden falling leaves, blue sky, a flock of wild geese flying south in V formation", 1),
    ("beautiful lotus pond south of the Yangtze, big green lotus leaves, little fish swimming among them, a girl in a small boat picking lotus", 2),
    ("snowy winter field, little chicken, puppy, duck and pony each leaving different footprints in the snow like drawings, a frog sleeping in an underground burrow", 3),
    ("four seasons in one scene: spring sprout, summer lotus leaf with frog, autumn wheat ear, snowman, divided composition", 4),
    ("poetic scene of clouds, rain, snow, wind, flowers, trees, birds and insects, green willow and red peach blossoms by a mountain stream", 5),
    ("a colorful school bag with school supplies around it: eraser, ruler, notebook, pencil case, pencil, sharpener", 6),
    ("five-star red flag rising on a flagpole at sunrise, children saluting the national flag at school", 7),
    ("a child sitting in a little boat on the crescent moon among twinkling stars in the deep blue night sky", 8),
    ("a child walking under street light with a long friendly black shadow like a little dog, front and back shadows", 9),
    ("human hands and brain working together, creative craft scene with tools, lightbulb idea", 10),
    ("cute animals showing tails: monkey with long tail, rabbit with short tail, squirrel with umbrella-like tail, rooster, duck, peacock with beautiful tail", 11),
    ("a thirsty crow dropping pebbles into a narrow bottle to raise the water and drink", 12),
    ("happy raindrops falling from clouds onto flowers and grass, some raindrops going to a barren land where flowers bloom", 13),
    ("a traditional Chinese ink painting style landscape: distant mountains with colors, silent flowing water, spring flowers, birds", 14),
    ("gentle wind blowing: autumn leaves falling, February flowers blooming, river waves, bamboo bending", 15),
]


def gen(prompt, seed, path):
    q = urllib.parse.quote(prompt + ", " + STYLE)
    url = "https://%s/prompt/%s?width=640&height=600&nologo=true&seed=%d&model=flux" % (
        ALLOWED_HOST, q, seed)
    p = urllib.parse.urlparse(url)
    if p.scheme != "https" or (p.hostname or "") != ALLOWED_HOST:
        raise ValueError("blocked host: %s" % p.hostname)
    check_host(p.hostname)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with _opener.open(req, timeout=120) as r:
        data = r.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = img.size
    img = img.crop((0, 0, w, int(h * 0.90)))
    img = img.resize((640, 480), Image.LANCZOS)
    img.save(path, "JPEG", quality=88)


for prompt, n in SCENES:
    path = os.path.join(OUT, "l%02d.jpg" % n)
    if os.path.exists(path) and os.path.getsize(path) > 20000:
        print("skip l%02d" % n); continue
    done = False
    for attempt in range(4):
        try:
            gen(prompt, 3000 + n * 13 + attempt * 19, path)
            print("ok l%02d" % n); done = True
            break
        except Exception as e:
            print("fail l%02d" % n, attempt + 1, e)
            time.sleep(4)
    if not done:
        print("FAILED l%02d" % n)
    time.sleep(1.2)
print("done")
