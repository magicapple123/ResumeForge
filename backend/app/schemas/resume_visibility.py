# SPDX-License-Identifier: Apache-2.0
"""条目可见性与锁定字段的序列化规则（W06）。

为什么独立成文件：schemas/resume.py 已经贴着 500 行预算，而"条目可以被隐藏/锁定"
与"简历内容长什么样"是两件事，与 resume_identity.py 拆出去的理由相同。

**为什么是三态（True / False / 缺省）而不是默认 False**：旧记录的 content JSON 里根本
没有这些键。如果给默认 False，每次序列化都会长出三个 false——接口响应变胖、内容指纹
（导出缓存键 / 交付快照的 source_content_sha256）与历史值不一致，旧记录也会在"只是
打开看了一眼"之后被旧客户端保存成显式 false。所以语义与 W01 的可选身份完全一致：
**没设置 = 键不存在**，有值才输出。

字段分工（W06 语义大纲，plan P1-01）：

- hidden：编辑态保留原文，正式投递产物（HTML/PDF/Word/Markdown/TXT/交付 JSON）排除
  （唯一过滤实现见 services/resume/resume_visibility.py）；
- hidden_points：**要点级隐藏**（审计补项）——存该条目 point_ids 映射里的要点 id 子集
  （不是下标：下标会随复制/排序/新增漂移）。空列表与 None 都**不序列化**（与"没设置"
  等价），所以旧记录与旧指纹逐字节不变；旧记录没有 point_ids 时该字段无从生效（前端
  隐藏要点前必须先给要点分配稳定 id，W01 契约）；
- lock_content：锁正文——AI 改写/翻译/优化器不得改这一条，排版仍可调；
- lock_layout：锁排版——正文可改，但参数与局部排版不得被自动化改写。

本批只落**数据契约**：字段可保存、可往返、导出按 hidden / hidden_points 过滤；
"谁生成 id、锁定在 AI 路径上如何强制"由后续任务（W12 事实锁）消费这些字段。
"""

from typing import ClassVar

from pydantic import model_serializer

from .resume_identity import OptionalIdentityMixin


class OptionalVisibilityMixin(OptionalIdentityMixin):
    """给六类简历条目混入 hidden / hidden_points / lock_content / lock_layout。

    None 与"字段不存在"在序列化后完全等价（复用 resume_identity 的 wrap 序列化器）：
    旧记录逐字节不变是硬约束，见 tests/test_export_golden.py 的内容指纹基线。
    hidden_points 额外把**空列表**也当作"没设置"（见下方序列化器）。

    为什么字段声明在混入类里而不是六个模型各写一遍：schemas/resume.py 的 500 行预算
    只剩二十来行，六个模型 × 四个字段再加注释会超线；而这几项对六类条目是**同一语义**，
    集中一处也避免"某个模型漏了一个字段"这种只在导出处才暴露的偏差。

    _optional_identity_fields 这个名字沿用 W01 的机制（"哪些字段 None 不进序列化
    结果"），与字段语义无关；改名会牵动已合入的 W01 实现与 FactAnnotation 的覆盖，
    因此只在这里说明。
    """

    hidden: bool | None = None
    hidden_points: list[str] | None = None
    lock_content: bool | None = None
    lock_layout: bool | None = None

    _optional_identity_fields: ClassVar[tuple[str, ...]] = (
        "id",
        "point_ids",
        "hidden",
        "hidden_points",
        "lock_content",
        "lock_layout",
    )

    @model_serializer(mode="wrap")
    def _drop_unset_visibility(self, handler):  # noqa: ANN001, ANN201 - pydantic handler 无公开类型
        """省略"没设置"的可见性字段：None，以及 hidden_points 的空列表。

        覆盖父类 OptionalIdentityMixin 的同型序列化器（本类所有模型共用它），
        FactAnnotation 等只用父类的模型行为不变。
        """
        data = handler(self)
        if isinstance(data, dict):
            for key in getattr(self, "_optional_identity_fields", ()):
                if key in data and data[key] is None:
                    data.pop(key, None)
            if not data.get("hidden_points"):
                data.pop("hidden_points", None)
        return data


__all__ = ["OptionalVisibilityMixin"]
