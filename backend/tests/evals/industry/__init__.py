# SPDX-License-Identifier: Apache-2.0
"""A4/A9 跨行业 24 案例的确定性评测包（计划 §3.2 / §9.4）。

- `case_schema.py`：案例 schema（复用生产 ProfileUpdate / 九类事实 payload 校验）；
- `loader.py`：加载 24 份 JSON 与 `_index.json`，供 runner/report 与测试共用；
- `checks.py`：四条确定性检查（事实保留 / 候选双路径 / 模拟管线 / 负例检出）；
- `cases/`：12 个行业组 × 2 份（sufficient / sparse）纯虚构案例。
"""
