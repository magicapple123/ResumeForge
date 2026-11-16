# SPDX-License-Identifier: Apache-2.0
"""简历生成入口（T2：从 `api/resumes/generate_routes.py` 的 generate_resume 下沉）。

承载 SSE 生成链路的**业务编排**：入口数据边界声明 → 岗位/模型配置校验 → 职业场景冻结 →
资料快照冻结与追溯行落库 → RAG 旁路检索 → 事实基线 → 逐事件生成 → 保存段落库。

**事务边界留在路由**：本模块只 `add/flush`（快照追溯行的 flush 在本模块，提交由
`generate_resume` 路由收尾）；唯一的例外是保存段——它跑在路由拿不到的另一条会话
（从租约身份冻结的 save factory）里，原实现就是"保存成功才宣布 done"，提交留在此处。

**打桩点**：`load_llm_config` / `create_provider` 由路由以参数注入（路由从
`app.api.resumes` 包命名空间调用期读取，保住既有 monkeypatch 契约）。
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...runtime.blocking import run_sync
from ...runtime.log_redact import log_exception_redacted
from ...schemas.job import JobOut
from ...schemas.resume import GenerateRequest, ResumeContent
from .. import trash
from ..career_scenarios.resolve import resolve_context
from ..claims import build_baseline
from ..llm.base import LLMError
from ..llm.usage_tasks import set_ambient_scope
from ..rag.rag_receipt import append_rag_note
from ..rag.rag_service import generate_with_scope, prepare_selection_boost
from ..rag.rag_visibility import rag_state_payload
from . import document_io
from .generate_snapshot import (
    attach_snapshot_resume,
    consumed_has_content,
    freeze_generation_snapshot,
    persist_generation_snapshot,
    snapshot_entry_ids,
)
from .generation_postprocess import enforce_material_only_echo
from .resume_generation_levels import generation_token_budget
from .resume_generator import ResumeGenerator
from .resume_record import save_record
from .scenario_context import build_scenario_prompt_block, scenario_section_order

logger = logging.getLogger(__name__)


class GenerationEntryError(Exception):
    """生成入口的前置条件不满足：status_code / detail 由路由映射成 HTTP 错误。"""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass
class GenerationEntry:
    """SSE 生成的全部冻结输入：路由提交快照行后用它开流，不再回表取业务数据。"""

    job: Job | None
    job_out: JobOut | None
    config: Any
    generator: ResumeGenerator
    frozen: Any
    snapshot_row: Any
    career_block: str
    context_snapshot: dict[str, Any] | None
    save_format_config: Any
    retrieval_scope: Any = None
    retrieval_payload: dict[str, Any] | None = None
    baseline: Any = None

    @property
    def snapshot_pk(self) -> int:
        return int(self.snapshot_row.id)


def log_frozen_context(snapshot, *, transport: str, task_id: int | None = None) -> None:
    """记录"本次生成用了哪一版上下文"——只记标识与哈希，不记场景正文/就业状态。

    计划 §15.3 要求日志能回答"这条任务用的是哪版场景"，同时禁止记录完整场景正文、
    就业状态等用户私有信息。context_sha256 是快照的规范化哈希：既能与后续问题单对上，
    又不能反推正文。
    """
    if snapshot is None:
        return
    logger.info(
        "简历生成上下文已冻结 transport=%s task_id=%s origin=%s scenario_id=%s "
        "preset_key=%s revision=%s catalog_version=%s context_sha256=%s",
        transport,
        task_id if task_id is not None else "-",
        snapshot.scenario_origin,
        snapshot.scenario_id if snapshot.scenario_id is not None else "-",
        snapshot.preset_key or "-",
        snapshot.scenario_revision if snapshot.scenario_revision is not None else "-",
        snapshot.catalog_version or "-",
        (snapshot.context_sha256 or "")[:16],
    )


def log_frozen_profile(frozen, *, transport: str, task_id: int | None = None) -> None:
    """记录"本次生成用了哪个组/哪份快照"——只记标识与计数，不记任何资料内容。"""
    consumed = frozen.consumed
    logger.info(
        "简历生成资料快照已冻结 transport=%s task_id=%s group_id=%s is_default=%s "
        "sections=%s entries=%s definition_revision=%s data_revision=%s",
        transport,
        task_id if task_id is not None else "-",
        consumed.group_id,
        consumed.is_default,
        len(consumed.participating_keys),
        sum(len(section.entries) for section in consumed.sections.values()),
        frozen.definition_revision,
        frozen.data_revision,
    )


def ensure_profile_not_empty(frozen) -> None:
    """资料是否为空必须按**本次快照**判断（不读旧资料表，R-46）。"""
    if not consumed_has_content(frozen.consumed):
        raise GenerationEntryError(400, "个人资料为空，无法生成简历")


def declare_generation_scope(payload: GenerateRequest) -> None:
    """声明本次生成的数据边界（只读 payload，不碰数据库，也不碰任何 IO）。

    **必须由调用方在事件循环线程上调用**：``set_ambient_scope`` 写的是 ContextVar，
    而线程池里的 worker 拿到的是上下文的**副本**——在 worker 里写只能影响那一个线程，
    回到请求协程就丢了，随后 provider 落账会记成"未声明"。

    声明一次即覆盖整条链路：后台任务线程会复制本请求的 contextvars。
    """
    # #35/A1：生成入口的数据边界——喂的是简历 + 资料投影 + 目标岗位（脱敏视图）；
    # 目标语言取本次文档的语言，token 预算与篇幅上限挂钩（见 generation_token_budget）。
    set_ambient_scope(
        input_scope="resume+profile+job",
        masked=True,
        language=payload.options.language,
        budget=generation_token_budget(payload.options),
    )


def prepare_generation_entry(
    db: Session,
    payload: GenerateRequest,
    *,
    load_llm_config: Callable[[Session], Any],
    create_provider: Callable[[Any], Any],
) -> GenerationEntry:
    """入口校验 + 场景/资料快照冻结 + 生成器构造（不提交：路由收尾快照行事务）。

    整段都是同步 DB 工作，**必须**由调用方放进线程池（``run_sync``）：它要读岗位、
    读资料快照、写快照追溯行，之后紧跟的是一次可能持续数分钟的模型流。

    数据边界声明不在这里——见 :func:`declare_generation_scope`：ContextVar 的写入
    在 worker 线程里回传不到请求协程。
    """
    job = db.get(Job, payload.job_id) if payload.job_id is not None else None
    if payload.job_id is not None and (job is None or trash.is_deleted(job)):
        raise GenerationEntryError(404, "岗位不存在或已被删除")

    config = load_llm_config(db)
    if not config.base_url or not config.model:
        raise GenerationEntryError(400, "尚未配置大模型 API")

    # A5：显式选用的职业场景在**取租约之后、流开始之前**解析并冻结。缺省/null
    # 不解析（旧请求零差异）；引用非法/归档/版本不符时明确失败，不创建流。
    snapshot = resolve_context(db, payload.options.career_context)  # CareerContextError 由路由映射
    log_frozen_context(snapshot, transport="sse")
    career_block = build_scenario_prompt_block(snapshot)
    context_snapshot = snapshot.model_dump() if snapshot is not None else None
    # #30：场景 preferred_sections → 板块顺序（用户显式拖过顺序时不覆盖）；
    # 与后台 runner 同一语义（resume_generate_runner 的 save_format_config）。
    scenario_order = None
    if career_block and not (payload.options.format_config or {}).get("section_order"):
        try:
            scenario_order = scenario_section_order(snapshot)
        except Exception:  # noqa: BLE001 - 顺序推导失败按未用场景继续
            logger.warning("SSE 生成场景板块顺序推导失败")
    save_format_config = (
        {**(payload.options.format_config or {}), **scenario_order}
        if scenario_order
        else payload.options.format_config
    )

    # F3 §1：冻结当前组消费快照（租约内、db 仍打开）；随后立即写追溯行，
    # 生成段不再读"当前组"。
    frozen = freeze_generation_snapshot(db)
    ensure_profile_not_empty(frozen)
    log_frozen_profile(frozen, transport="sse")
    snapshot_row = persist_generation_snapshot(db, frozen)
    generator = ResumeGenerator(create_provider(config))
    return GenerationEntry(
        job=job,
        job_out=JobOut.model_validate(job) if job is not None else None,
        config=config,
        generator=generator,
        frozen=frozen,
        snapshot_row=snapshot_row,
        career_block=career_block,
        context_snapshot=context_snapshot,
        save_format_config=save_format_config,
    )


def _load_baseline(session_factory: Callable[[], Session], consumed: Any) -> Any:
    """读事实基线（同步 DB 读）：用**短会话**读出来，读完立刻归还。

    单独成函数是因为它要在线程池里跑；``build_baseline`` 仍然从本模块全局取，
    保住 ``tests/test_dataset_scope_stream.py`` 对该符号的打桩点。
    """
    session = session_factory()
    try:
        return build_baseline(session, source_entry_ids=snapshot_entry_ids(consumed))
    finally:
        session.close()


async def complete_generation_entry(
    entry: GenerationEntry,
    payload: GenerateRequest,
    *,
    dataset_id: str,
    session_factory: Callable[[], Session],
) -> None:
    """快照行提交后补齐旁路输入：RAG 作用域 + 事实基线（只读，不写库）。

    ``session_factory`` 是**冻结数据集身份**的会话工厂（路由用租约身份派生）：这里既不
    接收也不长期持有请求 Session——RAG 的 best-effort 写入与事实基线读取各自开一个短
    会话，用完立刻归还，于是"提交快照 → 检索 → 生成流"这条长链路上不再有任何一条
    请求连接被 await 挂在连接池里。
    """
    retrieval_started = time.perf_counter()
    rag_session = session_factory()
    try:
        entry.retrieval_scope = await prepare_selection_boost(
            entry.frozen.consumed,
            entry.job_out,
            config=entry.config,
            db=rag_session,
            dataset_id=dataset_id,
        )
    finally:
        rag_session.close()
    # #30：把"这一次用没用上语义检索"固定下来，供 SSE 回执与 done 审计共用。
    # 只读 scope，不改生成链行为。
    entry.retrieval_payload = rag_state_payload(
        entry.retrieval_scope,
        elapsed_ms=int((time.perf_counter() - retrieval_started) * 1000),
    )
    # 事实台账里已确认的条目作为事实基线交给模型；台账为空时它就是空基线。
    # F3 契约 §4：只带入能关联到本次快照条目的正向事实（组外/旧资料台账不自动带入）。
    entry.baseline = await run_sync(_load_baseline, session_factory, entry.frozen.consumed)


async def stream_generation_events(
    entry: GenerationEntry,
    payload: GenerateRequest,
    *,
    save_factory: Callable[[], Session],
) -> AsyncIterator[dict[str, Any]]:
    """逐事件产出 SSE 载荷（路由负责 `_format_sse` 与租约释放）。"""
    # #30：检索发生在生成之前，所以先给回执——用户不必等整篇生成完才知道"这次没检索"。
    yield {"type": "retrieval", **(entry.retrieval_payload or {})}
    raw_parts: list[str] = []
    parsed: dict | None = None
    document: dict | None = None
    warnings: list[str] = []
    done_event: dict | None = None
    try:
        async for event in generate_with_scope(
            entry.generator.generate(
                None,
                entry.job_out,
                payload.options,
                baseline=entry.baseline,
                career_context_block=entry.career_block,
                fact_sections=None,
                consumed=entry.frozen.consumed,
            ),
            entry.retrieval_scope,
        ):
            if event["type"] == "delta":
                raw_parts.append(event["text"])
            if event["type"] == "done":
                parsed = event["resume"]
                warnings = event["warnings"]
                done_event = event
                continue
            yield event
        if parsed is not None and done_event is not None:
            # C6/R-43：仅素材字段被抄进纸面正文 → error 事件，不写库。
            echo_error = enforce_material_only_echo(
                ResumeContent.model_validate(parsed), entry.frozen.consumed
            )
            if echo_error:
                yield {"type": "error", "message": echo_error}
                return
            with save_factory() as save_db:
                # SSE 的 done.resume 与详情/保存接口必须同一种形状（v2）：
                # 在保存同一事务的快照里取自定义字段定义，转换一次供事件使用。
                document = document_io.ensure_document_version(
                    parsed,
                    language=payload.options.language,
                    format_config=entry.save_format_config,
                    custom_fields=document_io.custom_field_definitions(save_db),
                )
                record = save_record(
                    save_db,
                    parsed,
                    warnings,
                    entry.job_out,
                    "".join(raw_parts),
                    entry.generator.provider.config.model,
                    payload.options.enhance,
                    payload.options.enhancement_level,
                    requested_title=payload.title,
                    template=payload.options.template,
                    format_name=payload.options.format_name,
                    page_limit=payload.options.page_limit,
                    font_scale=payload.options.font_scale,
                    language=payload.options.language,
                    format_config=entry.save_format_config,
                    custom_instruction=payload.options.custom_instruction,
                    coverage_notes=done_event.get("coverage_notes") or [],
                    rationale=append_rag_note(
                        done_event.get("rationale") or "",
                        payload=entry.retrieval_payload,
                    ),
                    fact_annotations=done_event.get("fact_annotations") or [],
                    document_mode=payload.options.document_mode,
                    context_snapshot=entry.context_snapshot,
                    # 与 SSE done.resume 复用同一份转换结果（只转一次，id 一致）。
                    document=document,
                    commit=False,
                )
                # F3 §1：简历记录与快照行同事务提交（resume_id 回写）。
                attach_snapshot_resume(save_db, snapshot_id=entry.snapshot_pk, resume_id=record.id)
                # 保存段的事务收尾：这条会话从租约身份冻结工厂派生，路由拿不到它，
                # 而"提交成功才宣布 done"就是它的语义（原实现同位置）。
                save_db.commit()
                save_db.refresh(record)
            # 只有持久化成功后才宣布完成；断流不会留下"成功但无历史记录"的状态。
            yield {"type": "saved", "record_id": record.id}
            if document is not None:
                done_event = {**done_event, "resume": document}
            # 与 retrieval 回执同一份数据：页面展示与"可审计的一行"不会互相矛盾。
            done_event = {**done_event, "rag": entry.retrieval_payload}
            yield done_event
    except LLMError:
        logger.warning("简历生成失败（模型错误，用户可见错误已固定脱敏）")
        yield {"type": "error", "message": "模型服务暂时无法完成生成，请稍后重试"}
    except Exception:  # noqa: BLE001 - 流式接口必须兜底，异常转为事件而非中断连接
        log_exception_redacted(logger, "简历生成发生内部错误")
        yield {"type": "error", "message": "生成过程中发生内部错误，请查看后端日志"}


__all__ = [
    "GenerationEntry",
    "GenerationEntryError",
    "complete_generation_entry",
    "declare_generation_scope",
    "ensure_profile_not_empty",
    "log_frozen_context",
    "log_frozen_profile",
    "prepare_generation_entry",
    "stream_generation_events",
]
