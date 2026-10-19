# -*- coding: utf-8 -*-
"""把 core.webp 和 assets/gzhu-logo.png 内联成 data URI，生成 assets/textures.js

为什么要内联
------------
浏览器对 file:// 页面有跨源保护：WebGL 不允许使用来自 file:// 的图片作为纹理，
也不允许把 file:// 的图画进 canvas 再读出来。
结果是**双击 index.html 打开**时，奶龙舷窗和广州大学校徽都是空白的，
而程序画出来的「奶龙号」三个字却正常（它不依赖外部图片）。

内联成 data: URI 后不受这条限制，双击打开和部署到线上表现一致。

改图之后重新跑一次本脚本即可：

    python tools/build-textures.py
"""

import base64
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent

ITEMS = [
    ("naiLong", ROOT / "core.webp", "image/webp"),
    ("gzhuLogo", ROOT / "assets" / "gzhu-logo.png", "image/png"),
]

HEADER = """/* ============================================================================
   内联贴图（由 tools/build-textures.py 生成，不要手改）

   为什么要把图内联成 data URI：
   浏览器对 file:// 页面有跨源保护 —— WebGL 不允许使用来自 file:// 的图片
   作为纹理，也不允许把 file:// 的图画进 canvas 再取出来。
   结果是：直接双击 index.html 打开时，奶龙舷窗和广州大学校徽都是空白，
   而程序画出来的「奶龙号」三个字却正常（因为它不依赖外部图片）。

   内联成 data: URI 后不受这条限制，双击打开和部署到线上表现一致。
   原始文件仍保留在 core.webp / assets/gzhu-logo.png ——
   og:image 等地方还要用，改图后重新跑一次生成脚本即可。

   重新生成：python tools/build-textures.py
   ============================================================================ */

(function () {
  window.__TEX = {"""


def main():
    lines = [HEADER]
    for key, path, mime in ITEMS:
        if not path.exists():
            print("缺少文件:", path)
            return 1
        raw = path.read_bytes()
        uri = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode("ascii"))
        lines.append("    // %s  (%d B)" % (path.name, len(raw)))
        lines.append("    %s: '%s'," % (key, uri))
        print("  %-12s %8d B → base64 %8d B" % (key, len(raw), len(uri)))

    lines += ["  };", "})();", ""]

    out = ROOT / "assets" / "textures.js"
    out.write_text("\n".join(lines), encoding="utf-8")
    print("\n已生成:", out)
    print("文件大小: {:,} B".format(out.stat().st_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
