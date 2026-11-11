# SPDX-License-Identifier: Apache-2.0
"""#21「岗位落框」的固定夹具回归（纯函数，不调模型）。

夹具按详册 `resumeforge-issues-draft-2026-11-11.md` 第 1953–2026 行引用的原始输出重建：
H2 的「你将获得」整段消失、H4 的福利句同时落在 `description` 与 `additional_info`、
H5 的整段未切分（`requirements` 为空）。**不是**原始 24 份 JD 本身，所以这里的通过率只
代表"本夹具口径"，不等于原会话的 110 条断言。
"""

from __future__ import annotations

from app.schemas.job import JobTextParseResult
from app.services.job_field_cleanup import clean_job_fields
from app.services.job_text_parser import parse_job_text
from app.services.profile_entry_merge import normalized_key
from app.services.text_extraction_normalization import normalize_job_result

# ===== H2：内容丢失（「你将获得」整段谁都没接）=====

H2_SOURCE = """后端开发工程师
示例科技
工作职责：
1. 负责 B 端产品线的整体规划与落地
2. 负责需求分析与方案设计
3. 负责项目推进与跨团队协作
任职要求：
1. 本科及以上学历，计算机相关专业
2. 五年以上后端开发经验
你将获得：六险一金、弹性工作、年度旅游、股票期权。
公司介绍：一家做企业服务的公司。
面试流程：两轮技术面 + 一轮 HR 面。
"""

H2_AI = {
    "title": "后端开发工程师",
    "company": "示例科技",
    "location": "北京",
    "salary": "",
    "job_type": "社招",
    "description": (
        "1. 负责 B 端产品线的整体规划与落地\n2. 负责需求分析与方案设计\n3. 负责项目推进与跨团队协作"
    ),
    "requirements": "1. 本科及以上学历，计算机相关专业\n2. 五年以上后端开发经验",
    "additional_info": "公司介绍：一家做企业服务的公司。\n面试流程：两轮技术面 + 一轮 HR 面。",
    "source_url": "",
    "posted_at": "",
    "status": "开放中",
}


def h2_result() -> JobTextParseResult:
    return normalize_job_result(H2_AI, parse_job_text(H2_SOURCE), H2_SOURCE)


def test_h2_welfare_block_is_backfilled() -> None:
    """H2：`additional_info` 必须含「六险一金」——整段福利不能凭空消失。"""
    result = h2_result()

    assert "六险一金" in result.additional_info
    assert "你将获得" in result.additional_info


def test_h2_roles_and_requirements_keep_their_own_fields() -> None:
    """补漏不能把职责/要求挪走：三段的归属保持不变。"""
    result = h2_result()

    assert "负责 B 端产品线的整体规划" in result.description
    assert "五年以上后端开发经验" in result.requirements
    assert "六险一金" not in result.description
    assert "六险一金" not in result.requirements


def test_h2_reports_what_was_backfilled() -> None:
    """JFIX-5：补了内容要说出来，不能静默改用户数据。"""
    result = h2_result()

    assert any("补充信息" in warning for warning in result.warnings)


# ===== H4：同一句落两个框 =====

H4_SOURCE = """产品运营
示例公司
岗位职责：
1. 负责社群运营与内容排期
福利：五险一金、带薪年假
2. 负责活动策划与复盘
"""

H4_AI = {
    "title": "产品运营",
    "company": "示例公司",
    "description": "1. 负责社群运营与内容排期\n福利：五险一金、带薪年假\n2. 负责活动策划与复盘",
    "requirements": "",
    "additional_info": "福利：五险一金、带薪年假",
}


def test_h4_duplicated_welfare_line_stays_only_in_additional_info() -> None:
    """H4：福利句只留 `additional_info`，`description` 里不再重复出现。"""
    result = normalize_job_result(H4_AI, parse_job_text(H4_SOURCE), H4_SOURCE)

    assert "五险一金" not in result.description
    assert "五险一金" in result.additional_info
    # 职责行不能被连带删掉。
    assert "负责社群运营与内容排期" in result.description
    assert "负责活动策划与复盘" in result.description


def test_h4_welfare_only_in_one_field_is_left_alone() -> None:
    """只有一处出现的福利句原样保留（JFIX-1 只处理"同一句落在多个框"）。"""
    values = {
        "description": "负责社群运营",
        "requirements": "本科及以上学历\n福利：补充医疗保险",
        "additional_info": "",
    }
    cleaned, _ = clean_job_fields(values, "负责社群运营 本科及以上学历 福利：补充医疗保险")

    assert "补充医疗保险" in cleaned["requirements"]


# ===== H5：整段未切分 =====

