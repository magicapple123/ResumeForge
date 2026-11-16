"""AI 求职助手：会话历史、显式上下文和流式模型回复。"""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..runtime.blocking import run_sync
from ..schemas.assistant import (
    AssistantMessageCreate,
    ChatConversationBrief,
    ChatConversationCreate,
    ChatConversationDetail,
    ChatConversationForkRequest,
    ChatConversationUpdate,
    ChatEarlierMessagesOut,
    ChatMessageDeleteRequest,
    ChatMessageDeleteResult,
    ContextUsageOut,
    ConversationSurface,
    ConversationToMaterialRequest,
)
from ..schemas.material import (
    MAX_MATERIAL_CONTENT_CHARS,
    MAX_MATERIAL_NOTE_CHARS,
    MAX_MATERIAL_TITLE_CHARS,
    MaterialCreate,
    MaterialOut,
)
from ..services.actions import add_action_route
from ..services.actions.catalog import registered_action
from ..services.assistant.assistant_compaction_settings import get_compaction_settings
from ..services.assistant.assistant_compaction_store import (
    compaction_state_out,
    load_compaction,
)
from ..services.assistant.assistant_context_policy import (
    request_compaction_limits,
    stored_context_usage,
    with_window_policy,
)
from ..services.assistant.assistant_context_usage import build_context_usage
from ..services.assistant.assistant_context_usage import (
    conversation_text as usage_conversation_text,
)
from ..services.assistant.assistant_conversations import (
    conversation_messages,
    conversation_or_404,
)
from ..services.assistant.assistant_conversations import (
    create_conversation as create_conversation_record,
)
from ..services.assistant.assistant_conversations import (
    delete_conversation as delete_conversation_record,
)
from ..services.assistant.assistant_conversations import (
    delete_messages as delete_message_records,
)
from ..services.assistant.assistant_conversations import (
    fork_conversation as fork_conversation_record,
)
from ..services.assistant.assistant_conversations import (
    list_conversations as list_conversation_records,
)
from ..services.assistant.assistant_conversations import (
    read_conversation as read_conversation_record,
)
from ..services.assistant.assistant_conversations import (
    read_earlier_messages as read_earlier_messages_record,
)
from ..services.assistant.assistant_conversations import (
    update_conversation as update_conversation_record,
)
from ..services.assistant.assistant_persistence import latest_assistant_message
from ..services.assistant.assistant_service import history_messages_for_model
from ..services.assistant.assistant_system_prompt import (
    _RELAXED_MODE_NOTE as _RELAXED_MODE_NOTE,
)
from ..services.assistant.assistant_system_prompt import (
    _local_time_note as _local_time_note,
)
from ..services.assistant.assistant_system_prompt import (
    _proposal_status_block as _proposal_status_block,
)
from ..services.assistant.assistant_system_prompt import (
    _system_prompt as _system_prompt,
)
from ..services.assistant.assistant_system_prompt import (
    build_system_prompt_parts,
)
from ..services.assistant.message_dispatch import (
    MessageDispatchError,
    prepare_message_dispatch,
    save_attachment_copies,
)
from ..services.conversation_export import (
    EXPORT_FORMATS,
    build_conversation_filename,
    conversation_to_markdown,
)
from ..services.llm import create_provider
from ..services.llm.usage_tasks import set_ambient_scope
from ..services.materials import create_material as create_material_record
from ..services.model_context_windows import configured_model_window
from ..services.settings_service import (
    get_llm_config,
    resolve_assistant_relaxed_mode,
)
from .assistant_compaction_api import register_compaction_routes
from .assistant_conversation_skills import register_conversation_skill_routes
from .assistant_regenerate_api import register_regenerate_routes
from .assistant_stream import history_snapshot

router = APIRouter(prefix="/api/assistant", tags=["assistant"])
# T14：对话技能两条路由（GET/PUT /conversations/{id}/skills）挂在同一个 router 上；
# 单独成文件是为了不与 500 行预算冲突，注册顺序即路由注册顺序。
register_conversation_skill_routes(router)
# 上下文压缩（#10）的两条路由同样单独成文件：POST/DELETE /conversations/{id}/compact。
register_compaction_routes(router)
# #13A 重新生成回答：POST /conversations/{id}/messages/{mid}/regenerate。
register_regenerate_routes(router)

# 系统提示词装配（基础提示 + 平台事实 + 能力地图 + 联网/放宽模式说明 + 写操作状态 +
# 本地时间 + 本对话技能 + 界面上下文）已下沉到
# ``services/assistant/assistant_system_prompt.py``：那是纯服务逻辑，与路由无关。
# 本模块按原符号名再导出（见上方 import），既有 import 点与调用点保持不变。


@router.post("/conversations", response_model=ChatConversationBrief, status_code=201)
def create_conversation(payload: ChatConversationCreate, db: Session = Depends(get_db)):
    return create_conversation_record(payload, db)


