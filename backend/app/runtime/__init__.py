"""运行时支撑设施：业务操作预算等跨任务的基础原语。

按架构文档（rf-opt-architecture-2026-10-10.md §2.2/§2.1）规划：RF-02 落地
:mod:`operation_budget`；``dataset_scope`` 由 RF-03 引入，不在本批。
"""

from .operation_budget import OperationBudget, OperationCancelled

__all__ = ["OperationBudget", "OperationCancelled"]
