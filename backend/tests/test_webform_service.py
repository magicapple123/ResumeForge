"""服务层编排测试：读快照 → 预览 → 填充三段，以及它们之间的边界。"""
import pytest
from app.services.browser.cdp_client import CdpClient
from app.services.webform._base import WebFormNotFound
from app.services.webform.engine import Control, FormEngine
from app.services.webform.service import (
    STATUS_CONFLICT,
    STATUS_READY,
    build_preview,
    default_selections,
    read_snapshot,
    recognize_field,
)
from app.services.webform.session import Snapshot, SnapshotStore


class FakeCdpClient(CdpClient):
    def __init__(self, evaluate_result=None, replies=None):
        self.evaluate_result = evaluate_result
        self.replies = dict(replies or {})
        self.expressions: list[str] = []

    def list_targets(self):
        return []

    def new_tab(self, url="about:blank"):
        return "TAB"

    def send(self, method, params=None, *, timeout=None):
        return {}

    def evaluate(self, expression, *, timeout=None):
        self.expressions.append(expression)
        for needle, value in self.replies.items():
            if needle in expression:
                return value
        return self.evaluate_result

    def set_file_input(self, selector, files, *, timeout=None):
        pass

    def close(self):
        pass


def _snapshot(raw: list[dict]) -> Snapshot:
    return Snapshot(id="snap", controls=FormEngine().snapshot_controls(raw))


# ===== 读取快照 =====

SNAPSHOT_PAYLOAD = (
    '{"url": "https://example.com/apply", "title": "网申",'
    ' "controls": [{"index": 0, "type": "text", "label": "姓名", "selector": "[data-rf-index=\\"0\\"]"}]}'
)


def test_read_snapshot_stores_controls_and_reports_the_page():
    store = SnapshotStore()
    # 两个脚本都含 "location.href"，所以按各自的标记注释分派，不能按那条子串。
    client = FakeCdpClient(
        replies={
            "rf:page-info": {"url": "https://example.com/apply", "title": "网申"},
            "rf:form-controls": SNAPSHOT_PAYLOAD,
        }
    )

    snapshot, page = read_snapshot(client, store=store)

    assert page["url"] == "https://example.com/apply"
    assert page["control_count"] == 1
    assert store.get(snapshot.id).controls[0].label == "姓名"


def test_an_expired_snapshot_is_reported_as_gone():
    store = SnapshotStore()
    snapshot = store.save([])

    # 直接把它做旧，而不是等 900 秒。
    snapshot.created_at -= 10_000

    with pytest.raises(WebFormNotFound):
        store.get(snapshot.id)


def test_the_store_keeps_only_the_most_recent_snapshots():
    from app.services.webform.session import MAX_SNAPSHOTS

    store = SnapshotStore()
    saved = [store.save([]) for _ in range(MAX_SNAPSHOTS + 3)]

    with pytest.raises(WebFormNotFound):
        store.get(saved[0].id)
    assert store.get(saved[-1].id) is not None


# ===== 预览 =====


