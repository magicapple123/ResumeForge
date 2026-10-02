"""一次性脚本：把前端投投表情缩成 96px，供专用浏览器注入脚本 base64 内嵌。

为什么要缩：注入脚本在**第三方网页上下文**里运行，素材必须以 base64 data URI 随脚本
携带（禁止直连本地 API）。前端原图是 512px（每张数百 KB），base64 后会让注入脚本
膨胀到无法接受；球体直径只有 54px，96px 已是 2x 视网膜余量。LANCZOS 缩图 + optimize
压缩后每张约 10~20KB，注入体积增量可忽略。

产物**提交入库**（``backend/app/assets/toutou/``）：脚本只在素材更新时重跑一次，
运行时 Python 只读产物，不依赖 Pillow。

用法（在仓库根目录）::

    backend/.venv/Scripts/python.exe backend/scripts/shrink_toutou_assets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO_ROOT / "frontend" / "src" / "assets" / "toutou"
TARGET_DIR = REPO_ROOT / "backend" / "app" / "assets" / "toutou"

# 注入球实际渲染 54px；96px 留出 2x 高清屏余量。
TARGET_SIZE = 96

# 只缩注入侧真正用到的两张：idle 是常态脸，thinking 给"正在回答"备用。
SOURCES = ("ball-idle.png", "ball-thinking.png")


def shrink_all() -> list[Path]:
    """把选中的表情逐张缩到 96×96 并写入产物目录，返回产物路径。"""
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for name in SOURCES:
        source = SOURCE_DIR / name
        target = TARGET_DIR / name.replace(".png", f"-{TARGET_SIZE}.png")
        with Image.open(source) as image:
            resized = image.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)
            resized.save(target, format="PNG", optimize=True)
        outputs.append(target)
        print(f"{source.name} -> {target.relative_to(REPO_ROOT)} ({target.stat().st_size} bytes)")
    return outputs


if __name__ == "__main__":
    shrink_all()
