// SPDX-License-Identifier: Apache-2.0
/**
 * 数据集导入结果的提示文案（R16 嵌套整包）。
 *
 * 整包不再"要么全成、要么不动"：一份子包坏了只跳过那一份，其余照常恢复。所以"导入
 * 成功"的提示之外，还必须**逐份点名**谁没恢复成功——否则用户以为整包都回来了。
 *
 * 设置页与全局拖入导入共用这一份拼装逻辑，避免两处措辞/截断规则各写一遍。
 */
import type { DatasetImportIssue } from "../../types";

function summarize(label: "失败" | "跳过", items: DatasetImportIssue[]): string {
  // 逐份点名（最多 3 条）：只说"另外 N 份"用户还是不知道是哪几份。
  const shown = items
    .slice(0, 3)
    .map((item) => `${item.name || item.id || "未命名数据集"}：${item.error}`)
    .join("；");
  const rest = items.length - 3;
  return `${items.length} 份数据集${label}：${shown}${rest > 0 ? `；另有 ${rest} 份${label}` : ""}`;
}

/** 把逐份失败/跳过拼成一条可直接展示的提示；两者都为空时返回 null。 */
export function describeImportIssues(
  failed: DatasetImportIssue[] | undefined,
  skipped: DatasetImportIssue[] | undefined,
): string | null {
  const parts: string[] = [];
  if (failed?.length) parts.push(summarize("失败", failed));
  if (skipped?.length) parts.push(summarize("跳过", skipped));
  return parts.length > 0 ? parts.join("；") : null;
}
