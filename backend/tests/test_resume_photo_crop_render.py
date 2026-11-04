# SPDX-License-Identifier: Apache-2.0
"""照片裁剪域：校验、非破坏派生、prune 保留规则与 HTML / Word 消费。

从 ``test_resume_render_overrides.py`` 拆出（单文件 500 行预算）：用例与夹具原样搬迁，
断言逐字未改。
"""

from __future__ import annotations

import base64
import io
import re

from app.services.resume import resume_photo_crop
from app.services.resume.resume_photo_crop import photo_sha256
from app.services.resume.resume_render_overrides import prune_overrides, resolve_render_overrides
from PIL import Image
from resume_render_fixtures import PHOTO, _png, _render_resume


def test_photo_crop_domain_validates_rect_and_source():
    good = {
        "version": 1,
        "source": {"sha256": "a" * 64, "width": 100, "height": 200},
        "rect": {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.6},
        "aspect": "3:4",
    }
    assert resume_photo_crop.validate_photo_crop_domain(good) is not None
    for broken in (
        {**good, "source": {"sha256": "A" * 64, "width": 100, "height": 200}},
        {**good, "rect": {"x": 0.8, "y": 0.2, "w": 0.5, "h": 0.6}},
        {**good, "rect": {"x": 0.1, "y": 0.2, "w": 0, "h": 0.6}},
    ):
        assert resume_photo_crop.validate_photo_crop_domain(broken) is None


# ===== 照片裁剪（非破坏派生） =====


def test_photo_crop_renders_a_derived_image_and_keeps_the_source_intact():
    source = _png(40, 20)
    sha = photo_sha256(source)
    config = {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": sha, "width": 40, "height": 20},
            "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0},
            "aspect": "free",
        }
    }
    overrides = resolve_render_overrides(template="classic", format_config=config, photo=source)
    assert overrides.photo_crop is not None
    derived = overrides.photo_for_render(source)
    assert derived != source
    payload = base64.b64decode(derived.partition(",")[2])
    with Image.open(io.BytesIO(payload)) as image:
        assert image.size == (20, 20)  # 水平一半
    # 原图字符串一个字节都没改（非破坏）。
    assert source.startswith("data:image/png;base64,")


def test_photo_crop_is_ignored_when_the_photo_changed():
    config = {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": "f" * 64, "width": 10, "height": 10},
            "rect": {"x": 0, "y": 0, "w": 1, "h": 1},
            "aspect": "free",
        }
    }
    overrides = resolve_render_overrides(template="classic", format_config=config, photo=PHOTO)
    assert overrides.photo_crop is None
    assert overrides.photo_for_render(PHOTO) == PHOTO


def test_photo_sha256_is_the_hash_of_the_data_url_string():
    assert len(photo_sha256(PHOTO)) == 64
    assert photo_sha256(None) == ""
    assert photo_sha256(PHOTO) == photo_sha256(PHOTO)


def _v2_content_with_photo(photo: str) -> dict:
    """v2 文档骨架：照片在 ``header.items`` 里（**没有**顶层 ``photo`` 键）。"""
    return {
        "version": 2,
        "header": {
            "items": [
                {
                    "kind": "field",
                    "id": "ob_head0001",
                    "key": "name",
                    "label": "",
                    "value": "张三",
                    "placement": "name",
                    "format": "text",
                },
                {
                    "kind": "field",
                    "id": "ob_head0002",
                    "key": "photo",
                    "label": "",
                    "value": photo,
                    "placement": "photo",
                    "format": "text",
                },
            ]
        },
        "sections": [],
    }


def _crop_config_for(photo: str) -> dict:
    return {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": photo_sha256(photo), "width": 10, "height": 10},
            "rect": {"x": 0.1, "y": 0.1, "w": 0.8, "h": 0.8},
            "aspect": "free",
        }
    }


def test_prune_keeps_photo_crop_when_v2_header_photo_matches():
    """v2 的照片在 header.items 里：只按顶层 ``photo`` 读会把刚存的裁剪当死数据删掉。"""
    content = _v2_content_with_photo(PHOTO)
    config = _crop_config_for(PHOTO)
    # 没有需要裁的东西 → 返回 None（不写库、也不动 photo_crop）。
    assert prune_overrides(content, config) is None
    # 换一张照片 → sha 不再匹配，裁剪必须被裁掉。
    swapped = _v2_content_with_photo(PHOTO + "x")
    pruned = prune_overrides(swapped, config)
    assert pruned is not None
    assert "photo_crop" not in pruned


def test_prune_still_reads_v1_top_level_photo():
    """v1 兼容路径：顶层 ``photo`` 与 header 并存时仍按原口径比对。"""
    content = {"version": 1, "name": "张三", "photo": PHOTO}
    assert prune_overrides(content, _crop_config_for(PHOTO)) is None
    pruned = prune_overrides({**content, "photo": ""}, _crop_config_for(PHOTO))
    assert pruned is not None
    assert "photo_crop" not in pruned


# ===== 渲染器消费照片裁剪（HTML / Word） =====


def test_photo_crop_reaches_html_and_word():
    import io as _io
    import zipfile

    from app.services.docx_exporter import build_resume_docx
    from app.services.exporter import render_html

    photo = _png(40, 20)
    config = {
        "photo_crop": {
            "version": 1,
            "source": {"sha256": photo_sha256(photo), "width": 40, "height": 20},
            "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0},
            "aspect": "free",
        }
    }
    resume = _render_resume().model_copy(update={"photo": photo})
    html = render_html(resume, format_config=config)
    cropped = re.search(r'<img class="profile-photo" src="data:image/png;base64,([^"]+)"', html)
    assert cropped, "HTML 里应有照片"
    from PIL import Image

    with Image.open(_io.BytesIO(base64.b64decode(cropped.group(1)))) as image:
        assert image.size == (20, 20), "HTML 用的是按 rect 派生的裁剪图"

    document = build_resume_docx(resume, template="classic", page_limit=1, format_config=config)
    with zipfile.ZipFile(_io.BytesIO(document.content)) as bundle:
        assert any(name.startswith("word/media/") for name in bundle.namelist())
