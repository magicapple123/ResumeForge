# SPDX-License-Identifier: Apache-2.0
"""#3 用户反馈回归：联系方式换行必须**真的**进 Word（成套导出 = 用户实际下载路径）。

用户原话：「制作台『排版参数 → 联系方式换行』设置后，导出的 Word 里联系方式没有按设置
换行」。Word 只有一条产线（`export_bundle` → `build_export` → `docx_exporter`），
所以这里从**真实 HTTP 接口**下载 zip、解包 docx、再解包 `word/document.xml` 读
OOXML：断言的不是"我传了参数"，而是"docx 里真的有 `w:br`，且落在目标字段前面"。

三条路径都钉住：
1. 制作台**未保存**的草稿版式（请求体 `format_config`）；
2. **已保存**到记录的版式（请求不带 `format_config`，读库）；
3. 旧简历（没有 `contact_breaks`）一个 `w:br` 都不多——否则旧产物会平白多一行。
"""

from __future__ import annotations

import io
import re
import zipfile

CONTACT_CONTENT = {
    "name": "张示例",
    "phone": "13800000000",
    "email": "demo@example.com",
    "city": "上海",
    "birth_year": "2001",
    "github": "https://github.example.com/demo",
    "personal_website": "https://demo.example.com/very/long/path",
    "summary": "一段总结",
}


def _create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "联系方式换行回归（虚构）", "content": CONTACT_CONTENT},
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _bundle_docx(client, resume_id: int, **body) -> bytes:
    """走真实成套导出接口，取 zip 里的 docx 字节。"""
    response = client.post(
        f"/api/resumes/{resume_id}/export-bundle", json={"formats": ["docx"], **body}
    )
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        docx_name = next(name for name in archive.namelist() if name.endswith(".docx"))
        return archive.read(docx_name)


def _document_xml(docx_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as docx:
        return docx.read("word/document.xml").decode("utf-8")


def _force_break_positions(xml: str) -> list[int]:
    """所有 `w:br` 的位置（不把图片/分页等其他 br 算进来：本测试的简历只有页头文字）。"""
    return [match.start() for match in re.finditer(r"<w:br\s*/?>", xml)]


def test_bundle_docx_draft_contact_breaks_land_before_the_target_field(client):
    """草稿版式（未保存）里的 contact_breaks 必须进 Word，且 `w:br` 在个人主页之前。"""
    resume_id = _create_resume(client)
    xml = _document_xml(
        _bundle_docx(client, resume_id, format_config={"contact_breaks": ["personal_website"]})
    )

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1, f"个人主页前应有且只有一个强制换行，实际 {len(breaks)} 个"
    github_at = xml.find("GitHub：https://github.example.com/demo")
    website_at = xml.find("个人主页：https://demo.example.com/very/long/path")
    assert github_at != -1 and website_at != -1, "页头联系方式字段没有进 Word"
    assert github_at < breaks[0] < website_at, "w:br 没有落在 GitHub 与个人主页之间"


def test_bundle_docx_reads_contact_breaks_saved_on_the_record(client):
    """已保存到记录的版式：请求不带 format_config 时也要从库里读到 contact_breaks。"""
    resume_id = _create_resume(client)
    detail = client.get(f"/api/resumes/{resume_id}").json()
    patch = {
        "template": detail["template"],
        "format_name": detail.get("format_name") or "",
        "page_limit": detail["page_limit"],
        "font_scale": detail["font_scale"],
        "format_config": {"contact_breaks": ["personal_website"]},
        "language": detail.get("language") or "zh-CN",
    }
    saved = client.patch(f"/api/resumes/{resume_id}/layout", json=patch)
    assert saved.status_code == 200, saved.text
    assert saved.json()["format_config"]["contact_breaks"] == ["personal_website"]

    xml = _document_xml(_bundle_docx(client, resume_id))  # 不带 format_config

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1, "记录的 contact_breaks 没有进入 Word"
    assert xml.find("GitHub：") < breaks[0] < xml.find("个人主页：")


def test_bundle_docx_without_contact_breaks_keeps_the_old_single_line(client):
    """旧简历（没有这个键）：页头联系方式仍是一整行，一个 `w:br` 都不多。"""
    resume_id = _create_resume(client)
    xml = _document_xml(_bundle_docx(client, resume_id))

    assert _force_break_positions(xml) == []
    # 六个字段都在同一段里（没有强制换行 → 文本连续）。
    assert "GitHub：https://github.example.com/demo" in xml
    assert "个人主页：https://demo.example.com/very/long/path" in xml


def test_single_format_export_endpoint_also_honours_contact_breaks(client):
    """旧的「单格式下载」POST /export 也走同一份 Word 渲染；两条下载入口口径必须一致。"""
    resume_id = _create_resume(client)
    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "docx", "format_config": {"contact_breaks": ["personal_website"]}},
    )
    assert response.status_code == 200, response.text
    xml = _document_xml(response.content)

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1
    assert xml.find("GitHub：") < breaks[0] < xml.find("个人主页：")


def test_bundle_docx_forced_break_can_target_a_middle_field(client):
    """换行目标不是最后一个字段时同样生效（README：在任意字段前强制换行）。"""
    resume_id = _create_resume(client)
    xml = _document_xml(_bundle_docx(client, resume_id, format_config={"contact_breaks": ["city"]}))

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1
    email_at = xml.find("demo@example.com")
    city_at = xml.find("上海")
    assert email_at != -1 and city_at != -1
    assert email_at < breaks[0] < city_at, "w:br 没有落在邮箱与城市之间"
