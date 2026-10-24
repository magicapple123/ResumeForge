# SPDX-License-Identifier: Apache-2.0
"""简历正文的分区顺序：定义、归一化，以及"四个渲染器读的是同一份"。

为什么值得一个测试文件：顺序一旦在某个渲染器里写死，用户在预览里拖好的顺序就会
**只在预览生效**——导出的 PDF / Word / Markdown / txt 还是老顺序。那类问题不报错，
用户只会说"导出的和看到的不一样"，而这正是本项目最忌讳的一类差异
（`exporter.py` 的 docstring 记着一次同源教训：预览里有性别与出生年、md 里没有）。
"""

from __future__ import annotations

import io
import re

from app.schemas.profile import PROFILE_SECTION_KEYS
from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown, render_html
from app.services.profile.profile_service import get_or_create_profile
from app.services.resume.resume_sections import (
    DEFAULT_SECTION_ORDER,
    PROFILE_SECTION_TO_RESUME,
    default_section_order_config,
    normalized_section_order,
    profile_order_to_section_order,
    profile_to_resume_order,
    resolved_section_order,
)
from app.services.txt_exporter import export_txt

# 七个分区对应的标题文案。渲染器写的是文案，测试按文案找位置——文案本身在
# resume_sections.py 的 SECTION_LABELS 里定义，这里只负责"顺序"这一件事。
TITLES = (
    "个人总结",
    "教育经历",
    "实习/工作经历",
    "校园经历",
    "项目经历",
    "论文发表",
    "科研项目",
    "专利",
    "专业技能",
    "荣誉奖项",
)

# 挑一个与默认顺序差异最大的排列：默认是 教育 → 实习 → 项目 → 技能 → 校园 → 奖项 → 总结。
CUSTOM_ORDER = [
    "projects",
    "publications",
    "research_projects",
    "patents",
    "experience",
    "summary",
    "awards",
    "skills",
    "education",
    "campus_experience",
]

CUSTOM_CONFIG = {"section_order": CUSTOM_ORDER}


def _sample_resume() -> ResumeContent:
    return ResumeContent(
        name="张示例",
        summary="总结文字",
        education=[{"school": "示例大学", "major": "示例专业", "degree": "本科"}],
        experience=[{"company": "示例科技有限公司", "role": "示例岗位"}],
        campus_experience=[{"organization": "示例社团"}],
        projects=[{"name": "示例项目"}],
        publications=[{"title": "示例论文", "venue": "示例期刊"}],
        research_projects=[{"name": "示例科研项目"}],
        patents=[{"title": "示例专利"}],
        skills=[{"name": "Python"}],
        awards=[{"name": "示例奖项"}],
    )


def _title_positions(text: str) -> list[tuple[str, int]]:
    return [(title, text.find(title)) for title in TITLES]


def _assert_follows_order(texts: dict[str, str]) -> None:
    """每个输出里，自定义顺序的标题都应按给定先后出现。"""
    for name, text in texts.items():
        positions = [(title, text.find(title)) for title, _ in _title_positions(text)]
        missing = [title for title, position in positions if position < 0]
        assert not missing, f"{name} 缺少分区标题：{missing}"
        order_in_output = [title for title, _ in sorted(positions, key=lambda item: item[1])]
        assert order_in_output == [
            "项目经历",
            "论文发表",
            "科研项目",
            "专利",
            "实习/工作经历",
            "个人总结",
            "荣誉奖项",
            "专业技能",
            "教育经历",
            "校园经历",
        ], f"{name} 的分区顺序不对：{order_in_output}"


def test_default_order_matches_the_product_decision():
    """默认顺序 = 产品拍板的「教育优先」口径（2026-10）。

    这条是刻意的护栏：分区顺序是**有历史记录的产物**的呈现方式，改默认顺序等于把
    没有自己的 ``section_order`` 的简历换一个样子。要改它必须显式改这里并说清理由；
    已保存简历读的是自己那条 ``format_config.section_order``，不受这里影响。
    """
    assert list(DEFAULT_SECTION_ORDER) == [
        "education",
        "experience",
        "projects",
        "publications",
        "research_projects",
        "patents",
        "skills",
        "campus_experience",
        "awards",
        "summary",
    ]


