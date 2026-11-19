# SPDX-License-Identifier: Apache-2.0
"""按岗位 JD 给简历里的项目排序：把最贴的那个摆到模型眼前。

**为什么需要这个模块**：招呼语只举 1 个项目，而模型对"排在前面的内容"有明显偏好
（上下文里同时有 9 个以上项目时尤其明显）。实测过一次真实事故：JD 要「大模型平台 +
具身智能」，模型却举了排在第一、篇幅最长的「AIGC 短视频」——因为那是它第一眼看到的。
提示词里的"挑选流程"是软约束，这里给一层**确定性排序**作为兜底：最相关的项目排到
「项目经历」板块最前面，并加一行标注告诉模型"第 3 句优先举这个"。

**边界**：只重排 markdown 文本里的展示顺序，不改简历数据、不改任何 id；
提示词里的挑选规则仍然保留（模型可以否决这个第一名，只要理由成立）。
"""

from __future__ import annotations

from typing import Any

__all__ = ["reorder_projects_by_relevance"]

#: 每个 JD 方向的能力词表。刻意用**具体名词**而不是泛词——"平台""能力"这类词
#: 到处都是，命中它们等于没命中，会把所有项目的分数抬平。
_JD_TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "llm": (
        "大模型",
        "llm",
        "agent",
        "智能体",
        "prompt",
        "rag",
        "向量",
        "embedding",
        "function calling",
        "结构化输出",
        "工作流编排",
        "多模态",
    ),
    "embodied": (
        "具身智能",
        "机器人",
        "机械臂",
        "ros",
        "端侧",
        "嵌入式",
        "固件",
        "mcu",
        "esp32",
        "stm32",
        "传感器",
        "iot",
    ),
    "aigc": (
        "comfyui",
        "aigc",
        "文生图",
        "文生视频",
        "图生视频",
        "视频生成",
        "扩散",
        "lora",
        "出图",
        "成片",
        "动效",
        "渲染",
    ),
    "content": (
        "内容运营",
        "自媒体",
        "账号",
        "选题",
        "公众号",
        "头条",
        "爆款",
        "文案",
        "新媒体",
    ),
    "data": (
        "爬虫",
        "抓取",
        "数据清洗",
        "etl",
        "自动化脚本",
        "调度",
        "采集",
        "浏览器自动化",
        "playwright",
        "selenium",
    ),
    "web": (
        "前端",
        "全栈",
        "react",
        "vue",
        "next.js",
        "typescript",
        "javascript",
        "页面",
        "可视化",
        "组件",
        "接口开发",
    ),
    "testing": (
        "测试",
        "自动化测试",
        "用例",
        "回归",
        "性能测试",
        "稳定性",
        "缺陷",
    ),
}


def _jd_topics(job_payload_data: dict[str, Any] | None) -> set[str]:
    """从 JD 文本里识别它属于哪些能力方向（可多个）。"""
    if not job_payload_data:
        return set()
    blob = " ".join(
        str(job_payload_data.get(key) or "")
        for key in ("title", "description", "requirements", "additional_info")
    ).casefold()
    if not blob.strip():
        return set()
    return {
        topic
        for topic, words in _JD_TOPIC_KEYWORDS.items()
        if any(word in blob for word in words)
    }


def _score_project(name: str, body: str, topics: set[str]) -> int:
    """项目与 JD 方向的重合度：命中关键词数（项目名里命中权重更高）。"""
    if not topics:
        return 0
    name_text = str(name or "").casefold()
    body_text = str(body or "").casefold()
    score = 0
    for topic in topics:
        for word in _JD_TOPIC_KEYWORDS[topic]:
            if word in name_text:
                score += 3
            elif word in body_text:
                score += 1
    return score


def _project_blocks(lines: list[str], start: int, end: int) -> list[list[str]]:
    """把「项目经历」板块内部按 ``### `` 切成条目块。"""
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines[start:end]:
        if line.strip().startswith("### "):
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
        elif line.strip():
            current = [line]
    if current:
        blocks.append(current)
    return blocks


def reorder_projects_by_relevance(
    body: str, job_payload_data: dict[str, Any] | None
) -> str:
    """把 markdown 里「项目经历」条目按与 JD 的相关度重排，并标注第一名。

    没有 JD、没有「项目经历」板块、或所有项目得分都为 0 时**原样返回**——
    没有依据时不做无意义的排序（乱排会让每次生成的项目顺序都不一样）。
    """
    topics = _jd_topics(job_payload_data)
    if not topics:
        return body

    lines = body.splitlines()
    start = None
    for index, line in enumerate(lines):
        if line.strip().startswith("##") and "项目经历" in line:
            start = index + 1
            break
    if start is None:
        return body
    # 板块结束位置：下一个**同级或更高级**的标题（`## `），不是 `### `（那是条目）。
    # 这里必须区分 "##" 与 "###"，否则条目会被当成板块边界，blocks 只剩空。
    end = len(lines)
    for index in range(start, len(lines)):
        stripped = lines[index].strip()
        if stripped.startswith("## ") or stripped == "##":
            end = index
            break

    blocks = _project_blocks(lines, start, end)
    if len(blocks) < 2:
        return body

    sep = "\n"
    scored: list[tuple[int, int, list[str]]] = []
    for order, block in enumerate(blocks):
        name = block[0].lstrip("#").strip()
        scored.append((_score_project(name, sep.join(block), topics), order, block))
    # 分数降序；同分保持原顺序（稳定排序，避免每次生成顺序都不一样）。
    scored.sort(key=lambda item: (-item[0], item[1]))
    if scored[0][0] <= 0:
        return body

    rebuilt: list[str] = []
    for rank, (_score, _order, block) in enumerate(scored):
        block_lines = list(block)
        if rank == 0:
            block_lines.insert(1, "> （与本岗位 JD 最相关，第 3 句应优先举这个项目）")
        rebuilt.extend(block_lines)

    return sep.join([*lines[:start], *rebuilt, *lines[end:]])
