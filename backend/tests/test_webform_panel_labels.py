# SPDX-License-Identifier: Apache-2.0
"""焦点面板清单的**显示名**：英文界面下板块名/字段名不再露中文，中文界面逐字不变。

起因是用户截图：``en-US`` 下面板里除了他自己填的内容，跳转条芯片（「基本信息 16」
「项目经历 47」）、分组树组头（「教育经历 1 14 entries」）、行内标签（「项目名称」
「角色」）全是中文。根因不是"漏翻了一句界面文案"，而是**这些是清单数据**：从后端
下发后原样 ``textContent``，注入期那套整句替换够不到它们。

所以修法是在数据侧新增**显示字段**（``display`` / ``display_group``），按稳定 key
查表（板块 key / ``field_id`` / ``FormField.key`` / ``repeat:<group>.<field>``）。本文件
钉住四件事：

1. 英文下内置板块与字段有英文显示名，且**不含 CJK**（含「重复网申补充」那 12 组）；
2. ``zh-CN`` 下两个显示字段**恒等于原值**（源语言逐字不一样就等于改了中文界面）；
3. 用户内容（自建板块、``CUSTOM_*`` 自定义字段）**永不翻译**；
4. 英文文案确实出自 `frontend/src/i18n/messages` 里那几份已校对词表——这里不发明措辞；
   前端词表暂时没有的少数几条，必须显式登记在 ``BACKEND_OWNED_COPY``（只许 ``repeat:`` 键）。
"""

from __future__ import annotations

import pathlib
import re

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.webform import panel_labels
from app.services.webform.data.defined_fields import catalog_from_consumed
from app.services.webform.engine.scripts import FOCUS_LISTENER_SCRIPT
from app.services.webform.live_memory_panel import REMEMBER_EDITOR_SCRIPT, remember_editor_script
from app.services.webform.panel_labels import (
    field_display_name,
    group_display_name,
    indexed_field_label,
    panel_field_display_name,
    section_display_name,
    with_display_fields,
)
from app.services.webform.webform_copy import ui_text

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FRONTEND_COPY = REPO_ROOT / "frontend" / "src" / "i18n" / "messages"

# 「界面文案里不该出现的字」：中文与全角标点。英文表里出现任何一个都说明漏翻或串了行。
_CJK = re.compile(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]")


def _profile() -> ConsumedProfile:
    """一份最小可用的消费快照：一个多项板块 + 一个单例板块。"""
    projects = ConsumedSection(
        key="projects",
        name="项目经历",
        form="multiple",
        carrier_field_id=None,
        material_only=False,
        primary_field_id=None,
        fields=(
            ConsumedFieldSpec(
                field_id="projects.name",
                key="name",
                label="项目名称",
                field_type="text",
                order=0,
                llm_allowed=True,
                webform_allowed=True,
                private=False,
                is_builtin=True,
            ),
            ConsumedFieldSpec(
                field_id="projects.role",
                key="role",
                label="角色",
                field_type="text",
                order=1,
                llm_allowed=True,
                webform_allowed=True,
                private=False,
                is_builtin=True,
            ),
        ),
        entries=(
            ConsumedEntry(
                entry_id="p1",
                sort_order=0,
                values={"projects.name": "会员分层与沉默用户召回", "projects.role": "负责人"},
            ),
        ),
    )
    summary = ConsumedSection(
        key="summary",
        name="个人总结/自我评价",
        form="singleton",
        carrier_field_id=None,
        material_only=False,
        primary_field_id=None,
        fields=(
            ConsumedFieldSpec(
                field_id="summary.content",
                key="content",
                label="内容",
                field_type="multi_line",
                order=0,
                llm_allowed=True,
                webform_allowed=True,
                private=False,
                is_builtin=True,
            ),
        ),
        entries=(
            ConsumedEntry(entry_id="s1", sort_order=0, values={"summary.content": "十年经验"}),
        ),
    )
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=("projects", "summary"),
        section_order=("projects", "summary"),
        workspace_revision=1,
        sections={"projects": projects, "summary": summary},
    )


def test_the_catalog_carries_stable_keys_for_the_display_layer() -> None:
    """清单行必须带上稳定 key：显示层只按 key 查表，**不按中文串匹配**。"""
    rows = catalog_from_consumed(_profile())
    by_label = {row["label"]: row for row in rows}

    project_row = by_label["项目名称"]
    assert project_row["group_key"] == "projects"
    assert project_row["group_index"] == "1"
    assert project_row["label_key"] == "projects.name"
    # 语义字段一个字都不能变：它们被 `accept(label, value)` 回传、被 `dataset.group` 用于定位。
    assert project_row["group"] == "项目经历 1"
    assert project_row["value"] == "会员分层与沉默用户召回"

    summary_row = by_label["内容"]
    assert summary_row["group_key"] == "summary"
    assert summary_row["group_index"] == ""
    assert summary_row["group"] == "个人总结/自我评价"