def test_normalized_order_is_always_a_complete_permutation():
    """归一化结果永远是七个键的完整排列——缺失的键按默认顺序补齐。"""
    assert normalized_section_order(["projects", "experience"]) == [
        "projects",
        "experience",
        "education",
        "publications",
        "research_projects",
        "patents",
        "skills",
        "campus_experience",
        "awards",
        "summary",
    ]
    # 重复键只保留一次；未知键被丢掉而不是报错（它是版式配置的一部分，
    # 抛异常会让整份版式配置失效）。
    assert normalized_section_order(["projects", "projects", "unknown", "summary"]) == [
        "projects",
        "summary",
        "education",
        "experience",
        "publications",
        "research_projects",
        "patents",
        "skills",
        "campus_experience",
        "awards",
    ]
    assert normalized_section_order(None) == list(DEFAULT_SECTION_ORDER)
    assert normalized_section_order("summary,projects") == normalized_section_order(
        ["summary", "projects"]
    )


def test_resolved_order_reads_format_config_and_falls_back():
    assert resolved_section_order(None) == list(DEFAULT_SECTION_ORDER)
    assert resolved_section_order({}) == list(DEFAULT_SECTION_ORDER)
    assert resolved_section_order(CUSTOM_CONFIG) == CUSTOM_ORDER
    # 键缺失（而不是设成默认值）要能区分开：没有就是没有。
    assert "section_order" not in {}


# ===== 「我的资料」顺序 -> 简历正文顺序 =====
# 生成界面的默认顺序取这一份映射：用户在资料页把项目拖到最前面，生成出来的简历也该是
# 项目在前。两边的键名本来不同（资料页是复数子表名，正文是单数分区键），所以映射必须是
# 显式的——用"去掉 s"之类的字符串魔法会在 `summary` 上直接翻车。


def test_profile_keys_map_onto_every_resume_section():
    """映射覆盖资料页可排的分区；W14 科研三栏目**故意不在映射里**（资料页无对应子表）。"""
    assert set(PROFILE_SECTION_TO_RESUME.values()) <= set(DEFAULT_SECTION_ORDER)
    assert set(DEFAULT_SECTION_ORDER) - set(PROFILE_SECTION_TO_RESUME.values()) == {
        "publications",
        "research_projects",
        "patents",
    }
    for profile_key, resume_key in PROFILE_SECTION_TO_RESUME.items():
        assert isinstance(profile_key, str) and profile_key, "资料侧的键不能为空"
        assert resume_key in DEFAULT_SECTION_ORDER, resume_key
    # `basic_info` 刻意不在映射里：它是页眉，不参与正文排序。
    assert "basic_info" not in PROFILE_SECTION_TO_RESUME


def test_profile_order_is_translated_kept_and_completed():
    """按资料里的顺序翻译成正文键；缺的键由默认顺序补齐成完整排列。"""
    assert profile_to_resume_order(["basic_info", "projects", "experiences", "summary"]) == [
        "projects",
        "experience",
        "summary",
        "education",
        "publications",
        "research_projects",
        "patents",
        "skills",
        "campus_experience",
        "awards",
    ]
    # 已经排好的资料顺序原样保留。
    assert profile_to_resume_order(
        [
            "educations",
            "experiences",
            "projects",
            "skills",
            "campus_experiences",
            "awards",
            "summary",
        ]
    ) == [
        "education",
        "experience",
        "projects",
        "skills",
        "campus_experience",
        "awards",
        "summary",
        "publications",
        "research_projects",
        "patents",
    ]


def test_profile_order_drops_basic_info_and_duplicates():
    """`basic_info` 是页眉（姓名/联系方式/照片），不参与正文分区排序。"""
    order = profile_to_resume_order(["basic_info", "awards", "basic_info", "awards", "skills"])
    assert "basic_info" not in order
    assert order[:2] == ["awards", "skills"]
    assert len(order) == len(DEFAULT_SECTION_ORDER)
    assert sorted(order) == sorted(DEFAULT_SECTION_ORDER)


def test_profile_order_falls_back_on_dirty_input():
    """脏输入一律回落到内置默认顺序，而不是抛异常：它是可随手改的 JSON 字段。"""
    for dirty in (None, "projects", 42, {"projects": 1}, ["unknown_key"], []):
        assert profile_to_resume_order(dirty) == list(DEFAULT_SECTION_ORDER), dirty


