# -*- coding: utf-8 -*-
"""扫描 works/ 下各学院目录，自动生成 list.txt。

为什么需要这个脚本
------------------
页面（show.html）是纯静态的，有两件事做不到：

  1. **没法列出目录** —— 没有 readdir 这种 API，只能靠约定去猜文件名
     （试 1.webp、2.webp…… 或者读 list.txt）。
  2. **拿不到文件修改时间** —— 所以没法自动按时间排序。

结果是：一个既不是数字命名、又没写进 list.txt 的图片，
**文件在服务器上躺着，但页面上看不见**。

本地跑这个脚本两件事都能做到，于是由它生成清单，页面照着显示就行。

用法
----
    python tools/build_works_list.py                # 只处理还没有 list.txt 的目录
    python tools/build_works_list.py --force        # 覆盖已有的 list.txt
    python tools/build_works_list.py --dry-run      # 只看会做什么，不写文件
    python tools/build_works_list.py --convert      # 顺手把 jpg/png 转成 webp

排序规则
--------
list.txt 里**写在后面的显示在最上面**（当成最新的）。
所以脚本按修改时间**从旧到新**写入 —— 最新的作品落在最后一行，
页面上就出现在第一个。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# 一些 Windows 终端默认是 GBK，直接 print emoji / 中文会炸
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
WORKS = ROOT / "works"

# 只认这些；webp 是站点用的格式，其余的要转
WEBP = {".webp"}
CONVERTIBLE = {".jpg", ".jpeg", ".png"}
# 这些不是作品，别写进清单
SKIP_NAMES = {"list.txt", "readme.txt", ".gitkeep", "readme.md", "thumbs.db", ".ds_store"}
# 脚本自己生成的备份，别当成作品
SKIP_SUFFIX = {".bak", ".txt.md"}


def is_work(p: Path) -> bool:
    if not p.is_file():
        return False
    if p.name.lower() in SKIP_NAMES:
        return False
    # list.txt.bak 这类备份不算作品
    if p.name.lower().endswith(".bak"):
        return False
    return True


def convert_to_webp(p: Path) -> Path | None:
    """把 jpg/png 转成同名的 .webp，返回新路径。失败返回 None。"""
    try:
        from PIL import Image
    except ImportError:
        print("    ！没装 Pillow，跳过转换（pip install Pillow）")
        return None

    out = p.with_suffix(".webp")
    try:
        with Image.open(p) as im:
            im.convert("RGB").save(out, format="WEBP", quality=88, method=6)
        before, after = p.stat().st_size, out.stat().st_size
        print(f"    转 {p.name} → {out.name}  "
              f"{before / 1024:.0f}K → {after / 1024:.0f}K")
        return out
    except Exception as e:
        print(f"    ！{p.name} 转换失败: {e}")
        return None


def process(college: Path, force: bool, dry: bool, convert: bool) -> tuple[int, str]:
    """处理一个学院目录，返回 (作品数, 状态说明)。"""
    listing = college / "list.txt"

    # 只挑出真正的作品文件（webp 优先）
    files = [p for p in college.iterdir() if is_work(p)]

    # 需要转换的
    need_convert = [p for p in files if p.suffix.lower() in CONVERTIBLE]
    if need_convert:
        if convert and not dry:
            for p in need_convert:
                new = convert_to_webp(p)
                if new:
                    files.remove(p)
                    files.append(new)
                    p.unlink()          # 转成功就删原图，避免两份并存
        else:
            names = "、".join(p.name for p in need_convert[:3])
            more = f" 等 {len(need_convert)} 个" if len(need_convert) > 3 else ""
            return (0, f"有非 webp 图片（{names}{more}），加 --convert 转换")

    works = sorted([p for p in files if p.suffix.lower() in WEBP],
                   key=lambda p: p.stat().st_mtime)   # 旧的在前 → 新的落在最后一行

    if not works:
        return (0, "没有作品")

    if listing.exists():
        if not force:
            return (len(works), "已有 list.txt，跳过（要重写加 --force）")
        # 覆盖前做个备份 —— 手工排好的顺序重来一遍挺费事的
        backup = college / "list.txt.bak"
        try:
            backup.write_text(listing.read_text(encoding="utf-8"), encoding="utf-8")
            note = "已写入 list.txt（旧的存为 list.txt.bak）"
        except Exception:
            note = "已写入 list.txt（备份失败）"
    else:
        note = None

    if dry:
        return (len(works), f"[预览] 会写入 {len(works)} 行")

    # 一行一个文件名。写 UTF-8（无 BOM），页面按 UTF-8 读
    listing.write_text("\n".join(p.name for p in works) + "\n", encoding="utf-8")
    return (len(works), note or f"已写入 list.txt（{len(works)} 行）")


def main() -> int:
    ap = argparse.ArgumentParser(description="扫描 works/ 生成 list.txt")
    ap.add_argument("--force", action="store_true", help="覆盖已有的 list.txt")
    ap.add_argument("--dry-run", action="store_true", help="只预览，不写文件")
    ap.add_argument("--convert", action="store_true", help="顺便把 jpg/png 转成 webp")
    args = ap.parse_args()

    if not WORKS.is_dir():
        print(f"找不到 {WORKS}", file=sys.stderr)
        return 1

    colleges = sorted([d for d in WORKS.iterdir() if d.is_dir()])
    if not colleges:
        print("works/ 下没有学院目录")
        return 1

    total = written = 0
    print(f"扫描 {len(colleges)} 个学院目录"
          f"{'（预览模式）' if args.dry_run else ''}\n")

    for c in colleges:
        n, status = process(c, args.force, args.dry_run, args.convert)
        total += n
        if status.startswith("已写入"):
            written += 1
        # 只报有内容或需要注意的，全是空目录就安静跳过
        if n or "非 webp" in status:
            print(f"  {c.name}")
            print(f"    {status}")

    print()
    print(f"合计 {total} 件作品，{written} 个目录写了 list.txt")
    if args.dry_run:
        print("（预览模式，没有真的写文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
