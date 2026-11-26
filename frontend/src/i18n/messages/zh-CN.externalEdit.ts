// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历「在应用内改字 / 历史版本」（#5）的界面文案。
 *
 * 为什么单独成命名空间：这批 key 有五十余条，而 `zh-CN.resumesPage.ts` 与主文件都在
 * 500 行硬预算上；`resumesPage.external.*` 那一组讲的是"列表与只读的详情"，编辑流程
 * 是另一件事，混在一起会让两边都读不下去。
 *
 * ## 哪些 key 对应协议值、哪些是界面的话
 *
 * `externalEdit.reason.*` 的**后缀是后端的原因码**（`pdf_block_rotated` 等），前端只做
 * 翻译，不自己发明分类——后端新增一个分支时，这里回落到 `externalEdit.reason.unknown`。
 * `externalEdit.revisions.source.*` 同理（`upload` / `edit` / `restore`）。
 *
 * ## 措辞上刻意说清的几件事实
 *
 * - PDF 只能"覆盖式改字"：字体不是原字体（`keepFormatHint`）；
 * - 块变高**默认不动**下方内容，要动必须点按钮（`overflow.*` / `shift.*`）；
 * - 恢复历史是"再存一版"，不是"删掉后来的"（`revisions.restored`）。
 */

const externalEdit = {
  // ── 页签 ───────────────────────────────────────────────────
  "externalEdit.tab.edit": "编辑",
  "externalEdit.tab.revisions": "历史版本",

  // ── 取块 / 能力探测 ────────────────────────────────────────
  "externalEdit.blocksLoading": "正在分析这份文件能改哪些地方…",
  "externalEdit.blocksFailed": "没能读到这份文件的编辑单元",
  "externalEdit.blocksFailedHint": "可能是网络或服务暂时不可用；原件不受影响，可以重试。",
  // 404 单独一套话：原件文件真的不在了，这时再说"原件不受影响"是自相矛盾。
  "externalEdit.blocksMissingTitle": "原件文件已不在本机",
  "externalEdit.blocksMissingHint":
    "这份简历的原件文件已经不在这台机器上（可能被移动或删除了），没法在线改字。请重新上传这一份，或到「历史版本」里下载还能用的那一版。",
  "externalEdit.blocksEmpty": "这份文件里没有找到可改的文字",
  "externalEdit.unsupported.title": "这份文件不支持在线编辑",
  "externalEdit.unsupported.hint":
    "扫描件、已转曲（文字变成图形）的 PDF、加密或带表单的 PDF 都不能在线改字。请下载原件，用本地工具改完再重新上传。",
  "externalEdit.download": "下载原件",
  "externalEdit.blockWarnings": "编辑前先看这几条说明",
  "externalEdit.previewLoading": "正在渲染原件页面…",
  "externalEdit.previewFailed": "原件页面没能渲染出来",

  // ── 左侧选择区 ────────────────────────────────────────────
  "externalEdit.hint.pdf":
    "左边是原件页面，点一下要改的那一段（虚线的块不能改，原因见下方列表）。改完点右边「应用」。",
  "externalEdit.hint.docx": "这里按段落列出可以改的文字，点一段在右边改。表格里的文字暂不支持。",
  "externalEdit.hint.text": "整篇正文就是一个编辑单元，在右边直接改。",
  "externalEdit.hint.pick": "先在左边点一段文字，再在右边改。",
  "externalEdit.block.label": "第 {page} 页 · 第 {index} 段",
  "externalEdit.block.labelNoPage": "第 {index} 段",
  "externalEdit.block.empty": "（这一段没有文字）",
  "externalEdit.notEditableTitle": "这一块不能改",
  "externalEdit.notEditableList": "下面这些块不能改（已标出原因）",

  // ── 右侧表单 ──────────────────────────────────────────────
  "externalEdit.textarea.label": "要改成什么",
  "externalEdit.textarea.placeholder": "改完点「应用」，会另存成一个新版本",
  "externalEdit.chars": "{count} 字",
  "externalEdit.fontSize": "字号 {size} pt",
  "externalEdit.apply": "应用",
  "externalEdit.unchanged": "文字没有变化",
  "externalEdit.emptyText": "内容不能为空；要删掉这一段请用本地工具处理",
  "externalEdit.applyFailed": "这次没有改成",
  "externalEdit.keepFormatHint":
    "PDF 只能覆盖式改字：字体用系统的中文字体（不是原字体），块内会按原宽度重新断行，页数与其它内容不动。",
  "externalEdit.overflow.title": "新文字比原来高，压到了下方内容",
  "externalEdit.overflow.body":
    "这一段从 {before} 行变成 {after} 行，超出 {delta} pt。可以先改短一些，或把下面的内容整体下移。",
  "externalEdit.shift.action": "下移下方内容 {delta} pt",
  "externalEdit.scaled": "新文字超出原块宽度，已自动缩小字号。",
  "externalEdit.shifted": "已把下方内容整体下移。",

  // ── 不可编辑的原因（后缀 = 后端原因码）──────────────────────
  "externalEdit.reason.pdf_block_not_found": "这一块已经不存在了，刷新后再试。",
  "externalEdit.reason.pdf_block_not_editable": "这一块不是普通文本（表格、图片或版式元素里的字）。",
  "externalEdit.reason.pdf_block_rotated": "这一块是旋转或倾斜的文字，只支持水平文字。",
  "externalEdit.reason.pdf_block_missing_glyphs": "这一块用的字体里缺字，改完显示不出来。",
  "externalEdit.reason.pdf_page_rotated": "这一页是旋转页，暂不支持。",
  "externalEdit.reason.pdf_erase_failed": "没能定位到这块文字在文件里的位置，为避免压坏原文已中止。",
  "externalEdit.reason.pdf_edit_verify_failed": "改完自检没通过（可能压到了别的内容），已放弃保存。",
  "externalEdit.reason.pdf_parse_failed": "这份 PDF 解析失败，无法定位文字。",
  "externalEdit.reason.pdf_encrypted": "这份 PDF 有加密保护。",
  "externalEdit.reason.pdf_form_fields": "这份 PDF 带可填写表单，暂不支持改字。",
  "externalEdit.reason.pdf_no_text_layer": "这份 PDF 没有文字层（扫描件或纯图片）。",
  "externalEdit.reason.pdf_outlined_text": "这份 PDF 的文字已转曲（变成图形），改不了。",
  "externalEdit.reason.pdf_unsupported": "这份 PDF 的格式不在支持范围内。",
  "externalEdit.reason.docx_text_in_table": "这一段在表格里，为避免打乱表格暂不支持。",
  "externalEdit.reason.docx_paragraph_not_editable": "这一段没有可改的文字（图片、空白或域代码）。",
  "externalEdit.reason.edit_unsupported_kind": "这个文件类型不支持在线编辑。",
  "externalEdit.reason.unknown": "这一块不能在线改。",

  // ── 历史版本 ──────────────────────────────────────────────
  "externalEdit.revisions.loading": "正在读取历史版本…",
  "externalEdit.revisions.failed": "读取历史版本失败",
  "externalEdit.revisions.empty": "还没有历史版本：这个文件只有当前这一份。",
  "externalEdit.revisions.chars": "{count} 字",
  "externalEdit.revisions.hasText": "有文字",
  "externalEdit.revisions.noText": "未提取到文字",
  "externalEdit.revisions.current": "当前版本",
  "externalEdit.revisions.restore": "恢复到此版本",
  "externalEdit.revisions.restoreFailed": "恢复失败",
  "externalEdit.revisions.restored": "已恢复到这个版本的内容（写成了一条新版本，历史不会被删除）",
  "externalEdit.revisions.source.upload": "上传",
  "externalEdit.revisions.source.edit": "编辑",
  "externalEdit.revisions.source.restore": "恢复",
  "externalEdit.revisions.source.unknown": "其它来源",
};

export default externalEdit;
