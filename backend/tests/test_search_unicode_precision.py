# SPDX-License-Identifier: Apache-2.0
"""FTS candidates must also satisfy the public literal substring contract."""

from app.models.job import Job
from tests.test_search_fts import _fts_tables_enabled


def test_ascii_query_does_not_match_unicode_casefold_alias_in_content(client, db_session):
    db_session.add_all([Job(title="kubernetes"), Job(title="\u212aubernetes")])
    db_session.commit()
    baseline = client.get("/api/search", params={"q": "kubernetes", "scope": "jobs"}).json()
    with _fts_tables_enabled():
        indexed = client.get("/api/search", params={"q": "kubernetes", "scope": "jobs"}).json()
    assert [item["title"] for item in baseline["jobs"]] == ["kubernetes"]
    assert indexed == baseline