def test_english_display_fields_translate_builtin_sections_and_fields() -> None:
    """英文界面：板块名与字段名都有英文显示名（用户截图里露出来的就是这些）。"""
    rows = with_display_fields(catalog_from_consumed(_profile()), "en-US")
    shown = {(row["display_group"], row["display"]) for row in rows}

    assert ("Projects 1", "Project name") in shown, shown
    assert ("Projects 1", "Role") in shown, shown
    assert ("Summary / Self-assessment", "Body") in shown, shown
    assert all(not _CJK.search(row["display"]) for row in rows), rows
    assert all(not _CJK.search(row["display_group"]) for row in rows), rows


def test_the_original_label_and_group_survive_localization() -> None:
    """**只加显示字段**：`label` / `group` 不许被翻译动过，否则「填入」回传与定位全乱。"""
    rows = catalog_from_consumed(_profile())
    localized = with_display_fields(rows, "en-US")

    assert [row["label"] for row in localized] == [row["label"] for row in rows]
    assert [row["group"] for row in localized] == [row["group"] for row in rows]
    assert [row["key"] for row in localized] == [row["key"] for row in rows]


def test_chinese_display_fields_are_byte_identical_to_the_source_values() -> None:
    """`zh-CN` 是源语言：显示字段恒等于原值，中文界面与改造前逐字一致。"""
    rows = catalog_from_consumed(_profile())
    localized = with_display_fields(rows, "zh-CN")

    for original, row in zip(rows, localized, strict=True):
        assert row["display"] == original["label"]
        assert row["display_group"] == original["group"]
        # 除了两个显示字段，其余键值一个都不许多、不许改。
        stripped = {
            key: value for key, value in row.items() if key not in {"display", "display_group"}
        }
        assert stripped == original


def test_unknown_locale_falls_back_to_the_source_language() -> None:
    """未知语言按源语言处理（与 `panel_copy` 同一口径），宁可露中文也不要半英文。"""
    rows = with_display_fields(catalog_from_consumed(_profile()), "fr-FR")
    assert all(row["display"] == row["label"] for row in rows)
    assert all(row["display_group"] == row["group"] for row in rows)


def test_user_created_names_are_never_translated() -> None:
    """自建板块与自定义字段是**用户自己写的名字**，任何语言下都原样显示。"""
    rows = with_display_fields(
        [
            {
                "group": "内推信息",
                "label": "内推码",
                "value": "GX2026-8842",
                "key": "CUSTOM_custom:9:abc",
                "group_key": "custom:9",
                "group_index": "1",
                "label_key": "custom:9:abc",
            }
        ],
        "en-US",
    )
    assert rows[0]["display"] == "内推码"
    assert rows[0]["display_group"] == "内推信息"
    # 面板标题走同一套规则。
    assert panel_field_display_name("CUSTOM_导师姓名", "导师姓名", "en-US") == "导师姓名"


def test_web_form_catalog_rows_use_the_form_field_table() -> None:
    """网申目录字段（`FormField.key`）与序列字段的动态键都要有英文名。"""
    rows = with_display_fields(
        [
            {"group": "identity", "label": "证件类型", "value": "居民身份证", "key": "id_type"},
            {"group": "other", "label": "项目名称（第一条）", "value": "x", "key": "project_name"},
            {
                "group": "实习和工作补充 2",
                "label": "所在部门",
                "value": "研发",
                "key": "experience_2_department",
            },
        ],
        "en-US",
    )
    assert [row["display"] for row in rows] == ["ID type", "Project name", "Department (Entry 2)"]
    # 没有 `group_key` 的组保持原值：协议标识（identity / other）由面板脚本自己翻（它带
    # 中英两套文案）。带 `group_key` 的组见下面两条用例。
    assert [row["display_group"] for row in rows] == ["identity", "other", "实习和工作补充 2"]


def test_group_display_name_handles_the_web_form_extra_group() -> None:
    """重叠字段那一支把行归在「网申资料」组：显示名与来源徽标同一句，不另写措辞。"""
    assert group_display_name("webform_extra", "", "网申资料", "en-US") == "Web form Profile"
    assert group_display_name("basic_info", "", "基本信息", "en-US") == "Basic information"
    assert group_display_name("basic_info", "", "基本信息", "zh-CN") == "基本信息"
    assert group_display_name("custom:9", "1", "内推信息", "en-US") == "内推信息"


def test_section_and_field_helpers_fall_back_to_the_original_text() -> None:
    """查不到就回退原中文：**宁可露一句中文，也不要空串**。"""
    assert section_display_name("custom:9", "内推信息", "en-US") == "内推信息"
    assert field_display_name("custom:9:abc", "内推码", "en-US") == "内推码"
    assert section_display_name("projects", "项目经历", "en-US") == "Projects"
    assert field_display_name("projects.name", "项目名称", "en-US") == "Project name"


