/** 首页：数据概览、"接下来做什么"、全局搜索与最近动态。 */
import {
  AuditOutlined,
  FunnelPlotOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listUpcomingReminders } from "../api/reminders";
import { getProfile } from "../api/profile";
import { getStats } from "../api/search";
import { getReminderPopupSetting } from "../api/settings";
import { useApi } from "../hooks/useApi";
import { onceUserGuideClosed } from "../utils/userGuide";
import { FirstDeliveryPanel } from "../features/activation/FirstDeliveryPanel";
import { useActivationProgress } from "../features/activation/useActivationProgress";
import { LatestCards } from "./home/LatestCards";
import { ReminderPopup } from "./home/ReminderPopup";
import { RemindersCard } from "./home/RemindersCard";
import { SearchCard } from "./home/SearchCard";
import { ShortcutsCard } from "./home/ShortcutsCard";
import { StatsCards } from "./home/StatsCards";

/** 启动弹窗在一次 SPA 会话内只弹一次。
 *
 * 用模块级标记而不是 localStorage：模块在整页刷新时会被重新求值，标记随之归零，
 * 满足「刷新后可再弹一次」；而在 SPA 内切走再回首页（组件卸载/挂载，模块不重算）
 * 标记保持，弹窗不再弹出。 */
let reminderPopupShownThisSession = false;

export default function HomePage() {
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

  // 打开应用时：设置开启且有未完成提醒 → 弹出近期提醒（本 SPA 会话仅弹一次）。
  // 欢迎引导还开着时排在它后面（关闭后再弹）：两个启动弹窗叠在一起，提醒会被盖住。
  useEffect(() => {
    if (reminderPopupShownThisSession) return;
    if (!popupSetting?.enabled) return;
    if ((upcomingReminders?.length ?? 0) === 0) return;
    return onceUserGuideClosed(() => {
      setPopupVisible(true);
      reminderPopupShownThisSession = true;
    });
  }, [popupSetting, upcomingReminders]);

  // "接下来做什么"只列**待办**，不列"你已经做了多少"——概览页上能推动人的只有前者。
  // 每一条都带数字与去处，点进去就是那件事本身。
  const todos = [
    stats?.pending_claim_count
      ? {
          key: "claims",
          icon: <AuditOutlined />,
          text: `有 ${stats.pending_claim_count} 条事实还没核实`,
          hint: "没核实的主张不能进正式简历，导出时会被拦下",
          path: "/claims",
        }
      : null,
    stats?.apply_queue_count
      ? {
          key: "queue",
          icon: <SendOutlined />,
          text: `投递队列里有 ${stats.apply_queue_count} 个岗位在等`,
          hint: "排好队、启动浏览器就能投",
          path: "/apply",
        }
      : null,
    stats?.stalled_application_count
      ? {
          key: "stalled",
          icon: <FunnelPlotOutlined />,
          text: `有 ${stats.stalled_application_count} 条投递超过一周没更新`,
          hint: "去看看要不要补一句跟进或改状态",
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
          title={`首页数据加载失败：${homeLoadError}`}
          action={
            <Button size="small" onClick={retryHomeData}>
              重试
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

      <Card
        style={{ marginTop: 16 }}
        title={
          <Space size={8}>
            <ThunderboltOutlined />
            <span>接下来做什么</span>
          </Space>
        }
      >
        {loading ? (
          <Typography.Text type="secondary">正在读取…</Typography.Text>
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
          <Typography.Text type="secondary">
            眼下没有待办。可以去「岗位广场」收几个岗位，或到「求职助手」聊聊下一步。
          </Typography.Text>
        )}
      </Card>

      <ShortcutsCard />

      <SearchCard />

      <LatestCards stats={stats} />

      <ReminderPopup
        open={popupVisible}
        reminders={upcomingReminders}
        onClose={() => setPopupVisible(false)}
      />
    </div>
  );
}
