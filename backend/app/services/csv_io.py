"""CSV 读写共享工具：编码探测、字段换行折叠、带 BOM 的写出。

岗位广场与备选岗位两份 CSV（导入/导出）共用这里的规则——两边必须长得一样、
Excel 打开的行为一致，所以这些函数只在这里实现一份。
"""

from __future__ import annotations

import csv
import io
import re

# 字段内换行（含前后空白）折叠成单个空格：JD/要求是多段文本，直接进 CSV 会在
# Excel 里把一条记录撑成十几行（每个换行一行），表格没法看。折叠后每条记录
# 恰好一行；换行本身不是语义内容，导回时是干净的一整段也不丢信息。
_NEWLINE_PATTERN = re.compile(r"\s*[\r\n]+\s*")

# 一场批量导入的体量上限：与批量操作（选择/删除/分析）的 500 上限对齐。
MAX_IMPORT_ROWS = 500
MAX_IMPORT_FILE_CHARS = 2_000_000


def flatten_csv_value(value: object) -> str:
    return _NEWLINE_PATTERN.sub(" ", str(value or "")).strip()


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


def records_to_csv_text(headers: list[str], records: list[list[object]]) -> str:
    """按表头+行值写出带 UTF-8 BOM 的 CSV 文本（Excel 双击打开不乱码）。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    for record in records:
        writer.writerow([flatten_csv_value(value) for value in record])
    return "\ufeff" + buffer.getvalue()


def parse_csv_rows(text: str) -> tuple[list[list[str]], list[str]]:
    """把 CSV 文本解析成 (数据行, 表头行)；空文件返回空表头。

    调用方负责按表头做列映射与逐行校验（行号 = 数据行下标 + 2，表头是第 1 行）。
    """
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader]
    if not rows:
        return [], []
    return rows[1:], rows[0]


__all__ = [
    "MAX_IMPORT_FILE_CHARS",
    "MAX_IMPORT_ROWS",
    "decode_csv_bytes",
    "flatten_csv_value",
    "parse_csv_rows",
    "records_to_csv_text",
]
