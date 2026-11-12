// SPDX-License-Identifier: Apache-2.0
/**
 * 「文件 → 导出」里两个下载动作的 toast 收尾（#34C）。
 *
 * 抽成 hook 的理由：DesktopTitleBar 已贴着行数预算，而这里只是"下载 → 成功/失败 toast"
 * 的重复形状。下载实现本身在 desktopExport.ts（复用 api/jobs.ts 与 api/knowledge.ts）。
 *
 * toast 由调用方从 App.useApp() 取（禁止 antd 静态 message），这里只声明用到的方法形状，
 * 便于离线用例注入假实现。
 */
import { useCallback } from "react";
import { exportFavoritesCsv, exportKnowledgeZip } from "./desktopExport";
import { t } from "../../i18n";
import type { DesktopExportDeps } from "./desktopExport";

/** 只声明用到的两个方法：antd 的 message 实例结构上满足它。 */
export interface DesktopExportToast {
  success(content: string): void;
  error(content: string): void;
}

export interface DesktopMenuExportActions {
  runFavorites: () => void;
  runKnowledge: () => void;
}

export function useDesktopMenuExport(
  toast: DesktopExportToast,
  deps: Partial<DesktopExportDeps> = {},
): DesktopMenuExportActions {
  const runFavorites = useCallback(() => {
    void exportFavoritesCsv(deps).then((outcome) => {
      if (outcome.ok) toast.success(t("appHeader.desktopMenu.export.favoritesDone"));
      else toast.error(outcome.error || t("appHeader.desktopMenu.export.failed"));
    });
  }, [toast, deps]);

  const runKnowledge = useCallback(() => {
    void exportKnowledgeZip(deps).then((outcome) => {
      if (outcome.ok) toast.success(t("appHeader.desktopMenu.export.knowledgeDone"));
      else toast.error(outcome.error || t("appHeader.desktopMenu.export.failed"));
    });
  }, [toast, deps]);

  return { runFavorites, runKnowledge };
}
