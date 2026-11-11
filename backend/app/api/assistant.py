"""AI 求职助手：会话历史、显式上下文和流式模型回复。"""

import logging
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.assistant import ChatMessage
from ..models.profile import utcnow
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
from ..services.actions.catalog import all_actions
from ..services.assistant.assistant_compaction_store import (
    compaction_state_out,
    load_compaction,
)
from ..services.assistant.assistant_context_usage import build_context_usage
from ..services.assistant.assistant_context_usage import (
    conversation_text as usage_conversation_text,
)
from ..services.assistant.assistant_service import (
    conversation_title,
    history_messages_for_model,
    normalize_attachments,
)
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
from ..services.conversation_export import (
    EXPORT_FORMATS,
    build_conversation_filename,
    conversation_to_markdown,
)
from ..services.llm import create_provider
from ..services.llm.usage_tasks import (
    DEFAULT_AUDIT_BUDGET,
    DEFAULT_AUDIT_LANGUAGE,
    set_ambient_scope,
)
from ..services.materials import create_material as create_material_record
from ..services.settings_service import (
    get_llm_config,
    resolve_assistant_relaxed_mode,
)
from ..services.ui_locale import get_ui_locale
from ..services.user_files import save_from_data_url
from .assistant_compaction_api import register_compaction_routes
from .assistant_context import load_local_context
from .assistant_conversation_skills import register_conversation_skill_routes
from .assistant_conversations import (
    DEFAULT_TITLE,
    conversation_or_404,
)
from .assistant_conversations import (
    create_conversation as create_conversation_record,
)
from .assistant_conversations import (
    delete_conversation as delete_conversation_record,
)
from .assistant_conversations import (
    delete_messages as delete_message_records,
)
from .assistant_conversations import (
    fork_conversation as fork_conversation_record,
)
from .assistant_conversations import (
    list_conversations as list_conversation_records,
)
from .assistant_conversations import (
    read_conversation as read_conversation_record,
)
from .assistant_conversations import (
    read_earlier_messages as read_earlier_messages_record,
)
from .assistant_conversations import (
    update_conversation as update_conversation_record,
)
from .assistant_regenerate_api import register_regenerate_routes
from .assistant_stream import history_snapshot, stream_message_events

logger = logging.getLogger(__name__)


def _save_attachment_copies(
    db: Session, message_id: int, attachments: list[dict[str, Any]]
) -> None:
    """best-effort：把消息附件里的 data URL 落一份磁盘副本（失败只记日志）。"""
    for item in attachments or []:
        if not isinstance(item, dict):
            continue
        data_url = str(item.get("data_url") or "")
        if not data_url:
            continue
        try:
            save_from_data_url(
                db,
                data_url,
                source_type="chat_attachment",
                source_ref=f"chat_message:{message_id}",
                fallback_name=str(item.get("name") or ""),
                fallback_mime=str(item.get("mime_type") or ""),
            )
        except Exception:  # noqa: BLE001 - 副本是锦上添花，绝不能挡住消息发送
            logger.warning("助手附件磁盘副本保存失败 chat_message:%s", message_id, exc_info=True)


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


add_action_route(router, all_actions()["list_chat_conversations"], route_path="/conversations")
def list_conversations(
    limit: int = Query(default=100, ge=1, le=500),
    keyword: str = Query(default="", max_length=200),
    surface: ConversationSurface = Query(default="page"),
    db: Session = Depends(get_db),
):
    # P0-2：上限解封到 500 并新增 keyword（标题/首条消息），旧会话靠搜索可达。
    return list_conversation_records(limit, db, surface, keyword=keyword)


add_action_route(router, all_actions()["get_chat_conversation"], route_path="/conversations/{conversation_id}")
def read_conversation(
    conversation_id: int,
    surface: ConversationSurface = Query(default="page"),
    message_limit: int = Query(
        default=0, ge=0, le=500, description="只取最新 N 条；0 = 全量（旧行为）"
    ),
    db: Session = Depends(get_db),
):
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


def _stored_context_usage(message: ChatMessage | None) -> dict[str, Any] | None:
    """从消息 context 里取出落过库的用量（需求 #6）；旧消息没有该字段时返回 None。"""
    if message is None:
        return None
    context = message.context if isinstance(message.context, dict) else {}
    usage = context.get("context_usage")
    return usage if isinstance(usage, dict) else None


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
    window_tokens = int(getattr(get_llm_config(db), "context_window_tokens", 0) or 0)
    latest = (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id, ChatMessage.role == "assistant")
        .order_by(ChatMessage.id.desc())
        .first()
    )
    stored = _stored_context_usage(latest)
    if stored is not None:
        return ContextUsageOut.model_validate({**stored, "compaction": compaction_state})
    system_text = build_system_prompt_parts(
        db,
        relaxed=resolve_assistant_relaxed_mode(db, None),
        conversation_id=conversation_id,
    )["base"]
    history_text = usage_conversation_text(history_messages_for_model(history_snapshot(db, conversation_id)))
    estimated = build_context_usage(
        {"system": system_text, "conversation": history_text},
        window_tokens=window_tokens,
        partial=True,
    )
    return ContextUsageOut.model_validate({**estimated, "compaction": compaction_state})


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


