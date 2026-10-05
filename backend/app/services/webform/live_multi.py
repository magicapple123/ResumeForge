"""多标签会话管理（``MultiLiveSession``）。

每个标签页仍是一份普通 ``LiveSession``（从 ``.live`` 单向导入）。
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable

from ..browser.cdp_client import CdpClient
from ._base import WebFormConflict
from .live import LiveSession
from .live_control import LIVE_CONTROL_STATE_SCRIPT
from . import live_targets

logger = logging.getLogger(__name__)


class MultiLiveSession:
    """同时管理网申浏览器里的多个页面目标。

    每个标签页仍使用一份普通 LiveSession，因此焦点、面板、填入和记住动作天然隔离；
    外层只负责发现新页面、清理已关闭页面以及把资料更新广播给所有页面。
    """

    def __init__(
        self,
        initial_client: CdpClient,
        data: dict[str, str],
        catalog: list[dict[str, str]] | None = None,
        *,
        provider: Any = None,
        ai_enabled: bool = False,
        store: Callable[[dict[str, str]], bool] | None = None,
        require_memory_choice: bool = False,
        data_loader: Callable[[], tuple[dict[str, str], list[dict[str, str]]]] | None = None,
        autofill_data_loader: Callable[[], dict[str, str]] | None = None,
        memory_targets: list[dict[str, Any]] | None = None,
        memory_targets_loader: Callable[[], list[dict[str, Any]]] | None = None,
        target_clients_loader: Callable[[], list[tuple[str, CdpClient]]] | None = None,
    ) -> None:
        self._initial_client = initial_client
        self._initial_client_used = False
        self._data = dict(data)
        self._catalog = list(catalog or [])
        self._provider = provider
        self._ai_enabled = ai_enabled
        self._store = store
        self._require_memory_choice = require_memory_choice
        self._data_loader = data_loader
        self._autofill_data_loader = autofill_data_loader
        self._memory_targets = list(memory_targets or [])
        self._memory_targets_loader = memory_targets_loader
        self._target_clients_loader = target_clients_loader
        self._sessions: dict[str, LiveSession] = {}
        self._clients: dict[str, CdpClient] = {}
        self._control_sequences: dict[str, int] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.state: dict[str, Any] = {
            "running": False,
            "field_label": "",
            "value": "",
            "status": "",
            "note": "",
            "source": "",
            "remember_field_key": "",
            "alternatives": [],
            "filled": 0,
            "remember_pending": None,
        }

    def _new_session(self, client: CdpClient) -> LiveSession:
        return LiveSession(
            client,
            self._data,
            self._catalog,
            provider=self._provider,
            ai_enabled=self._ai_enabled,
            store=self._store,
            require_memory_choice=self._require_memory_choice,
            data_loader=self._data_loader,
            autofill_data_loader=self._autofill_data_loader,
            memory_targets=self._memory_targets,
            memory_targets_loader=self._memory_targets_loader,
        )

    @staticmethod
    def _close_client(client: CdpClient) -> None:
        try:
            client.close()
        except Exception:  # noqa: BLE001 - 页面关闭时连接本来就可能已失效
            pass

    def _ensure_targets(self) -> None:
        if self._target_clients_loader is None:
            if not self._sessions:
                session = self._new_session(self._initial_client)
                session.start()
                with self._lock:
                    self._sessions["default"] = session
                    self._clients["default"] = self._initial_client
            return

        try:
            loaded = self._target_clients_loader()
        except Exception as error:  # noqa: BLE001 - 浏览器短暂不可用时保留现有页面
            logger.warning("网申填表：同步多个标签页失败：%s", error)
            return

        seen: set[str] = set()
        for index, item in enumerate(loaded):
            target_id, client = item
            wanted = str(target_id or "").strip()
            if not wanted or wanted in seen:
                self._close_client(client)
                continue
            seen.add(wanted)
            # 悬浮球的状态通过 CDP 回传；只有 sequence 真正变化时才覆盖后端状态，
            # 这样旧版 API 或恢复后的关闭状态不会被页面首次初始化的默认值冲掉。
            try:
                control = client.evaluate(LIVE_CONTROL_STATE_SCRIPT)
                if isinstance(control, str):
                    control = json.loads(control)
                sequence = int(control.get("seq") or 0) if isinstance(control, dict) else 0
                previous_sequence = getattr(self, "_control_sequences", {}).get(wanted)
                if previous_sequence is None:
                    self._control_sequences[wanted] = sequence
                elif sequence != previous_sequence:
                    self._control_sequences[wanted] = sequence
                    live_targets.set_enabled(wanted, bool(control.get("enabled", True)))
            except Exception:  # noqa: BLE001 - 页面刚跳转时可能还没有注入脚本
                pass
            enabled = live_targets.is_enabled(wanted)
            with self._lock:
                existing = self._sessions.get(wanted)
            if existing is not None:
                existing.set_enabled(enabled)
                self._close_client(client)
                continue

            selected_client = client
            if not self._initial_client_used and index == 0:
                selected_client = self._initial_client
                self._initial_client_used = True
                if selected_client is not client:
                    self._close_client(client)
            session = self._new_session(selected_client)
            session.set_enabled(enabled)
            try:
                session.start()
            except Exception as error:  # noqa: BLE001 - 单页失败不阻断其它标签页
                logger.warning("网申填表：标签页 %s 注入监听失败：%s", wanted, error)
                self._close_client(selected_client)
                continue
            with self._lock:
                self._sessions[wanted] = session
                self._clients[wanted] = selected_client

        with self._lock:
            stale = [target_id for target_id in self._sessions if target_id not in seen]
        live_targets.sync(seen)
        for target_id in set(getattr(self, "_control_sequences", {})) - seen:
            self._control_sequences.pop(target_id, None)
        for target_id in stale:
            with self._lock:
                session = self._sessions.pop(target_id, None)
                client = self._clients.pop(target_id, None)
            if session is not None:
                session.stop()
            if client is not None:
                self._close_client(client)

        if not seen and not self._sessions and not self._initial_client_used:
            session = self._new_session(self._initial_client)
            try:
                session.start()
            except Exception as error:  # noqa: BLE001
                logger.warning("网申填表：默认标签页注入监听失败：%s", error)
                self._close_client(self._initial_client)
                return
            self._initial_client_used = True
            with self._lock:
                self._sessions["default"] = session
                self._clients["default"] = self._initial_client

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._ensure_targets()
            self._stop.wait(0.8)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            raise WebFormConflict("点击填表模式已经在运行")
        self._stop.clear()
        self._ensure_targets()
        self._thread = threading.Thread(target=self._loop, name="webform-live-tabs", daemon=True)
        self._thread.start()
        self.state["running"] = True

    def stop(self) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None:
            thread.join(timeout=2.0)
        with self._lock:
            sessions = list(self._sessions.values())
            clients = list(self._clients.values())
            self._sessions.clear()
            self._clients.clear()
        for session in sessions:
            session.stop()
        for client in clients:
            self._close_client(client)
        self.state["running"] = False

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def set_client(self, client: CdpClient) -> None:
        self._initial_client = client
        with self._lock:
            session = next(iter(self._sessions.values()), None)
        if session is not None:
            session.set_client(client)

    def update_data(
        self, data: dict[str, str], catalog: list[dict[str, str]] | None = None
    ) -> None:
        self._data = dict(data)
        if catalog is not None:
            self._catalog = list(catalog)
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            session.update_data(data, catalog)

    def set_data_loader(
        self, loader: Callable[[], tuple[dict[str, str], list[dict[str, str]]]] | None
    ) -> None:
        self._data_loader = loader
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            session.set_data_loader(loader)

    def set_autofill_data_loader(
        self, loader: Callable[[], dict[str, str]] | None
    ) -> None:
        self._autofill_data_loader = loader
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            session.set_autofill_data_loader(loader)

    def set_memory_choice_required(self, required: bool) -> None:
        self._require_memory_choice = bool(required)
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            session.set_memory_choice_required(required)

    def set_memory_targets_loader(
        self, loader: Callable[[], list[dict[str, Any]]] | None
    ) -> None:
        self._memory_targets_loader = loader
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            session.set_memory_targets_loader(loader)

    def update_memory_targets(self, targets: list[dict[str, Any]]) -> None:
        self._memory_targets = list(targets)
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            session.update_memory_targets(targets)

    def _active_state(self) -> dict[str, Any]:
        with self._lock:
            states = [dict(session.state) for session in self._sessions.values()]
        active = next(
            (
                item
                for item in reversed(states)
                if item.get("field_label") or item.get("remember_pending") or item.get("status")
            ),
            states[0] if states else {},
        )
        result = dict(active)
        result["running"] = bool(states)
        result["enabled"] = any(bool(item.get("enabled")) for item in states)
        result["filled"] = sum(int(item.get("filled") or 0) for item in states)
        self.state = result
        return result

    def set_enabled(self, enabled: bool) -> None:
        """同步切换所有网申标签页的智能逐项填表状态，悬浮球仍保留。"""
        next_enabled = bool(enabled)
        with self._lock:
            sessions = list(self._sessions.items())
        for target_id, session in sessions:
            live_targets.set_enabled(target_id, next_enabled)
            session.set_enabled(next_enabled)

    def remember_choice(
        self,
        *,
        target_id: str,
        value: str,
        label: str = "",
        reuse: str = "general",
    ) -> bool:
        with self._lock:
            sessions = list(self._sessions.values())
        for session in sessions:
            if session.state.get("remember_pending") is not None:
                return session.remember_choice(
                    target_id=target_id, value=value, label=label, reuse=reuse
                )
        return False
