# 模板质量档案（ResumeForge 内置模板）

版本：v1 · 2026-10-24
依据代码版本：`380d5bed` / `app_version 1.0.2`
配套资料：`docs/quality/resume-quality-standard.md`（判据）、
`docs/quality/tagged-pdf-research-d12.md`（PDF 结构研究）、
`scripts/quality/generate_resume_samples.py`（120 份合成样例 + checklist）。

## 1. "已验证"的判定口径

本档案里"已通过合成样例回归"指同时满足：

1. 该模板在 `scripts/quality/generate_resume_samples.py check` 里至少有一份样例
   渲染 PASS（页数上限、溢出标记、照片、加粗、文本 token 全部符合声明）；
2. 该模板进入至少一条既有 pytest（逐模板参数化或模板专属守卫）；
3. 有一条**实测记录**：本文件 §4 的页数/结构事实来自实际渲染，不是推断。

**未覆盖**：真实 ATS 解析、屏幕阅读器、Word/macOS 真机观感。这三类在 §6 单列。

## 2. 通用能力（与模板无关的部分）

| 维度 | 事实 | 依据 |
| --- | --- | --- |
| 支持字段 | 页头 7 项（姓名/性别/出生年/电话/邮箱/城市/GitHub/个人主页/求职意向/照片）+ 七个正文分区（教育/实习工作/项目/技能/校园/荣誉/总结） | `schemas/resume.py::ResumeContent`、`templates/_resume_sections.j2` |
| 页数 | 1–3 页（`MAX_RESUME_PAGES = 3`）；按真实版式排一遍，超限**截断**并标 `overflow`，**不缩字号** | `pdf_exporter/fit.py::build_resume_pdf`、`test_export_page_parity.py` |
| 导出格式 | html / pdf / docx / md / txt / json 六种，统一从 `export_pipeline.FORMAT_RENDERERS` 出口 | `services/export_pipeline.py` |
| PDF 字体 | 单一家族（系统/用户选择的 CJK 字体；常规 + 粗体两个字面）。模板不改变字族 | `pdf_exporter/fonts.py` |
| Word 字体 | 固定 `DOCX_FONT = "微软雅黑"`（run 级显式 eastAsia） | `docx_blocks.py:34,41-50` |
| HTML 字体 | 每套模板自己的 font-family 栈；有可用用户字体时额外内嵌 `<style id="rf-font">` | `templates/resume_*.html.j2`、`exporter._active_font_style` |
| Markdown/TXT/JSON | **与模板无关**（不分页、不套模板样式，只影响内容顺序与纸面文案） | `exporter.export_markdown`、`txt_exporter`、`export_json` |
| 已下线模板 | technical / editorial / split 不在"选择模板"清单，但老记录仍按其 `template` 字段渲染 | `resume_template_catalog.py:10-18,96` |

## 3. 逐模板档案

字段说明：**页数**列是"该模板一页能装多少"的实测口径——同一份 9 行技能/1 教育/1 实习/
1 项目/1 校园/1 荣誉的样例内容（无照片），在指定字号档下服务端 PDF 的自然页数。
**全部为 2026-10-24 实测**（命令见 §5），不是按注册表推算。

### 3.1 classic（可见；`resume.html.j2`）

- 版式：页边距 14mm 四边；行高 1.7；页头左对齐、照片右；分区标题"左竖条 + 强调色"；
  页头底部 2px 强调色横线；技能标签浅灰填充（#eef2f7）。
- 支持字段：通用能力全集。
- 页数：§4 实测 1 页（small 档）。
- 字体：PDF 单一 CJK 字体；HTML 无衬线栈（Microsoft YaHei → PingFang → Noto Sans CJK）。
- 导出格式：六种全部支持；Word 的"左竖条"用段落左边框模拟。
- 已知差异：无模板特有差异（它是其余模板的比较基线）。
- 验证证据：`test_resume_layout_templates.py`（逐模板参数化）、
  `test_resume_templates.py::test_every_builtin_template_renders`、
  样例 `bound-065` / `iter-01`。

### 3.2 modern（可见；`resume_modern.html.j2`）

- 版式：14mm；行高 1.72；页头浅绿底块（#e6f4f1）+ 圆角；分区标题"软色块"；
  技能标签描边胶囊（outline + pill）。
