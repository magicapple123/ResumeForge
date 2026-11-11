# SPDX-License-Identifier: Apache-2.0
"""链接抓取域的助手工具声明（#16D）：web_extract（只读）/ import_jobs_from_url（写）。

**注册方式**：本文件只声明 WEB_TOOLS；由主代理在
_registry.py 的 _TOOLS 末尾追加 *WEB_TOOLS（工具顺序是行为契约，追加在末尾
不重排既有分组），并同步 tests/test_assistant_tool_specs.EXPECTED_TOOL_ORDER。
"""

from __future__ import annotations

from ._types import Tool, ToolPermission
from .web_tools import (
    _tool_import_jobs_from_url,
    _tool_web_extract,
    preview_import_jobs_from_url,
)

#: 两条工具共用的硬规则（16D 要求写死在描述里，否则模型会继续用搜索结果猜）。
_HARD_RULES = (
    "硬规则："
    "(1) 抓不到就如实说抓不到，禁止退回「搜索结果推测」页面内容；"
    "(2) 不得编造页面上没有的岗位、薪资、届别；"
    "(3) 抓取结果只进岗位广场，不自动投递、不入队。"
    "只读取用户明确给出的这一个 URL，禁止自行遍历站内其他页面。"
)

WEB_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="web_extract",
        description=(
            "读取用户给出的一个网页链接并抽取其中的岗位/公司信息（只读，不写库）。"
            "intent=job_list 时返回这一页的岗位条数与每条标题/公司/地点/薪资/原文摘要；"
            "intent=job_detail 时返回单条岗位的详情；intent=company/page 时返回正文摘要。"
            "适用于用户贴出校招列表页、职位详情页、公司招聘主页或宣讲会页面。"
            "如果用户没说清要多少条，先告诉用户「这页约 N 条」并反问要全部还是前 X 条，不要擅自决定。"
            "分页只跟随页面自己声明的「下一页」（rel=next / 下一页文案 / 常见分页容器 / JSON next 字段）；"
            "找不到就只抓当前页并如实说明 pages_fetched=1，禁止猜 URL 模板。"
            "用户要求「把这些岗位导入岗位广场」时改用 import_jobs_from_url。" + _HARD_RULES
        ),
        parameters={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "用户给出的完整链接（http/https）。",
                },
                "intent": {
                    "type": "string",
                    "enum": ["job_list", "job_detail", "company", "page"],
                    "description": "读取意图：岗位列表 / 单条岗位详情 / 公司主页 / 任意网页纯文本。",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "description": "可选：最多返回几条岗位。用户没说条数时不要填，先反问。",
                },
                "pages": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": (
                        "可选：最多翻几页（默认 1）。只跟随页面声明的「下一页」链接；"
                        "找不到就停在当前页并如实说明，不要猜 URL 模板。"
                    ),
                },
            },
            "required": ["url"],
        },
        handler=_tool_web_extract,
        service_entry="web_fetch.import_service.preview_from_url",
        permission=ToolPermission.READ_ONLY,
        # 抓取网页也是联网：用户关掉「联网搜索」开关时这两个工具不应下发。
        requires_web_search=True,
    ),
    Tool(
        name="import_jobs_from_url",
        description=(
            "把用户给出的一个岗位列表链接抓下来并导入岗位广场（写操作，会生成待确认提案）。"
            "提案里列出「将导入 N 条 + 每条标题/公司/原文摘要」，用户确认后才落库；"
            "重复岗位自动跳过（按标题+公司+投递链接判重）。一次最多 20 条，超过 20 条要分批，"
            "或让用户用岗位广场的「从链接导入」（支持两阶段补详情）。"
            "可按页面声明的「下一页」翻 1–10 页；找不到下一页就只抓当前页并如实说明，禁止猜 URL 模板。"
            "导入后只进岗位广场，不自动投递、不入队；岗位描述等详情可在岗位广场补全。" + _HARD_RULES
        ),
        parameters={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "用户给出的完整岗位列表链接（http/https）。",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "description": "导入条数。用户没说清时先反问（这页约 N 条，要全部还是前 X 条）。",
                },
                "pages": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "description": "可选：最多翻几页（默认 1）；只跟随页面声明的「下一页」，不猜 URL 模板。",
                },
                "filters": {
                    "type": "object",
                    "description": (
                        "可选：在页面已抓到的岗位上做行内筛选（如 keyword=Java、city=北京）。"
                        "只用于过滤，不得把筛选词拼进职位名。"
                    ),
                },
            },
            "required": ["url"],
        },
        handler=_tool_import_jobs_from_url,
        preview=preview_import_jobs_from_url,
        service_entry="web_fetch.import_service.commit_rows",
        permission=ToolPermission.REVERSIBLE_WRITE,
        requires_web_search=True,
    ),
)


__all__ = ["WEB_TOOLS"]
