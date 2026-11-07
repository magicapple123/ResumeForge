# SPDX-License-Identifier: Apache-2.0
"""契约层单测共用的测试模型与构造辅助（T27）。

从 ``test_actions_contract.py`` 拆出来：那份文件已贴到 500 行预算，而适配层测试
（tool_adapter / route_adapter）也需要同一批模型与 ``_spec`` / ``_write_spec`` 构造器。
这里只放**无状态**的模型与纯函数；``reset_registry`` 这类带进程副作用的夹具仍留在
测试文件里，避免模块导入时改全局注册表。
"""

from __future__ import annotations

from enum import StrEnum

from app.services.actions import ActionError, ActionOutcome, ActionSpec, HttpRoute, Permission
from pydantic import BaseModel, ConfigDict, Field

# ----------------------------- 测试用模型 -----------------------------


class Color(StrEnum):
    RED = "red"
    BLUE = "blue"


class Inner(BaseModel):
    model_config = ConfigDict(extra="forbid")
    color: Color = Field(description="颜色")
    score: int = Field(ge=1, le=5, description="分数")


class Outer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(description="标题")
    inner: Inner
    inners: list[Inner] = Field(default_factory=list)
    note: str | None = Field(default=None, description="备注")


class Mini(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str


class DemoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keyword: str = Field(default="", description="关键词")
    limit: int = 20


class ItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: int
    name: str = Field(description="名称")


class EchoOut(BaseModel):
    keyword: str
    limit: int


class ItemOut(BaseModel):
    item_id: int
    name: str


class LooseInput(BaseModel):
    x: int = 0


class OptionalIdInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_id: int = 0
    keyword: str = ""


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    child: Node | None = None


# ----------------------------- 辅助 -----------------------------


def _echo_run(session, payload):
    return ActionOutcome(summary="摘要", text="正文", link="/demo", changed=True)


def _raise_not_found(session, payload):
    raise ActionError("not_found", "对象不存在")


def _record(store):
    def run(session, payload):
        store.append(payload)
        return ActionOutcome(data=payload.model_dump())

    return run


async def _async_run(session, payload):
    return ActionOutcome()


def _spec(**overrides) -> ActionSpec:
    options: dict = {
        "name": "demo_action",
        "description": "演示动作",
        "input_model": DemoInput,
        "permission": Permission.READ_ONLY,
        "run": _echo_run,
    }
    options.update(overrides)
    return ActionSpec(**options)


def _write_spec(**overrides) -> ActionSpec:
    options = {
        "name": "demo_write",
        "input_model": ItemInput,
        "permission": Permission.REVERSIBLE_WRITE,
        "preview": lambda session, payload: "预览",
        "http": HttpRoute("POST", "/api/test/items/{item_id}", ItemOut),
    }
    options.update(overrides)
    return _spec(**options)


def _has_key(node, key: str) -> bool:
    if isinstance(node, dict):
        return key in node or any(_has_key(value, key) for value in node.values())
    if isinstance(node, list):
        return any(_has_key(item, key) for item in node)
    return False


def _has_title_annotation(node) -> bool:
    """只认 JSON schema 的 title 注解（值是字符串）；属性名叫 title 是合法的。"""
    if isinstance(node, dict):
        if any(key == "title" and isinstance(value, str) for key, value in node.items()):
            return True
        return any(_has_title_annotation(value) for value in node.values())
    if isinstance(node, list):
        return any(_has_title_annotation(item) for item in node)
    return False