add_action_route(router, registered_action("list_chat_conversations"), route_path="/conversations")


def list_conversations(
    limit: int = Query(default=100, ge=1, le=500),
    keyword: str = Query(default="", max_length=200),
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """会话列表（置顶 + 更新时间倒序，可按标题/首条消息搜）。

    薄壳：查询与投影都在 ``services.assistant.assistant_conversations.list_conversations``
    （助手动作 ``list_chat_conversations`` 调同一个函数）。
    """
    # P0-2：上限解封到 500 并新增 keyword（标题/首条消息），旧会话靠搜索可达。
    return list_conversation_records(limit, db, surface, keyword=keyword)


add_action_route(
    router,
    registered_action("get_chat_conversation"),
    route_path="/conversations/{conversation_id}",
)


def read_conversation(
    conversation_id: int,
    surface: ConversationSurface = Query(default="page"),
    message_limit: int = Query(
        default=0, ge=0, le=500, description="只取最新 N 条；0 = 全量（旧行为）"
    ),
    db: Session = Depends(get_db),
):
    """会话详情；``message_limit > 0`` 时只取最新 N 条。

    薄壳：查询与投影都在 ``services.assistant.assistant_conversations.read_conversation``
    （助手动作 ``get_chat_conversation`` 调同一个函数）。
    """
    return read_conversation_record(conversation_id, db, surface, message_limit=message_limit)


@router.get(
    "/conversations/{conversation_id}/messages/earlier",
    response_model=ChatEarlierMessagesOut,
)
def read_earlier_messages(
    conversation_id: int,
    before_id: int = Query(ge=1, description="取 id 小于该值（更旧）的消息"),
    limit: int = Query(default=50, ge=1, le=500),
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """「加载更早」（B5 按需加载）：取 before_id 之前最新的 limit 条消息（正序返回）。"""
    items, has_earlier = read_earlier_messages_record(
        conversation_id, before_id, limit, db, surface
    )
    return ChatEarlierMessagesOut(items=items, has_earlier=has_earlier)


@router.patch("/conversations/{conversation_id}", response_model=ChatConversationBrief)
def rename_conversation(
    conversation_id: int,
    payload: ChatConversationUpdate,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    return update_conversation_record(conversation_id, payload, db, surface)


@router.get("/conversations/{conversation_id}/context-usage", response_model=ContextUsageOut)
def read_context_usage(
    conversation_id: int,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
) -> ContextUsageOut:
    """这个对话最近一轮的上下文用量（需求 #6，输入区 chip 的弹层用）。

    正常路径读最新一条**助手消息**落库的 ``context.context_usage``——那是流式期间按
    构造分桶算出来的真实构成，原样返回。

    旧消息（本条之前生成的）没有该字段：只按历史 + 当前系统提示词估算 system 与
    conversation 两桶，其余三桶记 0，并标 ``partial=true``。工具 schema 与连接器块
    无法回溯，所以不是"精确度差一点"，而是**结构性缺失**——前端因此显示「部分数据」，
    不把它当成完整口径。
    """
    conversation_or_404(db, conversation_id, surface)
    # 压缩状态与用量一起下发（#10）：用户在问「占了多少」时，同一屏要能回答
    # 「压过什么、还能不能还原」。没有压缩过就是 null。
    compaction_state = compaction_state_out(load_compaction(db, conversation_id)) or None
    # 分母取当前生效配置：用户刚改过窗口，面板下次打开就该按新值算。
    window = configured_model_window(get_llm_config(db))
    window_tokens = window.tokens
    limits = request_compaction_limits(window_tokens, get_compaction_settings(db).limits)
    stored = stored_context_usage(latest_assistant_message(db, conversation_id))
    if stored is not None:
        return ContextUsageOut.model_validate(
            with_window_policy({**stored, "compaction": compaction_state}, window, limits)
        )
    system_text = build_system_prompt_parts(
        db,
        relaxed=resolve_assistant_relaxed_mode(db, None),
        conversation_id=conversation_id,
    )["base"]
    history_text = usage_conversation_text(
        history_messages_for_model(history_snapshot(db, conversation_id))
    )
    estimated = build_context_usage(
        {"system": system_text, "conversation": history_text},
        window_tokens=window_tokens,
        partial=True,
    )
    return ContextUsageOut.model_validate(
        with_window_policy({**estimated, "compaction": compaction_state}, window, limits)
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    delete_conversation_record(conversation_id, db, surface)


@router.post(
    "/conversations/{conversation_id}/fork",
    response_model=ChatConversationDetail,
    status_code=201,
)
def fork_conversation(
    conversation_id: int,
    payload: ChatConversationForkRequest,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """「在新对话中继续」：带着这段对话最近的上下文开一段新会话。"""
    return fork_conversation_record(conversation_id, payload, db, surface)


@router.get("/conversations/{conversation_id}/export")
def export_conversation(
    conversation_id: int,
    format: str = Query("md", pattern="^(md|txt|json)$"),
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """把一段对话导出成文件：Markdown / 纯文本 / JSON。

    导出内容包含消息正文、时间、附件名、助手做过的操作与参考来源——用户要的是
    "带得走的记录"，不是只有一问一答。
    """
    conversation = conversation_or_404(db, conversation_id, surface)
    media_type, builder = EXPORT_FORMATS[format]
    body = builder(conversation, conversation_messages(db, conversation_id))
    filename = build_conversation_filename(conversation, format)
    return Response(
        body,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}"},
    )


@router.post(
    "/conversations/{conversation_id}/to-material",
    response_model=MaterialOut,
    status_code=201,
)
def conversation_to_material(
    conversation_id: int,
    payload: ConversationToMaterialRequest,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """把这段对话存进资料箱。

    存进去的是导出的 Markdown：助手之后能直接读它、总结它，或按用户要求整理进个人资料。
    """
    conversation = conversation_or_404(db, conversation_id, surface)
    markdown = conversation_to_markdown(conversation, conversation_messages(db, conversation_id))
    truncated = len(markdown) > MAX_MATERIAL_CONTENT_CHARS
    if truncated:
        markdown = markdown[:MAX_MATERIAL_CONTENT_CHARS]
    note = payload.note.strip()
    if truncated:
        note = "\n".join(
            part for part in (note, "对话过长，已截断保存；完整内容请用「导出」下载文件。") if part
        )
    return create_material_record(
        db,
        MaterialCreate(
            title=(payload.title.strip() or conversation.title or "求职助手对话")[
                :MAX_MATERIAL_TITLE_CHARS
            ],
            category=payload.category.strip() or "面试复盘",
            content=markdown,
            note=note[:MAX_MATERIAL_NOTE_CHARS],
        ),
    )


@router.post(
    "/conversations/{conversation_id}/messages/delete",
    response_model=ChatMessageDeleteResult,
)
def delete_messages(
    conversation_id: int,
    payload: ChatMessageDeleteRequest,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """批量删除消息（前端勾选多条后走这里；单条删除见下面的 DELETE 路由）。"""
    deleted = delete_message_records(db, conversation_id, payload.message_ids, surface)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="消息不存在或已被删除")
    return ChatMessageDeleteResult(deleted=deleted)


@router.delete("/conversations/{conversation_id}/messages/{message_id}", status_code=204)
def delete_message(
    conversation_id: int,
    message_id: int,
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    """删除单条消息（引用它的消息会解除引用，正文里的引用快照保留）。"""
    if delete_message_records(db, conversation_id, [message_id], surface) == 0:
        raise HTTPException(status_code=404, detail="消息不存在或已被删除")


def _prepare_stream(
    db: Session,
    conversation_id: int,
    payload: AssistantMessageCreate,
    surface: ConversationSurface,
):
    """入流准备 + 事务收尾 + 释放连接：**整段同步工作单元**（只在 worker 里跑）。

    顺序与拆分前逐字一致：准备 → 提交消息行 → 附件副本（best-effort，在提交之后）。
    ``prepare_message_dispatch`` 仍是模块级名字，测试按 ``app.api.assistant`` 打桩时照旧生效。
    """
    dispatch = prepare_message_dispatch(
        db,
        conversation_id,
        payload,
        surface,
        load_llm_config=get_llm_config,
        create_provider=create_provider,
    )
    # 事务边界在本层：消息行先提交，附件磁盘副本是提交后的 best-effort 动作。
    db.commit()
    save_attachment_copies(db, dispatch)
    # 流式期间请求会话已关闭（值已绑进 dispatch），别占着连接池。
    db.close()
    return dispatch


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: int,
    payload: AssistantMessageCreate,
    db: Session = Depends(get_db),
    surface: ConversationSurface = "page",
):
    """发一条消息并开 SSE 流（消息行先落库，再进流式回合）。

    T2：入流准备（会话/附件/上下文/消息行/provider/系统提示词）已下沉到
    `services/assistant/message_dispatch.py`；本层只做 HTTP 错误映射、事务收尾
    （提交消息行 + best-effort 附件副本）、关闭请求会话与 StreamingResponse 装配。

    RF-02：准备阶段读会话/附件/配置 + 提交消息行都是同步数据库工作，整段交给
    worker（``run_sync``）。**审计上下文仍在事件循环上写**——ContextVar 在 worker
    线程里 set 不会回到事件循环，SSE 期间记录的用量会退回中间件默认值。
    """
    try:
        dispatch = await run_sync(_prepare_stream, db, conversation_id, payload, surface)
    except MessageDispatchError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    set_ambient_scope(**dispatch.audit_scope)
    return StreamingResponse(
        dispatch.event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
