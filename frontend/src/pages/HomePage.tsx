// SPDX-License-Identifier: Apache-2.0
/** 首页：数据概览、"接下来做什么"、全局搜索与最近动态。 */
import {
  AuditOutlined,
  FunnelPlotOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listUpcomingReminders } from "../api/reminders";
import { getProfile } from "../api/profile";
import { getStats } from "../api/search";
import { getReminderPopupSetting } from "../api/settings";
import { useApi } from "../hooks/useApi";
import { acquireStartupSlot, releaseStartupSlot } from "../utils/userGuide";
import { FirstDeliveryPanel } from "../features/activation/FirstDeliveryPanel";
import { useActivationProgress } from "../features/activation/useActivationProgress";
import { LatestCards } from "./home/LatestCards";
import { ReminderPopup } from "./home/ReminderPopup";
import { RemindersCard } from "./home/RemindersCard";
import { SearchCard } from "./home/SearchCard";
import { TasksCard } from "./home/TasksCard";
import { ShortcutsCard } from "./home/ShortcutsCard";
import { StatsCards } from "./home/StatsCards";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** 启动弹窗在一次 SPA 会话内只弹一次。
 *
 * 用模块级标记而不是 localStorage：模块在整页刷新时会被重新求值，标记随之归零，
 * 满足「刷新后可再弹一次」；而在 SPA 内切走再回首页（组件卸载/挂载，模块不重算）
 * 标记保持，弹窗不再弹出。 */
let reminderPopupShownThisSession = false;

export default function HomePage() {
  useLocale();
  const { data: stats, loading, error: statsError, reload: reloadStats } = useApi(getStats);
  // 「第一份交付」进度需要资料关键字段（姓名/联系方式）这个事实：复用 getProfile，
  // 不新增接口。profile 加载失败不阻断面板——阶段判定退回台账/简历计数。
  const { data: profile, error: profileError, reload: reloadProfile } = useApi(getProfile);
  // 全部完成后面板消失。
  const { stages: activationStages, allDone: activationAllDone } = useActivationProgress(
    stats,
    profile,
  );
  const { data: upcomingReminders, loading: remindersLoading } = useApi(
    () => listUpcomingReminders(8),
    [],
  );
  const { data: popupSetting } = useApi(getReminderPopupSetting, []);
  const [popupVisible, setPopupVisible] = useState(false);
  // 启动路径拿到的槽位（手动点开的不算），关闭时据此释放队列。
  const reminderSlotHeld = useRef(false);
  // 一次会话只申请一次：deps 里的接口数据每次刷新都是新引用，重复申请会互相踩掉。
  const reminderRequested = useRef(false);
  const pageMounted = useRef(true);

  useEffect(() => {
    pageMounted.current = true;
    return () => {
      pageMounted.current = false;
      reminderSlotHeld.current = false;
      // 幂等：既撤销还在排队的申请，也释放已经拿到的槽位。
      releaseStartupSlot("reminder");
    };
  }, []);

  // 打开应用时：设置开启且有未完成提醒 → 弹出近期提醒（本 SPA 会话仅弹一次）。
  // 三件启动弹窗共用一条有序队列（欢迎 → 提醒 → 更新），轮到「提醒」才弹。
  useEffect(() => {
    if (reminderRequested.current || reminderPopupShownThisSession) return;
    if (!popupSetting?.enabled) return;
    if ((upcomingReminders?.length ?? 0) === 0) return;
    reminderRequested.current = true;
    void acquireStartupSlot("reminder").then(() => {
      if (!pageMounted.current) {
        releaseStartupSlot("reminder");
        return;
      }
      reminderSlotHeld.current = true;
      setPopupVisible(true);
      reminderPopupShownThisSession = true;
    });
  }, [popupSetting, upcomingReminders]);

  const closePopup = () => {
    setPopupVisible(false);
    if (reminderSlotHeld.current) {
      reminderSlotHeld.current = false;
      releaseStartupSlot("reminder");
    }
  };

  // "接下来做什么"只列**待办**，不列"你已经做了多少"——概览页上能推动人的只有前者。
  // 每一条都带数字与去处，点进去就是那件事本身。
  const todos = [
    stats?.pending_claim_count
      ? {
          key: "claims",
          icon: <AuditOutlined />,
          text: t("pagesMisc.homePage.todo.claims.text", { count: stats.pending_claim_count }),
          hint: t("pagesMisc.homePage.todo.claims.hint"),
          path: "/claims",
        }
      : null,
    stats?.apply_queue_count
      ? {
          key: "queue",
          icon: <SendOutlined />,
          text: t("pagesMisc.homePage.todo.queue.text", { count: stats.apply_queue_count }),
          hint: t("pagesMisc.homePage.todo.queue.hint"),
          path: "/apply",
        }
      : null,
    stats?.stalled_application_count
      ? {
          key: "stalled",
          icon: <FunnelPlotOutlined />,
          text: t("pagesMisc.homePage.todo.stalled.text", {
            count: stats.stalled_application_count,
          }),
          hint: t("pagesMisc.homePage.todo.stalled.hint"),
          path: "/tracker",
        }
      : null,
  ].filter((item) => item !== null);

  // 加载失败 ≠ 真的为空：失败要有横幅 + 重试入口，而不是让面板沉默地消失。
  const homeLoadError = statsError || profileError;
  const retryHomeData = () => {
    if (statsError) void reloadStats();
    if (profileError) void reloadProfile();
  };

  return (
    <div>
      {homeLoadError && (
        <Alert
          type="error"
          showIcon
          title={t("pagesMisc.homePage.loadFailed.title", { error: homeLoadError })}
          action={
            <Button size="small" onClick={retryHomeData}>
              {t("common.retry")}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      {stats && !activationAllDone && <FirstDeliveryPanel stages={activationStages} />}

      <StatsCards stats={stats} loading={loading} />

      <RemindersCard
        reminders={upcomingReminders}
        remindersLoading={remindersLoading}
        onOpenPopup={() => setPopupVisible(true)}
      />

      {/* D11 首页顺序：统计 → 提醒 → 任务 → 待办 → 快捷入口。任务卡自己 gate 总开关与空态。 */}
      <TasksCard />

      <Card
        style={{ marginTop: 16 }}
        title={
          <Space size={8}>
            <ThunderboltOutlined />
            <span>{t("pagesMisc.homePage.section.todos")}</span>
          </Space>
        }
      >
        {loading ? (
          <Typography.Text type="secondary">{t("pagesMisc.homePage.loading")}</Typography.Text>
        ) : todos.length > 0 ? (
          <ul className="home-todo-list">
            {todos.map((todo) => (
              <li key={todo.key} className="home-todo-item">
                <span className="home-todo-icon">{todo.icon}</span>
                <span className="home-todo-copy">
                  <Link to={todo.path} className="home-todo-text">
                    {todo.text}
                  </Link>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {todo.hint}
                  </Typography.Text>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Typography.Text type="secondary">{t("pagesMisc.homePage.todos.empty")}</Typography.Text>
        )}
      </Card>

      <ShortcutsCard />

      <SearchCard />

      <LatestCards stats={stats} />

      <ReminderPopup open={popupVisible} reminders={upcomingReminders} onClose={closePopup} />
    </div>
  );
}