- 页数：§4 实测 **2 页**（standard 档）→ 同一份内容比 classic 多占约半页。
- 字体：同 classic。
- 已知差异：**Word 表达不出圆角**（OOXML 段落边框是矩形），modern 的胶囊标题在
  Word 里变直角色带（`docx_blocks.decorate_paragraph` 注释已登记）。
- 验证证据：`test_modern_word_gets_the_soft_green_bands`、样例 `bound-066` /
  `iter-02`（`iter-02` 的 page_limit 已按实测设为 2）。

### 3.3 compact（可见；`resume_compact.html.j2`）

- 版式：上下 12mm / 左右 14mm；行高 1.55；页头 1px 底边线；分区标题下划线；
  技能标签"无框 + 「·」分隔"（dot）。
- 页数：§4 实测 1 页（small 档）；同内容里它最密。
- 字体：同 classic。
- 已知差异：Python 侧 `padding_sides_mm` 是后加的四向键（早期 PDF 只能四边相等，
  现已对齐）；无其他模板特有差异。
- 验证证据：`test_pdf_exporter_layout.py`、样例 `bound-067` / `iter-03`。

### 3.4 elegant（可见；`resume_elegant.html.j2`）

- 版式：上下 16mm / 左右 18mm；行高 1.76；页头**居中**、**照片在左**；
  姓名与分区标题在 HTML 里用衬线栈（Songti/SimSun/Georgia）；技能标签居中。
- 页数：§4 实测 **2 页**（standard 档，18mm 边距 + 大行高）。
- 字体：**跨格式差异最大的一套**——HTML 的姓名/标题是衬线，但 PDF 只有一个 CJK 字族，
  衬线只在 HTML 成立；`serif_heading` 只用于前端提示（`resume_template_catalog.py`），
  PDF/Word 不消费它。
- 导出格式：六种；Word 同样无衬线，且居中/照片在左通过制表位与浮动图片模拟。
- 验证证据：`test_pdf_exporter_header_align.py`、`test_photo_float_side_follows_the_template`、
  样例 `bound-068` / `iter-04`。

### 3.5 minimal（可见；`resume_minimal.html.j2`）

- 版式：18mm 四边（最宽）；行高 1.8；页头无装饰线；分区标题纯文字（muted 色）；
  技能标签纯文字。
- 页数：§4 实测按字号档不同——**small 档 1 页**（样例 `bound-069`，page_limit=1）、
  **standard 档 2 页**（样例 `iter-05`，page_limit=2）、**large 档 2 页**
  （样例 `iter-20`，page_limit=2）。standard 档与 modern/elegant/editorial 同档
  （18mm 宽边距 + 1.8 行高），比 classic 多占约 1 页；small 档仍为 1 页。
  **引用页数时必须同时写明字号档与样例**，不能把两个档位的数字互换。
- 字体：同 classic（HTML 与 PDF 一致：都是无衬线）。
- 已知差异：无特有差异；它的"少装饰"让它成为"内容可读性"的对照样本。
- 验证证据：`test_template_colors_match_the_template_files`、样例 `bound-069` /
  `iter-05`。

### 3.6 scholar（可见；`resume_scholar.html.j2`）

- 版式：上下 12mm / 左右 13mm；行高 1.5；页头无底边线；分区标题"加粗 + 整宽细线"
  （body 色，非强调色）；纯黑白（CSS 内全部颜色 r==g==b）；照片右上方形（5:5）。
- 技能列表：HTML 用 `grid-template-columns: repeat(3, 1fr)` 三列并排；
  **PDF 自 W05（2026-10-24）起同样排三列**（`skill_tags._draw_tag_grid`，
  每个格子以「• 」开头，对应 CSS `li::before`）。**Word 仍是单行顺序**（无 grid 语义）。
