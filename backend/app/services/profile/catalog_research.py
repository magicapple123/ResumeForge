# SPDX-License-Identifier: Apache-2.0
"""资料大字段定义目录数据：分区 9-13（学术成果、科研项目、知识产权、证书、语言）。

**纯数据**：字段顺序即展示顺序；枚举建议只是录入提示（需求 §3.3：不校验、不拒绝
枚举外的值）。行格式见 catalog_basic.py 模块说明。

两个 v3 改名的大字段在这里：论文发表 -> 学术成果、专利 -> 知识产权（R-70）；
旧名不得出现在任何名称/标签里。并入来源只表达"新定义来自哪个旧事实种类"，
不执行任何旧数据转换（training 不在任何分区）。
"""

from __future__ import annotations

SECTION_ROWS = (
    (
        "publications",
        "学术成果",
        "multi",
        "note",
        False,
        ("publication",),
        (
            ("title", "标题", "s", False, ()),
            (
                "outcome_type",
                "成果类型",
                "s",
                False,
                ("期刊论文", "会议论文", "专著", "译著", "研究报告", "其他"),
            ),
            (
                "authorship_rank",
                "我的署名位次",
                "s",
                False,
                ("第一作者", "第二作者", "第三作者", "通讯作者", "其他"),
            ),
            ("authors", "作者", "s", False, ()),
            ("venue", "期刊/会议", "s", False, ()),
            ("year", "年份", "d", False, ()),
            ("status", "状态", "s", False, ()),
            ("url", "链接", "s", False, ()),
            ("note", "备注", "m", False, ()),
            ("doi", "DOI", "s", True, ()),
            ("volume_pages", "卷期页码", "s", True, ()),
        ),
    ),
    (
        "research_projects",
        "科研项目",
        "multi",
        "description",
        False,
        ("research_project",),
        (
            ("name", "项目名称", "s", False, ()),
            ("role", "担任角色", "s", False, ()),
            ("institution", "所属机构", "s", False, ()),
            (
                "level",
                "项目级别",
                "s",
                False,
                ("国家级", "省部级", "校级", "企业横向", "其他"),
            ),
            ("start_date", "开始时间", "d", False, ()),
            ("end_date", "结束时间", "d", False, ()),
            ("description", "项目描述", "m", False, ()),
            ("outcomes", "项目成果", "m", False, ()),
            ("funding", "经费", "s", True, ()),
        ),
    ),
    (
        "patents",
        "知识产权",
        "multi",
        None,
        True,
        ("patent",),
        (
            ("title", "名称", "s", False, ()),
            (
                "outcome_type",
                "成果类型",
                "s",
                False,
                ("发明专利", "实用新型", "外观设计", "软件著作权", "集成电路布图", "其他"),
            ),
            ("inventors", "发明人", "s", False, ()),
            (
                "inventor_rank",
                "发明人位次",
                "s",
                False,
                ("第一发明人", "第二发明人", "其他"),
            ),
            ("patent_number", "专利号", "s", False, ()),
            ("status", "状态", "s", False, ()),
            ("application_date", "申请日期", "d", False, ()),
            ("grant_date", "授权日期", "d", False, ()),
            ("url", "链接", "s", False, ()),
            ("country", "国家/地区", "s", True, ()),
        ),
    ),
    (
        "credentials",
        "证书资质",
        "multi",
        "note",
        False,
        ("credential",),
        (
            ("title", "证书名称", "s", False, ()),
            (
                "credential_type",
                "证书类型",
                "s",
                False,
                ("职业资格", "技能认证", "语言证书", "其他"),
            ),
            ("issuer", "颁发机构", "s", False, ()),
            ("issued_at", "签发日期", "d", False, ()),
            ("expires_at", "到期日期", "d", False, ()),
            ("status", "状态", "s", False, ()),
            ("note", "备注", "m", False, ()),
            # 证书编号是既有隐私红线（§3.1 细则 2）：永不进模型/网申/纸面。
            ("credential_number", "证书编号", "s", True, (), ("private",)),
            ("verify_url", "核验链接", "s", True, ()),
        ),
    ),
    (
        "languages",
        "语言能力",
        "multi",
        None,
        True,
        ("language",),
        (
            ("language", "语言", "s", False, ()),
            ("level", "水平/等级", "s", False, ()),
            ("certificate", "证书", "s", False, ()),
            ("score", "分数", "s", False, ()),
            ("obtained_at", "取得时间", "d", False, ()),
        ),
    ),
)


# §3.2 审计标记：本篇分区新增 6 个字段；两个大字段改名；私密字段清单（证书编号）。
NEW_FIELD_IDS = (
    "publications.outcome_type",
    "publications.authorship_rank",
    "research_projects.level",
    "patents.outcome_type",
    "patents.inventor_rank",
    "credentials.credential_type",
)
RENAMED_SECTION_NAMES = (("publications", "论文发表"), ("patents", "专利"))
PRIVATE_FIELD_IDS = ("credentials.credential_number",)
