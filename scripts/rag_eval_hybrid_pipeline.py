# SPDX-License-Identifier: Apache-2.0
"""Phase 3 融合管道的**链路/耗时**测量（不含质量指标）。

**为什么单独一个脚本、并且拒绝输出 Recall/nDCG**：任务书 §5 规定"不许用随机向量
冒充 embedding 结果去算质量指标"。当前环境没有验证过的真实 embedding 模型，所以
本脚本只用 `FakeEmbeddingProvider`（确定性 hash 向量、与语义无关）证明：
- 融合管道能跑通、失败能回退、同一输入两次结果一致；
- p95 编码/检索耗时量级与 fallback rate 可测量；
质量列一律写 `null` 并标注"未验证"——它们不能被当作 Phase 3 的效果数字。

真实模型可用后，把 `provider` 换成真实 provider 再复用同一编排（rag_service）即可；
本脚本不写死任何模型字符串。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path
from typing import Any

import rag_eval_common as common

RUNTIME_OUT = common.RUNTIME_DIR / "phase3_hybrid.json"


def _settings():
    from app.config import Settings

    return Settings(
        rag_retrieval_enabled=True,
        rag_embedding_provider="fake",
        rag_embedding_model="fake-embedding-v1",
        rag_embedding_dim=64,
        rag_embedding_pooling="mean",
        rag_embedding_timeout_seconds=10.0,
        rag_embedding_max_candidates=40,
    )


def run(db_path: Path) -> dict[str, Any]:
    fixture = common.read_json(common.FIXTURE_DIR / "dataset.json")
    common.configure_backend_env(db_path)
    from app.services.rag.rag_seam import SelectionBoost, selection_scope
    from app.services.rag.rag_service import prepare_selection_boost

    corpus = common.load_corpus(db_path)
    if common.corpus_digest(corpus) != fixture.get("corpus_digest"):
        raise SystemExit("语料指纹与 fixture 不一致")
    settings = _settings()
    consumed = _consumed_from(corpus)
    latencies: list[float] = []
    fallback_count = 0
    boost_sizes: list[int] = []
    stable = True
    for group in fixture["groups"]:
        job = common.make_job_out(group["job"])
        started = time.perf_counter()
        scope = asyncio.run(
            prepare_selection_boost(
                consumed,
                job,
                settings=settings,
                dataset_id="rag_eval",
            )
        )
        latencies.append((time.perf_counter() - started) * 1000)
        if not scope.boost:
            fallback_count += 1
        boost_sizes.append(len(scope.boost))
        # 确定性复核：同一输入第二次构造的候选集合/顺序必须逐条一致（这里比较
        # "作用域里的 hash→分数表"是候选排序的唯一输入）。
        again = asyncio.run(
            prepare_selection_boost(consumed, job, settings=settings, dataset_id="rag_eval")
        )
        if dict(again.boost) != dict(scope.boost):
            stable = False
        # 用作用域做一次真实候选构造，证明接缝能跑通（不参与质量指标）。
        with selection_scope(SelectionBoost(boost=scope.boost)):
            _ = common.rank_entries(common.build_focus(job, corpus), corpus)
    metrics = {
        "groups": len(fixture["groups"]),
        "p95_pipeline_ms": _p95(latencies),
        "fallback_rate": round(fallback_count / max(1, len(latencies)), 4),
        "mean_boost_candidates": round(statistics.fmean(boost_sizes), 2) if boost_sizes else 0,
        "deterministic_scope": stable,
        "recall@5": None,
        "recall@10": None,
        "ndcg@10": None,
        "note": "fake provider（hash 向量，与语义无关）：质量指标未验证，禁止当作品质数字",
    }
    common.write_json(RUNTIME_OUT, {"mode": "hybrid_pipeline_fake", **metrics})
    print(json.dumps(metrics, ensure_ascii=False, indent=1))
    print(f"written: {RUNTIME_OUT}")
    return metrics


def _consumed_from(corpus: dict[str, Any]):
    """把评测语料还原成 ConsumedProfile（只用于本脚本的管道测量）。"""
    from app import database
    from app.services.profile.ai_profile import load_ai_consumed_profile

    with database.SessionLocal() as db:
        return load_ai_consumed_profile(db)


def _p95(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round(0.95 * (len(ordered) - 1))))
    return round(ordered[index], 2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 3 融合管道链路/耗时测量（fake provider）")
    parser.add_argument("--corpus-db", default=str(common.DEFAULT_SEED_DB))
    args = parser.parse_args()
    run(Path(args.corpus_db))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
