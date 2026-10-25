// SPDX-License-Identifier: Apache-2.0
/**
 * 「统一检查」这一批**新增**的界面文案（W11-FE）。
 *
 * 拆法与 `zh-CN.proview.ts` 相同：扁平点分 key、一个默认导出、`as const`；
 * `zh-CN.ts` 末尾 `...preflight` 展开合并。**只放本批新增 key**，不重复既有。
 *
 * 文案口径（docs/ui-copy-guide.md）：标题 ≤7 字、正文 ≤30 字、Toast ≤20 字；不用
 * 感叹号与句号；按钮写具体动作；错误必须给出路。
 */

const preflight = {
  // ── 面板骨架 ───────────────────────────────────────────────
  /** 弹窗标题 / 面板标题（≤7 字）。 */
  "preflight.title": "检查简历",
  /** 主按钮：开始检查。 */
  "preflight.action.run": "开始检查",
  /** 已有结果时的主按钮。 */
  "preflight.action.recheck": "重新检查",
  /** 在飞时的次按钮。 */
  "preflight.action.cancel": "取消检查",
  /** 只读检查的说明：不改稿、不上传。 */
  "preflight.hint": "只读检查，不会改动你的简历",
  /** 三层检查口径的可展开说明。 */
  "preflight.hint.layers": "依次检查内容、排版与导出产物，全部本地完成",
  /** 加载态。 */
  "preflight.status.loading": "正在检查全部层面…",
  /** 空态（还没点过检查）。 */
  "preflight.status.idle": "点开始检查，生成第一份清单",
  /** 过时提示：结果基于上一版。 */
  "preflight.status.stale": "结果基于上一版，重新检查可更新",
  /** 错误态标题。 */
  "preflight.error.title": "检查没有完成",
  /** 错误兜底（必须给出路：配合重试按钮）。 */
  "preflight.error.generic": "检查失败，请重试",
  /** 错误态重试按钮。 */
  "preflight.error.retry": "重试检查",
  /** 全部通过。 */
  "preflight.empty.title": "没有发现问题",
  /** 全部通过说明。 */
  "preflight.empty.description": "内容、排版与导出产物都通过了检查",
  /** 「只显示必须解决」过滤开关。 */
  "preflight.filter.blockers": "只看必须解决",
  /** 过滤后为空。 */
  "preflight.empty.filtered": "没有必须解决的问题",

  // ── 三层 / 三级 ────────────────────────────────────────────
  "preflight.layer.content": "内容",
  "preflight.layer.layout": "排版",
  "preflight.layer.product": "产物",
  /** 分组标题：{layer}（{count}）。 */
  "preflight.layer.groupLabel": "{layer}（{count}）",
  "preflight.severity.blocker": "必须解决",
  "preflight.severity.verify": "需核对",
  "preflight.severity.suggestion": "排版建议",
  /** 汇总读数。 */
  "preflight.summary": "必须解决 {blocker} · 需核对 {verify} · 建议 {suggestion}",
  /** 复检后的差异读数。 */
  "preflight.recheck.resolved": "已解决 {count} 条",
  "preflight.recheck.remaining": "仍有 {count} 条",
  /** 复检完成 Toast。 */
  "preflight.recheck.done": "复检完成，共 {count} 条问题",

  // ── 单条问题 ───────────────────────────────────────────────
  /** 问题标题缺失时的兜底。 */
  "preflight.issue.untitled": "待处理问题",
  /** 定位标签。 */
  "preflight.issue.location": "位置",
  /** 影响标签。 */
  "preflight.issue.impact": "影响",
  /** 依据标签。 */
  "preflight.issue.evidence": "依据",
  /** 行内拼装：{label}：{value}（CJK 标点只出现在语言包里）。 */
  "preflight.issue.locationLine": "{label}：{value}",
  "preflight.issue.impactLine": "{label}：{value}",
  "preflight.issue.evidenceLine": "{label}：{value}",
  /** 没有可执行修复入口时的说明（不许摆空按钮）。 */
  "preflight.issue.noFix": "这一条没有自动修复入口，请按说明手动处理",
  /** 修复后等待下一次检查确认的标记。 */
  "preflight.issue.pendingRecheck": "待复检",
  /** 严重度说明的 Tooltip（建议级为何只是建议）。 */
  "preflight.issue.severityHint": "建议项不影响导出，按需处理",

  // ── 修复入口（key = preflight.fix.<action>，与后端 fix.label_key 逐字对应）──
  "preflight.fix.focus_field": "定位到这一项",
  "preflight.fix.apply_format_config": "应用这个排版参数",
  "preflight.fix.add_page": "增加一页",
  "preflight.fix.open_layout_analyze": "打开版面诊断",
  "preflight.fix.open_preflight": "重新检查",
  "preflight.fix.open_settings": "打开设置",
  "preflight.fix.open_preview_exact": "打开精确预览",
  "preflight.fix.unhide_entry": "取消隐藏这一条",
  "preflight.fix.fallback": "去处理",

  // ── 问题标题（key = preflight.issue.<code>，与后端 title_key 逐字对应）──
  "preflight.issue.incomplete_marker": "还有待补内容",
  "preflight.issue.ats_format": "格式有风险",
  "preflight.issue.ats_keyword": "关键词不足",
  "preflight.issue.ats_position": "关键信息位置",
  /** risk_<category> 共用（类别是开放集合，机器码放 Tooltip）。 */
  "preflight.issue.risk": "需要核对事实",
  "preflight.issue.layout_overflow": "超出页数",
  "preflight.issue.layout_dense": "排版过密",
  "preflight.issue.layout_sparse": "排版偏空",
  "preflight.issue.layout_too_sparse": "版面太空",
  "preflight.issue.layout_suggestion": "排版建议",
  "preflight.issue.layout_no_measure": "量不到版面",
  "preflight.issue.font_missing_glyphs": "字体缺字",
  "preflight.issue.font_bold_missing": "粗体不可用",
  "preflight.issue.product_pdf_text_missing": "PDF 缺文字",
  "preflight.issue.product_docx_text_missing": "Word 缺文字",
  "preflight.issue.product_pdf_text_empty": "PDF 读不到文字",
  "preflight.issue.product_pdf_order_diff": "阅读顺序不同",
  "preflight.issue.product_docx_order_diff": "Word 顺序不同",
  "preflight.issue.product_pdf_overflow": "PDF 超出页数",
  "preflight.issue.product_docx_overflow": "Word 超出页数",
  "preflight.issue.product_hidden_leak": "隐藏内容泄露",
  "preflight.issue.product_pdf_render_failed": "PDF 渲染失败",
  "preflight.issue.product_docx_render_failed": "Word 渲染失败",
  "preflight.issue.model_not_configured": "未配置模型",
  /** R03 关键链接：格式非法（blocker）。 */
  "preflight.issue.link_invalid": "链接格式有误",
  /** R03 关键链接：协议不在白名单（blocker）。 */
  "preflight.issue.link_scheme_unsupported": "链接协议不支持",
  /** R03 导出脱敏状态：含联系方式但未开脱敏（verify，仅导出用途）。 */
  "preflight.issue.contact_masking_off": "导出未脱敏",

  // ── 定位作用域 ─────────────────────────────────────────────
  "preflight.scope.document": "整份文档",
  "preflight.scope.section": "板块",
  "preflight.scope.object": "条目",
  "preflight.scope.point": "要点",
  "preflight.scope.field": "字段",
  "preflight.scope.page": "第 {page} 页",
  "preflight.scope.export": "导出文件",

  // ── D11 机器读正文 ─────────────────────────────────────────
  "preflight.tab.issues": "问题清单",
  "preflight.tab.scanner": "机器读正文",
  "preflight.tab.capabilities": "格式能力",
  /** 视图说明：抽取文字是什么。 */
  "preflight.scanner.description": "导出文件里实际能读到的文字，供 ATS 视角核对",
  /** 页面分组。 */
  "preflight.scanner.page": "第 {page} 页",
  /** 没有机器读正文。 */
  "preflight.scanner.empty": "这次检查没有返回机器读正文",
  /** 双栏顺序差异的已知近似说明。 */
  "preflight.scanner.hint": "双栏模板的导出顺序与草稿预览可能不同，属已知近似",
  /** 图例。 */
  "preflight.scanner.legend.missing": "缺失",
  "preflight.scanner.legend.outOfOrder": "顺序不同",
  "preflight.scanner.legend.garbled": "乱码",
  /** 复制抽取正文。 */
  "preflight.scanner.copy": "复制正文",
  "preflight.scanner.copied": "已复制导出正文",
  /** 无差异时的说明。 */
  "preflight.scanner.clean": "抽取出正文与结构化内容一致",

  // ── D08 字体覆盖 ───────────────────────────────────────────
  "preflight.font.title": "字体覆盖",
  /** 缺字读数。 */
  "preflight.font.missing": "缺字 {count} 个",
  /** 缺字列表。 */
  "preflight.font.missingList": "缺字：{chars}",
  /** 粗体可用。 */
  "preflight.font.boldAvailable": "有独立粗体文件",
  /** 粗体会被合成。 */
  "preflight.font.boldFallback": "没有独立粗体文件，粗体为合成效果",
  /** 没有中文字体，无法做缺字检测。 */
  "preflight.font.noFont": "没有可用的中文字体，无法检查缺字",
  /** 尚未检查。 */
  "preflight.font.notChecked": "这次检查没有返回缺字结论",
  /** 缺字列表被后端截断。 */
  "preflight.font.truncated": "缺字较多，这里只列出部分",
  /** 只诊断不改参数。 */
  "preflight.font.hint": "只诊断，不会修改字体设置",
  /** 字体角色名。 */
  "preflight.font.role.regular": "正文",
  "preflight.font.role.bold": "粗体",
  "preflight.font.role.heading": "标题",
  /** 未知字体角色的原始名说明。 */
  "preflight.font.role.unknown": "其它角色",

  // ── 格式能力矩阵 ───────────────────────────────────────────
  "preflight.capability.italic": "斜体",
  "preflight.capability.linkClickable": "链接可点击",
  "preflight.capability.pageNumbers": "页码",
  "preflight.capability.missingGlyph": "缺字检测",
  "preflight.capability.bold": "粗体",
  "preflight.capability.columns": "分栏",
  "preflight.capability.textOrder": "文本顺序",
  "preflight.capability.tables": "表格",
  "preflight.capability.sectionBreaks": "分页控制",
  "preflight.capability.supported": "支持",
  "preflight.capability.approx": "近似",
  "preflight.capability.unsupported": "不支持",
  "preflight.capability.unknown": "未知",
  "preflight.format.html": "HTML",
  "preflight.format.pdf": "精确 PDF",
  "preflight.format.pdfDownload": "下载 PDF",
  "preflight.format.docx": "Word",
  "preflight.format.markdown": "Markdown",
  "preflight.format.txt": "纯文本",
  "preflight.format.json": "JSON",
  /** 能力矩阵第一列表头。 */
  "preflight.capabilities.capability": "能力",
  /** 能力矩阵说明（唯一来源在后端）。 */
  "preflight.capabilities.hint": "能力来自后端统一矩阵，前端不另写判定",
  /** 没有下发能力矩阵。 */
  "preflight.capabilities.empty": "这次检查没有返回能力矩阵",

  // ── 其它 ───────────────────────────────────────────────────
  /** ATS 完整报告入口（短期并存，契约 §4.9 Q3）。 */
  "preflight.ats.open": "查看完整 ATS 报告",
  /** 结果对应的快照指纹（内容版本）。 */
  "preflight.snapshot.label": "检查版本",
  /** 检查版本整行：{label}：{hash}。 */
  "preflight.snapshot.line": "{label}：{hash}",
  /** 免责声明整行：{label}：{text}。 */
  "preflight.disclaimer.line": "{label}：{text}",
  /** 免责声明标签。 */
  "preflight.disclaimer.label": "免责声明",
  /** 检查面板入口按钮（动作条用）。 */
  "preflight.action.open": "检查",
  /** 面板打开按钮的无障碍名。 */
  "preflight.action.openAria": "打开统一检查",
  /** 无法检查的原因：还没有保存过的简历。 */
  "preflight.blocked.unsaved": "先保存这份简历再检查",
  /** 运行中的公开状态（读屏）。 */
  "preflight.status.runningAria": "正在检查",
} as const;

export default preflight;
