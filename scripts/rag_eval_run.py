# SPDX-License-Identifier: Apache-2.0
"""RAG 离线评测执行器（T0.3 基线 / T0.4 查询扩展 / Phase 3 融合的同一把尺子）。

**指标定义（本文件 + `rag_eval_common` 是唯一实现，报告必须按这里引用）**：

- `Recall@k = 命中种子条目数 / 种子条目总数`，k=5/10，逐组算完按 60 组取平均；
- `nDCG@10`：二值相关性，`DCG = Σ_{i=1..10} rel_i / log2(i+1)`，
  `IDCG = Σ_{i=1..min(|targets|,10)} 1/log2(i+1)`，逐组平均；
- `MRR`：首个命中目标名次的倒数，逐组平均（无命中记 0）；
- `section_coverage@10`：目标覆盖的板块里，前 10 名触及的比例，逐组平均；
- `miss_rate@10 = 1 - Recall@10`（漏召回率）；
- `p95 检索耗时`：单组"打分 + 排序"的墙钟耗时 p95（毫秒）。**检索本身不是门槛**，
  这个数字只用来证明它不是瓶颈；
- `p95 编码耗时`：embedding 编码耗时 p95。keyword/expanded 模式没有向量编码，记 null；
- `fallback rate`：本模式下回退到原关键词链的比例（扩展调用失败 / provider 未配置 /
  模型不可用都算回退；回退时结果必须与 keyword 完全一致）。

**排序口径**：见 `rag_eval_common` 模块 docstring——全库联合排序的召回代理，不是
生成链"分区截断后"的候选集合。两者要分开说，报告里必须写明。

模式：

- `keyword`：当前 `build_job_focus` + `_score_item`（baseline）；
- `expanded`：Phase 0 查询扩展，扩展词**只进 `JobFocus.terms`**；扩展结果优先从
  `backend/tests/fixtures/rag_eval/query_expansion.json` 回放（可复现），缺失时用
  `--live-expand` 调真实 LLM 生成（结果用 `--write-expansions` 落 fixture）；
- `hybrid`：Phase 3 关键词 + 向量融合。**只有真实 embedding provider 可用时才产出
  质量数字**；fake provider 只能证明链路通，脚本会拒绝拿它算 Recall/nDCG。

用法（仓库根目录）：

    backend\\.venv\\Scripts\\python.exe scripts\\rag_eval_run.py --mode keyword
    backend\\.venv\\Scripts\\python.exe scripts\\rag_eval_run.py --mode expanded
    backend\\.venv\\Scripts\\python.exe scripts\\rag_eval_run.py --mode expanded --live-expand --write-expansions
"""

from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import time
from pathlib import Path
from typing import Any

import rag_eval_common as common

# 评测的是"功能打开后"的效果：Phase 0 服务本身默认关闭（生产默认），这里显式打开。
# 必须在导入 app 之前设置（app.config 是导入期环境变量快照）。
os.environ.setdefault("RAG_QUERY_EXPANSION_ENABLED", "true")

DATASET_FILE = common.FIXTURE_DIR / "dataset.json"
EXPANSION_FILE = common.FIXTURE_DIR / "query_expansion.json"
TOP_K = 10
RECALL_KS = (5, 10)
MODE_OUTPUT = {
    "keyword": "baseline.json",
    "expanded": "phase0_expanded.json",
    "hybrid": "phase3_hybrid.json",
}


def load_fixture() -> dict[str, Any]:
    if not DATASET_FILE.exists():
        raise SystemExit(f"缺少评测集：{DATASET_FILE}；先跑 scripts/rag_eval_dataset.py --generate")
    payload = common.read_json(DATASET_FILE)
    if not payload.get("groups"):
        raise SystemExit("评测集为空")
    return payload


def ensure_corpus_matches(fixture: dict[str, Any], db_path: Path) -> dict[str, Any]:
    common.configure_backend_env(db_path)
    corpus = common.load_corpus(db_path)
    digest = common.corpus_digest(corpus)
    if digest != fixture.get("corpus_digest"):
        raise SystemExit(
            "语料指纹与 fixture 不一致（种子资料变了？）；重跑 scripts/rag_eval_dataset.py --generate"
        )
    return corpus


