# 标签 PDF 能力研究（D12）

日期：2026-10-24 · 代码版本 `380d5bed` / `app_version 1.0.2`
性质：**有界研究交付**。结论只表示"本地证据齐全"，**不表示标签 PDF 已成为产品能力**，
也不构成 PDF/UA、WCAG 或任何无障碍达标声明（总任务书 §12 明确延期项）。

配套工具：`scripts/quality/inspect_pdf_structure.py`（本文件所有数字由它实测产出）。

## 1. 结论摘要

1. **当前服务端 PDF 不是 Tagged PDF。** 实测 4 份真实产物（单页/双页/双栏/超页截断）：
   均无 `/StructTreeRoot`、无 `/MarkInfo`、无 `/Lang`、页面无 `/Tabs` 与
   `/StructParents`、图片无 `/Alt`、无 XMP 且无 `pdfuaid` 标识。
2. **阅读顺序不是结构保证。** 顺序来自绘制顺序（内容流顺序）+ 提取器启发式；
   PDF 里没有任何"这是标题 / 这是列表 / 这是表格"的语义标签。
3. **文字可提取**：字体是 Type0 子集且带 `ToUnicode`，xpdf `pdftotext` 能取回
   正确文本；但 **pypdf 6.21.2 在多字体频繁切换的长样本上存在可复现的解码错误**，
   且本机默认字体是 CFF 轮廓（CI 已因同一问题改用 TrueType 字体）。
4. **HTML 侧略好但不达标**：`lang` 正确、图片有 `alt`，但正文**没有 h1/h2/section/main**
   （全是 div + class），所以"浏览器打印"也不是标签 PDF 的现成答案。
5. **Word 侧**：文本可提取、图片可取，但没用 Word 的 Heading 样式（无 `w:pStyle`），
   导航窗格/大纲无从建立。
6. **可复现性**：PDF 字节不可复现（创建时间秒级 + 字体预子集缓存改变嵌入字体度量），
   **文本与页数可复现**——样例回归只能拿它们当口径。

## 2. 环境与工具探测（本机实测）

| 工具 | 结果 |
| --- | --- |
| Python | 3.12.2 |
| fpdf2（PDF 引擎） | 2.8.9（**不支持 Tagged PDF 输出**） |
| pypdf | 6.21.2（读对象树/结构事实） |
| pdftotext（xpdf 4.06） | `C:\Program Files\Git\mingw64\bin\pdftotext.exe`（不在默认 PATH，工具内做了候选探测） |
| qpdf / pdfinfo / mutool / gs / pdftoppm | **均缺失**（本机无 PDF 结构校验器/渲染器） |
| PDF 字体 | `backend/data/fonts/SourceHanSansSC-{Regular,Bold}.otf`，轮廓 **CFF** |
| 基准 | A4 595.3 × 841.9 pt（MediaBox 实测） |

没有可用的 PDF 结构校验器（veraPDF/qpdf）意味着**即使将来引入标签，也无法在本机
做 PDF/UA 符合性判定**；这一点必须先说清楚，不能靠"看起来有结构树"宣称达标。

## 3. 方法（可复现步骤）

`bash
# 生成 4 份研究样例 + 读结构 + 写报告（输出到仓库外临时目录）
backend/.venv/Scripts/python.exe scripts/quality/inspect_pdf_structure.py
# 产物：%TEMP%/resumeforge-w20-pdf-research/
#   iter-classic.pdf / scholar-long-cv.pdf / split-two-column.pdf / dense-overflow.pdf
#   .html / .docx 同名对照；pdf-structure-report.{json,md}
`

四份样例直接取自语料（不另造第二套内容）：`iter-01`（classic 单页+照片）、
`bound-100`（scholar 长 CV，2 页）、`iter-18`（split 双栏）、`bound-017`
（dense 超页，自然 2 页被截到 1 页）。

## 4. 结构事实（逐样例实测）

| 样例 | 模板 | 页数/自然/溢出 | Tagged | StructTreeRoot | MarkInfo | Lang | Tabs | StructParents | 图片/Alt | XMP/PDF-UA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| iter-classic | classic | 1 / 1 / 否 | 否 | 否 | 否 | null | null | 否 | 1 / 0 | 无 / 无 |
| scholar-long-cv | scholar | 2 / 2 / 否 | 否 | 否 | 否 | null | null | 否 | 0 / 0 | 无 / 无 |
| split-two-column | split | 1 / 1 / 否 | 否 | 否 | 否 | null | null | 否 | 1 / 0 | 无 / 无 |
| dense-overflow | classic | 1 / 2 / **是** | 否 | 否 | 否 | null | null | 否 | 0 / 0 | 无 / 无 |

