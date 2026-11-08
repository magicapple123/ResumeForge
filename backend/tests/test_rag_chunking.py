# SPDX-License-Identifier: Apache-2.0
"""T1-A 验收：RAG chunk 构建、canonical 桥接表与去重（计划 §3.2/§8）。

全部用纯 DTO 构造，不建库、不联网、不调 LLM；确定性由纯函数保证。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace

from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.profile.profile_context import build_consumed_data
from app.services.rag.rag_chunking import (
    build_chunks,
    canonical_item_hash,
    dedupe_chunks_by_entry,
)

SECRET = "SECRET-证书编号-XYZZY"
NO_LLM_MARK = "NO-LLM-INTERNAL-QUINN"
CUSTOM_SECRET = "CUSTOM-PRIVATE-内网-7731"
SECTION_ORDER = ("summary", "experiences", "credentials", "custom:sec-1", "custom:sec-2")


def _spec(
    field_id: str,
    key: str,
    label: str,
    *,
    llm_allowed: bool = True,
    private: bool = False,
    is_builtin: bool = True,
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(
        field_id, key, label, "single_line", 1, llm_allowed, True, private, is_builtin
    )


def _custom_spec(field_id: str, label: str, *, llm_allowed: bool = True) -> ConsumedFieldSpec:
    return _spec(field_id, field_id, label, llm_allowed=llm_allowed, is_builtin=False)


def _entry(entry_id: str, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id, 0, values)


def _section(
    key: str,
    name: str,
    fields: list[ConsumedFieldSpec],
    entries: list[ConsumedEntry],
    *,
    form: str = "multi",
    primary_field_id: str | None = None,
) -> ConsumedSection:
    return ConsumedSection(
        key, name, form, None, False, primary_field_id, tuple(fields), tuple(entries), 1
    )


def _profile() -> ConsumedProfile:
    experiences = _section(
        "experiences",
        "实习/工作经历",
        [
            _spec("experiences.company", "company", "公司"),
            _spec("experiences.title", "title", "职位"),
            _spec("experiences.description", "description", "描述"),
            _custom_spec("cf-exp-note", "内部备注", llm_allowed=False),
        ],
        [
            _entry(
                "e1",
                {
                    "experiences.company": "甲公司",
                    "experiences.title": "后端工程师",
                    "experiences.description": "负责 RAG 检索\n搭建向量索引",
                    "cf-exp-note": NO_LLM_MARK,
                },
            ),
            # 主字段（company）为空：下游 _select_entries 会过滤掉，chunk 也必须跳过。
            _entry(
                "e2", {"experiences.title": "只有职位", "experiences.description": "主字段为空"}
            ),
            _entry(
                "e3", {"experiences.company": "乙公司", "experiences.description": "构建指标体系"}
            ),
        ],
    )
    credentials = _section(
        "credentials",
        "证书资质",
        [
            _spec("credentials.title", "title", "证书名称"),
            _spec("credentials.issuer", "issuer", "颁发机构"),
            _spec(
                "credentials.credential_number",
                "credential_number",
                "证书编号",
                llm_allowed=False,
                private=True,
            ),
        ],
        [
            _entry(
                "cr1",
                {
                    "credentials.title": "信息安全认证",
                    "credentials.issuer": "某认证中心",
                    "credentials.credential_number": SECRET,
                },
            )
        ],
    )
    custom_primary = _section(
        "custom:sec-1",
        "作品集",
        [
            _custom_spec("cf-title", "标题"),
            _custom_spec("cf-link", "链接"),
            _custom_spec("cf-internal", "内部备注", llm_allowed=False),
        ],
        [
            _entry(
                "c1",
                {
                    "cf-title": "简历生成器",
                    "cf-link": "https://example.com/demo",
                    "cf-internal": CUSTOM_SECRET,
                },
            ),
            # 显式主文本字段没值：与内置分区同口径跳过，不拿别的字段猜正文。
            _entry("c2", {"cf-link": "https://example.com/no-title"}),
        ],
        primary_field_id="cf-title",
    )
    # 没有主文本字段的自建板块（真实默认形态）：条目仍要可检索，不能被整块丢掉。
    custom_no_primary = _section(
        "custom:sec-2",
        "兴趣爱好",
        [_custom_spec("cf-name", "名称")],
        [_entry("n1", {"cf-name": "长跑"})],
    )
    # summary 是 singleton（不产生 chunk）；其它参与分区都在 SECTION_ORDER 里。
    summary = _section(
        "summary",
        "个人总结/自我评价",
        [],
        [_entry("s1", {"summary.content": "简介"})],
        form="singleton",
    )
    built = (summary, experiences, credentials, custom_primary, custom_no_primary)
    return ConsumedProfile(
        "g1", "默认组", True, SECTION_ORDER, SECTION_ORDER, 3, {s.key: s for s in built}
    )


# ===== canonical_item_hash：与下游 item 逐字一致、且只看内容 =====


def test_canonical_hash_ignores_key_order_and_json_whitespace_but_tracks_values():
    item = {"company": "甲公司", "role": "后端工程师", "description": ["a", "b"]}
    reordered = {"description": ["a", "b"], "role": "后端工程师", "company": "甲公司"}
    # 同一语义 dict 的"键序不同"不影响；从带缩进/空白的 JSON 重新解析也不影响。
    assert canonical_item_hash("experiences", item) == canonical_item_hash("experiences", reordered)
    pretty = json.loads(json.dumps(item, ensure_ascii=False, indent=2))
    assert canonical_item_hash("experiences", item) == canonical_item_hash("experiences", pretty)
    # 改任一字段值必须变；分区不同也必须变（hash 含 section_key）。
    changed = {**item, "company": "乙公司"}
    assert canonical_item_hash("experiences", item) != canonical_item_hash("experiences", changed)
    assert canonical_item_hash("experiences", item) != canonical_item_hash("projects", item)
    # 公式是与下游对齐的硬契约：手算一遍防止实现悄悄加盐/规范化。
    canonical_json = json.dumps(item, ensure_ascii=False, sort_keys=True)
    expected = hashlib.sha256(f"experiences\x1f{canonical_json}".encode()).hexdigest()
    assert canonical_item_hash("experiences", item) == expected


# ===== build_chunks：身份桥接与"主字段为空"过滤后的下标对齐 =====


def test_bridge_hashes_match_downstream_items_after_primary_field_filtering():
    consumed = _profile()
    result = build_chunks(consumed)
    downstream = build_consumed_data(consumed)["experiences"]
    # build_consumed_data 不重排、不过滤空主字段：e2 仍在 index 1。
    assert [item["company"] for item in downstream] == ["甲公司", "", "乙公司"]
    assert result.canonical_by_entry[("experiences", "e1")] == canonical_item_hash(
        "experiences", downstream[0]
    )
    assert result.canonical_by_entry[("experiences", "e3")] == canonical_item_hash(
        "experiences", downstream[2]
    )
    # 防下标错位：e3 的 hash 绝不能等于被过滤的 e2（index 1）的 hash。
    assert result.canonical_by_entry[("experiences", "e3")] != canonical_item_hash(
        "experiences", downstream[1]
    )
    assert ("experiences", "e2") not in result.canonical_by_entry
    # 桥接表双向完整且互逆。
    assert len(result.canonical_by_entry) == len(result.chunks) == len(result.entry_by_canonical)
    for pair, digest in result.canonical_by_entry.items():
        assert result.entry_by_canonical[digest] == pair
    for digest, pair in result.entry_by_canonical.items():
        assert result.canonical_by_entry[pair] == digest


# ===== 白名单、可读性与确定性 =====


def test_private_and_llm_disallowed_values_never_enter_chunks():
    result = build_chunks(_profile())
    texts = "\n".join(
        [c.display_text for c in result.chunks] + [c.normalized_text for c in result.chunks]
    )
    assert SECRET not in texts
    assert NO_LLM_MARK not in texts
    assert CUSTOM_SECRET not in texts
    credential = next(c for c in result.chunks if c.section_key == "credentials")
    assert credential.field_ids == ("credentials.title", "credentials.issuer")
    assert "证书编号" not in credential.display_text
    experience = next(c for c in result.chunks if c.entry_id == "e1")
    assert "cf-exp-note" not in experience.field_ids
    assert "内部备注" not in experience.display_text


def test_display_text_has_section_name_identity_and_stable_hashes():
    result = build_chunks(_profile())
    chunk = next(c for c in result.chunks if c.entry_id == "e1")
    assert chunk.display_text.startswith("实习/工作经历｜甲公司")
    assert "后端工程师" in chunk.display_text
    assert chunk.normalized_text == chunk.normalized_text.casefold()
    assert chunk.content_hash == hashlib.sha256(chunk.normalized_text.encode("utf-8")).hexdigest()
    assert len(chunk.canonical_item_hash) == 64
    chunk_ids = [c.chunk_id for c in result.chunks]
    assert len(set(chunk_ids)) == len(chunk_ids)


def test_custom_sections_use_policy_primary_text_and_llm_whitelist():
    result = build_chunks(_profile())
    custom = [c for c in result.chunks if c.section_key == "custom:sec-1"]
    assert [c.entry_id for c in custom] == ["c1"]
    assert custom[0].display_text.startswith("作品集｜简历生成器")
    assert "https://example.com/demo" in custom[0].display_text
    assert custom[0].field_ids == ("cf-title", "cf-link")
    no_primary = [c for c in result.chunks if c.section_key == "custom:sec-2"]
    assert [c.entry_id for c in no_primary] == ["n1"]
    assert no_primary[0].display_text.startswith("兴趣爱好")
    assert no_primary[0].field_ids == ("cf-name",)


# ===== 顺序、去重与空快照 =====


def test_chunk_order_follows_profile_order_and_two_builds_are_stable():
    result = build_chunks(_profile())
    again = build_chunks(_profile())
    assert result.chunks == again.chunks
    assert [c.display_text for c in result.chunks] == [c.display_text for c in again.chunks]
    assert dict(result.canonical_by_entry) == dict(again.canonical_by_entry)
    assert dict(result.entry_by_canonical) == dict(again.entry_by_canonical)
    assert dedupe_chunks_by_entry(result.chunks) == result.chunks
    assert [c.section_key for c in result.chunks] == [
        "experiences",
        "experiences",
        "credentials",
        "custom:sec-1",
        "custom:sec-2",
    ]
    assert [(c.entry_id, c.section_order, c.entry_order) for c in result.chunks] == [
        ("e1", 1, 0),
        ("e3", 1, 2),
        ("cr1", 2, 0),
        ("c1", 3, 0),
        ("n1", 4, 0),
    ]


def test_empty_snapshot_yields_empty_chunks_and_empty_bridges():
    result = build_chunks(ConsumedProfile("g1", "空组", False, (), (), 0, {}))
    assert result.chunks == ()
    assert dict(result.canonical_by_entry) == {}
    assert dict(result.entry_by_canonical) == {}


def test_dedupe_keeps_smallest_order_for_same_entry_and_preserves_input_order():
    chunks = build_chunks(_profile()).chunks
    # 同一 entry 的重复 chunk：更晚的排前面，也必须保留顺序更小的原 chunk。
    duplicate = replace(chunks[0], chunk_id="duplicate", entry_order=chunks[0].entry_order + 5)
    kept = dedupe_chunks_by_entry([duplicate, *chunks])
    assert [c.chunk_id for c in kept] == [c.chunk_id for c in chunks]
    assert dedupe_chunks_by_entry(()) == ()
    # 内容相同但 entry 不同 = 两条不同的事实，不去重。
    twin = replace(chunks[0], chunk_id="twin", entry_id="e-other")
    assert len(dedupe_chunks_by_entry([chunks[0], twin])) == 2
