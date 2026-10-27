# SPDX-License-Identifier: Apache-2.0
"""图片 / 文本工具（拼接、照片解码、按原比例装进照片框）。"""
from __future__ import annotations


def _join(values: list[str], separator: str = " · ") -> str:
    return separator.join(str(item).strip() for item in values if str(item).strip())


def _photo_bytes(data_url: str) -> bytes | None:
    import base64
    import binascii

    _, separator, encoded = data_url.partition(",")
    if not separator:
        return None
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None


def fit_photo_size(data: bytes, box_width_mm: float, box_height_mm: float) -> tuple[float, float]:
    """按**原图比例**把照片缩进模板照片框（`object-fit: contain` 的等价物）。

    ## 为什么不再是 object-fit: cover

    2026-10 用户反馈"照片裁剪未生效、默认还被强制裁成模板框比例"：模板 `.profile-photo`
    固定宽高 + `object-fit: cover` 会把照片**再裁一次**（服务端已经按 `photo_crop` 派生过
    一次裁剪，CSS 又从中间切掉一块），用户看不到自己设置的取景。现在 HTML 侧改成
    `object-fit: contain`，PDF / Word 必须用同一口径，否则"预览保比例、导出被裁"——
    正是三种产物各说各话的老问题。

    默认（没有 `photo_crop`）时 contain 显示的就是原图比例，不裁切、不溢出照片框；
    有裁剪参数时服务端已把照片派生为裁剪后的图，contain 显示的就是用户选的那块取景。

    ## 返回

    `(纸面宽 mm, 纸面高 mm)`：按原图宽高比等比缩放到**恰好装进** box（可以缩小也可以
    放大；宽高比与图片完全一致，因此交给 fpdf2 / python-docx 的 w/h 不会造成变形）。
    EXIF Orientation 会先转正再取比例：手机竖拍的像素尺寸与"显示出来的宽高比"可能相反，
    不做这一步，竖拍照片在 PDF 里会按横图比例被压扁。

    纯函数、只依赖 Pillow（fpdf2 的既有依赖），便于离线单测。解码失败会抛出 Pillow 的
    异常——调用方（PDF / Word）已有"照片坏了就跳过导出"的兜底，不在这里吞。
    """
    from io import BytesIO

    from PIL import Image, ImageOps

    with Image.open(BytesIO(data)) as source:
        image = ImageOps.exif_transpose(source)
        width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError(f"图片尺寸不合法：{width}x{height}")
    if box_width_mm <= 0 or box_height_mm <= 0:
        raise ValueError(f"照片框尺寸不合法：{box_width_mm}x{box_height_mm}")
    # 统一的缩放系数：宽高同乘，宽高比不变；取"更紧"的那条边 = contain。
    scale = min(box_width_mm / width, box_height_mm / height)
    return width * scale, height * scale
