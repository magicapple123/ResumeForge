// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 → 统一历史（W03）的接线：把 shell 里**所有会改文档的入口**汇到 `useResumeDocument`。
 *
 * ## 谁往历史里写
 *
 * | 入口 | 记录方式 | 合并 |
 * | --- | --- | --- |
 * | 中栏打字（`onDraftContent` 每键回调） | `recordDraft`：整份草稿快照 | debounce 合并（一次停顿 = 一步） |
 * | 左栏排版参数（滑杆/色板） | `recordLayout`：调宿主重排 + 记快照 | 连续拖动合并成一步 |
 * | 大纲结构命令 / AI 采纳 | `commitContent`：先写表单再记快照 | 独立成步 |
 * | 纸面加粗（overlay） | 宿主改 overlay → 本 hook 对齐并记一步 | 连续加粗合并成一步 |
 *
 * ## 快照是什么
 *
 * `{content, layout, overlays}`：撤销后先让 `useResumeDocument` 更新状态，再由 effect 把
 * content 写回中栏表单（`editorRef.replaceContent`）、把 layout 交给宿主重排、把 overlays
 * 写回宿主（`onOverlaysChange`）。`applyingRef` 保证这次回写**不会**被当成一次新编辑再记进
 * 历史（否则按两次撤销才回一步）。
 *
 * overlay 的唯一持有者是宿主（`ResumeDetailModal`）：这里只持有它的**副本**用于快照，
 * 用户的每次加粗经宿主 state 变化回来时记一步；宿主单方面清空（保存成功 / 用最新的）由
 * 内容 effect 的 reset 一起对齐，不额外制造历史点。
 *
 * ## 外部修改
 *
 * 宿主 `content` 变了（AI 修订、用最新的、草稿恢复）而本地文档状态没变：清栈并以新内容为
 * 基线。保存成功也会让 `content` 换引用，但此时签名与本地一致 → 不清栈（W03 验收：
 * **保存失败不清栈**，保存成功也不该把历史清空）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";
import { contentSignature } from "../../utils/contentSignature";
import { t } from "../../i18n";
import { useResumeDocument } from "../../features/resume-document/useResumeDocument";
import type { RichTextOverlayMap } from "../../features/resume/useRichTextOverrides";
import { buildPathRemap, remapPathMap } from "../../features/resume-outline";
import type { PathRemap } from "../../features/resume-outline/paths";
import { useShortcut } from "../../features/shortcuts/useShortcutKeymap";
import type { HistoryPanelStep } from "./history/HistoryPanel";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";

