"""放宽模式下的文本控件与自定义字段匹配。"""
from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from difflib import SequenceMatcher

from ..engine import (
    Control,
    FieldMapping,
    FormEngine,
    _states_its_field,
    excluded_by_hints,
    foreign_marker,
)
from ..engine.evidence import explicit_control_families, explicit_foreign_family
from ..fields import FIELD_BLOCK_HINTS, FIELD_LABELS, FIELD_SYNONYMS
from ..repeated_fields import (
    compatible_block,
    family_for_field,
    family_from_control_text,
    split_repeated_key,
)
from .fill import resolve_value_for

CUSTOM_FIELD_PREFIX = "CUSTOM_"
RELAXED_TEXT_NOTE = "放宽模式：依据字段标签/上下文匹配，填完请核对"
_SEQUENCE_ONLY_ALIASES = frozenset({"描述", "角色", "起止时间", "开始时间", "结束时间"})


def normalize_field_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return "".join(char for char in text if char.isalnum())


def custom_labels_from_catalog(catalog: Sequence[Mapping[str, object]]) -> dict[str, str]:
    return {
        str(item.get("key")): str(item.get("label") or "").strip()
        for item in catalog
        if str(item.get("key") or "").startswith(CUSTOM_FIELD_PREFIX)
        and str(item.get("label") or "").strip()
    }


def _field_aliases(field: str, custom_labels: Mapping[str, str]) -> tuple[str, ...]:
    if field.startswith(CUSTOM_FIELD_PREFIX):
        label = custom_labels.get(field) or field[len(CUSTOM_FIELD_PREFIX) :]
        return (label,) if label else ()
    base, _index = split_repeated_key(field)
    aliases = (FIELD_LABELS.get(base, base), *FIELD_SYNONYMS.get(base, ()))
    return tuple(dict.fromkeys(alias for alias in aliases if str(alias).strip()))


def _unique_field_alias(field: str, alias: str) -> bool:
    base, _index = split_repeated_key(field)
    wanted = normalize_field_text(alias)
    if len(wanted) < 4:
        return False
    owners: set[str] = set()
    for candidate, synonyms in FIELD_SYNONYMS.items():
        values = (FIELD_LABELS.get(candidate, candidate), *synonyms)
        if any(normalize_field_text(value) == wanted for value in values):
            owners.add(candidate)
    return owners == {base}


def _own_parts(control: Control) -> tuple[str, ...]:
    return tuple(
        part.strip()
        for part in (
            control.label,
            control.placeholder,
            control.aria_label,
            control.aria_labelledby,
            control.title,
        )
        if part and part.strip()
    )


def _score_alias(
    control: Control, alias: str, *, allow_sequence_alias: bool = False
) -> int:
    wanted = normalize_field_text(alias)
    if len(wanted) < 2:
        return 0
    own = [normalize_field_text(part) for part in _own_parts(control)]
    nearby = normalize_field_text(" ".join((control.nearby_text, control.block_label)))
    if any(part == wanted for part in own):
        return 1000 + len(wanted)
    if len(wanted) < 3:
        prompt_prefixes = ("请输入", "请填写", "请选择")
        for part in own:
            for prefix in prompt_prefixes:
                if part.startswith(prefix) and part[len(prefix) :].endswith(wanted):
                    return 850 + len(wanted)
        if allow_sequence_alias and alias in _SEQUENCE_ONLY_ALIASES and wanted in nearby:
            return 650 + len(wanted)
        # Two-character aliases are too common to match as arbitrary substrings.
        return 0
    if any(wanted in part for part in own):
        return 850 + len(wanted)
    if wanted in nearby:
        return 650 + len(wanted)
    if len(wanted) >= 3:
        best = max(
            (SequenceMatcher(None, wanted, part).ratio() for part in (*own, nearby) if part),
            default=0.0,
        )
        if best >= 0.86:
            return 500 + int(best * 100)
    return 0


