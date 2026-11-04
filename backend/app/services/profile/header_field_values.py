# SPDX-License-Identifier: Apache-2.0
"""页眉字段目录的**只读取值**（需求 6-A · B 方案）。

背景：制作台的「添加页眉字段」下拉来自 ``GET /api/profile/field-placement-catalog``。
目录本身是纯定义（key / label / 默认位置 / 格式），用户加一条「意向城市」时还得自己
再敲一遍已经填过的值。本模块给目录补上"当前值"，让加入动作带值落地。

**为什么不复用 ``paper_projection.header_field_options``**：两者的裁剪规则同源
（私密字段不下发值、照片是资源引用不是文本），但用途不同——

- 投影的 header_options 是「可加进页眉的候选」，私密字段**整条不出现**；
- 目录是「可加列表 + 当前值」，私密字段**必须仍然出现**（用户得能看到有这么个字段），
  只是值留空，所以判定落在"值要不要给"，而不是"字段要不要出现"。

**值只从资料侧取**：``consumed.section("basic_info")`` 的第一条 singleton 条目，
不经过 v1 ``ResumeContent``——``target_city`` / ``political_status`` 等字段在 v1 内容里
根本没有属性，走内容永远取不到值。

**只读**：本模块不写库，也不改消费快照；返回的表是值的一份拷贝。
"""

from __future__ import annotations

from ...schemas.profile_projection import ConsumedProfile
from ..resume.document_catalog import HEADER_FIELDS
from .paper_content_builder import clean_values

__all__ = ["header_field_value_map"]


def header_field_value_map(consumed: ConsumedProfile | None) -> dict[str, str]:
    """``header item key -> 可下发的当前值``；没有的 key 由调用方按空串兜底。

    四条裁剪规则（前三条与 ``paper_projection.header_field_options`` 同源）：

    - ``basic_info`` 不在当前组、或该组没有条目 → 空表（下拉退回纯目录，不报错）；
    - 隐藏字段已被 ``profile_reader`` 在消费快照里裁掉，这里天然看不到；
    - 私密字段（``private=True``）不下发值——页眉是纸面内容，不能借目录把私密值送出去；
    - 照片（``photo``）不下发值：它是资源引用（data URL / 资源 id），不是可编辑文本，
      真正取图由制作台的照片裁剪器负责。

    表里只收录**非空**值：空值等价于"没有值"，不制造"有 key 无内容"的歧义。
    """
    if consumed is None:
        return {}
    section = consumed.section("basic_info")
    if section is None or not section.entries:
        return {}
    values = clean_values(section.entries[0].values)
    private_ids = {spec.field_id for spec in section.fields if spec.private}
    resolved: dict[str, str] = {}
    for spec in HEADER_FIELDS:
        if spec.key == "photo" or spec.profile_key in private_ids:
            continue
        value = values.get(spec.profile_key, "")
        if value:
            resolved[spec.key] = value
    return resolved