const EMPTY_CONTENT: ResumeContent = {
  photo: "",
  name: "",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const EMPTY_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

const EMPTY_OVERLAYS: RichTextOverlayMap = {};

/** 打字合并键：同一条合并通道 = 一次停顿一个历史点（不按字段拆，避免"边写边跳"碎步）。 */
const DRAFT_MERGE_KEY = "draft";

/** 加粗合并键：连着加粗几处算一步（与打字分开，不清掉上一段打字的历史点）。 */
const OVERLAY_MERGE_KEY = "overlay";

export interface WorkbenchHistoryTab {
  past: HistoryPanelStep[];
  future: HistoryPanelStep[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 真正回退到某一步（连续撤销/恢复到底层下标，再应用那份快照）。 */
  onJumpTo: (group: "past" | "future", index: number) => void;
}

interface Options {
  resumeId?: number;
  content?: ResumeContent | null;
  layout?: ResumeLayout;
  onApplyLayout?: (next: ResumeLayout) => void;
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  /** W06/W17：结构变化后把 overlay / 事实标注的 path 换到新下标（宿主实现）。 */
  onRemapPaths?: (remap: PathRemap) => void;
  /** 纸面加粗的当前值（宿主唯一持有；undefined = 这个宿主没有加粗能力）。 */
  overlays?: RichTextOverlayMap;
  /** 撤销/恢复时把快照里的加粗写回宿主。 */
  onOverlaysChange?: (next: RichTextOverlayMap) => void;
}

export interface WorkbenchHistory {
  /** 中栏草稿变化（每键触发；合并由历史栈 debounce 负责）。 */
  recordDraft: (content: ResumeContent) => void;
  /** 排版参数变化：先让宿主重排，再记一个历史点。 */
  recordLayout: (next: ResumeLayout) => void;
  /**
   * 结构命令 / 外部采纳：写回中栏表单并独立成步。
   *
   * `remap` 给出时，快照里的 overlay 键同步换到新下标——大纲命令先改内容再 remap，
   * 两件事必须进同一个历史点，否则撤销会多退一步"只换了键"的空步骤。
   */
  commitContent: (next: ResumeContent, label?: string, remap?: PathRemap) => void;
  /** W17 表达资产插入成功：服务端已写库 → 重映射路径 + 写回表单 + 记一步历史。 */
  applyInsertedContent: (resume: { content: unknown; revision: number }) => void;
  /** W13 版本恢复：服务端已是新基线 → 清栈并写回表单（恢复本身不进入可撤销历史）。 */
  restoreServerContent: (resume: { content: unknown; revision: number }) => void;
  /** 纸面加粗：写进历史并回写宿主；连续加粗合并成一步。 */
  applyOverlay: (path: string, raw: string, base: string) => void;
  /** 清空纸面加粗并记一步（例如「取消修改」丢掉 overlay 的那一下）。 */
  clearOverlays: () => void;
  /** 当前草稿正文（含未保存编辑；纸面加粗由宿主 mergeLive 再叠）。 */
  content: ResumeContent;
  historyTab: WorkbenchHistoryTab;
}

export function useWorkbenchHistory({
  resumeId,
  content,
  layout,
  onApplyLayout,
  editorRef,
  onRemapPaths,
  overlays,
  onOverlaysChange,
}: Options): WorkbenchHistory {
  const document = useResumeDocument({
    initial: {
      content: content ?? EMPTY_CONTENT,
      layout: layout ?? EMPTY_LAYOUT,
      overlays: overlays ?? EMPTY_OVERLAYS,
    },
    resetKey: resumeId,
  });
  const applyingRef = useRef(false);
  const pendingApplyRef = useRef(false);
  const documentRef = useRef(document);
  // 宿主那份 overlay 的本地副本：事件处理器要在同一拍里读"改之前"的值。
  const overlaysRef = useRef<RichTextOverlayMap>(overlays ?? EMPTY_OVERLAYS);
  // ref 不能在渲染期写（react-hooks/refs）：提交后同步一次；事件处理器/effect 里都拿到最新一份。
  useEffect(() => {
    documentRef.current = document;
  });
  // layout effect 保证下面那些"宿主 props 刚变"的 effect 读到的已经是新值。
  useLayoutEffect(() => {
    overlaysRef.current = overlays ?? EMPTY_OVERLAYS;
  }, [overlays]);

  const contentSig = useMemo(() => (content ? contentSignature(content) : ""), [content]);
  const overlaysSig = useMemo(() => JSON.stringify(overlays ?? EMPTY_OVERLAYS), [overlays]);

  /** 记一个 overlay 历史点：宿主与文档容器里的副本一起对齐。 */
  const recordOverlaySnapshot = useCallback((next: RichTextOverlayMap, mergeKey: string | null) => {
    const current = documentRef.current;
    if (JSON.stringify(current.overlays) === JSON.stringify(next)) return;
    current.replaceDocument(
      { content: current.content, layout: current.layout, overlays: next },
      { mergeKey, label: t("workbench.history.label.bold") },
    );
  }, []);

  // 宿主正文变了（AI 修订 / 用最新的 / 草稿恢复）：清栈并以新内容为基线。
  // **只依赖正文**：版式变化由下面那条 effect 单独处理——否则"拖一下滑杆"就会因为
  // 这里的依赖重跑而把用户刚打的一整段历史清掉（W03 集成用例抓到的真实缺陷）。
  useEffect(() => {
    // 撤销/恢复的回写正在路上：宿主 props 会晚一拍更新，不能把它当作外部改动重置历史。
    if (applyingRef.current || pendingApplyRef.current || !content) return;
    if (contentSignature(documentRef.current.content) === contentSig) return;
    applyingRef.current = true;
    try {
      documentRef.current.reset({
        content,
        layout: documentRef.current.layout,
        overlays: overlaysRef.current,
      });
    } finally {
      applyingRef.current = false;
    }
  }, [content, contentSig]);

  // 宿主版式变了（保存后换引用 / 自动一页）：若与本地不同则重置（历史基线跟着走）。
  useEffect(() => {
    if (applyingRef.current || pendingApplyRef.current || !layout) return;
    if (JSON.stringify(documentRef.current.layout) === JSON.stringify(layout)) return;
    applyingRef.current = true;
    try {
      documentRef.current.reset({
        content: documentRef.current.content,
        layout,
        overlays: documentRef.current.overlays,
      });
    } finally {
      applyingRef.current = false;
    }
  }, [layout]);

  // 宿主单方面改了 overlay（点加粗 / 取消修改清空 / 保存成功后清空）：对齐副本并记一步。
  // 撤销/恢复的回写不走这里：那时文档快照已经是目标值，比较自然相等。
  useEffect(() => {
    if (onOverlaysChange === undefined) return;
    if (JSON.stringify(documentRef.current.overlays) === overlaysSig) return;
    if (applyingRef.current || pendingApplyRef.current) return;
    overlaysRef.current = overlays ?? EMPTY_OVERLAYS;
    recordOverlaySnapshot(overlaysRef.current, OVERLAY_MERGE_KEY);
  }, [overlays, overlaysSig, onOverlaysChange, recordOverlaySnapshot]);

  const recordDraft = useCallback((next: ResumeContent) => {
    if (applyingRef.current) return;
    const current = documentRef.current;
    current.replaceDocument(
      { content: next, layout: current.layout, overlays: current.overlays },
      { mergeKey: DRAFT_MERGE_KEY, label: t("workbench.history.label.text") },
    );
  }, []);

  const recordLayout = useCallback(
    (next: ResumeLayout) => {
      onApplyLayout?.(next);
      documentRef.current.setLayout(next, t("workbench.history.label.layout"));
    },
    [onApplyLayout],
  );

  const commitContent = useCallback(
    (next: ResumeContent, label = t("workbench.history.label.structure"), remap?: PathRemap) => {
      applyingRef.current = true;
      try {
        editorRef.current?.replaceContent(next);
      } finally {
        applyingRef.current = false;
      }
      const current = documentRef.current;
      const nextOverlays = remap ? remapPathMap(current.overlays, remap) : current.overlays;
      if (remap) overlaysRef.current = nextOverlays;
      current.replaceDocument(
        { content: next, layout: current.layout, overlays: nextOverlays },
        { mergeKey: null, label },
      );
    },
    [editorRef],
  );

  /** W17：插入成功后的整份新内容（服务端已落库；新身份由后端生成）。 */
  const applyInsertedContent = useCallback(
    (resume: { content: unknown; revision: number }) => {
      const next = resume.content as ResumeContent;
      const remap = buildPathRemap(documentRef.current.content, next);
      onRemapPaths?.(remap);
      commitContent(next, t("workbench.history.label.text"), remap);
    },
    [commitContent, onRemapPaths],
  );

  /** W13：恢复版本后的整份新内容（服务端新基线；历史清空，避免撤回到恢复前的不一致状态）。 */
  const restoreServerContent = useCallback(
    (resume: { content: unknown; revision: number }) => {
      const next = resume.content as ResumeContent;
      applyingRef.current = true;
      try {
        editorRef.current?.replaceContent(next);
      } finally {
        applyingRef.current = false;
      }
      documentRef.current.reset({
        content: next,
        layout: documentRef.current.layout,
        overlays: documentRef.current.overlays,
      });
    },
    [editorRef],
  );

  /** 纸面加粗的唯一记录口：宿主受控模式 + 本层快照一起推进。 */
  const applyOverlay = useCallback(
    (path: string, raw: string, base: string) => {
      if (!onOverlaysChange) return;
      const current = overlaysRef.current;
      if (current[path]?.raw === raw && current[path]?.base === base) return;
      const next = { ...current, [path]: { raw, base } };
      overlaysRef.current = next;
      onOverlaysChange(next);
      recordOverlaySnapshot(next, OVERLAY_MERGE_KEY);
    },
    [onOverlaysChange, recordOverlaySnapshot],
  );

  const clearOverlays = useCallback(() => {
    if (!onOverlaysChange || Object.keys(overlaysRef.current).length === 0) return;
    overlaysRef.current = EMPTY_OVERLAYS;
    onOverlaysChange(EMPTY_OVERLAYS);
    recordOverlaySnapshot(EMPTY_OVERLAYS, null);
  }, [onOverlaysChange, recordOverlaySnapshot]);

  // 撤销/恢复：先更新文档状态，再由 effect 写回表单、版式与加粗（`applyingRef` 防止回写被记成新步骤）。
  const undo = useCallback(() => {
    pendingApplyRef.current = true;
    if (!documentRef.current.undo()) pendingApplyRef.current = false;
  }, []);
  const redo = useCallback(() => {
    pendingApplyRef.current = true;
    if (!documentRef.current.redo()) pendingApplyRef.current = false;
  }, []);

  /**
   * 回到某一步（历史面板的「回到这一步」）。
   *
   * 不重写快照栈：文档状态是**纯快照**，只要把栈走到目标下标、再应用最后那一份即可。
   * 所以这里按 `position()` 算要连续撤销/恢复几次，循环调用底层 `undo()/redo()`——
   * 中间每一步的 `setState` 由 React 自动批处理，effect 只在最后那一份快照上写回中栏表单/
   * 版式/加粗（`pendingApplyRef` 保证这次回写不会被记成新历史点）。
   *
   * 下标口径与 `historyTab.past/future` 一致（数据顺序，不是界面上的倒序）。
   */
  const jumpTo = useCallback((group: "past" | "future", index: number) => {
    const api = documentRef.current;
    const position = api.position();
    const remaining = group === "past" ? position.past - index : position.future - index;
    if (remaining <= 0) return;
    for (let step = 0; step < remaining; step += 1) {
      const moved = group === "past" ? api.undo() : api.redo();
      if (!moved) break;
      // 走到目标之后才把"待回写"点亮：中途失败不该让下一帧白写一遍当前值。
      pendingApplyRef.current = true;
    }
  }, []);

  const appliedContent = document.content;
  const appliedLayout = document.layout;
  const appliedOverlays = document.overlays;
  useEffect(() => {
    if (!pendingApplyRef.current) return;
    pendingApplyRef.current = false;
    applyingRef.current = true;
    try {
      editorRef.current?.replaceContent(appliedContent);
      onApplyLayout?.(appliedLayout);
      onOverlaysChange?.(appliedOverlays);
    } finally {
      applyingRef.current = false;
    }
  }, [appliedContent, appliedLayout, appliedOverlays, editorRef, onApplyLayout, onOverlaysChange]);

  // 键盘：全局 keymap 在输入框/可编辑区里**不**派发 undo/redo（原生撤销优先），
  // 所以这里注册的是"焦点不在输入框时"的统一历史快捷键，不与表单层双回退。
  useShortcut("undo", () => undo(), resumeId != null);
  useShortcut("redo", () => redo(), resumeId != null);

  const summaryOf = (snapshot: ReturnType<typeof document.previewPast>): string => {
    if (!snapshot) return "";
    const counts =
      snapshot.content.education.length +
      snapshot.content.experience.length +
      snapshot.content.campus_experience.length +
      snapshot.content.projects.length +
      snapshot.content.skills.length +
      snapshot.content.awards.length;
    return t("workbench.history.summary", {
      name: snapshot.content.name || "—",
      entries: counts,
      pages: snapshot.layout.page_limit,
    });
  };

  const historyTab = useMemo<WorkbenchHistoryTab>(() => {
    // `entries()` 与 `labels()` 同序，但多带一个 `at`（历史面板要显示"几点"），
    // 两者都由同一次渲染的快照栈算出，不会错位。
    const entries = document.entries();
    return {
      past: entries.past.map((entry, index) => ({
        ...entry,
        summary: summaryOf(document.previewPast(index)),
      })),
      future: entries.future.map((entry, index) => ({
        ...entry,
        summary: summaryOf(document.previewFuture(index)),
      })),
      canUndo: document.canUndo,
      canRedo: document.canRedo,
      onUndo: undo,
      onRedo: redo,
      onJumpTo: jumpTo,
    };
    // summaryOf 读的是当前 document 快照；document 每次历史变化都是新对象。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summaryOf 是纯派生，跟随 document 变化
  }, [document, jumpTo, redo, undo]);

  return {
    recordDraft,
    recordLayout,
    commitContent,
    applyInsertedContent,
    restoreServerContent,
    applyOverlay,
    clearOverlays,
    content: document.content,
    historyTab,
  };
}
