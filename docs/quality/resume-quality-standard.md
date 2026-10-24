# 简历质量规范（ResumeForge 本地版）

版本：v1 · 2026-10-24
适用代码版本：仓库 HEAD `380d5bed`、`app_version = 1.0.2`（`backend/app/config.py:75`）
依据：专业计划书 §12（"权威工具"建设资料）、总任务书 W20、`AGENTS.md` 的
"排版参数即呈现"与"文档同步"规则。

> **这是一份本地可审阅规范，不是全球统一标准，也不构成任何 ATS/无障碍认证。**
> 它回答三个问题：*什么算合格*、*用什么方法检查*、*依据是哪一版实现*。
> 不同国家、行业、求职阶段的偏好差异写在 §8，不把"照片 / 一页 / 年龄"这类
> 区域习惯写成放之四海而皆准的规则。

## 1. 检查分级（本规范全篇的判据口径）

| 级别 | 含义 | 谁能做 | 本仓库证据形态 |
| --- | --- | --- | --- |
| **A 自动断言** | 机器可判、可复现，失败会让 CI 或样例检查变红 | 任何人跑命令 | pytest / 样例 check / 结构断言 |
| **B 人工校样** | 必须人看纸面（版面观感、截断位置是否可接受） | 维护者或评审者 | 导出页面截图 + 评审记录 |
| **C 外部未验证** | 依赖第三方系统（真实 ATS、屏幕阅读器、Word/macOS 真机） | 本机不可得 | **只登记，不宣称已验证** |

用法：每条质量维度都标出它的检查级别。**A 过了不等于整体合格**——B 与 C 必须分开写。

## 2. 事实准确性

**判定**：纸面上的姓名、机构、时间、数字、职责边界与用户提供的资料一致；AI 改写
不得凭空新增事实。同一事实在预览 / PDF / Word / Markdown / TXT 中不得互相矛盾。

**检查方法**

1. A：`backend/tests/test_export_labels.py` 与 `test_export_labels_a2.py` 从五种产物的
   真实字节里提取文本，断言纸面固定文案逐字同源；`test_export_page_parity.py` 断言
   版式参数与页数口径一致。
2. A：`backend/tests/test_resume_document_save.py` 钉住"保存才推进修订号"；
   `test_resume_identity.py` 钉住对象身份往返不丢。
3. A（样例回归）：`scripts/quality/generate_resume_samples.py check` 对每份样例断言
   姓名 / 机构 / 关键句在所有文本产物里都存在（`text_tokens`）。
4. B：抽 1–2 份样例与源内容逐字段对照（尤其日期与量化数字）。

**依据版本**：1.0.2（`resume_labels.py` 为纸面文案唯一来源；`document_save.py`
为写入口径）。**未覆盖**：AI 生成内容的事实核查属 W12 的事实锁范围，本规范只规定
"成品必须可对照源内容"这一可验证性质。

## 3. 文字可读取（copy/paste 与提取）

**判定**：PDF 正文可以被文本提取器取回，且主要信息不丢字、不乱码；Markdown / TXT /
Word 的正文与 PDF 是同一份内容。

**检查方法**

1. A：`test_export_labels.py` 用 pypdf 提取 PDF 文本并断言标题/字段前缀。
2. A：样例 check 用 `pdftotext -enc UTF-8`（可用时）或 pypdf 提取文本，断言
   `text_tokens` 在归一化（去空白/NUL）后仍然存在。
3. A：`backend/tests/test_pdf_exporter_font_subset.py` 钉住字体子集化不改变逐字几何。
4. B：把 PDF 复制进记事本/编辑器，肉眼确认没有替换字符。

**已知限制（必须知道）**

- **字体轮廓格式影响提取质量**：CI 对 Linux 明确安装 TrueType 的 `fonts-wqy-zenhei`
  并强制 `RESUMEFORGE_PDF_FONT`，原因写在 `.github/workflows/ci.yml`：fpdf2 对
  CFF 轮廓字体（如 Noto CJK）子集化会把提取文本弄丢。本机默认字体
  `backend/data/fonts/SourceHanSansSC-*.otf` 也是 CFF，因此**本地提取结果不能直接
  外推**；样例检查报告里会记录实际提取器与字体。