def _score_field(
    control: Control,
    field: str,
    custom_labels: Mapping[str, str],
    *,
    allow_unscoped_repeat_order: bool = False,
) -> int:
    if excluded_by_hints(control, field) or foreign_marker(control, field):
        return 0
    if explicit_foreign_family(control, field):
        return 0
    family = family_for_field(field)
    _base, target_index = split_repeated_key(field)
    if family and control.block_family and not compatible_block(
        field, control.block_family, control.block_index, target_index=target_index
    ):
        return 0
    expected_date_order = 1 if _base.endswith("_start") else 2 if _base.endswith("_end") else None
    if expected_date_order and control.date_order and control.date_order != expected_date_order:
        return 0
    explicit_families = explicit_control_families(control)
    control_family = family_from_control_text(" ".join(_own_parts(control)))
    if control_family and family and control_family != family:
        return 0
    if explicit_families:
        if family and family not in explicit_families:
            return 0
        if family is None:
            # A strongly section-labelled control should not be claimed by a
            # global field solely because a generic word appears nearby.
            aliases = _field_aliases(field, custom_labels)
            own_score = max(
                (
                    _score_alias_parts(_own_parts(control), alias)
                    for alias in aliases
                ),
                default=0,
            )
            if own_score == 0:
                return 0
    aliases = _field_aliases(field, custom_labels)
    if (
        control.placeholder
        and _states_its_field(control.placeholder)
        and max(
            (_score_alias_parts((control.placeholder,), alias) for alias in aliases),
            default=0,
        ) == 0
    ):
        # An explicit prompt is authoritative. Nearby text may describe an
        # adjacent form section and must not override a different prompt.
        return 0
    block_hint = FIELD_BLOCK_HINTS.get(_base)
    nearby = normalize_field_text(control.nearby_text)
    unique_context_alias = any(
        normalize_field_text(alias) in nearby and _unique_field_alias(field, alias)
        for alias in aliases
    )
    if (
        block_hint
        and not control.block_family
        and block_hint not in control.signature()
        and not allow_unscoped_repeat_order
        and max((_score_alias_parts(_own_parts(control), alias) for alias in aliases), default=0) < 850
        and not unique_context_alias
    ): 
        # Short evidence such as nearby-only “描述” cannot identify which repeated
        # section owns a textbox. Strong control-owned labels remain eligible.
        return 0
    return max(
        (
            _score_alias(
                control,
                alias,
                allow_sequence_alias=allow_unscoped_repeat_order,
            )
            for alias in aliases
        ),
        default=0,
    )


def _score_alias_parts(parts: Sequence[str], alias: str) -> int:
    wanted = normalize_field_text(alias)
    if len(wanted) < 2:
        return 0
    normalized_parts = [normalize_field_text(part) for part in parts]
    if any(part == wanted for part in normalized_parts):
        return 1000 + len(wanted)
    if any(wanted in part for part in normalized_parts):
        return 850 + len(wanted)
    return 0


def _candidate_fields(data: Mapping[str, str]) -> list[str]:
    by_slot: dict[tuple[str, int | None], str] = {}
    for raw_field, value in data.items():
        field = str(raw_field)
        if not str(value or "").strip():
            continue
        if field.startswith(CUSTOM_FIELD_PREFIX):
            by_slot[(field, None)] = field
            continue
        base, explicit_index = split_repeated_key(field)
        if base not in FIELD_SYNONYMS:
            continue
        family = family_for_field(base)
        index = explicit_index if explicit_index is not None else (1 if family else None)
        slot = (base, index)
        existing = by_slot.get(slot)
        # If both the legacy first-record key and its explicit repeated-record
        # key exist, prefer the explicit key so all sources share one slot.
        if existing is None or explicit_index is not None:
            by_slot[slot] = field
    return list(by_slot.values())


def logical_field_slot(field: str) -> tuple[str, int | None]:
    """把静态字段与重复字段归一成可分配的逻辑槽位。"""
    base, index = split_repeated_key(field)
    if index is None and family_for_field(base):
        index = 1
    return base, index


