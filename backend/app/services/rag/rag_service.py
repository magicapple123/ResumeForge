# SPDX-License-Identifier: Apache-2.0
"""RAG 检索的请求级编排：读冻结快照 → 查询扩展 → 编码/索引 → 融合 → SelectionBoost。

**为什么需要这个文件**：计划 §3.4 的模块表里没有"编排"这一格——`rag_seam` 只负责把
结果交给生成链（≤120 行），`rag_hybrid` 只做数学。把"何时调用谁、失败怎么回退"放进
任何一个单职责模块都会混入两层职责，所以单独成文件（不动方案里的其它边界）。

**请求路径纪律（方案 §2.2）**：编码不在请求路径上硬等。整段检索受
`rag_request_budget_seconds`（默认 1.5s）硬墙钟约束：超预算立即回退关键词链
（`fallback=budget_exceeded`），缺失向量交给 `ai_task_registry` 注册的
`rag_index_warmup` 后台 kind 预热（复用现成执行器，不自己起线程）。暖缓存后
同一条目直接命中进程内索引，不再受预算影响。

**fake provider 守卫**：`FakeEmbeddingProvider` 是确定性 hash 向量、与语义无关。
默认配置下即使把 `RAG_RETRIEVAL_ENABLED` 打开，也只回退（`fallback=fake_provider`），
不会用噪声改写候选顺序；测试/链路对比必须显式配置 `RAG_EMBEDDING_ALLOW_FAKE=true`。

**作用域只覆盖首个事件**：候选在 `generator.generate()` 第一次 `__anext__` 时构造，
`generate_with_scope()` 只在该段内激活 ContextVar，之后退出——否则一次生成 3 分钟的
窗口里 ContextVar 一直有效，与 `rag_seam` 的安全论证相反。

**失败语义是硬约束**：任何异常（未配置 / 模型不可用 / 超时 / 坏响应 / 索引异常）都
返回一个**可用的空作用域**（扩展词能拿到多少算多少），绝不抛给生成链。默认关闭时
本函数不做任何事，生成链与改造前逐字节一致。

**数据库用法**：`db` 只用于把查询扩展结果写回 `job.analysis_cache`（可选）与登记
预热任务；不碰 `profile_entry` 全表、不扩大资料范围。**不碰 prompt 字节**：输出只有
boost 分数与扩展词，候选条目形状仍由 `_select_entries` 决定。
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import threading
import time
from collections.abc import AsyncGenerator, Callable
from typing import Any, cast

from ...config import Settings, get_settings
from ...schemas.profile_projection import ConsumedProfile
from ...schemas.setting import LLMConfig
from ..llm.embeddings import (
    EmbeddingError,
    EmbeddingModelSpec,
    create_embedding_provider,
    resolve_embedding_spec,
)
from ..profile.profile_context import build_consumed_data
from ..profile.profile_matching import _job_text, build_job_focus
from . import rag_observability
from .rag_chunking import ChunkingResult, build_chunks
from .rag_hybrid import build_boost
from .rag_index import RagIndex, RagIndexKey, build_index_key, get_rag_index
from .rag_query_expansion import expand_job_terms
from .rag_seam import (
    SelectionBoost,
    enter_selection_scope,
    exit_selection_scope,
    selection_done,
)
from .rag_visibility import impact_details, rag_state_payload

logger = logging.getLogger(__name__)

#: 上次生效的 embedding 模型指纹。切换 provider / 模型 / 维度时进程内索引里的旧向量
#: 既不会被命中、又会占着有界 LRU，所以首次看到新指纹就清空（设置页切换时也会主动清，
#: 这里是兜底：环境变量/配置文件被手工改过时也能正确切索引）。
_LAST_SPEC_FINGERPRINT: str | None = None
_FINGERPRINT_LOCK = threading.Lock()


def reset_provider_switch_guard() -> None:
    """测试用：清空"上次生效模型"状态，让下一次检索不触发切换清理。"""
    global _LAST_SPEC_FINGERPRINT
    with _FINGERPRINT_LOCK:
        _LAST_SPEC_FINGERPRINT = None


def _track_embedding_spec(spec: EmbeddingModelSpec) -> None:
    """检测模型指纹变化：变了就清索引并记一条 provider_switched 事件。"""
    global _LAST_SPEC_FINGERPRINT
    fingerprint = spec.fingerprint()
    with _FINGERPRINT_LOCK:
        previous = _LAST_SPEC_FINGERPRINT
        _LAST_SPEC_FINGERPRINT = fingerprint
    if previous is not None and previous != fingerprint:
        get_rag_index().clear()
        logger.info(
            "rag event provider_switched provider=%s model=%s dim=%s",
            spec.provider,
            spec.model,
            spec.dim,
        )


async def prepare_selection_boost(
    consumed: ConsumedProfile | None,
    job: Any,
    *,
    config: LLMConfig | None = None,
    db: Any = None,
    settings: Settings | None = None,
    index: RagIndex | None = None,
    dataset_id: str = "",
    on_retrieval: Callable[[dict[str, Any]], None] | None = None,
) -> SelectionBoost:
    """构造一次生成请求的 RAG 输入；**永不抛异常**（失败即空作用域 + 回退原因）。

    ``on_retrieval``（#30）：检索结束后把五态回执交给调用方（后台任务写进度行 / 前端
    轮询可见性）。回执只在旁路消费，回调抛异常只记日志——可见性绝不影响生成结果。

    预算语义见模块 docstring：超预算回退并（在 `db` 可达时）登记后台预热；
    预热只是补齐进程内向量缓存，不改变本次生成的候选。
    """
    started = time.perf_counter()
    scope = await _prepare_selection_boost(
        consumed,
        job,
        config=config,
        db=db,
        settings=settings,
        index=index,
        dataset_id=dataset_id,
    )
    if on_retrieval is not None:
        try:
            on_retrieval(rag_state_payload(scope, elapsed_ms=_elapsed_ms(started)))
        except Exception:  # noqa: BLE001 - 可见性是旁路，回调失败不得影响生成
            logger.warning("rag on_retrieval callback failed")
    return scope


async def _prepare_selection_boost(
    consumed: ConsumedProfile | None,
    job: Any,
    *,
    config: LLMConfig | None = None,
    db: Any = None,
    settings: Settings | None = None,
    index: RagIndex | None = None,
    dataset_id: str = "",
) -> SelectionBoost:
    """检索本体（真实实现；对外入口是上面的 `prepare_selection_boost`）。"""
    settings = settings or get_settings()
    started = time.perf_counter()
    extra_terms = await _safe_expansion(job, config, db, settings)
    if not _retrieval_enabled(settings) or consumed is None or job is None:
        return SelectionBoost(extra_terms=extra_terms, fallback_reason="disabled")
    budget_seconds = max(0.05, float(settings.rag_request_budget_seconds))
    try:
        return await asyncio.wait_for(
            _retrieve(
                consumed,
                job,
                extra_terms=extra_terms,
                settings=settings,
                index=index or get_rag_index(),
                dataset_id=dataset_id,
                started=started,
            ),
            timeout=budget_seconds,
        )
    except asyncio.CancelledError:
        raise
    except TimeoutError:
        _emit("unknown", "", 0, (), _elapsed_ms(started), "budget_exceeded", ())
        if db is not None:
            enqueue_rag_warmup(db)
        return SelectionBoost(extra_terms=extra_terms, fallback_reason="budget_exceeded")
    except Exception as exc:  # noqa: BLE001 - 语义就是"任何失败都回退关键词链"
        _emit(
            provider="unknown",
            model="",
            candidates=0,
            hit_sources=(),
            elapsed_ms=_elapsed_ms(started),
            fallback_reason=_reason_of(exc),
            hash_prefixes=(),
        )
        return SelectionBoost(extra_terms=extra_terms, fallback_reason=_reason_of(exc))


async def _safe_expansion(
    job: Any, config: LLMConfig | None, db: Any, settings: Settings
) -> tuple[str, ...]:
    if job is None or not settings.rag_query_expansion_enabled or config is None:
        return ()
    try:
        return await expand_job_terms(job, config, db=db, settings=settings)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - 扩展是纯增益，失败保持原 JobFocus
        return ()


def _retrieval_enabled(settings: Settings) -> bool:
    """语义检索是否生效：环境总开关 **或** 设置页已启用的真实 provider。

    产品形态下用户只在设置页选 provider（本地/远程），没有编辑环境变量的入口；所以
    "启用 provider"必须等价于"启用语义检索"。``RAG_RETRIEVAL_ENABLED`` 保留为开发/评测
    的总闸（打开它仍要求 provider 可用，否则回退关键词链）。
    """
    if settings.rag_retrieval_enabled:
        return True
    from ..llm.embedding_settings import read_embedding_config

    config = read_embedding_config()
    return bool(
        config is not None and config.enabled and config.provider in ("local-onnx", "openai-http")
    )


def _chunk_key(
    spec: EmbeddingModelSpec,
    consumed: ConsumedProfile,
    chunk: Any,
    dataset_id: str,
) -> RagIndexKey:
    return build_index_key(
        spec,
        dataset_id=dataset_id,
        group_id=consumed.group_id,
        entry_id=chunk.entry_id,
        content_hash=chunk.content_hash,
    )


async def _encode_missing(
    consumed: ConsumedProfile,
    spec: EmbeddingModelSpec,
    provider: Any,
    index: RagIndex,
    dataset_id: str,
    chunking: ChunkingResult,
) -> tuple[dict[str, tuple[float, ...]], int]:
    """把索引里缺失的条目编码进进程内索引；返回 (全部向量, 本次编码条数)。"""
    vectors: dict[str, tuple[float, ...]] = {}
    missing: list[Any] = []
    for chunk in chunking.chunks:
        cached = index.get(_chunk_key(spec, consumed, chunk, dataset_id))
        if cached is None:
            missing.append(chunk)
        else:
            vectors[chunk.chunk_id] = cached
    if not missing:
        return vectors, 0
    batch = await provider.embed_documents([chunk.display_text for chunk in missing])
    if len(batch.vectors) != len(missing):
        raise EmbeddingError("embedding 返回条数与待编码条目数不符")
    for chunk, vector in zip(missing, batch.vectors, strict=True):
        values = tuple(vector)
        vectors[chunk.chunk_id] = values
        index.put(_chunk_key(spec, consumed, chunk, dataset_id), values)
    return vectors, len(missing)


async def warm_rag_index(
    consumed: ConsumedProfile,
    *,
    settings: Settings | None = None,
    dataset_id: str = "",
) -> dict[str, Any]:
    """后台预热：把当前快照里缺失的条目向量编码进进程内索引（幂等、可重复调用）。

    由 `ai_task` 的 `rag_index_warmup` handler 调用；请求路径只登记、不等待。
    返回的诊断字段只含数量/模型名，不含任何资料正文。
    """
    settings = settings or get_settings()
    spec = resolve_embedding_spec(settings)
    if spec is None:
        return {"encoded": 0, "reason": "not_configured"}
    if spec.provider == "fake" and not settings.rag_embedding_allow_fake:
        # fake 向量与语义无关：预热它没有意义，也不该进入生产索引。
        return {"encoded": 0, "reason": "fake_provider"}
    _track_embedding_spec(spec)
    provider = create_embedding_provider(spec)
    if provider is None:
        return {"encoded": 0, "reason": "not_configured"}
    chunking = build_chunks(consumed, dataset_id=dataset_id)
    try:
        _vectors, encoded = await _encode_missing(
            consumed, spec, provider, get_rag_index(), dataset_id, chunking
        )
    finally:
        # provider 可能是带 aclose 的 HTTP provider，也可能是纯 fake（无 aclose）；
        # 这里按 duck typing 关闭连接池（类型收窄成 Any 才能 await 动态属性）。
        closer = getattr(cast(Any, provider), "aclose", None)
        if closer is not None:
            closing = closer()
            if inspect.isawaitable(closing):
                await closing
    return {
        "encoded": encoded,
        "chunks": len(chunking.chunks),
        "provider": spec.provider,
        "model": spec.model,
    }


def enqueue_rag_warmup(db: Any) -> bool:
    """best-effort 登记一个后台预热任务；任何失败都只返回 False，绝不影响生成。

    `db` 是调用方会话；**预热任务自己开会话**（`ai_task` 执行器与租约纪律），
    这里只创建登记行并启动现成执行器。同一时刻已有任务在跑时启动会失败，
    把这条登记标 failed，避免留下永远的 pending 行。
    """
    try:
        from ...models.ai_task import AI_TASK_KIND_RAG_WARMUP, AiTask
        from ..ai_task_runner import get_ai_task_runner

        task = AiTask(kind=AI_TASK_KIND_RAG_WARMUP, payload={}, label="预热语义检索索引")
        db.add(task)
        db.commit()
        db.refresh(task)
        runner = get_ai_task_runner()
        try:
            runner.start(task.id)
        except Exception:  # noqa: BLE001 - 执行器忙/不可用都只是"没预热成"
            runner.mark_failed(task.id, "语义检索预热任务启动失败")
            return False
        return True
    except Exception:  # noqa: BLE001 - 预热是旁路，任何失败都不能影响生成
        logger.info("rag.warmup enqueue skipped")
        return False


async def _retrieve(
    consumed: ConsumedProfile,
    job: Any,
    *,
    extra_terms: tuple[str, ...],
    settings: Settings,
    index: RagIndex,
    dataset_id: str,
    started: float,
) -> SelectionBoost:
    spec = resolve_embedding_spec(settings)
    if spec is None:
        _emit("disabled", "", 0, (), _elapsed_ms(started), "not_configured", ())
        return SelectionBoost(extra_terms=extra_terms, fallback_reason="not_configured")
    if spec.provider == "fake" and not settings.rag_embedding_allow_fake:
        # 默认禁止 fake 进入排序：否则"只打开总开关"就会得到语义随机顺序。
        _emit(spec.provider, spec.model, 0, (), _elapsed_ms(started), "fake_provider", ())
        return SelectionBoost(extra_terms=extra_terms, fallback_reason="fake_provider")
    _track_embedding_spec(spec)
    provider = create_embedding_provider(spec)
    if provider is None:
        _emit(spec.provider, spec.model, 0, (), _elapsed_ms(started), "not_configured", ())
        return SelectionBoost(extra_terms=extra_terms, fallback_reason="not_configured")

    chunking = build_chunks(consumed, dataset_id=dataset_id)
    if not chunking.chunks:
        _emit(spec.provider, spec.model, 0, (), _elapsed_ms(started), "empty_index", ())
        return SelectionBoost(extra_terms=extra_terms, fallback_reason="empty_index")

    vectors, _encoded = await _encode_missing(consumed, spec, provider, index, dataset_id, chunking)
    query_vector = await provider.embed_query(_job_text(job))

    full = build_consumed_data(consumed)
    skill_names = [
        str(item.get("name", "")).strip()
        for item in full.get("skills") or []
        if str(item.get("name", "")).strip()
    ]
    focus = build_job_focus(job, skill_names=skill_names)
    fused = build_boost(consumed, focus, chunking, query_vector, vectors)
    max_candidates = int(settings.rag_embedding_max_candidates)
    ordered = sorted(fused.scores.items(), key=lambda pair: (-pair[1], pair[0]))
    top = ordered[:max_candidates]
    limited = dict(top)
    _emit(
        spec.provider,
        spec.model,
        len(limited),
        ("keyword", "vector"),
        _elapsed_ms(started),
        "",
        tuple(rag_observability.hash_prefix(key) for key, _score in ordered[:3]),
    )
    return SelectionBoost(
        boost=limited,
        extra_terms=extra_terms,
        impacts=impact_details(chunking, top),
    )


async def generate_with_scope(
    stream: AsyncGenerator[dict[str, Any], None],
    scope: SelectionBoost,
) -> AsyncGenerator[dict[str, Any], None]:
    """让 RAG 作用域覆盖"候选构造"那一段，构造完成后立即退出。

    **代码事实（与任务书假设不同，报告 D15）**：`ResumeGenerator.generate()` 在
    构造候选之前会先 yield 一条 progress 事件，所以"只在首个 __anext__ 内激活"会让
    boost 在 `build_profile_selection()` 真正执行前就已失效。这里改用完成标记：
    `profile_matching._select_entries()` 进入候选构造时置位 `mark_selection_done()`，
    包装器在"置位后产出的下一个事件"之后退出作用域——既不让 ContextVar 覆盖整条
    流式生成（可达数分钟），也不早退到本次选择没吃到 boost。

    空作用域（默认关闭 / 回退）直接透传，不引入任何额外上下文开销。

    GeneratorExit / 取消沿 async generator 逐层展开；无论包装器如何结束，内层流都会
    被 `aclose()`（与调用方既有 `finally: await stream.aclose()` 的纪律一致，重复关闭幂等）。
    """
    try:
        if scope.is_empty:
            async for plain_event in stream:
                yield plain_event
            return
        token = enter_selection_scope(scope)
        try:
            try:
                first = await stream.__anext__()
            except StopAsyncIteration:
                return
            yield first
            while not selection_done():
                try:
                    event = await stream.__anext__()
                except StopAsyncIteration:
                    return
                yield event
        finally:
            exit_selection_scope(token)
        async for event in stream:
            yield event
    finally:
        await stream.aclose()


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))


def _reason_of(exc: BaseException) -> str:
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return "timeout"
    if isinstance(exc, EmbeddingError):
        return "provider_error"
    return "exception"


def _emit(
    provider: str,
    model: str,
    candidates: int,
    hit_sources: tuple[str, ...],
    elapsed_ms: int,
    fallback_reason: str,
    hash_prefixes: tuple[str, ...],
) -> None:
    rag_observability.log_rag_event(
        logger,
        rag_observability.RagEvent(
            provider=provider,
            model=model,
            candidate_count=candidates,
            hit_sources=hit_sources,
            elapsed_ms=float(elapsed_ms),
            fallback_reason=fallback_reason,
            hash_prefixes=hash_prefixes,
        ),
    )


__all__ = [
    "enqueue_rag_warmup",
    "generate_with_scope",
    "prepare_selection_boost",
    "reset_provider_switch_guard",
    "warm_rag_index",
]
