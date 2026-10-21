# SPDX-License-Identifier: Apache-2.0
"""精确预览端点（``POST /api/resumes/{id}/preview-pdf``）的契约。

这条端点的存在理由只有一条：**预览显示的必须是导出产物本身**。

在此之前预览用 CSS 多列模拟分页（`column-count`），而导出 PDF 由 `pdf_exporter`（fpdf2）
另排一遍——两套引擎的断点规则不同，"预览 2 页、导出 3 页"是结构性的。要"严格相同"，
唯一可靠的口径是让预览复用同一条管线、同一份参数，然后把产物原样交给浏览器显示。

本文件守五件事：

1. **逐点相同**：同一份简历、同一组参数，``/preview-pdf`` 与 ``/export`` 排出来的
   **每个文字块的位置、字号与文本**完全一致（见 ``test_preview_pdf_matches_the_export_glyph_by_glyph``——
   为什么不比字节：fpdf2 每次都会写 ``/CreationDate`` 与 ``/ID``，同一份内容两次生成也
   不会字节相同，拿它当判据只会得到一条永远红的用例）；
2. **不是导出**：不写「生成内容保存位置」、不冻结交付快照、响应是 ``inline`` + ``no-store``；
3. **草稿可看**：正文里还有【待补】时导出 409、预览仍要 200（预览的对象就是草稿）；
4. **不许夹带导出专有字段**：水印/脱敏/格式在 schema 层就被拒（422），免得"预览突然
   带了水印"这种只在特定调用方下出现的漂移；
5. **同一组输入只排一趟**：往返切口径 / 开大图 / 拖回原值都命中缓存（0ms），参数或正文
   一变就必须重排。命中与未命中给的是同一份字节、同一套响应头——两套口径迟早会漂。
"""

from __future__ import annotations

import pytest
from app.database import SessionLocal
from app.models.resume_delivery import ResumeDeliveryRecord
from app.schemas.resume import ResumeContent, ResumeExperience
from app.services.settings_service import save_export_save_location
from test_pdf_exporter import _text_runs, needs_font

PREVIEW = "/api/resumes/{id}/preview-pdf"
EXPORT = "/api/resumes/{id}/export"

# 命中缓存与真排一趟必须回同一套头。``X-Saved-To`` 不在其中：预览根本不落盘。
_REPLAYED_HEADERS = (
    "Content-Disposition",
    "Cache-Control",
    "X-Content-Sha256",
    "X-Render-Config-Sha256",
    "X-Resume-Pages",
    "X-Resume-Page-Limit",
    "X-Resume-Overflow",
)


def _left_text_x(content: bytes) -> float:
    """PDF 里最靠左的文字的 x（pt）：等价于左页边距。"""
    return min(run[0] for run in _text_runs(content))


def _size_of(content: bytes, needle: str) -> float:
    """某段文字的字号（pt）。按文字定位而不是"取最常见的档位"——短简历里出现最多的

    往往是条目的副行（`.meta` 的 0.93 倍），拿它当正文会量错对象。
    """
    return next(run[2] for run in _text_runs(content) if needle in run[3])


def _y_of(content: bytes, needle: str) -> float:
    """某段文字在页面上的基线 y（pt）。PDF 原点在左下角，所以"往下移"是 y 变小。"""
    return next(run[1] for run in _text_runs(content) if needle in run[3])


def _resume(*, incomplete: bool = False) -> ResumeContent:
    """一份排得进 1 页的简历；``incomplete=True`` 时正文带一处未完成标记。"""
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="zhangsan@example.com",
        job_intent="后端工程师",
        summary=(
            "三年后端开发经验，负责交易系统的设计与落地，熟悉 Python 与分布式存储。"
            if not incomplete
            else "三年后端开发经验，QPS 提升【待补：具体倍数】。"
        ),
        experience=[
            {
                "company": "示例科技",
                "role": "后端工程师",
                "start_date": "2021-03",
                "end_date": "2024-06",
                "description": ["负责订单核心链路优化，平均响应时间从 180ms 降到 45ms。"],
            }
        ],
        skills=[{"name": name, "level": "熟练"} for name in ("Python", "Go", "Redis")],
    )


def _create_resume(client, *, incomplete: bool = False, template: str = "classic") -> int:
    created = client.post(
        "/api/resumes/manual",
        json={
            "title": f"精确预览-{template}",
            "content": _resume(incomplete=incomplete).model_dump(),
            "job_id": None,
        },
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]
    layout = client.patch(f"/api/resumes/{resume_id}/layout", json={"template": template})
    assert layout.status_code == 200, layout.text
    return resume_id


def _delivery_count() -> int:
    with SessionLocal() as db:
        return db.query(ResumeDeliveryRecord).count()


