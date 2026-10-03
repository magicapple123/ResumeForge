"""「记住这条」的 LiveSession 混入（``LiveRememberMixin``）。

方法体逐字原样搬运；经 ``self.*`` 访问宿主 LiveSession 的成员。
"""
from __future__ import annotations

import logging
from typing import Any

from .engine import Control
from .extra_profile import custom_key
from .fields import FIELD_LABELS
from .repeated_fields import field_key_for_block, field_label_for_key, split_repeated_key
from .service import recognize_field
from .live_scripts import _HIDE_REMEMBER_SCRIPT

logger = logging.getLogger(__name__)


class LiveRememberMixin:
    # ===== 用户点了「记住这条」 =====

    def _on_remember(self, remember: dict[str, Any]) -> None:
        """把当前这个框的值记进「网申资料」，下次遇到同类的框就能自动填。

        **不写页面**——这是这条链与「填入」的全部差别：那边是"把这个值填进去"，这边是
        "记下来以后用"。所以它不走 ``apply_fill``，也不碰控件。
        """
        # 与「填入」一样，先清掉标记，否则下一轮会重复记一遍。
        self._client.evaluate(_HIDE_REMEMBER_SCRIPT)
        value = str(remember.get("value") or "").strip()
        if not value:
            return

        # 标签优先用**控件自己那句话**（``remember.control``），而不是面板上显示的字段名：
        # 认不出的框没有字段名，而认得出的框正是要拿它的字段名去算 key。
        raw = remember.get("control")
        control = self._build_control(raw) if isinstance(raw, dict) else self._current_control()
        label = str(remember.get("label") or "")
        key, shown = self._remember_key(control, label)
        if not key:
            self._publish_remember("没认出来这个框要记成什么，记不了")
            return
        if self._store is None:
            # 单测直接起 LiveSession 时没有落库回调。**如实说**，不假装成功——否则用户以为
            # 记下了，下次填表却什么都没有。
            self._publish_remember("这个版本记不了（没有接上本地资料）")
            return
        target_id = str(remember.get("target_id") or "").strip()
        if target_id:
            entry = {
                "target_id": target_id,
                "key": key,
                "label": label or shown,
                "value": value,
            }
            self._store_remember_entry(entry, pending=False)
            return
        if self._require_memory_choice:
            control_label = ""
            if control is not None:
                control_label = (control.label or control.placeholder or control.nearby_text or control.name).strip()
            self._publish_remember_pending(
                {
                    "field_key": key,
                    "field_label": shown,
                    "value": value,
                    "control_label": control_label,
                    "source": str(self.state.get("source", "rule") or "rule"),
                }
            )
            return
        entry = {"key": key, "label": shown, "value": value}
        try:
            ok = bool(self._store(entry))
        except Exception as error:  # noqa: BLE001 - 落库失败不该弄死轮询线程
            logger.warning("网申填表：「记住这条」写不进去：%s", error)
            ok = False
        destination = str(entry.get("destination") or "").strip()
        note = (
            f"已保存到「{destination}」，下次遇到就能使用"
            if ok and destination
            else f"已记住「{shown}」，下次遇到就自动填"
            if ok
            else f"「{shown}」没能记住，稍后再试"
        )
        self._publish_remember(note)

    def _store_remember_entry(self, entry: dict[str, str], *, pending: bool) -> bool:
        """落库一条内联编辑结果，并把位置提示保留在面板里。"""
        if self._store is None:
            self._publish_remember("这个版本记不了（没有接上本地资料）")
            return False
        try:
            ok = bool(self._store(entry))
        except Exception as error:  # noqa: BLE001 - 落库失败不该弄死轮询线程
            logger.warning("网申填表：「记住这条」写不进去：%s", error)
            ok = False
        if pending:
            return ok
        destination = str(entry.get("destination") or "").strip()
        note = (
            f"已保存到「{destination}」，下次遇到就能使用"
            if ok and destination
            else f"已记住「{entry.get('label') or '这条资料'}」，下次遇到就自动填"
            if ok
            else f"「{entry.get('label') or '这条资料'}」没能记住，稍后再试"
        )
        self._publish_remember(note)
        if ok:
            self._refresh_data()
        return ok

    def _remember_key(self, control: Control | None, label: str) -> tuple[str, str]:
        """这个框该记成哪个 key，以及界面上显示的名字。

        - **认得出的**（目录里 37 个之一）：直接用它的 key。这最重要——只有走目录 key 才
          有 ``FIELD_SYNONYMS`` 那五到十个同义词撑着，下次才认得出别的说法。
        - **认不出的**：用控件自述文字规范成 ``CUSTOM_*``。它下次**不会**自动匹配（只有
          标签一个信号，匹配错了会把值悄悄写进别的框），但存得下、看得见、能手填。
        """
        if control is not None and (known := recognize_field(control)):
            shown_key = field_key_for_block(known, control.block_family, control.block_index)
            return known, field_label_for_key(
                shown_key, FIELD_LABELS.get(split_repeated_key(shown_key)[0], shown_key)
            )
        # 控件的话优先于面板上显示的名称：认不出的框 `label` 可能是空的。
        text = ""
        if control is not None:
            text = (control.label or control.nearby_text or control.name or "").strip()
        text = text or label
        custom = custom_key(text)
        if not custom:
            return "", ""
        return custom, (text.strip() or label)

    def _publish_remember(self, note: str) -> None:
        """回一句结果。**保持 ``status``/``value``/``field_label`` 不变**：面板上正在显示的
        那个建议还有效，用户可能看完这句再点「填入」。``_publish`` 会用空值补全没给的键，
        所以这里必须把当前状态**取回来一起传**——否则记一下就把建议弄没了。
        """
        self._publish(
            {
                "status": self.state.get("status", ""),
                "field_label": self.state.get("field_label", ""),
                "value": self.state.get("value", ""),
                "remember_field_key": self.state.get("remember_field_key", ""),
                "note": note,
                "source": self.state.get("source", ""),
                "alternatives": list(self.state.get("alternatives", [])),
                "remember_pending": None,
            }
        )

    def _publish_remember_pending(
        self, pending: dict[str, str], note: str = "请选择要更新的资料，或新增一条网申自定义字段"
    ) -> None:
        """不覆盖建议，只把“等待选目标”交给 ResumeForge 界面。"""
        self._publish(
            {
                "status": self.state.get("status", ""),
                "field_label": self.state.get("field_label", ""),
                "value": self.state.get("value", ""),
                "remember_field_key": self.state.get("remember_field_key", ""),
                "note": note,
                "source": self.state.get("source", ""),
                "alternatives": list(self.state.get("alternatives", [])),
                "remember_pending": pending,
            }
        )

    def remember_choice(
        self,
        *,
        target_id: str,
        value: str,
        label: str = "",
        reuse: str = "general",
    ) -> bool:
        """完成界面选择后的落库，一次性清掉 pending。"""
        pending = self.state.get("remember_pending")
        if not isinstance(pending, dict) or self._store is None:
            return False
        cleaned = str(value or "").strip() or str(pending.get("value") or "").strip()
        if not cleaned:
            return False
        entry = {
            "target_id": str(target_id or ""),
            "key": str(pending.get("field_key") or ""),
            "value": cleaned,
            "label": str(label or pending.get("field_label") or ""),
            "reuse": str(reuse or "general"),
        }
        try:
            ok = bool(self._store(entry))
        except Exception as error:  # noqa: BLE001 - 落库失败不应影响会话
            logger.warning("网申填表：选择后写入失败：%s", error)
            ok = False
        if ok:
            destination = str(entry.get("destination") or "").strip()
            self._publish_remember(
                (
                    f"已保存到「{destination}」，下次遇到就能使用"
                    if destination
                    else f"已更新「{label or pending.get('field_label') or '网申资料'}」，下次遇到相同类型的框可以继续使用"
                )
            )
        else:
            self._publish_remember_pending(pending, "这条资料没能保存，请检查目标后重试")
        return ok