def job_fingerprint(job: dict[str, Any]) -> str:
    """与 `job_analysis_cache.analysis_fingerprint` 同口径的稳定指纹。"""
    from app.models.job import Job
    from app.services.job_analysis_cache import analysis_fingerprint

    row = Job(
        title=str(job.get("title") or ""),
        company=str(job.get("company") or ""),
        description=str(job.get("description") or ""),
        requirements=str(job.get("requirements") or ""),
        additional_info=str(job.get("additional_info") or ""),
    )
    return analysis_fingerprint(row)


# ===== 扩展词来源 =====


def load_frozen_expansions() -> dict[str, Any]:
    if not EXPANSION_FILE.exists():
        return {}
    return common.read_json(EXPANSION_FILE)


def _persist_expansions(expansions: dict[str, Any]) -> None:
    payload = {
        "version": 1,
        "provider": "deepseek",
        "model": "deepseek-flash",
        "note": "Phase 0 查询扩展的冻结输出（只含词表与指纹，不含 JD 原文）；由 --live-expand --write-expansions 生成",
        "source": "llm:deepseek-flash",
        "groups": expansions,
    }
    common.write_json(EXPANSION_FILE, payload)


def expand_live(
    groups: list[dict[str, Any]], *, concurrency: int = 4
) -> tuple[dict[str, Any], list[float]]:
    """调真实 Phase 0 服务为每组生成扩展词；任何失败都静默回退（terms=[]）。"""
    from app.models.job import Job
    from app.services.global_llm_profiles import read_global_llm
    from app.services.llm import create_provider
    from app.services.rag import rag_query_expansion

    global_llm = read_global_llm()
    if global_llm is None or not global_llm.config.api_key:
        raise SystemExit("未找到已配置的 LLM，无法 --live-expand")
    config = global_llm.config

    async def one(group: dict[str, Any]) -> tuple[str, dict[str, Any], float, bool]:
        job = group["job"]
        row = Job(
            title=str(job.get("title") or ""),
            company=str(job.get("company") or ""),
            description=str(job.get("description") or ""),
            requirements=str(job.get("requirements") or ""),
            additional_info=str(job.get("additional_info") or ""),
        )
        started = time.perf_counter()
        provider = create_provider(config)
        try:
            terms = await rag_query_expansion.expand_job_terms(row, config, provider=provider)
        except Exception:  # noqa: BLE001 - 服务本身承诺不抛；这里再兜一层
            terms = ()
        elapsed = (time.perf_counter() - started) * 1000
        fingerprint = job_fingerprint(job)
        return fingerprint, {"terms": list(terms)}, elapsed, bool(terms)

    async def runner() -> list[tuple[str, dict[str, Any], float, bool]]:
        semaphore = asyncio.Semaphore(concurrency)

        async def guarded(group: dict[str, Any]):
            async with semaphore:
                return await one(group)

        return await asyncio.gather(*(guarded(group) for group in groups))

    results = asyncio.run(runner())
    expansions: dict[str, Any] = {}
    latencies: list[float] = []
    for fingerprint, payload, elapsed, ok in results:
        expansions[fingerprint] = payload
        if ok:
            latencies.append(elapsed)
    return expansions, latencies


# ===== 指标与主流程 =====


def measure_group(focus, group: dict[str, Any], corpus: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    ranked = common.rank_entries(focus, corpus)
    elapsed_ms = (time.perf_counter() - started) * 1000
    positions = common.match_targets(ranked, group["targets"])
    return {
        "id": group["id"],
        "positions": positions,
        "recall@5": round(common.recall_at(positions, 5), 6),
        "recall@10": round(common.recall_at(positions, 10), 6),
        "ndcg@10": round(common.ndcg_at(positions, 10), 6),
        "mrr": round(common.mrr(positions), 6),
        "section_coverage@10": round(common.section_coverage(ranked, group["targets"], 10), 6),
        "retrieval_ms": round(elapsed_ms, 3),
    }


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 4)
    import math

    rank = (len(ordered) - 1) * q
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return round(ordered[lower], 4)
    fraction = rank - lower
    return round(ordered[lower] * (1 - fraction) + ordered[upper] * fraction, 4)


