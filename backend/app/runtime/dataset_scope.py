"""数据集身份与切换作用域（RF-03，架构文档 §2.1 的契约实现）。

职责：数据集身份的唯一事实来源；切换互斥与任务租约；给长生命周期任务提供
"冻结会话工厂"与"写入前归属校验"。``services/datasets.activate_dataset`` 经由
本模块完成"互斥 → 排空 → 预检 → 换绑 → 发布新身份"。

方向约束（架构 §2）：本模块不 import ``api/``，也不 import ``services/`` 业务模块；
对 ``app.database`` / ``app.dataset_registry`` 的引用放在函数内延迟执行，避免模块
加载顺序耦合。

语义要点：
- **API HTTP 请求也持租约到响应/流结束**；后台 runner 另取长任务租约。激活请求
  自身与纯内存提案读取例外；切换排空 = 租约清零，再对连接池做短兜底轮询。
- **切换持锁期间 ``acquire_lease`` 直接失败**：不存在"排空完成与换绑之间放进新
  任务"的 TOCTOU 窗口——租约的检查与登记都在状态锁内完成，而切换线程先于排空
  拿到切换锁，因此任何登记成功的租约都会被排空等到。
- **失败不发布**：预检失败时指针与引擎保持原值；只有 rebind 成功后才调用
  :func:`publish_switch`，generation 才前进。
- 不落库、不持久化 generation：进程重启 generation 归 1 是安全的，因为重启本身
  已把遗留任务置终态（RF-02）。
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy.orm import sessionmaker

from .dataset_errors import DatasetScopeError

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DatasetIdentity:
    """一次"发布"的数据集身份：引擎按值捕获，切换后旧身份仍指旧库。"""

    dataset_id: str  # "main" 或 16 位 hex（与 dataset_registry.is_valid_dataset_id 一致）
    generation: int  # 进程内单调递增；每次成功切换 +1，从 1 起
    engine: Engine  # 发布时刻的引擎实例（供 frozen_session_factory 捕获）


_state_lock = threading.Lock()
_switch_mutex = threading.Lock()
_identity: DatasetIdentity | None = None
_generation = 0
_leases: list[DatasetLease] = []
_INSTANCE_ID = uuid4().hex
expected_request_scope: ContextVar[str | None] = ContextVar("expected_dataset_scope", default=None)


def request_scope_token(identity: DatasetIdentity | None = None) -> str:
    value = identity or current_identity()
    return f"{_INSTANCE_ID}:{value.dataset_id}:{value.generation}"


def validate_request_scope(identity: DatasetIdentity | None = None) -> None:
    expected = expected_request_scope.get()
    if expected is not None and expected != request_scope_token(identity):
        raise DatasetScopeError("数据集已切换，请保留草稿并刷新页面后重新打开；本次操作未执行")


def _ensure_identity_locked() -> DatasetIdentity:
    """返回当前身份；首次调用或检测到"绕过本模块的直接 rebind"时重新同步。

    调用方必须已持有 ``_state_lock``。引擎漂移同步是防御性的：conftest 与少数旧
    路径会直接 ``database.rebind``，若不同步，归属校验与冻结工厂会拿到过时引擎。
    """
    global _identity, _generation
    from .. import database
    from ..dataset_registry import read_active_dataset_id

    if _identity is not None and _identity.engine is database.engine:
        return _identity
    try:
        dataset_id = read_active_dataset_id()
    except Exception:  # noqa: BLE001 - 指针损坏时退回主数据，与启动回退一致
        dataset_id = "main"
    _generation += 1
    _identity = DatasetIdentity(
        dataset_id=dataset_id, generation=_generation, engine=database.engine
    )
    logger.info("数据集身份已同步 id=%s generation=%s", dataset_id, _generation)
    return _identity


# ---- 读 ----


def current_identity() -> DatasetIdentity:
    with _state_lock:
        return _ensure_identity_locked()


def current_dataset_id() -> str:
    return current_identity().dataset_id


def current_generation() -> int:
    return current_identity().generation


# ---- 切换侧（仅 services/datasets.activate_dataset 调用）----


@contextmanager
def switch_lock() -> Iterator[None]:
    """进程级切换互斥。持锁期间 ``acquire_lease`` 会失败、冻结会话工厂仍可用。"""
    with _switch_mutex:
        yield


def publish_switch(dataset_id: str, engine: Engine) -> DatasetIdentity:
    """在 switch_lock 内、rebind 成功后调用：generation += 1 并发布新身份。

    预检失败不得调用（调用方保证）；违反调用时序视为编程错误。
    """
    global _identity, _generation
    if not _switch_mutex.locked():
        raise RuntimeError("publish_switch 必须在 switch_lock 内调用")
    with _state_lock:
        _generation += 1
        _identity = DatasetIdentity(dataset_id=dataset_id, generation=_generation, engine=engine)
        logger.info("已发布数据集身份 id=%s generation=%s", dataset_id, _generation)
        return _identity


def leases_pending() -> int:
    """当前未释放的逻辑租约数。activate_dataset 用它替换旧的池连接排空判断。"""
    with _state_lock:
        return len(_leases)


def lease_owners() -> list[str]:
    """当前持租约的任务 owner 名单，用于切换失败时给出可读的 409 信息。"""
    with _state_lock:
        return [lease.owner for lease in _leases]


# ---- 任务侧 ----


@dataclass
class DatasetLease:
    """一份绑定发布时刻身份的逻辑租约。支持 ``with`` 语法（退出即 release）。"""

    identity: DatasetIdentity
    owner: str
    _released: bool = field(default=False, repr=False, compare=False)

    def release(self) -> None:
        """归还租约。幂等：重复 release 只有一次生效。"""
        with _state_lock:
            if self._released:
                return
            self._released = True
            with suppress(ValueError):  # 不应发生，防御性兜底
                _leases.remove(self)

    def check(self) -> None:
        """写入前归属校验：身份已切换即抛错。不自动终止任务，由调用方收尾。"""
        if current_identity() is not self.identity:
            raise DatasetScopeError("数据集已切换，本任务不能再写入，请重新发起")

    def __enter__(self) -> DatasetLease:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.release()


def acquire_lease(owner: str) -> DatasetLease:
    """为长生命周期逻辑任务取一份租约（绑定当前 identity）。

    切换持锁期间抛 ``DatasetScopeError("数据集正在切换中，请稍后再启动该任务")``；
    ``owner`` 仅用于诊断日志与 409 信息（如 "resume-generate"、"assistant-stream"）。
    """
    with _state_lock:
        if _switch_mutex.locked():
            raise DatasetScopeError("数据集正在切换中，请稍后再启动该任务")
        lease = DatasetLease(identity=_ensure_identity_locked(), owner=owner)
        _leases.append(lease)
        logger.info("任务取租约 owner=%s dataset=%s", owner, lease.identity.dataset_id)
        return lease


def frozen_session_factory(identity: DatasetIdentity | None = None) -> sessionmaker:
    """捕获数据集身份的 engine，返回绑定它的 sessionmaker（按值捕获 engine）。

    ``identity`` 缺省时捕获当前身份；显式传入**租约身份**时（PR-03：批准执行、
    SSE 保存段），工厂绑定租约发布时刻的引擎——consume 之后到 commit 之间即使
    有切换请求排队，写入仍落在批准/快照时刻的那份数据集上，不重读"当前库"。

    语义：rebind 用 ``SessionLocal.configure`` 原地改绑，"按值捕获 SessionLocal"
    冻不住旧库；必须按值捕获 engine。流式保存段等"切换窗口内已开始的写入"一律
    用它取代裸 ``SessionLocal()``。
    """
    captured = identity if identity is not None else current_identity()
    return sessionmaker(bind=captured.engine, autoflush=False, expire_on_commit=False)


__all__ = [
    "DatasetIdentity",
    "DatasetLease",
    "DatasetScopeError",
    "acquire_lease",
    "current_dataset_id",
    "current_generation",
    "current_identity",
    "frozen_session_factory",
    "lease_owners",
    "leases_pending",
    "publish_switch",
    "switch_lock",
]
