// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面壳角标（CR-24 的 `notify:set-badge` 通道）的唯一聚合点。
 *
 * **为什么需要聚合**：任务栏/托盘那个数字要表达"有多少事等着你"，来源有两处——
 * 通知中心的未读数（铃铛）与后台任务里的待确认数（任务按钮）。两处各自轮询、各自
 * 变化，谁都不知道对方的值；如果两边都直接调 `setBadge`，后写的那个会把前一个数字
 * 覆盖掉，界面还会出现"角标 2、铃铛 3"这种自相矛盾的画面。
 *
 * 所以这里做一件很小的事：每个来源只上报"我这一份是多少"，本模块把它们相加后推给
 * 桌面壳。浏览器里没有这个桥，`push()` 静默跳过。
 */

type Source = "unread" | "pending";

const parts: Record<Source, number> = { unread: 0, pending: 0 };

interface DesktopBridge {
  setBadge?: (count: number) => unknown;
}

function bridge(): DesktopBridge | undefined {
  return (window as { resumeForge?: DesktopBridge }).resumeForge;
}

function push(): void {
  const total = parts.unread + parts.pending;
  const target = bridge();
  if (typeof target?.setBadge === "function") {
    void target.setBadge(total);
  }
}

/** 上报某个来源的当前数字（取整、非负；负数与 NaN 一律按 0）。 */
export function reportBadgePart(source: Source, count: number): void {
  const next = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  if (parts[source] === next) return;
  parts[source] = next;
  push();
}

/** 测试用：清空累计值（不推桥，避免污染下一个用例的断言）。 */
export function resetBadgeParts(): void {
  parts.unread = 0;
  parts.pending = 0;
}
