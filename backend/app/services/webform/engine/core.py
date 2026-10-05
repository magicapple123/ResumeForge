"""FormEngine：表单快照 / 读取 / 匹配 / 应用 / 校验的编排。"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import replace
from typing import Any

from ...browser.cdp_client import CdpClient
from ...browser.interaction import click_selector
from ..custom_select import select_combobox_option
from ..fields import (
    AUTOCOMPLETE_DENY,
    CLAIM_LABELS,
    CONSENT_HINTS,
    FIELD_BLOCK_HINTS,
    FIELD_DENYLIST,
    FIELD_PREFERRED_TYPES,
    FIELD_SYNONYMS,
)
from ..matching import (
    SelectOption,
    SelectResolution,
    date_component,
    format_date,
    is_date_hint,
    is_date_like_value,
    resolve_select_option,
    same_phone_number,
)
from ..repeated_fields import (
    compatible_block,
    family_for_field,
    field_key_for_block,
    parse_block_label,
    split_repeated_key,
)
from .date_grouping import START_END_DATE_FIELDS, link_split_date_controls
from .evidence import (
    block_hint_satisfied,
    competing_fields,
    evidence_key,
    excluded_by_hints,
    has_ambiguous_field_evidence,
)
from .families import foreign_marker
from .pollution import strip_shared_nearby
from .recovery import (
    MAX_RETRIES,
    OptionUnavailable,
    REASON_NO_CONTROL,
    REASON_NO_SELECTOR,
    REASON_NOT_CHECKED,
    REASON_READBACK_ERROR,
    REASON_VALUE_MISMATCH,
    RetryStrategy,
    classify_write_error,
    retry_plan,
)
from .model import (
    CONTROL_TYPES,
    ApplyOutcome,
    Control,
    FieldMapping,
    MatchResult,
    SkipNote,
    _DEPENDENT_SELECT_POLL_SECONDS,
    _DEPENDENT_SELECT_WAIT_SECONDS,
    _RECHECK_DELAY_SECONDS,
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


def _retry_mapping(mapping: FieldMapping, outcome: ApplyOutcome | None) -> FieldMapping:
    """重试时换个值写法：**电话类字段改写纯数字**。

    2026-10-05 字节页实测：资料里的手机号带分隔符（``138-0000-0000``），写进去被页面
    清空（那个框只收 11 位数字）；而同一个值在腾讯页却被页面自己规范化成
    ``13800000000``。重试时换纯数字写法，两种页面都能落。首次尝试保持原样——
    有些站点显示上就带分隔符。
    """
    if outcome is None or not mapping.field.startswith("phone"):
        return mapping
    value = mapping.write_value()
    digits = re.sub(r"\D", "", value)
    if len(digits) < 7 or digits == value:
        return mapping
    return replace(mapping, value=digits, select=None, date=None)


def _value_over_max_length(mapping: FieldMapping) -> str | None:
    """值比控件允许的长度还长时返回一句如实说明；没超就返回 ``None``。

    2026-10-05 美团页实测：内推码框限 9 个字，资料里的码 12 个字——脚本写进去绕过了
    ``maxlength``，但页面自己把它截成了 ``RF-BOSS-``（残码），用户提交的就是这个残值。
    宁可不填、如实说明，也不写一个必然被截断的值。
    """
    limit = mapping.control.max_length
    if limit <= 0:
        return None
    value = mapping.write_value()
    if len(value) <= limit:
        return None
    return f"这个框最多 {limit} 个字，资料里的值有 {len(value)} 个字，请精简后自己填"


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
                    max_length=self._parse_optional_int(raw.get("max_length")) or 0,
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
        # 先洗掉"整表标签串"（mokahr 类页面把全表标签串进每个控件的旁文，
        # 让每个框都像命中所有字段）——见 engine/pollution.py。
        controls = strip_shared_nearby(controls)
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
            if date_part and is_date_like_value(str(data[raw_field])):
                # 一个资料日期可以对应页面上的「年 / 月 / 日」多个下拉，
                # 每个组件都要占一个独立槽位，不能被同一字段的第一项吞掉。
                # **槽位只对日期形状的值开放**：school 这类文本字段的值（学校名）
                # 哪怕命中了年下拉（区块标签污染），也走普通槽位——一字段一控件，
                # 不许把学校名塞进「年」「月」每一个框。
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
                control, mapping_field, str(data[raw_field]).strip(), False
            )
            if mapping is None:
                continue
            used |= self._claimed_indexes(mapping.control)
            assigned.add(slot)
            mappings.append(mapping)
            if control.date_group:
                date_assigned.add((control.date_group, base_field))
                raw_value = str(data[raw_field]).strip()
                for companion in controls:
                    if companion.date_group != control.date_group or companion.index == control.index:
                        continue
                    # ``used`` 里既有"已被别的字段认领"，也有"skip_reason 判了永不自动填"
                    # ——后者正是"只填不点"：同一个年月组里，文本「年」填上了、下拉「月」
                    # 是只能点选的控件，不能顺着这条边把它也写掉。
                    if companion.index in used:
                        continue
                    companion_mapping = self._build_mapping(
                        companion, control.date_part_label, raw_value, False
                    )
                    if companion_mapping is None:
                        continue
                    used.add(companion.index)
                    companion_slot = (base_field, target_index, companion.date_part())
                    assigned.add(companion_slot)
                    mappings.append(companion_mapping)

        # 起止日期组的第二轮（见 ``_complete_split_date_pairs``）：一个区块里"就读时间"
        # 标着两对年/月（起、止）时，候选循环只会把两组都算成 education_start，
        # 槽位被第一组占掉，第二组永远填不上。
        mappings.extend(self._complete_split_date_pairs(controls, data, used, mappings))

        # 低置信在分配完成之后单独算：判据是该字段自己的冠亚军差距（见 ``_best_control``），
        # 而全局择优决定了它最终拿到的是不是那个冠军。
        final: list[FieldMapping] = []
        for mapping in mappings:
            overflow = _value_over_max_length(mapping)
            if overflow is not None:
                # 值比框允许的长度还长：**不填**并如实说明——写进去只会被页面截成
                # 前半截（美团内推码实测），用户提交的是个残值，比不填更糟。
                skipped.append(SkipNote(control=mapping.control, reason=overflow))
                continue
            final.append(
                replace(
                    mapping,
                    low_confidence=self._is_low_confidence(controls, mapping.field, mapping.control),
                )
            )

        unmatched = [control for control in controls if control.index not in used]
        return MatchResult(mappings=final, unmatched=unmatched, skipped=skipped)

    def _complete_split_date_pairs(
        self,
        controls: list[Control],
        data: dict[str, Any],
        used: set[int],
        mappings: list[FieldMapping],
    ) -> list[FieldMapping]:
        """补上"起止"里的第二组拆分日期（紧挨着的两组年/月，第二组是"止"）。

        场景：教育背景的"就读时间"是四个连排控件（年/月/年/月），两组的上下文一模一样，
        分组把两组都解析成 ``education_start``——候选循环按槽位把第一组分配掉，第二组
        没有任何字段能认领，永远填不上。（源自 2026-10-05 鹰角 apply 页的一次实测；
        同日复核发现那一页的四个控件其实是组件库下拉、已归入「只填不点」，所以这条规则
        现在只对**文本形态**的年/月连排生效。）

        条件刻意收紧，缺一不可：两组**紧挨着**（中间没有任何控件）、父字段相同且
        是 ``*_start``、第一组确实拿到了它、第二组还没被任何字段认领、值是日期形状、
        **资料里有对应的 ``*_end``**。可重复区块（"添加一条教育经历"）的第二条不会
        紧挨着第一条的日期组（中间隔着学校/专业等控件），因此不会被误配成"止"。
        """
        groups: dict[str, list[Control]] = {}
        for control in controls:
            if control.date_group:
                groups.setdefault(control.date_group, []).append(control)
        ordered = sorted(groups.values(), key=lambda group: group[0].index)

        added: list[FieldMapping] = []
        for first, second in zip(ordered, ordered[1:]):
            if second[0].index != first[-1].index + 1:
                continue
            parent = first[0].date_part_label
            if second[0].date_part_label != parent:
                continue
            end_field = START_END_DATE_FIELDS.get(parent)
            value = str(data.get(end_field or "", "")).strip()
            if end_field is None or not value or not is_date_like_value(value):
                continue
            if not any(
                split_repeated_key(mapping.field)[0] == parent
                and mapping.control.index == first[0].index
                for mapping in mappings
            ):
                continue
            if any(control.index in used for control in second):
                continue
            for control in second:
                mapping = self._build_mapping(control, end_field, value, False)
                if mapping is None:
                    continue
                used.add(control.index)
                added.append(mapping)
        return added

    @staticmethod
    def _link_split_date_controls(controls: list[Control]) -> list[Control]:
        """Keep the historical method path while delegating date grouping."""
        return link_split_date_controls(controls)

    @staticmethod
    def _group_key(control: Control) -> str:
        """单选/复选的分组键；空串表示分不出组（那就只能当它自成一组）。"""
        return control.group or control.name

    @staticmethod
    def _claimed_indexes(control: Control) -> set[int]:
        """这条映射占掉了哪些控件。

        曾经还要把单选/复选的**同组兄弟一并占掉**（只占被选中的那个，同组的"女"会留在
        「没认出来」里当噪声）。「只填不点」之后单选/复选不再产生映射，那段随
        ``_build_mapping`` 一并删掉了——同组兄弟现在统一由 ``skip_reason`` 标成
        "需要你自己点选"，一个都不会漏。
        """
        return {control.index}

    def _build_mapping(
        self,
        control: Control,
        field_name: str,
        value: str,
        low_confidence: bool,
    ) -> FieldMapping | None:
        """把值整理成"真正要写进去的东西"；整理不出来就放弃这一条。

        **只处理文本类控件**（"只填不点"，2026-10-05 的产品边界）：下拉 / 单选 / 复选 /
        日期控件 / 弹层选择器在 ``skip_reason`` 就被挡在匹配之外，到不了这里。"选哪个
        option、点哪个兄弟"那套整理逻辑随之删除；显式填充（``/fill``）那条路在
        ``service.fill._rebuild_mapping`` 里另有一份。
        """
        if control.date_group:
            # 「年 / 月 / 日」拆分组件：资料给的是完整日期（"2023-06"）时，只写属于这个
            # 组件的那部分（年框拿 "2023"）。拆不出来就放弃这一条——写整串只会被页面截断。
            component_value = date_component(value, control.date_part() or "")
            if component_value.status != "matched":
                return None
            return FieldMapping(
                control=control,
                field=field_name,
                value=component_value.value,
                low_confidence=low_confidence,
            )

        if control.type == "text":
            # 没有 ``date_group`` 但自述里带日期单位（"年"/"月"）的文本框：同样只写属于
            # 它的那部分。判据见 ``Control.date_part``。
            component = control.date_part()
            if component:
                component_value = date_component(value, component)
                if component_value.status == "matched":
                    return FieldMapping(
                        control=control,
                        field=field_name,
                        value=component_value.value,
                        low_confidence=low_confidence,
                    )
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
        # **"只填不点"**（2026-10-05 维护者定下的产品边界）：凡是值由"点选"产生的控件
        # ——下拉、单选、复选、日期控件、自定义弹层/只读选择器——一律不自动填。
        # 工具只往**文本类**控件（文本框 / 多行文本 / 富文本）里写值，需要鼠标交互的
        # 一律如实列出来让你自己点。理由有两层：
        #
        # 1. 诚实：程序往只读展示框 / 组件状态里写值，常常是"看着填上了、交上去是空的"；
        # 2. 边界：性别、学历、意向城市、日期这些是**你的选择**，不是从资料里抄一行字
        #    ——代选等于替你表态，和"不代勾同意条款"是同一条纪律。
        if control.type in ("select", "radio", "checkbox"):
            return "这是个需要你自己点选的控件（下拉 / 单选 / 复选），不会自动填写"
        if control.type in ("date", "month"):
            # 原生日期控件虽然能敲键盘，但交互是"点开日历挑一个"，写进去的值也常被
            # 组件自己的状态盖掉（回读为空）。
            return "这是日期选择控件，需要你在页面上自己点选"
        if control.has_popup:
            return "这是个点开弹层的控件（自定义下拉 / 日期选择器一类），需要你自己点选"
        return None

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
            if has_ambiguous_field_evidence(control):
                continue
            if excluded_by_hints(control, field_name):
                continue
            if foreign_marker(control, field_name) is not None:
                # 控件自述属于别的族（"区号"框之于日期字段）：跨族否决。
                # 只看控件自己说的话，旁文污染不算——见 families.py。
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
            # 在别的区块上误命中——见 FIELD_BLOCK_HINTS 的说明。判据抽到
            # ``block_hint_satisfied`` 里与 recognize_field 共用。
            if not block_hint_satisfied(control, field_name, key, synonyms):
                continue
            if block_hint and control.block_family and not compatible_block(
                field_name, control.block_family, control.block_index, target_index=target_index
            ):
                continue
            expected_date_order = 1 if field_name.endswith("_start") else 2 if field_name.endswith("_end") else None
            if expected_date_order and control.date_order and control.date_order != expected_date_order:
                continue
            bonus = 5 if preferred_types and control.type in preferred_types else 0
            # 「点开是弹层」的控件在同分竞争里靠后站：弹层路径要点击、等选项、再选，
            # 比直写脆弱得多，而它常常是**只读的展示框**。2026-10-05 字节页实测两处
            # 抢单：+86 区号框（popup）抢走了手机号、只读的「证件类型」抢走了证件号码，
            # 真正的输入框双双落空。只在同分/近分竞争时起作用——证据明显更强的弹层
            # 控件（分差 ≥3）照样赢。
            if control.has_popup:
                bonus -= 2
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

        判据是**该字段自己的冠亚军差距**：负向词能挡掉一部分（见 ``excluded_by_hints``），
        挡不住的那部分靠它暴露给用户。另加**跨字段争抢**（``competing_fields``）——
        同一控件也是别的字段的同档同分候选时（学校 vs 专业），只比本字段的冠亚军
        看不见这种争抢，会按字段表顺序静默硬分。

        同组单选/复选除外：性别那两个选项本来就由 ``_build_mapping`` 在组内按值再挑一次，
        旗子插上去只是噪声（跨字段争抢仍然算，那是另一回事）。
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
        competes = bool(competing_fields(chosen, base_field))
        if len(ranked) < 2:
            return competes
        best_key, best = ranked[0]
        runner_key, runner = ranked[1]
        if best.index != chosen.index:
            # 全局择优把冠军让给了别的字段（对方证据更强），这一条本来就是退而求其次的。
            return True
        if cls._group_key(best) and cls._group_key(best) == cls._group_key(runner):
            return competes
        return competes or (
            best_key[0] == runner_key[0] and (best_key[1] - runner_key[1]) < 2
        )

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
        self,
        client: CdpClient,
        mappings: list[FieldMapping],
        *,
        timeout: float | None = None,
        recheck_delay: float = _RECHECK_DELAY_SECONDS,
        max_retries: int = MAX_RETRIES,
    ) -> list[ApplyOutcome]:
        """逐字段写入页面，并**逐条返回结果**（原先返回 ``None`` 且吞掉异常）。

        每个控件：写一次 → 回读判定；不一致/读不到时按 ``recovery`` 的阶梯最多重试
        ``max_retries`` 轮，每轮重试前先探一眼页面现状（值已对就不写、已被别的值占住
        就不覆盖、单选已勾上就不再点）。结果逐条如实返回，失败带原因码。
        """
        return [
            self._apply_one(
                client,
                mapping,
                timeout=timeout,
                recheck_delay=recheck_delay,
                max_retries=max_retries,
            )
            for mapping in mappings
        ]

    def _apply_one(
        self,
        client: CdpClient,
        mapping: FieldMapping,
        *,
        timeout: float | None,
        recheck_delay: float,
        max_retries: int,
    ) -> ApplyOutcome:
        """单个控件的"写入 + 判定 + 有限重试"。"""
        control = mapping.control
        if not control.selector:
            return ApplyOutcome(
                control.index, mapping.field, "skipped", "控件没有定位符", reason=REASON_NO_SELECTOR
            )

        outcome: ApplyOutcome | None = None
        strategy = RetryStrategy()
        for attempt in range(1, max_retries + 2):
            if outcome is not None:
                guard = self._retry_guard(client, mapping, timeout=timeout)
                if guard == "done":
                    # 上一次多半只是回读抖动或落定延迟：值其实已经对了，不需要再写。
                    return replace(outcome, status="filled", detail="", reason="", attempts=attempt - 1)
                if guard == "occupied":
                    # 页面上已有**别的**值（用户填的、页面自己回填的）：不覆盖，如实上报。
                    return replace(outcome, attempts=attempt - 1)
            outcome = replace(
                self._apply_once(
                    client,
                    _retry_mapping(mapping, outcome),
                    strategy=strategy,
                    timeout=timeout,
                    recheck_delay=recheck_delay,
                ),
                attempts=attempt,
            )
            if outcome.status == "filled":
                return outcome
            strategy = retry_plan(outcome.reason, attempt)
            if strategy is None:
                return outcome
        assert outcome is not None  # 循环至少执行一次，任何分支都会赋值
        return outcome

    def _apply_once(
        self,
        client: CdpClient,
        mapping: FieldMapping,
        *,
        strategy: RetryStrategy,
        timeout: float | None,
        recheck_delay: float,
    ) -> ApplyOutcome:
        """写一次 + 回读判定；不参与任何重试决策（那在 ``_apply_one``）。"""
        control = mapping.control
        applied_mapping = mapping
        try:
            if control.type == "select":
                applied_mapping = self._apply_select(client, mapping, timeout=timeout)
            elif control.has_popup:
                # 自定义弹层（只读选择器 / 级联 / 日期选择器一类）：值由点选产生。
                # **匹配层已经不会把字段分配给这类控件**（"只填不点"，见 skip_reason），
                # 这里保留这条路径只为程序化构造的映射（测试与显式调用）。
                resolution = select_combobox_option(
                    client, control.selector, mapping.value, timeout=timeout
                )
                if resolution.status != "matched" or resolution.option is None:
                    raise OptionUnavailable(resolution.reason or "自定义下拉没有唯一匹配项")
                applied_mapping = replace(mapping, select=resolution)
            elif control.type in ("radio", "checkbox"):
                self._apply_choice(
                    client,
                    mapping,
                    timeout=timeout,
                    force=strategy.force_choice_click,
                )
            elif control.type == "richtext":
                client.evaluate(
                    _set_richtext_script(
                        control.selector, mapping.value, full_events=strategy.full_events
                    ),
                    timeout=timeout,
                )
            else:
                client.evaluate(
                    _set_value_script(
                        control.selector,
                        mapping.write_value(),
                        prototype=_PROTOTYPE_BY_TYPE.get(control.type, "HTMLInputElement"),
                        full_events=strategy.full_events,
                    ),
                    timeout=timeout,
                )
        except Exception as error:  # noqa: BLE001 - 单个控件失败不该中断整轮
            logger.warning("填充控件 %s 失败：%s", control.index, error)
            return ApplyOutcome(
                control.index,
                mapping.field,
                "failed",
                # 异常自带的中文说明比类名有用得多（联动下拉给出的是"未出现匹配的选项…"）；
                # 没有说明时才退回类名。
                str(error) or type(error).__name__,
                reason=classify_write_error(error),
            )
        return self._verify(
            client, applied_mapping, timeout=timeout, recheck_delay=recheck_delay
        )

    @classmethod
    def _retry_guard(
        cls, client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> str:
        """重试前探一眼页面现状：``"done"`` / ``"occupied"`` / ``"retry"``。

        - ``done``：读回来已经是期望值（上一次只是回读抖动）——直接判成功，别再写；
        - ``occupied``：页面上有一个**别的**值——不覆盖（这是"不覆盖已填"的重试版）；
        - ``retry``：空值、或没留下痕迹，可以再试。
        """
        try:
            payload = cls._read_back_payload(client, mapping, timeout=timeout)
        except Exception:  # noqa: BLE001 - 读不到就不拦，让重试自己去试
            return "retry"
        if cls._judge(payload, mapping).status == "filled":
            return "done"
        if mapping.control.type in ("radio", "checkbox"):
            # 勾选态只看 checked：没勾上就允许再点（点了只会勾上，不会反选）。
            return "retry"
        actual = str(payload.get("value", "")) if isinstance(payload, dict) else ""
        if actual and actual not in cls._accepted_values(mapping):
            return "occupied"
        return "retry"

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
                    raise OptionUnavailable(
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
        client: CdpClient,
        mapping: FieldMapping,
        *,
        timeout: float | None,
        force: bool = False,
    ) -> None:
        """单选/复选：**只在需要改变状态时才点**。

        对已勾选的复选框再点一下会把它取消——而"取消用户的勾选"比不填更糟。
        ``force=True`` 用在重试路径：调用方刚刚回读过勾选态、确认没勾上，
        不能再被可能已过期的快照 ``checked`` 拦住。
        """
        if mapping.control.checked and not force:
            return
        click_selector(client, mapping.control.selector, timeout=timeout)

    @staticmethod
    def _read_back_payload(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> Any:
        """回读一次，返回解析后的 payload（解析不出来返回 ``None``）。"""
        payload = client.evaluate(
            _read_back_script(
                mapping.control.selector, rich=mapping.control.type == "richtext"
            ),
            timeout=timeout,
        )
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                return None
        return payload

    @staticmethod
    def _accepted_values(mapping: FieldMapping) -> set[str]:
        """回读可接受的值集合（下拉还要认 option 的展示文本）。"""
        accepted = {mapping.write_value()}
        if mapping.select is not None and mapping.select.option is not None:
            accepted.add(mapping.select.option.display())
        return accepted

    @classmethod
    def _judge(cls, payload: Any, mapping: FieldMapping) -> ApplyOutcome:
        """把一次回读结果判成 filled / unverified（附原因码）。"""
        if not isinstance(payload, dict) or not payload.get("ok"):
            return ApplyOutcome(
                mapping.control.index, mapping.field, "unverified", "回读不到控件",
                reason=REASON_NO_CONTROL,
            )
        if mapping.control.type in ("radio", "checkbox"):
            if not payload.get("checked"):
                return ApplyOutcome(
                    mapping.control.index, mapping.field, "unverified", "点击后仍未勾选",
                    reason=REASON_NOT_CHECKED,
                )
            return ApplyOutcome(mapping.control.index, mapping.field, "filled")

        actual = str(payload.get("value", ""))
        if actual in cls._accepted_values(mapping) or same_phone_number(
            mapping.field, mapping.write_value(), actual
        ):
            return ApplyOutcome(mapping.control.index, mapping.field, "filled")
        return ApplyOutcome(
            mapping.control.index,
            mapping.field,
            "unverified",
            f"页面上的值是 {actual!r}，与期望不符，可能未生效",
            reason=REASON_VALUE_MISMATCH,
        )

    @classmethod
    def _verify(
        cls,
        client: CdpClient,
        mapping: FieldMapping,
        *,
        timeout: float | None,
        recheck_delay: float = _RECHECK_DELAY_SECONDS,
    ) -> ApplyOutcome:
        """回读页面值并与期望比对；不一致时稍候复读一次再下结论。

        **回读失败不再记 filled**：读不到就是没验证过，如实报 ``unverified``
        （旧实现记 filled 并附注"未能回读校验"，成功率因此虚高）。
        """
        control = mapping.control
        try:
            payload = cls._read_back_payload(client, mapping, timeout=timeout)
        except Exception:  # noqa: BLE001 - 回读失败是"没验证过"，不是"没填上"
            return ApplyOutcome(
                control.index,
                mapping.field,
                "unverified",
                "未能回读校验（读取页面值时出错）",
                reason=REASON_READBACK_ERROR,
            )
        outcome = cls._judge(payload, mapping)
        if outcome.status == "filled":
            return outcome
        # 受控组件把内部状态落定有延迟，"填了立刻读"可能读到还没更新的旧值：
        # 给一点时间复读一次（只在**不一致**时付这个等待，happy path 不等）。
        if recheck_delay:
            time.sleep(recheck_delay)
        try:
            payload = cls._read_back_payload(client, mapping, timeout=timeout)
        except Exception:  # noqa: BLE001 - 复读也失败：保留第一次的判定
            return outcome
        second = cls._judge(payload, mapping)
        return second if second.status == "filled" else outcome
