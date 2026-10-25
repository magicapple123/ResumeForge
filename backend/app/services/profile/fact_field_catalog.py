# SPDX-License-Identifier: Apache-2.0
"""补充事实的字段目录（数据）：九类事实的默认字段 key 与中文标签。

这里只放**数据**；读取/校验/隐藏字段保留等行为在 fact_field_schema.py。
拆成两个文件是为了守住单文件 500 行预算（九类 × 默认字段 + 中文标签本身就占掉
一半篇幅），同时保持"默认字段与标签只有一处定义"。

字段契约见 deliverables/software-company/resumeforge-facts-flexibility-contract-20261025.md
§3：默认字段 key 的顺序即界面展示顺序；中文标签在同一类型内唯一（自定义字段名
不得与默认字段标签完全相同），前端/网申/导出都从 API 读取，不在各自模块手写。
"""

from __future__ import annotations

# 九类事实的默认字段（顺序即界面展示顺序；契约 §3 是唯一真相）。
FACT_DEFAULT_FIELDS: dict[str, tuple[str, ...]] = {
    "publication": (
        "title",
        "authors",
        "venue",
        "year",
        "status",
        "doi",
        "url",
        "volume_pages",
        "note",
    ),
    "research_project": (
        "name",
        "role",
        "organization",
        "start_date",
        "end_date",
        "funding",
        "description",
        "outcomes",
    ),
    "patent": (
        "title",
        "inventors",
        "patent_number",
        "country",
        "status",
        "filed_date",
        "granted_date",
        "url",
    ),
    "credential": (
        "name",
        "issuer",
        "issue_date",
        "expiry_date",
        "status",
        "credential_number",
        "verify_url",
        "note",
    ),
    "work_project": (
        "name",
        "role",
        "start_date",
        "end_date",
        "tech_stack",
        "description",
        "highlights",
        "public_url",
        "artifact_type",
    ),
    "practice": (
        "organization",
        "role",
        "experience_kind",
        "start_date",
        "end_date",
        "description",
    ),
    "award": ("name", "issuer", "date", "level", "description"),
    "training": (
        "name",
        "organization",
        "start_date",
        "end_date",
        "hours",
        "description",
        "outcomes",
    ),
    "language": ("name", "level", "certificate", "score", "date"),
}

# 默认字段的中文标签。同一类型内必须唯一（自定义字段名不得与之完全相同），
# 前端/网申/导出都从这里取标签，不在各自模块手写一份。
FACT_FIELD_LABELS: dict[str, dict[str, str]] = {
    "publication": {
        "title": "标题",
        "authors": "作者",
        "venue": "期刊/会议",
        "year": "年份",
        "status": "状态",
        "doi": "DOI",
        "url": "链接",
        "volume_pages": "卷期页码",
        "note": "备注",
    },
    "research_project": {
        "name": "项目名称",
        "role": "担任角色",
        "organization": "所属机构",
        "start_date": "开始时间",
        "end_date": "结束时间",
        "funding": "经费",
        "description": "项目描述",
        "outcomes": "项目成果",
    },
    "patent": {
        "title": "专利名称",
        "inventors": "发明人",
        "patent_number": "专利号",
        "country": "国家/地区",
        "status": "状态",
        "filed_date": "申请日期",
        "granted_date": "授权日期",
        "url": "链接",
    },
    "credential": {
        "name": "证书名称",
        "issuer": "颁发机构",
        "issue_date": "签发日期",
        "expiry_date": "到期日期",
        "status": "状态",
        "credential_number": "证书编号",
        "verify_url": "核验链接",
        "note": "备注",
    },
    "work_project": {
        "name": "作品名称",
        "role": "担任角色",
        "start_date": "开始时间",
        "end_date": "结束时间",
        "tech_stack": "技术栈",
        "description": "作品描述",
        "highlights": "亮点",
        "public_url": "公开链接",
        "artifact_type": "成果类型",
    },
    "practice": {
        "organization": "机构或客户",
        "role": "担任角色",
        "experience_kind": "关系类型",
        "start_date": "开始时间",
        "end_date": "结束时间",
        "description": "经历描述",
    },
    "award": {
        "name": "奖项名称",
        "issuer": "颁发机构",
        "date": "获奖时间",
        "level": "奖项级别",
        "description": "奖项说明",
    },
    "training": {
        "name": "培训名称",
        "organization": "培训机构",
        "start_date": "开始时间",
        "end_date": "结束时间",
        "hours": "学时",
        "description": "培训描述",
        "outcomes": "培训成果",
    },
    "language": {
        "name": "语言",
        "level": "水平/等级",
        "certificate": "证书",
        "score": "成绩",
        "date": "取得时间",
    },
}


__all__ = ["FACT_DEFAULT_FIELDS", "FACT_FIELD_LABELS"]
