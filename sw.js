/* ============================================================
   Service Worker · sw.js（PWA 离线支持）
   ------------------------------------------------------------
   缓存策略（任务书 §2.4）：
   · 安装期：只预缓存核心页面与代码（HTML/CSS/JS/图标），清单可控
   · 运行期：
     - 笔顺数据 assets/hanzi-data/（9575 个文件）→ 绝不全量预缓存，
       按「访问哪个字缓存哪个字」的 cache-first 策略惰性填充
     - 吉祥物视频 assets/planets/（约 1.7MB，v18 已重编码）→ 同样按需缓存，不进预缓存
     - 其余同源 GET → cache-first + 后台更新（避免"永远拿到旧版本"：
       任一代码文件变更时由版本号 VER 触发旧缓存整体清理）
   · 跨域请求（127.0.0.1:7860 的 TTS/LLM）→ 不拦截，直接放行网络
   ============================================================ */
const VER = 'hh-v21';  /* v21 收尾：一键全量回归入口、静态一致性检查、闯关新玩法（连读辨调+限时挑战）、词语乐园常识配词、拼音录音包开关（详见 项目说明书.md §16） */
const CORE = [
  'index.html', 'home.html', 'ditu.html', 'pinyin.html', 'shengzi.html',
  'langdu.html', 'jushi.html', 'jiangli.html', 'jiesuan.html',
  'parent.html', 'jiaocai.html',
  'css/base.css', 'css/splash.css', 'css/home.css', 'css/ditu.css',
  'css/pinyin.css', 'css/shengzi.css', 'css/langdu.css', 'css/jushi.css',
  'css/jiangli.css', 'css/jiesuan.css', 'css/parent.css', 'css/voice.css',
  'css/jiaocai.css', 'css/tree-motion.css',
  'js/data.js', 'js/common.js', 'js/tts.js', 'js/report.js', 'js/planner.js',
  'js/planet.js', 'js/voice.js', 'js/audio-db.js', 'js/recorder.js',
  'js/splash.js', 'js/home.js', 'js/ditu.js', 'js/pinyin.js', 'js/shengzi.js',
  'js/langdu.js', 'js/jushi.js', 'js/jiangli.js', 'js/jiesuan.js',
  'js/parent.js', 'js/jiaocai.js',
  'js/tree-motion.js', 'js/tree-motion-data.js',
  /* 注意：pdf.js（1.41MB）与 pinyin-pro（0.32MB）不在预缓存清单里。
     它们只服务低频场景（家长导入 PDF / 拼音标注），且首次使用时会被
     下面「其余静态资源」分支自动收进缓存——放进安装期预缓存会让每个
     用户首访多下 1.7MB（占原预缓存总量的 83%）。 */
  'assets/lib/hanzi-writer.min.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'manifest.json'
];

/* 安装：预缓存核心资源（单个失败不阻塞安装） */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VER).then(cache =>
      Promise.all(CORE.map(u =>
        cache.add(new Request(u, { cache: 'reload' })).catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

/* 激活：清掉旧版本缓存，接管页面 */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;          /* TTS/LLM 服务：放行 */

  const isLazy =
    url.pathname.includes('/assets/hanzi-data/') ||    /* 笔顺数据：按字惰性缓存 */
    url.pathname.includes('/assets/planets/');         /* 吉祥物视频：按需缓存 */

  /* 笔顺/视频：cache-first（命中即离线可用，未命中拉网并入库） */
  if (isLazy) {
    e.respondWith(
      caches.open(VER).then(cache =>
        cache.match(e.request).then(hit =>
          hit ||
          fetch(e.request).then(resp => {
            /* 只缓存完整响应：206（Range 分段）会被 Cache API 直接拒绝，
               而 <video> 播放器必然发 Range 请求，不判断会刷出未捕获的
               TypeError 并可能让视频请求整体失败 */
            if (resp.ok && resp.status === 200) {
              cache.put(e.request, resp.clone()).catch(() => {});
            }
            return resp;
          })
        )
      )
    );
    return;
  }

  /* 页面导航：network-first（保证拿到新版），失败回退缓存（离线可用） */
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok && resp.status === 200) {
          caches.open(VER).then(c => c.put(e.request, resp.clone())).catch(() => {});
        }
        return resp;
      }).catch(() =>
        caches.match(e.request)
          .then(h => h || caches.match('index.html'))
          .then(r => r || new Response('离线可用内容缺失', { status: 503 }))
      )
    );
    return;
  }

  /* 其余同源静态资源：cache-first + 后台更新 */
  e.respondWith(
    caches.open(VER).then(cache =>
      cache.match(e.request).then(hit => {
        const net = fetch(e.request).then(resp => {
          if (resp.ok && resp.status === 200) {
            cache.put(e.request, resp.clone()).catch(() => {});
          }
          return resp;
        }).catch(() => hit);
        /* 必须保证 respondWith 拿到一个真实响应：
           缓存未命中且网络失败时若返回 undefined，该请求会以 TypeError 失败 */
        return hit || net.then(r => r || new Response('', { status: 504 }));
      })
    )
  );
});
