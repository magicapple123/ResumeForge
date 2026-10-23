# SPDX-License-Identifier: Apache-2.0
"""CSV 读写共享工具：编码探测、公式注入防护、字段换行折叠、带 BOM 的写出。

岗位广场、备选岗位与求职进度三份 CSV（导入/导出）共用这里的规则——导出的文件
要能在 Excel 里安全打开（单元格不会被当成公式执行）、来回导入的行号要跟 Excel
状态栏一致，所以这些规则只在这里实现一份。
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Callable, Iterable, Iterator

# 字段内换行（含前后空白）折叠成单个空格：JD/要求是多段文本，直接进 CSV 会在
# Excel 里把一条记录撑成十几行（每个换行一行），表格没法看。折叠后每条记录
# 恰好一行；换行本身不是语义内容，导回时是干净的一整段也不丢信息。
_NEWLINE_PATTERN = re.compile(r"\s*[\r\n]+\s*")

# 一场批量导入的体量上限：与批量操作（选择/删除/分析）的 500 上限对齐。
MAX_IMPORT_ROWS = 500
MAX_IMPORT_FILE_CHARS = 2_000_000

# 单个单元格的大小上限：默认 131072 会让一个 14 万字符的正常字段（文件远小于
# 2MB）直接炸掉整个导入；放宽到与整份文件上限一致——文件本身已经卡住总量，
# 单字段没必要比文件更小。csv.field_size_limit 是进程级全局设置，导入路径共享。
MAX_CSV_FIELD_CHARS = MAX_IMPORT_FILE_CHARS
csv.field_size_limit(MAX_CSV_FIELD_CHARS)

# Excel 公式注入防护：以这些前缀开头的单元格会被 Excel 当成公式/制表执行
# （经典如 ``=HYPERLINK(...)``、``=cmd|...``）。防护规则：**仅当单元格是字符串
# 且以危险前缀开头**时加前导单引号（Excel 自己的"这是文本"标记，打开后按文本
# 显示、不执行）；负数（``-5``）与日期（``2026-10-13``）虽以 ``-`` 开头但属于
# 用户预期的数值/日期字面量，用整串匹配排除，不做转义。
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_PLAIN_NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
_PLAIN_DATE_RE = re.compile(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$")
# 制表符与换行是合法内容（后面统一折叠/引用），其余控制字符一律剔除。
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def flatten_csv_value(value: object) -> str:
    return _NEWLINE_PATTERN.sub(" ", str(value or "")).strip()


def safe_csv_cell(value: str) -> str:
    """把一个单元格编码成 Excel 安全的文本（公式注入防护 + 控制字符清理）。

    所有 CSV 导出（``records_to_csv_text`` 与 tracker 的流式写出）都必须经过
    这里——防护规则只实现这一份，改一处三处生效。
    """
    text = _CONTROL_CHARS_RE.sub("", value)
    if (
        text.startswith(_FORMULA_PREFIXES)
        and not _PLAIN_NUMBER_RE.match(text)
        and not _PLAIN_DATE_RE.match(text)
    ):
        # 前导单引号与 Excel 在单元格前手动输入 ' 的行为一致：按纯文本显示。
        return "'" + text
    return text


def decode_csv_bytes(raw: bytes) -> str:
    """解码上传的 CSV 字节：优先 UTF-8（带 BOM 也行），失败退回 GBK（Excel 中文导出常见）。"""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("gbk")
    except UnicodeDecodeError as exc:
        raise ValueError("无法识别文件编码：请用 UTF-8 或 GBK 保存 CSV 后重试") from exc


def records_to_csv_text(headers: list[str], records: Iterable[Iterable[object]]) -> str:
    """按表头+行值写出带 UTF-8 BOM 的 CSV 文本（Excel 双击打开不乱码）。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for record in records:
        writer.writerow([safe_csv_cell(flatten_csv_value(value)) for value in record])
    return "\ufeff" + buffer.getvalue()


def _friendly_csv_error(exc: csv.Error, line: int) -> str:
    """把 ``_csv.Error`` 翻译成用户能照着改的一句话（带物理行号）。"""
    message = str(exc)
    if "field larger than field limit" in message:
        return f"第 {line} 行有单元格超过 {MAX_CSV_FIELD_CHARS} 字符上限，请精简该单元格后再导入"
    if "unexpected end of data" in message:
        return f"第 {line} 行引号不闭合：请检查该行往后的引号是否成对"
    return f"第 {line} 行无法解析（{message}），请检查该行内容"


