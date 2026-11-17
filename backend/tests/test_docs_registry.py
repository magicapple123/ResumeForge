"""``scripts/check_docs_registry.py`` 的反证：每条规则都必须能精确报红。

为什么单独立一条：``docs/verification-playbook.md`` §3.2 要求"新增守卫必须反证，否则无法排除
正则/路径失效→恒绿"。文档类守卫尤其危险——它检查的是**文件与日期**，写错一个比较方向就会
永远通过，而人不会去读它的实现。

这里覆盖三类：
1. 结构（覆盖、孤儿、重复、状态、路径）；
2. 时效（复核窗口、处置截止、日期格式）；
3. 生成（索引确定性、过期检测、漂移提醒）。
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_docs_registry.py"
TODAY = dt.date(2026, 11, 17)


def _load_module():
    spec = importlib.util.spec_from_file_location("check_docs_registry", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


guards = _load_module()


# ------------------------------------------------------------------ 夹具


def _doc(root: Path, rel: str, *, banner: str | None = None, body: str = "") -> str:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# 标题", ""]
    if banner:
        lines += [banner, ""]
    lines.append(body or "正文")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return rel


def _entry(rel: str, **overrides) -> dict:
    entry = {
        "path": rel,
        "title": "标题",
        "status": "current",
        "note": "测试用",
        "tier": "A",
        "last_reviewed": TODAY.isoformat(),
    }
    entry.update(overrides)
    return entry


def _registry(*entries: dict, archived: list[dict] | None = None) -> dict:
    return {
        "schema_version": 1,
        "tier_days": {"A": 90, "B": 180},
        "docs": list(entries),
        "archived": archived or [],
    }


def _messages(problems) -> str:
    return "\n".join(str(p) for p in problems)


# ------------------------------------------------------------------ 结构


def test_clean_fixture_passes(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    assert guards.validate(tmp_path, _registry(_entry(rel)), TODAY) == []


def test_unregistered_doc_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    _doc(tmp_path, "docs/b.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel)), TODAY)
    assert "docs/b.md" in _messages(problems) and "没有登记" in _messages(problems)


def test_ghost_entry_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel), _entry("docs/gone.md")), TODAY)
    assert "docs/gone.md" in _messages(problems) and "不存在" in _messages(problems)


def test_duplicate_entry_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel), _entry(rel)), TODAY)
    assert "重复登记" in _messages(problems)


def test_bad_status_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel, status="live")), TODAY)
    assert "status" in _messages(problems)


def test_pair_must_exist(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel, pairs=["backend/app/"])), TODAY)
    assert "pairs 指向的路径不存在" in _messages(problems)


def test_pair_must_be_relative(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel, pairs=["D:/ResumeForge"])), TODAY)
    assert "仓库相对路径" in _messages(problems)


def test_verify_path_must_exist(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel, verify=["scripts/nope.py"])), TODAY)
    assert "verify 指向的脚本不存在" in _messages(problems)


# ------------------------------------------------------------------ 时效


def test_current_doc_past_window_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    stale = (TODAY - dt.timedelta(days=91)).isoformat()
    problems = guards.validate(tmp_path, _registry(_entry(rel, last_reviewed=stale)), TODAY)
    assert "复核窗口" in _messages(problems)


def test_current_doc_inside_window_passes(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    fresh = (TODAY - dt.timedelta(days=89)).isoformat()
    assert guards.validate(tmp_path, _registry(_entry(rel, last_reviewed=fresh)), TODAY) == []


def test_tier_window_differs(tmp_path):
    """同一天复核，B 档还没到期、A 档已经到期——证明窗口真的按 tier 取。"""
    rel = _doc(tmp_path, "docs/a.md")
    old = (TODAY - dt.timedelta(days=120)).isoformat()
    assert (
        guards.validate(tmp_path, _registry(_entry(rel, last_reviewed=old, tier="B")), TODAY) == []
    )
    assert (
        guards.validate(tmp_path, _registry(_entry(rel, last_reviewed=old, tier="A")), TODAY) != []
    )


def test_future_review_date_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel, last_reviewed="2027-01-01")), TODAY)
    assert "在未来" in _messages(problems)


def test_bad_date_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    problems = guards.validate(tmp_path, _registry(_entry(rel, last_reviewed="2026/11/17")), TODAY)
    assert "日期格式不合法" in _messages(problems)


def test_historical_must_have_banner(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    entry = _entry(rel, status="historical", retire_by="2027-06-30")
    entry.pop("tier")
    entry.pop("last_reviewed")
    problems = guards.validate(tmp_path, _registry(entry), TODAY)
    assert "历史" in _messages(problems) and "横幅" in _messages(problems)


def test_historical_with_banner_passes(tmp_path):
    rel = _doc(tmp_path, "docs/a.md", banner="> **历史文档（2026-10）**：旧方案")
    problems = guards.validate(
        tmp_path, _registry(_entry(rel, status="historical", retire_by="2027-06-30")), TODAY
    )
    assert problems == []


def test_historical_past_retire_date_is_reported(tmp_path):
    rel = _doc(tmp_path, "docs/a.md", banner="> **历史文档**：旧方案")
    entry = _entry(rel, status="historical", retire_by="2026-01-01")
    problems = guards.validate(tmp_path, _registry(entry), TODAY)
    assert "处置截止日" in _messages(problems)


def test_current_with_banner_is_reported(tmp_path):
    """反向：现役文档挂着历史横幅，说明状态标错了。"""
    rel = _doc(tmp_path, "docs/a.md", banner="> **历史文档**：其实已经过期")
    problems = guards.validate(tmp_path, _registry(_entry(rel)), TODAY)
    assert "状态标错了" in _messages(problems)


def test_record_needs_no_dates(tmp_path):
    rel = _doc(tmp_path, "docs/a.md", banner="> **历史文档**：ADR 也常这么写")
    entry = {"path": rel, "title": "标题", "status": "record", "note": "决策记录"}
    assert guards.validate(tmp_path, _registry(entry), TODAY) == []


# ------------------------------------------------------------------ 归档台账


def test_archived_must_live_in_archive_dir(tmp_path):
    _doc(tmp_path, "docs-archive/old.md", banner="> **历史文档**：已归档")
    entry = _entry("docs/a.md")
    _doc(tmp_path, "docs/a.md")
    problems = guards.validate(
        tmp_path,
        _registry(entry, archived=[{"path": "docs/old.md", "reason": "重复"}]),
        TODAY,
    )
    assert "docs-archive/" in _messages(problems)


def test_archived_needs_reason(tmp_path):
    rel = _doc(tmp_path, "docs-archive/old.md", banner="> **历史文档**：已归档")
    _doc(tmp_path, "docs/a.md")
    problems = guards.validate(
        tmp_path,
        _registry(_entry("docs/a.md"), archived=[{"path": rel}]),
        TODAY,
    )
    assert "归档原因" in _messages(problems)


def test_archived_entry_must_exist(tmp_path):
    _doc(tmp_path, "docs/a.md")
    problems = guards.validate(
        tmp_path,
        _registry(_entry("docs/a.md"), archived=[{"path": "docs-archive/gone.md", "reason": "x"}]),
        TODAY,
    )
    assert "磁盘上找不到" in _messages(problems)


# ------------------------------------------------------------------ 配置与索引


def test_bad_schema_version_raises(tmp_path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "doc-registry.json").write_text(
        json.dumps({"schema_version": 99, "docs": []}), encoding="utf-8"
    )
    with pytest.raises(guards.ConfigError):
        guards.load_registry(tmp_path)


def test_index_is_deterministic_and_lists_all_three_groups(tmp_path):
    cur = _doc(tmp_path, "docs/cur.md")
    his = _doc(tmp_path, "docs/his.md", banner="> **历史文档**：旧")
    rec = _doc(tmp_path, "docs/rec.md")
    data = _registry(
        _entry(cur),
        _entry(his, status="historical", retire_by="2027-06-30"),
        {"path": rec, "title": "记录", "status": "record", "note": "快照"},
    )
    first = guards.render_index(data, TODAY)
    assert first == guards.render_index(data, TODAY)
    assert guards.INDEX_SENTINEL in first
    for rel in (cur, his, rec):
        assert f"]({Path(rel).relative_to('docs').as_posix()})" in first
    assert "现役文档" in first and "历史文档" in first and "不可变记录" in first


def test_check_index_detects_hand_edit(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    data = _registry(_entry(rel))
    (tmp_path / "docs" / "README.md").write_text("手写的索引\n", encoding="utf-8")
    problems = guards._check_index(tmp_path, data, TODAY)
    assert "索引不是最新" in _messages(problems)


def test_check_index_passes_after_write(tmp_path):
    rel = _doc(tmp_path, "docs/a.md")
    data = _registry(_entry(rel))
    (tmp_path / "docs" / "README.md").write_text(guards.render_index(data, TODAY), encoding="utf-8")
    assert guards._check_index(tmp_path, data, TODAY) == []


# ------------------------------------------------------------------ 漂移


def test_drift_names_the_doc_covering_changed_code(tmp_path, monkeypatch):
    rel = _doc(tmp_path, "docs/a.md")
    data = _registry(_entry(rel, pairs=["backend/app/services/"]))
    monkeypatch.setattr(guards, "changed_files", lambda root, ref: ["backend/app/services/x.py"])
    hits = guards.drift(data, tmp_path, None)
    assert len(hits) == 1 and rel in hits[0] and "backend/app/services/x.py" in hits[0]


def test_drift_is_silent_when_doc_also_changed(tmp_path, monkeypatch):
    rel = _doc(tmp_path, "docs/a.md")
    data = _registry(_entry(rel, pairs=["backend/app/services/"]))
    monkeypatch.setattr(
        guards, "changed_files", lambda root, ref: ["backend/app/services/x.py", rel]
    )
    assert guards.drift(data, tmp_path, None) == []


def test_drift_ignores_historical_docs(tmp_path, monkeypatch):
    rel = _doc(tmp_path, "docs/a.md", banner="> **历史文档**：旧")
    data = _registry(
        _entry(rel, status="historical", retire_by="2027-06-30", pairs=["backend/app/services/"])
    )
    monkeypatch.setattr(guards, "changed_files", lambda root, ref: ["backend/app/services/x.py"])
    assert guards.drift(data, tmp_path, None) == []


# ------------------------------------------------------------------ 真仓库


def test_repository_registry_is_clean():
    """真仓库当前必须干净；过期时这条会红，并指名是哪一篇。"""
    data = guards.load_registry(guards.ROOT)
    problems = guards.validate(guards.ROOT, data, TODAY)
    problems += guards._check_index(guards.ROOT, data, TODAY)
    assert problems == [], _messages(problems)
