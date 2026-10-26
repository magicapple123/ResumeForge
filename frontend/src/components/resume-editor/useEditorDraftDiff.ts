// SPDX-License-Identifier: Apache-2.0
/**
 * 草稿 vs 当前表单内容的差异摘要（从 `useResumeEditorPanel` 拆出：500 行预算）。
 *
 * 方向是 `summarizeDraftDiff(现在, 草稿)`：用户展开差异是想知道"点恢复会改掉什么"，
 * 所以左侧必须是当前值。`pending.values` 只是**被改过的那几个字段**（表单值快照），
 * 叠到当前值上就得到"草稿若恢复会变成的内容"。
 */
import { useMemo } from "react";
import type { FormInstance } from "antd";
import type { ResumeContent } from "../../types";
import { summarizeDraftDiff, type DraftDiffEntry } from "../../utils/draftDiff";

/** `pending` 为 null = 没有草稿可恢复；空数组 = 有草稿但与现在一致。 */
export function useEditorDraftDiff(
  pending: { values: Record<string, unknown> } | null,
  form: FormInstance<ResumeContent>,
  watched: ResumeContent | undefined,
): DraftDiffEntry[] | null {
  return useMemo(() => {
    if (!pending) return null;
    const current = (watched ?? form.getFieldsValue(true) ?? {}) as ResumeContent;
    const drafted = { ...current, ...pending.values } as ResumeContent;
    return summarizeDraftDiff(current, drafted);
  }, [pending, form, watched]);
}