def _count_renders(monkeypatch) -> list[int]:
    """把"真正排版一趟"换成计数器：返回列表的长度就是排了几趟（1 趟 ≈ 一次完整排版）。

    计数点选在 ``fit.render_resume_pdf``——它是"一份 PDF 排一趟"的唯一入口。在 HTTP 层
    计数只能说明"收到了几个请求"，问不到"到底排没排"。
    """
    from app.services.pdf_exporter import fit as fit_module

    calls: list[int] = []
    original = fit_module.render_resume_pdf

    def counting(*args, **kwargs):  # noqa: ANN002, ANN003 - 只数次数，不关心签名
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(fit_module, "render_resume_pdf", counting)
    return calls


@needs_font
def test_preview_pdf_matches_the_export_glyph_by_glyph(client):
    """同参数下预览与导出是**同一份排版**：这就是"严格相同"的定义。

    比较的是 ``_text_runs`` 读出的 ``(x, y, 字号, 文本)`` 序列——逐字、逐点、逐字号。
    它比字节比较更强：字节差异可能只来自时间戳（噪声），而几何/文本一旦错位就是用户
    能看见的差异。
    """
    resume_id = _create_resume(client)
    params = {"page_limit": 1, "format_config": {"page_padding": 12}, "include_photo": True}

    exported = client.post(EXPORT.format(id=resume_id), json={"format": "pdf", **params})
    previewed = client.post(PREVIEW.format(id=resume_id), json=params)

    assert exported.status_code == 200, exported.text
    assert previewed.status_code == 200, previewed.text
    assert _text_runs(previewed.content) == _text_runs(exported.content)
    # 页数头也要一字不差：界面拿它说"实际排了 N 页"。
    assert previewed.headers["X-Resume-Pages"] == exported.headers["X-Resume-Pages"]
    assert previewed.headers["X-Resume-Overflow"] == exported.headers["X-Resume-Overflow"]
    assert previewed.headers["X-Resume-Page-Limit"] == "1"


@needs_font
def test_preview_pdf_renders_inline_and_is_never_cached(client):
    """浏览器内联显示 + no-store：改了版式必须立刻看到新的那一份。"""
    resume_id = _create_resume(client)
    response = client.post(PREVIEW.format(id=resume_id), json={"page_limit": 1})

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["Content-Disposition"].startswith("inline;")
    assert response.headers["Cache-Control"] == "no-store"


@needs_font
def test_preview_pdf_never_writes_a_copy_to_the_save_location(client, tmp_path):
    """预览不是"用户要的文件"：拖一次滑块就多一个文件是不可接受的。"""
    resume_id = _create_resume(client)
    with SessionLocal() as db:
        save_export_save_location(db, str(tmp_path))
        db.commit()

    previewed = client.post(PREVIEW.format(id=resume_id), json={"page_limit": 1})
    assert previewed.status_code == 200, previewed.text
    assert list(tmp_path.iterdir()) == []
    assert "X-Saved-To" not in previewed.headers

    # 对照：同一条管线走真正的导出时，确实会落一份（否则上面那条断言是空转）。
    exported = client.post(EXPORT.format(id=resume_id), json={"format": "pdf", "page_limit": 1})
    assert exported.status_code == 200, exported.text
    assert len(list(tmp_path.iterdir())) == 1
    assert "X-Saved-To" in exported.headers


@needs_font
def test_preview_pdf_does_not_freeze_a_delivery_snapshot(client):
    """预览不产生交付证据：交付账本只记"真的导出过"的那些。"""
    resume_id = _create_resume(client)
    before = _delivery_count()

    previewed = client.post(PREVIEW.format(id=resume_id), json={"page_limit": 1})
    assert previewed.status_code == 200, previewed.text
    assert _delivery_count() == before

    exported = client.post(
        EXPORT.format(id=resume_id),
        json={"format": "pdf", "page_limit": 1, "record_delivery": True},
    )
    assert exported.status_code == 200, exported.text
    assert _delivery_count() == before + 1


@needs_font
def test_preview_pdf_shows_incomplete_drafts_while_export_refuses(client):
    """草稿也能精确预览——这正是它最有用的时刻；导出仍守原来的闸门。"""
    resume_id = _create_resume(client, incomplete=True)

    blocked = client.post(EXPORT.format(id=resume_id), json={"format": "pdf", "page_limit": 1})
    assert blocked.status_code == 409, blocked.text
    assert "待补" in blocked.text

    previewed = client.post(PREVIEW.format(id=resume_id), json={"page_limit": 1})
    assert previewed.status_code == 200, previewed.text
    assert previewed.content.startswith(b"%PDF")


