"""CSV 安全单元格编码与解析健壮性（2026-10-13 生产审计 PR-12）。

- 公式注入：``=``/``+``/``-``/``@``/制表符等前缀在 Excel 里会被当公式执行，
  导出必须转义；负数与日期不能被误转。
- 同源：tracker 流式导出与 csv_io 共用同一份编码——改一处两处生效。
- 解析：字段超限要给可读错误；行号必须是**物理起始行**（引号内换行不偏移）；
  重复表头要报错，坏行只影响自己那一行。
"""

import csv
import io

from app.services.candidate_csv import parse_candidate_csv
from app.services.csv_io import (
    MAX_CSV_FIELD_CHARS,
    iter_csv_records,
    records_to_csv_text,
    safe_csv_cell,
)
from app.services.job.job_csv import parse_job_csv
from app.services.tracker import ApplicationTrack, to_csv

# ===== 公式前缀转义 =====


def test_formula_prefixes_are_escaped():
    for dangerous in ("=1+1", "+cmd", "@SUM(A1)", "-cmd|...", "\tsep", "\rrest"):
        assert safe_csv_cell(dangerous).startswith("'"), dangerous


def test_negative_numbers_and_dates_are_not_escaped():
    # 负数与日期以 "-" 开头但属于用户预期的字面量，转义会让表格里多出一堆引号。
    for plain in ("-5", "-3.14", "2026-10-13", "2026/10/13", "2026.10.13", "正常文本", ""):
        assert safe_csv_cell(plain) == plain, plain


def test_control_chars_are_stripped_but_tab_is_kept_in_middle():
    assert safe_csv_cell("a\x00b\x01c") == "abc"
    assert safe_csv_cell("a\tb") == "a\tb"  # 中间的制表符不是公式前缀


def test_records_to_csv_text_escapes_formula_cells():
    text = records_to_csv_text(["名称"], [['=HYPERLINK("http://x","点我")']])
    assert "'=HYPERLINK" in text


# ===== tracker 导出与 csv_io 同源 =====


def _track(company: str) -> ApplicationTrack:
    return ApplicationTrack(
        company=company,
        title="岗位",
        status="applied",
        stage_note="",
        applied_at="",
        status_date="",
        next_action="",
        next_action_date="",
        note="",
    )


def test_tracker_csv_uses_the_same_cell_encoding_as_csv_io():
    """tracker 流式导出的单元格转义必须与 records_to_csv_text 完全一致：
    同一份输入在两条导出路径里得到同一个字节级单元格。"""
    company = "=1+1"
    tracker_line = to_csv([_track(company)]).splitlines()[1]
    csv_io_line = records_to_csv_text(["公司"], [[company]]).splitlines()[1]
    # 两边解析回单元格后逐格相等：同一个危险前缀在两条路径里被同一规则转义。
    tracker_cells = next(csv.reader(io.StringIO(tracker_line)))
    csv_io_cells = next(csv.reader(io.StringIO(csv_io_line)))
    assert tracker_cells[0] == csv_io_cells[0] == "'=1+1"


# ===== 解析健壮性 =====


def test_oversized_field_yields_friendly_error_not_crash():
    # 上限是 131072 时的历史事故：14 万字符的正常字段（文件 <2MB）炸掉整个导入。
    huge = "x" * (MAX_CSV_FIELD_CHARS + 10)
    rows, errors = parse_job_csv(f"标题,公司\n甲,{huge}\n")
    assert rows == []
    assert len(errors) == 1
    assert errors[0]["line"] == 2
    assert str(MAX_CSV_FIELD_CHARS) in errors[0]["message"]
    assert "上限" in errors[0]["message"]


def test_multiline_quoted_record_reports_physical_start_line():
    # 两条记录、第一条带引号内换行（占物理 2-3 行）：旧行号口径报 [2, 3]，
    # 正确的物理起始行是 [2, 4]——与 Excel 状态栏一致。
    text = '标题,公司\n"第一\n条",公司A\n第二条,公司B\n'
    rows, errors = parse_job_csv(text)
    assert errors == []
    assert [line for line, _ in rows] == [2, 4]
    assert rows[0][1]["title"] == "第一\n条"


def test_duplicate_headers_are_rejected():
    text = "标题,标题,公司\n甲,乙,公司A\n"
    rows, errors = parse_job_csv(text)
    assert rows == []
    assert len(errors) == 1
    assert errors[0]["line"] == 1
    assert "重复列" in errors[0]["message"]


def test_bad_row_is_isolated_and_does_not_kill_the_file():
    # 坏行（字段超限）只报那一行；_csv.Error 不再毁掉整个导入——错误之后的
    # 记录照常解析（实测 reader 可越过坏行继续）。
    csv.field_size_limit(100)  # 临时调低，制造一条"字段超限"的坏行
    try:
        text = "标题,公司\n甲,公司A\n乙," + "x" * 200 + "\n丙,公司C\n"
        rows, errors = parse_job_csv(text)
    finally:
        csv.field_size_limit(MAX_CSV_FIELD_CHARS)
    assert [row["title"] for _, row in rows] == ["甲", "丙"]
    assert len(errors) == 1
    assert errors[0]["line"] == 3
    assert "上限" in errors[0]["message"]


def test_iter_csv_records_line_numbers_are_physical():
    text = 'a\n"b\nc"\nd\n'
    lines = [line for line, row, error in iter_csv_records(text) if error is None]
    assert lines == [1, 2, 4]


def test_candidate_csv_duplicate_header_is_rejected_too():
    rows, errors = parse_candidate_csv("岗位名称,岗位名称\n甲,乙\n")
    assert rows == []
    assert errors and "重复列" in errors[0]["message"]


def test_field_limit_is_raised_above_the_legacy_131072():
    assert csv.field_size_limit() >= MAX_CSV_FIELD_CHARS
