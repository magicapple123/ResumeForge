// SPDX-License-Identifier: Apache-2.0
/**
 * 文档状态容器（W03）：`content + layout` 的**唯一**持有者，命令与撤销/恢复都从这里走。
 *
 * ## 为什么要有这一层
 *
 * W02 之前内容状态在 antd 表单里（`useResumeEditorPanel`）、版式在宿主 `ResumeDetailModal`
 * 里、加粗 overlay 在 `useRichTextOverrides` 里。撤销/恢复要覆盖"正文 + 排版参数"，就必须
 * 有一处同时看见 content 与 layout 的状态；本 hook 就是那个容器（叠加层由宿主另持，见 §边界）。
 *
 * ## 历史口径（与 W00 §5.4 的稳定契约一致）
 *
 * - 一次命令 = 一个历史点；同 `mergeKey` 的连续输入由 `debounceMs` 合并成一步；
 * - 结构命令 / 整份替换一律 `flush` 后独立成步（拖动排序不能被并进上一次打字）；
 * - **保存失败不清栈**：清栈只由 `reset`（换记录 / 用最新的）触发——保存失败时用户
 *   最需要的就是"我还能退回去"；
 * - `resetKey` 用 `Object.is` 比较（与 `useFormHistory` 同口径）：换记录 / 用最新的必须清栈，
 *   否则撤销会把上一份数据填进新文档。
 *
 * ## 边界（W02/W03 收口后）
 *
 * 文档编辑状态 = `content` + `layout` + `overlays` 三者。overlay 的**唯一持有者**仍是宿主
 * （`ResumeDetailModal` 里的 useState）——只有那一层同时握着 detail、保存合并与主预览；本容器
 * 把三者一起放进快照，撤销/恢复才能同时回写正文、排版与"纸面上还没保存的粗体"。
 *
 * 宿主单方面改 overlay（保存成功清空 / 用最新的 / 结构重排换下标）不在这里凭空造历史点：
 * 接入层（`useWorkbenchHistory`）负责对齐容器里的副本，并把用户的加粗动作记成一步。
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ResumeContent, ResumeLayout } from "../../types/resume";
import type { RichTextOverlayMap } from "../resume/useRichTextOverrides";
import { applyDocumentCommand, mergeKeyOf, type DocumentCommand } from "./commands";
import {
  createDocumentHistory,
  DEFAULT_HISTORY_DEBOUNCE_MS,
  DEFAULT_HISTORY_LIMIT,
  type DocumentHistory,
} from "./history";

/** 一个历史快照：撤销/恢复要同时还原正文、排版参数与纸面上的加粗 overlay。 */
export interface ResumeDocumentSnapshot {
  content: ResumeContent;
  layout: ResumeLayout;
  /** `path → {raw, base}`；空对象 = 没有未保存的粗体（普通记录/旧记录都是空）。 */
  overlays: RichTextOverlayMap;
}

export interface UseResumeDocumentOptions {
  /** 打开时的文档（服务端已保存的正文 + 版式草稿）。 */
  initial: ResumeDocumentSnapshot;
  /** 换记录 / 用最新时改变它：`Object.is` 不同即清栈并以当前文档为新基线。 */
  resetKey?: unknown;
  limit?: number;
  debounceMs?: number;
}

export interface ResumeDocumentApi {
  content: ResumeContent;
  layout: ResumeLayout;
  /** 纸面加粗 overlay（与 content/layout 一起进快照；撤销/恢复由接入层回写宿主）。 */
  overlays: RichTextOverlayMap;
  /** 执行一条内容命令；返回 false = no-op（同值 / 越界 / 锁阻止），不制造历史点。 */
  dispatch: (command: DocumentCommand, label?: string) => boolean;
  /** 整份替换（W06 大纲结构命令 / AI 采纳）：默认独立成一步。 */
  replaceDocument: (
    next: ResumeDocumentSnapshot,
    options?: { mergeKey?: string | null; label?: string },
  ) => void;
  /** 版式变化：连续拖动由 debounce 合并成一步。 */
  setLayout: (next: ResumeLayout, label?: string) => void;
  undo: () => boolean;
  redo: () => boolean;
  /** 清栈并以给定文档为新基线（换记录 / 用最新的 / 草稿恢复）。 */
  reset: (next: ResumeDocumentSnapshot) => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 历史点名字（最旧 → 最新）；`future` 末尾是下一次 redo。 */
  labels: () => { past: string[]; future: string[] };
  /** 预览某个已发生步骤的快照（不改变文档）；下标对应 `labels().past`。 */
  previewPast: (index: number) => ResumeDocumentSnapshot | null;
  previewFuture: (index: number) => ResumeDocumentSnapshot | null;
  /** 卸载时清挂起的合并定时器。 */
  dispose: () => void;
}

