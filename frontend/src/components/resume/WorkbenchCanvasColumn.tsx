// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 · **右栏画布**的宿主容器（从 `ResumeZoomModal` 拆出，2026-10-24）。
 *
 * 拆出原因：外壳文件要给 W02 的冲突条 / 条件保存腾行数（单文件 500 行零豁免），而这一块
 * 只是"一个滚动容器 + 一个已经存在的预览组件"，不持有任何制作台状态。
 *
 * 容器 ref 由外面传：W06 的大纲面板要往 iframe 里注入选中高亮，需要这个节点量位置。
 * `.resume-wb-col-canvas` 的类名与滚动契约留在 CSS 里，这里只保证节点结构不变。
 */
import { useCallback } from "react";
import type { ReactNode, RefObject } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import type { RichTextEditAdapter } from "./ResumeWorkbenchLiveCanvas";
import type { ResumeDraftStore } from "../../features/resume/resumeDraftContent";
import type { ProviewShellConfig } from "../../features/resume-proview/ProviewContext";
import ResumeWorkbenchLiveCanvas from "./ResumeWorkbenchLiveCanvas";

interface Props {
  html: string;
  warnings: string[];
  pages: number;
  previewRef: RefObject<ResumePreviewHandle | null>;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  exactPreview?: ExactPreviewOptions;
  onPickField?: (path: string) => void;
  richEdit?: RichTextEditAdapter;
  /** 宿主已保存 / 已合并加粗的正文（中栏草稿优先于它，见 `ResumeWorkbenchLiveCanvas`）。 */
  content?: ResumeContent | null;
  draftStore: ResumeDraftStore;
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  layout?: ResumeLayout;
  suspended?: boolean;
  /** 画布容器的 DOM 节点（W06 大纲注入高亮用）。 */
  containerRef?: RefObject<HTMLDivElement | null>;
  /** 同一个节点的回调出口：W06 大纲要拿节点量位置（state 持有，避免渲染期读 ref）。 */
  onContainerReady?: (node: HTMLDivElement | null) => void;
  /** W08 溢出定位横幅（画布顶部，由外壳注入；不传 = 不渲染）。 */
  banner?: ReactNode;
  /** 画布条尾部的附加状态（当前不用；保留给后续"实时预览失败重试"入口）。 */
  status?: ReactNode;
  /** W15 专业视图的宿主能力（命令 / 工作区 / 照片）：不传 = 画布不渲染专业视图。 */
  proview?: ProviewShellConfig;
}

export default function WorkbenchCanvasColumn({
  html,
  warnings,
  pages,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  onPickField,
  richEdit,
  content,
  draftStore,
  mergeLive,
  layout,
  suspended = false,
  containerRef,
  banner,
  status,
  proview,
  onContainerReady,
}: Props) {
  // 两个出口合并到一个 ref 回调：ref 对象给 W02 的容器出口，回调给 W06 大纲。
  const attachRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (containerRef) containerRef.current = node;
      onContainerReady?.(node);
    },
    [containerRef, onContainerReady],
  );
  return (
    <div className="resume-wb-col resume-wb-col-canvas" ref={attachRef}>
      {banner}
      <ResumeWorkbenchLiveCanvas
        html={html}
        warnings={warnings}
        pages={pages}
        previewRef={previewRef}
        previewMode={previewMode}
        onPreviewModeChange={onPreviewModeChange}
        exactPreview={exactPreview}
        onPickField={onPickField}
        content={content ?? null}
        draftStore={draftStore}
        mergeLive={mergeLive}
        layout={layout}
        richEdit={richEdit}
        suspended={suspended}
        proview={proview}
      />
      {status}
    </div>
  );
}