- pypdf 6.21.2 在"同一 PDF 多字体频繁切换"的长样本上存在可复现的解码错误
  （提取文本出现无关中文）；xpdf `pdftotext` 对同一文件提取正确。结论：文本断言优先
  用 `pdftotext`，pypdf 只用于结构（页数/字体/图片）与短样本。

**依据版本**：1.0.2。**未覆盖**：真实招聘系统解析结果（C 级）。

## 4. 阅读顺序

**判定**：屏幕阅读器/文本提取得到的顺序，与纸面上的语义顺序一致：页头 → 各分区
标题 → 条目 → 要点。双栏模板必须先读完左栏再读右栏，而不是左右交错。

**检查方法**

1. A：`backend/tests/test_pdf_exporter_columns.py` 断言双栏按"行"排布、同行两格
   顶部对齐、单分区高于一页时降级为顺序渲染。
2. A：样例 check 的 PDF 文本断言按"页 → 顺序"取文本；分区标题与要点 token 同时命中。
3. B：用 `pdftotext -layout` 与默认模式各导出一次文本，对照纸面顺序人工读一遍。
4. **当前实现的阅读顺序来源**是绘制顺序（内容流顺序），不是 PDF 结构标签：
   `pdf_exporter/render.py::_draw_resume` 依次画页头、分区标题、条目、要点。
   PDF 没有 `/StructTreeRoot` / `/MarkInfo` / `/Lang`，见
   `docs/quality/tagged-pdf-research-d12.md`。因此"阅读顺序正确"是**绘制顺序 +
   提取器启发式**的结果，不是结构保证；这条必须写成限制，不能宣称无障碍达标。

**依据版本**：1.0.2。**未覆盖**：真实屏幕阅读器表现（C 级）。

## 5. 信息完整度

**判定**：用户填写的七个正文分区与页头字段，在所选页数上限内都进入产物；因超页
被截断时必须有可见提示，且不得静默丢字段。

**检查方法**

1. A：`test_resume_sample_content.py` 断言示例内容字段齐全（每个字段都有值、
   照片是合法 data URL 且 < 15 KB）。
2. A：`scripts/quality/generate_resume_samples.py check` 对 120 份样例断言
   `text_tokens` 在 md/txt/html/docx/pdf 中齐全；`legacy-record` 类断言旧 JSON
   读入忽略未知键、序列化不凭空生成身份字段。
3. A：`test_export_page_parity.py` 断言 `page_limit=1` 时恰好 1 页、
   `overflow` 与 `pages_needed` 自洽（超页 = 截断 + 标记，**不缩字号**）。
4. B：看超页样例的末页，确认被截断的位置可接受（不是拦腰截断半行）。

**依据版本**：1.0.2（`MAX_RESUME_PAGES = 3`；`build_resume_pdf` 截断口径）。
**未覆盖**：用户"必须放进去"的业务信息优先级由 W09/W11 的版面诊断承担。

## 6. 打印可读性

**判定**：A4 纸面正文不小于可读下限；行距/页边距/对比度可打印；不因"装不下"自动
缩字号。

**检查方法**

1. A：`frontend/src/components/resume-preview/noAutoShrinkGuard.test.ts` 扫源码，
   禁止 `--fit-scale` 系数挂钩；`backend/tests/test_resume_templates.py` 逐模板断言
   `--fs` 是字面量、模板脚本没有 `setProperty("--fit-scale"`。
2. A：`test_pdf_exporter_scale_geometry.py` 断言字号档位对应真实像素；样例 check
   在 `extreme-margins` 类覆盖 0 / 26mm 边距与 1.2 / 2.2 行高。
