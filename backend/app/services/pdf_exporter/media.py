"""图片 / 文本工具（拼接、照片解码、居中裁剪）。"""
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


def crop_image_to_cover(data: bytes, target_ratio: float) -> bytes:
    """把图片**居中裁剪**成 ``target_ratio``（宽/高）——`object-fit: cover` 的等价物。

    模板里 `.profile-photo` 是 `object-fit: cover`：保持宽高比、居中裁剪、填满目标框。
    而 fpdf2 的 ``image()`` 在同时给定 ``w`` 与 ``h`` 时会**强制拉伸**到该尺寸，不先裁剪
    的话，用户照片的宽高比一旦与模板照片框（`photo_width_ratio / photo_height_ratio`）
    不同就会变形——这正是"PDF 里照片被压扁"的来源。Word 侧共用本函数保持同一口径。

    纯函数、只依赖 Pillow（fpdf2 的既有依赖，已锁定在 requirements.txt），便于离线单测。
    EXIF 方向（Orientation）顺带转正（手机竖拍不转正的话，裁出来的仍是躺倒的）。比例
    已经一致且无方向信息时**原样返回**，避免一次无谓的重编码损伤画质。解码失败会抛出
    Pillow 的异常——调用方（PDF / Word）已有"照片坏了就跳过导出"的兜底，不在这里吞。
    """
    from io import BytesIO

    from PIL import Image, ImageOps
    from PIL.ExifTags import Base as ExifBase

    with Image.open(BytesIO(data)) as source:
        fmt = (source.format or "PNG").upper()
        # 部分手机拍出的多帧 JPEG 会被 Pillow 认成 MPO，按 MPO 存回去 fpdf2 解不了。
        if fmt == "MPO":
            fmt = "JPEG"
        image = ImageOps.exif_transpose(source)
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError(f"图片尺寸不合法：{width}x{height}")
        ratio = width / height
        if abs(ratio - target_ratio) <= 1e-9:
            # 比例已经一致：只有 EXIF 方向需要转正时才值得重编码，否则原样返回。
            # （`exif_transpose` 没有可转正的内容时也会返回一个副本，不能用对象同一性判断。）
            orientation = source.getexif().get(ExifBase.Orientation, 1)
            if orientation in (0, 1):
                return data
        if ratio > target_ratio:
            # 太宽：左右各裁掉一点，保持高度。
            new_width = max(1, round(height * target_ratio))
            left = (width - new_width) // 2
            image = image.crop((left, 0, left + new_width, height))
        else:
            # 太高：上下各裁掉一点，保持宽度。
            new_height = max(1, round(width / target_ratio))
            top = (height - new_height) // 2
            image = image.crop((0, top, width, top + new_height))
        if fmt == "JPEG" and image.mode not in ("RGB", "L", "CMYK"):
            # JPEG 不支持透明通道（RGBA 存不回去），先落到 RGB。
            image = image.convert("RGB")
        buffer = BytesIO()
        image.save(buffer, format=fmt)
        return buffer.getvalue()