def _conversation_messages(db: Session, conversation_id: int) -> list[ChatMessage]:
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conversation_id)
        .order_by(ChatMessage.id)
        .all()
    )


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
    body = builder(conversation, _conversation_messages(db, conversation_id))
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
    markdown = conversation_to_markdown(conversation, _conversation_messages(db, conversation_id))
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


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: int,
    payload: AssistantMessageCreate,
    db: Session = Depends(get_db),
    surface: ConversationSurface = "page",
):
    conversation = conversation_or_404(db, conversation_id, surface)
    try:
        attachments = normalize_attachments(payload.attachments)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # 放宽模式：请求覆盖优先（None = 沿用全局设置）；流式期间请求会话已关闭，值绑进闭包。
    relaxed_mode = resolve_assistant_relaxed_mode(db, payload.relaxed_mode)
    # #35：助手入口的输入边界——放宽模式决定是否带身份字段（masked = 非放宽）。
    # 目标语言优先取用户显式保存的界面语言（`/api/settings/locale`，数据集内持久化，
    # 是唯一权威值）；用户还没保存过时退回本次请求可选携带的 `locale`；两者都没有就留空
    # （＝本次不涉及语言选择），而不是记成缺失。
    set_ambient_scope(
        input_scope="assistant_context",
        masked=not relaxed_mode,
        language=get_ui_locale(db) or payload.locale or DEFAULT_AUDIT_LANGUAGE,
        # 助手是多轮工具循环，单轮输出仍受 provider 默认约束；审计按应用默认输出
        # 上界声明预算（A1：不再留 None，否则分不清"没声明"与"不限制"）。
        budget=DEFAULT_AUDIT_BUDGET,
    )
    try:
        context_blocks, context_metadata = load_local_context(db, payload, relaxed=relaxed_mode)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    config = get_llm_config(db)
    if not config.base_url or not config.model:
        raise HTTPException(status_code=400, detail="尚未配置大模型 API")

    history = history_snapshot(db, conversation_id)
    had_messages = bool(history)
    # 「引用追问」：只允许引用同一会话的消息，并把快照存进 context（原消息删了仍可读）。
    quoted_snapshot: dict[str, Any] | None = None
    if payload.quoted_message_id is not None:
        quoted = db.get(ChatMessage, payload.quoted_message_id)
        if quoted is None or quoted.conversation_id != conversation_id:
            raise HTTPException(status_code=404, detail="被引用的消息不存在或不在当前会话")
        quoted_snapshot = {
            "id": quoted.id,
            "role": quoted.role,
            "excerpt": quoted.content.strip()[:500],
        }
        context_metadata["quoted"] = quoted_snapshot
    user_message = ChatMessage(
        conversation_id=conversation_id,
        role="user",
        content=payload.content,
        quoted_message_id=payload.quoted_message_id,
        attachments=attachments,
        context=context_metadata,
        status="complete",
    )
    assistant_message = ChatMessage(
        conversation_id=conversation_id,
        role="assistant",
        status="pending",
        model=config.model,
    )
    db.add_all([user_message, assistant_message])
    if not had_messages and conversation.title == DEFAULT_TITLE:
        conversation.title = conversation_title(payload.content, attachments)
    conversation.updated_at = utcnow()
    db.commit()
    db.refresh(user_message)
    db.refresh(assistant_message)
    user_message_id = user_message.id
    assistant_message_id = assistant_message.id
    _save_attachment_copies(db, user_message_id, attachments)
    generated_title = conversation.title
    # 思考强度只作用于本次调用：助手页可随时切换，不改写设置里的模型配置。直接设在
    # 实例上而不走 create_provider 参数——测试与自定义 provider 只实现 `(config)` 签名。
    # `without_thinking()` 剥掉设置页的「思考模式」（那是**除助手以外**的 AI 调用开关），
    # 助手只认这个单次请求级的选择。
    provider = create_provider(config.without_thinking())
    provider.request_overrides = {"reasoning_effort": payload.reasoning_effort}
    db.close()

    return StreamingResponse(
        stream_message_events(
            payload=payload,
            attachments=attachments,
            provider=provider,
            history=history,
            context_blocks=context_blocks,
            context_metadata=context_metadata,
            user_message_id=user_message_id,
            assistant_message_id=assistant_message_id,
            generated_title=generated_title,
            system_prompt=_system_prompt(
                db,
                relaxed=relaxed_mode,
                conversation_id=conversation_id,
                client_context=payload.client_context,
            ),
            quoted=quoted_snapshot,
            conversation_id=conversation_id,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
