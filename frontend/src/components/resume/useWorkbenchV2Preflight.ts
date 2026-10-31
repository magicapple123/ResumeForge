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
