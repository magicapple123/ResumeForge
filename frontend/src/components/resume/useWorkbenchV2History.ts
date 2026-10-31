// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 → 统一历史的 v2 接线：快照 = {document, layout}，撤销/恢复同时还原正文与版式。
 *
 * 与旧 useWorkbenchHistory 的分工：旧快照里还有 overlays（v1 字段路径的纸面加粗），
 * v2 的路径体系里没有它，所以这里只保留文档与版式两个维度。历史栈本身复用
 * features/resume-document/history 的纯快照栈（300ms 合并、最多 50 步、flush 语义一致）。
 *
 * 谁往历史里写：
 * - 中栏/结构面板改文档 → 合并键 draft（连续输入合并成一步）；
 * - 左栏排版参数 → 合并键 layout（连续拖动合并成一步）；
 * - 复制/隐藏/拖拽落点等结构命令 → 无合并键，独立成步。
 *
 * 外部正文变化（保存成功 / 用最新的 / 版本恢复）→ reset：清栈并以新文档为基线。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ResumeLayout } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import { createDocumentHistory } from "../../features/resume-document/history";
import { t } from "../../i18n";
import type { HistoryPanelStep } from "./history/HistoryPanel";

/** 左栏「历史」页签的接线面（与旧 useWorkbenchHistory 同名同形，HistoryPanel 直接消费）。 */
export interface WorkbenchHistoryTab {
  past: HistoryPanelStep[];
  future: HistoryPanelStep[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onJumpTo: (group: "past" | "future", index: number) => void;
}

export interface WorkbenchV2Snapshot {
  document: ResumeDocument;
  layout: ResumeLayout;
}

const EMPTY_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

const EMPTY_DOCUMENT: ResumeDocument = {
  version: 2,
  language: "zh-CN",
  header: { items: [], contact_breaks: [] },
  sections: [],
};

const DRAFT_MERGE_KEY = "draft";
const LAYOUT_MERGE_KEY = "layout";

function signature(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function documentNameOf(document: ResumeDocument): string {
  return (
    document.header.items.find((item) => item.kind === "field" && item.key === "name")?.value ?? ""
  );
}

export interface UseWorkbenchV2HistoryOptions {
  resumeId?: number;
  /** 宿主那份已保存的正文（保存成功 / 用最新的之后换引用）。 */
  document?: ResumeDocument | null;
  layout?: ResumeLayout;
  /** 撤销/恢复时把版式交回宿主（重排 + 显示）。 */
  onApplyLayout?: (next: ResumeLayout) => void;
  debounceMs?: number;
}

export interface WorkbenchV2History {
  document: ResumeDocument;
  layout: ResumeLayout;
  /** 中栏/结构面板每键变化：合并成一步。 */
  recordDraft: (next: ResumeDocument) => void;
  /** 排版参数变化：先交给宿主重排，再记一步（合并）。 */
  recordLayout: (next: ResumeLayout) => void;
  /** 结构命令 / 外部采纳：独立成一步。 */
  commitDocument: (next: ResumeDocument, label?: string) => void;
  /** 服务端已经是新基线（版本恢复 / 用最新的）：清栈并写回。 */
  resetDocument: (next: ResumeDocument, layout?: ResumeLayout) => void;
  undo: () => void;
  redo: () => void;
  historyTab: WorkbenchHistoryTab;
}

export function useWorkbenchV2History({
  document: serverDocument,
  layout,
  onApplyLayout,
  debounceMs,
}: UseWorkbenchV2HistoryOptions): WorkbenchV2History {
  // 历史栈在 React 之外提交（debounce 定时器），用一次自增渲染把它带进界面。
  const [, forceRender] = useReducer((value: number) => value + 1, 0);
  const [history] = useState(() => {
    const initial: WorkbenchV2Snapshot = {
      document: serverDocument ?? EMPTY_DOCUMENT,
      layout: layout ?? EMPTY_LAYOUT,
    };
    return createDocumentHistory<WorkbenchV2Snapshot>({
      initial,
      debounceMs: debounceMs ?? 300,
      onChange: () => forceRender(),
    });
  });
  const [snapshot, setSnapshot] = useState<WorkbenchV2Snapshot>(() => ({
    document: serverDocument ?? EMPTY_DOCUMENT,
    layout: layout ?? EMPTY_LAYOUT,
  }));
  const snapshotRef = useRef(snapshot);
  const applyingRef = useRef(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const write = useCallback(
    (next: WorkbenchV2Snapshot) => {
      snapshotRef.current = next;
      setSnapshot(next);
      forceRender();
    },
    [forceRender],
  );

  const record = useCallback(
    (next: WorkbenchV2Snapshot, mergeKey: string | null, label: string) => {
      if (signature(next) === signature(snapshotRef.current)) return;
      history.push(next, label);
      if (mergeKey === null) history.flush();
      write(next);
    },
    [history, write],
  );

  const recordDraft = useCallback(
    (next: ResumeDocument) => {
      record(
        { document: next, layout: snapshotRef.current.layout },
        DRAFT_MERGE_KEY,
        t("workbench.history.label.text"),
      );
    },
    [record],
  );

  const recordLayout = useCallback(
    (next: ResumeLayout) => {
      onApplyLayout?.(next);
      record(
        { document: snapshotRef.current.document, layout: next },
        LAYOUT_MERGE_KEY,
        t("workbench.history.label.layout"),
      );
    },
    [onApplyLayout, record],
  );

  const commitDocument = useCallback(
    (next: ResumeDocument, label = t("workbench.history.label.structure")) => {
      record({ document: next, layout: snapshotRef.current.layout }, null, label);
    },
    [record],
  );

  const resetDocument = useCallback(
    (next: ResumeDocument, layoutOverride?: ResumeLayout) => {
      const nextSnapshot: WorkbenchV2Snapshot = {
        document: next,
        layout: layoutOverride ?? snapshotRef.current.layout,
      };
      history.reset(nextSnapshot);
      applyingRef.current = true;
      try {
        write(nextSnapshot);
      } finally {
        applyingRef.current = false;
      }
    },
    [history, write],
  );

  // 宿主正文换了（保存成功 / 用最新的 / AI 修订）：清栈并以新文档为基线。
  const serverSig = useMemo(
    () => (serverDocument ? signature(serverDocument) : ""),
    [serverDocument],
  );
  useEffect(() => {
    if (applyingRef.current || !serverDocument) return;
    if (signature(snapshotRef.current.document) === serverSig) return;
    resetDocument(serverDocument, snapshotRef.current.layout);
  }, [resetDocument, serverDocument, serverSig]);

  const undo = useCallback(() => {
    const previous = history.undo();
    if (!previous) return;
    applyingRef.current = true;
    try {
      write(previous);
      onApplyLayout?.(previous.layout);
    } finally {
      applyingRef.current = false;
    }
  }, [history, onApplyLayout, write]);

  const redo = useCallback(() => {
    const next = history.redo();
    if (!next) return;
    applyingRef.current = true;
    try {
      write(next);
      onApplyLayout?.(next.layout);
    } finally {
      applyingRef.current = false;
    }
  }, [history, onApplyLayout, write]);

  const summaryOf = useCallback((value: WorkbenchV2Snapshot | null): string => {
    if (!value) return "";
    const entries = value.document.sections.reduce(
      (total, section) => total + section.entries.length,
      0,
    );
    return t("workbench.history.summary", {
      name: documentNameOf(value.document) || "—",
      entries,
      pages: value.layout.page_limit,
    });
  }, []);

  /** 回到某一步：连续撤销/恢复，最后应用历史栈的基线快照（与旧接线同一口径）。 */
  const jumpTo = useCallback(
    (group: "past" | "future", index: number) => {
      const position = history.position();
      const remaining = group === "past" ? position.past - index : position.future - index;
      let moved = false;
      for (let step = 0; step < Math.max(0, remaining); step += 1) {
        const applied = group === "past" ? history.undo() : history.redo();
        if (!applied) break;
        moved = true;
      }
      if (!moved) return;
      const target = history.snapshot().baseline;
      applyingRef.current = true;
      try {
        write(target);
        onApplyLayout?.(target.layout);
      } finally {
        applyingRef.current = false;
      }
    },
    [history, onApplyLayout, write],
  );

  // snapshot 参与依赖：历史点变化后 past/future 的摘要必须重算。
  const historyTab = useMemo<WorkbenchHistoryTab>(() => {
    const entries = history.entries();
    return {
      past: entries.past.map((entry, index) => ({
        ...entry,
        summary: summaryOf(history.previewPast(index)),
      })),
      future: entries.future.map((entry, index) => ({
        ...entry,
        summary: summaryOf(history.previewFuture(index)),
      })),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      onUndo: undo,
      onRedo: redo,
      onJumpTo: jumpTo,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot 只用于刷新增量摘要
  }, [history, snapshot, summaryOf, undo, redo, jumpTo]);

  return {
    document: snapshot.document,
    layout: snapshot.layout,
    recordDraft,
    recordLayout,
    commitDocument,
    resetDocument,
    undo,
    redo,
    historyTab,
  };
}
