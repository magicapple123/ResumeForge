"""助手技能（skills）域的工具实现。"""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from ....models.assistant import AssistantSkill
from ...assistant.assistant_skills import (
    create_skill as create_skill_record,
    list_skills,
    update_skill as update_skill_record,
)
from .._shared import (
    MAX_ASSISTANT_SKILL_FILE_CHARS,
    MAX_ASSISTANT_SKILL_FILES,
    MAX_ASSISTANT_SKILL_TOTAL_CHARS,
    MAX_PROFILE_RESULT_CHARS,
    _trim,
)
from .._types import ToolResult


def _tool_list_skills(db: Session, _arguments: dict) -> ToolResult:
    skills = list_skills(db)
    payload = [
        {
            "id": skill.id,
            "名称": skill.name,
            "适用场景": skill.description,
            "启用": skill.enabled,
            "提示词字数": len(skill.prompt),
            "知识文件": [item.path for item in skill.files],
        }
        for skill in skills
    ]
    return ToolResult(
        text=json.dumps({"技能": payload}, ensure_ascii=False),
        summary=f"查看了 {len(payload)} 个助手技能",
        link="/skills",
    )


def _tool_get_skill(db: Session, arguments: dict) -> ToolResult:
    try:
        skill_id = int(arguments.get("skill_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供技能 id（可以先用 list_skills 查）") from None
    skill = db.get(AssistantSkill, skill_id)
    if skill is None:
        raise ValueError(f"技能 {skill_id} 不存在")
    payload = {
        "id": skill.id,
        "名称": skill.name,
        "适用场景": skill.description,
        "启用": skill.enabled,
        "提示词": skill.prompt,
        "知识文件": [{"path": item.path, "size_bytes": item.size_bytes} for item in skill.files],
    }
    return ToolResult(
        text=_trim(json.dumps(payload, ensure_ascii=False), MAX_PROFILE_RESULT_CHARS),
        summary=f"查看了技能「{skill.name}」",
        link="/skills",
    )


def _skill_files_from_arguments(arguments: dict) -> list[tuple[str, str]] | None:
    """把工具入参里的 ``files`` 规范化成 service 期望的 ``(path, content)`` 列表。

    返回 ``None`` 表示"这次调用没提供知识文件"——让 ``create_skill``/``update_skill``
    保持原有行为（创建时不带文件、更新时**不动**已有文件），避免把"没提"误当成"清空"。
    """
    raw = arguments.get("files")
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise ValueError('files 必须是一个数组，每项形如 {"path": "文件名.md", "content": "正文"}')
    files: list[tuple[str, str]] = []
    total = 0
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, dict):
            raise ValueError(f'files 第 {index} 项格式不对，应为 {{"path": ..., "content": ...}}')
        # path 会被原样拼进系统提示里的一条 bullet（`- {item.path}`），所以换行等控制字符
        # 必须清掉——否则模型能把一个文件名变成"新的一行指令"，凭空造出提示注入面。
        # 它只是一个显示标签，把控制字符与连续空白折成单空格就够，不必过度清洗。
        raw_path = re.sub(r"[\x00-\x1f\x7f]+", " ", str(item.get("path") or ""))
        path = " ".join(raw_path.split())
        content = str(item.get("content") or "")
        if not path:
            raise ValueError(f"files 第 {index} 项缺少 path（知识文件名）")
        if len(path) > 255:
            raise ValueError(f"知识文件名「{path}」过长，请控制在 255 个字符内")
        if not content.strip():
            raise ValueError(f"知识文件「{path}」的正文是空的")
        if len(content) > MAX_ASSISTANT_SKILL_FILE_CHARS:
            raise ValueError(
                f"知识文件「{path}」有 {len(content)} 个字符，超过单文件上限 "
                f"{MAX_ASSISTANT_SKILL_FILE_CHARS}，请拆分或精简后再加"
            )
        total += len(content)
        if total > MAX_ASSISTANT_SKILL_TOTAL_CHARS:
            raise ValueError(
                f"知识文件总长度超过 {MAX_ASSISTANT_SKILL_TOTAL_CHARS} 个字符，请减少文件数量或精简内容"
            )
        files.append((path, content))
    if len(files) > MAX_ASSISTANT_SKILL_FILES:
        raise ValueError(f"一次最多 {MAX_ASSISTANT_SKILL_FILES} 个知识文件，收到 {len(files)} 个")
    return files


def _tool_create_skill(db: Session, arguments: dict) -> ToolResult:
    name = str(arguments.get("name") or "").strip()
    prompt = str(arguments.get("prompt") or "").strip()
    if not name or not prompt:
        raise ValueError("创建技能需要 name 与 prompt")
    files = _skill_files_from_arguments(arguments)
    skill = create_skill_record(
        db,
        name=name,
        description=str(arguments.get("description") or "")[:255],
        prompt=prompt,
        enabled=bool(arguments.get("enabled", True)),
        files=files,
    )
    return ToolResult(
        text=json.dumps(
            {"id": skill.id, "name": skill.name, "知识文件": len(skill.files)},
            ensure_ascii=False,
        ),
        summary=f"创建了助手技能「{skill.name}」",
        link="/skills",
        changed=True,
    )


def _tool_update_skill(db: Session, arguments: dict) -> ToolResult:
    try:
        skill_id = int(arguments.get("skill_id"))
    except (TypeError, ValueError):
        raise ValueError("需要提供技能 id（可以先用 list_skills 查）") from None
    files = _skill_files_from_arguments(arguments)
    fields = {
        key: value
        for key, value in arguments.items()
        if key in {"name", "description", "prompt", "enabled"}
    }
    if not fields and files is None:
        raise ValueError("没有给出要修改的字段")
    skill = update_skill_record(db, skill_id, files=files, **fields)
    if skill is None:
        raise ValueError(f"技能 {skill_id} 不存在")
    updated = sorted(fields)
    if files is not None:
        updated.append("files")
    return ToolResult(
        text=json.dumps({"id": skill.id, "updated": updated}, ensure_ascii=False),
        summary=f"更新了助手技能「{skill.name}」",
        link="/skills",
        changed=True,
    )
