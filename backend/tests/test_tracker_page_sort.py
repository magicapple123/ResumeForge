# SPDX-License-Identifier: Apache-2.0
"""进度分页端点排序（R13：进度页可排序）。

覆盖五件事，每条都对着一个验收点：

1. 缺省（``stage``）与改造前的次序**逐条相同**——排序上线不能顺手改掉默认视图；
2. 四个可选键各自生效，且 ``order`` 能翻转（同键再点一次 = 反向）；
3. ``next_action_date`` / ``applied_at`` 的空值**永远排最后**（升降序都一样）；
4. ``company`` 走 ``rf_pinyin``（中文按拼音，不是按码点）；
5. 非法 ``sort`` / ``order`` 回落默认，**返回 200 而不是 422/500**。

独立成文件的理由：``test_tracker_page_job_id_filter.py`` 守的是过滤口径，这批用例
守的是排序口径，混在一个文件里两种失败原因会互相盖住。
"""

from datetime import datetime, timedelta

from app.database import SessionLocal
from app.models.tracker import ApplicationTrack, normalize_key

PAGE_URL = "/api/tracker/page"

_BASE_STAMP = datetime(2026, 10, 1, 12, 0, 0)

#: (公司, 状态, 投递时间, 下一步时间, updated_at 相对 _BASE_STAMP 的分钟数)
#:
#: 刻意让四个键各自排出**不同**的次序，否则"某一版实现恒定按 id 排"也能蒙混过关：
#: - 阶段序：乙(interview) < 丙(screening) < 甲(applied) < 丁(applied)
#: - 最近更新：丁 > 丙 > 乙 > 甲（与阶段序几乎相反）
#: - 下一步时间升序：丙(10-20) < 乙(10-25) < 甲/丁（空）
#: - 投递时间降序：丁(10-30) > 乙(10-10) > 甲(09-01) > 丙（空）
#: - 公司名拼音升序：北京甲 < 杭州乙 < 上海丙 < 成都丁
_SPECS = [
    ("北京甲公司", "applied", "2026-09-01", "", 1),
    ("杭州乙公司", "interview", "2026-10-10", "2026-10-25", 2),
    ("上海丙公司", "screening", "", "2026-10-20", 3),
    ("成都丁公司", "applied", "2026-10-30", "", 4),
]


def _seed() -> None:
    with SessionLocal() as db:
        rows = []
        for company, status, applied_at, next_action_date, offset in _SPECS:
            moment = _BASE_STAMP + timedelta(minutes=offset)
            rows.append(
                ApplicationTrack(
                    company=company,
                    title="后端开发",
                    company_key=normalize_key(company),
                    title_key=normalize_key("后端开发"),
                    status=status,
                    applied_at=applied_at,
                    next_action_date=next_action_date,
                    created_at=moment,
                    updated_at=moment,
                )
            )
        db.add_all(rows)
        db.commit()


def _companies(client, query: str = "") -> list[str]:
    """按接口返回顺序取公司名——**只认服务端次序**，不在测试里重算一遍排序。"""
    response = client.get(f"{PAGE_URL}{query}")
    assert response.status_code == 200, response.text
    return [item["company"] for item in response.json()["items"]]


def test_default_order_is_stage_first_then_updated(client):
    _seed()

    assert _companies(client) == ["杭州乙公司", "上海丙公司", "成都丁公司", "北京甲公司"]
    # 显式传默认值必须与不传一字不差：前端「阶段优先」不写 URL，两条路径不能分叉。
    assert _companies(client, "?sort=stage") == _companies(client)


def test_updated_key_orders_by_update_time_and_flips(client):
    _seed()

    assert _companies(client, "?sort=updated&order=desc") == [
        "成都丁公司",
        "上海丙公司",
        "杭州乙公司",
        "北京甲公司",
    ]
    assert _companies(client, "?sort=updated&order=asc") == [
        "北京甲公司",
        "杭州乙公司",
        "上海丙公司",
        "成都丁公司",
    ]


def test_next_action_date_puts_empty_last_in_both_directions(client):
    _seed()

    ascending = _companies(client, "?sort=next_action_date&order=asc")
    # 升序时 SQLite 默认会把空串排最前；这里必须是"有日期的在前，没日期的沉底"。
    assert ascending[:2] == ["上海丙公司", "杭州乙公司"]
    assert sorted(ascending[2:]) == sorted(["成都丁公司", "北京甲公司"])

    descending = _companies(client, "?sort=next_action_date&order=desc")
    assert descending[:2] == ["杭州乙公司", "上海丙公司"]
    assert sorted(descending[2:]) == sorted(["成都丁公司", "北京甲公司"])


def test_applied_at_puts_empty_last_and_defaults_to_desc(client):
    _seed()

    # order 缺省时用该字段的默认方向（投递时间 = desc），不是 asc。
    assert _companies(client, "?sort=applied_at") == [
        "成都丁公司",
        "杭州乙公司",
        "北京甲公司",
        "上海丙公司",
    ]
    assert _companies(client, "?sort=applied_at&order=asc") == [
        "北京甲公司",
        "杭州乙公司",
        "成都丁公司",
        "上海丙公司",
    ]


def test_company_key_uses_pinyin_collation(client):
    _seed()

    # 拼音：北京(bei) < 成都(cheng) < 杭州(hang) < 上海(shang)。
    # 按 BINARY 码点排会得到完全不同的次序（上海 4E0A < 北京 5317 < 成都 6210 < 杭州 676D）。
    assert _companies(client, "?sort=company&order=asc") == [
        "北京甲公司",
        "成都丁公司",
        "杭州乙公司",
        "上海丙公司",
    ]
    assert _companies(client, "?sort=company&order=desc") == [
        "上海丙公司",
        "杭州乙公司",
        "成都丁公司",
        "北京甲公司",
    ]


def test_invalid_sort_and_order_fall_back_to_default_without_error(client):
    _seed()

    default_order = _companies(client)
    # 手改坏的 URL 应该"按默认次序看"，不是撞一页 422/500。
    assert _companies(client, "?sort=bogus&order=sideways") == default_order
    # 字段合法、方向非法：方向回落该字段的默认方向（updated → desc），字段本身保留。
    assert _companies(client, "?sort=updated&order=bogus") == _companies(
        client, "?sort=updated&order=desc"
    )
