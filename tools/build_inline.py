# -*- coding: utf-8 -*-
"""把 tools/index.template.html 构建成部署用的 index.html。

构建做两件事
------------
1. **内联 ring.svg** —— SVG 是纯文本，3,584 字节 gzip 后只有 519 字节。
   内联进 HTML 几乎不增加传输量，却省掉一整个请求。
2. **剥掉 HTML 注释** —— 模板里的注释是给人看的文档，没必要让每个访客下载。
   实测 6 段注释合计 1,593 字符，gzip 后仍占 1,537 字节（页面的 ~20%）。
   只删 `<!-- -->`，CSS 的 `/* */` 和 JS 里的东西一律不碰。

为什么内联
----------
GitHub Pages 只提供 HTTP/1.1，没有多路复用，每个资源都要单独一次往返。
这个站部署在境外，实测一个 RTT 约 0.25 秒，少一个请求就少一次往返。

为什么不内联 core.webp（实测是亏的）
------------------------------------
一开始以为「base64 膨胀会被 gzip 抵消」，实测证明是错的：

    core.webp 原始      15,584  -> 单独 gzip 15,150
    core.webp base64    20,780  -> 混在 HTML 里 gzip 15,251

已经压缩过的 WebP，base64 之后 gzip 几乎压不动（只省 7%），
内联它会把 HTML 从 ~23KB 撑到 ~46KB —— 多传 15KB 只换来省一次往返。
在 0.25s RTT 的链路上多传 15KB 大约只要 0.05s（按 3Mbps 算），**不划算**，
所以它继续用独立文件 + <link rel=preload> 提前加载。

同理不内联 favicon.ico：5,727 字节的二进制，base64 后混在 HTML 里 gzip 仍有
5,780 字节，比它本身还大 —— 内联纯亏，保留文件引用。

净效果：首屏 3 个请求 → 2 个，传输量基本不变（+944 B 换一次往返），
再靠剥注释把 gzip 后压回 ~6.7KB。

跑法
----
    python tools/build_inline.py
"""
from __future__ import annotations

import gzip
import re
import sys
from pathlib import Path

# Windows 控制台默认是 GBK，直接 print 带 emoji 的提示会抛 UnicodeEncodeError
# 把构建脚本整个搞挂。这里强制把标准输出切成 UTF-8，切不动就退化成替换字符，
# 总之不能让「打印一行日志」这种事毁掉构建。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "tools" / "index.template.html"
OUTPUT = ROOT / "index.html"
RING_SVG = ROOT / "ring.svg"

# 模板里允许出现的占位符白名单（出现别的就报错，防止手滑写错名字）
PLACEHOLDERS = {"RING_SVG"}

# 首屏预期要请求的本地文件（相对 index.html）。
# 除了 favicon.png / og.png（都不是首屏需要），其余都该出现在这个列表里。
EXPECTED_REQUESTS = {"core.webp", "favicon.ico"}


def inline_ring_svg(path: Path) -> str:
    """把 ring.svg 变成可以嵌进 HTML 的内联 <svg>。

    做三件事：
      1. 去掉 XML 声明（如果有）和注释；
      2. 加上 class="ring"（CSS 靠它定位，也靠它做旋转动画）；
      3. 压掉标签之间的空白 —— 内联 SVG 的空格会被保留，留着白白增大体积。
    文字内容（那些 <text>）一个字都不动，避免影响渲染。
    """
    svg = path.read_text(encoding="utf-8").strip()
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r">\s+<", "><", svg)      # 标签之间的空白去掉
    svg = re.sub(r"\s*\n\s*", " ", svg)    # 标签内部的换行压成空格
    svg = re.sub(r"\s{2,}", " ", svg)      # 连续空格合并

    if 'class="ring"' not in svg:
        svg = svg.replace("<svg ", '<svg class="ring" ', 1)
    return svg.strip()


def strip_comments(html: str) -> str:
    """去掉 HTML 注释（构建产物专用，模板里的注释原样保留）。

    模板是给人读的，注释是文档，必须留着；但部署出去的页面没必要带着它们 ——
    实测 6 段注释合计 1,593 字符，gzip 后仍占 1,537 字节，是页面的 ~20%。

    只处理 <!-- -->（HTML 注释）。CSS 的 /* */ 和 JS 的 // 一律不碰：
    那些地方动起刀来风险大（比如 https:// 里的 // 就会被误伤），收益也小。
    """
    # 非贪婪匹配，且要求注释里不出现 -->（不会有嵌套 HTML 注释）
    html = re.sub(r"<!--(?:(?!-->).)*?-->", "", html, flags=re.S)
    # 删完注释往往会留下一堆空行，压掉，别让产物里全是空白
    html = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n", html)
    html = re.sub(r"[ \t]+\n", "\n", html)
    return html


