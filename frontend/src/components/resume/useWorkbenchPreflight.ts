// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 → 统一检查（W11）的接线（从 `ResumeZoomModal` 拆出）。
 *
 * 面板（`PreflightModal`）自己编排请求（单飞/取消/过时丢弃），这里只提供三样宿主才能给的
 * 东西：
 * 1. **草稿指纹** `currentKey`：正文签名 + 版式关键参数，同一草稿稳定、改动即变（过时回包据此丢弃）；
 * 2. **请求体**：用当前草稿（未保存正文/版式）构请求，而不是记录里那一版；
 * 3. **修复动作**：只开放真有既有入口的四种——定位字段 / 并入版式覆盖 / 加一页 / 切精确预览；
 *    没有 handler 的动作不进 `availableFixActions`，面板就不会渲染空按钮。
 */
import { useCallback, useMemo, useState } from "react";
import { contentSignature } from "../../utils/contentSignature";
import type { ResumeContent, ResumeLayout } from "../../types";
import type { PreviewMode } from "../resume-preview/config";
import type {
  CheckFix,
  CheckFixAction,
  PreflightRequest,
} from "../../features/resume-preflight/types";
import type { PreflightModalProps } from "./useWorkbenchPreflight.types";

interface Options {
  resumeId?: number;
  /** 已保存正文。 */
  content?: ResumeContent | null;
  /** 叠加加粗之后的正文（实时预览吃的那份）：检查应与用户眼前一致。 */
  liveContent?: ResumeContent | null;
  layout?: ResumeLayout;
  onApplyLayout?: (next: ResumeLayout) => void;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /** 把用户带到具体字段（复用"点纸面"的定位通道；窄屏会先开内容抽屉）。 */
  focusField: (path: string) => void;
}

/** 只有真有 handler 的动作才开放；其余会被面板隐藏（不出现空按钮）。 */
const AVAILABLE_FIX_ACTIONS: ReadonlySet<CheckFixAction> = new Set([
  "focus_field",
  "apply_format_config",
  "add_page",
  "open_preview_exact",
  "open_preflight",
]);

export interface WorkbenchPreflight {
  open: boolean;
  openPreflight: () => void;
  close: () => void;
  /** 直接展开给 `PreflightModal` 的 props（外壳只写一行）。 */
  modalProps: Omit<PreflightModalProps, "open" | "onClose">;
}

export function useWorkbenchPreflight({
  resumeId,
  content,
  liveContent,
  layout,
  onApplyLayout,
  onPreviewModeChange,
  focusField,
}: Options): WorkbenchPreflight {
  const [open, setOpen] = useState(false);
  const currentKey = useMemo(() => {
    const signature = contentSignature(liveContent ?? content ?? null);
    return [
      signature,
      layout?.template ?? "",
      layout?.format_name ?? "",
      String(layout?.page_limit ?? ""),
      layout?.font_scale ?? "",
      layout?.language ?? "",
      JSON.stringify(layout?.format_config ?? {}),
    ].join("|");
  }, [content, layout, liveContent]);

  const buildRequest = useCallback((): PreflightRequest => {
    // 面板里还有一层空值保护；这里把草稿原样递过去（content 为 null = 用记录值）。
    return {
      content: (liveContent ?? content ?? null) as Record<string, unknown> | null,
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
    };
  }, [content, layout, liveContent]);

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
        case "add_page":
          onApplyLayout?.({ ...layout, page_limit: Math.min(3, layout.page_limit + 1) });
          return;
        case "open_preview_exact":
          onPreviewModeChange?.("exact");
          return;
        default:
          return;
      }
    },
    [focusField, layout, onApplyLayout, onPreviewModeChange],
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
