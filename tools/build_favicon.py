# -*- coding: utf-8 -*-
"""从 favicon.png 生成 favicon.ico（只读它，不改它）。

背景
----
favicon.png 是手工维护的源文件（512×512，白底圆盘 + 奶龙）。
浏览器页签只认 .ico，所以需要从它派生出 favicon.ico。

⚠️ 本脚本只读 favicon.png，绝不修改它，也不碰 core.* / 双手交叉站立.png。
   （之前 prepare_nailong.py 会连 favicon.png 一起重写，那样手工改的图标会被覆盖，
     所以派生这一步单独拆出来。）

跑法
----
    python tools/build_favicon.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "favicon.png"
ICO = ROOT / "favicon.ico"

# 页签实际用到的三档；16 是任务栏/标签页，32 是高分屏标签页，48 是桌面快捷方式
SIZES = [(16, 16), (32, 32), (48, 48)]


def main() -> int:
    if not SRC.exists():
        print(f"❌ 找不到 {SRC}", file=sys.stderr)
        return 1

    before = SRC.read_bytes()
    img = Image.open(SRC)
    print(f"源文件 favicon.png: {img.width}×{img.height} {img.mode} "
          f"{len(before):,} 字节")

    # ICO 不支持带透明通道的调色板模式等问题，统一转 RGB（白底图标不需要 alpha）
    img = img.convert("RGB")
    img.save(ICO, sizes=SIZES)

    after = SRC.read_bytes()
    if before != after:
        print("❌ favicon.png 被改动了！本脚本不该写它", file=sys.stderr)
        return 1

    print(f"已生成 favicon.ico: {ICO.stat().st_size:,} 字节，含 "
          f"{'/'.join(str(s[0]) for s in SIZES)} 三档")
    print("✅ favicon.png 未被改动")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
