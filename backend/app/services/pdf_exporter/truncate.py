# SPDX-License-Identifier: Apache-2.0
"""把一份排好的 PDF 裁到前 N 页（``build_resume_pdf`` 的截断实现）。

**为什么裁，而不是"带页数上限重排一遍"**（2026-10-21）：重排要走完 fpdf2 的整个绘制
流程，而字体解析（fonttools 解析 msyh.ttc）本机实测 ~310ms／次、占单趟渲染的约 70%
——第二趟几乎全是白花。裁页的实测成本是 **3ms**（同一份 2 页 PDF 裁到 1 页）。

顺带修掉一个语义毛刺：`_ResumePDF(max_pages=…)` 到上限之后仍会把余下内容继续画在最后
一页上，于是有一条文字渗进末页的下边距（像素级实测：1160 个点落在页底那条 12px 带里）。
产品口径是"超出上限的部分不会显示"，裁页才真的做到——这也是 2026-10-21 与用户确认
接受的差异（末页不再有那一条渗出底边距的字）。
"""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader, PdfWriter


def truncate_pdf(content: bytes, pages: int) -> bytes:
    """只保留前 ``pages`` 页；本来就没超就**原样返回**（不重写字节）。"""
    if pages <= 0:
        raise ValueError("页数上限必须为正数")
    reader = PdfReader(BytesIO(content))
    if len(reader.pages) <= pages:
        return content
    writer = PdfWriter()
    for page in reader.pages[:pages]:
        writer.add_page(page)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()
