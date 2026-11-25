// SPDX-License-Identifier: Apache-2.0
/**
 * 「任务卡」总开关（设置页 · 记忆与技能；T04）。
 *
 * 配置键名仍是 `agent_task_events`（不做迁移），语义升级为**总开关**：
 * 关 = 提醒到期不再生成任务卡 + 首页「任务」卡不再显示（数据保留，重开恢复）。
 * 扫描器已在后端按开关 gate；显示层由前端 gate（首页 TasksCard 不渲染、不轮询），
 * 列表接口**不**按开关返回空数组——否则开关默认关闭会让任务相关用例全部变成空列表。
 *
 * 关闭前检查未完成任务（D8）：draft / running / paused / waiting_approval 任一存在就
 * 先弹确认（按钮文案「仍要关闭」，不用「确定」）。modal 取自 `App.useApp()`，不读静态
 * `Modal.confirm`（深色主题下会退回浅色 token）。
 */
import { App, Button, Card, Flex, Modal, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { listAgentTasks } from "../../api/agentTasks";
import type { AgentTask } from "../../api/agentTasks";
import { getAgentTaskEvents, setAgentTaskEvents } from "../../api/settings";
import { AGENT_TASK_SOURCE_REMINDER, visibleTasks } from "../assistant/tasks/agentTaskView";
import ReminderTaskRow from "../assistant/tasks/ReminderTaskRow";
import EmptyState from "../../components/common/EmptyState";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import SettingsResetButton from "./SettingsResetButton";
import { useSettingsResetListener } from "./useSettingsResetListener";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 关闭前要提醒的「还没结束」状态（D8）。 */
const UNFINISHED_STATUSES: readonly string[] = ["draft", "running", "paused", "waiting_approval"];

/** I-10：这张卡能恢复默认的键（总开关；默认关，不受其它 assistant 作用域设置影响）。 */
const AGENT_TASK_RESET_KEYS = ["agent_task_events_enabled"];

/**
 * 「查看历史」弹窗首版取最近多少条（CR-20）。
 *
 * 这里只放提醒类任务卡：它们终态后首页就不再展示（首页只回答"接下来做什么"），
 * 但用户仍要能回头确认"那条提醒我到底处理过没有"。
 */
const HISTORY_LIMIT = 20;

export default function AgentTaskEventsCard() {
  useLocale();
  const { message, modal } = App.useApp();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 关闭前统计未完成任务期间的 loading（与保存分开，避免确认弹窗里按钮一直转圈）。
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // 提醒历史弹窗（CR-20）：默认关闭，打开时才拉一次列表（不跟着首页 5s 轮询跑）。
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AgentTask[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const saved = await getAgentTaskEvents();
      setEnabled(saved.enabled);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 拉一次提醒卡历史：只要提醒来源、按最近更新倒序、取前 N 条。 */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const tasks = await listAgentTasks();
      const reminders = tasks
        .filter((task) => (task.source || "").trim() === AGENT_TASK_SOURCE_REMINDER)
        // `updated_at` 是后端 naive UTC 的 ISO 串：字符串倒序即时间倒序，不必解析时区。
        .sort((left, right) => (right.updated_at > left.updated_at ? 1 : -1))
        .slice(0, HISTORY_LIMIT);
      setHistory(reminders);
    } catch {
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = () => {
    setHistoryOpen(true);
    void loadHistory();
  };

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAgentTaskEvents();
        if (!cancelled) setEnabled(saved.enabled);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // I-10：恢复默认后重取开关（重置直接删行，前端必须重新问一次才知道现在是关的）。
  useSettingsResetListener(() => void load());

  const applyChange = useCallback(
    async (checked: boolean) => {
      setSaving(true);
      setEnabled(checked);
      try {
        const saved = await setAgentTaskEvents({ enabled: checked });
        setEnabled(saved.enabled);
        message.success(
          checked
            ? t("settingsUi.agentTaskEvents.enableToast")
            : t("settingsUi.agentTaskEvents.disableToast"),
        );
      } catch (err) {
        setEnabled(!checked);
        message.error(
          err instanceof Error ? err.message : t("settingsUi.agentTaskEvents.saveFailed"),
        );
      } finally {
        setSaving(false);
      }
    },
    [message],
  );

  /** 关闭前统计未完成任务；有则先确认，没有/统计失败就直接关。 */
  const onChange = async (checked: boolean) => {
    if (saving || checking) return;
    if (!checked) {
      setChecking(true);
      let unfinished = 0;
      try {
        const tasks = await listAgentTasks();
        // D5 空壳任务不在首页显示，也不算进"未完成"的确认数量（否则弹窗数字会大于首页可见的）。
        unfinished = visibleTasks(tasks).filter((task) =>
          UNFINISHED_STATUSES.includes(task.status),
        ).length;
      } catch {
        // 统计失败不阻断关闭：读不到任务数时不做确认（不能因此关不掉开关）。
        // unfinished 保持 0，不做赋值（赋值覆盖不了任何后续读取）。
      } finally {
        setChecking(false);
      }
      if (unfinished > 0) {
        modal.confirm({
          title: t("settingsUi.agentTaskEvents.confirmTitle"),
          content: t("settingsUi.agentTaskEvents.confirmBody", { count: unfinished }),
          okText: t("settingsUi.agentTaskEvents.confirmOk"),
          cancelText: t("common.action.cancel"),
          onOk: () => applyChange(false),
        });
        return;
      }
    }
    void applyChange(checked);
  };

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("settingsUi.agentTaskEvents.title")}</span>
          {/* I-10：卡片级恢复默认（总开关回到「关」）。 */}
          <SettingsResetButton keys={AGENT_TASK_RESET_KEYS} />
        </Flex>
      }
      extra={
        <Button type="link" size="small" onClick={openHistory}>
          {t("settingsUi.agentTaskEvents.history")}
        </Button>
      }
      className="settings-card"
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.agentTaskEvents.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        {loadError ? (
          <ErrorState
            description={t("settingsUi.agentTaskEvents.loadFailed")}
            onRetry={() => void load()}
          />
        ) : (
          <Space orientation="vertical" size={4}>
            <Switch
              checked={enabled}
              loading={saving || checking}
              checkedChildren={t("settingsUi.switch.on")}
              unCheckedChildren={t("settingsUi.switch.off")}
              aria-label={t("settingsUi.agentTaskEvents.toggleAria")}
              onChange={(checked) => void onChange(checked)}
            />
            <Typography.Text type={enabled ? "warning" : "secondary"}>
              {enabled
                ? t("settingsUi.agentTaskEvents.stateOn")
                : t("settingsUi.agentTaskEvents.stateOff")}
            </Typography.Text>
          </Space>
        )}
      </LoadingBlock>
      {/* 只读弹窗：footer={null}，关闭只走右上角 ×（与 antd 原生只读弹窗同口径）。 */}
      <Modal
        open={historyOpen}
        title={t("settingsUi.agentTaskEvents.historyTitle")}
        footer={null}
        width={560}
        onCancel={() => setHistoryOpen(false)}
      >
        <LoadingBlock spinning={historyLoading}>
          {historyError ? (
            <ErrorState
              description={t("settingsUi.agentTaskEvents.historyFailed")}
              onRetry={() => void loadHistory()}
            />
          ) : history.length === 0 ? (
            <EmptyState inline description={t("settingsUi.agentTaskEvents.historyEmpty")} />
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: 10,
                maxHeight: "60vh",
                overflowY: "auto",
              }}
            >
              {history.map((task) => (
                <ReminderTaskRow key={task.id} task={task} readOnly />
              ))}
            </ul>
          )}
        </LoadingBlock>
      </Modal>
    </Card>
  );
}
