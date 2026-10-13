# 宇宙奶龙大学.com

打开 `宇宙奶龙大学.com` → 先播一段「奶龙护送你入学」的动画 → 动画播完自动跳到 **广州大学**官网（https://www.gzhu.edu.cn/）。

纯静态，没有任何构建步骤和外部依赖，丢到任意静态托管上就能跑 ——
**推荐 [Cloudflare Pages](#方案-acloudflare-pages推荐但要迁-ns) 或 [GitHub Pages](#方案-bgithub-pages不用动-ns最省事)，两个都不需要买服务器、也不需要 ICP 备案。**

```
index.html                  部署用的页面（由 tools/index.template.html 构建生成，别直接改）
tools/index.template.html   页面源文件 ← 要改文案/样式改这个
tools/build_inline.py       构建：把 ring.svg 内联进 index.html
ring.svg                    校徽外圈：旋转的「宇宙奶龙大学·」文字环（构建时会内联，不单独请求）
core.webp / core.png        校徽中心：奶龙（站在文字环底下，所以只有上半身露出来）
favicon.ico                 浏览器页签图标（16/32/48）
favicon.png                 iOS / 安卓主屏图标（512×512）
og.png                      微信、QQ、Twitter 分享卡片图（1200×630）
CNAME                       GitHub Pages 绑定自定义域名用（已填好 punycode）
双手交叉站立.png            奶龙原图素材 ← 保留着，方便以后重做抠图
tools/prepare_nailong.py    奶龙抠图 → core.png / core.webp / favicon.*
tools/build_assets.py       文字环 ring.svg + 分享卡片 tools/og.html
tools/preview-core.png      抠图效果的白底预览
```

从零重建全部资源（三步，顺序别换）：

```powershell
python tools/prepare_nailong.py    # 抠图 → core.* / favicon.*
python tools/build_assets.py       # 文字环 → ring.svg
python tools/build_inline.py       # 内联 → index.html
```

本地已经是一个初始化好的 git 仓库（分支 `main`，首次提交已完成），推送即可发布：

```powershell
git remote add origin https://github.com/<你的用户名>/nailong-university.git
git push -u origin main
```

---

## 0. 性能优化：为什么首屏只有 2 个请求

这个站部署在境外，**瓶颈是延迟不是带宽**（整页才 35KB）。同机实测：

| 目标 | 建连 | 首字节 |
| --- | --- | --- |
| GitHub Pages（本站） | 0.25 ~ 0.46s | **0.49 ~ 0.72s** |
| 广州大学 / 百度（国内站点） | 0.02 ~ 0.13s | 0.03 ~ 0.13s |

一个 RTT 约 0.25 秒，而 **GitHub Pages 只跑 HTTP/1.1**（实测 `HTTP版本=1.1`），
没有多路复用 —— 所以**每个资源都要单独付一次往返**。少一个请求就是少 0.25 秒。

### 做了什么①：把 ring.svg 内联进 HTML

| | 优化前 | 优化后 |
| --- | --- | --- |
| 首屏请求数 | 3（html + core.webp + ring.svg） | **2**（html + core.webp） |
| 首屏传输量 | 23,016 B | 23,960 B（**+944 B**） |

**只多 944 字节，就省掉一整个往返。** 因为 SVG 是纯文本（3,584 B），
gzip 后仅 519 B，内联进同一个文件几乎不增体积。

### 做了什么②：把 HTML 注释从产物里剥掉

模板里的注释是**写给人看的文档**，没必要让每个访客下载一遍。实测：

| | 裸大小 | gzip 后 |
| --- | --- | --- |
| 6 段注释合计 | 1,593 B | **1,537 B** |
| 整页（去注释前） | 24,757 B | 8,344 B |
| **整页（去注释后）** | **18,348 B** | **6,709 B** |

**注释占了页面的 ~20%**（gzip 后）。现在注释只存在于
`tools/index.template.html`，构建时自动剥离 —— 文档一个字没少，
访客少下 1.6KB。

剥离只处理 `<!-- -->`。CSS 的 `/* */` 和 JS 一律不碰：那些地方动刀风险大
（比如 `https://` 里的 `//` 就会被误伤），收益也小。

### 为什么没内联奶龙图（这条是踩坑记录）

一开始我以为「base64 的膨胀会被 gzip 抵消」，**实测证明是错的**：

```
core.webp 原始      15,584  →  单独 gzip 15,150
core.webp base64    20,780  →  混进 HTML 后 gzip 15,251   ← 只省 7%
```

已经压缩过的 WebP，base64 之后 gzip 几乎压不动。内联它会把 HTML 从 23KB
撑到 **46KB** —— 多传 15KB 只换一次往返，在 0.25s RTT 上不划算（多传 15KB 约 0.05s）。
所以它继续用独立文件 + `<link rel=preload>` 提前加载。

同理没内联 `favicon.ico`：5,727 B 的二进制，base64 后混在 HTML 里 gzip 仍有
5,780 B，**比它本身还大**。

### 顺手修掉的一个浪费

原来 head 里有这么两行：

```html
<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="512x512" href="favicon.png">   ← 删了
```

第二行会让浏览器**可能去下那张 512×512 的 PNG（93KB！）** 当页签图标。
现在只保留 `.ico`（内含 16/32/48 三档），`favicon.png` 只留给
`apple-touch-icon`（仅在「添加到主屏幕」时才拉）。

### 构建与自检

`index.html` 是**生成产物**，改页面要改 `tools/index.template.html` 再重跑：

```powershell
python tools/build_inline.py
```

脚本会自检并在出问题时以非零码退出（**自检不过就不写文件**，避免发布坏产物）：

* 模板里有未登记的占位符 → 报错
* 内联的 svg 缺 `class="ring"`（会导致定位和旋转动画失效）→ 报错
* 首屏资源引用与预期不符 → 报错
* 产物里仍有 HTML 注释没剥干净 → 警告
* 输出裸大小 / gzip 后大小（线上真实传输量）

> 自检里也踩过两个坑，都修了：先剥掉 HTML 注释再找标签（否则注释里举例写的
> `<link>` 会被当成真引用）；按整个标签判断 `rel`（原来用「前文 80 字符里有没有
> apple-touch-icon」这种启发式，会把 `favicon.ico` 误判成延迟加载）。

### 还想更快的话

内联已经把这个站能榨的都榨了，再快就得**换托管**（实测数据）：

| 方案 | 首字节 | 代价 |
| --- | --- | --- |
| Vercel | 0.11s | 免费、加 CNAME 即可、不用迁 NS |
| Cloudflare | 0.13s | 免费、要迁 NS |
| Netlify | 0.16s | 免费、不用迁 NS |
| GitHub Pages | 0.49s | 现状 |
| COS / EdgeOne 大陆节点 | 0.03s | **要 ICP 备案** |

---

## 1. 本地先看效果

**方式一：直接双击 `index.html`** —— 最省事，图片能正常显示（想看演示模式就在地址栏末尾补 `?stay`）

**方式二：起个本地服务** —— 更贴近线上，方便测 `?stay` 之类的参数

```powershell
python -m http.server 8801 --directory .
```

* <http://127.0.0.1:8801/index.html?stay> —— **演示模式**，不跳转，动画循环播放
* <http://127.0.0.1:8801/index.html> —— 真跳转，约 3.1 秒后离开

> 页面里所有资源都写成**相对路径**（`core.webp`，而不是 `/core.webp`），所以三种打开方式都正常：
> 双击本地打开（`file://`）、部署在域名根目录、部署在子目录（如 `example.com/nailong/`）。
> ⚠️ 别改回 `/core.webp` 这种根路径：双击打开时它会去找 `D:\core.webp`，页面上图片会全变成碎图标。

## 2. 动画与跳转时序（重点）

时序全部集中在 `index.html` 底部那几个常量里：

| 常量 | 默认值 | 含义 |
| --- | --- | --- |
| `DELAY` | 2600ms | 入场动画 + 停留，进度条走到头的时刻 |
| `EXIT` | 450ms | 离场动画时长（放大 + 淡出，和 CSS 里 `.wrap` 的 `transition` 保持一致） |
| `BUFFER` | 80ms | 余量，等离场动画的最后一帧真正画完 |
| `TOTAL` | `DELAY + EXIT` | 进度条动画时长，正好在跳转那一刻走满 |
| `SPIN` | 4000ms | 文字环转一圈 |

执行流程（默认一共约 3.1 秒）：

1. 页面加载 → `.badge` 弹出、文字环匀速旋转、外圈进度条从 0 走到 100%；
2. `DELAY`（2.6s）后进入离场：徽章放大淡出、标题下移淡出、文字环**越转越快**；
3. 再等 `EXIT + BUFFER`（0.53s），**离场动画播完**，才 `location.replace(TARGET)`。
   —— 用 `replace` 而不是 `href`，跳过去之后按浏览器后退不会又弹回这一页。

> **要改「动画播完才跳转」的等待时长，只改 `DELAY` 和 `EXIT`**：
> 跳转时刻 = `DELAY + EXIT`，进度条也是按这个总时长走的，所以进度条永远在跳转那一瞬间走满。
> `EXIT` 一定要和 CSS 里 `.wrap { transition: ... .45s }` 的时长一致，否则会「动画没播完就跳」或者「播完了还愣一下」。

想让动画更长（比如 6 秒），只改一行即可：

```js
const DELAY = 6000;   // 6 秒后才开始离场
```

其它交互：

* 点击页面任意处 / 按任意键 → 立即离场并跳转（不用等）；
* 右下角「关于」→ 暂停倒计时和进度条，关掉后从剩余时间继续（防止用户看说明时被跳走）；
* 键盘依次按 `c` `y` → 彩蛋，校名会变成「陈宇龙大学」；
* 系统开了「减少动态效果」时，自动降级成 1.2 秒直达、不做动画。

## 3. 想要改的地方

| 想改什么 | 改哪里 |
| --- | --- |
| 跳转目标 | `index.html` 里 `const TARGET = 'https://www.gzhu.edu.cn/';` |
| 文案里的校名 | `const NAME = '广州大学';` |
| 停留/动画时长 | `DELAY`、`EXIT` |
| 配色 | `index.html` 顶部 `:root` 里的 CSS 变量 |
| 文字环上的字 | `tools/build_assets.py` → `build_ring(text=...)`，重跑脚本 |
| 奶龙的样子 | 换掉 `双手交叉站立.png`，重跑 `tools/prepare_nailong.py` |
| 抠图边缘 | `tools/prepare_nailong.py` 里的 `S_LO` / `S_HI` 阈值，配合 `tools/preview-core.png` 调 |
| 分享卡片 | `tools/build_assets.py` → `build_og_html()`，重跑后用 Edge 无头截图 |
| 百度统计的站点 ID | `index.html` 里 `hm.src` 那一行的 `?` 后面 |
| 统计兜底等待时长 | `index.html` 里的 `const BUDGET = 1200;`（调 0 等于不等待） |

重新生成图形：

```powershell
python tools/prepare_nailong.py    # 奶龙抠图 → core.* / favicon.*
python tools/build_assets.py       # 文字环 → ring.svg + tools/og.html
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

* 老老实实等动画播完的（约 3.1 秒）→ 早就超过预算，**一秒都不多等**，用户完全无感；
* 提前点击跳过的 → 最多补等几百毫秒，把这次访问救回来；
* 被广告拦截插件挡掉（`onerror`）→ **一秒都不等**，绝不为了统计拖累用户。

### 顺手记了一个事件

跳转时会发一个 `_trackEvent`，在后台「事件分析」里能看到：

| 事件类别 | 动作 | 含义 |
| --- | --- | --- |
| `redirect` | `auto` | 用户等完动画自动跳走 |
| `redirect` | `skip` | 用户等不及点掉的 |

`skip` 占比高说明动画太长了，可以调小 `DELAY`。

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
（`?stay` 演示模式也能看到统计，方便验证）。

### 注意事项

* **广告拦截插件会挡 `hm.baidu.com`**，被挡的访问统计不到，这是所有前端统计的通病，不用管；
* GitHub Pages / Cloudflare Pages 上都不用额外配置，统计脚本照常工作；
* 统计脚本是 `async` 的，**不影响页面渲染和动画**，最坏情况就是不统计。

## 5. 部署：GitHub Pages 或 Cloudflare Pages（都不用买服务器）

两个都**不需要 ICP 备案**（服务器在境外），免费额度对这么一个小页面来说完全用不完。
唯一要注意的是国内访问速度：GitHub Pages 在国内时快时慢，Cloudflare 一般更稳。

| | GitHub Pages | Cloudflare Pages |
| --- | --- | --- |
| 根域名（apex） | ✅ 2 条 A 记录就行（DNSPod 免费版限 2 条） | ⚠️ **必须把 NS 迁到 Cloudflare** |
| 子域名（www.） | ✅ CNAME | ✅ CNAME（NS 不用动） |
| HTTPS | ✅ 自动，可开 Enforce HTTPS | ✅ 自动 |
| 部署方式 | git push | git push 或拖拽上传 |
| 国内访问 | 一般（可能被墙/很慢） | 较好 |

> ⚠️ **最重要的一条**：Cloudflare Pages 的**根域名**（`宇宙奶龙大学.com` 本身）要求这个域名是 Cloudflare 上的一个 zone，
> 也就是要把 NS 从 DNSPod 改成 Cloudflare 的。Cloudflare 官方文档原文就是这么写的：
> *"To use a custom apex domain with your Pages project, configure your nameservers to point to Cloudflare's nameservers."*
> 如果不想动 NS，那 Cloudflare Pages 只能挂 `www.宇宙奶龙大学.com` 这种子域名。

### 方案 A：Cloudflare Pages（推荐，但要迁 NS）

1. **迁 NS**：Cloudflare 控制台 → Add a site → 填 `宇宙奶龙大学.com` → 选 Free 计划 → 它会给你两个 NS（形如 `xxx.ns.cloudflare.com`）。
   去 DNSPod 把域名的 NS 改成这两个（腾讯云域名控制台 → 域名 → DNS 修改）。等生效，一般几分钟到几小时。
   ⚠️ 迁 NS 前先在 Cloudflare 里把原有解析记录补齐（或让它自动扫描导入），否则邮件等其它服务会断。
2. **建 Pages 项目**：Workers & Pages → Create → Pages → Connect to Git → 选仓库。
   构建命令**留空**，输出目录填 `/`（纯静态，没有构建步骤）。
3. **绑域名**：项目 → Custom domains → Set up a domain → 填 `xn--psszg58cydsdq780c.com`（punycode；因为已经是 Cloudflare 的 zone，CNAME 会自动创建）。
   顺手把 `www` 也加上，或者在 Rules → Redirect Rules 里把 `www` 302 到根域名。
4. HTTPS 证书自动签发，不用管。国内访问如果遇到慢/被墙，可以在 DNS 里换优选 IP（进阶玩法，非必需）。

### 方案 B：GitHub Pages（不用动 NS，最省事）

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

### 方案 C：腾讯云 COS + CDN（也不买服务器，但国内节点要备案）

1. **实名认证**：域名先完成实名认证，否则 DNSPod 不给解析。
2. **建桶**：对象存储 COS → 创建存储桶，地域选就近（如 `ap-guangzhou`），权限选「公有读私有写」。
3. **传文件**：把 `index.html`、`ring.svg`、`core.webp`、`core.png`、`favicon.ico`、`favicon.png`、`og.png` **传到桶的根目录**（`tools/` 和奶龙原图不用传）。
4. **开静态网站**：桶 → 基础配置 → 静态网站 → 开启，索引文档 `index.html`，**错误文档也填 `index.html`**（这样访问不存在的路径也会回到这一页）。
   ⚠️ 但要注意：页面用的是相对路径，所以访问 `域名/a/b` 这种深层路径时，页面能出来、图片会找不到（它会去找 `/a/core.webp`）。
   想彻底干净，就在 CDN 里加一条重定向规则：**路径不含扩展名 → 302 到 `/`**。平时只访问根域名的话可以不管。
5. **绑自定义域名**：桶 → 域名管理 → 添加自定义 CDN 加速域名，加速域名填 `xn--psszg58cydsdq780c.com`（= 宇宙奶龙大学.com），源站类型「默认源站」。
6. **上 HTTPS**：腾讯云 SSL 证书 → 申请免费 DV 证书（DNS 验证，DNSPod 可一键添加验证记录）→ 在 CDN 域名里部署证书 → 打开「强制 HTTPS」。
7. **加解析**：DNSPod 里给 `@` 加一条 **CNAME**，记录值填第 5 步给出的 CNAME 域名。
   （`@` 的 CNAME 和 MX 记录会冲突；DNSPod 的免费版支持根域名 CNAME，但部分解析商会拒绝。）
8. **设缓存**：CDN → 缓存配置里给 `index.html` 设「不缓存」或很短，图片设 7 天，避免改完文案看不到效果。

> 静态网站里中文域名会自动按 punycode（`xn--psszg58cydsdq780c.com`）填写，控制台里显示成中文是正常的。

### 方案 D：轻量应用服务器 / CVM + Nginx

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
  # ring.svg 已经被内联进 index.html，这里留着是为了兼容旧缓存/直接访问
  location ~* \.(svg|png|webp|ico)$ { expires 7d; add_header Cache-Control "public"; }
}
```

DNSPod 给 `@` 和 `www` 各加一条 **A 记录**指向服务器公网 IP。

> ⚠️ 只有这个方案（和方案 C 的国内节点）需要 **ICP 备案**（腾讯云备案控制台，约 1～20 个工作日），否则 80/443 会被阻断。
> **GitHub Pages 和 Cloudflare Pages 都在境外，不需要备案** —— 这也是建议你用它们的原因。
> 代价是国内访问速度：GitHub Pages 时快时慢，Cloudflare 相对稳一些，但都不会比备案过的国内节点快。

## 6. 上线自检

- [ ] `https://宇宙奶龙大学.com/?stay` 能看到完整动画，进度条走满、奶龙和文字环都在
- [ ] 奶龙在徽章正中间（不偏左不偏右；`tools/prepare_nailong.py` 跑完会打印偏移量自检）
- [ ] 不带 `?stay` 时，约 3.1 秒后落到 `https://www.gzhu.edu.cn/`，地址栏不残留本站
- [ ] 手机上打开正常（徽章按 `min(64vw, 44vh, 340px)` 自适应，横竖屏都不溢出）
- [ ] 深色模式下文字环和「宇宙」星空背景正常（系统切深色即可看到）
- [ ] 微信里发链接，卡片图正常显示（`og:image` 用的是绝对地址 `https://xn--psszg58cydsdq780c.com/og.png`；**换了域名记得改这一行**，微信抓不到图会退化成纯文字卡片）
- [ ] 浏览器页签显示奶龙图标（`favicon.ico` + `favicon.png`）
- [ ] 关掉浏览器 JS 也能跳（页面里有 `<noscript>` 的 meta refresh 兜底）
- [ ] **双击本地 `index.html` 时图片也正常**（资源是相对路径，不该出现碎图标）
- [ ] `http://` 能自动跳 `https://`（GitHub Pages 记得勾 Enforce HTTPS；Cloudflare 自动有）
- [ ] 从国内网络实测打开一次（GitHub Pages 偶尔会慢到十几秒，能接受就行）
- [ ] 跳转后去百度统计后台「实时访客」，能看到这次访问（手机流量再试一次更准）

## 7. 改了东西怎么重新发布

**改页面内容**（文案、样式、跳转目标）：改 `tools/index.template.html`，然后

```powershell
python tools/build_inline.py     # 重新生成 index.html
git add -A
git commit -m "改了 xxx"
git push
```

**只改图片**（换奶龙、换配色）：跑对应的生成脚本，再跑一次构建，然后提交。

⚠️ **别直接改 `index.html`** —— 它是构建产物，下次跑 `build_inline.py` 会被覆盖。
（`git diff` 里看到 `index.html` 有很大改动时，先确认是不是构建产生的。）

GitHub Pages 和 Cloudflare Pages 都会在推上去之后自动重新发布，一般 1 分钟内生效。

> 页面资源里的 `og.png`、`core.webp` 这些文件名没变，浏览器/CDN 可能缓存旧版本。
> 如果改完看不到效果，硬刷新（Ctrl+F5）或者给文件名加版本号（如 `core.v2.webp`）。

## 8. 说明

* 本站与广州大学**没有任何官方关联**，纯属网友自制的整活跳转页，页面里的「关于」弹窗已注明。
* 参考站 `中国奶龙大学.com` 的做法是：域名在 Squarespace 上做 **302** 跳到 `nailong.dykey.net` 落地页，再由落地页的 JS 跳到学校官网（大连理工大学）。本站把它简化成「一个静态页 + 前端跳转」，少一跳、更快，也不需要第二个域名。
* 需要的话也可以给主域名加一条 DNSPod 的「显性 URL 转发」当第一跳，但没必要，多一跳只会更慢。
* 奶龙素材是你提供的 `双手交叉站立.png`（原图是 WebP 贴图、没有透明通道），`tools/prepare_nailong.py` 按饱和度抠的背景；如果发现边缘有灰边或肚皮被啃掉，调 `S_LO` / `S_HI` 两个阈值再重跑即可。
* 文字环上的「宇宙奶龙大学·」是 SVG 里一个个定位的 `<text>`，靠系统字体渲染（微软雅黑 / 苹方），所以不会因为加载字体而闪一下。
