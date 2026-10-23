// SPDX-License-Identifier: Apache-2.0
/**
 * 「此刻该显示哪一条公告」的纯函数族：排序权重、唯一键、挑选。
 *
 * 从 `components/common/AnnouncementBar.tsx` 拆出来（2026-10-23）：那个文件是组件文件，
 * 再导出普通函数会让 `react-refresh/only-export-components` 失效（改样式也整块刷新）。
 * 这三条本来就只依赖 store 的读取接口、与 React 无关，测试也可以单独钉住它们。
 */
import { isDismissed } from "./announcementStore";
import type { Announcement } from "./announcementStore";

/** `error` 排在 `warning` 前。写成函数而不是内联减法，是为了让"顺序"这一条可单测。 */
export function severityRank(severity: Announcement["severity"]): number {
  return severity === "error" ? 0 : 1;
}

/** 一条公告的唯一标识：代次变了就算另一条。 */
export function announcementKey(item: Announcement): string {
  return `${item.code}@${item.generation ?? "1"}`;
}

/**
 * 选出此刻该显示的那一条：已关闭、`hideOnPaths` 命中、被本地隐藏的都剔除，
 * 再按 severity → priority 排序取第一条。
 */
export function pickVisible(
  list: readonly Announcement[],
  path: string,
  hidden = "",
): Announcement | null {
  const visible = list
    .filter((item) => announcementKey(item) !== hidden)
    .filter((item) => !isDismissed(item.code, item.generation))
    .filter((item) => !item.hideOnPaths?.some((prefix) => path.startsWith(prefix)))
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        (a.priority ?? 100) - (b.priority ?? 100),
    );
  return visible[0] ?? null;
}
