"""QA 独立验证：第二道防线（``_is_within`` 检查）在真实运行器路径上的"牙齿"。

拆分自 test_sample_recorder_runner_qa.py——用 key 越界的适配器与反斜杠穿越的
site_key，证明"join 结果落到 captures 之外 → 拒写、只记 warning、任务照常完成"。
"""
from __future__ import annotations

import logging
from pathlib import Path

from app.models.apply import ApplyTask
from app.schemas.apply import ApplyConfigIn
from app.services.apply import apply_service

# 复用主文件的 runner 台架与录制适配器（单向导入，避免循环）。
from test_sample_recorder_runner_qa import (
    SEARCH_URL,
    _NetworkFakeCdp,
    _RecordingAdapter,
    _collect_task,
    _patch_captures,
    _runner,
    _saved_json_files,
    _wait,
)


# ===== 八、B 的 runner 级牙齿：join 结果越界 → 拒写、任务照常完成 =====


class _EscapingKeyAdapter(_RecordingAdapter):
    """``key`` 含 ``..``：模拟"join 出来的目录落到 captures 之外"这一 B 要挡住的场景。

    ``adapter.key`` 本是代码常量；这里刻意让它越界，用来**单独**验证第二道防线——即使
    A 的拼法本身产出了越界目录，B 也必须拦住落盘。把 B 整段删掉、A 保持不变时，本用例会红
    （样例会写进 captures 之外）。
    """

    key = "../escaped"


def test_guard_blocks_an_escaping_target_dir_and_keeps_the_task_healthy(
    db_session, tmp_path, monkeypatch, caplog
):
    """B（``_is_within`` 检查）**单独**也有牙。

    构造一个 key 含 ``..`` 的适配器，让 ``captures_root / adapter.key`` 落到 captures 之外：
    - 有 B → 不安装装饰器、不写任何文件、只记一条 warning，采集照常 ``completed``；
    - 删掉 B（A 不变）→ 样例会写进 captures 之外 → 下面的 ``_saved_json_files(tmp_path) == []``
      与 ``"saved_samples" not in ...`` 立刻变红。

    这样 A、B 两道防线各有各的用例钉住，消除"C 只测到 A、B 被删了也不红"的盲区。
    """
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)
    task = _collect_task(db_session, save_site_samples=True)
    # 注册表里只放这个 key 越界的适配器 → _collect_adapter 无论站点配置如何都会选中它。
    runner = _runner(
        _EscapingKeyAdapter(url=SEARCH_URL),
        lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}),
    )

    with caplog.at_level(logging.WARNING):
        runner.start(task.id)
        _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)

    # 越界只跳过保存，绝不影响采集本身：任务正常完成。
    assert stored.status == "completed"
    # recorder 未被安装 → 不写账目（与"关掉开关就不留痕迹"一致）。
    assert "saved_samples" not in stored.config
    # 关键断言：captures 之内、之外都不得出现任何样例 json。
    assert _saved_json_files(target) == []
    assert _saved_json_files(tmp_path) == []
    # 且必须留下可检索的 warning（不是静默丢弃）。
    assert any("不在 captures 之内" in record.message for record in caplog.records)


def test_backslash_traversal_site_key_cannot_write_outside_captures(
    db_session, tmp_path, monkeypatch
):
    """独立复现（B 侧的第二形态）：``site_key`` 用 **Windows 反斜杠**写法做上跳，同样写不出去。

    与 C 互补：C 用的是 ``../browser-profile``（正斜杠），这里用 ``..\\..\\browser-profile``，
    覆盖"用户输入在 Windows 上以反斜杠表达穿越"这一形态。断言口径与 C 相同——样本只落在
    ``captures/<adapter.key>``，captures 之外一份都没有。
    """
    target = tmp_path / "captures"
    _patch_captures(monkeypatch, target)
    apply_service.save_apply_config(db_session, ApplyConfigIn(site_key="..\\..\\browser-profile"))

    task = _collect_task(db_session, save_site_samples=True)
    runner = _runner(
        _RecordingAdapter(url=SEARCH_URL),
        lambda _c: _NetworkFakeCdp(SEARCH_URL, {"ok": 1}),
    )

    runner.start(task.id)
    _wait(runner)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "completed"
    assert Path(stored.config["samples_dir"]) == target / "boss"
    assert len(_saved_json_files(target / "boss")) == 1
    # captures 之外（这个畸形 site_key 指向的落点）一份都没有。
    assert _saved_json_files(tmp_path / "browser-profile") == []
    assert _saved_json_files(target.parent) == _saved_json_files(target)
