# SPDX-License-Identifier: Apache-2.0
"""条目可见性与锁定字段的序列化规则（W06）。

为什么独立成文件：``schemas/resume.py`` 已经贴着 500 行预算，而"条目可以被隐藏/锁定"
与"简历内容长什么样"是两件事，与 ``resume_identity.py`` 拆出去的理由相同。

**为什么是三态（``True`` / ``False`` / 缺省）而不是默认 ``False``**：旧记录的 content
JSON 里根本没有这三个键。如果给默认 ``False``，每次序列化都会长出三个 ``false``——
接口响应变胖、内容指纹（导出缓存键 / 交付快照的 ``source_content_sha256``）与历史值
不一致，旧记录也会在"只是打开看了一眼"之后被旧客户端保存成显式 ``false``。
所以语义与 W01 的可选身份完全一致：**没设置 = 键不存在**，有值才输出。

三个字段的分工（W06 语义大纲，plan P1-01）：

- ``hidden``：编辑态保留原文，正式投递产物（HTML/PDF/Word/Markdown/TXT/交付 JSON）
  排除（唯一过滤实现见 ``services/resume/resume_visibility.py``）；
- ``lock_content``：锁正文——AI 改写/翻译/优化器不得改这一条，排版仍可调；
- ``lock_layout``：锁排版——正文可改，但参数与局部排版不得被自动化改写。

本批只落**数据契约**：字段可保存、可往返、导出按 ``hidden`` 过滤；"谁生成 id、锁定
在 AI 路径上如何强制"由后续任务（W12 事实锁）消费这些字段。
"""

from typing import ClassVar

from .resume_identity import OptionalIdentityMixin


class OptionalVisibilityMixin(OptionalIdentityMixin):
    """给六类简历条目混入 ``hidden`` / ``lock_content`` / ``lock_layout``。

    ``None`` 与"字段不存在"在序列化后完全等价（复用 ``resume_identity`` 的 wrap
    序列化器）：旧记录逐字节不变是硬约束，见 ``tests/test_export_golden.py`` 的
    内容指纹基线。

    为什么字段声明在混入类里而不是六个模型各写一遍：``schemas/resume.py`` 的 500 行
    预算只剩二十来行，六个模型 × 三个字段再加注释会超线；而这三项对六类条目是**同一
    语义**，集中一处也避免"某个模型漏了一个字段"这种只在导出处才暴露的偏差。

    ``_optional_identity_fields`` 这个名字沿用 W01 的机制（"哪些字段 ``None`` 不进
    序列化结果"），与字段语义无关；改名会牵动已合入的 W01 实现与 ``FactAnnotation``
    的覆盖，因此只在这里说明。
    """

    hidden: bool | None = None
    lock_content: bool | None = None
    lock_layout: bool | None = None

    _optional_identity_fields: ClassVar[tuple[str, ...]] = (
        "id",
        "point_ids",
        "hidden",
        "lock_content",
        "lock_layout",
    )


__all__ = ["OptionalVisibilityMixin"]