@needs_font
def test_preview_pdf_rejects_export_only_fields(client):
    """水印/脱敏/格式不属于预览：在 schema 层就拒，别让它静默生效。"""
    resume_id = _create_resume(client)

    for payload in (
        {"page_limit": 1, "watermark": "内部资料"},
        {"page_limit": 1, "format": "html"},
        {"page_limit": 1, "redact": True},
        {"page_limit": 1, "record_delivery": True},
    ):
        response = client.post(PREVIEW.format(id=resume_id), json=payload)
        assert response.status_code == 422, f"{payload} 应当被拒：{response.text}"


@needs_font
def test_preview_pdf_honours_the_draft_template(client):
    """草稿里换了样式模板、还没点保存：预览必须按**新模板**排。

    记录上钉的是 classic，请求里给 modern —— 后者是草稿值。2026-10-21 之前这条参数根本
    不存在（预览只认记录里的模板），用户换完模板点「精确」看到的还是旧版式。
    """
    resume_id = _create_resume(client, template="classic")

    classic = client.post(PREVIEW.format(id=resume_id), json={"template": "classic"})
    modern = client.post(PREVIEW.format(id=resume_id), json={"template": "modern"})
    assert classic.status_code == 200, classic.text
    assert modern.status_code == 200, modern.text

    # 两个模板的页眉结构不同（modern 的姓名更大、间距不同）→ 排出来的字形几何必然不同。
    assert _text_runs(classic.content) != _text_runs(modern.content)


@needs_font
def test_preview_pdf_honours_the_draft_format_preset(client):
    """版式模板（预设那一层）同样走草稿值：紧凑 vs 舒展排出来的页边距不一样。"""
    resume_id = _create_resume(client)

    compact = client.post(PREVIEW.format(id=resume_id), json={"format_name": "compact"})
    spacious = client.post(PREVIEW.format(id=resume_id), json={"format_name": "spacious"})
    assert compact.status_code == 200, compact.text
    assert spacious.status_code == 200, spacious.text

    # 页边距 11mm vs 20mm：正文起点向右挪了近 9mm（≈ 34pt），必然能区分开。
    assert _left_text_x(spacious.content) > _left_text_x(compact.content) + 20


@needs_font
def test_preview_pdf_honours_the_draft_layout(client):
    """预览吃的是**草稿**版式：页边距不同，产物就必须不同（否则只是复制了记录默认值）。"""
    resume_id = _create_resume(client)

    narrow = client.post(PREVIEW.format(id=resume_id), json={"format_config": {"page_padding": 8}})
    wide = client.post(PREVIEW.format(id=resume_id), json={"format_config": {"page_padding": 24}})

    assert narrow.status_code == 200, narrow.text
    assert wide.status_code == 200, wide.text
    assert narrow.content != wide.content


@needs_font
def test_preview_pdf_takes_the_draft_font_size_verbatim(client):
    """草稿的 18px 必须**原样**落到纸上（13.5pt），不是"缩到装进一页为止"。

    2026-10-21 用户实测：滑杆拉到最大 18px，精确预览里的字明显更小。旧实现
    （`decide_fit_scale`）会按比例把字号压到 0.5~1.0 之间，于是滑杆上是 18px、纸面上
    是 9px——参数与呈现对不上。``18px × 0.75 = 13.5pt``，正文这一档必须精确等于它。
    """
    resume_id = _create_resume(client)
    response = client.post(
        PREVIEW.format(id=resume_id),
        json={
            "page_limit": 1,
            "font_scale": "large",
            "format_config": {"line_height": 1.4, "page_padding": 12},
        },
    )

    assert response.status_code == 200, response.text
    assert _size_of(response.content, "三年后端开发经验") == pytest.approx(13.5, abs=0.01)


@needs_font
def test_preview_pdf_takes_the_draft_line_height(client):
    """行距同样按草稿排：1.3 与 2.0 印出来的疏密必须量得出差别。

    只断言"产物字节不同"是不够的（任何字段变化都会让字节变），这里量同一对文字的
    垂直距离。两个值都必须在 `FORMAT_FIELDS` 的 1.2–2.2 之内——越界的覆盖会被
    `validated_format_config` **整键丢弃**、回落到模板默认值，那测的就不是行距了。
    """
    resume_id = _create_resume(client)

    def header_gap(line_height: float) -> float:
        response = client.post(
            PREVIEW.format(id=resume_id),
            json={
                "page_limit": 1,
                "font_scale": "large",
                "format_config": {"line_height": line_height},
            },
        )
        assert response.status_code == 200, response.text
        # 姓名与联系方式两行的基线距离：它随行距单调增长。
        return _y_of(response.content, "张三") - _y_of(response.content, "13800000000")

    assert header_gap(2.0) > header_gap(1.3) + 1.0


