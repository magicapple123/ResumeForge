# SPDX-License-Identifier: Apache-2.0
"""RAG（语义补召回）模块包：派生数据、默认关闭、可整体回退。

模块边界（计划 §3.4）：
- `rag_types` / `rag_chunking`：由冻结的 `ConsumedProfile` 构造稳定 chunk 与
  `canonical_item_hash` 桥接表（身份必须在 chunk 侧补齐）；
- `rag_policy` / `rag_observability`：过滤白名单与脱敏日志；
- `rag_index` / `rag_hybrid` / `rag_seam`：有界进程内向量缓存、融合与注入接缝；
- `rag_query_expansion`：Phase 0 的零依赖查询扩展（只进 JobFocus.terms）。

**依赖方向**：RAG 只消费 `schemas.profile_projection` 的消费 DTO 与 `llm/` 的
provider 能力，不反向 import API 路由，不直接操作 LLM prompt，不改 `ConsumedProfile`
的隐私语义。向量索引是**可重建派生数据**：进程内缓存，不写业务库，不进备份。
"""
