// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的**上下文面板**（W08 条目级分页 / 溢出定位 + W07 对象级排版）共用的一份"选中"。
 *
 * 选中来源只有一个：大纲面板的 `onSelectionChange`（纸面点击仍走既有 `pickTarget`）。
 * 本 hook 把选中翻译成三份下游需要的形状，避免每个面板各自按 id 现算：
 *
 * | 下游 | 需要什么 | 这里给什么 |
 * | --- | --- | --- |
 * | W08 分页 | 被选中条目 `{id,label}` | `paramsProps.paginationEntry` |
 * | W07 对象排版 | 稳定 objectId + 显示名 | `paramsProps.selectedObjectId/Label` |
 * | W12 来源（后续） | `{object_id,point_id,path}` | `locator` |
 *
 * 溢出定位（OverflowLocator）也在这里接：报告是**用户手动点才取**（不自动请求），
 * 页标记经 `usePaginationReportMarkers` 写进画布既有 store（PageNavigator 已订阅）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";
import { t } from "../../i18n";
import type { OutlineSelection } from "../../features/resume-outline/types";
import { ENTRY_POINT_FIELDS, type EntryField } from "../../features/resume-document/types";
import { resolvePathAt } from "../../features/resume-document/identity";
import {
  locatorWithCandidatePath,
  type ProvenanceLocator,
} from "../../features/resume-provenance/selection";
import type { LocateTarget } from "../../features/resume-pagination/paginationReport";
import { usePaginationReport } from "../../features/resume-pagination/usePaginationReport";
import { usePaginationReportMarkers } from "../../features/resume-pagination/paginationPageMarkers";
import OverflowLocator from "./pagination/OverflowLocator";
import { useWorkbenchProvenancePanels } from "./useWorkbenchProvenancePanels";
import type { PaginationSectionOption } from "./pagination/PaginationControls";
import type { OutlineMultiEntry, OutlineMultiSelectionApi } from "./outline/OutlinePanel";

type AnyEntry = Record<string, unknown>;

const LABEL_KEYS = ["company", "school", "organization", "name", "role", "title", "major"];

function findEntry(
  content: ResumeContent | null | undefined,
  objectId: string | null,
): { entry: AnyEntry; field: EntryField; index: number } | null {
  if (!content || !objectId) return null;
  for (const field of Object.keys(ENTRY_POINT_FIELDS) as EntryField[]) {
    const entries = (content as unknown as Record<string, unknown>)[field];
    if (!Array.isArray(entries)) continue;
    const index = entries.findIndex((item) => {
      const entry = item as AnyEntry | null;
      return Boolean(entry && typeof entry === "object" && entry.id === objectId);
    });
    if (index >= 0) return { entry: entries[index] as AnyEntry, field, index };
  }
  return null;
}

function entryLabel(entry: AnyEntry | null): string {
  if (!entry) return "";
  for (const key of LABEL_KEYS) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return t("workbench.selection.entry");
}

/** 要点选择：按 point_ids 找文本，给对象面板/分页一个可读名字。 */
function pointLabel(
  content: ResumeContent | null | undefined,
  selection: OutlineSelection | null,
): string {
  if (!content || selection?.kind !== "point") return "";
  const found = findEntry(content, selection.objectId);
  if (!found) return "";
  const ids = found.entry.point_ids as Record<string, unknown> | undefined;
  const pointIds = ids?.[selection.pointField];
  const items = found.entry[selection.pointField];
  if (!Array.isArray(pointIds) || !Array.isArray(items)) return "";
  const index = (pointIds as unknown[]).indexOf(selection.pointId);
  const text = index >= 0 ? items[index] : null;
  if (typeof text !== "string" || !text.trim()) return "";
  return text.trim().length > 24 ? `${text.trim().slice(0, 24)}…` : text.trim();
}

interface Options {
  content?: ResumeContent | null;
  resumeId?: number;
  layout?: ResumeLayout;
  /** 未保存正文：溢出报告按"用户眼前这一版"算（不落库）。 */
  draftContent?: ResumeContent | null;
  sectionOptions?: PaginationSectionOption[];
  /** 定位到字段：复用纸面点击链路（`pickFromPaper`）。 */
  onLocateField: (path: string) => void;
  /** W12 候选采纳：宿主写回内容并记为一步历史。 */
  onApplyContent?: (next: ResumeContent) => void;
}

