"""服务层编排测试：填充与「可能是这几个」候选排序。

拆分自 test_webform_service.py——apply_fill 的边界（越界索引/无选项/并发冲突/写值校验）
与 related_entries 的置顶/兜底/截断规则收在这里。
复用主文件的 FakeCdpClient / _snapshot。
"""
import pytest
from app.services.webform._base import WebFormBadRequest, WebFormConflict
from app.services.webform.engine import Control
from app.services.webform.service import (
    RELATED_LIMIT,
    FillSelection,
    apply_fill,
    is_filling,
    recognize_field,
    related_entries,
)
from test_webform_service import FakeCdpClient, _snapshot

# ===== 填充 =====


def test_fill_refuses_an_index_that_is_not_in_the_snapshot():
    """前端的预览与后端这份快照对不上时，继续写就是往未知的框里填值。"""
    snapshot = _snapshot(
        [{"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'}]
    )

    with pytest.raises(WebFormBadRequest):
        apply_fill(FakeCdpClient(), snapshot, [FillSelection(index=7, field="name", value="张三")])


def test_fill_skips_a_value_the_page_has_no_option_for():
    """联动下拉换了内容时，值可能已经对不上——跳过并如实说明，不硬填。"""
    snapshot = _snapshot(
        [
            {
                "index": 0,
                "type": "select",
                "label": "城市",
                "options": [{"v": "", "t": "请选择", "d": False}],
                "selector": '[data-rf-index="0"]',
            }
        ]
    )
    fake = FakeCdpClient()

    outcomes = apply_fill(fake, snapshot, [FillSelection(index=0, field="city", value="北京")])

    assert outcomes == []
    assert not fake.expressions, "不该往页面里写任何东西"


def test_fill_reports_a_conflict_when_another_fill_is_running():
    """两个填充请求交错会往同一个页面里写两套值。"""
    snapshot = _snapshot(
        [{"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'}]
    )
    fake = FakeCdpClient(replies={"rf:read-back": '{"ok": true, "value": "张三"}'})

    import app.services.webform.service as service_module

    assert service_module._fill_lock.acquire(blocking=False)
    try:
        assert is_filling() is True
        with pytest.raises(WebFormConflict):
            apply_fill(fake, snapshot, [FillSelection(index=0, field="name", value="张三")])
    finally:
        service_module._fill_lock.release()
    assert is_filling() is False


def test_a_value_reverted_after_the_fill_is_downgraded():
    """写入后组件把值还原了：收尾复读把 filled 降级为未验证。

    2026-10-05 字节页实测：意向城市框当场回读有值（filled），几秒后组件自己重渲染
    把值清空——用户看到"填好了"，其实没有。整页填充收尾复读一次，如实降级。
    """
    from webform_engine_support import ScriptedCdpClient

    snapshot = _snapshot(
        [{"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'}]
    )
    client = ScriptedCdpClient(
        [
            {"needle": "rf:set-value", "reply": '{"ok": true, "value": "张示例"}'},
            {"needle": "rf:read-back", "reply": '{"ok": true, "value": "张示例", "checked": false}'},
            {"needle": "rf:read-back", "reply": '{"ok": true, "value": "", "checked": false}'},
        ]
    )

    outcomes = apply_fill(
        client,
        snapshot,
        [FillSelection(index=0, field="name", value="张示例")],
        settle_recheck=0.0,
    )

    assert [outcome.status for outcome in outcomes] == ["unverified"]
    assert "还原" in outcomes[0].detail
    client.assert_finished()


def test_fill_writes_and_verifies():
    snapshot = _snapshot(
        [{"index": 0, "type": "text", "label": "姓名", "selector": '[data-rf-index="0"]'}]
    )
    fake = FakeCdpClient(replies={"rf:read-back": '{"ok": true, "value": "张三"}'})

    outcomes = apply_fill(fake, snapshot, [FillSelection(index=0, field="name", value="张三")])

    assert [outcome.status for outcome in outcomes] == ["filled"]


def test_laboratory_and_paper_are_recognized_on_the_tight_cluster_page():
    """「实验室」「论文」现在是目录字段了——它们**不再被邻居的「研究方向」抢走**。

    2026-09-27 加。这两个框原本不在目录里，于是占位符（"请输入实验室"）指明了字段却查无
    此项 → 按 ``evidence_key`` 的规则**如实报"认不出"**。那是当时刻意的（借来的字段名用户
    一眼看得出是错的），但也意味着研究生简历页最常见的两栏永远填不了。

    加进目录后它们走与内置字段完全相同的匹配路径，证据强度是**档位 2（占位符）**——
    比旁文高两级，所以哪怕四个框的旁文搅在一起也不会互抢。

    钉住它是因为**退回原样的方式很隐蔽**：把这两行同义词删掉，其余测试全绿，
    只有真机上「实验室」又会变成"认不出"。
    """
    # 真机快照的形状：四个框的旁文都把四个标签装了进去（见 engine.evidence_key 的注释）。
    nearby = "0/1000 0/1000 论文 0/1000 导师 * 实验室 研究方向 论文 0/1000"

    cases = {
        "请输入导师": "advisor",
        "请输入实验室": "laboratory",
        "请输入研究方向": "research_direction",
        "请输入已发表论文": "paper",
    }
    for placeholder, expected in cases.items():
        got = recognize_field(
            Control(index=0, type="text", placeholder=placeholder, nearby_text=nearby)
        )
        assert got == expected, f"{placeholder!r} 认成了 {got!r}（应是 {expected!r}）"


# ===== 「可能是这几个」：按当前框的文字置顶 =====
#
# 清单几十条、面板只露得下八九行，而"用户此刻点在哪个框"本身就是个强信号。
# 判据复用 `engine.evidence_key` 与同一份同义词表——不另写一套文本相似度（这个仓库吃过
# "两份匹配实现各自分叉"的亏）。**它只排顺序、不做取舍**：没进前几名的条目仍然在下面的
# 完整清单里，所以判错一条的代价只是"多看一眼"。

RELATED_CATALOG = [
    {"group": "身份信息", "label": "姓名", "value": "林知夏", "key": "name"},
    {"group": "身份信息", "label": "政治面貌", "value": "共青团员", "key": "political_status"},
    {"group": "联系方式", "label": "当前所处地", "value": "天津", "key": "city"},
    {"group": "联系方式", "label": "期望工作地点", "value": "杭州", "key": "target_city"},
    {"group": "教育经历 1", "label": "学校", "value": "天津工业大学", "key": "school"},
    {"group": "实习/工作 1", "label": "工作内容", "value": "负责增长看板", "key": "description"},
]


def test_related_entries_rank_by_the_current_control():
    """按**当前这个框**的文字挑：占位符写着"请输入学校名称"，学校就该排第一。"""
    control = Control(index=0, type="text", placeholder="请输入学校名称", nearby_text="教育经历 1")

    picked = related_entries(control, RELATED_CATALOG)

    assert picked, "一条都没挑出来"
    assert picked[0]["label"] == "学校"
    assert picked[0]["value"] == "天津工业大学"


def test_related_entries_fall_back_to_the_label_when_there_are_no_synonyms():
    """子表里有几个字段**没有同义词表**（工作内容、项目描述、担任角色…）。

    它们退回按标签本身比——只认"控件的文字里明确出现了这个标签"，不做模糊。这条钉住
    那条兜底：没有它，"工作内容"这类永远进不了推荐。
    """
    control = Control(index=0, type="text", label="工作内容", nearby_text="实习经历 工作内容")

    picked = related_entries(control, RELATED_CATALOG)

    assert [item["label"] for item in picked] == ["工作内容"]


def test_related_entries_say_nothing_when_the_control_says_nothing():
    """"验证码"这种框和清单里任何一条都不沾边——返回空，界面那边就整块不显示。"""
    control = Control(index=0, type="text", label="验证码", nearby_text="短信验证码")

    assert related_entries(control, RELATED_CATALOG) == []


def test_related_entries_skip_entries_with_no_value():
    """没有值的条目本来就不该出现在清单里（列一条点不动的行没意义），这里同样跳过。"""
    control = Control(index=0, type="text", placeholder="请输入学校名称", nearby_text="教育经历 1")
    catalog = [*RELATED_CATALOG, {"group": "教育经历 1", "label": "学校", "value": "", "key": "school"}]

    picked = related_entries(control, catalog)

    assert [item["value"] for item in picked] == ["天津工业大学"]


def test_related_entries_respect_the_limit():
    """推荐栏是"一眼扫完"用的，不能又变成一屏。"""
    control = Control(index=0, type="text", label="姓名", nearby_text="姓名 性别 政治面貌")
    catalog = [
        {"group": "身份信息", "label": f"字段{i}", "value": f"值{i}", "key": "name"}
        for i in range(9)
    ]

    assert len(related_entries(control, catalog)) == RELATED_LIMIT
    assert len(related_entries(control, catalog, limit=2)) == 2
