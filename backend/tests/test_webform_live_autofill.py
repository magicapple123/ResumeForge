from app.services.webform import live_autofill
from app.services.webform.engine import ApplyOutcome, Control, FormEngine


def _control(index: int, label: str, *, value: str = "") -> Control:
    return Control(
        index=index,
        type="text",
        label=label,
        selector=f'[data-rf-index="{index}"]',
        value=value,
    )


def _run_with_controls(monkeypatch, controls, *, stop=None):
    writes = []
    monkeypatch.setattr(FormEngine, "read_controls", lambda self, _client: controls)

    def apply(_client, _snapshot, selections, *, engine):
        selections = list(selections)
        writes.extend(selections)
        return [ApplyOutcome(selection.index, selection.field, "filled") for selection in selections]

    monkeypatch.setattr(live_autofill, "apply_fill", apply)
    progress = []
    result = live_autofill.fill_current_page(
        object(),
        {"name": "张三", "phone": "13800000000"},
        on_progress=progress.append,
        should_stop=(lambda: stop(writes)) if stop is not None else None,
        delay_seconds=0,
    )
    return result, writes, progress


def test_current_page_fill_streams_each_field_and_skips_existing_values(monkeypatch):
    result, writes, progress = _run_with_controls(
        monkeypatch,
        [
            _control(0, "姓名"),
            _control(1, "手机号", value="13900000000"),
        ],
    )

    assert [(item.field, item.value) for item in writes] == [("name", "张三")]
    assert result.total == result.completed == result.filled == 1
    assert result.failed == 0
    assert result.form_control_total == 2
    assert result.recognized_total == 1
    assert [item.state for item in progress] == ["filling", "filling", "done"]
    assert progress[1].current_label == "姓名"
    assert progress[-1].message == "已完成 1/2 个表单框（成功率 50%）（识别并尝试 1 个），请回到页面核对"


def test_current_page_fill_stops_between_fields_without_losing_progress(monkeypatch):
    result, writes, progress = _run_with_controls(
        monkeypatch,
        [_control(0, "姓名"), _control(1, "手机号")],
        stop=lambda current_writes: len(current_writes) >= 1,
    )

    assert len(writes) == 2
    assert result.total == 2
    assert result.completed == result.filled == 0
    assert progress[-1].state == "cancelled"
    assert progress[-1].message == "已停止当前自动填写"


def test_current_page_fill_reports_an_empty_page_without_running_a_write(monkeypatch):
    result, writes, progress = _run_with_controls(monkeypatch, [_control(0, "未知编号")])

    assert writes == []
    assert result.total == result.completed == result.filled == result.failed == 0
    assert progress[0].state == progress[-1].state == "done"
    assert progress[0].message == "当前页面没有可自动填写的空字段"
