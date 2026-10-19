[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

> **首页 3D 场景由 AI 协作开发。**
> 发射升空、太空巡航、校史展示、拖动环视 / 轻点跳节 / 暂停这些交互，
> 由 **DeepSeek Harness** 搭配 `deepseek-flash` 模型完成；
> 需求、取舍和验收由 [@Thomas455](https://github.com/Thomas455) 把关。

---
# 宇宙奶龙大学.com

# 这里是"宇宙奶龙大学.com"这个域名的代码仓库


打开 `宇宙奶龙大学.com` → 奶龙号发射升空 → 进入太空巡航 → 沿途展示 **广州大学校史** →
点击画面上的「出发」按钮，飞向广州大学星并跳转到 **广州大学**官网（https://www.gzhu.edu.cn/）。

> 首页现在是**纯 3D 场景**（three.js），不再是早期的「文字环 + 5 秒自动跳转」版本。
> 旧的自动跳转已经取消 —— 什么时候走，由用户点按钮决定。

纯静态，没有任何构建步骤和外部依赖。

> **部署平台：Cloudflare Pages**（2026-10 从 GitHub Pages 迁过来的）。
> NS 已经迁到 Cloudflare，域名在 Cloudflare 上是自己的 zone。
> 相关说明见 [第 5 节](#5-部署cloudflare-pages)。

```
index.html                  首页 3D 发射场景（页面上那个「回主页」房子图标去 home.html）
assets/launch.js            首页 3D 场景的全部逻辑与建模（约 2900 行）
assets/three.min.js         three.js r149（本地 vendor，不走 CDN）
assets/textures.js          内联成 data URI 的贴图（见第 2 节说明）
tools/build-textures.py     重新生成 textures.js
home.html                   校园门户：四张卡片（展览馆 / 公告 / 两个占位）
show.html                   奶龙展览馆：25 个学院展位，点卡片翻转看作品
notice.html                 网站公告：读 notice/ 里的 txt
404.html                    页面走丢时显示（用绝对路径，见下面说明）
assets/site.css             三个子页面共用的样式（深色主题 + 流动背景）
assets/site.js              共用脚本（插背景层、返回按钮、百度统计）
assets/works.js             读学院作品列表（list.txt + 数字命名两种来源）
assets/gallery.js           卡片翻转 / 作品灯箱
src/                        学院展位封面图（.webp，文件名 = 学院名）
works/                      学院作品（一个学院一个目录，含投稿指南.md）
notice/                     公告源文件（1.txt、2.txt……）
core.webp / core.png        奶龙本体：页面用 webp，png 是无损原件
assets/launch.js            首页 3D 场景的逻辑与建模（约 2900 行）
assets/three.min.js         three.js r149（本地 vendor，不走 CDN）
assets/textures.js          内联成 data URI 的贴图（见第 2.3 节）
tools/build-textures.py     core.webp + 校徽 → assets/textures.js
favicon.ico                 浏览器页签图标（16/32/48，由 favicon.png 派生）
favicon.png                 iOS / 安卓主屏图标（512×512，手工维护的源文件）
og.png                      微信、QQ、Twitter 分享卡片图（1200×630）
CNAME                       GitHub Pages 时代的域名绑定文件，现在没用（留着无害）
双手交叉站立.png            奶龙原始素材
1.txt                       首页顶部随机语录的源文件（一行一句）
tools/prepare_nailong.py    抠图 → core.png / core.webp
tools/build_assets.py       分享卡片 → tools/og.html（文字环已随 3D 改版废弃）
tools/build_favicon.py      favicon.png → favicon.ico（只读 png，不改它）
tools/build_works_list.py   扫描 works/ 生成 list.txt（能列目录、读修改时间）
tools/og.html               分享卡片的排版源文件
tools/preview-core.png      抠图效果的白底预览
```

> 首页现在不用 `ring.svg` 了 —— 文字环随 3D 改版一起撤掉，该文件已于 2026-10 删除。
> 留着只是还没删。

重新生成图片资源（改图之后跑）：

```powershell
python tools/prepare_nailong.py    # 从原始素材重新抠图 → core.png / core.webp
python tools/build_assets.py       # 重新生成 og.html 排版
python tools/build_favicon.py      # 从 favicon.png 派生 favicon.ico
python tools/build-textures.py     # 牛奶龙 + 校徽内联进 assets/textures.js
```

⚠️ **`prepare_nailong.py` 会重写 `core.png` / `core.webp` / `favicon.png`。**
如果你手工改过 `favicon.png`，别跑第一条（或者跑完再改回来）。

本地已经是一个初始化好的 git 仓库（分支 `main`），推送即可发布：

```powershell
git push
```

---

## 0. 性能：首页现在要加载什么

> 这一节原来讲的是「为什么首屏只有 2 个请求」—— 那是**文字环时代的优化**：
> 内联 ring.svg、精简注释、把首屏压到 html + core.webp 两个文件。
> 首页换成 three.js 场景之后，那套数字全部作废，这里重写。

### 首页的请求

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `index.html` | ~30 KB | 页面骨架 + HUD + sr-only 正文 |
| `assets/three.min.js` | 608 KB | three.js r149，**本地 vendor** |
| `assets/launch.js` | ~95 KB | 场景逻辑与全部建模 |
| `assets/textures.js` | 124 KB | 内联的贴图（data URI） |

### 为什么 three.js 不走 CDN

试过 jsdelivr（能用）和 unpkg（国内经常超时）。问题不在大小，
在于**这个站面向国内访问**，而 CDN 在中国大陆的可用性不稳定 ——
首页是整站的入口，一个 600KB 的脚本加载失败就是白屏。
本地 vendor 让首页不依赖任何第三方域名。

### 为什么贴图反而内联了

和「不该内联」的直觉相反，这里必须内联：浏览器的 `file://` 跨源保护
不允许 WebGL 使用来自 `file://` 的图片作纹理。**双击打开 index.html 时
奶龙和校徽会是空白**，而程序画的「奶龙号」三个字正常 —— 很容易误判成模型问题。
详见第 2.3 节。

### 首帧为什么需要预热

three.js 的材质是「第一次渲染时才编译着色器」。实测（无头环境）
第一帧 2.4 秒、第二帧 5.6 秒 —— 每上一批新对象就再编译一次。

所以启动时先跑几帧「只渲染、不推进动画」的预热，直到某一帧耗时
低于 120ms 才开始计时，配合 `renderer.compile()` 和 `#boot` 遮罩，
用户看到的是「奶龙号正在点火…」而不是黑屏。

> ⚠️ 这里有个踩过的坑：早期用 `now - t0` 当动画进度，
> 这几秒编译时间被算了进去，一开场就跳到「升空完成」——
> 倒计时、校史、按钮全部错位。现在动画时钟按**被限制的帧间隔**累加
> （单帧封顶 100ms），卡顿只会让动画慢一点，不会把进度甩出去。

## 1. 本地先看效果

**方式一：直接双击 `index.html`** —— 能跑，但**奶龙和校徽会显示不出来**。这是浏览器的 `file://` 跨源保护，不是代码问题（详见第 2.3 节）

**方式二：起个本地服务** —— 推荐。和线上环境一致，贴图也能正常显示

```powershell
python -m http.server 8801 --directory .
```

* 打开后点「出发」才会跳转到广州大学，不点就一直停在太空里
* <http://127.0.0.1:8801/index.html> —— 点「出发」后才跳转，不再自动离开
* <http://127.0.0.1:8801/home.html> —— 校园门户（四张卡片）
* <http://127.0.0.1:8801/show.html> —— 奶龙展览馆（25 个学院）
* <http://127.0.0.1:8801/notice.html> —— 网站公告

> 页面里所有资源都写成**相对路径**（`core.webp`，而不是 `/core.webp`），所以三种打开方式都正常：
> 双击本地打开（`file://`）、部署在域名根目录、部署在子目录（如 `example.com/nailong/`）。
> ⚠️ 别改回 `/core.webp` 这种根路径：双击打开时它会去找 `D:\core.webp`，页面上图片会全变成碎图标。
>
> ⚠️ **`show.html` 和 `notice.html` 必须用 http 方式预览**（方式二）。
> 它们靠 `fetch` 读 `src/` 和 `notice/` 里的文件，而浏览器禁止 `file://` 下的
> fetch（CORS 限制）。双击打开时这两个页面会显示「图片待补充」和空公告 —— 这是浏览器的
> 安全策略，不是坏了。`index.html` / `home.html` 没有这个问题。

## 2. 首页 3D 场景（重点）

首页是 `index.html` + `assets/launch.js` 的 three.js 场景，**没有构建步骤**，
所有几何体都是代码里程序化生成的，贴图全部用 Canvas 现画。

### 2.1 时间线

全部集中在 `launch.js` 顶部的 `T` 常量里：

| 常量 | 默认值 | 含义 |
| --- | --- | --- |
| `T.PRE` | 2000ms | 待机 + 点火倒计时（2 秒后升空） |
| `T.ASCEND` | 7000ms | 升空到大气层外 |
| `T.PITCH` | 4500ms | 太空里由「直飞」转为「平飞」的转向 |
| `T.HISTORY_GAP` | 3800ms | 每一节校史停留多久 |
| `T.GLIDE` | 4600ms | 点按钮后冲向星球的时长 |

校史从 `T.PRE + T.ASCEND + 600` 开始；
「出发」按钮分两步出现 —— 升空一完成就在右下角露出一颗小胶囊（想快点走的人
立刻可以点），八节校史讲完之后才飞到屏幕正中。

### 2.2 交互

| 操作 | 效果 |
| --- | --- |
| 拖动画面 | 绕箭体环视（左右各 68°、上下 -20°~+46°，松手 3.2 秒后缓慢回正） |
| 轻点画面 | 跳到下一节校史（位移 < 10px 且 < 350ms 才算轻点，不会和拖动冲突） |
| 空格 | 暂停 / 继续 |
| 「出发」按钮 | 飞向广州大学星并跳转 |

### 2.2.1 两类文字

| | 主线校史 | 飞跃短句 |
| --- | --- | --- |
| 数量 | 8 条（`HISTORY`） | 76 条（`FLY_FACTS`） |
| 呈现 | 画面左侧的大卡片，3D 精灵 | 从身边掠过的小字，透明度 0.26~0.46 |
| 时间 | 每 3.8 秒换一条 | 回收时按当前主线节点取 |

飞跃短句每条带一个桶号 `b`（对应 `HISTORY` 的下标），回收时先看
`state.historyIdx` 是几，就从那一桶里取 —— 保证「讲哪个年代就飘哪个年代的句子」。
主线换节时还会把 125 单位外、基本看不清的那些重画成新桶的句子。

> **防误触**：校史还没开始之前点屏幕不会受理；每次快进后有 800ms 冷却。
> 这两道闸是为了修「升空过程中点一下、升空结束后莫名快进一次」的 bug。

### 2.3 一个必须知道的坑：file:// 打不开贴图

浏览器对 `file://` 页面有跨源保护 —— **WebGL 不允许使用来自 `file://` 的图片作纹理**，
也不允许把 `file://` 的图画进 canvas 再取出。直接双击 `index.html` 打开时，
奶龙舷窗和广州大学校徽都是空白，而程序画的「奶龙号」三个字却正常 ——
很容易误判成模型问题。

所以两张图被内联成 data URI 存进 `assets/textures.js`（124KB）。
改图之后重新生成：

```bash
python tools/build-textures.py
```

```bash
# 本地预览（推荐，和线上环境一致）
python -m http.server 8790
# 然后打开 http://127.0.0.1:8790/
```

### 2.4 性能

* 首帧要编译全部着色器，所以启动时会先跑几帧「只渲染不推进动画」的预热，
  再用 `renderer.compile()` 预编译，配合 `#boot` 遮罩，避免用户看到黑屏；
* 动画时钟按**被限制的帧间隔**累加（单帧封顶 100ms），卡顿只会让动画慢一点，
  不会把进度甩出去；
* 移动端按「屏幕宽度 + 触屏 + 核心数」分档，粒子数和像素比都会降级。

### 2.5 跳转

点「出发」后 → 扑向星球（`T.GLIDE`）→ 白场遮罩 → `location.replace('https://www.gzhu.edu.cn/')`。
用 `replace` 而不是 `href`，跳过去之后按浏览器后退不会又弹回这一页。

### 2.5.1 降级页

3D 起不来的时候不能给用户看黑屏，所以有一个静态降级页。
命中下面任意一条就会给 `<body>` 加 `no-3d` 类，CSS 立刻切过去：

| 触发条件 | 位置 |
| --- | --- |
| `three.min.js` 没加载（被网络拦截、插件拦了） | `launch.js` 开头的 `if (!window.THREE)` |
| 浏览器创建 WebGL 渲染器失败（老设备、关了硬件加速） | `new THREE.WebGLRenderer` 的 catch |
| **运行中 WebGL 上下文丢失**（切后台回来、显存不足） | `webglcontextlost` 监听 |
| 脚本执行到一半抛异常，`NailongLaunch` 没挂上 | `index.html` 的内联检查 |

切过去之后：隐藏 canvas / HUD / 倒计时 / 出发按钮，显示：

* 一句说明 + 「立即前往广州大学」按钮；
* **8 条校史正文**（和 3D 场景里展示的一致）；
* 资料来源标注。

> 校史正文是后补的。原来降级页只有一句话 + 一个链接，3D 一挂就等于把
> 8 条校史全丢了 —— 而那正是这页最有价值的内容。

### 2.5.2 无障碍

| 做了什么 | 为什么 |
| --- | --- |
| `.skip-link`「跳过动画，直接前往广州大学」 | 出发按钮要等升空完成（9.3 秒）才出现，键盘用户不该干等；Tab 聚焦时滑入 |
| `#hist-live`（`aria-live="polite"`） | 校史画在 canvas 上，读屏完全读不到；每换一节播报「校史第 N 节，共 8 节：年份　标题」 |
| `#hint` 加 `role="status"` | 状态文案变化（正在飞往 → 已抵达）会被播报 |
| 方向键 ← → | 和翻页按钮等价，键盘用户不用去猜屏幕能点 |
> **移动端缩放**：整页禁用了双击放大 ——
> `html/body` 用 `touch-action: manipulation`（去掉双击缩放和 300ms 点击延迟，
> 保留捏合），画布另外是 `touch-action: none`（拖动环视要用）。
> 部分老 WebView 和 iOS 不认 `touch-action`，所以 viewport 里还有
> `maximum-scale=1, user-scalable=no` 兜底 —— 代价是双指捏合也一起禁掉了。
> 这一页是 3D 演示不是长文阅读，权衡后接受；要恢复捏合，删掉那两段即可。

| `.sr-only` 正文 | 首页内容全在 canvas 里，搜索引擎和读屏都抓不到；用 clip 方式视觉隐藏一份真文本 |

> ⚠️ 已知遗留：`index.html` 里有一个 `var reduce`（检测 `prefers-reduced-motion`）
> 声明了但没被使用，注释里却写着「开了减少动态效果也算降级」。
> 也就是说**注释和代码不一致** —— 真开了减少动态效果的用户仍会进入完整动画。

### 2.5.3 域名护栏

`index.html` 的 `<head>` 里有一段很小的内联脚本：**如果访问用的域名不是本站
或其子域，就 `location.replace` 跳回 `xn--psszg58cydsdq780c.com`**。
作用是防止整站被镜像/盗链到别的域名上。

三种情况**故意不生效**：

| 情况 | 为什么放行 |
| --- | --- |
| `file://` 直接双击打开 | `location.protocol` 是 `file:`，本来就没有域名 |
| IP 直连（`127.0.0.1`、`192.168.x.x`、`[::1]`） | 局域网调试、直接用服务器 IP 访问 |
| `localhost` / `*.localhost` | 本地起 `http.server` 预览 |

判断放在 `<head>` 里是为了**尽早执行** —— 命中时后面的 3D 脚本根本不会跑，
用户不会先看到一闪而过的画面。跳转保留原路径、查询串和锚点。

> ⚠️ 子域判断必须用「结尾是 `.` + 域名」，不能用 `indexOf`。
> 否则 `xn--psszg58cydsdq780c.com.evil.com` 这种也会被当成自己人放行。

> 改这个脚本时注意：里面用了正则，在 PowerShell 里批量替换很容易被转义坏
> （`\\d` 会变成字面反斜杠 + d）。改完要跑一遍用例。

## 2.6 三个子页面

首页正下方有个**房子图标**（`.home-btn`），点进 `home.html`，那里是校园门户：

| 页面 | 做什么 | 内容从哪来 |
| --- | --- | --- |
| `home.html` | 四张卡片（田字格 2×2）：奶龙展览馆 / 网站公告 / 校园活动（占位）/ 留言板（占位） | 写死在 HTML 里 |
| `show.html` | 25 个学院的展位，竖直卡片；**点卡片翻转放大，看该学院的作品** | `src/学院名.webp`（封面）<br>`works/学院名/`（作品） |
| `notice.html` | 公告列表，**编号大的在上面**（新的在前） | `notice/N.txt` |

三个页面共用 `assets/site.css` 和 `assets/site.js`，所以背景、配色、返回按钮、
**百度统计**完全一致，改一处全变。`index.html` **没有**引用它们 —— 那个页面要最快，
样式全内联，多一个请求都不划算。**两边都改的时候记得手动同步。**

### 展览馆的图片怎么放

放进 `src/`，**WebP 格式**，**文件名必须和学院名一模一样**（含全角括号）：

```
src/经济与统计学院.webp
src/法学院（律师学院）.webp                     ← 全角括号，不是半角 ()
src/管理学院（旅游学院·中法旅游学院）.webp      ← 注意是「·」，不是「/」
```

> ⚠️ 「管理学院（旅游学院/中法旅游学院）」原名里有个**斜杠**，而斜杠在
> Windows / macOS / Linux 上都不能做文件名。所以 `show.html` 里的 `COLLEGES`
> 数组把它拆成了两个字段：`name`（卡片上显示，带斜杠）和 `file`
> （图片文件名，斜杠换成 `·`）。要改这个学院的名字，两个字段一起改。

> **为什么是 WebP 不是 PNG**：PNG 那批（15 张）合计 **30.1 MB**，
> 转成 WebP（quality 88）只有 **2.2 MB** —— 省 93%，画质几乎看不出差别。
> 后来补的 JPG 那批（6 张）本身已压缩，再转省 16%。
> 学院图是照片类内容，特别吃这个压缩。换图时记得也转成 webp，
> 否则 `show.html` 找不到（它写死了读 `.webp`）。

**目前 25 个学院里有 21 个有图**，缺的 4 个是：生命科学学院、计算机科学与网络工程学院、
网络空间安全学院、人工智能学院（这几个会显示首字占位）。完整清单见 `src/README.txt`。

找不到图片时显示学院首字占位，不会出现裂图。（早期版本用 `img.hidden = true`
藏裂图，实测不行 —— 浏览器在脚本执行前就把裂图渲染了，现在改成给父级加 `.miss` 类。）

### 学院的作品怎么放

**在展览馆里点一下学院卡片**，它会翻转、放大铺满页面，露出该学院的作品列表：

* 列表可上下滚动，**鼠标悬停显示文件名**
* 点某件作品 → 全屏放大，**右上角 × 关闭**，**底部显示文件名**
* 列表**右下角「关闭」** → 翻回去，回到最初的展览馆网格

作品放在 `works/学院名/` 下（25 个目录已经建好了，每个里面有个 `.gitkeep`）。
两种命名**混着用**，最终顺序是「先 list.txt 里的，再接数字命名的」：

| 来源 | 怎么用 | 顺序 |
| --- | --- | --- |
| `list.txt`（优先） | 同目录放 `list.txt`，一行一个文件名 | 写在**下面的在上面**（当最新的） |
| 数字命名（补充） | `1.webp`、`2.webp`、`3.webp`…… | 编号**大的在上面** |

两边都有的只显示一次，位置以 `list.txt` 为准。清单里**后缀可写可不写**
（`奶龙打篮球` 会自动当成 `奶龙打篮球.webp`），`#` 开头当注释。

> ⚠️ **既不是数字命名、又没写进 `list.txt` 的文件，页面上看不见。**
> 因为静态站点拿不到目录列表（没有 `readdir`），页面只能靠约定去猜。
> 随手命名的文件（`IMG_2026.jpg`、`未命名-3.webp`…）必须靠 `list.txt` 才能显示 ——
> 下面那个脚本可以自动生成。

#### 自动生成 list.txt

```powershell
python tools/build_works_list.py              # 只处理还没有 list.txt 的目录
python tools/build_works_list.py --force      # 覆盖（旧的存成 list.txt.bak）
python tools/build_works_list.py --dry-run    # 只预览
python tools/build_works_list.py --convert    # 顺手把 jpg/png 转成 webp
```

本地脚本能做到页面做不到的两件事：**列目录** 和 **读文件修改时间**。
所以它按修改时间**从旧到新**写入清单 —— 最新的落在最后一行，页面上就出现在第一个。

> `--force` 覆盖前会把手写的清单备份成 `list.txt.bak`（已在 `.gitignore` 里）。
> 重新扫描时 `.bak` 不会被当成作品。

> **为什么不能自动列目录**：静态站点没有后端，拿不到目录列表。
> 数字探测是并行发的（一批 12 个），所以通常一个往返就够 ——
> 这套思路和 `notice.html` 读公告是同一个，见上面那节。
> `list.txt` 和数字探测是**并行请求**的，所以有没有清单都不会变慢。
>
> 探测用 `HEAD` 请求省流量，但**有些静态托管不支持 HEAD**，那时会退回逐个 `GET`。
> 好在 `works/` 里的图都很小（几十 KB）。

完整说明见 [`works/README.txt`](works/README.txt)。

**别人想投稿（提 PR）？** 让他们看 [`works/投稿指南.md`](works/投稿指南.md) ——
那份是写给投稿者的，更简短，并说明了**为什么优先用 `list.txt` 而不是数字命名**
（多人同时投稿时数字编号会撞号，`list.txt` 只是各自加一行，冲突好解）。

### 公告怎么写

在 `notice/` 里放 `1.txt`、`2.txt`、`3.txt`……，**第一行当标题，其余当正文**。

* 编号**大的显示在上面**（4 在 1 上面）
* 编号可以跳号，脚本容忍中间缺失（一批末尾连续缺 2 个才停）
* 标题以 `[AI] ` 开头 → 卡片右下角自动加「此公告由 AI Agent 编写」
* 正文用 `textContent` 渲染，**公告里写 `<script>` 也不会变成标签**（防注入）

> 静态站点没法「列出目录」，所以只能一个个试。早期版本是**串行**探测，
> 6 个文件 = 6 个往返，GitHub Pages 上（约 0.25s RTT）要白屏 1.5 秒。
> 现在改成**一批 8 个并行**发，通常一个往返就够。

### 左上角的「返回」按钮

子页面左上角那个按钮由 `assets/site.js` 生成，行为由 `<body>` 上的三个属性控制：

| 属性 | 作用 | 谁在用 |
| --- | --- | --- |
| `data-back` | 按钮指向哪 | `home.html` → `index.html`；`show/notice` → `home.html`（默认值） |
| `data-back-label` | 按钮文字 | home 是「返回首页」，其余是「返回」 |
| `data-back-force` | **跳过 `history.back()`，永远走 `href`** | 只有 `home.html` 用 |
| `data-no-back` | 索性不生成按钮 | 只有 `404.html` 用（它自己放了两个按钮） |

**为什么 `home.html` 需要 `data-back-force`：**

默认逻辑是「站内跳过来的就 `history.back()`，保留你原来的滚动位置」。
但 `home.html` 的按钮写的是**「返回首页」** —— 从 `show.html` 点进来时，
`history.back()` 会把你退回 `show.html`，**和按钮上写的去向对不上**。
用户点「返回首页」就该到首页，不管上一页是什么。

实测对照（同样从 `show.html` 进入，`history.length = 2`、referrer 同源）：

| | 点击后 |
| --- | --- |
| 不加 `data-back-force` | 退回 `show.html` ← 和按钮文字不符 |
| 加了 `data-back-force` | 去 `index.html` ✓ |

### 404 页面

`404.html` 会在访问不存在的路径时显示（Cloudflare Pages 自动识别根目录下的这个文件名，
不用额外配置）。

**⚠️ 它是全站唯一用绝对路径（`/assets/site.css`）的页面，这不是笔误：**

Cloudflare 在**任何路径深度**都会返回 `404.html`，但地址栏还是原来那个坏路径
（比如 `/foo/bar`）。这时如果写相对路径 `assets/site.css`，浏览器会去要
`/foo/assets/site.css` —— 那份同样不存在，结果是**页面有 HTML 但没样式**，
变成一张白板。站点挂在 apex 域名根目录，所以 `/assets/...` 一定指得到。

> 代价：**双击本地打开这个文件时样式会加载失败**（`file://` 下 `/assets/` 会指向磁盘根目录）。
> 全站只有这一个页面不能用 `file://` 预览，改完想看效果就起本地服务。
>
> 页面用 `data-no-back` 让 `assets/site.js` 跳过「返回」按钮的注入 ——
> 它自己放了「回首页」和「奶龙主页」两个按钮，再来个固定左上角的会打架。

## 3. 想要改的地方

| 想改什么 | 改哪里 |
| --- | --- |
| 跳转目标 | `index.html` 里 `const TARGET = 'https://www.gzhu.edu.cn/';` |
| 文案里的校名 | `const NAME = '广州大学';` |
| 发射/巡航/跳转时长 | `assets/launch.js` 顶部的 `T` 常量（`PRE` / `ASCEND` / `PITCH` / `GLIDE`） |
| 配色 | `index.html` 顶部 `:root` 里的 CSS 变量（子页面在 `assets/site.css`） |
| 首页顶部语录 | 改 `1.txt`，一行一句 |
| 学院名单/顺序 | `show.html` 里的 `COLLEGES` 数组 |
| 学院作品 | 图片丢进 `works/学院名/`，跑 `tools/build_works_list.py` 生成清单 |
| 404 文案 | `404.html` 里那两句（`.code` 是那个大号 404） |
| 公告内容 | `notice/` 里加 txt |
| 校史节点 | `assets/launch.js` 里的 `HISTORY` 数组（8 条，含 2027 终章） |
| 飞跃短句 | `assets/launch.js` 里的 `FLY_FACTS`（76 条，带桶号 `b`，见第 2.2 节） |
| 校史配色 | `assets/launch.js` 里的 `ERA_TONES`（按年代分冷暖） |
| 奶龙的样子 | 换掉 `双手交叉站立.png`，重跑 `tools/prepare_nailong.py` |
| 抠图边缘 | `tools/prepare_nailong.py` 里的 `S_LO` / `S_HI` 阈值，配合 `tools/preview-core.png` 调 |
| 分享卡片 | `tools/build_assets.py` → `build_og_html()`，重跑后用 Edge 无头截图 |
| 百度统计的站点 ID | `index.html` 里 `hm.src` 那一行的 `?` 后面 |
| 统计兜底等待时长 | `index.html` 里的 `const BUDGET = 1200;`（调 0 等于不等待） |

重新生成图形：

```powershell
python tools/prepare_nailong.py    # 奶龙抠图 → core.* / favicon.*
python tools/build_assets.py       # 分享卡片 → tools/og.html
python tools/build-textures.py     # 奶龙 + 校徽内联进 assets/textures.js
```

`og.png` 是用 Edge 无头模式把 `tools/og.html` 截出来的：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 `
  --window-size=1200,630 --screenshot="og.png" "file:///<绝对路径>/tools/og.html"
```

## 4. 百度统计

已经接好了，用的是**百度统计给本站单独开的站点 ID**（和 `Thomas455.github.io` 是两个独立站点，数据不混）：

```
c6a7e5d19abc2b50696c43f0cbf78d4b
```

在百度统计后台选这个站点，就能看到独立的报告。

### 四个页面都有

百度统计按**域名**建站点，所以四个页面挂的是**同一个站点 ID**，不需要新建站点：

| 页面 | 统计代码在哪 |
| --- | --- |
| `index.html` | 内联在 `<head>` 里（抢时间，见下） |
| `home.html` / `show.html` / `notice.html` | `assets/site.js` 里（一处改，三个页面全生效） |

子页面还顺手推了一个事件，后台「事件」里能直接看出访问的是哪个页面：

```js
_hmt.push(['_trackEvent', 'page', 'view', location.pathname.replace(/^\//, '')]);
```

> 子页面**没有** `dns-prefetch` / `preconnect` 那两道预热 —— 它们不跳转，
> 统计脚本晚几十毫秒无所谓，没必要占首屏。`index.html` 才需要抢时间（见下）。

### 代码在哪

在 `<head>` 里（不是页尾）—— 这点很关键，原因见下。用的是百度官方的那段 loader，只加了两处：

```html
<link rel="dns-prefetch" href="//hm.baidu.com">
<link rel="preconnect" href="https://hm.baidu.com" crossorigin>
<script>
  var _hmt = window._hmt = window._hmt || [];
  window.__analytics = { ready: false, failed: false, start: Date.now() };
  (function () {
    var hm = document.createElement('script');
    hm.src = 'https://hm.baidu.com/hm.js?c6a7e5d19abc2b50696c43f0cbf78d4b';
    hm.async = true;
    hm.onload  = function () { window.__analytics.ready  = true; };
    hm.onerror = function () { window.__analytics.failed = true; };
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(hm, s);
  })();
</script>
```

### 为什么要这么麻烦：本页只活 3 秒

普通网页统计随便放哪都行，但这个页面 **3 秒后就 `location.replace` 跳走了**。
而 `hm.js` 走外网，实测要 **0.4 ~ 1.2 秒**才加载完（教育网实测 TTFB 约 0.4s，首次更慢）。

如果用户一进页面就点掉，跳转会在 **0.7 秒左右**发生 —— 那时候脚本还没加载完，
`location.replace` 一执行，这次访问就被掐断了，**统计直接丢**。

所以做了两件事：

1. **`<head>` 里尽早加载** + `preconnect` 提前建好连接，把加载时间压到最短；
2. **跳转前兜底等待**（`redirect()` 里那段）：

```js
const BUDGET = 1200;   // 保证「打开到跳转」至少经过 1200ms
```

* 老老实实等用户看完整个场景（40 秒以上）→ 早就超过预算，**一秒都不多等**，用户完全无感；
* 提前点击跳过的 → 最多补等几百毫秒，把这次访问救回来；
* 被广告拦截插件挡掉（`onerror`）→ **一秒都不等**，绝不为了统计拖累用户。

### 顺手记了一个事件

跳转时会发一个 `_trackEvent`，在后台「事件分析」里能看到：

| 事件类别 | 动作 | 含义 |
| --- | --- | --- |
| `redirect` | `auto` | 用户等完动画自动跳走 |
| `redirect` | `skip` | 用户等不及点掉的 |

`skip` 占比高说明动画太长了 —— 现在用户可以轻点跳过、也能直接点「出发」，
这个指标已经不太能反映「动画太长」了，更多是看用户在第几节按的跳过。

### 怎么验证

1. 部署后打开 `https://宇宙奶龙大学.com/`，等它跳走；
2. 去百度统计后台 → **实时访客**，几秒内应该能看到这次访问；
3. 手机流量下再试一次，能区分统计的是不是只有你自己的网络。

### 中文域名怎么填？（百度统计的域名框只收英文/数字）

**直接在域名框里填 punycode 形式就行，这就是中文域名本身，不是替代品：**

```
xn--psszg58cydsdq780c.com
```

`宇宙奶龙大学.com` 和 `xn--psszg58cydsdq780c.com` 是**同一个域名的两种写法** ——
就像 `中` 在 URL 里写成 `%E4%B8%AD` 一样，punycode 只是非 ASCII 域名的 ASCII 表示法。

浏览器从底层就只认 punycode：按 WHATWG URL 规范，`location.hostname` 返回的永远是转换后的形式。
实测（Node 与浏览器同一套 URL 实现）：

```
new URL('https://宇宙奶龙大学.com/').hostname    →  'xn--psszg58cydsdq780c.com'
new URL('https://www.宇宙奶龙大学.com/').hostname →  'www.xn--psszg58cydsdq780c.com'
```

所以百度统计那个框**只收 ASCII 并不是限制** —— 它要的就是真实域名，只不过真实域名在 DNS
和浏览器里本来就是 `xn--` 开头这串。

> 想验证就用 Python 自己转（IDNA 编码，和浏览器完全一致）：
> ```python
> >>> '宇宙奶龙大学.com'.encode('idna').decode()
> 'xn--psszg58cydsdq780c.com'
> ```
> 反过来也能还原：`'xn--psszg58cydsdq780c.com'.encode().decode('idna')` → `宇宙奶龙大学.com`
>
> ⚠️ 别用 `'宇宙奶龙大学.com'.encode('punycode')` —— 那是「纯 punycode 算法」，会把整个字符串
> 连 `.com` 一起编码成 `.com-fw6gxp65iqhwf5670e`，不是域名。要用 **idna**。

### 站点 ID 换过了

一开始图省事复用了 `Thomas455.github.io` 的 ID，后来换成了百度统计给本站单独开的站点：

| | 站点 ID |
| --- | --- |
| 现在用（本站专用） | `c6a7e5d19abc2b50696c43f0cbf78d4b` |
| 旧（博客那个，已不用） | `b27042a7b1bc987eb347a45797bd2c1f` |

两者数据互相独立。要改回合并统计，把 `index.html` 里 `hm.src` 的问号后面换成对应 ID 即可
（停在页面上不点「出发」，统计也会照常上报，方便验证）。

### 注意事项

* **广告拦截插件会挡 `hm.baidu.com`**，被挡的访问统计不到，这是所有前端统计的通病，不用管；
* GitHub Pages / Cloudflare Pages 上都不用额外配置，统计脚本照常工作；
* 统计脚本是 `async` 的，**不影响页面渲染和动画**，最坏情况就是不统计。

## 5. 部署：Cloudflare Pages

**本站现在就跑在 Cloudflare Pages 上**（2026-10 从 GitHub Pages 迁过来的），
**不需要 ICP 备案**（节点在境外），免费额度对这么一个小页面完全用不完。

### 现状

| 项 | 值 |
| --- | --- |
| 托管 | Cloudflare Pages |
| NS | 已迁到 Cloudflare（所以 `宇宙奶龙大学.com` 是 Cloudflare 上的一个 zone） |
| 根域名 | `xn--psszg58cydsdq780c.com`（punycode） |
| 构建命令 | **留空**（纯静态，没有构建步骤） |
| 输出目录 | `/` |
| HTTPS | Cloudflare 自动签发，不用管 |
| 首字节 | 约 0.13s（GitHub Pages 时代是 0.49s） |

> 迁 NS 之前已经在 Cloudflare 里把原有解析记录补齐（或让它自动扫描导入），
> 否则邮件等其它服务会断。

### 日常发布

推上去就会自动重新部署，**一般 1 分钟内生效**：

```powershell
git push
```

Cloudflare 后台 → Workers & Pages → 选项目 → Deployments 能看到部署历史和状态。

### 为什么换（当时的取舍）

| | GitHub Pages | Cloudflare Pages |
| --- | --- | --- |
| 根域名（apex） | ✅ 2 条 A 记录就行（DNSPod 免费版限 2 条） | 需要把 NS 迁到 Cloudflare |
| HTTPS | ✅ 自动，要手动开 Enforce HTTPS | ✅ 自动 |
| 部署方式 | git push | git push |
| 国内访问 | 一般（可能被墙/很慢），实测 0.49s | 较好，实测 0.13s |

> **Cloudflare Pages 的根域名**（`宇宙奶龙大学.com` 本身）要求这个域名是 Cloudflare 上的一个 zone，
> 也就是要把 NS 从 DNSPod 改成 Cloudflare 的。Cloudflare 官方文档原文：
> *"To use a custom apex domain with your Pages project, configure your nameservers to point to Cloudflare's nameservers."*
> 本站已经迁过了，所以这一步不用再做。

### 当初的迁移步骤（存档，已执行完）

1. **迁 NS**：Cloudflare 控制台 → Add a site → 填 `宇宙奶龙大学.com` → 选 Free 计划 → 它会给你两个 NS（形如 `xxx.ns.cloudflare.com`）。
   去 DNSPod 把域名的 NS 改成这两个（腾讯云域名控制台 → 域名 → DNS 修改）。等生效，一般几分钟到几小时。
   ⚠️ 迁 NS 前先在 Cloudflare 里把原有解析记录补齐（或让它自动扫描导入），否则邮件等其它服务会断。
2. **建 Pages 项目**：Workers & Pages → Create → Pages → Connect to Git → 选仓库。
   构建命令**留空**，输出目录填 `/`（纯静态，没有构建步骤）。
3. **绑域名**：项目 → Custom domains → Set up a domain → 填 `xn--psszg58cydsdq780c.com`（punycode；因为已经是 Cloudflare 的 zone，CNAME 会自动创建）。
   顺手把 `www` 也加上，或者在 Rules → Redirect Rules 里把 `www` 302 到根域名。
4. HTTPS 证书自动签发，不用管。国内访问如果遇到慢/被墙，可以在 DNS 里换优选 IP（进阶玩法，非必需）。

### 备选：GitHub Pages（不用迁 NS）

万一以后想换回去，或者想拿它当备用托管 —— 仓库里的 `CNAME` 文件当时就是为它准备的
（内容是 `xn--psszg58cydsdq780c.com`，punycode 写法）。现在这个文件**留着无害**，
Cloudflare 会把它当普通文件发布，不影响任何东西。

<details>
<summary>点开看 GitHub Pages 的配置步骤（当前不用）</summary>

1. **建仓库**：GitHub 上新建一个 **public** 仓库（免费账号的 Pages 只支持公开仓库），比如 `nailong-university`。
2. **推代码**：本地已经初始化好 git 仓库并提交了（分支 `main`），只要加个远程地址推上去：

   ```powershell
   git remote add origin https://github.com/<你的用户名>/nailong-university.git
   git push -u origin main
   ```
3. **开 Pages**：仓库 → Settings → Pages → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/ (root)` → Save。
4. **绑域名**：同页面 Custom domain 填 `xn--psszg58cydsdq780c.com`（punycode 写法，GitHub 要求国际化域名用它）。
   仓库里的 `CNAME` 文件我已经放好了，内容就是这个 punycode 域名 —— 注意别手工改成中文，
   GitHub 每次部署都会按这个文件校正域名，中文字符在有些环节会出问题。
5. **加解析**（DNSPod，NS 不用动）：

   ⚠️ **DNSPod 免费版对「同一主机记录 + 同一记录类型」最多只能加 2 条**，而 GitHub 官方给了 4 个 IP。
   **不用纠结，随便挑 2 个就行** —— 这 4 个 IP 是同一个 CDN 集群的冗余入口，内容完全一样
   （实测 4 个 IP 返回的 `pages.github.com` 字节数分毫不差，都是 14446）：

   | 主机记录 | 类型 | 记录值 |
   | --- | --- | --- |
   | `@` | A | `185.199.109.153` |
   | `@` | A | `185.199.108.153` |
   | `www` | CNAME | `<你的用户名>.github.io` |

   （`www` 那条 CNAME 让 `www` 自动 302 到根域名。4 个 IP 实测延迟 0.69~0.82s，差异在噪声范围内，挑最快的两个即可。）
6. **HTTPS**：回到 Settings → Pages，等证书签发完（一般几分钟，最多 24 小时），勾上 **Enforce HTTPS**。

> **关于 IPv6**：GitHub 官方还提供了 4 个 AAAA 记录，但**建议先别加**。
> 实测你这台机器虽然分到了公网 IPv6（教育网 `2001:da8:` 开头），但连 GitHub 的 `2606:50c0:8000::153` 直接超时
> —— 加了 AAAA 反而会让支持 IPv6 的访客优先走不通的路，白等十几秒才回落到 IPv4。等你确认能连通再加不迟。

> **如果一定要用满 4 个 IP**，有两条路（都不必）：
> ① 把 NS 迁到 Cloudflare，那边没有这种条数限制（顺带还能用 Cloudflare Pages）；
> ② 升级 DNSPod 付费套餐。对这么个小站来说，2 条 A 记录已经完全够用了。

</details>

### 其它托管方案（都没在用，仅存档）

<details>
<summary>方案 C：腾讯云 COS + CDN（国内节点要备案）</summary>

1. **实名认证**：域名先完成实名认证，否则 DNSPod 不给解析。
2. **建桶**：对象存储 COS → 创建存储桶，地域选就近（如 `ap-guangzhou`），权限选「公有读私有写」。
3. **传文件**：把 `index.html`、`core.webp`、`core.png`、`favicon.ico`、`favicon.png`、`og.png`，以及 `assets/` 整个目录（`three.min.js` / `launch.js` / `textures.js` / `site.css` / `site.js` / `works.js` / `gallery.js` / 校徽图）**传上去**（`tools/` 和奶龙原图不用传）。
4. **开静态网站**：桶 → 基础配置 → 静态网站 → 开启，索引文档 `index.html`，**错误文档也填 `index.html`**（这样访问不存在的路径也会回到这一页）。
   ⚠️ 但要注意：页面用的是相对路径，所以访问 `域名/a/b` 这种深层路径时，页面能出来、图片会找不到（它会去找 `/a/core.webp`）。
   想彻底干净，就在 CDN 里加一条重定向规则：**路径不含扩展名 → 302 到 `/`**。平时只访问根域名的话可以不管。
5. **绑自定义域名**：桶 → 域名管理 → 添加自定义 CDN 加速域名，加速域名填 `xn--psszg58cydsdq780c.com`（= 宇宙奶龙大学.com），源站类型「默认源站」。
6. **上 HTTPS**：腾讯云 SSL 证书 → 申请免费 DV 证书（DNS 验证，DNSPod 可一键添加验证记录）→ 在 CDN 域名里部署证书 → 打开「强制 HTTPS」。
7. **加解析**：DNSPod 里给 `@` 加一条 **CNAME**，记录值填第 5 步给出的 CNAME 域名。
   （`@` 的 CNAME 和 MX 记录会冲突；DNSPod 的免费版支持根域名 CNAME，但部分解析商会拒绝。）
8. **设缓存**：CDN → 缓存配置里给 `index.html` 设「不缓存」或很短，图片设 7 天，避免改完文案看不到效果。

> 静态网站里中文域名会自动按 punycode（`xn--psszg58cydsdq780c.com`）填写，控制台里显示成中文是正常的。

</details>

<details>
<summary>方案 D：轻量应用服务器 / CVM + Nginx</summary>

```nginx
# HTTP 全量跳 HTTPS
server {
  listen 80;
  listen [::]:80;
  server_name xn--psszg58cydsdq780c.com www.xn--psszg58cydsdq780c.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  http2 on;
  server_name xn--psszg58cydsdq780c.com www.xn--psszg58cydsdq780c.com;

  ssl_certificate     /etc/nginx/ssl/fullchain.pem;   # 腾讯云免费 DV 证书
  ssl_certificate_key /etc/nginx/ssl/privkey.pem;

  root /var/www/nailong;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }   # 访问不存在的路径也回这一页

  location = /index.html { add_header Cache-Control "no-cache"; }   # 改文案要能立刻生效
  # ring.svg 已删除（文字环随 3D 改版撤掉）；旧缓存里若还引用它，缺失不影响页面
  location ~* \.(svg|png|webp|ico)$ { expires 7d; add_header Cache-Control "public"; }
}
```

DNSPod 给 `@` 和 `www` 各加一条 **A 记录**指向服务器公网 IP。

> ⚠️ 只有这个方案（和方案 C 的国内节点）需要 **ICP 备案**（腾讯云备案控制台，约 1～20 个工作日），否则 80/443 会被阻断。
> **Cloudflare Pages 在境外，不需要备案** —— 这也是现在用它的原因。
> 代价是国内访问速度不如备案过的国内节点（Cloudflare 实测 0.13s，备案的国内节点约 0.03s）。

</details>

## 6. 上线自检

- [ ] 首页能正常发射、进入太空、依次放出 8 节校史
- [ ] 拖动能环视、轻点能跳一节、空格能暂停
- [ ] 点「出发」后飞向星球并跳转到广州大学
- [ ] 奶龙在徽章正中间（不偏左不偏右；`tools/prepare_nailong.py` 跑完会打印偏移量自检）
- [ ] 点「出发」后落到 `https://www.gzhu.edu.cn/`，地址栏不残留本站（用的是 `location.replace`）
- [ ] 手机上打开正常（徽章按 `min(64vw, 44vh, 340px)` 自适应，横竖屏都不溢出）
- [ ] 手机竖屏下校史文字在火箭上方，不重叠；分档降级后不卡
- [ ] 微信里发链接，卡片图正常显示（`og:image` 用的是绝对地址 `https://xn--psszg58cydsdq780c.com/og.png`；**换了域名记得改这一行**，微信抓不到图会退化成纯文字卡片）
- [ ] 浏览器页签显示奶龙图标（`favicon.ico` + `favicon.png`）
- [ ] 关掉浏览器 JS 也能跳（页面里有 `<noscript>` 的 meta refresh 兜底）
- [ ] **双击本地 `index.html` 时图片也正常**（资源是相对路径，不该出现碎图标）
- [ ] `http://` 能自动跳 `https://`（Cloudflare 自动）
- [ ] 从国内网络实测打开一次（Cloudflare 实测首字节约 0.13s）
- [ ] 跳转后去百度统计后台「实时访客」，能看到这次访问（手机流量再试一次更准）

## 7. 改了东西怎么重新发布

**改页面内容**（文案、样式、跳转目标、动画时长）：直接改 `index.html`，然后提交。

```powershell
git add -A
git commit -m "改了 xxx"
git push
```

`index.html` 就是源文件，没有构建步骤，改完直接用。几个常改的地方：

| 想改什么 | 改哪儿 |
| --- | --- |
| 跳转到哪个学校 | `assets/launch.js` 里的 `TARGET` |
| 文案里的校名 | `const NAME = '...'` |
| 各段时间 | `assets/launch.js` 顶部的 `T` 常量 |
| 校史内容 | `HISTORY` 数组（8 条） |
| 飞跃短句 | `FLY_FACTS`（76 条，按主线节点分桶） |
| 校史配色 | `ERA_TONES` |
| 配色 | `index.html` 里 `:root` 的 CSS 变量 |

**改图片**（换奶龙图、改 favicon）：

```powershell
# 手工改 favicon.png 之后：
python tools/build_favicon.py      # 派生 favicon.ico

# 换了素材 双手交叉站立.png 之后（会重写 core.* 和 favicon.png）：
python tools/prepare_nailong.py
python tools/build_assets.py
python tools/build_favicon.py
git add -A && git commit -m "换了图" && git push
```

⚠️ `prepare_nailong.py` 会**重写** `core.png` / `core.webp` / `favicon.png`。
手工改过 `favicon.png` 就别跑它。

GitHub Pages 和 Cloudflare Pages 都会在推上去之后自动重新发布，一般 1 分钟内生效。
（本站现在用 Cloudflare，见 [第 5 节](#5-部署cloudflare-pages)。）

> 页面资源里的 `og.png`、`core.webp` 这些文件名没变，浏览器/CDN 可能缓存旧版本。
> 如果改完看不到效果，硬刷新（Ctrl+F5）或者给文件名加版本号（如 `core.v2.webp`）。

## 8. 说明

* 本站与广州大学**没有任何官方关联**，纯属网友自制的整活跳转页，页面里的「关于」弹窗已注明。
* 参考站 `中国奶龙大学.com` 的做法是：域名在 Squarespace 上做 **302** 跳到 `nailong.dykey.net` 落地页，再由落地页的 JS 跳到学校官网（大连理工大学）。本站把它简化成「一个静态页 + 前端跳转」，少一跳、更快，也不需要第二个域名。
* 需要的话也可以给主域名加一条 DNSPod 的「显性 URL 转发」当第一跳，但没必要，多一跳只会更慢。
* 奶龙素材是你提供的 `双手交叉站立.png`（原图是 WebP 贴图、没有透明通道），`tools/prepare_nailong.py` 按饱和度抠的背景；如果发现边缘有灰边或肚皮被啃掉，调 `S_LO` / `S_HI` 两个阈值再重跑即可。
* 首页 3D 场景里的所有文字（校史、飞跃短句、「奶龙号」贴花）都是 Canvas 现画再当纹理用的，靠系统字体渲染（微软雅黑 / 苹方），不加载任何网络字体，所以不会闪。
* 飞跃短句不是随机飘的：每条带一个桶号，对应主线校史的第几节。
  主线讲到哪一节，旁边飘的就是那个年代的句子 —— 不会出现「讲 1927 时飘着 2018 的 ESI」。