- 页数：§4 单页样例 1 页；长 CV 样例（`bound-098..100`）2 页。
- 字体：同 classic（无衬线）；三列 grid 的"列"是布局，不是字族。
- 已知差异（含修复状态）：
  1. 技能列表三列：HTML 有、**PDF 已有（W05 补齐）**、Word 无（单行顺序，内容不丢）；
  2. **「•」跨模板丢失缺陷：已修复（be-render/W05，2026-10-24）**。
     原缺陷：scholar 的 PDF 项目符号用 `skill_tags._TAG_BULLET = "•"`，而
     `fit._DECORATIVE_CHARS` 当时只登记「·」；字体子集缓存按**内容签名**（不含模板）
     记字符集，于是"同一内容先渲 classic、再渲 scholar"时子集缺「•」，fpdf2 只打
     missing glyph 警告，圆点静默消失。修复方式：`fit._fixed_paper_chars()` 改为
     **一次性收全所有纸面固定字符**（`·•：-` + 两个语言的全部小节标题/字段前缀/分隔符/
     括号），而不是逐字补；同时新增 `backend/tests/test_export_scholar_matrix.py`
     11 条 scholar 形状/网格/缺字/Word 证据。
     回归工具：`backend/.venv/Scripts/python.exe scripts/quality/repro_scholar_bullet_glyph.py`
     现在输出 **FIXED**（修复前为 REPRODUCED）；该脚本保留作"纸面固定字符审计"的回归入口。
- 验证证据：`test_resume_template_scholar.py`（4 条形状守卫）、
  `test_export_scholar_matrix.py`（11 条，W05 新增）、
  `test_pdf_exporter_columns.py::test_registry_matches_the_template_css_for_columns_and_tag_flags`、
  样例 `bound-070` / `bound-098..100` / `iter-06`。

### 3.7 technical（已下线，仍可渲染；`resume_technical.html.j2`）

- 版式：12mm；行高 1.6；页头 3px 强调色底边线；分区标题"强调色实底 + 白字"；
  技能标签"左侧色条"；联系方式与条目时间在 HTML 用等宽字体。
- 页数：§4 实测 1 页（small 档）。
- 字体：**PDF 只在技能标签 ASCII 文本上用一个内置 courier 字体**（`tag_mono`）；
  HTML 的联系方式/条目时间是等宽栈；**Word 全部是雅黑**（无等宽）。
- 已知差异：等宽信息只在 HTML/PDF 标签局部成立，Word 不支持。
- 验证证据：`test_technical_word_section_title_is_filled_with_the_accent_and_white_text`、
  样例 `bound-071` / `iter-16`。

### 3.8 editorial（已下线，仍可渲染；`resume_editorial.html.j2`）

- 版式：18mm；行高 1.75；分区标题下划线 + 强调色 + 居中；HTML 整页衬线
  （Georgia / Noto Serif CJK）；技能标签纯文字。
- 页数：§4 实测 **2 页**（standard 档，与 elegant 同档宽边距）。
- 字体：HTML 衬线；PDF/Word 无衬线（同 elegant 的跨格式差异）。
- 已知差异：整页衬线只在 HTML 成立。
- 验证证据：`test_resume_layout_templates.py`、样例 `bound-072` / `iter-17`。

### 3.9 split（已下线，仍可渲染；`resume_split.html.j2`）

- 版式：12mm；行高 1.6；页头浅棕底块；分区标题强调色实底白字；正文**双栏**
  （HTML grid 0.9fr : 1.1fr，列间距 `1.2 × ` 基准字号；PDF 用
  `columns.COLUMN_FRACTIONS = (0.9, 1.1)` 同一比例）。
- 页数：§4 实测 1 页（small 档）。
- 字体：同 classic。
- 已知差异：
  1. **Word 没有分栏**：`docx_exporter` 不消费 `column_count`，split 在 Word 里排成
     单栏顺序（内容不丢，版面不同）；
  2. PDF 双栏的阅读顺序由**绘制顺序**决定（行级：左格 → 右格），不是 PDF 结构标签；
     见 D12 研究 §5。
- 验证证据：`test_pdf_exporter_columns.py`（11 条）、样例 `bound-073` / `iter-18`。

## 4. 实测页数总表（2026-10-24 首测，2026-10-25 复核；本机 SourceHanSansSC）

命令：`backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py check
--json-out <tmp>/check-report.json`；页数取 `template-matrix` 样例的自然页数
（`pages_needed`）。

**测量条件**（结论只在这个条件下成立）：Windows 10.0.26200 本机、Python 3.12.2、
PDF 字体 SourceHanSansSC（CFF 轮廓）、样例库 `CORPUS_VERSION=2026-10-24.1`、
PDF 文本提取器 `pdftotext`、页数为服务端 PDF 的自然页数（未按 `page_limit` 截断）。
2026-10-25 复核：`write` + `check` 均 exit 0，**120/120 份样例 PASS**（120 份全部
由 pdftotext 提取，失败 0）；下表与 §3 各模板页数在复核中逐项一致。

