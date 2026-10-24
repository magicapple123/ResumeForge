# SPDX-License-Identifier: Apache-2.0
"""W04：精确预览要排**还没保存**的正文。

单独成文件的两个理由：① ``test_preview_pdf.py`` 已经贴着测试行数预算；② 这一条
守的性质与前一条端点契约不同——它守的是"预览与用户眼前的草稿是同一份内容"。

共用同一套夹具（``_create_resume`` / ``_resume`` / ``_text_runs``）：预览与导出必须
走同一条管线，夹具各写一份迟早会漂。
"""

from __future__ import annotations

from test_pdf_exporter import _text_runs, needs_font
from test_preview_pdf import PREVIEW, _create_resume, _resume


@needs_font
def test_preview_pdf_renders_the_unsaved_content(client):
    """W04 / P0-03：中栏改了正文、还没点保存，精确预览必须显示新内容。

    ``content`` 覆盖只服务预览（不落库、不冻结交付）。三条一起钉住：
    ① 带覆盖 → 排出的是覆盖后的文字；
    ② 不带覆盖 → 回到记录里那一版（旧客户端逐字不变）；
    ③ 两次覆盖内容不同 → 内容指纹进缓存键，不能命中上一份。

    比对的是**文字**而不是字节：fpdf2 每次都会写 ``/CreationDate`` 与 ``/ID``。
    """
    resume_id = _create_resume(client)
    saved = _resume()
    assert "三年" in saved.summary

    def drawn_text(**payload) -> str:
        response = client.post(PREVIEW.format(id=resume_id), json={"page_limit": 2, **payload})
        assert response.status_code == 200, response.text
        return "".join(run[3] for run in _text_runs(response.content))

    unsaved = _resume().model_copy(update={"summary": "【草稿】这条总结还没保存到数据库。"})
    with_draft = drawn_text(content=unsaved.model_dump())
    assert "这条总结还没保存到数据库" in with_draft
    assert "三年后端开发经验" not in with_draft

    # 不带覆盖：记录里那一版（预览没有偷偷把草稿写回数据库）。
    assert "三年后端开发经验" in drawn_text()

    # 换一份草稿内容 → 不许命中上一份的缓存（内容指纹在缓存键的前半）。
    another = _resume().model_copy(update={"summary": "【草稿二】又改了一句完全不同的话。"})
    changed = drawn_text(content=another.model_dump())
    assert "又改了一句完全不同的话" in changed
    assert "这条总结还没保存到数据库" not in changed

    # 覆盖不会落库：详情里的正文仍是已保存那一版。
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert detail["content"]["summary"] == saved.summary
