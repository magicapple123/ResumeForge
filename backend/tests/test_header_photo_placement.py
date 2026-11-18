# SPDX-License-Identifier: Apache-2.0
"""I-02：照片被写成 `placement="contact"` 时的读侧容忍与保存侧自愈。

背景：页眉字段「隐藏 → 显示」曾把恢复位置写死成 `contact`，照片的 data URI 因此变成
联系方式文本。HTML 因 `.contact span { white-space: nowrap }` 横向溢出；PDF 一旦存在
任意页眉字段级样式就走 `_contact_glyph_lines` 的逐字符分行，2 万～200 万字符被拆成上万行、
`ensure_space` 逐行续页 —— 页数暴涨且每页都刷满 base64。

两道防线各一个用例，**都不改 `line_break` 的逐字拆行**（那条服务所有正文长 URL，
改动会横向影响正文布局）：

1. `plan_header` 不把图片型 contact 字段放进 `contact_lines`，而是当 `photo`；
2. `prepare_document_for_save_with_report` 把它写回 `placement="photo"`，且在
   `header.photo` 已被占用时**跳过、不重复占用**。
"""

from __future__ import annotations

from app.services.resume.document_io import prepare_document_for_save_with_report
from app.services.resume.document_plan import build_document_plan, plan_to_text
from tests.document_export_samples import make_document

#: 够短、但前缀与真实照片一致的 data URI（判据只看前缀）。
PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

CONTACT_PHOTO_ITEM = {
    "kind": "field",
    "id": "hd_0000ph01",
    "key": "photo",
    "label": "",
    "value": PHOTO,
    "placement": "contact",
    "format": "text",
}


def _document_with_broken_photo() -> dict:
    """在标准样例上追加一个"被写坏"的页眉照片字段（placement=contact + data URI）。"""
    document = make_document()
    document["header"]["items"].append(dict(CONTACT_PHOTO_ITEM))
    return document


def test_plan_does_not_print_a_photo_data_uri_as_contact_text() -> None:
    """图片型 contact 字段不得进联系方式行；整篇可见文本里不能出现 base64 载荷。"""
    plan = build_document_plan(_document_with_broken_photo())

    text = "\n".join(plan_to_text(plan))
    assert "base64" not in text
    assert PHOTO not in text
    # 它被当成照片，而不是被静默丢弃。
    assert plan.header.photo == PHOTO


def test_plan_keeps_the_first_photo_when_two_compete() -> None:
    """`header.photo` 已占用时，contact 里的那张不再顶掉它（不重复占位）。"""
    document = make_document()
    document["header"]["items"].append(
        {
            "kind": "field",
            "id": "hd_0000ph02",
            "key": "photo",
            "label": "",
            "value": "data:image/jpeg;base64,/9j/AAAA",
            "placement": "photo",
            "format": "text",
        }
    )
    document["header"]["items"].append(dict(CONTACT_PHOTO_ITEM))

    plan = build_document_plan(document)
    assert plan.header.photo == "data:image/jpeg;base64,/9j/AAAA"
    text = "\n".join(plan_to_text(plan)).replace("data:image/jpeg;base64,/9j/AAAA", "")
    assert "base64" not in text


def test_saving_heals_the_placement_back_to_photo() -> None:
    """保存时写回 `placement="photo"`：渲染侧的容忍只保证"看起来对"，
    不自愈的话这个键会永远留着，下一次导出仍要走一遍跳过判断。"""
    saved, report = prepare_document_for_save_with_report(_document_with_broken_photo())

    assert report is None  # 本来就是 v2，不算"升级"
    photo_items = [item for item in saved["header"]["items"] if item.get("placement") == "photo"]
    assert len(photo_items) == 1
    assert photo_items[0]["value"] == PHOTO
    # 修好之后 contact 行里不再有它。
    contact_items = [
        item for item in saved["header"]["items"] if item.get("placement") == "contact"
    ]
    assert all(item.get("value") != PHOTO for item in contact_items)


def test_saving_does_not_steal_an_occupied_photo_slot() -> None:
    """`header.photo` 已占用时保存不自愈成两张照片：那个字段留在 contact，
    由 planner 跳过（不静默删用户的字段，也不覆盖已有照片）。"""
    document = make_document()
    document["header"]["items"].append(
        {
            "kind": "field",
            "id": "hd_0000ph03",
            "key": "photo",
            "label": "",
            "value": "data:image/jpeg;base64,/9j/BBBB",
            "placement": "photo",
            "format": "text",
        }
    )
    document["header"]["items"].append(dict(CONTACT_PHOTO_ITEM))

    saved, _ = prepare_document_for_save_with_report(document)
    photo_items = [item for item in saved["header"]["items"] if item.get("placement") == "photo"]
    assert len(photo_items) == 1
    assert photo_items[0]["value"] == "data:image/jpeg;base64,/9j/BBBB"


def test_a_normal_contact_field_is_untouched() -> None:
    """回归：普通联系方式（电话/邮箱）不得被误判成照片。"""
    saved, _ = prepare_document_for_save_with_report(make_document())
    contact_values = [
        item["value"] for item in saved["header"]["items"] if item.get("placement") == "contact"
    ]
    assert "13800000000" in contact_values
    assert "chen@example.com" in contact_values