def relaxed_text_mappings(
    controls: Sequence[Control],
    data: Mapping[str, str],
    *,
    custom_labels: Mapping[str, str] | None = None,
    engine: FormEngine | None = None,
    occupied_indexes: set[int] | None = None,
    occupied_fields: set[tuple[str, int | None]] | None = None,
) -> list[FieldMapping]:
    """为放宽模式补齐未命中的文本控件；不接管点选、文件或日期控件。"""
    engine = engine or FormEngine()
    labels = custom_labels or {}
    assigned_controls = set(occupied_indexes or ())
    assigned_slots = set(occupied_fields or ())
    fields = _candidate_fields(data)
    field_order = {field: index for index, field in enumerate(fields)}
    repeated_fields_by_base: dict[str, list[str]] = {}
    for field in fields:
        base, index = split_repeated_key(field)
        if index is not None and family_for_field(base):
            repeated_fields_by_base.setdefault(base, []).append(field)
    repeated_bases = {
        base for base, repeated_fields in repeated_fields_by_base.items() if len(repeated_fields) > 1
    }
    candidates: list[tuple[int, int, int, str, Control]] = []
    sequence_resolved_indexes: set[int] = set()
    by_control: dict[int, list[tuple[int, str, Control]]] = {}
    for field in fields:
        for control in controls:
            if control.index in assigned_controls:
                continue
            if control.type not in ("text", "textarea", "email", "tel", "number", "richtext"):
                continue
            if control.is_filled() or engine.skip_reason(control) is not None:
                continue
            base, _record_index = split_repeated_key(field)
            score = _score_field(
                control,
                field,
                labels,
                allow_unscoped_repeat_order=base in repeated_bases,
            )
            if score >= 500:
                by_control.setdefault(control.index, []).append((score, field, control))
    repeated_ties: dict[str, list[tuple[int, Control]]] = {}
    for control_index, control_candidates in by_control.items():
        control_candidates.sort(key=lambda item: (-item[0], field_order[item[1]]))
        best_score = control_candidates[0][0]
        strongest = [
            item
            for item in control_candidates
            if best_score - item[0] < 40
        ]
        strongest_slots = {logical_field_slot(item[1]) for item in strongest}
        if len(strongest_slots) > 1:
            bases = {split_repeated_key(item[1])[0] for item in strongest}
            base = next(iter(bases)) if len(bases) == 1 else ""
            if base and family_for_field(base):
                # Identical repeated sections often have no discoverable block
                # metadata. Resolve only same-family ties by DOM order, matching
                # the site's visible record order; cross-field ties stay blocked.
                representative = max(item[0] for item in strongest)
                repeated_ties.setdefault(base, []).append((representative, strongest[0][2]))
                continue
            continue
        score, field, control = control_candidates[0]
        candidates.append((score, field_order[field], control_index, field, control))
    for base, tied_controls in repeated_ties.items():
        if len(tied_controls) != len(repeated_fields_by_base.get(base, ())):
            continue
        record_fields = sorted(
            (
                field
                for field in fields
                if split_repeated_key(field)[0] == base
                and logical_field_slot(field) not in assigned_slots
            ),
            key=lambda field: logical_field_slot(field)[1] or 1,
        )
        controls_in_order = sorted(tied_controls, key=lambda item: item[1].index)
        for (_score, control), field in zip(controls_in_order, record_fields, strict=False):
            candidates.append(
                (max(_score, 850), field_order[field], control.index, field, control)
            )
            sequence_resolved_indexes.add(control.index)
    candidates.sort(key=lambda item: (-item[0], item[1], item[2]))
    assigned_fields: set[str] = set()
    mappings: list[FieldMapping] = []
    for _score, _order, _index, field, control in candidates:
        slot = logical_field_slot(field)
        if field in assigned_fields or slot in assigned_slots or control.index in assigned_controls:
            continue
        value = resolve_value_for(control, field, dict(data))
        if not value:
            continue
        mapping = engine._build_mapping(
            control,
            field,
            value,
            score < 850 and control.index not in sequence_resolved_indexes,
        )
        if mapping is None:
            continue
        assigned_fields.add(field)
        assigned_slots.add(slot)
        assigned_controls.add(control.index)
        mappings.append(mapping)
    return mappings


def relaxed_text_suggestion(
    control: Control,
    data: Mapping[str, str],
    *,
    custom_labels: Mapping[str, str] | None = None,
    engine: FormEngine | None = None,
) -> FieldMapping | None:
    mappings = relaxed_text_mappings(
        [control], data, custom_labels=custom_labels, engine=engine
    )
    return mappings[0] if mappings else None