def build_focus_for(
    mode: str, job: dict[str, Any], corpus: dict[str, Any], expansions: dict[str, Any]
):
    job_out = common.make_job_out(job)
    focus = common.build_focus(job_out, corpus)
    if mode == "keyword":
        return focus, True
    terms = list((expansions.get(job_fingerprint(job)) or {}).get("terms") or [])
    if not terms:
        return focus, False
    return common.focus_with_terms(focus, terms), True


def run(mode: str, *, live_expand: bool, write_expansions: bool) -> dict[str, Any]:
    if mode not in MODE_OUTPUT:
        raise SystemExit(f"未知模式：{mode}")
    fixture = load_fixture()
    db_path = common.REPO_ROOT / str(fixture.get("seed_db") or "")
    corpus = ensure_corpus_matches(fixture, db_path)
    groups = fixture["groups"]

    expansions: dict[str, Any] = {}
    expansion_latencies: list[float] = []
    if mode == "expanded":
        expansions = load_frozen_expansions().get("groups") or {}
        missing = [
            group
            for group in groups
            if not (expansions.get(job_fingerprint(group["job"])) or {}).get("terms")
        ]
        if missing and live_expand:
            generated, expansion_latencies = expand_live(missing)
            expansions.update(generated)
            if write_expansions:
                _persist_expansions(expansions)
        elif missing:
            print(
                f"提示：{len(missing)} 组的扩展词缺失（fixture 未覆盖），按回退处理；"
                "用 --live-expand --write-expansions 生成冻结词表"
            )
    elif mode == "hybrid":
        raise SystemExit(
            "hybrid 模式需要真实 embedding provider；当前环境未验证任何真实模型，"
            "拒绝用 fake provider 计算质量指标（会得到编造数字）。见报告「阻塞项」。"
        )

    per_group: list[dict[str, Any]] = []
    fallback_count = 0
    retrieval_latencies: list[float] = []
    for group in groups:
        focus, ok = build_focus_for(mode, group["job"], corpus, expansions)
        if not ok:
            fallback_count += 1
        result = measure_group(focus, group, corpus)
        per_group.append(result)
        retrieval_latencies.append(result["retrieval_ms"])

    def average(key: str) -> float:
        return round(statistics.fmean([row[key] for row in per_group]), 6) if per_group else 0.0

    metrics = {
        "recall@5": average("recall@5"),
        "recall@10": average("recall@10"),
        "ndcg@10": average("ndcg@10"),
        "mrr": average("mrr"),
        "section_coverage@10": average("section_coverage@10"),
        "miss_rate@10": round(1.0 - average("recall@10"), 6),
        "p95_retrieval_ms": percentile(retrieval_latencies, 0.95),
        "p95_encode_ms": None,
        "p95_expansion_ms": percentile(expansion_latencies, 0.95) if expansion_latencies else None,
        "fallback_rate": round(fallback_count / len(per_group), 6) if per_group else 0.0,
        "fallback_count": fallback_count,
    }
    payload = {
        "mode": mode,
        "fixture_groups": len(groups),
        "corpus_digest": fixture.get("corpus_digest"),
        "metrics": metrics,
        "per_group": per_group,
        "generated_at": common.timestamp(),
        "notes": [],
    }
    out = common.RUNTIME_DIR / MODE_OUTPUT[mode]
    common.write_json(out, payload)
    print(f"mode={mode} groups={len(groups)}")
    for key in (
        "recall@5",
        "recall@10",
        "ndcg@10",
        "mrr",
        "section_coverage@10",
        "miss_rate@10",
        "p95_retrieval_ms",
        "p95_expansion_ms",
        "fallback_rate",
    ):
        print(f"  {key}: {metrics[key]}")
    print(f"written: {out}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG 离线评测执行器")
    parser.add_argument("--mode", default="keyword", choices=sorted(MODE_OUTPUT))
    parser.add_argument("--live-expand", action="store_true", help="扩展词缺失时调用真实 LLM")
    parser.add_argument("--write-expansions", action="store_true", help="把本轮扩展词写入 fixture")
    args = parser.parse_args()
    run(args.mode, live_expand=args.live_expand, write_expansions=args.write_expansions)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
