# SPDX-License-Identifier: Apache-2.0
"""求职偏好的枚举映射与目录选项——兼容壳，真源在词表包。

历史：拆出本模块的唯一原因是 ``job_preference_catalog`` 贴住了
``tests/test_file_size_budget.py`` 的 500 行硬闸门（``ruff format`` 会把多条目字典展开成
一行一条）。这层拆分在 RF-07a 之后合并进 :mod:`app.vocabulary.job_preference_terms`：
数据本身属于词表，和"谁能依赖谁"无关，而 schema 也要用同一份。

本模块保留为**再导出壳**，``from app.services.job_preference_taxonomy import WORK_MODE_MAP``
一类既有导入路径继续可用；符号名、值、顺序与中文展示全部来自词表模块的那一份对象，
不是副本——所以两处永远不可能漂移。
"""

from __future__ import annotations

from ..vocabulary.job_preference_terms import (
    CHINESE_NUMBERS as CHINESE_NUMBERS,
)
from ..vocabulary.job_preference_terms import (
    EMPLOYMENT_TYPE_MAP as EMPLOYMENT_TYPE_MAP,
)
from ..vocabulary.job_preference_terms import (
    EMPLOYMENT_TYPE_OPTIONS as EMPLOYMENT_TYPE_OPTIONS,
)
from ..vocabulary.job_preference_terms import (
    OVERTIME_MAP as OVERTIME_MAP,
)
from ..vocabulary.job_preference_terms import (
    OVERTIME_OPTIONS as OVERTIME_OPTIONS,
)
from ..vocabulary.job_preference_terms import (
    REDLINE_TONE_OPTIONS as REDLINE_TONE_OPTIONS,
)
from ..vocabulary.job_preference_terms import (
    TONE_MAP as TONE_MAP,
)
from ..vocabulary.job_preference_terms import (
    WORK_MODE_MAP as WORK_MODE_MAP,
)
from ..vocabulary.job_preference_terms import (
    WORK_MODE_OPTIONS as WORK_MODE_OPTIONS,
)

__all__ = [
    "CHINESE_NUMBERS",
    "EMPLOYMENT_TYPE_MAP",
    "EMPLOYMENT_TYPE_OPTIONS",
    "OVERTIME_MAP",
    "OVERTIME_OPTIONS",
    "REDLINE_TONE_OPTIONS",
    "TONE_MAP",
    "WORK_MODE_MAP",
    "WORK_MODE_OPTIONS",
]
