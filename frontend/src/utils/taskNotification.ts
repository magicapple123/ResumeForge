const KIND_LABEL: Record<string, string> = {
  apply: "投递",
  collect: "采集",
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
  const kindLabel = KIND_LABEL[detail.kind] ?? "任务";
  const stats =
    detail.kind === "apply"
      ? `成功 ${detail.succeeded} · 失败 ${detail.failed} · 跳过 ${detail.skipped}`
      : `已暂存 ${detail.succeeded} 个岗位 · 跳过 ${detail.skipped} 个`;
  switch (detail.status) {
    case "completed":
      return {
        type: "success",
        message: `${kindLabel}批次 #${detail.id} 已完成`,
        description: stats,
      };
    case "failed":
      return {
        type: "error",
        message: `${kindLabel}批次 #${detail.id} 失败`,
        description: detail.message || "请到投递台查看失败原因",
      };
    case "stopped":
      return {
        type: "warning",
        message: `${kindLabel}批次 #${detail.id} 已停止`,
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