补充事实：

- 每页 MediaBox 都是 A4；页面只有 `/Contents /Group /MediaBox /Parent /Resources /Type`，
  **没有** `/Tabs`、`/StructParents`、`/Annots`（0 个注释/链接）。
- 字体：每份都是 `/Type0`（Identity-H）+ 子集前缀 `/MPDFAA+`，**embedded=True、
  ToUnicode=True**；粗体是独立字体对象（`...Bold`）。
- 文档信息：正常产物只有 `/CreationDate` 与 `/Title=简历`，`/ID` 存在；
  **没有** XMP（`/Metadata`）。
- **超页截断的产物被 pypdf 重写过**：`document_info = {/Producer: pypdf}`、`/ID`
  消失（`truncate_pdf` 用 pypdf 重写文件）。这是"截断产物与正常产物元数据不同"
  的既有事实，交付血缘如需 PDF 元数据要另行处理。

## 5. 阅读顺序实测

### 5.1 单栏（classic）：内容流顺序 = 语义顺序

`pdftotext` 默认提取（按内容流/启发式，节选）：

`@text
示例甲 女
求职意向：示例岗位
138-0000-0000 sample.a@example.com 示例市 2000 GitHub：… 个人主页：…
教育经历
示例大学 · 示例专业 本科 · 2019.09 - 2023.06
绩点/排名：3.7/4.0 核心课程：示例课程一、示例课程二
· 示例奖学金一次 · 示例竞赛二等奖
实习/工作经历
示例科技有限公司 · 示例岗位
2023.07 - 至今
· 负责示例业务模块，把示例流程从 10 天压到 4 天。
`@

这是 `pdf_exporter/render.py::_draw_resume` 的绘制顺序：页头 → 分区标题 → 条目标题
（左标题、右时间）→ 要点。**语义顺序天然正确**，但"哪一行是标题"只存在于视觉样式
（字号/加粗/颜色），没有结构标签；换一个按结构读的消费者就只能当成普通段落读。

### 5.2 双栏（split）：视觉列靠位置，阅读顺序靠启发式

`pdftotext -layout`（节选，保留视觉列）：

`@text
  教育经历                                       实习/工作经历
示例大学 · 示例专业 本科 · 2019.09 - 2023.06   示例科技有限公司 · 示例岗位               2023.07 - 至今
绩点/排名：3.7/4.0                        · 负责示例业务模块，把示例流程从 10 天压到 4 天。
`@

- 内容流顺序是"行级"：左格整段画完 → 右格整段画（`columns.render_sections` 的
  `_draw_row`）；所以按内容流读是"左栏一个分区 → 右栏一个分区"，**符合两栏的
  语义顺序**；
- 但提取器并不理解"栏"：`-layout` 模式按视觉位置拼行，可能把两栏同一行的文字
  拼在一行；默认模式按流顺序，反而更接近语义。**结论：双栏 PDF 的"正确阅读顺序"
  依赖读取工具**，不是文件自己能保证的。

### 5.3 超页截断：末页内容被截断，但不该有空白页

`dense-overflow` 自然 2 页、`page_limit=1` → 产物 1 页、`overflow=True`、
`pages_needed=2`；截断由 `truncate_pdf` 完成（pypdf），页面结构正常、无空白页。
界面要据此提示"约需 2 页（上限 1 页）"，而不是假装 1 页排完。

## 6. 文字提取：能做什么、依赖什么

| 提取器 | 结果 | 说明 |
| --- | --- | --- |
| pdftotext（xpdf 4.06） | **正确** | 4 份样例文本均与内容一致；双栏按流顺序可读 |
| pypdf 6.21.2 | **部分错误** | 同内容多字体切换的长样本（如 split 长样例）出现无关汉字替换；短样本正常 |
| 字体轮廓 | **CFF 有已知缺陷** | `.github/workflows/ci.yml` 注释：fpdf2 对 CFF 子集化会丢提取文本，CI 因此固定安装 TrueType 字体 `fonts-wqy-zenhei` 并强制 `RESUMEFORGE_PDF_FONT`；本机默认字体正是 CFF |

因此：**"PDF 文字可复制"目前只能声明到"Type0 + ToUnicode 存在，特定工具+特定字体下
提取正确"**，不能声明"所有阅读器/所有字体都正确"。样例回归的文本断言应优先用
`pdftotext`，pypdf 只用于结构（页数/字体/图片）。

