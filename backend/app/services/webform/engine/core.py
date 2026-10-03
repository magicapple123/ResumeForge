"""FormEngine：表单快照 / 读取 / 匹配 / 应用 / 校验的编排。"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import replace
from typing import Any

from ...browser.cdp_client import CdpClient
from ...browser.interaction import click_selector
from ..custom_select import select_combobox_option
from ..fields import (
    AUTOCOMPLETE_DENY,
    AUTOCOMPLETE_FIELDS,
    CLAIM_LABELS,
    CONSENT_HINTS,
    FIELD_BLOCK_HINTS,
    FIELD_DENYLIST,
    FIELD_EXCLUDE_HINTS,
    FIELD_PREFERRED_TYPES,
    FIELD_SYNONYMS,
)
from ..matching import (
    DateResolution,
    SelectOption,
    SelectResolution,
    date_component,
    format_date,
    is_date_hint,
    is_placeholder,
    meaningful_options,
    resolve_choice,
    resolve_select_option,
)
from ..repeated_fields import (
    compatible_block,
    family_for_field,
    field_key_for_block,
    parse_block_label,
    split_repeated_key,
)
from .evidence import _longest_synonym, _states_its_field, evidence_key
from .model import (
    CONTROL_TYPES,
    ApplyOutcome,
    Control,
    FieldMapping,
    MatchResult,
    SkipNote,
    _DEPENDENT_SELECT_POLL_SECONDS,
    _DEPENDENT_SELECT_WAIT_SECONDS,
)
from .scripts import CONTROLS_SCRIPT
from .writers import (
    _PROTOTYPE_BY_TYPE,
    _read_back_script,
    _read_select_options_script,
    _select_option_script,
    _set_richtext_script,
    _set_value_script,
)

logger = logging.getLogger(__name__)

class FormEngine:
    """通用表单理解与填写。"""

    def snapshot_controls(self, controls: list[dict[str, Any]]) -> list[Control]:
        """把页面快照里的原始控件描述转成 ``Control``（纯函数，便于离线测试）。"""
        result: list[Control] = []
        for raw in controls:
            if not isinstance(raw, dict):
                continue
            control_type = str(raw.get("type", "unknown"))
            if control_type not in CONTROL_TYPES:
                control_type = "unknown"
            try:
                index = int(raw.get("index", len(result)))
            except (TypeError, ValueError):
                index = len(result)
            result.append(
                Control(
                    index=index,
                    type=control_type,
                    name=str(raw.get("name", "")),
                    label=str(raw.get("label", "")),
                    placeholder=str(raw.get("placeholder", "")),
                    aria_label=str(raw.get("aria_label", "")),
                    aria_labelledby=str(raw.get("aria_labelledby", "")),
                    aria_describedby=str(raw.get("aria_describedby", "")),
                    legend=str(raw.get("legend", "")),
                    title=str(raw.get("title", "")),
                    element_id=str(raw.get("id", "")),
                    autocomplete=str(raw.get("autocomplete", "")).strip().casefold(),
                    required=bool(raw.get("required", False)),
                    readonly=bool(raw.get("readonly", False)),
                    has_popup=bool(raw.get("has_popup", False)),
                    linked_select=bool(raw.get("linked_select", False)),
                    selector=str(raw.get("selector", "")),
                    options=self._parse_options(raw.get("options")),
                    nearby_text=str(raw.get("nearby_text", "")),
                    block_label=str(raw.get("block_label", "")),
                    block_family=str(raw.get("block_family", "")),
                    block_index=self._parse_block_index(raw.get("block_index")),
                    date_group=str(raw.get("date_group", "")),
                    date_part_name=str(raw.get("date_part_name", "")),
                    date_part_label=str(raw.get("date_part_label", "")),
                    date_order=self._parse_optional_int(raw.get("date_order")),
                    group=str(raw.get("group", "")),
                    value=str(raw.get("value", "")),
                    display=str(raw.get("display", "")),
                    checked=bool(raw.get("checked", False)),
                )
            )
        return result

    @staticmethod
    def _parse_optional_int(raw: Any) -> int | None:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    @classmethod
    def _parse_block_index(cls, raw: Any) -> int | None:
        parsed = cls._parse_optional_int(raw)
        if parsed is not None:
            return parsed
        block = parse_block_label(str(raw or ""))
        return block.index if block is not None else None

    @staticmethod
    def _parse_options(raw: Any) -> tuple[SelectOption, ...]:
        """兼容两种形状：新快照给 ``[{v,t,d}]``，旧快照/旧测试给 ``["北京", "上海"]``。"""
        if not isinstance(raw, list):
            return ()
        options: list[SelectOption] = []
        for item in raw:
            if isinstance(item, dict):
                options.append(
                    SelectOption(
                        value=str(item.get("v", "")),
                        text=str(item.get("t", "")),
                        disabled=bool(item.get("d", False)),
                    )
                )
            elif isinstance(item, str):
                # 旧格式只有文本：value 也当文本用，这是当时唯一能做的假设。
                options.append(SelectOption(value=item, text=item))
        return tuple(options)

    def read_controls(self, client: CdpClient, *, timeout: float | None = None) -> list[Control]:
        """在真实页面上读取控件清单。"""
        payload = client.evaluate(CONTROLS_SCRIPT, timeout=timeout)
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                logger.warning("表单控件快照无法解析")
                return []
        if not isinstance(payload, dict):
            return []
        controls = payload.get("controls")
        if not isinstance(controls, list):
            return []
        return self._link_split_date_controls(self.snapshot_controls(controls))

    def match_fields(self, controls: list[Control], data: dict[str, Any]) -> MatchResult:
        """把资料字段启发式映射到控件上。

        三条硬规则：一个控件只被分配一次；命中负向词/黑名单的控件永不参与；``file``
        控件不产生映射（见模块 docstring 缺陷 5）。
        """
        mappings: list[FieldMapping] = []
        skipped: list[SkipNote] = []
        used: set[int] = set()
        controls = self._link_split_date_controls(controls)

        for control in controls:
            reason = self.skip_reason(control)
            if reason is not None:
                skipped.append(SkipNote(control=control, reason=reason))
                used.add(control.index)

        # **按证据强度全局择优分配，而不是按字段顺序各抢各的。**
        #
        # 2026-09-26 在美团招聘简历页实测到这条的必要性：字段表里 ``school`` 排在
        # ``research_direction`` 前面，于是它靠**旁文**（弱证据）抢走了「请输入研究方向」
        # 那个控件——而后者在上面是**自述强匹配**，轮到自己时控件已被占用，只能退而求其次，
        # 结果学校名填进了研究方向框。先让每个字段把候选都报上来、按强度排序后再分配，
        # 强证据自然赢过弱证据，与字段在表里的位置无关。
        dynamic_slots = {
            (base, index)
            for raw_field in data
            for base, index in [split_repeated_key(raw_field)]
            if index is not None
        }
        field_order = {field_name: order for order, field_name in enumerate(FIELD_SYNONYMS)}
        candidates: list[tuple[tuple[int, int, int], int, int, str, str, int | None, Control]] = []
        for raw_field, raw_value in data.items():
            base_field, explicit_index = split_repeated_key(str(raw_field))
            if base_field not in FIELD_SYNONYMS:
                continue
            family = family_for_field(base_field)
            target_index = explicit_index if explicit_index is not None else (1 if family else None)
            synonyms = FIELD_SYNONYMS[base_field]
            for key, control in self._rank_controls(
                controls,
                synonyms,
                FIELD_PREFERRED_TYPES.get(base_field),
                base_field,
                target_index=target_index,
            ):
                # 旧版无序号控件沿用静态值；明确的重复区块优先取同一条动态记录。
                if (
                    explicit_index is None
                    and family
                    and control.block_family
                    and (base_field, target_index) in dynamic_slots
                ):
                    continue
                candidates.append(
                    (
                        key,
                        field_order.get(base_field, len(field_order)),
                        control.index,
                        str(raw_field),
                        base_field,
                        target_index,
                        control,
                    )
                )
        # 证据强度优先；同强度时按字段表顺序（``*_start`` 排在 ``*_end`` 前，靠它区分
        # 区块里签名完全相同的两个日期框）；再同则按控件顺序（DOM 里靠前的先拿）。
        candidates.sort(key=lambda item: (-item[0][0], -item[0][1], -item[0][2], item[1], item[2]))

        assigned: set[tuple[str, int | None, str | None]] = set()
        date_assigned: set[tuple[str, str]] = set()
        for _key, _order, control_index, raw_field, base_field, target_index, control in candidates:
            date_part = control.date_part()
            if date_part:
                # 一个资料日期可以对应页面上的「年 / 月 / 日」多个下拉，
                # 每个组件都要占一个独立槽位，不能被同一字段的第一项吞掉。
                slot = (base_field, target_index, date_part)
            elif family_for_field(base_field):
                slot = (base_field, target_index, None)
            else:
                slot = (raw_field, None, None)
            if control_index in used or slot in assigned:
                continue
            if control.date_group and (control.date_group, base_field) in date_assigned:
                continue
            mapping_field = (
                base_field
                if control.date_group and base_field in FIELD_SYNONYMS
                else field_key_for_block(base_field, control.block_family, control.block_index)
                if control.block_family and control.block_index
                else raw_field
            )
            mapping = self._build_mapping(
                controls, control, mapping_field, str(data[raw_field]).strip(), False
            )
            if mapping is None:
                continue
            # 单选/复选要把同组兄弟一起占掉，否则下一个字段会挑到同一组的另一个选项。
            used |= self._claimed_indexes(controls, mapping.control)
            assigned.add(slot)
            mappings.append(mapping)
            if control.date_group:
                date_assigned.add((control.date_group, base_field))
                raw_value = str(data[raw_field]).strip()
                for companion in controls:
                    if companion.date_group != control.date_group or companion.index == control.index:
                        continue
                    companion_mapping = self._build_mapping(
                        controls, companion, control.date_part_label, raw_value, False
                    )
                    if companion_mapping is None:
                        continue
                    used.add(companion.index)
                    companion_slot = (base_field, target_index, companion.date_part())
                    assigned.add(companion_slot)
                    mappings.append(companion_mapping)

        # 低置信在分配完成之后单独算：判据是该字段自己的冠亚军差距（见 ``_best_control``），
        # 而全局择优决定了它最终拿到的是不是那个冠军。
        final: list[FieldMapping] = []
        for mapping in mappings:
            final.append(
                replace(
                    mapping,
                    low_confidence=self._is_low_confidence(controls, mapping.field, mapping.control),
                )
            )

        unmatched = [control for control in controls if control.index not in used]
        return MatchResult(mappings=final, unmatched=unmatched, skipped=skipped)

    @staticmethod
    def _link_split_date_controls(controls: list[Control]) -> list[Control]:
        """Link adjacent year/month/day controls only when shared text identifies a date field."""
        linked: list[Control] = []
        index = 0
        while index < len(controls):
            first = controls[index]
            if first.date_part() is None:
                linked.append(first)
                index += 1
                continue

            group: list[Control] = []
            parts: set[str] = set()
            cursor = index
            while cursor < len(controls) and len(group) < 3:
                candidate = controls[cursor]
                part = candidate.date_part()
                if part is None or part in parts:
                    break
                group.append(candidate)
                parts.add(part)
                cursor += 1
            if len(group) < 2:
                linked.append(first)
                index += 1
                continue

            shared_text = " ".join(
                item.block_label + " " + item.nearby_text + " " + item.aria_describedby
                for item in group
            ).casefold()
            parent_fields = (
                "birth_date",
                "birth_year",
                "education_start",
                "education_end",
                "work_start",
                "work_end",
            )
            hits = [
                (field_name, synonym)
                for field_name in parent_fields
                for synonym in FIELD_SYNONYMS[field_name]
                if synonym.casefold() in shared_text
            ]
            if not hits or len({field_name for field_name, _synonym in hits}) != 1:
                linked.extend(group)
                index = cursor
                continue

            field_name, synonym = max(hits, key=lambda item: len(item[1]))
            group_id = f"date:{group[0].index}:{field_name}"
            linked.extend(
                replace(
                    item,
                    date_group=group_id,
                    date_part_label=field_name,
                )
                for item in group
            )
            index = cursor
        return linked

    @staticmethod
    def _group_key(control: Control) -> str:
        """单选/复选的分组键；空串表示分不出组（那就只能当它自成一组）。"""
        return control.group or control.name

    @classmethod
    def _claimed_indexes(cls, controls: list[Control], control: Control) -> set[int]:
        """这条映射占掉了哪些控件。

        单选/复选要把**同组兄弟一起占掉**：只占被选中的那一个的话，同组的"女"会留在
        「没认出来」里当噪声，更糟的是可能被后面某个字段认领去。
        """
        if control.type not in ("radio", "checkbox"):
            return {control.index}
        key = cls._group_key(control)
        if not key:
            return {control.index}
        return {
            item.index
            for item in controls
            if item.type == control.type and cls._group_key(item) == key
        }

    def _build_mapping(
        self,
        controls: list[Control],
        control: Control,
        field_name: str,
        value: str,
        low_confidence: bool,
    ) -> FieldMapping | None:
        """按控件类型把值整理成"真正要写进去的东西"；整理不出来就放弃这一条。"""
        if control.date_group:
            component_value = date_component(value, control.date_part() or "")
            if component_value.status != "matched":
                return None
            if control.has_popup and not control.options:
                return FieldMapping(
                    control=control,
                    field=field_name,
                    value=component_value.value,
                    low_confidence=low_confidence,
                )
            resolution = resolve_select_option(control.options, component_value.value)
            if resolution.status != "matched":
                return None
            return FieldMapping(
                control=control,
                field=field_name,
                value=component_value.value,
                select=resolution,
                low_confidence=low_confidence,
            )

        if control.type == "select":
            component = control.date_part()
            component_value = date_component(value, component) if component else None
            resolution = (
                resolve_select_option(control.options, component_value.value)
                if component_value is not None and component_value.status == "matched"
                else resolve_select_option(control.options, value)
            )
            if component_value is not None and component_value.status != "matched":
                return None
            if (
                resolution.status == "no_option"
                and control.linked_select
                and not meaningful_options(control.options)
            ):
                # 联动原生下拉可能在首次快照时还只有占位项；先保留这条映射，
                # 真正填充时会在父级选中后重新读取当前 DOM 的 options。
                return FieldMapping(
                    control=control,
                    field=field_name,
                    value=value,
                    select=resolution,
                    low_confidence=low_confidence,
                )
            if resolution.status != "matched":
                return None
            return FieldMapping(
                control=control,
                field=field_name,
                value=value,
                select=resolution,
                low_confidence=low_confidence,
            )

        if control.has_popup and control.type != "select":
            return FieldMapping(
                control=control,
                field=field_name,
                value=value,
                low_confidence=low_confidence,
            )

        if control.type in ("radio", "checkbox"):
            # 单选/复选的"选项"是同一 name 下的兄弟控件集合，必须**整组**参与匹配，
            # 才能知道"性别=男"该点哪一个。文本优先用各自的 label，没有就退回它的 value。
            key = self._group_key(control)
            group = [
                item
                for item in controls
                if item.type == control.type and self._group_key(item) == key
            ]
            options = tuple(
                SelectOption(value=item.value, text=item.label or item.value) for item in group
            )
            resolution = resolve_choice(options, value)
            if resolution.status != "matched" or resolution.option is None:
                return None
            chosen = next(
                (item for item in group if item.value == resolution.option.value), None
            )
            if chosen is None:
                return None
            return FieldMapping(
                control=chosen,
                field=field_name,
                value=value,
                select=resolution,
                low_confidence=low_confidence,
            )

        if control.type in ("date", "month"):
            resolution = format_date(value, kind=control.type)
            if resolution.status != "matched":
                return None
            return FieldMapping(
                control=control,
                field=field_name,
                value=value,
                date=resolution,
                low_confidence=low_confidence or resolution.assumed_day,
            )

        if control.type == "text":
            date_hint = " ".join(
                (
                    field_name,
                    control.signature(),
                    control.value,
                    control.display,
                )
            )
            if is_date_hint(date_hint):
                resolution = format_date(value, kind="text", hint=date_hint)
                if resolution.status == "matched":
                    return FieldMapping(
                        control=control,
                        field=field_name,
                        value=value,
                        date=resolution,
                        low_confidence=low_confidence,
                    )

        return FieldMapping(
            control=control, field=field_name, value=value, low_confidence=low_confidence
        )

    @staticmethod
    def skip_reason(control: Control) -> str | None:
        """这个控件为什么永不自动填；``None`` 表示可以参与匹配。"""
        signature = control.signature()
        security_text = control.security_text()
        if control.type == "file":
            return "简历附件需要你自己选择文件上传"
        # 只读框 / 点开是弹层的框：**看起来像文本框，其实值只能由点选产生**。
        #
        # 直接往里写 `.value` 是最糟的一种"成功"：框里出现了一行字，看着像填上了，而组件
        # 内部状态一点没变——表单交上去还是空的。级联选择器（省/市/区）就是典型：它把
        # 内部状态**显示**在只读输入框里，用户点开三级菜单选完才真的产生值。
        #
        # 与"下拉里只有占位项"那条是同一类处置：**宁可如实说"要你自己点"，也不假装填上了**。
        if control.type != "select" and control.readonly and not control.has_popup:
            return "这是个只能点选的选择控件（值不能直接写进去），需要你在页面上自己点选"
        # 站点自己声明的"别自动填"：密码 / 验证码 / 银行卡。这比我们从标签猜更可信——
        # 是表单在明说这是一类不该由程序填的控件。
        if control.autocomplete in AUTOCOMPLETE_DENY:
            kind = AUTOCOMPLETE_DENY[control.autocomplete]
            return f"站点标注为{kind}（autocomplete={control.autocomplete}），永不自动填写"
        for word in FIELD_DENYLIST:
            if word in security_text:
                return f"涉及“{word}”，永不自动填写"
        # 同意类勾选：代勾等于替你做出法律意义上的同意，只能你自己点。
        if control.type in ("checkbox", "radio"):
            for word in CONSENT_HINTS:
                if word in signature:
                    return f"涉及“{word}”的确认项，需要你本人勾选"
            # 声明类勾选：「无实习经历」勾上是在断言"我没有这段经历"、「至今」是在断言
            # "这段经历还在进行"。两者都是**替用户陈述事实**，而不只是填一个值——
            # 与"不替用户表达意愿"是同一条纪律。
            label = control.label.strip()
            if label.startswith("无") and ("经历" in label or "信息" in label):
                return f"“{label}”是声明类勾选，需要你自己判断"
            if label in CLAIM_LABELS:
                return f"“{label}”是声明类勾选，需要你自己判断"
        return None

    @staticmethod
    def _hinted_out(control: Control, field_name: str) -> bool:
        """命中该字段的负向词（如"紧急联系人姓名"之于"姓名"）。"""
        signature = control.signature()
        return any(word in signature for word in FIELD_EXCLUDE_HINTS.get(field_name, ()))

    @classmethod
    def _rank_controls(
        cls,
        controls: list[Control],
        synonyms: tuple[str, ...],
        preferred_types: tuple[str, ...] | None,
        field_name: str,
        *,
        target_index: int | None = None,
    ) -> list[tuple[tuple[int, int, int], Control]]:
        """把控件按"它有多像这个字段"排序（强到弱）。

        **控件自己说的比周围文字更可信**：``own_text``（label / placeholder / name）里
        命中的，一律排在"只在 ``nearby_text`` 里命中"的前面。2026-09-26 在腾讯校招简历页
        实测到这条的必要性——那三个框是紧挨着的「导师 / 实验室 / 研究方向」，累积出来的
        上下文把三个标签都装进了彼此的签名，于是"研究方向"被填进了「实验室」。
        分开之后，"请输入研究方向"（自己说的）稳稳赢过"请输入实验室"（只是旁边提到）。

        排序键 = ``(是否自述命中, 得分+类型偏好, -控件序号)``，返回时已从强到弱。
        """
        block_hint = FIELD_BLOCK_HINTS.get(field_name)
        scored: list[tuple[tuple[int, int, int], Control]] = []
        for control in controls:
            if cls._hinted_out(control, field_name):
                continue
            if not compatible_block(
                field_name,
                control.block_family,
                control.block_index,
                target_index=target_index,
            ):
                continue
            key = evidence_key(control, field_name, synonyms)
            if key is None:
                continue
            # 区块限定：多段经历里的短词（"职位"、"描述"、"起止时间"）必须靠它才不会
            # 在别的区块上误命中——见 FIELD_BLOCK_HINTS 的说明。
            # 没有区块标题的旧页面仍可用控件自己的 label / placeholder / name 识别明确字段；
            # 只有旁文这一档的弱证据才继续要求区块标题。这样“是否境外教育”等明确字段
            # 不会因为页面没有输出“教育经历-1”标题而被无故跳过。
            choice_field = any("是否" in synonym for synonym in synonyms)
            choice_without_block = choice_field and control.type in ("select", "radio", "checkbox")
            if (
                block_hint
                and block_hint not in control.signature()
                and not control.block_family
                and key[0] < 1
                and not choice_without_block
            ):
                continue
            if block_hint and control.block_family and not compatible_block(
                field_name, control.block_family, control.block_index, target_index=target_index
            ):
                continue
            expected_date_order = 1 if field_name.endswith("_start") else 2 if field_name.endswith("_end") else None
            if expected_date_order and control.date_order and control.date_order != expected_date_order:
                continue
            bonus = 5 if preferred_types and control.type in preferred_types else 0
            scored.append(((key[0], key[1] + bonus, -control.index), control))
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored

    @classmethod
    def _top_two(
        cls,
        controls: list[Control],
        synonyms: tuple[str, ...],
        preferred_types: tuple[str, ...] | None,
        field_name: str,
    ) -> tuple[Control | None, Control | None]:
        ranked = cls._rank_controls(controls, synonyms, preferred_types, field_name)
        if not ranked:
            return None, None
        best = ranked[0][1]
        runner = next((item[1] for item in ranked[1:] if item[1].index != best.index), None)
        return best, runner

    @classmethod
    def _is_low_confidence(
        cls, controls: list[Control], field_name: str, chosen: Control
    ) -> bool:
        """这条映射要不要标"需确认"。

        判据是**该字段自己的冠亚军差距**：负向词能挡掉一部分（见 ``_hinted_out``），
        挡不住的那部分靠它暴露给用户。

        同组单选/复选除外：性别那两个选项本来就由 ``_build_mapping`` 在组内按值再挑一次，
        旗子插上去只是噪声。
        """
        base_field, explicit_index = split_repeated_key(field_name)
        family = family_for_field(base_field)
        target_index = explicit_index if explicit_index is not None else (1 if family else None)
        ranked = cls._rank_controls(
            controls,
            FIELD_SYNONYMS.get(base_field, ()),
            FIELD_PREFERRED_TYPES.get(base_field),
            base_field,
            target_index=target_index,
        )
        if len(ranked) < 2:
            return False
        best_key, best = ranked[0]
        runner_key, runner = ranked[1]
        if best.index != chosen.index:
            # 全局择优把冠军让给了别的字段（对方证据更强），这一条本来就是退而求其次的。
            return True
        if cls._group_key(best) and cls._group_key(best) == cls._group_key(runner):
            return False
        return best_key[0] == runner_key[0] and (best_key[1] - runner_key[1]) < 2

    @classmethod
    def _best_control(
        cls,
        controls: list[Control],
        synonyms: tuple[str, ...],
        used: set[int],
        preferred_types: tuple[str, ...] | None,
        field_name: str,
    ) -> tuple[Control | None, bool]:
        """单个字段的最佳控件与置信度（保留给测试与离线诊断用；实际分配走 ``match_fields``
        的全局择优）。"""
        ranked = cls._rank_controls(controls, synonyms, preferred_types, field_name)
        available = [item for item in ranked if item[1].index not in used]
        if not available:
            return None, False
        best = available[0][1]
        return best, cls._is_low_confidence(controls, field_name, best)

    @staticmethod
    def unmapped_required(controls: list[Control], mappings: list[FieldMapping]) -> list[Control]:
        """已映射之外、仍然必填的控件（调用方据此如实报"这些还需要你填"）。"""
        mapped = {mapping.control.index for mapping in mappings}
        return [
            control for control in controls if control.required and control.index not in mapped
        ]

    def apply(
        self, client: CdpClient, mappings: list[FieldMapping], *, timeout: float | None = None
    ) -> list[ApplyOutcome]:
        """逐字段写入页面，并**逐条返回结果**（原先返回 ``None`` 且吞掉异常）。

        写完后回读一次页面值：受控组件有时"看起来填了、其实没进去"（值出现在界面上，
        但框架的内部状态没更新，提交时又报"请填写"）。回读不一致的如实标成
        ``unverified``，而不是当作成功。
        """
        outcomes: list[ApplyOutcome] = []
        for mapping in mappings:
            control = mapping.control
            if not control.selector:
                outcomes.append(ApplyOutcome(control.index, mapping.field, "skipped", "控件没有定位符"))
                continue
            applied_mapping = mapping
            try:
                if control.type == "select":
                    applied_mapping = self._apply_select(client, mapping, timeout=timeout)
                elif control.has_popup:
                    resolution = select_combobox_option(
                        client, control.selector, mapping.value, timeout=timeout
                    )
                    if resolution.status != "matched" or resolution.option is None:
                        raise RuntimeError(resolution.reason or "自定义下拉没有唯一匹配项")
                    applied_mapping = replace(mapping, select=resolution)
                elif control.type in ("radio", "checkbox"):
                    self._apply_choice(client, mapping, timeout=timeout)
                elif control.type == "richtext":
                    client.evaluate(
                        _set_richtext_script(control.selector, mapping.value), timeout=timeout
                    )
                else:
                    client.evaluate(
                        _set_value_script(
                            control.selector,
                            mapping.write_value(),
                            prototype=_PROTOTYPE_BY_TYPE.get(control.type, "HTMLInputElement"),
                        ),
                        timeout=timeout,
                    )
            except Exception as error:  # noqa: BLE001 - 单个控件失败不该中断整轮
                logger.warning("填充控件 %s 失败：%s", control.index, error)
                outcomes.append(
                    ApplyOutcome(control.index, mapping.field, "failed", f"{type(error).__name__}")
                )
                continue

            outcomes.append(self._verify(client, applied_mapping, timeout=timeout))
        return outcomes

    @staticmethod
    def _apply_select(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> FieldMapping:
        selected_value = mapping.write_value()
        if mapping.select is None or mapping.select.status != "matched":
            # 父级 select 触发的异步加载可能在快照之后才完成；每次轮询都只读当前
            # 原生 select 的真实 option，最终仍由 resolve_select_option 做严格匹配。
            deadline = time.monotonic() + (
                _DEPENDENT_SELECT_WAIT_SECONDS
                if timeout is None
                else min(_DEPENDENT_SELECT_WAIT_SECONDS, max(float(timeout), 0.0))
            )
            resolution = SelectResolution("no_option", reason="联动下拉的选项尚未加载")
            while True:
                payload = client.evaluate(
                    _read_select_options_script(mapping.control.selector), timeout=timeout
                )
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except ValueError:
                        payload = None
                options = (
                    FormEngine._parse_options(payload.get("options"))
                    if isinstance(payload, dict) and payload.get("ok")
                    else ()
                )
                resolution = resolve_select_option(options, mapping.value)
                if resolution.status == "matched" and resolution.option is not None:
                    selected_value = resolution.option.value
                    break
                if time.monotonic() >= deadline or resolution.status not in {"no_option", "empty"}:
                    raise RuntimeError(
                        f"联动下拉未出现与“{mapping.value}”匹配的选项：{resolution.reason}"
                    )
                time.sleep(_DEPENDENT_SELECT_POLL_SECONDS)
        client.evaluate(
            _select_option_script(mapping.control.selector, selected_value),
            timeout=timeout,
        )
        if mapping.select is None or mapping.select.status != "matched":
            return replace(mapping, select=resolution)
        return mapping

    @staticmethod
    def _apply_choice(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> None:
        """单选/复选：**只在需要改变状态时才点**。

        对已勾选的复选框再点一下会把它取消——而"取消用户的勾选"比不填更糟。
        """
        if mapping.control.checked:
            return
        click_selector(client, mapping.control.selector, timeout=timeout)

    @staticmethod
    def _verify(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> ApplyOutcome:
        """回读页面值，与期望比对。"""
        try:
            payload = client.evaluate(
                _read_back_script(mapping.control.selector), timeout=timeout
            )
        except Exception:  # noqa: BLE001 - 回读失败不影响"已经填过"这个事实
            return ApplyOutcome(mapping.control.index, mapping.field, "filled", "未能回读校验")

        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                payload = None
        if not isinstance(payload, dict) or not payload.get("ok"):
            return ApplyOutcome(mapping.control.index, mapping.field, "unverified", "回读不到控件")

        expected = mapping.write_value()
        accepted_values = {expected}
        if mapping.select is not None and mapping.select.option is not None:
            accepted_values.add(mapping.select.option.display())
        if mapping.control.type == "select":
            actual = str(payload.get("value", ""))
        elif mapping.control.type in ("radio", "checkbox"):
            if not payload.get("checked"):
                return ApplyOutcome(
                    mapping.control.index, mapping.field, "unverified", "点击后仍未勾选"
                )
            return ApplyOutcome(mapping.control.index, mapping.field, "filled")
        else:
            actual = str(payload.get("value", ""))

        if actual in accepted_values:
            return ApplyOutcome(mapping.control.index, mapping.field, "filled")
        return ApplyOutcome(
            mapping.control.index,
            mapping.field,
            "unverified",
            f"页面上的值是 {actual!r}，与期望不符，可能未生效",
        )
