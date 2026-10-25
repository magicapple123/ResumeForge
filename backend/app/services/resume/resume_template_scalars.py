# SPDX-License-Identifier: Apache-2.0
"""模板默认值 / 版式覆盖值的标量收窄。

``TEMPLATE_LAYOUT_DEFAULTS`` 的值联合里含 tuple（双栏列宽比等非标量形状），而
标量读取点（PDF 版式、适配度、字号风格）只需要 float / int。裸 ``float(x)``
会让 pyright 把 tuple 也算进可失败路径；这里的 isinstance 收窄与 ``float(x)``
的运行时行为完全一致（tuple 同样抛 TypeError），只是把"这里不会是 tuple"
显式写给类型系统，而不是在每个调用点散落 cast。
"""

from __future__ import annotations

from typing import TypeAlias

TemplateValue: TypeAlias = "float | str | bool | int | tuple[float, float]"


def template_float(value: TemplateValue) -> float:
    """标量位读取：tuple 与裸 float(...) 一样当场 TypeError。"""
    if isinstance(value, tuple):
        raise TypeError(f"expected a scalar number, got tuple: {value!r}")
    return float(value)


def template_int(value: TemplateValue) -> int:
    """标量位读取（整数量：列数等），语义同 template_float。"""
    if isinstance(value, tuple):
        raise TypeError(f"expected a scalar number, got tuple: {value!r}")
    return int(value)
