// SPDX-License-Identifier: Apache-2.0
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { isDocumentHidden } from "./visibility";

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

/** 一条桌面通知的载荷（与主进程 `notify:show` 的字段一一对应）。 */
export interface DesktopNotificationPayload {
  title: string;
  body: string;
  /** 点击通知后要跳到的页面；没有落点时省略。 */
  deepLink?: string | null;
  /** 主进程按它做 60 秒节流；同一件事重复上报只会响一次。 */
  dedupeKey?: string | null;
}

/** preload 暴露的桌面桥（只声明本文件用到的部分，避免依赖 vite-env 的全局类型）。 */
interface DesktopNotificationBridge {
  notify?: (payload: DesktopNotificationPayload) => Promise<unknown> | unknown;
}

function desktopBridge(): DesktopNotificationBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { resumeForge?: DesktopNotificationBridge }).resumeForge;
  return bridge && typeof bridge.notify === "function" ? bridge : null;
}

/**
 * 走桌面主进程发系统通知；没有桌面桥时返回 false（调用方回落到浏览器通知）。
 *
 * 这里**不检查** `Notification.permission`：系统通知由 Electron 主进程发，
 * 浏览器权限在桌面壳里永远是 "default"，检查它只会把通知通道永久锁死（CR-24）。
 */
export function notifyDesktop(payload: DesktopNotificationPayload): boolean {
  const bridge = desktopBridge();
  if (!bridge || typeof bridge.notify !== "function") return false;
  try {
    void Promise.resolve(bridge.notify(payload)).catch(() => {
      /* 主进程通道失败不该影响应用内提醒。 */
    });
    return true;
  } catch {
    return false;
  }
}

/** 浏览器原生通知（桌面壳里由 `notifyDesktop` 接管，不会走到这里）。 */
function browserWebNotification(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch {
    /* A desktop notification failure must not break the in-app notification. */
  }
}

/**
 * 系统通知出口：有桌面桥走 IPC（是否真的弹由主进程按"聚焦且可见"决定），
 * 无桥时回落浏览器 Notification（仍不主动要权限）。
 */
export function fireWebNotification(
  title: string,
  body: string,
  extra?: { deepLink?: string | null; dedupeKey?: string | null },
): void {
  if (
    notifyDesktop({
      title,
      body,
      deepLink: extra?.deepLink ?? null,
      dedupeKey: extra?.dedupeKey ?? null,
    })
  ) {
    return;
  }
  browserWebNotification(title, body);
}

/**
 * 后台任务完成后的系统通知（CR-24 / CR-23）。
 *
 * - 桌面壳：总是交给主进程——窗口"可见但没聚焦"（被别的应用挡住）时也该提醒，
 *   只有"聚焦且可见"才由主进程静默丢弃；
 * - 浏览器：仅在页面隐藏时补一条系统通知，可见时应用内提醒已足够，不重复打扰。
 */
export function notifyBackgroundTaskDone(payload: DesktopNotificationPayload): void {
  if (notifyDesktop(payload)) return;
  if (!isDocumentHidden()) return;
  browserWebNotification(payload.title, payload.body);
}
