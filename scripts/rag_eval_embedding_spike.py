# SPDX-License-Identifier: Apache-2.0
"""Phase 1 离线 embedding spike：**真实模型**上的召回对比（隔离运行时）。

**为什么用两段式**：任务书 §2.5 规定 onnxruntime 等推理依赖只能装在隔离 venv。
因此嵌入在隔离 venv 的 `rag_eval_embedding_worker.py` 里算（子进程），本脚本用主
venv 的 app 代码做 chunk/排序/指标。模型权重只落在 `runtime/rag_eval/model/`，
不进仓库、不进安装包、不进首装依赖。

**评测口径**与 `rag_eval_run.py` 一致（同一 fixture、同一评分方式）：
- baseline：`_score_item` 联合排序；
- Phase 3：`round(_score_item + RRF 融合 boost, 4)`，平局回落原 index 顺序；
- 同时输出 vector-only 的召回作诊断（不替代 Phase 3 口径）；
指标定义见 `rag_eval_common`（唯一实现）。

用法（仓库根目录；模型目录先由下面的命令准备好，见交付报告 Phase 1 证据）：
    backend\\.venv\\Scripts\\python.exe scripts\\rag_eval_embedding_spike.py
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import time
from pathlib import Path
from typing import Any

import rag_eval_common as common

MODEL_DIR = common.RUNTIME_DIR / "model"
WORKER = common.REPO_ROOT / "scripts" / "rag_eval_embedding_worker.py"
ISOLATED_PYTHON = common.RUNTIME_DIR / "venv" / "Scripts" / "python.exe"
EMBED_INPUT = common.RUNTIME_DIR / "embed_input.json"
EMBED_OUTPUT = common.RUNTIME_DIR / "embed_output.json"
OUTPUT = common.RUNTIME_DIR / "phase3_granite.json"


def _consumed():
    from app import database
    from app.services.profile.ai_profile import load_ai_consumed_profile

    with database.SessionLocal() as db:
        return load_ai_consumed_profile(db)


def _prepare_inputs(corpus: dict[str, Any], fixture: dict[str, Any]) -> dict[str, Any]:
    from app.services.profile.profile_matching import _job_text, build_job_focus
    from app.services.rag.rag_chunking import build_chunks

    consumed = _consumed()
    chunking = build_chunks(consumed)
    texts: list[dict[str, str]] = []
    for chunk in chunking.chunks:
        texts.append({"id": "chunk:" + chunk.chunk_id, "text": chunk.display_text})
    queries: list[dict[str, str]] = []
    for group in fixture["groups"]:
        job = common.make_job_out(group["job"])
        build_job_focus(job, skill_names=common.skill_names(corpus))  # 预热（无副作用）
        queries.append({"id": "query:" + group["id"], "text": _job_text(job)})
    payload = {
        "model_dir": str(MODEL_DIR),
        "max_length": 512,
        "texts": texts + queries,
    }
    EMBED_INPUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return {"chunking": chunking, "consumed": consumed, "groups": fixture["groups"]}


def _run_worker() -> dict[str, Any]:
    if not ISOLATED_PYTHON.exists():
        raise SystemExit(
            "隔离推理 venv 不存在；先执行（确切命令见交付报告 Phase 1 证据）：\n"
            "  backend\\.venv\\Scripts\\python.exe -m venv runtime\\rag_eval\\venv\n"
            "  runtime\\rag_eval\\venv\\Scripts\\python.exe -m pip install onnxruntime tokenizers"
        )
    if not MODEL_DIR.exists() or not list(MODEL_DIR.glob("*.onnx")):
        raise SystemExit(f"模型权重不存在：{MODEL_DIR}（未验证，不得编造数字）")
    started = time.perf_counter()
    result = subprocess.run(
        [
            str(ISOLATED_PYTHON),
            str(WORKER),
            "--model-dir",
            str(MODEL_DIR),
            "--input",
            str(EMBED_INPUT),
            "--output",
            str(EMBED_OUTPUT),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=1800,
    )
    if result.returncode != 0:
        raise SystemExit(
            "隔离推理失败（真实模型未验证，不得编造数字）：\n"
            + (result.stderr or result.stdout or "")[-4000:]
        )
    print(result.stdout.strip())
    print(f"worker wall: {time.perf_counter() - started:.1f}s")
    return json.loads(EMBED_OUTPUT.read_text(encoding="utf-8"))


def _metric_block(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def avg(key: str) -> float:
        return round(statistics.fmean([row[key] for row in rows]), 6) if rows else 0.0

    return {
        "recall@5": avg("recall@5"),
        "recall@10": avg("recall@10"),
        "ndcg@10": avg("ndcg@10"),
        "mrr": avg("mrr"),
        "section_coverage@10": avg("section_coverage@10"),
        "miss_rate@10": round(1.0 - avg("recall@10"), 6),
    }


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    import math

    rank = (len(ordered) - 1) * q
    lower, upper = math.floor(rank), math.ceil(rank)
    if lower == upper:
        return round(ordered[lower], 4)
    fraction = rank - lower
    return round(ordered[lower] * (1 - fraction) + ordered[upper] * fraction, 4)


def _rank_rows(entries: list[dict[str, Any]], score_of) -> list[dict[str, Any]]:
    """按分数确定性排序（-score, 原顺序）；**指标计算全部委托 `rag_eval_common`**。

    与 baseline 用同一套函数（`common.match_targets` / `common.recall_at` /
    `common.ndcg_at` / `common.section_coverage`）：本脚本不再自算任何指标，
    否则两列数字会串口径（上一版 baseline 松口径 0.622 vs Phase 3 紧口径 0.628 即此因）。
    """
    scored = []
    for order, row in enumerate(entries):
        scored.append((score_of(row, order), order, row))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [row for _score, _order, row in scored]


def run(db_path: Path) -> dict[str, Any]:
    fixture = common.read_json(common.FIXTURE_DIR / "dataset.json")
    common.configure_backend_env(db_path)
    from app.services.profile.profile_matching import _score_item, build_job_focus
    from app.services.rag.rag_chunking import canonical_item_hash
    from app.services.rag.rag_hybrid import build_boost

    corpus = common.load_corpus(db_path)
    if common.corpus_digest(corpus) != fixture.get("corpus_digest"):
        raise SystemExit("语料指纹与 fixture 不一致")
    prepared = _prepare_inputs(corpus, fixture)
    embedded = _run_worker()
    vectors = {key: tuple(value) for key, value in embedded["vectors"].items()}
    chunk_vectors = {
        chunk.chunk_id: vectors["chunk:" + chunk.chunk_id]
        for chunk in prepared["chunking"].chunks
        if "chunk:" + chunk.chunk_id in vectors
    }
    entries = common.iter_ranking_entries(corpus)
    fused_rows: list[dict[str, Any]] = []
    vector_rows: list[dict[str, Any]] = []
    keyword_rows: list[dict[str, Any]] = []
    retrieval_ms: list[float] = []
    query_ms: list[float] = []
    for group in fixture["groups"]:
        job = common.make_job_out(group["job"])
        focus = build_job_focus(job, skill_names=common.skill_names(corpus))
        query_vector = vectors["query:" + group["id"]]
        query_ms.append(float(embedded["encode_ms"]["query:" + group["id"]]))
        started = time.perf_counter()
        fused = build_boost(
            prepared["consumed"], focus, prepared["chunking"], query_vector, chunk_vectors
        )
        boost = fused.scores

        def score_of(row, _order, boost=boost, focus=focus):
            section = row["section_key"]
            item = row["entry"]["item"]
            base = float(_score_item(item, section, focus))
            return round(base + float(boost.get(canonical_item_hash(section, item), 0.0)), 4)

        fused_ranked = _rank_rows(entries, score_of)
        keyword_ranked = _rank_rows(
            entries,
            lambda row, _o, focus=focus: float(
                _score_item(row["entry"]["item"], row["section_key"], focus)
            ),
        )
        # vector-only 诊断：条目分 = 该条目 chunk 的最大 cosine（无向量条目 0 分）
        entry_vectors: dict[str, float] = {}
        for chunk in prepared["chunking"].chunks:
            vector = chunk_vectors.get(chunk.chunk_id)
            if vector is None:
                continue
            score = sum(a * b for a, b in zip(query_vector, vector, strict=True))
            entry_vectors[chunk.canonical_item_hash] = max(
                entry_vectors.get(chunk.canonical_item_hash, -1.0), score
            )

        def vector_score(row, _order, entry_vectors=entry_vectors):
            return entry_vectors.get(
                canonical_item_hash(row["section_key"], row["entry"]["item"]), 0.0
            )

        vector_ranked = _rank_rows(entries, vector_score)
        retrieval_ms.append((time.perf_counter() - started) * 1000)
        for ranked, bucket in (
            (fused_ranked, fused_rows),
            (keyword_ranked, keyword_rows),
            (vector_ranked, vector_rows),
        ):
            # 唯一指标实现：scripts/rag_eval_common.py（recall/nDCG/MRR/coverage 全委托）。
            positions = common.match_targets(ranked, group["targets"])
            bucket.append(
                {
                    "id": group["id"],
                    "recall@5": round(common.recall_at(positions, 5), 6),
                    "recall@10": round(common.recall_at(positions, 10), 6),
                    "ndcg@10": round(common.ndcg_at(positions, 10), 6),
                    "mrr": round(common.mrr(positions), 6),
                    "section_coverage@10": round(
                        common.section_coverage(ranked, group["targets"]), 6
                    ),
                }
            )
    out = {
        "mode": "phase3_granite_real",
        "model": {
            "dir": str(MODEL_DIR),
            "onnx_file": embedded.get("model_file"),
            "dim": embedded.get("dim"),
            "pooling": embedded.get("pooling"),
            "query_prefix": "",
            "doc_prefix": "",
            "normalize": True,
            "note": "ibm-granite/granite-embedding-97m-multilingual-r2 int8 ONNX；无需指令前缀",
        },
        "groups": len(fixture["groups"]),
        "phase3": _metric_block(fused_rows),
        "baseline": _metric_block(keyword_rows),
        "vector_only_diagnostic": _metric_block(vector_rows),
        "p95_encode_ms": _percentile(query_ms, 0.95),
        "p95_retrieval_ms": _percentile(retrieval_ms, 0.95),
        "fallback_rate": 0.0,
        "deterministic": True,
        "generated_at": common.timestamp(),
        "note": "真实模型本地推理；vector_only 是诊断口径，Phase 3 行才是本方案口径",
    }
    common.write_json(OUTPUT, out)
    print(
        json.dumps(
            {
                key: out[key]
                for key in (
                    "phase3",
                    "baseline",
                    "vector_only_diagnostic",
                    "p95_encode_ms",
                    "p95_retrieval_ms",
                )
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    print(f"written: {OUTPUT}")
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-db", default=str(common.DEFAULT_SEED_DB))
    args = parser.parse_args()
    run(Path(args.corpus_db))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
