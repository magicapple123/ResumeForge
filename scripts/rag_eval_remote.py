# SPDX-License-Identifier: Apache-2.0
"""RAG v3 远程（openai-http）60 组质量评测：**无 key 只写 unverified 证据，绝不编数字**。

任务书 v3 §6 / §4.1 要求：远程 provider 也要跑同一套 60 组、出本地 vs 远程对照数字；
但真实端点需要 ``EMBEDDING_API_KEY``。本机的约定是（契约 §0）：
- **没有 key**：写 ``runtime/rag_eval/v3_eval_remote.json``，``status=unverified`` +
  原因 + 期望参数，然后**正常退出 0**（不是错误）；
- **有 key**：用 B 的 ``OpenAIHttpEmbeddingProvider`` 打真实端点（DashScope 兼容模式，
  2026-11-08 实测：model=qwen3.7-text-embedding-flash / dim=1024 / batch=25），编码同一份
  60 组语料，再用产品 ``build_boost`` 融合、同一套 ``rag_eval_common`` 指标，与
  ``v3_eval_local.json`` 做对照；
- **不得用 fake 出质量数字**（既有 spike 的 ``--mode hybrid`` 拒绝逻辑同一条纪律）。

密钥只从环境变量读，不落盘、不打印、不进证据文件。

用法（仓库根目录）：
    $env:EMBEDDING_API_KEY = "..."   # 仅真实远程验证时设置
    backend\\.venv\\Scripts\\python.exe scripts\\rag_eval_remote.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

import rag_eval_common as common
import rag_eval_product_pipeline as product_eval

OUTPUT = common.RUNTIME_DIR / "v3_eval_remote.json"
LOCAL_EVIDENCE = common.RUNTIME_DIR / "v3_eval_local.json"
KEY_ENV = "EMBEDDING_API_KEY"

#: §4.1 已验证过的端参数（只是默认值；可用环境变量覆盖，避免把厂商参数写死进代码）。
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen3.7-text-embedding-flash"
DEFAULT_DIM = 1024
DEFAULT_BATCH_SIZE = 25
DEFAULT_MAX_CANDIDATES = 40


def expected_params(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "base_url": args.base_url,
        "model": args.model,
        "dim": args.dim,
        "batch_size": args.batch_size,
        "max_candidates": args.max_candidates,
    }


def write_unverified(args: argparse.Namespace, reason: str) -> dict[str, Any]:
    """无 key / 依赖未就绪时的如实证据；``quality_numbers`` 永远是 null。"""
    payload = {
        "status": "unverified",
        "reason": reason,
        "expected": expected_params(args),
        "groups": 60,
        "quality_numbers": None,
        "generated_at": common.timestamp(),
        "note": "真实远程质量数字未验证（本机无 EMBEDDING_API_KEY），不得编造。",
    }
    common.write_json(OUTPUT, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"written: {OUTPUT}")
    return payload


def load_local_evidence() -> dict[str, Any] | None:
    if not LOCAL_EVIDENCE.is_file():
        return None
    try:
        return common.read_json(LOCAL_EVIDENCE)
    except Exception:  # noqa: BLE001 - 对照缺失不影响远程单边数字
        return None


def local_comparison(
    local: dict[str, Any] | None, remote_metrics: dict[str, Any]
) -> dict[str, Any]:
    """本地 vs 远程同 60 组对照（只放数字/口径，不放正文）。"""
    if local is None:
        return {"available": False, "reason": "v3_eval_local.json 尚未产出"}
    local_metrics = local.get("metrics") or {}
    keys = ("recall@5", "recall@10", "ndcg@10", "mrr", "section_coverage@10")
    deltas = {
        key: round(float(remote_metrics.get(key, 0.0)) - float(local_metrics.get(key, 0.0)), 6)
        for key in keys
    }
    return {
        "available": True,
        "local_metrics": {key: local_metrics.get(key) for key in keys},
        "remote_metrics": {key: remote_metrics.get(key) for key in keys},
        "remote_minus_local": deltas,
        "local_provider": local.get("provider"),
        "local_status": local.get("status"),
    }


async def _close_provider(provider: Any) -> None:
    closer = getattr(provider, "aclose", None)
    if closer is None:
        return
    closing = closer()
    if hasattr(closing, "__await__"):
        await closing


async def run_remote(args: argparse.Namespace, api_key: str) -> int:
    """真实远程路径：B 的 provider 编码 → 产品 build_boost → common 指标。"""
    common.configure_backend_env(Path(args.corpus_db))
    try:
        from app.services.llm.embeddings import EmbeddingModelSpec
        from app.services.llm.embeddings_http import OpenAIHttpEmbeddingProvider
    except Exception as exc:  # noqa: BLE001 - B 的 provider 未就绪时如实写 blocked
        write_unverified(
            args, f"远程 provider 未就绪（{type(exc).__name__}）；有 key 但无法构造调用器"
        )
        return 2

    fixture = product_eval.load_fixture()
    corpus = common.load_corpus(Path(args.corpus_db))
    product_eval.verify_corpus_digest(corpus, fixture)
    groups = fixture["groups"]
    from app.services.profile.ai_profile import load_ai_consumed_profile
    from app.services.profile.profile_matching import _job_text, build_job_focus
    from app.services.rag.rag_chunking import build_chunks
    from app.services.rag.rag_hybrid import build_boost

    with __import__("app.database", fromlist=["SessionLocal"]).SessionLocal() as db:
        consumed = load_ai_consumed_profile(db)
    chunking = build_chunks(consumed)
    if not chunking.chunks:
        write_unverified(args, "当前组没有可编码的 chunk，远程评测无意义")
        return 2

    spec = EmbeddingModelSpec(
        provider="openai-http",
        model=args.model,
        dim=args.dim,
        pooling="server",
        query_prefix="",
        doc_prefix="",
        normalize=True,
    )
    provider = OpenAIHttpEmbeddingProvider(
        spec,
        base_url=args.base_url,
        api_key=api_key,
        batch_size=args.batch_size,
    )
    started = time.perf_counter()
    try:
        doc_texts = [chunk.display_text for chunk in chunking.chunks]
        doc_batch = await provider.embed_documents(doc_texts)
        doc_ms = (time.perf_counter() - started) * 1000.0
    except Exception as exc:  # noqa: BLE001 - 真实端点失败要如实写 unverified，不留假数字
        await _close_provider(provider)
        write_unverified(args, f"远程编码失败（{type(exc).__name__}）：{exc}")
        return 1
    detected_dim = len(doc_batch.vectors[0]) if doc_batch.vectors else 0
    if detected_dim != args.dim:
        await _close_provider(provider)
        write_unverified(
            args,
            f"远程维度不符：期望 {args.dim}，实际 {detected_dim}（已停止，不写质量数字）",
        )
        return 1
    chunk_vectors = {
        chunk.chunk_id: tuple(vector)
        for chunk, vector in zip(chunking.chunks, doc_batch.vectors, strict=True)
    }

    boosts: dict[str, dict[str, float]] = {}
    diagnostics: list[dict[str, Any]] = []
    encode_ms: list[float] = []
    retrieval_ms: list[float] = []
    try:
        for group in groups:
            job = common.make_job_out(group["job"])
            focus = build_job_focus(job, skill_names=common.skill_names(corpus))
            query_started = time.perf_counter()
            try:
                query_vector = await provider.embed_query(_job_text(job))
            except Exception as exc:  # noqa: BLE001 - 单组失败按回退统计，不中断整轮
                boosts[group["id"]] = {}
                diagnostics.append(
                    {"id": group["id"], "fallback_reason": f"provider_error:{type(exc).__name__}"}
                )
                continue
            encode_ms.append((time.perf_counter() - query_started) * 1000.0)
            fusion_started = time.perf_counter()
            fused = build_boost(consumed, focus, chunking, query_vector, chunk_vectors)
            # 与产品路径同口径：只保留 max_candidates 个候选（产品 rag_service 的截断值）。
            ordered = sorted(fused.scores.items(), key=lambda pair: (-pair[1], pair[0]))
            boosts[group["id"]] = dict(ordered[: args.max_candidates])
            retrieval_ms.append((time.perf_counter() - fusion_started) * 1000.0)
            diagnostics.append({"id": group["id"], "fallback_reason": ""})
    finally:
        await _close_provider(provider)

    evaluated = product_eval.evaluate_groups(corpus, groups, boosts)
    metrics = evaluated["metrics"]
    fallback_count = sum(1 for row in diagnostics if row["fallback_reason"])
    fallback_rate = round(fallback_count / len(groups), 6) if groups else 0.0
    payload: dict[str, Any] = {
        "status": "ok",
        "provider": "openai-http",
        "model": {
            "name": args.model,
            "dim": args.dim,
            "pooling": "server",
            "normalize": True,
        },
        "endpoint": {
            "base_url": args.base_url,
            "batch_size": args.batch_size,
            "max_candidates": args.max_candidates,
            "note": "base_url 不含凭据；key 只从环境变量读，未落盘。",
        },
        "groups": len(groups),
        "corpus_digest": fixture.get("corpus_digest"),
        "metrics": metrics,
        "p95_encode_ms": product_eval._percentile(encode_ms, 0.95),
        "p95_retrieval_ms": product_eval._percentile(retrieval_ms, 0.95),
        "doc_encode_ms": round(doc_ms, 4),
        "fallback_rate": fallback_rate,
        "fallback_count": fallback_count,
        "local_vs_remote": local_comparison(load_local_evidence(), metrics),
        "per_group": evaluated["per_group"],
        "diagnostics": diagnostics,
        "generated_at": common.timestamp(),
        "note": (
            "远程质量数字来自真实 OpenAI 兼容端点；未用 fake。若 local_vs_remote 的 local 缺失，",
            "先跑 scripts/rag_eval_product_pipeline.py。",
        ),
    }
    common.write_json(OUTPUT, payload)
    print(
        json.dumps(
            {
                "status": payload["status"],
                "metrics": metrics,
                "p95_encode_ms": payload["p95_encode_ms"],
                "p95_retrieval_ms": payload["p95_retrieval_ms"],
                "fallback_rate": fallback_rate,
                "local_vs_remote": payload["local_vs_remote"],
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    print(f"written: {OUTPUT}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RAG v3 远程 60 组质量评测")
    parser.add_argument("--corpus-db", default=str(common.DEFAULT_SEED_DB))
    parser.add_argument(
        "--base-url", default=os.environ.get("EMBEDDING_BASE_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument("--model", default=os.environ.get("EMBEDDING_MODEL", DEFAULT_MODEL))
    parser.add_argument(
        "--dim", type=int, default=int(os.environ.get("EMBEDDING_DIM", DEFAULT_DIM))
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.environ.get("EMBEDDING_BATCH_SIZE", DEFAULT_BATCH_SIZE)),
    )
    parser.add_argument(
        "--max-candidates",
        type=int,
        default=int(os.environ.get("RAG_EMBEDDING_MAX_CANDIDATES", DEFAULT_MAX_CANDIDATES)),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    api_key = os.environ.get(KEY_ENV, "").strip()
    if not api_key:
        write_unverified(args, f"{KEY_ENV} 未设置")
        return 0
    return asyncio.run(run_remote(args, api_key))


if __name__ == "__main__":
    raise SystemExit(main())