def gz(data: bytes) -> int:
    return len(gzip.compress(data, 9))


def audit(html: str) -> tuple[list[str], list[str]]:
    """把页面里的资源引用分成「首屏会请求的」和「非首屏的」两类。

    两个坑都踩过了，所以这里格外小心：
      · 先剥掉 HTML 注释再找标签，否则注释里举例写的 <link ...> 会被当成真引用；
      · 按整个标签判断 rel，而不是看前文——之前用「前面 80 字符里有没有
        apple-touch-icon」这种启发式，会被注释里的同名文字误伤。
    """
    stripped = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    first_screen, deferred = [], []
    for m in re.finditer(r"<(link|img|source|script|iframe)\b[^>]*>", stripped, re.I):
        tag = m.group(0)
        url_m = re.search(r'(?:src|href|srcset)="([^"]+)"', tag)
        if not url_m:
            continue
        url = url_m.group(1)
        if url.startswith(("data:", "https:", "http:", "//", "#", "mailto:")):
            continue
        rel_m = re.search(r'rel="([^"]*)"', tag)
        rel = (rel_m.group(1).lower() if rel_m else "")
        # apple-touch-icon 只有「添加到主屏幕」时才拉，不算首屏
        if "apple-touch-icon" in rel:
            deferred.append(url)
        else:
            first_screen.append(url)
    return sorted(set(first_screen)), sorted(set(deferred))


def main() -> int:
    for f in (TEMPLATE, RING_SVG):
        if not f.exists():
            print(f"❌ 缺少文件: {f}", file=sys.stderr)
            return 1

    html = TEMPLATE.read_text(encoding="utf-8")

    # 只替换白名单里的占位符；发现未登记的 {{XXX}} 直接失败，避免静默出错
    used = set(re.findall(r"\{\{([A-Z_]+)\}\}", html))
    unknown = used - PLACEHOLDERS
    if unknown:
        print(f"❌ 模板里有未登记的占位符: {sorted(unknown)}", file=sys.stderr)
        print(f"   已登记可用的: {sorted(PLACEHOLDERS)}", file=sys.stderr)
        return 1
    if "RING_SVG" not in used:
        print("❌ 模板里没找到 {{RING_SVG}}，ring.svg 不会被内联", file=sys.stderr)
        return 1

    html = html.replace("{{RING_SVG}}", inline_ring_svg(RING_SVG))

    # 注释只在模板里保留（那是文档），产物里剥掉 —— 省 gzip 后约 1.5KB
    size_with_comments = len(html.encode("utf-8"))
    html = strip_comments(html)

    # 先做自检再写文件：自检不过就别把坏产物写出去
    reqs, deferred = audit(html)
    ok = True

    leftover = re.findall(r"\{\{[A-Z_]+\}\}", html)
    if leftover:
        print(f"  ❌ 残留占位符: {set(leftover)}")
        ok = False

    missing = EXPECTED_REQUESTS - set(reqs)
    extra = set(reqs) - EXPECTED_REQUESTS
    if missing:
        print(f"  ⚠️ 预期要请求但没找到: {sorted(missing)}（功能可能坏了）")
        ok = False
    if extra:
        print(f"  ⚠️ 多出预期外的引用: {sorted(extra)}（确认是否必要）")
        ok = False

    # 内联的 svg 必须带上 class="ring"，否则定位和旋转动画都会失效
    if 'class="ring"' not in html:
        print('  ❌ 内联 svg 缺少 class="ring"')
        ok = False

    # 产物里不该再有 HTML 注释
    if "<!--" in html:
        left = re.findall(r"<!--(?:(?!-->).)*?-->", html, re.S)
        print(f"  ⚠️ 产物里仍有 {len(left)} 段注释未清除")
        for c in left[:3]:
            print(f"      {c[:60]}")

    if not ok:
        print("❌ 自检未通过，没有写出 index.html（避免发布坏产物）", file=sys.stderr)
        return 1

    OUTPUT.write_text(html, encoding="utf-8")

    raw = html.encode("utf-8")
    print(f"已生成 {OUTPUT.name}")
    print(f"  裸大小 : {len(raw):>7,} 字节  （去注释前 {size_with_comments:,}）")
    print(f"  gzip后 : {gz(raw):>7,} 字节  ← 线上实际传输量")
    print(f"  首屏请求: {reqs if reqs else '（无）'}")
    print(f"  延迟加载: {deferred if deferred else '（无）'}")
    print("  ✅ 自检通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
