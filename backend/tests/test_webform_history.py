"""网申填充记录：落一条、回看、软删、进回收站。

用户需求原话是"每次填写之后能留下记录，方便用户回看"，且明确要求**能删、进回收站**。
记录里含用户填进页面的真实值（手机号、证件号），所以删除能力是隐私上的必要项，不是便利。

守卫重点：

1. 落库的形状收窄——**不存 ``PreviewItem`` 的原样 ``__dict__``**（会连带存下拉项等无关内容）；
2. 三个计数与 ``items`` 必须一致（都由服务层现算，不靠调用方各算一份）；
3. 软删后列表看不到、回收站看得到、能恢复。
"""
import pytest

from app.models.web_form_record import SOURCE_BATCH, SOURCE_LIVE, WebFormFillRecord
from app.services import trash
from app.services.webform import history


@pytest.fixture
def sample_items():
    return [
        {
            "index": 0,
            "field": "name",
            "field_label": "姓名",
            "control_label": "请输入姓名",
            "value": "张三",
            "status": "filled",
            "detail": "",
            "source": "rule",
        },
        {
            "index": 3,
            "field": "id_number",
            "field_label": "证件号码",
            "value": "110101199001011234",
            "status": "unverified",
            "detail": "页面上的值与期望不符，可能未生效",
        },
        {
            "index": 5,
            "field": "",
            "field_label": "",
            "value": "",
            "status": "failed",
            "detail": "控件没有定位符",
        },
    ]


def test_a_record_keeps_the_counts_consistent_with_its_items(db_session, sample_items):
    """三个计数与 ``items`` 是**同一件事的两种表示**，不允许各算一份而算得不一样。"""
    record = history.create_record(
        db_session,
        url="https://example.com/apply",
        page_title="某公司网申",
        items=sample_items,
        source=SOURCE_BATCH,
    )

    assert (record.filled, record.unverified, record.failed) == (1, 1, 1)
    assert len(record.items) == 3


def test_only_the_agreed_keys_are_persisted(db_session):
    """落库前按白名单收窄：**不存下拉项这类与"我填了什么"无关的东西**。

    否则记录会随页面变化而膨胀，前端还得跟着后端 dataclass 改。
    """
    record = history.create_record(
        db_session,
        items=[
            {
                "index": 0,
                "field": "degree",
                "value": "本科",
                "status": "filled",
                # 这些都不该被存下来：
                "options": [{"value": "3", "text": "本科"}] * 50,
                "current_value": "旧值",
                "control_type": "select",
                "whatever": {"nested": True},
            }
        ],
    )

    assert set(record.items[0]) == {
        "index",
        "field",
        "field_label",
        "control_label",
        "value",
        "status",
        "detail",
        "source",
    }


def test_a_record_can_be_listed_and_read_back(db_session, sample_items):
    created = history.create_record(
        db_session,
        url="https://example.com/a",
        page_title="第一家",
        items=sample_items,
        page_snapshot=[{"index": 0, "label": "姓名", "value": "张三", "filled": True}],
    )

    listed = history.list_records(db_session)
    assert [record.id for record in listed] == [created.id]

    fetched = history.record_or_none(db_session, created.id)
    assert fetched is not None
    assert fetched.page_title == "第一家"
    assert fetched.page_snapshot[0]["value"] == "张三"


def test_records_are_listed_newest_first(db_session):
    first = history.create_record(db_session, page_title="早")
    second = history.create_record(db_session, page_title="晚")

    assert [record.id for record in history.list_records(db_session)] == [second.id, first.id]


def test_both_sources_are_recorded(db_session):
    """批量与实时两条链路都留痕——它们只是 ``source`` 不同。"""
    a = history.create_record(db_session, source=SOURCE_BATCH)
    b = history.create_record(db_session, source=SOURCE_LIVE)

    assert a.source == SOURCE_BATCH
    assert b.source == SOURCE_LIVE


def test_deleting_a_record_hides_it_from_the_list(db_session):
    record = history.create_record(db_session, page_title="要删的")

    assert history.delete_record(db_session, record.id) is True

    assert history.list_records(db_session) == []
    assert history.record_or_none(db_session, record.id) is None


def test_a_deleted_record_lands_in_the_trash_and_can_come_back(db_session):
    """删除是软删：进回收站、能恢复，而不是直接抹掉。"""
    record = history.create_record(db_session, page_title="可恢复的")
    history.delete_record(db_session, record.id)

    trashed = trash.list_trashed(db_session, key="web_form_record")
    assert [entry["id"] for entry in trashed] == [record.id]

    assert trash.restore(db_session, "web_form_record", record.id) is True
    assert [item.id for item in history.list_records(db_session)] == [record.id]


def test_deleting_twice_reports_not_found_the_second_time(db_session):
    record = history.create_record(db_session)
    assert history.delete_record(db_session, record.id) is True
    assert history.delete_record(db_session, record.id) is False


def test_purging_a_record_really_removes_it(db_session):
    """彻底删除是**真删**——回收站提供它，且要二次确认。"""
    record = history.create_record(db_session)
    history.delete_record(db_session, record.id)

    assert trash.purge(db_session, "web_form_record", record.id) is True

    assert db_session.get(WebFormFillRecord, record.id) is None


def test_the_list_limit_is_capped(db_session):
    """上限由服务层夹住，调用方传入超大值也不会把整库拉出来。"""
    for index in range(5):
        history.create_record(db_session, page_title=f"第{index}条")

    assert len(history.list_records(db_session, limit=99999)) == 5
    assert len(history.list_records(db_session, limit=2)) == 2
