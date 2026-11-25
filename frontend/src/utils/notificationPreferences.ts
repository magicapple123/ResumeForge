// SPDX-License-Identifier: Apache-2.0
/**
 * 通知偏好的**进程内快照**（CR-29）：通道要不要打断，只问这里。
 *
 * 为什么不每个调用点各拉一次接口：完成提示发生在异步回调里（批次轮询、任务轮询），
 * 那时再做一次 HTTP 只会让"已经跑完了"多等一拍；而设置页改动是低频动作，改完直接
 * 覆盖快照即可。应用启动时由 `NotifyHostBridge` 拉一次（失败按"还没设置"处理）。
 *
 * 三个判定要分清，别混成一个布尔：
 * - `interruptAllowed`：这一类**结果**事件要不要弹窗 / 发桌面通知；
 * - `isQuietNow`：此刻是否在静默时段（22:00–08:00）；它压住所有打断，但不影响 inbox；
 * - `soundAllowed`：这一下要不要出声（提示音开关 + 静默时段）。
 *
 * 失败类（warning / error）不算"结果类"：它们需要用户处理，默认打断（静默时段除外）。
 */
import { getNotificationSettings, type NotificationSettings } from "../api/notificationSettings";
import { isSoundEnabled, setSoundEnabled } from "./notifySound";

let snapshot: NotificationSettings | null = null;

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 把一份设置放进快照；提示音同步镜像到旧的 localStorage 读路径。 */
export function applyNotificationSettings(next: NotificationSettings): void {
  snapshot = next;
  // `playDoneSound` 仍按 localStorage 判断（它被各处的旧代码直接调用）；把库里的值
  // 镜像过去，DB 仍是唯一真相，localStorage 只是运行时缓存。
  setSoundEnabled(next.notify_sound);
}

/** 拉一次设置并覆盖快照；失败返回 null（保持上一次快照，不把开关"重置"）。 */
export async function refreshNotificationSettings(): Promise<NotificationSettings | null> {
  try {
    const next = await getNotificationSettings();
    applyNotificationSettings(next);
    return next;
  } catch {
    return null;
  }
}

export function currentNotificationSettings(): NotificationSettings | null {
  return snapshot;
}

/** 现在是否在静默时段（含跨午夜）。设置未加载或开关关着 → false。 */
export function isQuietNow(now: Date = new Date()): boolean {
  const settings = snapshot;
  if (settings === null || !settings.notify_quiet_hours) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = parseClock(settings.quiet_start);
  const end = parseClock(settings.quiet_end);
  if (start === null || end === null) return false;
  if (start <= end) return current >= start && current < end;
  return current >= start || current < end;
}

/**
 * 这一类事件要不要打断。设置还没加载时按"允许"处理：宁可多弹一次，也不要因为一次
 * 启动期的读取失败把用户等到的结果吞掉（下次读取成功后回到用户设置）。
 */
export function interruptAllowed(kind: "task" | "batch"): boolean {
  if (isQuietNow()) return false;
  const settings = snapshot;
  if (settings === null) return true;
  return kind === "batch" ? settings.notify_batch_done : settings.notify_task_done;
}

/** 失败类（warning / error）要不要打断：只受静默时段约束。 */
export function failureInterruptAllowed(): boolean {
  return !isQuietNow();
}

/** 这一下要不要出声：提示音开关（库值经 localStorage 镜像）+ 静默时段。 */
export function soundAllowed(): boolean {
  if (isQuietNow()) return false;
  const settings = snapshot;
  return settings === null ? isSoundEnabled() : settings.notify_sound;
}