def test_preview_marks_a_clean_mapping_as_ready():
    snapshot = _snapshot(
        [{"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'}]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert [(item.field, item.status) for item in report.items] == [("name", STATUS_READY)]


def test_preview_flags_a_conflict_and_leaves_it_unchecked():
    """页面上的值可能是用户上一轮填了一半的草稿——覆盖它是用户看不见的破坏。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "label": "手机号",
                "value": "13900000000",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"phone": "13800000000"})

    assert report.items[0].status == STATUS_CONFLICT
    assert report.items[0].current_value == "13900000000"
    assert default_selections(report) == []


def test_the_same_value_on_the_page_is_not_a_conflict():
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "label": "姓名",
                "value": "张三",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert report.items[0].status == STATUS_READY
    assert len(default_selections(report)) == 1


def test_preview_separates_missing_data_from_unrecognized():
    """认得出字段 → 用户知道去资料里补什么；认不出 → 只能如实说没认出来。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "label": "手机号",
                "required": True,
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "label": "某某编号",
                "required": True,
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert [(item.index, item.field) for item in report.missing_data] == [(0, "phone")]
    assert [item.index for item in report.unrecognized] == [1]


def test_relative_fields_are_blocked_not_reported_as_missing_data():
    """「请输入您父亲的姓名」不是"你资料里没填姓名"——那是**别人**的信息。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "nearby_text": "请输入您父亲的姓名",
                "required": True,
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert report.missing_data == []
    assert report.unrecognized == []
    assert len(report.blocked) == 1
    assert "别人" in report.blocked[0].field_label


def test_checkboxes_are_reported_as_click_only_not_unrecognized():
    """勾选项一律不自动填（"只填不点"），如实列进「需要你自己点选」。

    归到「没认出来」是错的——那个措辞会让人以为程序没看懂，其实是刻意不碰。
    """
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "checkbox",
                "label": "接受其他职位调剂",
                "nearby_text": "接受其他职位调剂",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert report.unrecognized == []
    assert len(report.blocked) == 1
    assert "点选" in report.blocked[0].field_label


def test_a_factual_radio_is_click_only_and_never_filled():
    """**连"事实类"的单选也不自动填**——2026-10-05 维护者把边界收成了"只填不点"。

    性别是这里最典型的：它是个事实，不是表态；但它是**你的选择**，工具不代选，也不
    代点。这条与下面几条一起看才是完整的规则——**分界不在"它是不是在替你表态"，
    而在"它的值是不是点出来的"**。（旧边界是反的：事实类单选照填，只挡表态类。）
    """
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "radio",
                "name": "g",
                "value": "男",
                "label": "男",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "radio",
                "name": "g",
                "value": "女",
                "label": "女",
                "nearby_text": "性别* 男 女",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    report = build_preview(snapshot, {"gender": "女"})

    assert report.items == []
    # 同组两个都列出来：用户看到的不是"男也没认出来"，而是"这一组要你自己点"。
    assert [item.index for item in report.blocked] == [0, 1]
    assert all("点选" in item.field_label for item in report.blocked)


def test_consent_checkboxes_are_blocked_with_their_own_reason():
    """同意项：代勾等于替你做出法律意义上的同意，永不代勾——**并说清是哪一条**。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "checkbox",
                "label": "我已阅读并同意隐私政策",
                "nearby_text": "我已阅读并同意隐私政策",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {})

    assert report.items == []
    assert report.unrecognized == []
    assert len(report.blocked) == 1
    # 措辞取自命中的那个提示词（这里是「我已阅读」），所以断言"确认项 / 本人勾选"这两段，
    # 而不是钉死某一个词——`CONSENT_HINTS` 里加词不该让这条测试变红。
    assert "确认项" in report.blocked[0].field_label, report.blocked[0].field_label
    assert "本人勾选" in report.blocked[0].field_label, report.blocked[0].field_label


def test_claim_checkboxes_are_blocked_too():
    """声明项：勾上等于替你**陈述事实**（"我没有这段经历"），与表态同性质。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "checkbox",
                "label": "无实习经历",
                "nearby_text": "无实习经历",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {})

    assert report.items == []
    assert len(report.blocked) == 1
    assert "声明类" in report.blocked[0].field_label, report.blocked[0].field_label


def test_an_unmatched_intent_checkbox_is_your_call_not_unrecognized():
    """没有对应字段的表态勾选（如"服从调剂"）走的是"未匹配"那条路，也不代填。

    它与上面两条的区别在**判据来源**：同意/声明项由 `skip_reason` 在匹配前就拦下
    （所以带的是各自的理由），而"服从调剂"目录里根本没有对应字段，是**匹配不上**。
    两者对用户的结论一样——自己判断——所以措辞也该一致，不能归到「没认出来」。
    """
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "checkbox",
                "name": "adjust",
                "value": "1",
                "label": "服从调剂",
                "nearby_text": "是否服从调剂",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"gender": "女"})

    assert report.items == []
    assert report.unrecognized == []
    assert len(report.blocked) == 1
    assert "点选" in report.blocked[0].field_label



def test_a_bare_请选择_control_is_reported_as_a_dropdown_not_unrecognized():
    """框架渲染的自定义下拉长得就是个空 input，按普通输入框填不进去——如实说明比说
    "没认出来"有用。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请选择",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert report.unrecognized == []
    assert "下拉选择框" in report.blocked[0].field_label


def test_a_control_with_no_own_text_is_not_mistaken_for_a_dropdown():
    """**回归守卫**：自述文本为空只说明标签在别处（比如相邻文字里），不等于它是下拉框。

    早先写成"自述为空也算下拉"，把「请输入您父亲的姓名」误判成了下拉。
    """
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "nearby_text": "请输入您父亲的姓名",
                "required": True,
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"name": "张三"})

    assert len(report.blocked) == 1
    assert "别人" in report.blocked[0].field_label, "该走「他人信息」那条判据"


