"""一次性脚本：把历历的原画切成注入脚本内嵌的透明底素材。

为什么不能用"离白多远就抠多透明"那种简单办法：历历球体内部有**大片白色**（文档角色
本身、左上的高光），按白度抠图会把它们抠成洞。所以这里改用**从四边洪水填充**——只有
与画面边界连通的白色才算背景，球体内部的白色一律保留。

同样要保住的两样东西（用户明确提过，上一版就是在这里出的错）：
- 右上角探出球体的**金色星星**；
- 球体下方的**柔和投影**。
两者都在内容包围盒里，裁切时按内容重新定框并留边，不按原画的 1024 方框硬缩。

素材会以 base64 随注入脚本进第三方页面，所以产物要小：128px、PNG optimize。

源图 ``deliverables/mascot/02-投投-悬浮球B-简历球.png`` 在 ``.gitignore`` 里（美术原图
不入库），所以这个脚本只在**更新素材时在本机重跑**，产物提交入库。

用法（仓库根目录）::

    backend/.venv/Scripts/python.exe backend/scripts/build_lili_orb.py
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE = REPO_ROOT / "deliverables" / "mascot" / "02-投投-悬浮球B-简历球.png"
TARGET = REPO_ROOT / "backend" / "app" / "assets" / "lili" / "lili-orb-128.png"

# 注入球渲染 64px，2x 视网膜屏需要 128px。
TARGET_SIZE = 128
# 判定"这是背景白"的容差：原画背景是 (255,253,255) 一类，给一点余量。
# **只把接近纯白的算背景**：球下那层投影要原样留着（它是原画的一部分，用户明确要求
# 不许裁掉，也不该被抠成半透明——那会让影子淡到看不见）。
BACKGROUND_TOLERANCE = 8
# 边界起 2 像素内按"离白多远"给渐变 alpha，避免球体边缘留下一圈白边。
EDGE_RAMP = 60
EDGE_PIXELS = 2
# 内容四周留的空白比例（相对内容长边）：星星和投影才不会贴着画布边。
MARGIN_RATIO = 0.05


def _background_mask(pixels, width: int, height: int) -> bytearray:
    """从四边洪水填充出「与边界连通、且接近纯白」的背景像素。"""
    mask = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_white(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        return max(255 - red, 255 - green, 255 - blue) <= BACKGROUND_TOLERANCE

    for x in range(width):
        for y in (0, height - 1):
            if is_white(x, y) and not mask[y * width + x]:
                mask[y * width + x] = 1
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if is_white(x, y) and not mask[y * width + x]:
                mask[y * width + x] = 1
                queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        for next_x, next_y in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if not (0 <= next_x < width and 0 <= next_y < height):
                continue
            index = next_y * width + next_x
            if mask[index] or not is_white(next_x, next_y):
                continue
            mask[index] = 1
            queue.append((next_x, next_y))
    return mask


def _edge_depth(mask: bytearray, width: int, height: int) -> dict[int, int]:
    """非背景像素到背景的距离（1..EDGE_PIXELS）；更远的记 EDGE_PIXELS+1。"""
    depth: dict[int, int] = {}
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if mask[index]:
                continue
            best = EDGE_PIXELS + 1
            for distance in range(1, EDGE_PIXELS + 1):
                near = any(
                    0 <= x + dx * distance < width
                    and 0 <= y + dy * distance < height
                    and mask[(y + dy * distance) * width + (x + dx * distance)]
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                )
                if near:
                    best = distance
                    break
            depth[index] = best
    return depth


def cut_out(source: Image.Image) -> Image.Image:
    """抠掉与边界连通的背景白，返回带 alpha 的图。

    球体内部的白色（文档角色、左上高光）不与边界连通，因此**不会**被抠成洞；
    投影不是纯白，也不会被当成背景——它按原样保留。
    """
    rgb = source.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()

    background = _background_mask(pixels, width, height)
    depth = _edge_depth(background, width, height)
    result = Image.new("RGBA", (width, height))
    out: list[tuple[int, int, int, int]] = []
    for y in range(height):
        for x in range(width):
            index = y * width + x
            red, green, blue = pixels[x, y]
            if background[index]:
                out.append((0, 0, 0, 0))
                continue
            near = depth[index]
            if near > EDGE_PIXELS:
                out.append((red, green, blue, 255))
                continue
            distance = max(255 - red, 255 - green, 255 - blue)
            ratio = min(1.0, distance / (EDGE_RAMP / near))
            if ratio <= 0.04:
                out.append((0, 0, 0, 0))
                continue
            # 反解白底：观测值 = 比率 × 物体色 + (1 - 比率) × 255。
            out.append(
                tuple(
                    [
                        max(0, min(255, round((value - (1 - ratio) * 255) / ratio)))
                        for value in (red, green, blue)
                    ]
                    + [round(ratio * 255)]
                )
            )
    result.putdata(out)
    return result


def normalize(cut: Image.Image) -> Image.Image:
    """按内容重新定框（含星星与投影），补成正方形并留边，再缩到目标尺寸。"""
    box = cut.getchannel("A").point(lambda value: 255 if value > 8 else 0).getbbox()
    if box is None:
        raise SystemExit("抠完什么都没有：检查背景容差")
    content = cut.crop(box)
    side = round(max(content.size) * (1 + MARGIN_RATIO * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(
        content,
        ((side - content.width) // 2, (side - content.height) // 2),
    )
    return canvas.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"找不到原画：{SOURCE}（`deliverables/` 不入库，只在本机有）")
    with Image.open(SOURCE) as image:
        cut = cut_out(image)
    orb = normalize(cut)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    orb.save(TARGET, format="PNG", optimize=True)
    solid = orb.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    print(f"{SOURCE.name} -> {TARGET.relative_to(REPO_ROOT)}")
    print(f"  尺寸 {orb.size[0]}×{orb.size[1]}，{TARGET.stat().st_size} bytes")
    print(f"  内容包围盒 {solid.getbbox()}（应当四边都留白，星与投影都在里面）")
    print(f"  四角 alpha {[orb.getchannel('A').getpixel(xy) for xy in [(0, 0), (TARGET_SIZE - 1, 0), (0, TARGET_SIZE - 1), (TARGET_SIZE - 1, TARGET_SIZE - 1)]]}")


if __name__ == "__main__":
    main()
