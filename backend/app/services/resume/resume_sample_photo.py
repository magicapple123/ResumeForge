# SPDX-License-Identifier: Apache-2.0
"""模板预览示例简历的那张照片（单独一个模块，只放常量）。

**为什么单独一个文件**：这张图以 data URL 内嵌，base64 约 5 千字符。塞进
``resume_sample.py`` 会把业务逻辑挤到文件末尾、也让"示例内容长什么样"这件事
难以阅读；而且它来自一份静态素材，与文案的变更频率完全不同。

素材：一张虚构的卡通头像（白底、戴金丝眼镜的蓝色猫），**不含任何真实个人信息**。
按资料页证件照框的比例与尺寸（132×176 px，见 ``frontend/src/styles/profile.css``
的 ``.profile-photo-frame``）等比 cover 居中裁切，白底填充，JPEG quality 82（目标
< 15 KB）。生成方式记在这里，换图时照同样口径重做即可：

    ImageOps.fit(source, (132, 176), method=Image.LANCZOS, centering=(0.5, 0.45))
    → 转 RGB、save(BytesIO, "JPEG", quality=82, optimize=True)

产物必须能过 ``schemas/profile.py::validate_photo_data_url``：``data:image/jpeg``
前缀 + 合法 base64 + JPEG 文件签名（``\\xff\\xd8\\xff``）。当前 JPEG 3672 字节、
base64 4896 字符（data URL 共 4919 字符），远低于 5 MB 上限。
"""

from __future__ import annotations

# 长串按行切开拼接：ruff 的行长上限是 100，单个几 KB 的字面量必然越线；
# 括号内的相邻字符串字面量在编译期就合并成一个，运行时零成本。
_PHOTO_BASE64 = (
    "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"
)

SAMPLE_PHOTO_DATA_URL: str = f"data:image/jpeg;base64,{_PHOTO_BASE64}"

__all__ = ["SAMPLE_PHOTO_DATA_URL"]
