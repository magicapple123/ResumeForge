# SPDX-License-Identifier: Apache-2.0
"""可选身份字段的序列化规则（W01）。

独立成文件的原因很实际：``schemas/resume.py`` 已经贴着 500 行预算，而这条规则与
"简历内容长什么样"无关，只回答"没有身份的时候要不要输出 null"。
"""

from typing import ClassVar

from pydantic import model_serializer


class OptionalIdentityMixin:
    """把"没设置的身份字段"从序列化结果里省掉（W01）。

    为什么要费这一步：``id`` / ``point_ids`` 只是为了给条目一个稳定锚点，绝大多数
    简历没有它们。如果让 pydantic 默认把 ``None`` 也吐出来，每一个条目都会多两个
    ``null`` 键——接口响应变胖、``content`` JSON 里塞满空字段、内容指纹（导出缓存键与
    交付快照的 ``source_content_sha256``）也会因为"多了两个 null"而与历史值不一致。
    这里让"没有身份"与"字段不存在"在**序列化后**完全等价，旧记录与旧客户端因此一个
    字节都不受影响；有值时照常输出。

    只处理本类声明的字段：``FactAnnotation`` 复用同一机制，但它的可选字段多得多，
    历史行为（``claim_id`` 等照常输出 ``null``）不能一起改。

    用 ``getattr`` 取字段名表而不是直接属性访问：字段被赋成**原始 dict**（未走 pydantic
    校验的路径，例如测试或旧 AI 兜底数据）时，序列化器仍会以 dict 作为 ``self`` 被调用；
    直接访问属性会抛 ``AttributeError``，把一次导出变成 500。这种情况下不丢任何键即可。
    """

    _optional_identity_fields: ClassVar[tuple[str, ...]] = ("id", "point_ids")

    @model_serializer(mode="wrap")
    def _drop_unset_identity(self, handler):  # noqa: ANN001, ANN201 - pydantic 的 handler 无公开类型
        data = handler(self)
        if isinstance(data, dict):
            for key in getattr(self, "_optional_identity_fields", ()):
                if key in data and data[key] is None:
                    data.pop(key, None)
        return data


class OptionalEmptyListMixin:
    """把"没有内容的列表字段"从序列化结果里省掉（W14，D11）。

    W14 给 ResumeContent 加了 publications / research_projects / patents 三个列表。
    旧记录没有这三个键 → 取默认空列表；若让 pydantic 默认把 ``[]`` 吐出来，
    **所有旧记录的内容指纹（交付快照的 source_content_sha256）都会变**，与历史交付
    不可比。这里让"空列表"与"字段不存在"在序列化后等价——与 OptionalIdentityMixin
    同一思路（"未设置就不出现"），只是判定条件是"空列表"而不是 None。

    子类用 ``_optional_empty_list_fields`` 声明要处理的字段；本类不硬编码任何字段名。
    """

    _optional_empty_list_fields: ClassVar[tuple[str, ...]] = ()

    @model_serializer(mode="wrap")
    def _drop_empty_lists(self, handler):  # noqa: ANN001, ANN201 - pydantic handler 无公开类型
        data = handler(self)
        if isinstance(data, dict):
            for key in getattr(self, "_optional_empty_list_fields", ()):
                if key in data and not data[key]:
                    data.pop(key, None)
        return data


# 与个人资料的差异：多行文本拆成了数组，更利于模型逐条输出与后续渲染。
