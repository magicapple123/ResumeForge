// SPDX-License-Identifier: Apache-2.0
/**
 * 页头「通知中心」入口（CR-25）：未读角标 + 下拉列表。
 *
 * **为什么需要它**：提醒到期、批次跑完这类事件此前只走"弹一下就没了"的 toast /
 * 桌面通知，窗口不在就彻底错过。现在所有事件先落 `notification` 表（后端唯一写入口
 * `services.notifications.emit`），本组件是这张表在界面上的**回看入口**——错过的还能补看。
 *
 * 三条实现口径：
 *
 * 1. **未读数轮询，列表按需拉取**：角标要一直准（可见 30s / 隐藏 120s，借 CR-23 的
 *    可见性轮询），但列表只在用户点开时才拉——没人看的时候不必每半分钟读一整页。
 * 2. **点条目 = 标已读 + 跳深链**：`deep_link` 是事件当时存的快照，目标被删后仍能点，
 *    落到列表页而不是 404。标记失败不阻断跳转（用户要的是"去那儿"，不是"改状态"）。
 * 3. **全部已读之后原地变空态**：不关面板、不弹 toast——角标消失本身就是反馈。
 */
import { Badge, Button, Popover, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import EmptyState from "../../components/common/EmptyState";
import EventRow from "../../components/common/EventRow";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
  type AppNotification,
} from "../../api/notifications";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { reportBadgePart } from "../../utils/desktopBadge";
import { relativeTimeLabel } from "../../utils/relativeTime";
import { startVisibilityPolling } from "../../utils/visibility";

/** 未读轮询：可见 30s；窗口隐藏时降到 120s（角标不需要秒级准确）。 */
const UNREAD_POLL_VISIBLE_MS = 30_000;
const UNREAD_POLL_HIDDEN_MS = 120_000;

const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 22a2.6 2.6 0 0 0 2.6-2.6h-5.2A2.6 2.6 0 0 0 12 22Zm7.1-5.2v-5.3a7.1 7.1 0 0 0-5.4-6.9V3.5a1.7 1.7 0 0 0-3.4 0v1.1a7.1 7.1 0 0 0-5.4 6.9v5.3L3.2 18.5v.9h17.6v-.9l-1.7-1.7Z" />
  </svg>
);

/** 本地日期键：分组按"用户所在时区的今天"，不是 UTC 日。 */
function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function splitByDay(items: AppNotification[]): {
  today: AppNotification[];
  earlier: AppNotification[];
} {
  const nowKey = dayKey(new Date().toISOString());
  return {
    today: items.filter((item) => dayKey(item.created_at) === nowKey),
    earlier: items.filter((item) => dayKey(item.created_at) !== nowKey),
  };
}

function NotificationRow({
  item,
  onOpen,
}: {
  item: AppNotification;
  onOpen: (item: AppNotification) => void;
}) {
  const unread = item.read_at === null;
  // 副行 = 相对时间 + 事件正文（`今天 14:12 · 提醒已自动跳过`）。「已自动跳过」保持
  // 三级灰：它是信息不是错误，红色语义只留给"逾期 N 天"这类需要处理的内容。
  const meta = [relativeTimeLabel(item.created_at), item.body].filter(Boolean).join(" · ");
  return (
    <EventRow
      title={item.title}
      meta={meta}
      unread={unread}
      onOpen={() => onOpen(item)}
    />
  );
}

export default function NotificationBell() {
  useLocale();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 面板打开期间被关掉后不要再 setState：请求返回时组件可能已卸载。
  const aliveRef = useRef(true);

  // 桌面壳角标只上报"我这一份"（同页的任务按钮上报待确认数），由 utils/desktopBadge
  // 相加后推给主进程——两边都直接 setBadge 会互相覆盖（CR-24）。
  useEffect(() => {
    reportBadgePart("unread", unread);
  }, [unread]);

  const refreshUnread = useCallback(async () => {
    try {
      const { unread: count } = await unreadNotificationCount();
      if (aliveRef.current) setUnread(Math.max(0, count));
    } catch {
      /* 角标读不到就不亮：轮询点自己容错，不能把页头拖成错误态。 */
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listNotifications({ limit: 50 });
      if (!aliveRef.current) return;
      setItems(rows);
    } catch {
      if (aliveRef.current) setError(t("notifications.error.load"));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // 首帧拉一次（微任务）：effect 里同步 setState 会触发级联渲染，eslint 直接警告。
    void Promise.resolve().then(refreshUnread);
    const stop = startVisibilityPolling({
      visibleIntervalMs: UNREAD_POLL_VISIBLE_MS,
      hiddenIntervalMs: UNREAD_POLL_HIDDEN_MS,
      onTick: refreshUnread,
    });
    return () => {
      aliveRef.current = false;
      stop();
    };
  }, [refreshUnread]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void refreshList();
      void refreshUnread();
    }
  };

  const handleOpen = async (item: AppNotification) => {
    if (item.read_at === null) {
      // 先标已读再跳：标记失败不该拦住用户去目标页面（角标下一轮轮询会纠正）。
      try {
        await markNotificationRead(item.id);
        setItems((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row,
          ),
        );
        void refreshUnread();
      } catch {
        /* 见上：跳转优先。 */
      }
    }
    // 没有 deep_link（合并批量的到期通知、批量任务的结果汇总）：**只标已读、不关面板**。
    // 旧写法先关面板再判空，读起来就是"点了没反应"，用户只能再点开确认一次。
    if (!item.deep_link) return;
    setOpen(false);
    navigate(item.deep_link);
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
    } catch {
      setError(t("notifications.error.read"));
      return;
    }
    await Promise.all([refreshList(), refreshUnread()]);
  };

  const groups = splitByDay(items);
  const panel = (
    <div className="notification-panel">
      <div className="notification-panel-head">
        <Typography.Text strong>{t("notifications.title")}</Typography.Text>
        <Button
          size="small"
          type="link"
          onClick={() => void handleReadAll()}
          disabled={unread === 0}
        >
          {t("notifications.action.readAll")}
        </Button>
      </div>
      {loading ? (
        <div className="notification-panel-state">
          <Spin size="small" />
        </div>
      ) : error ? (
        <div className="notification-panel-state">
          <Typography.Text type="secondary">{error}</Typography.Text>
          <Button size="small" type="link" onClick={() => void refreshList()}>
            {t("notifications.action.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState inline description={t("notifications.empty")} />
      ) : (
        <div className="notification-panel-list">
          {groups.today.length > 0 && (
            <>
              <div className="notification-group-title">{t("notifications.group.today")}</div>
              {groups.today.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={(row) => void handleOpen(row)} />
              ))}
            </>
          )}
          {groups.earlier.length > 0 && (
            <>
              <div className="notification-group-title">{t("notifications.group.earlier")}</div>
              {groups.earlier.map((item) => (
                <NotificationRow key={item.id} item={item} onOpen={(row) => void handleOpen(row)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={panel}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      destroyOnHidden={false}
    >
      {/* 不套 Tooltip：它的浮层会盖住按钮自身的点击区域（实测 pointer-events 冲突），
          而 aria-label 已经给屏幕阅读器与自动化提供了同一个名字。 */}
      <Badge count={unread} size="small" offset={[2, -2]}>
        <Button
          className="notification-bell-button"
          type="text"
          icon={<BellIcon />}
          aria-label={t("notifications.bell.aria")}
        />
      </Badge>
    </Popover>
  );
}
