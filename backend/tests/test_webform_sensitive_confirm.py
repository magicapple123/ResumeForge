"""敏感字段强制确认（RF-19）：SENSITIVE_FIELD_KEYS 从"仅展示"接线为预览行为。

红线：命中敏感目录的字段，规则命中了也**默认不勾**（needs_confirm），与放宽模式的
同意/声明确认同一交互形态——写不写由用户逐行决定。AI 建议行本就默认不勾（enrichment
在 build_preview 之后追加），不在本守卫范围。
"""
from app.services.webform.engine import FormEngine
from app.services.webform.service.models import default_selections
from app.services.webform.service.preview import build_preview
from app.services.webform.session import Snapshot

RAW_CONTROLS = [
    {"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'},
    {"index": 1, "type": "text", "label": "证件号码", "selector": '[data-rf-index="1"]'},
    {"index": 2, "type": "text", "label": "身高(cm)", "selector": '[data-rf-index="2"]'},
    # 敏感字段 + 页面已有值：冲突文案（保留页面现值）比 needs_confirm 更保守，保持冲突。
    {
        "index": 3,
        "type": "text",
        "label": "家庭住址",
        "value": "示例市示例区示例路 1 号",
        "selector": '[data-rf-index="3"]',
    },
]

PROFILE = {
    "name": "张示例",
    "id_number": "EXAMPLE-ID-0001",
    "height": "175",
    "home_address": "示例市另一区示例路 2 号",
}


def _report():
    snapshot = Snapshot(id="snap", controls=FormEngine().snapshot_controls(RAW_CONTROLS))
    return build_preview(snapshot, PROFILE)


def test_sensitive_rows_are_forced_to_needs_confirm():
    report = _report()
    by_index = {item.index: item for item in report.items}

    assert by_index[0].status == "ready", "非敏感字段行为不变"
    assert by_index[1].status == "needs_confirm"
    assert by_index[2].status == "needs_confirm"


def test_sensitive_conflict_rows_keep_the_conflict_status():
    """页面已有值的敏感行保持 conflict（默认不勾 + 保留现值文案），不被降级改写。"""
    report = _report()
    by_index = {item.index: item for item in report.items}

    assert by_index[3].status == "conflict"
    assert "默认保留它" in by_index[3].note


def test_sensitive_rows_are_not_selected_by_default():
    report = _report()
    defaults = {selection.index for selection in default_selections(report)}

    assert defaults == {0}, f"敏感行必须显式确认后才默认勾选，实际默认：{defaults}"
