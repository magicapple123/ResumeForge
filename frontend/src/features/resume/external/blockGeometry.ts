// SPDX-License-Identifier: Apache-2.0
/**
 * PDF 文本块的几何换算：后端 bbox（pt，**原点在左下角**）→ 页面上的百分比矩形。
 *
 * ## 为什么换算成百分比而不是像素
 *
 * 热区是按页面上那段文字的实际位置画的：左上角 `top` 要把 PDF 的下原点翻过来
 * （`page_height - y1`）。用百分比定位后，页面缩放、抽屉变窄、`canvas` 用 CSS 宽度
 * 铺满 —— 都不需要重算热区坐标，也就没有"重算漏了一处 → 热区错位"这种 bug。
 *
 * ## 为什么全在这里（纯函数）
 *
 * 「y 翻转」是这套换算里唯一会静默错的地方：写反了热区会上下颠倒，但页面照样能渲染、
 * 点击也能触发，只是点到的是别的块。抽成纯函数后单测可以直接钉住那一个减法，
 * 组件里也就没有第二份实现。
 */
import type { MessageKey } from "../../../i18n";
import type { ExternalResumeBlock } from "../../../api/externalResumes";

/** 页面内的百分比矩形（0–100）。 */
export interface BlockRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 页面尺寸（pt），与 `ExternalResumeBlocks.page_width / page_height` 同源。 */
export interface PageBox {
  width: number;
  height: number;
}

/** 保留 3 位小数：足够精确，又能让内联样式串稳定（断言与快照不抖）。 */
function percent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 把一块的 bbox 换算成页面内的百分比矩形。
 *
 * @returns 页面尺寸缺失（docx / text 的几何字段恒为 0）、或 bbox 退化（宽或高 ≤ 0）时
 *   返回 `null` —— 这类块没有可画的区域，界面不应给它一个 0×0 的热区。
 */
export function blockPercentRect(block: ExternalResumeBlock, page: PageBox): BlockRect | null {
  if (!(page.width > 0) || !(page.height > 0)) return null;
  const x0 = Math.min(block.x0, block.x1);
  const x1 = Math.max(block.x0, block.x1);
  const y0 = Math.min(block.y0, block.y1);
  const y1 = Math.max(block.y0, block.y1);
  const widthPt = x1 - x0;
  const heightPt = y1 - y0;
  if (!(widthPt > 0) || !(heightPt > 0)) return null;
  return {
    left: percent((x0 / page.width) * 100),
    // 翻转 y：PDF 原点在左下角，屏幕坐标原点在左上角。
    top: percent(((page.height - y1) / page.height) * 100),
    width: percent((widthPt / page.width) * 100),
    height: percent((heightPt / page.height) * 100),
  };
}

/** 某一页上的块（按后端给的顺序，不重排：顺序就是阅读顺序）。 */
export function blocksOfPage(blocks: readonly ExternalResumeBlock[], page: number): ExternalResumeBlock[] {
  return blocks.filter((block) => block.page === page);
}

/** 「下移下方内容」要传给后端的量（pt）：后端允许 0–200，非整数会让覆盖层位置抖。 */
export const MAX_SHIFT_PT = 200;

/**
 * 块变高时，「下移下方内容」按钮实际提交的位移。
 *
 * 取上整（`ceil`）而不是四舍五入：少移一点就会压住下一行，多移 1pt 看不出来。
 * 位移 ≤ 0（块没变高）时返回 0 —— 按钮不该出现，也不该真的动任何东西。
 */
export function shiftBelowAmount(deltaPt: number): number {
  if (!Number.isFinite(deltaPt) || deltaPt <= 0) return 0;
  return Math.min(MAX_SHIFT_PT, Math.max(1, Math.ceil(deltaPt)));
}

/**
 * 不可编辑的原因码 → 中文解释的 key。
 *
 * 与后端 `external_resume_pdf.py` / `external_resume_pdf_scan.py` /
 * `external_resume_edit.py` 里的 `CODE_*` 常量逐字对应；认不出的码（后端新增了分支）
 * 回落到一句通用解释，绝不显示原始码。
 */
