# -*- coding: utf-8 -*-
"""
gen_word_imgs.py —— 词语乐园「按词生图」批量工具（构建期一次性）
为 DATA.jushi 中 99 个唯一词语各生成一张水彩儿童绘本插图
（assets/jushi-words/<词>.jpg，512×512，裁掉底部水印条）。
成句后词语乐园按「谁 | 在哪里 | 做什么」三联展示对应词图，
保证插图与拼出的句子完全对应。
运行期应用只读本地文件，无外部依赖。

安全约束（SSRF 防护）：仅 https + 域名白名单 + DNS 解析 IP 边界
校验 + 禁止重定向（同 gen_jushi_imgs.py）。
"""
import io, os, socket, time, urllib.parse, urllib.request, ipaddress
from PIL import Image

OUT = r"D:\ZCODE\汉字小星球\assets\jushi-words"
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

STYLE = ("children's picture book illustration, soft watercolor, bright warm colors, "
         "cute, simple clean composition, centered subject, plain soft background, no text")

# 每个词的英文画面提示（谁＝形象；在哪里＝场景；做什么＝动作）
PROMPTS = {
    "小猫": "a cute kitten face portrait", "小狗": "a cute puppy face portrait",
    "小鸟": "a cute little bird", "熊猫": "a cute baby panda",
    "青蛙": "a cute green frog", "鸭子": "a cute white duck",
    "小鱼": "a cute small goldfish", "乌龟": "a cute little turtle",
    "蜜蜂": "a cute happy bee", "蝴蝶": "a beautiful colorful butterfly",
    "小兔": "a cute white rabbit", "松鼠": "a cute little squirrel",
    "爷爷": "a kind smiling grandpa portrait", "奶奶": "a kind smiling grandma portrait",
    "妹妹": "a cute little girl smiling", "哥哥": "a happy little boy smiling",
    "大象": "a cute friendly elephant", "老虎": "a cute cartoon tiger cub",
    "妈妈": "a gentle smiling mom portrait", "爸爸": "a cheerful dad portrait",
    "小鸭": "a cute yellow duckling", "小鸡": "a cute little chick",
    "马儿": "a cute little pony", "羊儿": "a cute fluffy lamb",
    "星星": "a smiling twinkling star in the night sky", "月亮": "a smiling crescent moon in the night sky",
    "我": "a happy child waving hello", "海豚": "a cute smiling dolphin",
    "娃娃": "a cute doll toy", "小熊": "a cute teddy bear toy",
    "雨点": "cute raindrops with happy faces", "雪花": "beautiful snowflakes",
    "同学": "two happy school kids together", "老师": "a friendly teacher smiling",
    "宝宝": "a cute smiling baby",

    "在树上": "on a big green tree branch", "在屋里": "inside a cozy warm room at home",
    "在云上": "above fluffy white clouds in the blue sky", "在山里": "among green high mountains",
    "在池塘里": "in a lotus pond with lily pads", "在河边": "by a gentle river bank",
    "在水里": "under clear blue water with light rays", "在沙坑": "in a sandy playground sandbox",
    "在花丛中": "among a field of colorful flowers", "在花园里": "in a beautiful flower garden",
    "在洞里": "inside a cozy little burrow hole", "在门口": "at the front door of a house",
    "在广场上": "in a sunny town square with fountain", "在厨房": "in a bright home kitchen",
    "在超市": "in a supermarket with shelves of food", "在草地上": "on green grass lawn",
    "在院子里": "in a home garden yard with fence", "在山坡上": "on a sunny grassy hillside",
    "在草原上": "on a wide green grassland", "在天上": "in the blue sky with soft clouds",
    "在云里": "among fluffy white clouds", "在公园里": "in a green park with trees and path",
    "在球场上": "on an outdoor basketball court", "在大海里": "in the blue sea with waves",
    "在浪花里": "among white sea wave splashes", "在枝头": "on a tree branch with fresh leaves",
    "在花上": "on a big pink flower", "在床上": "on a cozy bed with blanket and pillow",
    "在椅子上": "on a wooden chair", "从天上": "falling from the blue sky with clouds",
    "在空中": "in the open sky with clouds", "在教室里": "in a bright classroom with blackboard",
    "在操场上": "on a school playground", "在怀里": "warm hug in mom's arms",

    "唱歌": "singing happily with music notes", "睡觉": "sleeping peacefully with zzZ",
    "飞翔": "flying with open wings", "打滚": "rolling and tumbling playfully",
    "游泳": "swimming happily in water", "喝水": "drinking water from a cup",
    "吹泡泡": "blowing soap bubbles", "晒太阳": "sunbathing under warm sunshine",
    "采蜜": "collecting honey from flowers", "跳舞": "dancing happily",
    "吃萝卜": "eating a big orange carrot", "荡秋千": "swinging on a swing",
    "讲故事": "telling a story with an open storybook", "喝茶": "drinking hot tea from a cup",
    "画画": "painting a picture with brushes and palette", "走路": "walking happily",
    "做饭": "cooking with a pot and pan", "买菜": "buying fresh vegetables at the market",
    "捉虫": "catching a little worm", "跑步": "running fast and happily",
    "奔跑": "galloping and running free", "吃草": "eating green grass",
    "眨眼": "twinkling and winking cutely", "捉迷藏": "playing hide and seek",
    "打球": "playing with a ball", "放风筝": "flying a colorful kite in the sky",
    "看书": "reading an open book", "飘落": "gently floating and falling down",
    "做操": "doing morning exercise stretches", "读书": "reading a book carefully",
}


def gen(word, prompt, seed):
    q = urllib.parse.quote(prompt + ", " + STYLE)
    url = "https://%s/prompt/%s?width=512&height=600&nologo=true&seed=%d&model=flux" % (
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
    img = img.crop((0, 0, w, int(h * 0.90)))       # 裁掉底部水印条
    img = img.resize((512, 512), Image.LANCZOS)
    # 文件名＝词语（Windows 文件名合法）
    safe = word.replace("，", "")
    img.save(os.path.join(OUT, safe + ".jpg"), "JPEG", quality=86)


words = list(PROMPTS.keys())
only = [a for a in __import__("sys").argv[1:]] if len(__import__("sys").argv) > 1 else None
ok = 0
for i, word in enumerate(words):
    if only and word not in only:
        continue
    path = os.path.join(OUT, word + ".jpg")
    if os.path.exists(path) and os.path.getsize(path) > 15000:
        ok += 1
        continue
    done = False
    for attempt in range(6):
        try:
            gen(word, PROMPTS[word], 2000 + i * 11 + attempt * 17)
            print("ok", word, flush=True); ok += 1; done = True
            break
        except Exception as e:
            print("fail", word, attempt + 1, e, flush=True)
            time.sleep(8)
    if not done:
        print("FAILED", word, flush=True)
    time.sleep(6)          # 匿名档限流：拉长间隔避免 429
print("done", ok, "/", len(words), flush=True)
