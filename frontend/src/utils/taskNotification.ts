// SPDX-License-Identifier: Apache-2.0
import { t } from "../i18n";
import type { MessageKey } from "../i18n";

/** 批次类型（后端协议值）→ 展示名 key；模块作用域只存 key，渲染时才求值。 */
const KIND_LABEL: Record<string, MessageKey> = {
  apply: "backgroundTasks.batch.kindApply",
  collect: "backgroundTasks.batch.kindCollect",
};

/** Convert a terminal task state into a notification without UI dependencies. */
export function buildTaskNotification(detail: {
  id: number;
  kind: string;
  status: string;
  succeeded: number;
  failed: number;
  skipped: number;
  message: string;
}): {
  type: "success" | "info" | "warning" | "error";
  message: string;
  description: string;
} | null {
  const kindLabel = t(KIND_LABEL[detail.kind] ?? "backgroundTasks.batch.kindFallback");
  const stats =
    detail.kind === "apply"
      ? t("backgroundTasks.batch.statsApply", {
          succeeded: detail.succeeded,
          failed: detail.failed,
          skipped: detail.skipped,
        })
      : t("backgroundTasks.batch.statsCollect", {
          succeeded: detail.succeeded,
          skipped: detail.skipped,
        });
  switch (detail.status) {
    case "completed":
      return {
        type: "success",
        message: t("backgroundTasks.batch.completed", { kind: kindLabel, id: detail.id }),
        description: stats,
      };
    case "failed":
      return {
        type: "error",
        message: t("backgroundTasks.batch.failed", { kind: kindLabel, id: detail.id }),
        description: detail.message || t("backgroundTasks.batch.failed.hint"),
      };
    case "stopped":
      return {
        type: "warning",
        message: t("backgroundTasks.batch.stopped", { kind: kindLabel, id: detail.id }),
        description: stats,
      };
    default:
      return null;
  }
}

/** Notification permission is never requested as a side effect of task completion. */
export function fireWebNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch {
    /* A desktop notification failure must not break the in-app notification. */
  }
}