# ===== 新建简历时"物化"的默认顺序（P0-5）=====
# 卡片（「调整板块顺序」）与四个渲染器必须读同一份 `format_config.section_order`；靠前端 UI 的
# 默认值临时生效会出现"卡片显示资料顺序、PDF 按内置默认排"的两套结果。落库之后只有一个来源。


def test_profile_order_to_section_order_appends_missing_at_the_end():
    """缺失的简历板块**补在末尾**，彼此相对顺序取内置默认。

    为什么不补在"原地"：资料顺序是用户唯一表达过的偏好，翻译过来的那几项就是他心里的
    前后关系；没被资料覆盖的板块他根本没表达过意见，把它们塞进已排好的队列中间，等于
    替用户做了一次他没做过的决定。
    """
    order = profile_order_to_section_order(["basic_info", "projects", "unknown_key", "educations"])

    assert order == [
        "projects",
        "education",
        "experience",
        "publications",
        "research_projects",
        "patents",
        "skills",
        "campus_experience",
        "awards",
        "summary",
    ]
    # 与归一化同一口径：结果永远是七个键的完整排列。
    assert sorted(order) == sorted(DEFAULT_SECTION_ORDER)


def test_default_section_order_config_appends_research_after_old_sections(db_session):
    """W14 后资料页仍只有旧七分区：补齐的三项科研板块**落在末尾**（契约 §5.3）。

    因此"资料顺序 = 旧默认顺序"不再等于 10 键内置默认，会物化一份显式 section_order——
    这是刻意的：科研板块不插进用户已排好的七项中间，旧记录的视觉顺序不变。
    """
    profile = get_or_create_profile(db_session)
    profile.section_order = [
        "basic_info",
        "educations",
        "experiences",
        "projects",
        "skills",
        "campus_experiences",
        "awards",
        "summary",
    ]
    db_session.commit()

    assert default_section_order_config(db_session) == {
        "section_order": [
            "education",
            "experience",
            "projects",
            "skills",
            "campus_experience",
            "awards",
            "summary",
            "publications",
            "research_projects",
            "patents",
        ]
    }


def test_default_section_order_config_is_none_for_a_never_saved_profile(db_session):
    """从没在资料页排过顺序（数据库里还是空列表）→ 等于内置默认 → 不写键。"""
    profile = get_or_create_profile(db_session)
    profile.section_order = []
    db_session.commit()

    assert default_section_order_config(db_session) is None


def test_default_section_order_config_materializes_profile_order(db_session):
    """资料里把「项目经历」拖到最前 → 落库片段里项目在最前，其余照资料里的先后。"""
    profile = get_or_create_profile(db_session)
    profile.section_order = [
        "basic_info",
        "projects",
        "summary",
        "educations",
        "experiences",
        "skills",
        "campus_experiences",
        "awards",
    ]
    db_session.commit()

    assert default_section_order_config(db_session) == {
        "section_order": [
            "projects",
            # 资料里把「个人总结」放在了第二行：翻译结果照它走（用户表达过的偏好优先），
            # 而不是被内置默认顺序（summary 在末位）"纠正"回去。
            "summary",
            "education",
            "experience",
            "skills",
            "campus_experience",
            "awards",
            "publications",
            "research_projects",
            "patents",
        ]
    }


