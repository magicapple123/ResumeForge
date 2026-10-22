// SPDX-License-Identifier: Apache-2.0
/**
 * 公告条：页面顶部常驻、可手关、**不自动消失**的一条。
 *
 * 它和另外三种"消息"的分工（判据见 `AGENTS.md`）：
 *
 * | 形态 | 语义 | 会自己消失吗 |
 * | --- | --- | --- |
 * | 页内 `<Alert>` | 当前页面里的静态说明 | —— |
 * | `notification` | 后台任务的进度/结果 | 会 |
 * | `utils/taskNotify` | "刚做完"的一瞬间 | 会 |
 * | **公告条** | 影响全站、需要你知道并处理的事 | **不会**，只能手关 |
 *
 * 同一时刻**只显示 1 条**：`severity`（error > warning）→ `priority` 升序 → 入队顺序。
 * 关掉一条立刻显示下一条，不排队等待。
 *
 * 两个关闭动作**语义必须分开**，不许合并成一个 ×：
 * - ×：只关掉这一条（`code + generation`，版本变了会再来）；
 * - 「不再提醒」：静音该 `code` 的全部代次，直到用户在设置页恢复。
 */
import { CloseOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { muteAnnouncement } from "../../features/announcements/announcementMute";
import {
  dismissAnnouncement,
  isDismissed,
  notifyAnnouncements,
  useAnnouncements,
} from "../../features/announcements/announcementStore";
import type { Announcement } from "../../features/announcements/announcementStore";

export interface AnnouncementBarProps {
  /** 留空则内部读 store（默认用法）；测试可注入。 */
  announcements?: readonly Announcement[];
}

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

export default function AnnouncementBar({ announcements }: AnnouncementBarProps) {
  const fromStore = useAnnouncements();
  const list = announcements ?? fromStore;
  const navigate = useNavigate();
  const path = useLocation().pathname;
  // 关掉之后要**立刻**空出位置：删除记忆写在 localStorage，不会触发 store 订阅。
  const [hidden, setHidden] = useState("");

  const current = pickVisible(list, path, hidden);
  // 首帧就在的那条不算"新宣布"（它本来就在那儿，读屏不该打断用户）；之后才出现的才算。
  const [initialKey] = useState(() => (current ? announcementKey(current) : ""));
  const currentKey = current ? announcementKey(current) : "";

  if (!current) return null;

  const liveRole =
    currentKey === initialKey ? undefined : current.severity === "error" ? "alert" : "status";

  return (
    <section
      className={`rf-announcement rf-announcement-${current.severity}`}
      aria-label={t("announcement.region")}
      role={liveRole}
    >
      <span className="rf-announcement-text">{current.message}</span>
      {current.action ? (
        <Button
          type="link"
          size="small"
          onClick={() => {
            // 动作按钮点完**不**自动关闭：用户可能还需要知道"已经去过了"。
            if (current.action?.to) navigate(current.action.to);
            current.action?.onClick?.();
          }}
        >
          {current.action.label}
        </Button>
      ) : null}
      <Button
        type="text"
        size="small"
        aria-label={t("announcement.mute")}
        onClick={() => {
          muteAnnouncement(current.code);
          notifyAnnouncements();
        }}
      >
        {t("announcement.mute.action")}
      </Button>
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined />}
        aria-label={t("announcement.dismiss")}
        onClick={() => {
          dismissAnnouncement(current.code, current.generation);
          setHidden(currentKey);
        }}
      />
    </section>
  );
}