H5_SOURCE = """后端开发工程师
示例科技
我们是一家做企业服务的公司
负责订单系统的设计与开发
负责支付链路的稳定性建设
本科及以上学历
六年以上后端开发经验
五险一金
弹性工作
"""


def h5_blob() -> str:
    return "\n".join(line for line in H5_SOURCE.strip().splitlines())


def test_h5_unsplit_description_is_cut_by_line_headings() -> None:
    """H5：`requirements` 为空且 `description` 接近全文 → 按行首标题切出要求与福利。"""
    ai = {
        "title": "后端开发工程师",
        "company": "示例科技",
        "description": h5_blob(),
        "requirements": "",
        "additional_info": "",
    }
    result = normalize_job_result(ai, parse_job_text(H5_SOURCE), H5_SOURCE)

    assert "六年以上后端开发经验" in result.requirements
    assert "五险一金" not in result.requirements
    assert "五险一金" in result.additional_info
    assert "弹性工作" in result.additional_info
    assert "负责订单系统的设计与开发" in result.description
    assert "本科及以上学历" not in result.description


def test_h5_split_does_not_run_when_requirements_already_exists() -> None:
    """JFIX-3 的边界：`requirements` 非空时不动——否则会把正常切分的结果二次切开。"""
    values = {
        "description": "负责订单系统的设计与开发\n负责支付链路的稳定性建设",
        "requirements": "本科及以上学历\n六年以上后端开发经验",
        "additional_info": "",
    }
    cleaned, _ = clean_job_fields(values, H5_SOURCE)

    assert cleaned["description"] == values["description"]
    assert cleaned["requirements"] == values["requirements"]


def test_h5_inline_sentence_is_not_a_split_point() -> None:
    """切分点必须是行首标题形态：句中的"要求"二字不能把一段话切开。"""
    values = {
        "description": "负责梳理客户要求并落成方案\n负责验收",
        "requirements": "",
        "additional_info": "",
    }
    cleaned, _ = clean_job_fields(values, "负责梳理客户要求并落成方案\n负责验收")

    assert cleaned["requirements"] == ""
    assert "负责梳理客户要求并落成方案" in cleaned["description"]


def test_short_description_is_not_split_even_when_requirements_empty() -> None:
    """`description` 只占原文一小部分时不该硬切（原文本来就没写要求）。

    **注意：这条并没有打到 70% 护栏。** 它的 `description` 里根本没有切分点，
    `_find_requirement_cut` 返回 `None`，所以 `_UNSPLIT_DESCRIPTION_RATIO` 改成 `0.0`
    它照样通过。真正钉住护栏的是下一条 `test_ratio_guard_blocks_split_even_with_heading`；
    这条保留下来只覆盖"没有切分点就不切"这另一半。
    """
    source = """岗位职责
负责订单系统开发
负责支付链路维护
公司介绍
一家做企业服务的公司
团队情况
后端 12 人
"""
    values = {
        "description": "负责订单系统开发\n负责支付链路维护",
        "requirements": "",
        "additional_info": "",
    }
    cleaned, _ = clean_job_fields(values, source)

    assert cleaned["requirements"] == ""
    assert cleaned["description"] == values["description"]


# 70% 护栏专用夹具：原文里「岗位职责：」「任职要求：」两个小标题都在，切分点确实存在；
# 但 `description` 只截了开头的职责块（外加漏进来的标题），占原文 26%，远小于 70%。
RATIO_GUARD_SOURCE = """后端开发工程师
示例科技
岗位职责：
负责订单系统的设计与开发
负责支付链路的稳定性建设
任职要求：
本科及以上学历，计算机相关专业
六年以上后端开发经验
公司介绍：
我们是一家做企业服务的公司，服务超过三千家客户
团队成员来自多家互联网公司，技术氛围良好
办公地点在望京，地铁直达
"""
RATIO_GUARD_DESCRIPTION = (
    "岗位职责：\n负责订单系统的设计与开发\n负责支付链路的稳定性建设\n任职要求："
)