def test_a_saved_custom_order_is_only_rewritten_by_an_explicit_put(client):
    """「只改默认值」的证据：读路径与 PATCH 都不动老数据；PUT 的语义是既有契约。

    - GET：原样返回存的显式 JSON，**没有任何读时迁移或补写**；
    - PATCH 一个无关字段：``section_order`` 原样保留；
    - PUT 不带 ``section_order``：落回**默认值**——这是 ``PUT /api/profile`` 一直以来的
      "整体替换"语义（``update_profile`` 的 docstring 写着"没传的字段落回默认值"），
      不是这次改默认顺序引入的，也不会去改写任何**没被 PUT 过**的记录。
    """
    custom = ["basic_info", "skills", "awards"]
    assert client.patch("/api/profile", json={"section_order": custom}).status_code == 200
    # 校验器把缺的键按 ``PROFILE_SECTION_KEYS`` 补在后面，这就是"用户存的显式顺序"。
    stored = client.get("/api/profile").json()["section_order"]
    assert stored[:3] == ["basic_info", "skills", "awards"]
    # 读两次结果一样：读路径不写库。
    assert client.get("/api/profile").json()["section_order"] == stored

    # 之后改一个与顺序无关的字段（PATCH）：顺序必须原样保留。
    assert client.patch("/api/profile", json={"name": "李四"}).status_code == 200
    assert client.get("/api/profile").json()["section_order"] == stored

    # 模板清单接口下发的 ``profile_section_order`` 也仍按这份显式顺序翻译。
    catalog = client.get("/api/resumes/templates").json()
    assert catalog["profile_section_order"] == [
        "skills",
        "awards",
        "education",
        "experience",
        "projects",
        "campus_experience",
        "summary",
        "publications",
        "research_projects",
        "patents",
    ]

    # PUT 的整体替换语义（既有契约）：不带 section_order 时落回**默认值**。
    assert client.put("/api/profile", json={"name": "李四"}).status_code == 200
    assert client.get("/api/profile").json()["section_order"] == list(PROFILE_SECTION_KEYS)


def test_html_preview_follows_the_custom_order():
    html = render_html(_sample_resume(), format_config=CUSTOM_CONFIG)
    _assert_follows_order({"html": html})
    # data-resume-path 是「点击纸面字段定位编辑」的锚点，重排不能动它。
    for path in ("projects.0.name", "experience.0.company", "education.0.school"):
        assert f'data-resume-path="{path}"' in html


def test_markdown_and_txt_follow_the_custom_order():
    order = CUSTOM_ORDER
    markdown = export_markdown(_sample_resume(), section_order=order)
    plain = export_txt(_sample_resume(), section_order=order)
    _assert_follows_order({"markdown": markdown, "txt": plain})
    # txt 是从 markdown 剥出来的，两者天然同源。
    assert re.sub(r"[#*`\-\s]", "", markdown) == re.sub(r"[#*`\-\s]", "", plain)


def test_word_document_follows_the_custom_order():
    from docx import Document

    document = build_resume_docx(_sample_resume(), format_config=CUSTOM_CONFIG)
    doc = Document(io.BytesIO(document.content))
    _assert_follows_order({"docx": "\n".join(p.text for p in doc.paragraphs)})


def test_pdf_renders_with_the_custom_order_without_changing_page_count_semantics():
    """服务端 PDF 用同一份顺序渲染；这里只验证它不报错、仍是合法 PDF。

    PDF 的分区顺序藏在绘制调用里，抽文本会受字体子集化影响，所以不在字节层面断言顺序
    （HTML / Word / Markdown 三处已经钉住了同一个顺序定义）。这里要守住的是：
    带顺序渲染不会让「一页适配」的决策与渲染分家。
    """
    from app.services.pdf_exporter import (
        build_resume_pdf,
        measure_content_height,
        resolve_layout,
    )
    from app.services.resume.resume_templates import validated_format_config

    overrides = validated_format_config(CUSTOM_CONFIG)
    layout = resolve_layout(template="classic", base_px=14, format_config=overrides)
    document = build_resume_pdf(_sample_resume(), format_config=CUSTOM_CONFIG)
    assert document.content.startswith(b"%PDF-")
    assert document.pages >= 1
    height = measure_content_height(
        _sample_resume(), accent=(22, 54, 92), layout=layout, format_config=overrides
    )
    assert height > 0


def test_section_order_survives_template_validation():
    """格式模板校验要保留 section_order，而不是把它当成未知键丢掉。"""
    from app.services.resume.resume_templates import validated_format_config

    validated = validated_format_config(CUSTOM_CONFIG)
    assert validated["section_order"] == CUSTOM_ORDER
    # 没给就不出现：让「没设过」与「设成默认」可以区分。
    assert "section_order" not in validated_format_config({"accent": "#16365c"})
    # 非法输入（空列表 / 字符串以外的东西）不会炸掉整份配置。
    assert "section_order" not in validated_format_config({"section_order": []})
    assert "section_order" not in validated_format_config({"section_order": "projects"})
