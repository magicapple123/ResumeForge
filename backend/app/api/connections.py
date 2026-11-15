# SPDX-License-Identifier: Apache-2.0
"""「外部连接」页的聚合读接口 + C 组系统来源的写接口（T11 / T12）。

**读侧只此一处**：改造前「这台机器上有哪些外部依赖、各自有没有配、存在哪」没有任何
一个接口能回答（Q16）。

**写侧刻意只做 C 组**：

- A/B 组的密钥写入仍然委托给各域既有端点（联网搜索 `PUT /api/settings/search`、
  大模型 `PUT /api/settings/llm`、语音 `/api/settings/asr/profiles*`、会话密钥
  `/api/settings/llm/session-key`）。五套存储形态各有写语义，在这里再实现一份必然会
  与域端点漂移——那正是 Q16 的成因。
- C 组四项（更新源 / 字体源 / RAG 资产源 / 浏览器端口）**不是密钥**，此前根本没有
  写入口，所以由本模块提供 ``PUT`` / ``DELETE``（``DELETE`` = 恢复默认）。

**不加 loopback 守卫**，与紧邻的 `PUT /api/settings/search`、`PUT /api/settings/asr`
一致：A/B 组的写入本来就落在那些端点上，只把 C 组锁起来不会提高安全边界，只会让
"同一页里一半能改、一半 403"。响应里也没有任何真实密钥（只有三态 + 掩码）。

路由前缀 ``/api/connections``；装配时在 `application.py` 里 ``include_router`` 即可
（前缀已经写在 router 上，不要重复加）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.connections import ConnectionsOut, SystemSourceWriteIn
from ..services import system_sources
from ..services.connections_view import build_connections

router = APIRouter(prefix="/api/connections", tags=["connections"])
logger = logging.getLogger(__name__)


def _out(db: Session | None) -> ConnectionsOut:
    return ConnectionsOut.model_validate(build_connections(db))


@router.get("", response_model=ConnectionsOut)
def read_connections(db: Session = Depends(get_db)) -> ConnectionsOut:
    """三组外部连接（A 组 AI 服务 / B 组搜索来源 / C 组系统来源）+ 全局存储说明。

    只读：返回里**没有任何真实密钥**，只有三态、掩码（语义检索连掩码都没有）与存储方式。
    """
    return _out(db)


@router.put("/system/{item_id}", response_model=ConnectionsOut)
def write_system_source(
    item_id: str,
    payload: SystemSourceWriteIn,
    db: Session = Depends(get_db),
) -> ConnectionsOut:
    """改一项系统来源（更新源 / 字体源 / RAG 资产源 / 浏览器端口），返回刷新后的整页快照。

    返回整页而不是单项：前端"改完刷新状态"最省事，也不会出现"列表里一条新、一条旧"。
    """
    if not system_sources.has_source(item_id):
        raise HTTPException(status_code=404, detail=f"没有这一项外部连接：{item_id}")
    try:
        system_sources.set_value(item_id, payload.value)
    except system_sources.SystemSourceError as exc:
        # 400 + 可直接展示的中文原因（含"怎么改"），不要翻成 500。
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:  # 全局设置文件不可写（只读盘 / 权限）
        logger.warning("系统来源 %s 写入失败：%s", item_id, exc)
        raise HTTPException(
            status_code=503, detail="全局设置文件无法写入（数据目录只读或权限不足）"
        ) from exc
    return _out(db)


@router.delete("/system/{item_id}", response_model=ConnectionsOut)
def reset_system_source(item_id: str, db: Session = Depends(get_db)) -> ConnectionsOut:
    """恢复某一项的出厂默认（= 从全局设置里删掉覆盖值）。"""
    if not system_sources.has_source(item_id):
        raise HTTPException(status_code=404, detail=f"没有这一项外部连接：{item_id}")
    try:
        system_sources.reset_value(item_id)
    except OSError as exc:
        logger.warning("系统来源 %s 恢复默认失败：%s", item_id, exc)
        raise HTTPException(
            status_code=503, detail="全局设置文件无法写入（数据目录只读或权限不足）"
        ) from exc
    return _out(db)


__all__ = ["router"]
