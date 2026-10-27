// SPDX-License-Identifier: Apache-2.0
/**
 * 数据集导入结果的提示文案（R16 嵌套整包）。
 *
 * 整包不再"要么全成、要么不动"：一份子包坏了只跳过那一份，其余照常恢复。所以"导入
 * 成功"的提示之外，还必须**逐份点名**谁没恢复成功——否则用户以为整包都回来了。
 *
 * 设置页与全局拖入导入共用这一份拼装逻辑，避免两处措辞/截断规则各写一遍。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { DatasetImportIssue } from "../../types";

/** 逐份问题的两种口径：各自的整句与「另有 N 份」后缀（模块作用域只存 key）。 */
type IssueKind = "failed" | "skipped";

const SUMMARY_KEYS: Record<IssueKind, { summary: MessageKey; rest: MessageKey }> = {
  failed: {
    summary: "featuresMisc.datasetImport.failedSummary",
    rest: "featuresMisc.datasetImport.failedRest",
  },
  skipped: {
    summary: "featuresMisc.datasetImport.skippedSummary",
    rest: "featuresMisc.datasetImport.skippedRest",
  },
};

function summarize(kind: IssueKind, items: DatasetImportIssue[]): string {
  // 逐份点名（最多 3 条）：只说"另外 N 份"用户还是不知道是哪几份。
  const shown = items
    .slice(0, 3)
    .map((item) =>
      t("featuresMisc.datasetImport.item", {
        name: item.name || item.id || t("featuresMisc.datasetImport.unnamed"),
        reason: item.error,
      }),
    )
    .join(t("featuresMisc.datasetImport.separator"));
  const rest = items.length - 3;
  const summary = t(SUMMARY_KEYS[kind].summary, { count: items.length, items: shown });
  return rest > 0 ? summary + t(SUMMARY_KEYS[kind].rest, { count: rest }) : summary;
}

/** 把逐份失败/跳过拼成一条可直接展示的提示；两者都为空时返回 null。 */
export function describeImportIssues(
  failed: DatasetImportIssue[] | undefined,
  skipped: DatasetImportIssue[] | undefined,
): string | null {
  const parts: string[] = [];
  if (failed?.length) parts.push(summarize("failed", failed));
  if (skipped?.length) parts.push(summarize("skipped", skipped));
  return parts.length > 0 ? parts.join(t("featuresMisc.datasetImport.separator")) : null;
}
