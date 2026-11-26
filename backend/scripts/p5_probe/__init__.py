# SPDX-License-Identifier: Apache-2.0
"""探针包（#5 步骤 0）：真实 PDF 的切块质量与字体覆盖统计。

拆成三小块，每块只干一件事：

* :mod:`samples` —— 用应用自己的导出链造补充样本；
* :mod:`probe`   —— 逐份文档的判定（复用 `app.services.external_resume_pdf_*` 的同一套规则）；
* :mod:`report`  —— 把结论渲染成 Markdown。
"""

__all__ = ["probe", "report", "samples"]
