# SPDX-License-Identifier: Apache-2.0
"""JD 分段补标题（CR-32）：基本要求 / 优先条件 / 岗位亮点 / 部门介绍。

背景（2026-11-25 美团校招详情页实测）：页面小标题只认出「岗位职责」，于是 728 字的
部门介绍 + 职责 + 要求 + 亮点 + 页脚全部并进 description，requirements 为空。
这里用离线快照断言三段字数，并覆盖「正文长句不被当标题」「投递说明归其他信息」
「部门介绍不把元信息拖进正文」「粘贴解析同样分组」四条。

快照来源：``D:/rf_tools/meituan_browser_page.json``（不联网）；文件不在时用内联
副本，保证换机器也能跑。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.services.job_text_parser import parse_job_text
from app.services.web_fetch.extractor import extract_rows, trim_detail_text
from app.services.web_fetch.fetcher import FetchedPage
from app.services.web_fetch.field_rules import split_jd_sections

SAMPLE_PATH = Path("D:/rf_tools/meituan_browser_page.json")

MEITUAN_URL = (
    "https://zhaopin.meituan.com/web/position/detail?jobUnionId=4921909221&highlightType=campus"
)

#: 与快照 ``text`` 逐行一致的离线副本（空行不影响：clean_text 会折叠掉）。
MEITUAN_TEXT = """首页
LongCat人才招聘
北斗计划
社会招聘
校园招聘
美团赛事
了解美团
Global Careers
登录
AI产品实习生
实习-日常实习
更新时间：2026/11/25
工作地点：北京市
部门：核心本地商业-基础研发平台
工作经验：不限
分享
立即申请
部门介绍
基础研发平台是美团的核心技术平台，立足于“零售+科技”的战略定位，通过打造人工智能、大数据、云计算、安全等核心技术能力，以及研发效能平台、企业应用平台等公共服务，为业务提供稳定安全、扩展易用、技术领先的平台技术和产品服务。
在这里，我们会参与到最前沿的技术研发和探索；能够接触超规模集群、海量数据，挑战高复杂业务场景，有机会与业界一流的工程师一起并肩前行。
在这里，我们有超强的技术氛围，持续向社区贡献业界实践，加速行业技术发展；我们有完善的互联网学习生态圈，重视底层逻辑和方法论，助力职业生涯的非线性成长。
真诚地邀请你，和我们一起驱动技术发展，创造行业价值。
岗位职责
1. 参与AI项目从0-1探索，挖掘通用Agent在生活、办公、娱乐等场景的需求
2. 追踪硅谷前沿创新产品，快速做原型
3. 参与构建面向通用C端场景的Agent的评测集
4. 优化团队内RSI循环，加速Badcase搜集-问题复现-问题定位-AI修复-测试集回归的循环，降低中循环中真人的参与度
5. 优化AI产品交互
岗位基本要求
对AGI有强烈热情，有丰富想象力
有Agent产品实践经验，对agent产品有基本认知
学习能力强
具备以下条件优先
对Personal Agent类产品（Muse、Today、Grokbot等）有强烈需求
高频使用过任何一款Personal Agent产品，有自己独特的看法
曾经创过业，有融资、真实营收或线上用户均可
岗位亮点
从0-1深度参与一款AI Native产品
和基模团队协同，拥有基于前沿模型的能力边界设计产品的宝贵经验
一起成长，一起更好
Grow Together, Better Together
美团
|
@2026 美团版权所有
京ICP备10211739号
京公网安备 11000002002052号
|
隐私政策
招聘意见反馈：zhaopin@meituan.com
关注我们"""


def _meituan_text() -> str:
    """优先读离线快照（验收口径），缺失时退回内联副本。"""
    if SAMPLE_PATH.exists():
        return str(json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))["text"])
    return MEITUAN_TEXT


def _page(*, url: str, text: str, html: str = "") -> FetchedPage:
    return FetchedPage(
        url=url,
        status_code=200,
        content_type="text/html",
        text=text,
        engine="browser",
        fetched_on="2026-11-25",
        html=html,
        json_payloads=[],
    )


def test_meituan_detail_splits_into_three_sections():
    """离线断言：description / requirements / additional_info = 161 / 151 / 380。"""
    page = _page(
        url=MEITUAN_URL,
        text=_meituan_text(),
        html="<html><body><h1>AI产品实习生</h1></body></html>",
    )
    result = asyncio.run(extract_rows(page, intent="job_detail"))
    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.jd_split is True
    assert len(row.data["description"]) == 161
    assert len(row.data["requirements"]) == 151
    assert len(row.data["additional_info"]) == 380
    # 页脚「版权所有」之后的内容不进任何一段。
    assert "版权所有" not in row.data["additional_info"]
    assert "京ICP备" not in row.data["additional_info"]
    # 部门介绍与岗位亮点都归其他信息，不被并进描述。
    assert "基础研发平台是美团的核心技术平台" in row.data["additional_info"]
    assert "从0-1深度参与一款AI Native产品" in row.data["additional_info"]
    # 三段合计 692 字：不能因为「职责只有 161 字」就报「正文没有识别出完整描述」。
    assert result.warnings == []


def test_long_body_sentence_is_not_treated_as_heading():
    """正文长句「岗位职责包括……」不是小标题，必须留在当前段落。"""
    text = (
        "岗位职责\n"
        "负责服务端接口开发。\n"
        "岗位职责包括负责 AI 产品设计，推动跨团队协作落地\n"
        "任职要求\n"
        "熟悉 Python 与 SQL。"
    )
    split = split_jd_sections(text)
    assert split["split"] is True
    assert "推动跨团队协作落地" in split["description"]
    assert "推动跨团队协作落地" not in split["requirements"]


def test_submission_notes_are_additional_not_description():
    """「投递说明」归其他信息：不能被语素「说明」抢成职责类。"""
    text = (
        "岗位职责\n"
        "负责服务端接口开发。\n"
        "任职要求\n"
        "熟悉 Python 与 SQL。\n"
        "投递说明\n"
        "请把简历发到 hr@example.com"
    )
    split = split_jd_sections(text)
    assert "hr@example.com" in split["additional_info"]
    assert "hr@example.com" not in split["description"]
    assert "hr@example.com" not in split["requirements"]


def test_trim_starts_at_additional_heading_without_dragging_meta_lines():
    """部门介绍属于其他信息：正文从它自己那行开始，不把更新时间/地点带进来。"""
    text = (
        "AI产品实习生\n"
        "实习-日常实习\n"
        "更新时间：2026/11/25\n"
        "工作地点：北京市\n"
        "部门介绍\n"
        "基础研发平台是美团的核心技术平台。\n"
        "岗位职责\n"
        "负责接口开发。\n"
        "任职要求\n"
        "熟悉 Python。"
    )
    trimmed = trim_detail_text(text)
    assert trimmed.splitlines()[0] == "部门介绍"
    assert "更新时间" not in trimmed
    assert "工作地点" not in trimmed


def test_paste_parse_groups_preferred_conditions_and_highlights():
    """粘贴解析同批对齐：优先条件进 requirements，岗位亮点进 additional。"""
    text = (
        "AI产品实习生\n"
        "部门介绍\n"
        "基础研发平台是美团的核心技术平台。\n"
        "岗位职责\n"
        "1. 参与 AI 项目从 0 到 1 探索\n"
        "岗位基本要求\n"
        "1. 对 AGI 有强烈热情\n"
        "具备以下条件优先\n"
        "1. 对 Personal Agent 类产品有强烈需求\n"
        "岗位亮点\n"
        "1. 从 0-1 深度参与一款 AI Native 产品\n"
        "投递说明\n"
        "简历请发送到 hr@example.com"
    )
    draft = parse_job_text(text)
    assert "参与 AI 项目从 0 到 1 探索" in draft.description
    assert "对 AGI 有强烈热情" in draft.requirements
    assert "对 Personal Agent 类产品有强烈需求" in draft.requirements
    assert "从 0-1 深度参与一款 AI Native 产品" in draft.additional_info
    assert "hr@example.com" in draft.additional_info