## 7. HTML / Word 对照（为什么它们也不是现成答案）

| 维度 | HTML（导出） | Word（.docx） |
| --- | --- | --- |
| 语言 | `<html lang="zh-CN">` 正确 | 无 language 标记可查 |
| 图片替代文本 | `<img alt="个人照片">` / 模板装饰 alt | 图片 `docPr` 未写 descr |
| 标题语义 | **无 h1/h2/h3**；分区标题是 `div.section-title` | **无 Heading 样式**（0 个 `w:pStyle`） |
| 结构地标 | 无 `section/main` | 无大纲级别/书签 |
| 列表 | `ul/li`（部分结构语义可用） | 每行独立段落 + `• ` 文本（无列表编号语义） |

HTML 的 `lang` 与 `alt` 是很好的地基，但**正文标题层级缺失**使屏幕阅读器仍只能
按 DOM 顺序读一串 div。要"达标"需要结构改造（h 标签/landmark），这属于产品功能改动，
不在本轮范围。

## 8. 结论（能证明 / 不能证明）

**能证明**

- 当前 PDF 产物**没有**标签结构；阅读顺序由绘制顺序与提取器决定；
- 文字在特定工具/字体下可提取；页数、溢出、内容完整性可复现；
- 超页截断不产生空白页，且标记与页数自洽。

**不能证明（也不承诺）**

- PDF/UA、WCAG 2.x 或"屏幕阅读器可用"的合规结论；
- 所有阅读器的复制粘贴/朗读顺序一致；
- 标签 PDF 已是产品能力（当前**不是**）。

## 9. 局限与外部未验证

1. 本机**没有** PDF 结构校验器（veraPDF/qpdf）与渲染器（pdftoppm/mutool/gs），
   无法做符合性判定与像素级校样；
2. **没有真实屏幕阅读器测试**（NVDA/JAWS/VoiceOver），这是 D12 结论的最大外部缺口；
3. 字体是 CFF，文本提取结论不能直接外推到 TrueType（CI 环境）或 macOS PingFang；
4. Word 真机、Adobe Acrobat 的"辅助功能检查器"未运行（本机不可得）；
5. 双栏阅读顺序结论依赖提取器行为，未对多种阅读器逐一实测。

## 10. 若要产品化（选项与代价，不在本轮执行）

| 选项 | 代价 | 风险 |
| --- | --- | --- |
| 换支持标签的 PDF 引擎 | 重做版式对齐（预览/PDF 现有逐点一致性会被打断），大工程 | 与"不自动缩字号/参数即呈现"的现有约束重新对齐成本高 |
| 对 fpdf2 产物做后处理打标 | 需要逐元素语义映射（标题/列表/表格），等于重写一遍语义层 | 后处理打标错误比不打标更危险（读错顺序） |
| 保留现状 + 明确声明 | 无实现成本；文档与界面如实说明 | 不满足"无障碍"诉求，需产品决策接受 |
| 走浏览器打印（用户手动另存） | 无服务端成本 | 标签输出取决于浏览器版本与设置，**未验证**，不能当作能力 |

**建议**：本轮维持"明确声明 + 研究证据"，把标签 PDF 作为独立产品项目评估；
不要在 CHANGELOG/README/界面写"支持无障碍 PDF"。

## 11. 关联缺陷（取证期间发现，已在 W05 修复）

- scholar 技能列表「•」在"同一内容先渲 classic 再渲 scholar"时从 PDF 消失
  （当时 `fit._DECORATIVE_CHARS` 缺「•」，而字体子集缓存键是内容签名、不含模板）。
  复现工具：`backend/.venv/Scripts/python.exe scripts/quality/repro_scholar_bullet_glyph.py`
  （修复前 REPRODUCED，修复后 **FIXED**）。
  **修复状态：已修复（be-render/W05，2026-10-24）**：`fit._fixed_paper_chars()`
  一次性收全所有纸面固定字符（`·•：-` + 两个语言的全部标题/字段前缀/分隔符/括号），
  并新增 `backend/tests/test_export_scholar_matrix.py` 回归。本报告 §4-§7 的结构结论
  在该修复之后重跑仍然成立（PDF 依旧不是 Tagged PDF）。
  这条同时说明"PDF 文本/字形正确性"不能只靠单一模板的样例守护——跨模板切换是独立路径。

## 12. 变更记录

| 日期 | 版本 | 变化 |
| --- | --- | --- |
| 2026-10-24 | v1 | 首版：工具探测 + 4 样例结构实测 + 阅读顺序/可复现性/限制 |