def iter_csv_records(text: str) -> Iterator[tuple[int, list[str] | None, str | None]]:
    """逐条产出 ``(物理起始行号, 行单元格, 行级错误信息)``——三者恰好一个有效。

    行号口径：**记录的物理起始行**（``reader.line_num`` 推导：每条记录开始于
    上一条结束行的下一行）。带引号内换行的记录会跨多个物理行，报告里给的是
    起始行，与 Excel 状态栏看到的行号一致。

    单条记录解析失败（``_csv.Error``）不终止整个文件：产出一条错误信息后继续
    读后面的记录（实测 reader 可以越过坏行继续）；若同一行连续失败（reader
    无法推进）则直接结束，避免死循环。
    """
    reader = csv.reader(io.StringIO(text))
    prev_end = 0
    failed_line = -1
    while True:
        start = prev_end + 1
        try:
            row = next(reader)
        except StopIteration:
            return
        except csv.Error as exc:
            if start == failed_line:
                return  # reader 卡在这一行推不动了；错误已在上一轮报告过。
            failed_line = start
            yield start, None, _friendly_csv_error(exc, start)
            continue
        prev_end = reader.line_num
        failed_line = -1
        yield start, row, None


def parse_csv_table(
    text: str,
    *,
    header_to_field: dict[str, str],
    header_aliases: dict[str, str],
    validate_row: Callable[[dict[str, str]], object],
    title_field: str,
    title_missing_message: str,
) -> tuple[list[tuple[int, dict[str, str]]], list[dict[str, object]]]:
    """候选岗位 / 岗位广场 CSV 共用的表格解析（表头映射 + 逐行校验）。

    返回 ``(可导入的 (物理行号, 字段字典) 列表, 错误行)``；错误行的 ``line`` 同样
    是物理起始行号，preview 与 commit 共用同一份行号口径。``validate_row`` 是
    各业务自己的行级校验（抛 ``ValueError`` 即该行报错），解析骨架在这里只写一份。

    - **重复表头**：两列映射到同一个字段时直接报错——旧行为是静默丢弃后一列，
      用户看着两列数据却只导入了其中一列，比报错更害人。
    - **行级隔离**：一条坏行（引号不闭合、超限单元格）只报那一行，其余行照常
      解析，与"逐行报错"的既有 preview 契约一致。
    """
    records = iter_csv_records(text)

    # 表头行（物理第 1 行）。
    header = next(records, None)
    if header is None or header[1] is None:
        if header is not None and header[2]:
            return [], [{"line": header[0], "message": header[2]}]
        return [], [{"line": 1, "message": "文件是空的"}]
    _, header_row, header_error = header
    assert header_row is not None  # iter_csv_records 的不变式：row 与 error 恰好一个为 None
    if header_error:
        return [], [{"line": 1, "message": header_error}]

    fields: list[str | None] = []
    seen_fields: set[str] = set()
    for cell in header_row:
        name = cell.strip().lstrip("\ufeff")
        field = header_to_field.get(name) or header_aliases.get(name)
        if field and field in seen_fields:
            return [], [
                {
                    "line": 1,
                    "message": f"表头有重复列「{name}」，无法确定哪一列才是数据；请保留一列后重试",
                }
            ]
        if field:
            seen_fields.add(field)
        fields.append(field)
    if title_field not in seen_fields:
        return [], [{"line": 1, "message": title_missing_message}]

    rows: list[tuple[int, dict[str, str]]] = []
    errors: list[dict[str, object]] = []
    for line, raw_row, row_error in records:
        if row_error:
            errors.append({"line": line, "message": row_error})
            continue
        assert raw_row is not None
        if not any((cell or "").strip() for cell in raw_row):
            continue  # 空行不算数据，也不报错
        if len(rows) >= MAX_IMPORT_ROWS:
            errors.append(
                {"line": line, "message": f"一次最多导入 {MAX_IMPORT_ROWS} 行，后面的行已忽略"}
            )
            break
        row: dict[str, str] = {}
        for index, field in enumerate(fields):
            if field is None or index >= len(raw_row):
                continue
            row[field] = raw_row[index]
        try:
            validate_row(row)
        except ValueError as exc:
            errors.append({"line": line, "message": str(exc)})
            continue
        rows.append((line, row))
    return rows, errors


__all__ = [
    "MAX_CSV_FIELD_CHARS",
    "MAX_IMPORT_FILE_CHARS",
    "MAX_IMPORT_ROWS",
    "decode_csv_bytes",
    "flatten_csv_value",
    "iter_csv_records",
    "parse_csv_table",
    "records_to_csv_text",
    "safe_csv_cell",
]
