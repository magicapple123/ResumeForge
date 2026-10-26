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
import { useLocale } from "../../i18n/i18nContext";
import { muteAnnouncement } from "../../features/announcements/announcementMute";
import {
  dismissAnnouncement,
  notifyAnnouncements,
  useAnnouncements,
} from "../../features/announcements/announcementStore";
import type { Announcement } from "../../features/announcements/announcementStore";
// 排序/唯一键/挑选这三条是纯函数，住在 `features/announcements/` 里：组件文件不再
// 导出非组件（否则 `react-refresh/only-export-components` 失效）。
import { announcementKey, pickVisible } from "../../features/announcements/announcementVisibility";

export interface AnnouncementBarProps {
  /** 留空则内部读 store（默认用法）；测试可注入。 */
  announcements?: readonly Announcement[];
}

export default function AnnouncementBar({ announcements }: AnnouncementBarProps) {
  useLocale();
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
