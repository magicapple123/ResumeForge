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
 *
 * ## 撤销/恢复怎么落到界面
 *
 * 快照 = {content, layout}：撤销后先让 `useResumeDocument` 更新状态，再由 effect 把
 * content 写回中栏表单（`editorRef.replaceContent`）、把 layout 交给宿主重排。
 * `applyingRef` 保证这次回写**不会**被当成一次新编辑再记进历史（否则按两次撤销才回一步）。
 *
 * ## 外部修改
 *
 * 宿主 `content` 变了（AI 修订、用最新的、草稿恢复）而本地文档状态没变：清栈并以新内容为
 * 基线。保存成功也会让 `content` 换引用，但此时签名与本地一致 → 不清栈（W03 验收：
 * **保存失败不清栈**，保存成功也不该把历史清空）。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";
import { contentSignature } from "../../utils/contentSignature";
import { t } from "../../i18n";
import { useResumeDocument } from "../../features/resume-document/useResumeDocument";
import { buildPathRemap } from "../../features/resume-outline";
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

/** 打字合并键：同一条合并通道 = 一次停顿一个历史点（不按字段拆，避免"边写边跳"碎步）。 */
const DRAFT_MERGE_KEY = "draft";

export interface WorkbenchHistoryTab {
  past: HistoryPanelStep[];
  future: HistoryPanelStep[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

interface Options {
  resumeId?: number;
  content?: ResumeContent | null;
  layout?: ResumeLayout;
  onApplyLayout?: (next: ResumeLayout) => void;
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  /** W06/W17：结构变化后把 overlay / 事实标注的 path 换到新下标（宿主实现）。 */
  onRemapPaths?: (remap: PathRemap) => void;
}

export interface WorkbenchHistory {
  /** 中栏草稿变化（每键触发；合并由历史栈 debounce 负责）。 */
  recordDraft: (content: ResumeContent) => void;
  /** 排版参数变化：先让宿主重排，再记一个历史点。 */
  recordLayout: (next: ResumeLayout) => void;
  /** 结构命令 / 外部采纳：写回中栏表单并独立成步。 */
  commitContent: (next: ResumeContent, label?: string) => void;
  /** W17 表达资产插入成功：服务端已写库 → 重映射路径 + 写回表单 + 记一步历史。 */
  applyInsertedContent: (resume: { content: unknown; revision: number }) => void;
  /** W13 版本恢复：服务端已是新基线 → 清栈并写回表单（恢复本身不进入可撤销历史）。 */
  restoreServerContent: (resume: { content: unknown; revision: number }) => void;
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
}: Options): WorkbenchHistory {
  const document = useResumeDocument({
    initial: { content: content ?? EMPTY_CONTENT, layout: layout ?? EMPTY_LAYOUT },
    resetKey: resumeId,
  });
  const applyingRef = useRef(false);
  const pendingApplyRef = useRef(false);
  const documentRef = useRef(document);
  // ref 不能在渲染期写（react-hooks/refs）：提交后同步一次；事件处理器/effect 里都拿到最新一份。
  useEffect(() => {
    documentRef.current = document;
  });

  const contentSig = useMemo(() => (content ? contentSignature(content) : ""), [content]);

  // 宿主正文变了（AI 修订 / 用最新的 / 草稿恢复）：清栈并以新内容为基线。
  // **只依赖正文**：版式变化由下面那条 effect 单独处理——否则"拖一下滑杆"就会因为
  // 这里的依赖重跑而把用户刚打的一整段历史清掉（W03 集成用例抓到的真实缺陷）。
  useEffect(() => {
    // 撤销/恢复的回写正在路上：宿主 props 会晚一拍更新，不能把它当作外部改动重置历史。
    if (applyingRef.current || pendingApplyRef.current || !content) return;
    if (contentSignature(documentRef.current.content) === contentSig) return;
    applyingRef.current = true;
    try {
      documentRef.current.reset({ content, layout: documentRef.current.layout });
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
      documentRef.current.reset({ content: documentRef.current.content, layout });
    } finally {
      applyingRef.current = false;
    }
  }, [layout]);

  const recordDraft = useCallback((next: ResumeContent) => {
    if (applyingRef.current) return;
    const current = documentRef.current;
    current.replaceDocument(
      { content: next, layout: current.layout },
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
    (next: ResumeContent, label = t("workbench.history.label.structure")) => {
      applyingRef.current = true;
      try {
        editorRef.current?.replaceContent(next);
      } finally {
        applyingRef.current = false;
      }
      const current = documentRef.current;
      current.replaceDocument({ content: next, layout: current.layout }, { mergeKey: null, label });
    },
    [editorRef],
  );

  /** W17：插入成功后的整份新内容（服务端已落库；新身份由后端生成）。 */
  const applyInsertedContent = useCallback(
    (resume: { content: unknown; revision: number }) => {
      const next = resume.content as ResumeContent;
      onRemapPaths?.(buildPathRemap(documentRef.current.content, next));
      commitContent(next, t("workbench.history.label.text"));
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
      documentRef.current.reset({ content: next, layout: documentRef.current.layout });
    },
    [editorRef],
  );

  // 撤销/恢复：先更新文档状态，再由 effect 写回表单与版式（`applyingRef` 防止回写被记成新步骤）。
  const undo = useCallback(() => {
    pendingApplyRef.current = true;
    if (!documentRef.current.undo()) pendingApplyRef.current = false;
  }, []);
  const redo = useCallback(() => {
    pendingApplyRef.current = true;
    if (!documentRef.current.redo()) pendingApplyRef.current = false;
  }, []);

  const appliedContent = document.content;
  const appliedLayout = document.layout;
  useEffect(() => {
    if (!pendingApplyRef.current) return;
    pendingApplyRef.current = false;
    applyingRef.current = true;
    try {
      editorRef.current?.replaceContent(appliedContent);
      onApplyLayout?.(appliedLayout);
    } finally {
      applyingRef.current = false;
    }
  }, [appliedContent, appliedLayout, editorRef, onApplyLayout]);

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
    const labels = document.labels();
    return {
      past: labels.past.map((label, index) => ({
        label,
        summary: summaryOf(document.previewPast(index)),
      })),
      future: labels.future.map((label, index) => ({
        label,
        summary: summaryOf(document.previewFuture(index)),
      })),
      canUndo: document.canUndo,
      canRedo: document.canRedo,
      onUndo: undo,
      onRedo: redo,
    };
    // summaryOf 读的是当前 document 快照；document 每次历史变化都是新对象。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- summaryOf 是纯派生，跟随 document 变化
  }, [document, redo, undo]);

  return {
    recordDraft,
    recordLayout,
    commitContent,
    applyInsertedContent,
    restoreServerContent,
    content: document.content,
    historyTab,
  };
}
