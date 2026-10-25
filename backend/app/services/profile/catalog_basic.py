# SPDX-License-Identifier: Apache-2.0
"""资料大字段定义目录数据：分区 1-2（基本信息、教育经历）。

**纯数据，不读库、不联网**：13 个内置大字段由代码定义（需求 v3 R-01/R-09），用户不可
改名/删除；字段顺序就是需求 §3.2 的展示顺序，界面上"更多字段"之外的一切顺序都从这里取。

行格式（definition_catalog 负责构造 SectionSpec/FieldSpec 并做导入期校验）：

- 分区行：(key, 中文名称, 形态, 承载区字段 key, 仅素材, 并入来源, (字段行...))；
- 字段行：(key, 中文标签, 类型码, 默认收起, 枚举建议[, 特殊标记])；
- 类型码：s/m/d/photo = single_line/multi_line/date_text/照片引用；
- 特殊标记：private（永不进模型/网申/纸面，仅本地与备份）、no_llm、no_webform。

政治面貌、导师、研究方向在 v3 同时是简历小字段与网申专用项；这里只描述简历侧定义，
两处取值的共用规则（R-75）不在这一层实现。
"""

from __future__ import annotations

SECTION_ROWS = (
    (
        "basic_info",
        "基本信息",
        "singleton",
        None,
        True,
        (),
        (
            ("name", "姓名", "s", False, ()),
            ("gender", "性别", "s", False, ()),
            ("birth_month", "出生年月", "d", False, ()),
            ("phone", "手机", "s", False, ()),
            ("email", "邮箱", "s", False, ()),
            ("city", "城市", "s", False, ()),
            ("target_city", "意向城市", "s", False, ()),
            ("job_intention", "求职意向", "s", False, ()),
            ("homepage", "个人主页", "s", False, ()),
            ("github", "GitHub", "s", False, ()),
            # 照片是资源引用而不是文本：不给模型、不参与网申填表（纸面由导出器直接取）。
            ("photo", "照片", "photo", False, (), ("no_llm", "no_webform")),
            ("portfolio_url", "作品集链接", "s", False, ()),
            ("political_status", "政治面貌", "s", True, ()),
            ("driver_license", "驾照", "s", False, ()),
            ("available_date", "到岗时间", "s", False, ()),
        ),
    ),
    (
        "educations",
        "教育经历",
        "multi",
        "achievements",
        False,
        (),
        (
            ("school", "学校", "s", False, ()),
            ("major", "专业", "s", False, ()),
            ("degree", "学历", "s", False, ()),
            ("study_form", "学习形式", "s", False, ()),
            ("degree_type", "学位类型", "s", False, ()),
            ("department", "院系", "s", False, ()),
            ("start_date", "开始时间", "d", False, ()),
            ("end_date", "结束时间", "d", False, ()),
            ("gpa", "绩点", "s", False, ()),
            ("rank", "成绩排名", "s", False, ()),
            ("advisor", "导师", "s", False, ()),
            ("research_direction", "研究方向", "s", False, ()),
            ("core_courses", "主修课程", "m", False, ()),
            ("achievements", "在校成果", "m", False, ()),
        ),
    ),
)


# §3.2 审计标记：本篇分区内的新增/改名/移除字段（definition_catalog 汇总后断言 18/4/5）。
NEW_FIELD_IDS = (
    "basic_info.portfolio_url",
    "basic_info.political_status",
    "basic_info.driver_license",
    "basic_info.available_date",
)
RENAMED_FIELD_LABELS = (("basic_info.birth_month", "出生年份"),)
REMOVED_FIELD_LABELS: tuple[tuple[str, str], ...] = ()