| 模板 | 样例 | 字号档 | 自然页数 | 样例 page_limit | 是否溢出 |
| --- | --- | --- | --- | --- | --- |
| classic | bound-065 | small | 1 | 1 | 否 |
| modern | bound-066 | standard | 2 | 2 | 否 |
| compact | bound-067 | small | 1 | 1 | 否 |
| elegant | bound-068 | standard | 2 | 2 | 否 |
| minimal | bound-069 | small | 1 | 1 | 否 |
| scholar | bound-070 | standard | 1 | 2 | 否（W05 三列网格后仍 1 页） |
| technical | bound-071 | small | 1 | 1 | 否 |
| editorial | bound-072 | standard | 2 | 2 | 否 |
| split | bound-073 | small | 1 | 1 | 否 |

（2026-10-24 全量 check 的 120 份里：自然 1 页 76 份、2 页 42 份、3 页 2 份；
5 份故意超页样例按声明截断并标 overflow。2026-10-25 复核同样是 120/120。）

> **minimal 两处数字的对应关系**：上表 `bound-069` 是 **small 档**、自然 1 页；
> §3.5 所写的 standard 档 2 页对应迭代样例 `iter-05`（page_limit=2），large 档
> `iter-20` 也是 2 页。这两个样例属于 20 份迭代样例，不在 `template-matrix`
> 边界组，所以上表只列 `bound-069`。此前 §3.5 把 "standard 档 2 页" 的出处
> 写成了 §4 的 `bound-069`（small 档），是把**档位**与**样例**错配，不是实测页数
> 有第二个值。

结论：**同一份内容在 standard 档、宽边距/大行高模板（modern/elegant/editorial/minimal）
会多占约 1 页**；这里的 "1 页" 只在 standard 档成立——minimal 的 small 档仍是 1 页，
large 档是 2 页。这是模板默认版式的真实差异，不是缺陷；界面上的页数提示与
`page_limit` 行为必须按此解释，不能把不同字号档的页数混用。

## 5. 复现命令

`bash
# 1) 生成 120 份样例 + manifest（写到仓库外临时目录；两次生成的 manifest 逐字节相同）
backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py write

# 2) 全量渲染 + 期望校验（含每份样例的页数/缺字/提取器 JSON 报告）
backend/.venv/Scripts/python.exe scripts/quality/generate_resume_samples.py check \
  --json-out %TEMP%/resumeforge-w20-samples/check-report.json

# 3) 已知缺陷最小复现（scholar 的「•」跨模板丢失）
backend/.venv/Scripts/python.exe scripts/quality/repro_scholar_bullet_glyph.py
`

（Windows PowerShell 下把行尾 `\` 换成反引号续行；bin/ 路径按本机 venv 调整。）

## 6. 未覆盖与外部验证

- **真实 ATS 解析**：只声明"本地解析通过"，不等于招聘方系统通过。
- **屏幕阅读器**：没有任何真实读屏测试；PDF 不是 Tagged PDF（D12 研究）。
- **Word 真机观感**：本机无 Word；OOXML 结构与文本已断言，查看器校样未做。
- **macOS/Linux 字体**：本机是 CFF 轮廓的 SourceHanSansSC；CI 用 TrueType 的
  wqy-zenhei（见 `.github/workflows/ci.yml` 的字体说明）。字体不同会改变换行点，
  页数结论的**绝对页数**可能漂移，所以样例期望只钉"上限/溢出标记"，不钉精确页数。

## 7. 变更记录

| 日期 | 版本 | 变化 |
| --- | --- | --- |
| 2026-10-24 | v1 | 首版：九套模板（6 可见 + 3 下线）逐套档案 + 实测页数 + 已知差异（含 scholar「•」缺陷登记） |
| 2026-10-25 | v1.1 | 修正 minimal 页数的档位/样例错配（§3.5 与 §4）：small=1 页（bound-069）、standard=2 页（iter-05）、large=2 页（iter-20）；补测量条件与 2026-10-25 120/120 复核结果 |
