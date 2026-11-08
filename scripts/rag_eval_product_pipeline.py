# SPDX-License-Identifier: Apache-2.0
"""RAG v3 产品路径 60 组本地评测：走真实 rag_service + 真实 local-onnx provider。

**为什么要有这个脚本**：离线 spike（``rag_eval_embedding_spike.py``）直接调 `build_boost`，
证明的是"算法可行"；本脚本证明**接进产品代码后** Recall@10 仍成立（任务书 v3 §7 第 5 条）。

**口径（与离线 spike 逐字一致；指标唯一实现 ``rag_eval_common``）**：
- 候选 = 当前组参与分区的全部列表型条目（**全库联合排序代理**，不是生成链按分区截断后的
  候选集——后者会改变 Recall 的分母/身份口径；报告中必须写明这一点）；
- 分数 = ``round(_score_item + product_boost, 4)``，平局回落原 index 顺序；
- ``product_boost`` 来自 ``app.services.rag.rag_service.prepare_selection_boost()``：生成链
  同一条产品入口（含 ``rag_embedding_max_candidates`` 截断与 fallback 语义）。

**依赖与等价注入（偏差写进证据文件，不伪造）**：
- 真实 ``LocalOnnxEmbeddingProvider``（A）与 ``rag_service`` 派发（Lead）就是产品代码，
  本脚本不改它们；
- 评测机没有走设置页下载流程，因此脚本用临时 ``RF_DATA_DIR``：把真实模型目录按产品约定
  摆到 ``DATA_DIR/rag-model/<model>-<variant>``、把隔离 venv 的 site-packages 摆到
  ``DATA_DIR/rag-runtime/ort-1.31.1``（硬链接，不复制权重），再以设置页同款
  ``write_embedding_config`` 写入持久化配置——这样 ``resolve_embedding_spec`` /
  ``create_embedding_provider`` / ``rag_service`` 全部走产品分支；
- 若 ``rag_runtime_loader`` 的等价布局仍不认（例如它要求 zip 解包标记），脚本会退到
  ``sys.path`` 注入隔离运行时并在证据里记 ``runtime_injection=manual-sys-path``；
  任何一步走不通都直接失败退出，**绝不写假数字**。

用法（仓库根目录；Windows 本机）：
    backend\\.venv\\Scripts\\python.exe scripts\\rag_eval_product_pipeline.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import rag_eval_common as common

# 聚合/分位实现只允许一份：复用 offline spike 的 _metric_block / _percentile，
# 指标本身仍全部来自 rag_eval_common（唯一实现）。
from rag_eval_embedding_spike import _metric_block, _percentile

#: 离线基线（runtime/rag_eval/baseline.json）与 Phase 3（phase3_granite.json）的 Recall@10。
BASELINE_RECALL10 = 0.405556
PHASE3_RECALL10 = 0.636111
#: 产品接入后允许的 Recall@10 偏移（2 个百分点；目标是与离线 Phase 3 完全一致）。
MAX_DELTA_PP = 0.02

LOCAL_PROVIDER = "local-onnx"
LOCAL_MODEL = "granite-embedding-97m-multilingual-r2"
LOCAL_DIM = 384
LOCAL_POOLING = "cls"
LOCAL_VARIANT = "int8_avx2"
RUNTIME_ORT_VERSION = "1.31.1"

MODEL_DIR = common.RUNTIME_DIR / "model"
DATA_DIR = common.RUNTIME_DIR / "v3_product_data"
OUTPUT = common.RUNTIME_DIR / "v3_eval_local.json"


# ===== 与产品无关的评测编排（可被 rag_eval_remote.py 复用） =====


def load_fixture() -> dict[str, Any]:
    return common.read_json(common.FIXTURE_DIR / "dataset.json")


def verify_corpus_digest(corpus: dict[str, Any], fixture: dict[str, Any]) -> None:
    expected = fixture.get("corpus_digest")
    actual = common.corpus_digest(corpus)
    if expected and expected != actual:
        raise SystemExit(f"语料指纹与 fixture 不一致：fixture={expected} 实际={actual}")


def rank_entries_with_boost(
    entries: list[dict[str, Any]], group: dict[str, Any], boost: dict[str, float], focus: Any
) -> list[dict[str, Any]]:
    """``_score_item + boost`` 联合排序（与 offline spike 的 Phase 3 同一公式）。"""
    from app.services.profile.profile_matching import _score_item
    from app.services.rag.rag_chunking import canonical_item_hash

    scored: list[tuple[float, int, dict[str, Any]]] = []
    for order, row in enumerate(entries):
        section = row["section_key"]
        item = row["entry"]["item"]
        base = float(_score_item(item, section, focus))
        value = round(base + float(boost.get(canonical_item_hash(section, item), 0.0)), 4)
        scored.append((value, order, row))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [row for _value, _order, row in scored]


def metrics_row(ranked: list[dict[str, Any]], group: dict[str, Any]) -> dict[str, Any]:
    """单组指标；计算全部委托 ``rag_eval_common``（唯一实现）。"""
    positions = common.match_targets(ranked, group["targets"])
    return {
        "id": group["id"],
        "positions": positions,
        "recall@5": round(common.recall_at(positions, 5), 6),
        "recall@10": round(common.recall_at(positions, 10), 6),
        "ndcg@10": round(common.ndcg_at(positions, 10), 6),
        "mrr": round(common.mrr(positions), 6),
        "section_coverage@10": round(common.section_coverage(ranked, group["targets"]), 6),
    }


def evaluate_groups(
    corpus: dict[str, Any],
    groups: list[dict[str, Any]],
    boosts: dict[str, dict[str, float]],
) -> dict[str, Any]:
    """把每组的 boost 应用回联合排序，返回逐组行与聚合指标。"""
    from app.services.profile.profile_matching import build_job_focus

    entries = common.iter_ranking_entries(corpus)
    skills = common.skill_names(corpus)
    rows: list[dict[str, Any]] = []
    for group in groups:
        job = common.make_job_out(group["job"])
        focus = build_job_focus(job, skill_names=skills)
        ranked = rank_entries_with_boost(entries, group, boosts.get(group["id"], {}), focus)
        rows.append(metrics_row(ranked, group))
    return {"per_group": rows, "metrics": _metric_block(rows)}


# ===== 等价注入：把真实模型/隔离 runtime 摆到产品约定的 DATA_DIR =====


def _link_tree(source: Path, target: Path) -> None:
    """把目录树硬链接到 target（同卷零拷贝；跨卷退回复制）。已存在则跳过。"""
    if not source.exists():
        raise SystemExit(f"等价注入源不存在：{source}")
    target.mkdir(parents=True, exist_ok=True)
    for item in sorted(source.rglob("*")):
        if item.is_dir():
            continue
        relative = item.relative_to(source)
        destination = target / relative
        if destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(item, destination)
        except OSError:
            shutil.copy2(item, destination)


def _runtime_site_packages_default() -> Path:
    venv = common.RUNTIME_DIR / "venv"
    if sys.platform.startswith("win"):
        return venv / "Lib" / "site-packages"
    candidates = sorted(venv.glob("lib/python*/site-packages"))
    return candidates[0] if candidates else venv / "lib" / "site-packages"


def prepare_equivalent_data_dir(
    data_dir: Path, model_dir: Path, runtime_site_packages: Path, variant: str
) -> dict[str, str]:
    """准备 DATA_DIR 下的模型/运行时目录；返回证据键值（不含任何正文/密钥）。"""
    from app.services.rag import rag_runtime_loader

    model_target = rag_runtime_loader.model_dir(variant)
    _link_tree(model_dir, model_target)
    runtime_target = rag_runtime_loader.runtime_dir(RUNTIME_ORT_VERSION)
    site_target = runtime_target / "site-packages"
    _link_tree(runtime_site_packages, site_target)
    return {
        "data_dir": str(data_dir),
        "model_dir": str(model_target),
        "runtime_dir": str(runtime_target),
        "runtime_site_packages": str(site_target),
    }


# ===== 产品路径 =====


def configure_product_env(data_dir: Path, corpus_db: Path) -> None:
    """在 import app 之前固定产品配置（persisted 配置优先；这里只设置测试用环境兜底）。"""
    os.environ["RF_DATA_DIR"] = str(data_dir)
    os.environ["RAG_RETRIEVAL_ENABLED"] = "true"
    os.environ["RAG_QUERY_EXPANSION_ENABLED"] = "false"
    # 质量评测隔离墙钟噪声：默认 1.5s 预算在共享沙箱上会让偶发慢组回退（两次运行不同），
    # 于是把预算放到 Settings 允许的上限 30s；预算/回退行为由产品 E2E 另行验收，这里只测质量。
    os.environ["RAG_REQUEST_BUDGET_SECONDS"] = "30"
    os.environ["RAG_EMBEDDING_MAX_CANDIDATES"] = "40"
    os.environ["RAG_EMBEDDING_ALLOW_FAKE"] = "false"
    os.environ["RAG_EMBEDDING_TIMEOUT_SECONDS"] = "60"
    common.configure_backend_env(corpus_db)


def write_local_embedding_config(variant: str, model_id: str) -> None:
    """写设置页启用本地 provider 后落盘的同款配置（让产品工厂走 local-onnx 分支）。"""
    from app.services.llm.embedding_settings import EmbeddingProviderConfig, write_embedding_config

    write_embedding_config(
        EmbeddingProviderConfig(
            provider=LOCAL_PROVIDER,
            enabled=True,
            model=model_id,
            dim=LOCAL_DIM,
            pooling=LOCAL_POOLING,
            normalize=True,
            variant=variant,
            last_error="",
        )
    )


async def _close_provider(provider: Any) -> None:
    closer = getattr(provider, "aclose", None)
    if closer is None:
        return
    closing = closer()
    if hasattr(closing, "__await__"):
        await closing


async def measure_query_encode(settings: Any, groups: list[dict[str, Any]]) -> list[float]:
    """独立测 p95 编码耗时：与产品同 spec 的 provider 逐条 query 编码（不动产品结果）。"""
    from app.services.llm.embeddings import create_embedding_provider, resolve_embedding_spec
    from app.services.profile.profile_matching import _job_text

    spec = resolve_embedding_spec(settings)
    provider = create_embedding_provider(spec)
    if provider is None:
        raise SystemExit("产品工厂没有造出 embedding provider（配置/运行时未就绪）")
    timings: list[float] = []
    try:
        for group in groups:
            job = common.make_job_out(group["job"])
            started = time.perf_counter()
            await provider.embed_query(_job_text(job))
            timings.append((time.perf_counter() - started) * 1000.0)
    finally:
        await _close_provider(provider)
    return timings


async def run_product_loop(
    consumed: Any, settings: Any, groups: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, float]], list[dict[str, Any]]]:
    """逐组调用产品入口；返回 (group_id → boost, 逐组耗时/回退诊断)。"""
    from app.services.rag import rag_service
    from app.services.rag.rag_index import get_rag_index

    index = get_rag_index()
    boosts: dict[str, dict[str, float]] = {}
    diagnostics: list[dict[str, Any]] = []
    for group in groups:
        job = common.make_job_out(group["job"])
        started = time.perf_counter()
        scope = await rag_service.prepare_selection_boost(
            consumed, job, settings=settings, index=index, dataset_id=""
        )
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        boosts[group["id"]] = dict(scope.boost)
        diagnostics.append(
            {
                "id": group["id"],
                "retrieval_ms": round(elapsed_ms, 4),
                "fallback_reason": scope.fallback_reason,
                "candidates": len(scope.boost),
                "extra_terms": len(scope.extra_terms),
            }
        )
    return boosts, diagnostics


def ranked_identities(
    corpus: dict[str, Any], groups: list[dict[str, Any]], boosts: dict[str, dict[str, float]]
) -> dict[str, tuple[str, ...]]:
    """每组完整排序的稳定身份列表（section + entry_id），用于两次调用的确定性比对。"""
    from app.services.profile.profile_matching import build_job_focus

    entries = common.iter_ranking_entries(corpus)
    skills = common.skill_names(corpus)
    result: dict[str, tuple[str, ...]] = {}
    for group in groups:
        job = common.make_job_out(group["job"])
        focus = build_job_focus(job, skill_names=skills)
        ranked = rank_entries_with_boost(entries, group, boosts.get(group["id"], {}), focus)
        result[group["id"]] = tuple(
            row["section_key"] + "\x1f" + str(row["entry"].get("entry_id") or "") for row in ranked
        )
    return result


def run_baseline_check(args: argparse.Namespace) -> int:
    """只跑关键词基线，校验本脚本的排序/指标口径与 ``baseline.json`` 逐位一致。

    不依赖 A/Lead 的本地 provider（因此可在依赖未就绪时先证明评测脚手架正确）；
    这也是报告里"产品路径数字与离线基线/Phase 3 可比"的证据之一。
    """
    fixture = load_fixture()
    corpus = common.load_corpus(Path(args.corpus_db))
    verify_corpus_digest(corpus, fixture)
    evaluated = evaluate_groups(corpus, fixture["groups"], {})
    baseline_path = common.RUNTIME_DIR / "baseline.json"
    baseline = common.read_json(baseline_path)
    reference = baseline.get("metrics") or {}
    actual = evaluated["metrics"]
    compared = ("recall@5", "recall@10", "ndcg@10", "mrr", "section_coverage@10")
    deltas = {
        key: round(float(actual[key]) - float(reference.get(key, 0.0)), 6) for key in compared
    }
    passed = all(abs(value) <= 1e-6 for value in deltas.values())
    payload = {
        "mode": "keyword_baseline_harness_check",
        "status": "ok" if passed else "mismatch",
        "groups": len(fixture["groups"]),
        "corpus_digest": fixture.get("corpus_digest"),
        "metrics": actual,
        "baseline_reference": {key: reference.get(key) for key in compared},
        "delta": deltas,
        "assertion": {"name": "关键词基线与 baseline.json 一致（±1e-6）", "passed": passed},
        "generated_at": common.timestamp(),
    }
    output = (
        Path(args.output)
        if args.output != str(OUTPUT)
        else common.RUNTIME_DIR / "_baseline_selfcheck.json"
    )
    common.write_json(output, payload)
    print(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"written: {output}")
    return 0 if passed else 1


async def run_local_eval(args: argparse.Namespace) -> int:
    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    configure_product_env(data_dir, Path(args.corpus_db))
    if args.baseline_only:
        return run_baseline_check(args)

    # ---- 前置能力检查：依赖不齐时给出可执行的结论，不写假数字 ----
    missing: list[str] = []
    for module_name in (
        "app.services.llm.embeddings_local",
        "app.services.rag.rag_asset_manifest",
        "app.services.rag.rag_runtime_loader",
    ):
        try:
            __import__(module_name)
        except Exception as exc:  # noqa: BLE001 - 报告缺哪个模块即可
            missing.append(f"{module_name}: {type(exc).__name__}")
    if missing:
        print("依赖未就绪（等 A/Lead 落地后再跑）：", file=sys.stderr)
        for item in missing:
            print("  - " + item, file=sys.stderr)
        return 2

    from app.config import get_settings
    from app.services.llm.embeddings import create_embedding_provider, resolve_embedding_spec
    from app.services.profile.ai_profile import load_ai_consumed_profile
    from app.services.rag import rag_service

    variant, model_id = LOCAL_VARIANT, LOCAL_MODEL
    try:
        from app.services.rag import rag_asset_manifest

        assets = rag_asset_manifest.select_assets()
        variant = str(assets.get("variant") or variant)
        model_asset = assets.get("model") or {}
        model_id = str(
            model_asset.get("id")
            or model_asset.get("model_id")
            or model_asset.get("name")
            or model_id
        )
    except Exception:  # noqa: BLE001 - 清单未落地时用约定默认值（目录名以 A 的实现为准）
        pass

    fixture = load_fixture()
    settings = get_settings()
    provider_status: dict[str, Any] = {"variant": variant, "model": model_id}
    runtime_injection = "product-rag-runtime-loader"
    if not args.skip_equivalent_injection:
        prepared = prepare_equivalent_data_dir(
            data_dir, Path(args.model_dir), Path(args.runtime_site_packages), variant
        )
        write_local_embedding_config(variant, model_id)
        provider_status.update(prepared)

    spec = resolve_embedding_spec(settings)
    if spec is None or spec.provider != LOCAL_PROVIDER:
        print(f"产品配置没有解析出 local-onnx（实际：{spec}）", file=sys.stderr)
        return 2
    try:
        provider = create_embedding_provider(spec)
    except Exception as exc:  # noqa: BLE001 - 运行时不可用时应给出可读原因而不是堆栈
        print(f"本地 provider 构造失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    if provider is None:
        print("本地 provider 未就绪（create_embedding_provider 返回 None）", file=sys.stderr)
        return 2
    await _close_provider(provider)

    with __import__("app.database", fromlist=["SessionLocal"]).SessionLocal() as db:
        consumed = load_ai_consumed_profile(db)
    corpus = common.load_corpus(Path(args.corpus_db))
    verify_corpus_digest(corpus, fixture)
    groups = fixture["groups"]

    warm = await rag_service.warm_rag_index(consumed, settings=settings)
    print(f"warm: {json.dumps(warm, ensure_ascii=False)}")
    if int(warm.get("encoded") or 0) <= 0 and not args.skip_warm:
        print("索引预热没有编码任何条目：本地 provider 可能未真正可用", file=sys.stderr)
        return 2

    started = time.perf_counter()
    boosts, diagnostics = await run_product_loop(consumed, settings, groups)
    first_pass_seconds = time.perf_counter() - started

    deterministic: bool | None = None
    determinism_details: dict[str, Any] = {}
    if args.repeat >= 2:
        second_started = time.perf_counter()
        second_boosts, second_diag = await run_product_loop(consumed, settings, groups)
        second_pass_seconds = time.perf_counter() - second_started
        first_ranks = ranked_identities(corpus, groups, boosts)
        second_ranks = ranked_identities(corpus, groups, second_boosts)
        ranking_differing = [
            group_id
            for group_id in first_ranks
            if first_ranks[group_id] != second_ranks.get(group_id)
        ]
        boost_differing = boost_differences(boosts, second_boosts)
        deterministic = not ranking_differing
        determinism_details = {
            "ranking_differing_group_count": len(ranking_differing),
            "ranking_differing_groups": ranking_differing[:10],
            "boost_differing_group_count": len(boost_differing),
            "max_boost_delta": max_boost_delta(boosts, second_boosts),
            "second_pass_fallback_count": sum(1 for row in second_diag if row["fallback_reason"]),
            "second_pass_seconds": round(second_pass_seconds, 2),
        }

    encode_ms = await measure_query_encode(settings, groups)
    evaluated = evaluate_groups(corpus, groups, boosts)
    metrics = evaluated["metrics"]
    recall10 = float(metrics["recall@10"])
    delta = round(recall10 - PHASE3_RECALL10, 6)
    fallback_count = sum(1 for row in diagnostics if row["fallback_reason"])
    fallback_rate = round(fallback_count / len(diagnostics), 6) if diagnostics else 0.0
    assertion_passed = abs(delta) <= MAX_DELTA_PP

    payload: dict[str, Any] = {
        "mode": "v3_product_path_local_onnx",
        "status": "ok" if assertion_passed else "assertion_failed",
        "provider": LOCAL_PROVIDER,
        "model": {
            "name": model_id,
            "variant": variant,
            "dim": spec.dim,
            "pooling": spec.pooling,
            "normalize": spec.normalize,
            "source": "persisted embedding config（设置页同款）",
        },
        "groups": len(groups),
        "corpus_digest": fixture.get("corpus_digest"),
        "product_path": {
            "entrypoint": "app.services.rag.rag_service.prepare_selection_boost",
            "ranking": "全库联合排序代理：_score_item + product boost（与离线 spike 同公式）",
            "max_candidates": 40,
            "warm": warm,
            "runtime_injection": runtime_injection,
            "config": provider_status,
        },
        "metrics": metrics,
        "baseline_reference": {
            "recall@10": BASELINE_RECALL10,
            "source": "runtime/rag_eval/baseline.json",
        },
        "phase3_reference": {
            "recall@10": PHASE3_RECALL10,
            "source": "runtime/rag_eval/phase3_granite.json",
        },
        "recall10_delta_pp": round(delta * 100, 4),
        "assertion": {
            "name": "Recall@10 与离线 Phase 3 差 ≤2pp",
            "passed": assertion_passed,
            "tolerance_pp": MAX_DELTA_PP * 100,
        },
        "p95_encode_ms": _percentile(encode_ms, 0.95),
        "p95_retrieval_ms": _percentile([row["retrieval_ms"] for row in diagnostics], 0.95),
        "fallback_rate": fallback_rate,
        "fallback_count": fallback_count,
        "deterministic": deterministic,
        "determinism_details": determinism_details,
        "first_pass_seconds": round(first_pass_seconds, 2),
        "per_group": evaluated["per_group"],
        "diagnostics": diagnostics,
        "generated_at": common.timestamp(),
        "deviations": [
            "评测机未走设置页下载流程：用临时 RF_DATA_DIR + 硬链接把真实模型/隔离 runtime",
            "摆到产品约定目录，并以 write_embedding_config 写入与设置页同款的持久化配置。",
            "候选口径是全库联合排序代理（离线评测同款），不是生成链按分区截断后的候选集。",
            "p95_encode 来自同 spec 的独立 query 编码测量，不参与 boost 计算。",
            "质量评测把 RAG_REQUEST_BUDGET_SECONDS 临时放到 30s（Settings 上限）以隔离墙钟噪声；",
            "产品默认 1.5s 预算与回退行为由 E2E 验收覆盖，不在此表。",
        ],
    }
    output = Path(args.output)
    common.write_json(output, payload)
    print(
        json.dumps(
            {
                "metrics": metrics,
                "baseline_recall@10": BASELINE_RECALL10,
                "phase3_recall@10": PHASE3_RECALL10,
                "recall10_delta_pp": payload["recall10_delta_pp"],
                "assertion": payload["assertion"],
                "p95_encode_ms": payload["p95_encode_ms"],
                "p95_retrieval_ms": payload["p95_retrieval_ms"],
                "fallback_rate": fallback_rate,
                "deterministic": deterministic,
            },
            ensure_ascii=False,
            indent=1,
        )
    )
    print(f"written: {output}")
    return 0 if assertion_passed else 1


def max_boost_delta(
    first: dict[str, dict[str, float]], second: dict[str, dict[str, float]]
) -> float:
    """两次调用里同一 canonical key 的 boost 最大绝对差（模型数值噪声诊断）。"""
    delta = 0.0
    for group_id in set(first) & set(second):
        left = first[group_id]
        right = second[group_id]
        for key in set(left) & set(right):
            delta = max(delta, abs(float(left[key]) - float(right[key])))
    return round(delta, 12)


def boost_differences(
    first: dict[str, dict[str, float]], second: dict[str, dict[str, float]]
) -> list[str]:
    """两次产品调用的 boost 逐组逐键比对，返回不一致的 group id（排序确定性）。"""
    differing: list[str] = []
    for group_id in sorted(set(first) | set(second)):
        left = first.get(group_id) or {}
        right = second.get(group_id) or {}
        if set(left) != set(right):
            differing.append(group_id)
            continue
        if any(abs(float(left[key]) - float(right[key])) > 1e-9 for key in left):
            differing.append(group_id)
    return differing


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RAG v3 产品路径 60 组本地评测")
    parser.add_argument("--corpus-db", default=str(common.DEFAULT_SEED_DB))
    parser.add_argument("--model-dir", default=str(MODEL_DIR))
    parser.add_argument("--data-dir", default=str(DATA_DIR))
    parser.add_argument("--runtime-site-packages", default=str(_runtime_site_packages_default()))
    parser.add_argument("--output", default=str(OUTPUT))
    parser.add_argument("--repeat", type=int, default=2, help="重复次数（>=2 时比对确定性）")
    parser.add_argument(
        "--baseline-only",
        action="store_true",
        help="只跑关键词基线自检（校验本脚本口径与 baseline.json 一致）",
    )
    parser.add_argument("--skip-warm", action="store_true", help="跳过索引预热（调试用）")
    parser.add_argument(
        "--keep-data",
        action="store_true",
        help="保留临时 DATA_DIR（默认结束后删除，避免缓存路径影响 A 的后续证据脚本）",
    )
    parser.add_argument(
        "--skip-equivalent-injection",
        action="store_true",
        help="假定 DATA_DIR 已由设置页流程准备好（不摆模型/runtime）",
    )
    return parser


def cleanup(args: argparse.Namespace) -> None:
    """卸载注入的运行时并删掉临时 DATA_DIR（A 的后续证据脚本不应读到本进程的缓存路径）。"""
    try:
        from app.services.rag import rag_runtime_loader

        rag_runtime_loader.unload_runtime()
    except Exception:  # noqa: BLE001 - 清理失败不影响已经写出的证据
        pass
    if not args.keep_data:
        shutil.rmtree(Path(args.data_dir), ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return asyncio.run(run_local_eval(args))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - 评测脚本要给出可读失败原因，不静默
        print(f"评测失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        raise
    finally:
        cleanup(args)


if __name__ == "__main__":
    raise SystemExit(main())
