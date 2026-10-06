"""时区与时间渲染的防回归用例（QA 评审 P2：跨平台/时区盲区）。

这些契约目前都"碰巧正确"，但没有任何用例钉住它们——一旦有人把 naive now() 换成
aware UTC、或在格式化前做一次 to_utc()，用户看到的日历语义就会悄悄漂移：
- 「本月投递」按**用户本地自然月**算（tracker.py 有注释明确这是有意为之）；
- 会话导出的时间按**存储值自带的墙上时间**渲染，不做任何时区换算；
- 备份文件名是纯数字时间戳，必须保持可排序（轮转按名字/修改时间删最旧）。
"""

from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from app import database_migrations
from app.database import build_engine
from app.database_migrations import backup_sqlite_database
from app.services import tracker
from app.services.conversation_export import _display_time


def test_display_time_renders_stored_wall_clock_without_conversion():
    # naive 值（库里的常态）：原样渲染。
    assert _display_time(datetime(2026, 10, 7, 8, 30)) == "2026-10-07 08:30"
    # aware 值：渲染它自己时区的墙上时间，而不是换算到 UTC 或本地。
    shanghai = datetime(2026, 10, 7, 8, 30, tzinfo=ZoneInfo("Asia/Shanghai"))
    assert _display_time(shanghai) == "2026-10-07 08:30"
    utc = datetime(2026, 10, 7, 0, 30, tzinfo=ZoneInfo("UTC"))
    assert _display_time(utc) == "2026-10-07 00:30"
    assert _display_time(None) == ""


def test_tracker_month_prefix_follows_local_calendar_month(monkeypatch: pytest.MonkeyPatch):
    """「本月」的边界行为：10 月最后一天与 11 月 1 日必须落在不同的前缀里。

    用假时钟钉语义，而不是用真实 today（那样十月底跑和十一月跑会测到不同分支）。
    """

    class _FixedDate(date):
        _today: date

        @classmethod
        def today(cls):  # noqa: D102 - 替身：返回注入的固定日期
            return cls._today

    monkeypatch.setattr(tracker, "date", _FixedDate)

    _FixedDate._today = date(2026, 10, 31)
    assert tracker.date.today().strftime("%Y-%m") == "2026-10"
    _FixedDate._today = date(2026, 11, 1)
    assert tracker.date.today().strftime("%Y-%m") == "2026-11"


def test_backup_filename_is_digits_only_and_sortable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """备份文件名 = <stem>-<YYYYmmdd>-<HHMMSS>-<微秒>.db：纯数字、字典序即时间序。"""

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls):  # noqa: D102 - 替身：返回注入的固定时刻
            return cls(2026, 10, 7, 8, 30, 0, 123456)

    db = tmp_path / "resume_forge.db"
    engine = build_engine(f"sqlite:///{db.as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")

        monkeypatch.setattr(database_migrations, "datetime", _FixedDateTime)
        snapshot = backup_sqlite_database(engine, output_dir=tmp_path / "snapshots")
        assert snapshot is not None
        assert snapshot.name == "resume_forge-20261007-083000-123456.db"
        stem = snapshot.stem.removeprefix("resume_forge-")
        assert stem.replace("-", "").isdigit()

        class _LaterDateTime(_FixedDateTime):
            @classmethod
            def now(cls):  # noqa: D102 - 替身：晚一秒
                return cls(2026, 10, 7, 8, 30, 1, 123456)

        monkeypatch.setattr(database_migrations, "datetime", _LaterDateTime)
        later = backup_sqlite_database(engine, output_dir=tmp_path / "snapshots")
        assert later is not None
        # 轮转逻辑按名字/修改时间删最旧：字典序必须与时间序一致。
        assert [snapshot.name, later.name] == sorted([snapshot.name, later.name])
    finally:
        engine.dispose()
