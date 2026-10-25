// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲面板的**宿主出口**：多选集合上报与「清空多选」句柄。
 *
 * 从 `OutlinePanel` 拆出的理由：面板本身贴住单文件 500 行预算，而这两段只是把内部状态
 * 按宿主需要的形状交出去，与树的渲染/排序无关。上报的去重判据按稳定 id 拼签名，而不是
 * 对象引用——大纲每次重排都会生成新的行对象，按引用比会变成"每次都上报"。
 */
import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { t } from "../../../i18n";
import type { EntryField } from "../../../features/resume-document/types";
import type { OutlineEntry } from "../../../features/resume-outline/model";

/** W07 多选工具条消费的最小形状（id 是稳定 objectId，不是下标）。 */
export interface OutlineMultiEntry {
  id: string;
  label: string;
  meta: string;
  field: EntryField;
}

/** 多选工具的宿主句柄（目前只有清空；应用样式仍走 onCommand/宿主保存链路）。 */
export interface OutlineMultiSelectionApi {
  clearMultiSelect: () => void;
}

export interface OutlineHostBridgeOptions {
  /** 当前多选集合（形状摊平与去重都在这里做）。 */
  entries: OutlineEntry[];
  onMultiSelectionChange?: (entries: OutlineMultiEntry[]) => void;
  multiSelectionApiRef?: RefObject<OutlineMultiSelectionApi | null>;
  /** 清空多选（工具条「取消选择」/ 批量应用后调用）。 */
  clearMultiSelect: () => void;
}

export function useOutlineHostBridge({
  entries,
  onMultiSelectionChange,
  multiSelectionApiRef,
  clearMultiSelect,
}: OutlineHostBridgeOptions): void {
  const multiEntries = useMemo<OutlineMultiEntry[]>(
    () =>
      entries.map((entry) => ({
        id: entry.objectId,
        label: entry.title || t("outline.entry.untitled"),
        meta: entry.subtitle,
        field: entry.field,
      })),
    [entries],
  );
  const signature = multiEntries.map((entry) => `${entry.field}:${entry.id}`).join("|");
  const lastSignature = useRef("");
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    onMultiSelectionChange?.(multiEntries);
  }, [multiEntries, onMultiSelectionChange, signature]);

  // 句柄对象只在 clearMultiSelect 换引用时重建（宿主拿到的是稳定接口）。
  useEffect(() => {
    if (!multiSelectionApiRef) return;
    multiSelectionApiRef.current = { clearMultiSelect };
    return () => {
      multiSelectionApiRef.current = null;
    };
  }, [clearMultiSelect, multiSelectionApiRef]);
}
