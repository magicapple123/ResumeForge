# SPDX-License-Identifier: Apache-2.0
"""W15/D09 照片非破坏裁剪域：校验 + 计划 + 派生产物（Wave2 第 3 册 §7.1）。

形状（第 1 册 §1.2 冻结）：

    photo_crop = {
      "version": 1,
      "source": {"sha256": "64 位小写十六进制", "width": int, "height": int},
      "rect": {"x": 0..1, "y": 0..1, "w": 0<w<=1, "h": 0<h<=1},
      "aspect": "free" | "1:1" | "4:5" | "3:4",
    }

**非破坏**：原图（content.photo 的 data URL）一个字节都不改；渲染时按 rect 派生出裁剪后的
图片数据（``cropped_photo_data_url``），HTML/PDF/Word 三个渲染器消费同一份派生结果——
这样"HTML 裁一半、PDF 裁另一半"这类偏差从结构上不可能出现。

**失效判据**：source.sha256 是**当前照片 data URL 字符串**的 sha256（不解码，零成本）；
不一致（用户换了照片）→ 计划失效返回 None，渲染走原图（保存时再由 prune 清掉死域）。
"""

from __future__ import annotations

import base64
import hashlib
import io
from dataclasses import dataclass

from .resume_config_domains import domain_version, is_supported

ASPECTS: tuple[str, ...] = ("free", "1:1", "4:5", "3:4")
MAX_SIDE = 20_000


@dataclass(frozen=True)
class PhotoCropPlan:
    sha256: str
    width: int
    height: int
    x: float
    y: float
    w: float
    h: float
    aspect: str = "free"

    def to_domain(self) -> dict:
        """写回 format_config 的形状（与校验输出逐键一致）。"""
        return {
            "version": 1,
            "source": {"sha256": self.sha256, "width": self.width, "height": self.height},
            "rect": {"x": self.x, "y": self.y, "w": self.w, "h": self.h},
            "aspect": self.aspect,
        }


def photo_sha256(photo: str | None) -> str:
    """当前照片 data URL 字符串的 sha256（契约：不解码）。空照片返回空串。"""
    return hashlib.sha256((photo or "").encode("utf-8")).hexdigest() if photo else ""


def _as_unit(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _valid_source(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    sha = raw.get("sha256")
    width = raw.get("width")
    height = raw.get("height")
    if (
        not isinstance(sha, str)
        or len(sha) != 64
        or any(ch not in "0123456789abcdef" for ch in sha)
    ):
        return None
    if isinstance(width, bool) or isinstance(height, bool):
        return None
    if not isinstance(width, int) or not isinstance(height, int):
        return None
    if not (1 <= width <= MAX_SIDE and 1 <= height <= MAX_SIDE):
        return None
    return {"sha256": sha, "width": width, "height": height}


def _valid_rect(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    x, y = _as_unit(raw.get("x")), _as_unit(raw.get("y"))
    w, h = _as_unit(raw.get("w")), _as_unit(raw.get("h"))
    if x is None or y is None or w is None or h is None:
        return None
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
        return None
    if x + w > 1.0 + 1e-6 or y + h > 1.0 + 1e-6:
        return None
    return {"x": round(x, 6), "y": round(y, 6), "w": round(w, 6), "h": round(h, 6)}


def validate_photo_crop_domain(raw: object) -> dict | None:
    """§7.1 白名单校验；空域 / 版本不支持 / 形状不合法返回 None（不落库）。"""
    version = domain_version(raw)
    if not is_supported("photo_crop", version) or not isinstance(raw, dict):
        return None
    source = _valid_source(raw.get("source"))
    rect = _valid_rect(raw.get("rect"))
    if source is None or rect is None:
        return None
    aspect = raw.get("aspect", "free")
    if aspect not in ASPECTS:
        aspect = "free"
    return {"version": 1, "source": source, "rect": rect, "aspect": aspect}


def resolve_photo_crop(format_config: dict | None, photo: str | None) -> PhotoCropPlan | None:
    """读并校验裁剪域；哈希与当前照片不一致（换了照片）→ None。纯函数，不抛异常。"""
    if not isinstance(format_config, dict):
        return None
    domain = validate_photo_crop_domain(format_config.get("photo_crop"))
    if domain is None:
        return None
    if domain["source"]["sha256"] != photo_sha256(photo):
        return None
    rect = domain["rect"]
    return PhotoCropPlan(
        sha256=domain["source"]["sha256"],
        width=domain["source"]["width"],
        height=domain["source"]["height"],
        x=rect["x"],
        y=rect["y"],
        w=rect["w"],
        h=rect["h"],
        aspect=domain["aspect"],
    )


def _decode_photo(photo: str) -> bytes:
    """data URL → 图片字节（坏图由调用方兜底成"不裁剪"）。"""
    _header, _, payload = photo.partition(",")
    return base64.b64decode(payload, validate=False)


def _encode_png(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def cropped_photo_data_url(photo: str | None, plan: PhotoCropPlan | None) -> str:
    """按 rect 派生出裁剪后的 data URL；无计划 / 坏图时原样返回（默认零变化）。"""
    if not photo or plan is None:
        return photo or ""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow 是既有运行依赖
        return photo
    try:
        with Image.open(io.BytesIO(_decode_photo(photo))) as image:
            width, height = image.size
            left = int(round(plan.x * width))
            top = int(round(plan.y * height))
            right = int(round((plan.x + plan.w) * width))
            bottom = int(round((plan.y + plan.h) * height))
            right = max(left + 1, min(right, width))
            bottom = max(top + 1, min(bottom, height))
            cropped = image.convert("RGB" if image.mode in {"P", "CMYK"} else image.mode)
            cropped = cropped.crop((left, top, right, bottom))
            buffer = io.BytesIO()
            cropped.save(buffer, format="PNG")
    except Exception:  # noqa: BLE001 - 坏图不能阻断导出：退回原图
        return photo
    return _encode_png(buffer.getvalue())


__all__ = [
    "ASPECTS",
    "MAX_SIDE",
    "PhotoCropPlan",
    "cropped_photo_data_url",
    "photo_sha256",
    "resolve_photo_crop",
    "validate_photo_crop_domain",
]
