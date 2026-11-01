// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 v2 → 统一检查（W11）的接线。
 *
 * v1 的 useWorkbenchPreflight 把草稿形状当 ResumeContent；v2 的正文是 ResumeDocument，
 * 但检查后端已接受 v2（路由统一转 v2），所以只改"宿主给的草稿"这一层。
 * 其余口径与 v1 一致：指纹用于丢弃过时回包；修复动作只开放真有入口的四种。
 */
import { useCallback, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { contentSignature } from "../../utils/contentSignature";
import { measureResumeLayout } from "../../utils/resumeLayoutMeasure";
import type { ResumeLayout } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import type { PreviewMode } from "../resume-preview/config";
import type {
  CheckFix,
  CheckFixAction,
  PreflightRequest,
} from "../../features/resume-preflight/types";
import type PreflightModal from "./preflight/PreflightModal";

type PreflightModalProps = ComponentProps<typeof PreflightModal>;

interface Options {
  resumeId?: number;
  document: ResumeDocument | null;
  layout?: ResumeLayout;
  onApplyLayout?: (next: ResumeLayout) => void;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 把用户带到具体字段（复用"点纸面"的定位通道）。 */
  focusField: (path: string) => void;
  /** 当前文档模式决定"加一页"的上限（普通 3 / 长 CV 10）。 */
  documentMode?: "resume" | "long_cv";
}

/** 只有真有 handler 的动作才开放；其余会被面板隐藏（不出现空按钮）。 */
const AVAILABLE_FIX_ACTIONS: ReadonlySet<CheckFixAction> = new Set([
  "focus_field",
  "apply_format_config",
  "add_page",
  "open_preview_exact",
]);

/**
 * 量制作台右栏那张纸（R-24 C）。
 *
 * 为什么在这里量而不是让用户先点「版面诊断」：检查面板里的「量不到版面」原本是
 * **每次都会出现**的一条 verify——后端收不到 `measure` 就只能说"我没量"，
 * 而用户眼前明明排好了一整页。制作台的草稿预览就是同源 iframe，直接量它的 body
 * 即可（与「版面诊断」卡片同一个 `measureResumeLayout`）。
 *
 * 量不到时返回 null：那才是"真的没有版面可量"（精确模式没有 iframe、预览还没渲染）。
 */
function measureDraftPaper(
  pageLimit: number,
): { used_height: number; page_content_height: number } | null {
  if (typeof document === "undefined") return null;
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>(".resume-iframe"));
  for (const frame of frames) {
    const rect = frame.getBoundingClientRect();
    // 页面上同时存在弹窗背后的详情预览：只认视口内这一张。
    if (rect.width < 200 || rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    const doc = frame.contentDocument;
    if (!doc) continue;
    const measure = measureResumeLayout(doc, pageLimit);
    if (measure) {
      return {
        used_height: measure.usedHeight,
        page_content_height: measure.pageContentHeight,
      };
    }
  }
  return null;
}

export interface WorkbenchV2Preflight {
  open: boolean;
  openPreflight: () => void;
  close: () => void;
  modalProps: Omit<PreflightModalProps, "open" | "onClose">;
}

export function useWorkbenchV2Preflight({
  resumeId,
  document,
  layout,
  onApplyLayout,
  onPreviewModeChange,
  focusField,
  documentMode = "resume",
}: Options): WorkbenchV2Preflight {
  const [open, setOpen] = useState(false);
  const currentKey = useMemo(
    () =>
      [
        contentSignature(document),
        layout?.template ?? "",
        layout?.format_name ?? "",
        String(layout?.page_limit ?? ""),
        layout?.font_scale ?? "",
        layout?.language ?? "",
        JSON.stringify(layout?.format_config ?? {}),
      ].join("|"),
    [document, layout],
  );
  const buildRequest = useCallback((): PreflightRequest => {
    return {
      content: (document ?? null) as unknown as Record<string, unknown> | null,
      layout: layout
        ? {
            template: layout.template,
            format_name: layout.format_name,
            page_limit: layout.page_limit,
            font_scale: layout.font_scale,
            language: layout.language,
            format_config: layout.format_config as Record<string, unknown> | undefined,
          }
        : null,
      layers: ["content", "layout", "product"],
      product_formats: ["pdf"],
      // R-24 C：把眼前这张纸的实测高度一起送检；量不到才让后端说"量不到版面"。
      measure: measureDraftPaper(layout?.page_limit ?? 1),
    };
  }, [document, layout]);
  const onFix = useCallback(
    (fix: CheckFix) => {
      if (!layout) return;
      switch (fix.action) {
        case "focus_field": {
          const path = typeof fix.payload.path === "string" ? fix.payload.path : null;
          if (path) focusField(path);
          return;
        }
        case "apply_format_config": {
          const config = fix.payload.format_config;
          if (config && typeof config === "object") {
            onApplyLayout?.({
              ...layout,
              format_config: config as ResumeLayout["format_config"],
            });
          }
          return;
        }
        case "add_page": {
          const maxPages = documentMode === "long_cv" ? 10 : 3;
          onApplyLayout?.({ ...layout, page_limit: Math.min(maxPages, layout.page_limit + 1) });
          return;
        }
        case "open_preview_exact":
          onPreviewModeChange?.("exact");
          return;
        default:
          return;
      }
    },
    [documentMode, focusField, layout, onApplyLayout, onPreviewModeChange],
  );
  return {
    open,
    openPreflight: () => setOpen(true),
    close: () => setOpen(false),
    modalProps: {
      resumeId,
      currentKey,
      buildRequest,
      onFix,
      availableFixActions: AVAILABLE_FIX_ACTIONS,
    },
  };
}