/** 版式变化也走同一个合并键：一行滑杆连续拖动 = 一个历史点。 */
const LAYOUT_MERGE_KEY = "layout";

export function useResumeDocument({
  initial,
  resetKey,
  limit = DEFAULT_HISTORY_LIMIT,
  debounceMs = DEFAULT_HISTORY_DEBOUNCE_MS,
}: UseResumeDocumentOptions): ResumeDocumentApi {
  const [document, setDocument] = useState<ResumeDocumentSnapshot>(initial);
  // 历史对象只创建一次；`chapter` 只负责触发重渲染（canUndo/canRedo 不是 React state）。
  // debounce 定时器在 React 之外提交历史点，所以把**稳定的** dispatch 交给 history 当通知口。
  const [chapter, bumpChapter] = useReducer((value: number) => value + 1, 0);
  const [history] = useState<DocumentHistory<ResumeDocumentSnapshot>>(() =>
    createDocumentHistory({ initial, limit, debounceMs, onChange: bumpChapter }),
  );
  const documentRef = useRef(document);
  const lastMergeKeyRef = useRef<string | null>(null);

  const writeDocument = useCallback((next: ResumeDocumentSnapshot) => {
    documentRef.current = next;
    setDocument(next);
  }, []);

  /** 记一个历史点：无 mergeKey 的命令先 flush，保证"拖动排序"独立成步。 */
  const record = useCallback(
    (next: ResumeDocumentSnapshot, mergeKey: string | null, label: string) => {
      if (mergeKey === null || mergeKey !== lastMergeKeyRef.current) history.flush();
      history.push(next, label);
      lastMergeKeyRef.current = mergeKey;
      writeDocument(next);
      bumpChapter();
    },
    [history, writeDocument],
  );

  const dispatch = useCallback(
    (command: DocumentCommand, label = ""): boolean => {
      const applied = applyDocumentCommand(documentRef.current.content, command);
      if (!applied.changed) return false;
      const next: ResumeDocumentSnapshot = {
        ...documentRef.current,
        content: applied.content,
      };
      record(next, mergeKeyOf(command), label);
      return true;
    },
    [record],
  );

  const replaceDocument = useCallback(
    (next: ResumeDocumentSnapshot, options?: { mergeKey?: string | null; label?: string }) => {
      record(next, options?.mergeKey ?? null, options?.label ?? "");
    },
    [record],
  );

  const setLayout = useCallback(
    (next: ResumeLayout, label = "") => {
      if (JSON.stringify(next) === JSON.stringify(documentRef.current.layout)) return;
      record({ ...documentRef.current, layout: next }, LAYOUT_MERGE_KEY, label);
    },
    [record],
  );

  const undo = useCallback((): boolean => {
    const previous = history.undo();
    if (!previous) return false;
    lastMergeKeyRef.current = null;
    writeDocument(previous);
    bumpChapter();
    return true;
  }, [history, writeDocument]);

  const redo = useCallback((): boolean => {
    const next = history.redo();
    if (!next) return false;
    lastMergeKeyRef.current = null;
    writeDocument(next);
    bumpChapter();
    return true;
  }, [history, writeDocument]);

  const reset = useCallback(
    (next: ResumeDocumentSnapshot) => {
      history.reset(next);
      lastMergeKeyRef.current = null;
      writeDocument(next);
      bumpChapter();
    },
    [history, writeDocument],
  );

  const dispose = useCallback(() => history.dispose(), [history]);

  // 卸载：清挂起的合并定时器（否则会在已卸载的 shell 上写文档）。
  useEffect(() => dispose, [dispose]);

  // 换记录：resetKey 用 Object.is 比较（对象引用换了 = 换记录）。
  const previousResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (Object.is(previousResetKeyRef.current, resetKey)) return;
    previousResetKeyRef.current = resetKey;
    reset(documentRef.current);
  }, [reset, resetKey]);

  return {
    content: document.content,
    layout: document.layout,
    overlays: document.overlays,
    dispatch,
    replaceDocument,
    setLayout,
    undo,
    redo,
    reset,
    // chapter 只是"让下面两行在历史变化后重新求值"的依赖。
    canUndo: chapter >= 0 && history.canUndo(),
    canRedo: chapter >= 0 && history.canRedo(),
    labels: () => history.labels(),
    previewPast: (index) => history.previewPast(index),
    previewFuture: (index) => history.previewFuture(index),
    dispose,
  };
}