3. B：按 100% 比例打印一份 scholar + 一份 classic，检查：
   - 正文（11–18px 档）在 A4 上是否可读；
   - 页边距 0mm 时内容是否贴边不可装订；
   - 灰色辅助文字（`--muted`）在黑白打印下是否仍可辨认。

**依据版本**：1.0.2。**未覆盖**：不同打印机/纸张的实际色差（C 级）。

## 7. 排版一致性

**判定**：同一份内容在不同模板、不同导出格式之间，字段顺序、分区顺序、加粗语义、
标签形状与配色口径一致；差异必须是"模板/格式能力差异"，且被登记。

**检查方法**

1. A：`test_resume_layout_templates.py` 用模板 CSS 逐条核对注册表数值
   （行距/页边距/字号比例/标签形状/列表缩进/配色）。
2. A：`test_export_page_parity.py` 断言 8 套模板 × 4 档页边距的页数承诺。
3. A：`test_docx_exporter.py` 断言 Word 与 PDF 的页数估算差在 ±1 页内；
   `test_pdf_exporter_colors.py` 断言模板配色对 PDF 生效。
4. A：样例 check 对 9 套模板（6 可见 + 3 已下线）各跑至少 1 份，断言页数上限、
   照片存在性、加粗语义与文本 token。
5. B：并排看预览与 PDF 页头（照片位置 / 标题对齐）与技能标签形状。

**已知差异登记处**：`docs/quality/template-quality-archive.md`（逐模板）。
**依据版本**：1.0.2。

## 8. 区域 / 行业 / 阶段差异（不作全球标准）

| 主题 | 常见做法 | 本工具的立场 |
| --- | --- | --- |
| 照片 | 中国大陆/部分欧洲常见；美国/英国科技岗位常不建议 | 可选；**不得视为必备**，也不能作为质量扣分项 |
| 页数 | 校招 1 页常见；学术 CV 可 2–N 页；资深岗位 2 页常见 | 默认上限 1 页、可选到 3 页；学术长 CV 用 scholar 3 页样例验证 |
| 年龄 / 出生年 | 部分地区习惯填写，多数地区不建议（反歧视） | 字段存在但**默认不填**；规范不要求填 |
| 教育位置 | 校招常放前面；社招常放经历之后 | 默认"教育优先"，可自定义分区顺序 |
| 语言 | 中英双语岗位、外企英文简历 | 纸面文案 zh-CN / en-US 两套；**不翻译正文** |
| 证件照风格 | 各国差异极大 | 只做"可选照片 + 可恢复裁剪"（W15），不做标准照 |
| 兴趣/爱好 | 部分行业接受 | 不设分区；不因缺少而扣分 |

**检查方法**：B 级人工核对 + 本工具的分区顺序/照片开关是否真的可选（A 级：
`test_resume_templates.py::test_format_config_is_validated` 等）。

## 9. 合格判定（提交前清单）

- [ ] A：相关 pytest 通过（至少 `test_export_labels.py`、`test_resume_templates.py`、
      `test_export_page_parity.py`）。
- [ ] A：`scripts/quality/generate_resume_samples.py check` 为 PASS，且报告里写明
      提取器与 PDF 页数分布。
- [ ] B：至少看过 1 份 scholar + 1 份其他模板的导出页面（截图存档）。
- [ ] B：超页样例的截断位置可接受；0mm 边距样例的打印/装订风险已知。
- [ ] C：真实 ATS / 屏幕阅读器 / Word 真机未验证的项，在交付说明里**明确列出**。

## 10. 变更记录

| 日期 | 版本 | 变化 |
| --- | --- | --- |
| 2026-10-24 | v1 | 首版：六维度 + 区域差异 + 检查清单；依据 1.0.2 与样例库 v2026-10-24.1 |

**规范自身的维护规则**：每次修改判据或"依据版本"，必须同步更新本表与
`docs/quality/template-quality-archive.md` 的"验证证据"列；判据变化要让样例 check
重新跑一遍，不允许只改文档不改证据。
