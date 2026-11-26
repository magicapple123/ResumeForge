# SPDX-License-Identifier: Apache-2.0
"""简历关键词搜索的 LIKE 转义（T08 / 报告 R8）。

``filtered_query`` 以前直接拼 ``f"%{keyword}%"``：``%`` 与 ``_`` 被当通配符，搜「100%」
等于搜「100 后面任意」，搜「a_b」会命中「axb」。修法是 ``escape_like`` + ``ESCAPE '\\'``。

三个用例各钉一种字符（``%`` / ``_`` / ``\\``），每条都造"真含该字符"与"只差一个字符"
两行数据——只断言"能搜到"证明不了转义，必须同时断言"假的那条搜不到"。

``/resumes/ids`` 与 ``/resumes`` 共用同一份 ``filtered_query``，所以顺带断言一次，
避免以后有人在 ids 路径上另抄一份未转义的 LIKE。
"""

from app.models.resume import ResumeRecord


def _seed(db_session, *, title: str) -> int:
    """造一条简历：正文留空，确保命中只可能来自 title（LIKE 也扫 content 的 JSON 文本）。"""
    record = ResumeRecord(title=title, company="示例科技", content={"summary": ""})
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record.id


def _ids(client, path: str = "/api/resumes", **params) -> list[int]:
    """列表端点返回 ``{items,total}``；``/resumes/ids`` 直接返回 id 数组（两种都要吃）。"""
    payload = client.get(path, params=params).json()
    if isinstance(payload, list):
        return payload
    return [row["id"] for row in payload["items"]]


def test_keyword_percent_is_literal_not_wildcard(client, db_session):
    """搜「100%」只命中真的含「100%」的那条，不命中「100 元」。"""
    literal = _seed(db_session, title="涨薪 100% 谈判复盘")
    decoy = _seed(db_session, title="涨薪 100 元谈判复盘")

    assert _ids(client, keyword="100%") == [literal]
    # ids 端点共用同一份筛选器：同样不能把 decoy 带出来。
    assert _ids(client, path="/api/resumes/ids", keyword="100%") == [literal]
    # 反向确认 decoy 确实存在（否则上一条断言可能因为"库是空的"而假通过）。
    assert decoy in _ids(client)


def test_keyword_underscore_is_literal_not_single_char(client, db_session):
    """搜「a_b」不命中「axb」——``_`` 是单字符通配符，未转义时两者等价。"""
    literal = _seed(db_session, title="a_b 命名规范")
    decoy = _seed(db_session, title="axb 命名规范")

    assert _ids(client, keyword="a_b") == [literal]
    assert decoy in _ids(client)


def test_keyword_backslash_is_literal(client, db_session):
    """反斜杠要能按字面搜到（证明"先转义 ``\\`` 再转义 ``%``/``_``"的顺序没写反）。"""
    literal = _seed(db_session, title=r"C:\temp 目录迁移")
    decoy = _seed(db_session, title="C:temp 目录迁移")

    assert _ids(client, keyword=r"C:\temp") == [literal]
    assert decoy in _ids(client)
