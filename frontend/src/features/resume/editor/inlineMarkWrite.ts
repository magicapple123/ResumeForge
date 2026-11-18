// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器侧的**结构化（runs）读写桥**（I-12 · P2 / I-13）。
 *
 * 两个职责，都很薄：
 *
 * 1. **兼容读**（`readRichValue`）：`item.rich` 存在 → 直接用；不存在 → 把 `value` 当**旧标记串**
 *    解析一份出来（退回 `inlineMarkRuns` 的唯一实现）。存量简历没有 `rich`，删掉这条回退
 *    会让它们**静默丢格式**——所以它只标注弃用，本轮不删。
 * 2. **结构化写**（`richToggle*` / `richSetLink*`）：把工具条/右键菜单的一次"改样式"落到
 *    `rich.runs` 上，并避开标记串。没有登记结构化字段时返回 `false`，调用方原样走旧路径
 *    （那条路径服务的是单行 `Input` 等尚未迁移的输入框）。
 *
 * ## 为什么写回要回到文档而不是 DOM
 *
 * 标记版的写回是"把新源串塞回 textarea 再派发 input"；结构化字段的 `value` 恒为纯文本，
 * 改样式不产生新文本，DOM 值根本不用动——样式住在 item 上。所以写回必须走
 * `onRichChange(next)`，由 React 用新的 runs 重画遮罩层。改 DOM 反而会让受控值打架。
 *
 * ## 弃用标注
 *
 * `legacyRichValue` 与 `item.value` 里的 `**` / `{@` / `[]()` 属于 I-12 的 P3 清单
 * （`deliverables/execution/evidence/I-12/verify.md` 的 P3/P4）。在迁移工具跑完、旧备份
 * 兼容窗口关闭之前**不许删**。
 */
import type { RichText } from "../../../types/resumeDocument";
import {
  applyRunPatch,
  clampRichRange,
  emptyRichValue,
  isBoldIn,
  normalizeRuns,
  replaceTextInValue,
  setLinkRuns,
  toggleBoldRuns,
  toggleColorRuns,
  toggleSizeRuns,
  type InlineRange,
  type RichRunPatch,
  type RichValue,
} from "../inline/richRuns";
import { parseInlineMarkRuns } from "./inlineMarkRuns";
import { getRichTarget } from "./lastFocusedTextarea";

/** 能从 item 上读出值的两种形态（正文 `value`、纯文本块的 `text`）。 */
export interface RichSourceItem {
  value?: string;
  text?: string;
  rich?: RichText | null;
}

/**
 * 旧标记串 → 结构化值（**兼容读，勿删**）。
 *
 * `parseInlineMarkRuns` 的输出是"可见文字 + 样式"，拼起来恒等于 `stripInlineMarks(raw)`；
 * 这里只把每段换算成带下标的 run。纯函数、无 IO。
 */
export function legacyRichValue(raw: string): RichValue {
  if (!raw) return emptyRichValue();
  let offset = 0;
  let text = "";
  const runs: RichValue["runs"] = [];
  for (const run of parseInlineMarkRuns(raw)) {
    const start = offset;
    text += run.text;
    offset += run.text.length;
    if (!(run.bold || run.href || run.size !== undefined || run.color)) continue;
    runs.push({
      start,
      end: offset,
      ...(run.bold ? { bold: true } : {}),
      ...(run.href ? { link: run.href } : {}),
      ...(run.size !== undefined ? { size: run.size } : {}),
      ...(run.color ? { color: run.color } : {}),
    });
  }
  return { text, runs: normalizeRuns(runs, text.length) };
}

/**
 * 读一份值：**有 `rich` 用它，没有就退回旧标记串**。
 *
 * `rich.runs` 存在但全部越界（手改过的数据）时退化成纯文本，而不是抛错——编辑框打不开比
 * "格式没了"更糟。
 */
export function readRichValue(item: RichSourceItem): RichValue {
  const raw = item.value ?? item.text ?? "";
  const runs = item.rich?.runs;
  if (Array.isArray(runs)) {
    return { text: raw, runs: normalizeRuns(runs, raw.length) };
  }
  return legacyRichValue(raw);
}

/**
 * 一份值 → item 的 patch：`value` 恒为纯文本，`rich` 只在有样式时写出。
 *
 * `rich: undefined` 让 JSON 序列化把键整个丢掉（后端 `exclude_none` 同一口径），
 * 所以"清掉最后一段样式"不会在磁盘上留一个空 `rich`。
 */
export function richItemPatch(value: RichValue): { value: string; rich?: RichText } {
  return value.runs.length > 0
    ? { value: value.text, rich: { runs: value.runs } }
    : { value: value.text, rich: undefined };
}

/**
 * 同 `richItemPatch`，但写的是 `TextItem.text`（正文文本块用它，不是 `value`）。
 *
 * 两处 **必须分开**：文本块的正文键叫 `text`，字段叫 `value`；写错键不会报错，只会变成
 * "编辑了但没保存"（后端 `extra="ignore"` 静默丢弃那个多余键）。
 */
export function richTextPatch(value: RichValue): { text: string; rich?: RichText } {
  return value.runs.length > 0
    ? { text: value.text, rich: { runs: value.runs } }
    : { text: value.text, rich: undefined };
}

/** 文本改动（打字/删除/粘贴）→ 新值；样式随改动平移（见 `replaceTextInValue`）。 */
export function richOnTextChange(value: RichValue, nextText: string): RichValue {
  return replaceTextInValue(value, nextText);
}

/** 结构化写回的统一入口：没有目标返回 `false`（调用方走旧路径），有则写回文档。 */
function writeBack(range: InlineRange, mutate: (value: RichValue) => RichValue): boolean {
  const target = getRichTarget();
  if (!target) return false;
  const current = target.read();
  const next = mutate(current);
  const selection = clampRichRange(next.text.length, range);
  if (next !== current) target.commit(next, selection);
  return true;
}

/** 加粗（"再点一次取消"）。返回是否由 runs 路径处理。 */
export function richToggleBold(range: InlineRange): boolean {
  return writeBack(range, (value) => toggleBoldRuns(value, range));
}

/** 字号一档（同值再点 = 清除）。 */
export function richToggleSize(range: InlineRange, size: number): boolean {
  return writeBack(range, (value) => toggleSizeRuns(value, range, size));
}

/** 颜色一档（同值再点 = 清除）。 */
export function richToggleColor(range: InlineRange, color: string): boolean {
  return writeBack(range, (value) => toggleColorRuns(value, range, color));
}

/** 显式清除某一项（工具条的「100%（清除）」/「清除颜色」）。 */
export function richClearAttribute(range: InlineRange, patch: RichRunPatch): boolean {
  return writeBack(range, (value) => applyRunPatch(value, range, patch));
}

/** 清除行内格式（加粗/字号/颜色；链接保留）。 */
export function richClearStyles(range: InlineRange): boolean {
  return writeBack(range, (value) =>
    applyRunPatch(value, range, { bold: null, size: null, color: null }),
  );
}

/** 设为链接；空选区会把 URL 当文字插入。 */
export function richSetLink(range: InlineRange, url: string): boolean {
  return writeBack(range, (value) => setLinkRuns(value, range, url));
}

/** 选区当前是否整段加粗（右键菜单显示「加粗」或「取消加粗」）。 */
export function richSelectionIsBold(range: InlineRange): boolean | null {
  const target = getRichTarget();
  if (!target) return null;
  return isBoldIn(target.read(), range);
}