@needs_font
def test_overflowing_draft_is_truncated_without_shrinking_the_font(client):
    """装不下就**截断 + 标记 overflow**，绝不为了塞进一页把 18px 压成 9px。

    这是"参数即呈现"最容易在实现里走回头路的地方：给 ``_ResumePDF`` 传上限时若忘了
    同时关掉 fpdf2 的自动分页，或者又加回一轮"按比例缩到装得下"，用户看到的就是
    一份"字变小了、但没有任何提示"的 PDF。
    """
    long_content = _resume().model_copy(
        update={
            "experience": [
                ResumeExperience(
                    company=f"示例科技{index}",
                    role="后端工程师",
                    start_date="2021-03",
                    end_date="2024-06",
                    description=[
                        f"负责订单核心链路优化，第 {index} 段：平均响应时间从 180ms 降到 45ms。"
                        for _ in range(6)
                    ],
                )
                for index in range(8)
            ]
        }
    )
    created = client.post(
        "/api/resumes/manual",
        json={"title": "长简历", "content": long_content.model_dump(), "job_id": None},
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]

    response = client.post(
        PREVIEW.format(id=resume_id),
        json={
            "page_limit": 1,
            "font_scale": "large",
            "format_config": {"line_height": 1.4, "page_padding": 12},
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["X-Resume-Overflow"] == "true"
    assert response.headers["X-Resume-Pages"] == "1"
    assert int(response.headers["X-Resume-Pages-Needed"]) > 1
    # 关键：正文仍然是 18px。缩过字号的话这里会冒出一个 9pt 上下的正文档。
    assert _size_of(response.content, "三年后端开发经验") == pytest.approx(13.5, abs=0.01)


@needs_font
def test_preview_pdf_serves_identical_bytes_and_headers_from_the_cache(client, monkeypatch):
    """同一组输入第二次进来**不再排版**，字节与响应头都与第一趟逐字一致。

    这是"切口径 → 切回来、开大图、拖回原值"能瞬间回到原图的原因：命中在**渲染之前**短路
    （``services.pdf_preview_cache``），不是排完再挑一份。
    """
    renders = _count_renders(monkeypatch)
    resume_id = _create_resume(client)
    payload = {"page_limit": 1, "format_config": {"page_padding": 12}}

    first = client.post(PREVIEW.format(id=resume_id), json=payload)
    second = client.post(PREVIEW.format(id=resume_id), json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert len(renders) == 1, f"同一组参数排了 {len(renders)} 趟，应当只有 1 趟"
    assert second.content == first.content
    for header in _REPLAYED_HEADERS:
        assert second.headers[header] == first.headers[header], header

    # 导出**不许**读这份缓存：它还要顺手落一份副本（``save_copy=True``），命中缓存会把落盘
    # 一起跳过；而且同一组参数下两者的渲染指纹本来就相同，一不小心就会串。
    exported = client.post(EXPORT.format(id=resume_id), json={"format": "pdf", **payload})
    assert exported.status_code == 200, exported.text
    assert len(renders) == 2, "导出读了预览缓存"


@needs_font
def test_preview_pdf_rerenders_only_when_the_inputs_change(client, monkeypatch):
    """A → B → A 只排两趟；改了正文就必须再排一趟。

    这条同时守两端：**不许漏排**（换了参数/改了内容还端出旧 PDF）与**不许重排**
    （拖回原值又排一遍，正是用户抱怨的那半秒卡顿）。
    """
    renders = _count_renders(monkeypatch)
    resume_id = _create_resume(client)
    narrow = {"page_limit": 1, "format_config": {"page_padding": 8}}
    wide = {"page_limit": 1, "format_config": {"page_padding": 24}}

    first = client.post(PREVIEW.format(id=resume_id), json=narrow)
    second = client.post(PREVIEW.format(id=resume_id), json=wide)
    third = client.post(PREVIEW.format(id=resume_id), json=narrow)

    assert [item.status_code for item in (first, second, third)] == [200, 200, 200]
    assert len(renders) == 2, f"三趟请求排了 {len(renders)} 次，应当 A、B 各一次"
    # 换版式必须真的换一张：页边距 8mm vs 24mm 差着 45pt，排出来不可能一样。
    assert second.content != first.content
    # 拖回原值给的是原来那一份（逐字节），不是"又排了一遍的相似结果"。
    assert third.content == first.content

    # 正文换了 → 缓存键的前半（内容指纹）就变 → 必须重排，绝不能把旧内容的 PDF 端出来。
    changed = _resume().model_copy(update={"summary": "四年后端开发经验，带过三人小组。"})
    assert client.put(f"/api/resumes/{resume_id}", json=changed.model_dump()).status_code == 200

    fourth = client.post(PREVIEW.format(id=resume_id), json=narrow)

    assert fourth.status_code == 200, fourth.text
    assert len(renders) == 3, "改过正文却仍然命中旧缓存"
    assert fourth.content != first.content
