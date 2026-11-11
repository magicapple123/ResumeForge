# SPDX-License-Identifier: Apache-2.0
"""规则层抽取用的 JSON 字段别名表（#16B）——**纯数据**，不含逻辑。

单独成模块的原因只有一个：``extract_rules.py`` 已经贴着 500 行预算，而这些别名表是
"数据"而不是"规则"——它们会随着遇到的站点越攒越多，混在逻辑文件里会让那个文件每加
一个站点别名就得先拆函数。

约定：
- 表内顺序即优先级（``_first`` 按顺序取第一个非空值），改顺序等于改抽取结果；
- 一类字段一张表，名字与 ``_row_from_json_item`` 里的键一致；
- 只放 JSON/JSON-LD 的键名，页面中文标题（如「薪资」）属于 ``field_rules`` 的词表。
"""

from __future__ import annotations

#: JSON 字段别名（按优先级）。
_TITLE_KEYS = (
    "title",
    "jobTitle",
    "job_title",
    "jobName",
    "job_name",
    "positionName",
    "position_name",
    "postName",
    "name",
)
_COMPANY_KEYS = (
    "company",
    "companyName",
    "company_name",
    "brandName",
    "brand_name",
    "employer",
    "employerName",
    "orgName",
)
_LOCATION_KEYS = (
    "city",
    "cityName",
    "city_name",
    "location",
    "workLocation",
    "work_location",
    "jobCity",
    "job_city",
    "address",
)
_SALARY_KEYS = (
    "salary",
    "salaryRange",
    "salary_range",
    "salaryDesc",
    "salary_desc",
    "compensation",
    "salaryText",
)
_POSTED_KEYS = (
    "posted_at",
    "postedAt",
    "publishTime",
    "publish_time",
    "updateTime",
    "update_time",
    "releaseTime",
    "datePosted",
    "publishedAt",
    "published_at",
)
_URL_KEYS = (
    "url",
    "jobUrl",
    "job_url",
    "detailUrl",
    "detail_url",
    "positionUrl",
    "position_url",
    "link",
    "href",
    "source_url",
)
_TYPE_KEYS = ("jobType", "job_type", "recruitType", "recruit_type", "positionType", "position_type")
_DESC_KEYS = (
    "description",
    "jobDescription",
    "job_description",
    "responsibility",
    "responsibilities",
    "duty",
    "duties",
)
_REQ_KEYS = (
    "requirements",
    "requirement",
    "jobRequirement",
    "job_requirement",
    "qualification",
    "qualifications",
)
_ADD_KEYS = ("additionalInfo", "additional_info", "welfare", "benefits", "otherInfo", "other_info")

__all__ = [
    "_ADD_KEYS",
    "_COMPANY_KEYS",
    "_DESC_KEYS",
    "_LOCATION_KEYS",
    "_POSTED_KEYS",
    "_REQ_KEYS",
    "_SALARY_KEYS",
    "_TITLE_KEYS",
    "_TYPE_KEYS",
    "_URL_KEYS",
]