export interface WorkbenchContextPanels {
  /** 直接展开给 `WorkbenchParamsColumn` 的 props（外壳只写一行）。 */
  paramsProps: {
    paginationEntry: { id: string; label: string } | null;
    onOutlineSelectionChange: (selection: OutlineSelection | null) => void;
    selectedObjectId: string | null;
    selectedObjectLabel: string;
    sourcesPanel: ReactNode;
    /** W07 多选（大纲空格键勾选）：批量调整与格式刷的目标。 */
    multiSelectedEntries: OutlineMultiEntry[];
    onMultiSelectionChange: (entries: OutlineMultiEntry[]) => void;
    multiSelectionApiRef: RefObject<OutlineMultiSelectionApi | null>;
    onClearMultiSelect: () => void;
  };
  /** W12 后续消费：`{object_id, point_id, path}`。 */
  locator: ProvenanceLocator;
  /** 画布顶部横幅：溢出定位（用户点「获取分页报告」才请求）。 */
  canvasBanner: ReactNode;
}

export function useWorkbenchContextPanels({
  content,
  resumeId,
  layout,
  draftContent,
  sectionOptions,
  onLocateField,
  onApplyContent,
}: Options): WorkbenchContextPanels {
  const [selection, setSelection] = useState<OutlineSelection | null>(null);
  // 定位 = 大纲选择 + 可改写字段路径：要点选择用它现算出 path（W12 写候选要这个 path），
  // 纸面/fe-outline 若已在选择里给出 path 则原样采用。条目级选择保持"不替用户挑字段"。
  const locator = useMemo(
    () => locatorWithCandidatePath(selection, content ?? null),
    [content, selection],
  );
  // W07 多选集合由大纲上报、这里持有：大纲面板在"排版参数 / 文档大纲"切页签时会卸载，
  // 集合若只住在大纲里，用户一切到参数栏就丢了——那就永远点不到批量调整。
  const [multiSelected, setMultiSelected] = useState<OutlineMultiEntry[]>([]);
  const multiSelectionApiRef = useRef<OutlineMultiSelectionApi | null>(null);
  const clearMultiSelect = useCallback(() => {
    multiSelectionApiRef.current?.clearMultiSelect();
    setMultiSelected([]);
  }, []);
  // 换简历：上一条的多选不能跟过来（对象 id 属于另一份文档）。仓库既有写法——
  // 随入参变化的重置用渲染期守卫，而不是 effect 里同步 setState（避免级联渲染告警）。
  const [multiResumeId, setMultiResumeId] = useState(resumeId);
  if (multiResumeId !== resumeId) {
    setMultiResumeId(resumeId);
    setMultiSelected([]);
  }

  const selectedEntry = useMemo(() => {
    const objectId =
      selection?.kind === "entry" || selection?.kind === "point" ? selection.objectId : null;
    const found = findEntry(content, objectId);
    const label = pointLabel(content, selection) || entryLabel(found?.entry ?? null);
    return found && objectId ? { id: objectId, label: label || entryLabel(found.entry) } : null;
  }, [content, selection]);

  const provenance = useWorkbenchProvenancePanels({
    resumeId,
    locator,
    content,
    onApplyContent,
  });

  const buildRequest = useCallback(() => {
    if (!layout) return null;
    return {
      template: layout.template,
      format_name: layout.format_name,
      page_limit: Number(layout.page_limit) || 1,
      font_scale: layout.font_scale,
      format_config: layout.format_config as Record<string, unknown>,
      language: layout.language,
      ...(draftContent ? { content: draftContent } : {}),
    };
  }, [draftContent, layout]);

  const report = usePaginationReport({ resumeId, buildRequest });
  usePaginationReportMarkers(report.report);

  const sectionLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const option of sectionOptions ?? []) labels[option.key] = option.label;
    return labels;
  }, [sectionOptions]);

  const handleLocate = useCallback(
    (target: LocateTarget) => {
      if (target.objectId && content) {
        const path = resolvePathAt(content, target.objectId);
        if (path) {
          onLocateField(path);
          return;
        }
      }
      if (target.section) onLocateField(target.section);
      // `page` 定位由画布 PageNavigator 订阅 pageMarkersStore 完成（本层不持有其句柄）。
    },
    [content, onLocateField],
  );

  const canvasBanner = (
    <div
      style={{
        flex: "0 0 auto",
        padding: "8px 12px",
        borderBottom: "1px solid var(--rf-border-subtle)",
        background: "var(--rf-surface)",
      }}
    >
      <OverflowLocator
        report={report.report}
        loading={report.loading}
        error={report.error || null}
        onRefresh={() => void report.run()}
        onLocate={handleLocate}
        sectionLabels={sectionLabels}
      />
    </div>
  );

  return {
    paramsProps: {
      paginationEntry: selectedEntry,
      onOutlineSelectionChange: setSelection,
      selectedObjectId: selectedEntry?.id ?? null,
      selectedObjectLabel: selectedEntry?.label ?? "",
      sourcesPanel: provenance.sourcesPanel,
      multiSelectedEntries: multiSelected,
      onMultiSelectionChange: setMultiSelected,
      multiSelectionApiRef,
      onClearMultiSelect: clearMultiSelect,
    },
    locator,
    canvasBanner,
  };
}