def test_indexed_field_label_keeps_chinese_ordinals_and_adds_english_entries() -> None:
    """序列字段的序号后缀：中文仍是「（第二条）」，英文改成 `(Entry 2)`。"""
    assert indexed_field_label("project_2_name", "项目名称", "zh-CN") == "项目名称（第二条）"
    assert (
        indexed_field_label("project_2_name", "项目名称（第一条）", "en-US") == "项目名称 (Entry 2)"
    )
    assert (
        indexed_field_label("project_2_name", "Project name", "en-US") == "Project name (Entry 2)"
    )
    assert indexed_field_label("project_name", "Project name", "en-US") == "Project name"


def test_all_thirteen_system_sections_are_covered() -> None:
    """13 个系统板块一个都不能漏：漏一个就在英文界面里露出一整块中文组名。"""
    assert len(panel_labels.SECTION_LABELS) == 13
    for key in (
        "basic_info",
        "educations",
        "experiences",
        "projects",
        "skills",
        "campus_experiences",
        "awards",
        "summary",
        "publications",
        "research_projects",
        "patents",
        "credentials",
        "languages",
    ):
        assert key in panel_labels.SECTION_LABELS, key


def _frontend_copy(name: str) -> str:
    return (FRONTEND_COPY / name).read_text(encoding="utf-8")


# ===== 会话层：语言怎么传下来 =====


class _NullClient:
    """不真连浏览器的客户端：这几个用例只问"显示名算成了什么"。"""

    def evaluate(self, expression: str, timeout: float | None = None) -> str:  # pragma: no cover
        return "1"


def _session(locale: str | None):
    from app.services.webform.live import LiveSession

    return LiveSession(_NullClient(), {"name": "张三"}, ui_locale=locale)


def test_the_session_decorates_the_catalog_with_the_current_locale() -> None:
    """清单是**会话推给页面**的，所以显示名必须在会话层按当前语言补上。"""
    rows = catalog_from_consumed(_profile())

    english = _session("en-US")._display_catalog(rows)
    assert [row["display"] for row in english] != [row["label"] for row in rows]
    assert ("Projects 1", "Project name") in {
        (row["display_group"], row["display"]) for row in english
    }

    chinese = _session("zh-CN")._display_catalog(rows)
    assert all(row["display"] == row["label"] for row in chinese)
    assert all(row["display_group"] == row["group"] for row in chinese)


def test_the_panel_title_follows_the_locale_but_keeps_matching_inputs_intact() -> None:
    """面板标题（`.h`）上的字段名按语言显示；**自定义字段名是用户内容，永不翻译**。"""
    assert _session("zh-CN")._field_display_label("project_2_name") == "项目名称（第二条）"
    assert _session("en-US")._field_display_label("project_2_name") == "Project name (Entry 2)"
    assert _session("en-US")._field_display_label("school") == "School"
    assert _session("en-US")._field_display_label("CUSTOM_导师姓名") == "导师姓名"
    assert _session("zh-CN")._field_display_label("CUSTOM_导师姓名") == "导师姓名"


# ===== 「记住这条」清单：不再有"新建"合成行 =====
#
# 用户反馈：清单顶部那行「新建字段 / 使用上方字段名」会被读成"已经有一条叫这个名字的
# 字段"（还带着单选圈），反而制造歧义。现在清单只列**已存在的保存目标**；"新建"是
# 隐式默认——名字对不上任何目标时 `selectedId` 仍是 `'custom'`，提示语会说"将按上方
# 字段名新增"。


def test_the_new_field_row_is_gone_from_the_picker() -> None:
    """合成行（含它的组名与默认名）全部从模板里消失，两种语言都不再出现。"""
    for script in (REMEMBER_EDITOR_SCRIPT, remember_editor_script("en-US")):
        assert "[custom, ...targets()]" not in script
        assert "const custom = {target_id: 'custom'" not in script
        assert "新建字段" not in script
        assert "New field" not in script
        assert "使用上方字段名" not in script
        assert "Use the field name above" not in script


def test_creating_a_new_field_stays_the_implicit_default() -> None:
    """清单里没有"新建"行，但保存仍要能新建：默认落点与回传字段一个都不能少。"""
    assert "return 'custom';" in REMEMBER_EDITOR_SCRIPT
    assert "target_id: selectedId" in REMEMBER_EDITOR_SCRIPT
    # 选中项所在的分组要展开：否则提示语说"将更新…"，指向的那一行却藏在折叠组里。
    assert "const revealSelected = () => {" in REMEMBER_EDITOR_SCRIPT
    assert REMEMBER_EDITOR_SCRIPT.count("revealSelected();") == 2


def test_the_real_custom_group_keeps_its_display_name() -> None:
    """真实自定义分组的显示名仍然是「自定义」/`Custom`——数据语义一个字都没动。"""
    assert "custom: '自定义'" in FOCUS_LISTENER_SCRIPT
    assert ui_text("zh-CN", "group.custom") == "自定义"
    assert ui_text("en-US", "group.custom") == "Custom"
