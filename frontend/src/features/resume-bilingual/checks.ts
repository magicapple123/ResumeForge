// SPDX-License-Identifier: Apache-2.0
/**
 * 中英一致性检查（W16 / D07、D15）：日期格式、标点、中英空格、长链接。
 *
 * ## 定位
 *
 * 这些是**本地确定性建议**（advisory），不是硬失败：不调模型、不改内容、不阻塞导出
 * （plan §D07「标点与空格一致性检查、日期格式统一、长 URL 换行预览」）。
 * 真正的阻断只有事实锁与导出闸门，不在这里。
 *
 * ## 规则口径
 *
 * - 主列按中文、次列按英文处理（与 `BilingualCompareView` 的列顺序一致）；
 * - 先把 URL 与邮箱从文本里摘掉再判标点/空格——它们天然带半角 `:` `/` `.`，
 *   不摘会每一行都报"标点不对"，等于噪音；
 * - 全部规则纯函数、可单测。
 */
import type { BilingualHint, BilingualPair } from "./types";

/** 中文正文里不该出现的半角标点（URL/邮箱已剔除）。 */
const HALF_WIDTH_PUNCT = /[,;:!?]/;
/** 英文正文里不该出现的全角标点。 */
const FULL_WIDTH_PUNCT = /[\uff0c\uff1b\uff1a\uff01\uff1f]/;
/** CJK 字符（用 \u 转义写，源码里不出现中文字符）。 */
const CJK_CHAR = /[\u4e00-\u9fff]/;
/** 中英文紧贴（缺空格）。 */
const CJK_ASCII_ADJACENT = /[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/;
const URL_OR_EMAIL = /(?:https?:\/\/\S+|\S+@\S+\.\S+)/g;
const DATE_TOKEN = /(\d{4})([.\-/])(\d{1,2})/;
const LONG_URL = /https?:\/\/\S{40,}/;

function stripLinks(text: string): string {
  return text.replace(URL_OR_EMAIL, " ");
}

function dateSeparator(text: string): string | null {
  const match = DATE_TOKEN.exec(text);
  return match ? match[2] : null;
}

function pushUnique(hints: BilingualHint[], hint: BilingualHint): void {
  if (hints.some((item) => item.id === hint.id)) return;
  hints.push(hint);
}

/** 单行字段的全部建议。 */
export function checkPair(pair: BilingualPair): BilingualHint[] {
  const hints: BilingualHint[] = [];
  const primary = pair.primary;
  const secondary = pair.secondary;
  if (!primary && !secondary) return hints;

  const primaryPlain = stripLinks(primary);
  const secondaryPlain = stripLinks(secondary);

  if (HALF_WIDTH_PUNCT.test(primaryPlain) || FULL_WIDTH_PUNCT.test(secondaryPlain)) {
    pushUnique(hints, {
      id: "punctuation:" + pair.id,
      kind: "punctuation",
      path: pair.path,
      label: pair.label,
    });
  }

  if (CJK_CHAR.test(primary) && CJK_ASCII_ADJACENT.test(primaryPlain)) {
    pushUnique(hints, {
      id: "spacing:" + pair.id,
      kind: "spacing",
      path: pair.path,
      label: pair.label,
    });
  }

  const primarySeparator = dateSeparator(primary);
  const secondarySeparator = dateSeparator(secondary);
  if (primarySeparator && secondarySeparator && primarySeparator !== secondarySeparator) {
    pushUnique(hints, {
      id: "date_format:" + pair.id,
      kind: "date_format",
      path: pair.path,
      label: pair.label,
    });
  }

  if (LONG_URL.test(primary) || LONG_URL.test(secondary)) {
    pushUnique(hints, {
      id: "long_url:" + pair.id,
      kind: "long_url",
      path: pair.path,
      label: pair.label,
    });
  }
  return hints;
}

/** 整份对照的建议列表（顺序：按行出现顺序，同 kind 去重）。 */
export function collectHints(pairs: readonly BilingualPair[]): BilingualHint[] {
  const hints: BilingualHint[] = [];
  for (const pair of pairs) {
    for (const hint of checkPair(pair)) pushUnique(hints, hint);
  }
  return hints;
}

/** 建议的种类计数（界面上"共 N 条建议"用）。 */
export function hintCount(hints: readonly BilingualHint[]): number {
  return hints.length;
}