def test_ratio_guard_blocks_split_even_with_heading() -> None:
    """JFIX-3 的第一道前提：`description` 占原文 ≤70% 时不硬切——即使切分点就在手边。

    这条用例是**专门为 `_UNSPLIT_DESCRIPTION_RATIO` 写的**，和上一条的区别只在于
    `description` 里带了「任职要求：」这一行：切分点存在，能切的唯一理由被护栏挡住。

    为什么不该切：`description` 只占原文 26%，说明模型这次并没有把全文塞进 description，
    只是漏了 requirements。若在这里按标题硬切，标题之后的「公司介绍 / 团队情况 / 办公地点」
    会被当成任职要求塞进 `requirements`——比留空更糟，用户会看到"任职要求：团队氛围良好"。

    反证（`evidence/21-job-fields/counter-proof-ratio-guard.txt`）：把
    `_UNSPLIT_DESCRIPTION_RATIO` 改成 `0.0`，这条立刻变红（`requirements` 变成
    「任职要求：」），`0.7` 时通过。
    """
    # 前提自检：占比必须真的远小于 70%，否则这条测的是别的分支（夹具改长改短都会踩到）。
    ratio = len(normalized_key(RATIO_GUARD_DESCRIPTION)) / len(normalized_key(RATIO_GUARD_SOURCE))
    assert ratio <= 0.5, f"夹具失效：description 占原文 {ratio:.0%}，已接近 70% 护栏"

    values = {
        "description": RATIO_GUARD_DESCRIPTION,
        "requirements": "",
        "additional_info": "",
    }
    cleaned, _ = clean_job_fields(values, RATIO_GUARD_SOURCE)

    assert cleaned["requirements"] == ""
    assert cleaned["description"] == RATIO_GUARD_DESCRIPTION
    # 切走的那些行不能从任何字段里冒出来（证明"没切"不是因为内容被搬去了别处）。
    assert "公司介绍" not in cleaned["requirements"]
    assert "团队成员来自多家互联网公司" not in cleaned["additional_info"]


# ===== J1 / J6 不退化 =====

J1_SOURCE = """Java 后端开发工程师
示例网络
工作职责：
1. 负责交易系统的接口开发
2. 负责线上问题排查
任职要求：
1. 本科及以上学历
2. 三年以上 Java 开发经验
"""


def test_j1_separated_fields_are_not_rewritten() -> None:
    """J1（第一轮 69 条断言之一）：职责与要求已经分开时，清洗不得改动。"""
    ai = {
        "title": "Java 后端开发工程师",
        "company": "示例网络",
        "description": "1. 负责交易系统的接口开发\n2. 负责线上问题排查",
        "requirements": "1. 本科及以上学历\n2. 三年以上 Java 开发经验",
        "additional_info": "",
    }
    result = normalize_job_result(ai, parse_job_text(J1_SOURCE), J1_SOURCE)

    assert result.description == "1. 负责交易系统的接口开发\n2. 负责线上问题排查"
    assert result.requirements == "1. 本科及以上学历\n2. 三年以上 Java 开发经验"
    assert result.additional_info == ""


def test_j6_welfare_never_lands_in_description() -> None:
    """J6：福利已经在 `additional_info` 时，`description` 不应出现它。"""
    source = """新媒体运营
示例文化
工作职责：
1. 负责公众号日常更新
福利：六险一金、年度体检
"""
    ai = {
        "title": "新媒体运营",
        "company": "示例文化",
        "description": "1. 负责公众号日常更新",
        "requirements": "",
        "additional_info": "福利：六险一金、年度体检",
    }
    result = normalize_job_result(ai, parse_job_text(source), source)

    assert "六险一金" not in result.description
    assert "六险一金" in result.additional_info


# ===== 覆盖度补漏的边界：寒暄语不能被塞进 additional_info =====


def test_greeting_without_keywords_is_not_backfilled() -> None:
    """寒暄行没有福利/流程关键词 → 不补（`additional_info` 不能变垃圾桶）。"""
    source = """后端开发工程师
示例科技
你好，我们团队氛围很好
工作职责：
1. 负责订单系统开发
"""
    ai = {
        "title": "后端开发工程师",
        "company": "示例科技",
        "description": "1. 负责订单系统开发",
        "requirements": "",
        "additional_info": "",
    }
    result = normalize_job_result(ai, parse_job_text(source), source)

    assert "团队氛围" not in result.additional_info


def test_backfilled_line_is_capped() -> None:
    """补漏的每一行不超过 200 字（否则详情页会被一段长文淹没）。"""
    long_line = "福利：" + "六险一金" * 100
    values = {"description": "负责日常开发", "requirements": "", "additional_info": ""}
    cleaned, _ = clean_job_fields(values, f"负责日常开发\n{long_line}")

    for line in cleaned["additional_info"].splitlines():
        assert len(line) <= 200


# ===== JFIX-5 告警：拿不准要说出来 =====


def test_unsplittable_blob_raises_a_warning() -> None:
    """`description` 占原文 > 80% 且切不开 → 明确告诉用户"没区分职责与要求"。"""
    blob = "负责订单系统设计与开发 负责支付链路稳定性 我们是一家企业服务公司"
    ai = {
        "title": "后端开发工程师",
        "company": "示例科技",
        "description": blob,
        "requirements": "",
        "additional_info": "",
    }
    result = normalize_job_result(ai, parse_job_text(blob), blob)

    assert any("未能区分职责与要求" in warning for warning in result.warnings)