def test_a_select_is_reported_as_click_only_not_as_a_fillable_row():
    """下拉没有"将填入"的行：值该由你在页面上点选。

    这里曾经反过来——预览把选项摊出来让用户改挑一个，工具照着写进去。2026-10-05
    的「只填不点」把那条路也收了：**连"重新挑一个选项"都不代劳**。
    """
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "select",
                "label": "性别",
                "options": [
                    {"v": "", "t": "请选择", "d": False},
                    {"v": "1", "t": "男", "d": False},
                    {"v": "2", "t": "女", "d": False},
                ],
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    report = build_preview(snapshot, {"gender": "女"})

    assert report.items == []
    assert [item.index for item in report.blocked] == [0]
    assert "点选" in report.blocked[0].field_label


def test_a_partial_date_is_written_in_the_pages_shape_without_inventing_a_day():
    """资料里只有年月（"2026.06"）、页面提示要 ``YYYY-MM-DD``：**不编造日**，就写 2026-06。

    「缺日补 1 号」只发生在页面**明确要完整日期**的时候（见
    ``test_webform_matching.py`` 的 assumed_day 用例）——原生 ``<input type="date">``
    曾经走那条路，现在它属于「只填不点」的日期控件，不再自动填。文本框按页面提示的
    形状写，缺的部分宁可空着。
    """
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "text",
                "label": "毕业时间",
                "placeholder": "YYYY-MM-DD",
                "selector": '[data-rf-index="0"]',
            }
        ]
    )

    item = build_preview(snapshot, {"education_end": "2026.06"}).items[0]

    assert item.value == "2026-06"
    assert item.note == ""


def test_recognize_field_ignores_controls_with_no_text():
    assert recognize_field(Control(index=0)) is None


def test_a_control_own_label_beats_a_neighbour_mentioned_in_the_nearby_text():
    """自己写的标签赢过旁边提到的——否则「导师」会被邻居的「研究方向」抢走。

    真实表单（腾讯校招简历页）里「导师 / 实验室 / 研究方向」三个框紧挨着，采集到的
    ``nearby_text`` 会把三个标签都装进彼此的签名。先前 ``recognize_field`` 只比"签名里
    最长的那个同义词"，于是 4 字的「研究方向」压过 2 字的「导师」。

    **这条不只是显示错**：调用方看到"认得出"就写"去资料里补一下"并直接返回，
    **不再把控件交给 AI 兜底**——认错字段反而把 AI 挡在了门外。
    """
    context = "导师 * 请输入导师 实验室 请输入实验室 研究方向 请输入研究方向"

    advisor = recognize_field(
        Control(index=0, type="text", label="导师", placeholder="请输入导师", nearby_text=context)
    )
    direction = recognize_field(
        Control(
            index=1,
            type="text",
            label="研究方向",
            placeholder="请输入研究方向",
            nearby_text=context,
        )
    )

    # 两个框必须各归各位：修好一个不能把另一个弄坏。
    assert advisor == "advisor"
    assert direction == "research_direction"


