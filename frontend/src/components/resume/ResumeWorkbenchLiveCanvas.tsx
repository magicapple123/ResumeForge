// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台右栏画布的**实时预览容器**：把"内容变了就重排"接到画布上。
 *
 * 三个职责，都刻意留在这一个薄壳里：
 *
 * 1. **显示哪份 html**：`liveHtml ?? props.html`。宿主给的 html 是"已保存的那一版"（保存、
 *    重新排版、AI 修订之后都会换新），实时结果是"还在改的那一版"。宿主一换 html 就把实时
 *    结果丢掉——保存返回的 html 是权威的，hook 不得覆盖它（见 `useResumeLivePreview` 第 8 条）。
 * 2. **保存期间挂起**：`suspended` 为真时 abort 在飞请求，免得保存写进去的新 html 被一个
 *    早发出的旧响应盖掉。
 * 3. **状态条**：`预览更新中…` / `显示的是上一次成功预览 + 重试`。它必须贴在画布条上——
 *    用户在右栏看纸，状态就得在纸的旁边，而不是弹窗底部。
 *
 * 精确模式下不挂实时预览：那一栏显示的是服务端排的 PDF，重排草稿 html 纯属浪费。
 */
import { Button, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { renderResume } from "../../api/resumeLayout";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { useResumeLivePreview } from "../../features/resume/useResumeLivePreview";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import type { RichTextEditAdapter } from "../resume-preview/richText";
import ResumeWorkbenchCanvas from "./ResumeWorkbenchCanvas";

/** 让调用方（`ResumeZoomModal`）只多一条 import 就能拿到这个类型。 */
export type { RichTextEditAdapter } from "../resume-preview/richText";

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
  /** 合并 overlay 之后的正文；`null` = 中栏没有内容，实时预览不启用。 */
  content: ResumeContent | null;
  layout?: ResumeLayout;
  /** 保存（内容或版式）在飞：实时预览让路，别用旧结果盖住保存返回的 html。 */
  suspended?: boolean;
}

export default function ResumeWorkbenchLiveCanvas({
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
  layout,
  suspended = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * 实时结果与它**基于哪一版宿主 html**。
   *
   * 不用"html 变了就在 effect 里清空"的写法：`source` 与 prop 一比就知道结果是否过期，
   * 既少一轮级联渲染，也不会有"effect 还没跑、界面已经先显示旧结果"的那一帧。
   */
  const [live, setLive] = useState<{ source: string; html: string } | null>(null);

  // `renderResume` 签名稳定（模块级函数），这里再包一层是为了把 `signal` 传进去。
  const runRender = useCallback(
    (next: ResumeContent, nextLayout: ResumeLayout, signal: AbortSignal) =>
      renderResume(next, nextLayout, signal),
    [],
  );
  // 结果记下"生成它时宿主给的是哪一版"：宿主一换 html，这条结果自动失效。
  const handleHtml = useCallback((next: string) => setLive({ source: html, html: next }), [html]);

  const { state, retry, suspend, resume } = useResumeLivePreview({
    enabled: Boolean(content) && previewMode !== "exact",
    content,
    layout,
    render: runRender,
    onHtml: handleHtml,
    scrollRef,
  });

  useEffect(() => {
    if (suspended) suspend();
    else resume();
  }, [resume, suspended, suspend]);

  const status =
    state === "error" ? (
      <Space size={4}>
        <Typography.Text type="secondary" className="resume-wb-canvas-note">
          {t("rich.preview.stale")}
        </Typography.Text>
        <Button size="small" type="link" onClick={retry}>
          {t("rich.preview.retry")}
        </Button>
      </Space>
    ) : state === "idle" ? null : (
      <Typography.Text type="secondary" className="resume-wb-canvas-note">
        {t("rich.preview.updating")}
      </Typography.Text>
    );

  return (
    <ResumeWorkbenchCanvas
      html={live && live.source === html ? live.html : html}
      warnings={warnings}
      pages={pages}
      previewRef={previewRef}
      previewMode={previewMode}
      onPreviewModeChange={onPreviewModeChange}
      exactPreview={exactPreview}
      onPickField={onPickField}
      richEdit={richEdit}
      scrollRef={scrollRef}
      status={status}
    />
  );
}
