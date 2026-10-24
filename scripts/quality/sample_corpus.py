# SPDX-License-Identifier: Apache-2.0
"""语料装配：20 份迭代样例 + 100 份边界样例，附带类别元数据。

对外只有三个入口：build_corpus()（固定顺序的 120 份样例）、CATEGORY_META（类别
标题/覆盖点/声明条数）、corpus_template_names()。生成器与 check 命令都只从这里取
语料，不再各自拼一遍——否则"manifest 写 120 条、检查只跑 100 条"这种偏差没人看得见。
"""

from __future__ import annotations

from typing import Any

from .sample_boundary_common import ALL_TEMPLATES
from .sample_corpus_boundaries import BOUNDARY_SAMPLE_COUNT, boundary_samples
from .sample_corpus_iterations import iteration_samples
from .sample_specs import CORPUS_VERSION, Sample

ITERATION_SAMPLE_COUNT = 20
TOTAL_SAMPLE_COUNT = ITERATION_SAMPLE_COUNT + BOUNDARY_SAMPLE_COUNT

# 类别元数据：kind 决定 manifest 里的分组，count 是**声明**条数（装配时会核对）。
# coverage 是"这一类为什么存在"的通用说明；每份样例自己的覆盖点写在 Sample.coverage。
CATEGORY_META: dict[str, dict[str, Any]] = {
    "iteration": {
        "kind": "iteration",
        "title": "迭代样例（每套模板 × 字号档 × 语言 × 有无照片）",
        "count": ITERATION_SAMPLE_COUNT,
        "coverage": (
            "六套可见模板 + 三套已下线模板都能渲染",
            "三档字号（small / standard / large）与两种纸面语言（zh-CN / en-US）",
            "照片开 / 关；分区顺序与版式参数覆盖",
        ),
    },
    "mixed-language": {
        "kind": "boundary",
        "title": "中英混排",
        "count": 8,
        "coverage": ("英文公司/岗位与中文正文混排", "英文月名与数字日期格式", "中英标点混用"),
    },
    "sparse": {
        "kind": "boundary",
        "title": "少内容",
        "count": 8,
        "coverage": ("只有 1–2 个字段", "空分区整段跳过，不留空标题", "无照片"),
    },
    "dense": {
        "kind": "boundary",
        "title": "多内容 / 超页",
        "count": 8,
        "coverage": ("条目多、要点长，自然排 2–3 页", "超页截断并标 overflow，不缩字号"),
    },
    "photo": {
        "kind": "boundary",
        "title": "照片",
        "count": 8,
        "coverage": (
            "标准 / 宽 / 高 / 大四种照片",
            "photo_scale 0.6 / 1.6",
            "include_photo=False 时产物里没有照片对象",
        ),
    },
    "missing-glyph": {
        "kind": "boundary",
        "title": "缺字（字体覆盖缺口）",
        "count": 8,
        "coverage": (
            "emoji / CJK 扩展区 / 数学符号 / 箭头 / 阿拉伯呈现形式",
            "渲染不崩溃，缺失字形清单可复现",
        ),
    },
    "long-url": {
        "kind": "boundary",
        "title": "长链接",
        "count": 8,
        "coverage": ("无可换行点的长 URL", "页眉与正文列表各一处", "不截断、不丢字符"),
    },
    "special-chars": {
        "kind": "boundary",
        "title": "特殊符号",
        "count": 8,
        "coverage": (
            "HTML 元字符与标签字样（必须转义）",
            "引号/破折号/竖线/模板语法字样/全角标点/组合字符",
        ),
    },
    "emphasis": {
        "kind": "boundary",
        "title": "局部强调（** 标记）",
        "count": 8,
        "coverage": ("成对标记 → 加粗且文本产物去标记", "落单标记原样保留，不吞字符"),
    },
    "template-matrix": {
        "kind": "boundary",
        "title": "模板矩阵",
        "count": len(ALL_TEMPLATES),
        "coverage": ("九套内置模板逐个一页渲染", "已下线模板仍能解析老记录的 template 字段"),
    },
    "extreme-margins": {
        "kind": "boundary",
        "title": "极端边距与版式边界",
        "count": 8,
        "coverage": (
            "页边距 0 / 26mm / 四边不等",
            "行高与区块间距取边界值",
            "不缩字号、不产生空白页",
        ),
    },
    "page-boundary": {
        "kind": "boundary",
        "title": "分页边界",
        "count": 8,
        "coverage": ("内容量贴着 1–2 页边界", "页数与溢出标记自洽", "末页不留空白页"),
    },
    "legacy-record": {
        "kind": "boundary",
        "title": "旧记录（历史 JSON）",
        "count": 8,
        "coverage": (
            "无 id / point_ids、字段残缺",
            "未知键被忽略、不凭空生成身份字段",
            "导出各格式正常",
        ),
    },
    "scholar-long-cv": {
        "kind": "boundary",
        "title": "学术长 CV",
        "count": 3,
        "coverage": (
            "博士在读 + 多段研究经历 + 论文列表",
            "scholar 模板 2–3 页",
            "技能列表与分区标题不串行",
        ),
    },
}


def build_corpus() -> list[Sample]:
    """按固定顺序返回 120 份样例；任何声明/实际不一致都在这里当场抛错。"""
    samples = iteration_samples() + boundary_samples()
    if len(samples) != TOTAL_SAMPLE_COUNT:
        raise AssertionError(f"语料应有 {TOTAL_SAMPLE_COUNT} 份，实际 {len(samples)} 份")
    ids = [sample.sample_id for sample in samples]
    if len(set(ids)) != len(ids):
        raise AssertionError(
            "样例 id 重复：" + ", ".join(sorted({i for i in ids if ids.count(i) > 1}))
        )
    declared = sum(meta["count"] for meta in CATEGORY_META.values())
    if declared != TOTAL_SAMPLE_COUNT:
        raise AssertionError(
            f"CATEGORY_META 声明 {declared} 份，与总数 {TOTAL_SAMPLE_COUNT} 不一致"
        )
    actual_by_category = {sample.category: 0 for sample in samples}
    for sample in samples:
        actual_by_category[sample.category] = actual_by_category.get(sample.category, 0) + 1
    for category, meta in CATEGORY_META.items():
        actual = actual_by_category.get(category, 0)
        if actual != meta["count"]:
            raise AssertionError(f"类别 {category} 声明 {meta['count']} 份，实际 {actual} 份")
    return samples


def corpus_template_names() -> list[str]:
    """语料覆盖到的模板名（按首次出现顺序；供模板质量档案核对"九套都测过"）。"""
    seen: list[str] = []
    for sample in build_corpus():
        if sample.template not in seen:
            seen.append(sample.template)
    return seen


def category_counts() -> dict[str, int]:
    return {category: meta["count"] for category, meta in CATEGORY_META.items()}


__all__ = [
    "CATEGORY_META",
    "CORPUS_VERSION",
    "ITERATION_SAMPLE_COUNT",
    "TOTAL_SAMPLE_COUNT",
    "build_corpus",
    "category_counts",
    "corpus_template_names",
]