const REASON_KEYS: Record<string, MessageKey> = {
  pdf_block_not_found: "externalEdit.reason.pdf_block_not_found",
  pdf_block_not_editable: "externalEdit.reason.pdf_block_not_editable",
  pdf_block_rotated: "externalEdit.reason.pdf_block_rotated",
  pdf_block_missing_glyphs: "externalEdit.reason.pdf_block_missing_glyphs",
  pdf_page_rotated: "externalEdit.reason.pdf_page_rotated",
  pdf_erase_failed: "externalEdit.reason.pdf_erase_failed",
  pdf_edit_verify_failed: "externalEdit.reason.pdf_edit_verify_failed",
  pdf_parse_failed: "externalEdit.reason.pdf_parse_failed",
  pdf_encrypted: "externalEdit.reason.pdf_encrypted",
  pdf_form_fields: "externalEdit.reason.pdf_form_fields",
  pdf_no_text_layer: "externalEdit.reason.pdf_no_text_layer",
  pdf_outlined_text: "externalEdit.reason.pdf_outlined_text",
  pdf_unsupported: "externalEdit.reason.pdf_unsupported",
  docx_text_in_table: "externalEdit.reason.docx_text_in_table",
  docx_paragraph_not_editable: "externalEdit.reason.docx_paragraph_not_editable",
  edit_unsupported_kind: "externalEdit.reason.edit_unsupported_kind",
};

/** 原因码 → 文案 key；空串或未知码回落到通用解释。 */
export function reasonKey(reason: string): MessageKey {
  return REASON_KEYS[reason] ?? "externalEdit.reason.unknown";
}

/** 历史版本的来源（协议值）→ 文案 key。 */
export function revisionSourceKey(source: string): MessageKey {
  if (source === "upload") return "externalEdit.revisions.source.upload";
  if (source === "edit") return "externalEdit.revisions.source.edit";
  if (source === "restore") return "externalEdit.revisions.source.restore";
  return "externalEdit.revisions.source.unknown";
}

/** 块的语汇（列表里那个「标题 / 正文 / 锁定」角标）。 */
export type BlockRole = "title" | "body";

/**
 * 这一段是标题还是正文。
 *
 * 判据只有"字号是不是全篇最大的那一档"加"文字够短"：PDF 里标题的字号明显更大，
 * 而 DOCX / TXT 的几何字段恒为 0（`size` 为 0），一律当正文——宁可少标一个标题，
 * 也不要把一段长正文误标成标题。
 */
export function blockRoleOf(block: ExternalResumeBlock, maxSize: number): BlockRole {
  if (!(block.size > 0) || !(maxSize > 0)) return "body";
  const short = block.text.trim().length > 0 && block.text.trim().length <= 40;
  return block.size >= maxSize * 0.9 && short ? "title" : "body";
}

/** 全篇最大的块字号（没有几何信息时返回 0，交给 `blockRoleOf` 兜底）。 */
export function maxBlockSize(blocks: readonly ExternalResumeBlock[]): number {
  return blocks.reduce((max, block) => (block.size > max ? block.size : max), 0);
}

/**
 * 列表里那一行摘要：只取首行，超长截断。
 *
 * 保存块原文的完整内容没有意义（一张 PDF 可能有几万字），列表要的是"这是哪一段"。
 */
export function blockPreviewText(text: string, limit = 48): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}…`;
}

/**
 * 新文字在这一块里一行放不下（= 大概率会撑高、压到下方内容）。
 *
 * 估算而不是精算：按"全角字符宽度 ≈ 字号"折算每行能放几个字，超了就提示。
 * 只用于**输入时的预警**，真正的溢出由服务端 `overflow` 判定，两者各司其职。
 */
export function exceedsBlockWidth(block: ExternalResumeBlock, text: string): boolean {
  const widthPt = Math.abs(block.x1 - block.x0);
  if (!(widthPt > 0) || !(block.size > 0)) return false;
  const perLine = Math.max(1, Math.floor(widthPt / block.size));
  return text.split(/\r?\n/).some((line) => line.length > perLine);
}

/**
 * 这一版与**上一版**的字数差（`+13` / `-5`）。
 *
 * 列表是时间倒序（新的在前），所以"上一版"就是数组里下一条；最老的一版没有
 * 可比的上一版，返回 `null`，界面写「首版」而不是 `+0`。
 */
export function revisionDiffChars(
  items: readonly { text_chars: number }[],
  index: number,
): number | null {
  const older = items[index + 1];
  if (older === undefined) return null;
  return items[index].text_chars - older.text_chars;
}

/** 字数差的展示串（永远带符号，0 也写成 `±0`）。 */
export function formatCharDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "±0";
}
