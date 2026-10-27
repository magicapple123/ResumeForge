// SPDX-License-Identifier: Apache-2.0
/**
 * 执行进度面板：全局计数 + 逐岗位状态机 + 熔断警示 + 暂停/停止控制。
 *
 * 两个刻意的选择：
 * - **不用百分比进度条**，只显示「已处理 N/M」——总数在运行时可能变化（队列被改、岗位被删），
 *   百分比会给人一个并不准确的确定性；设计也明确禁止渲染任何百分比（§9 ⑩）。
 * - 暂停/停止按钮**常驻**（按状态置灰而不是隐藏），用户不用去别处找停止入口。
 */
import { PauseOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Space, Spin, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  TASK_ITEM_STATUS_META,
  TASK_STATUS_META,
  failureLabel,
  stepLabel,
  type ApplyTaskDetail,
  type ApplyTaskItem,
  type TaskStatus,
} from "../../types";
import { isActiveTaskStatus as isActive } from "../../hooks/useTaskPolling";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  task: ApplyTaskDetail;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

/** 状态 → 顶部提示条的类型：熔断要醒目（error），暂停用 warning，其余用 info/success。 */
function alertType(status: TaskStatus): "error" | "warning" | "info" | "success" {
  if (status === "breaker_paused" || status === "failed") return "error";
  if (status === "paused") return "warning";
  if (status === "completed") return "success";
  return "info";
}

/**
 * 停止原因 / 批次类型的显示名：**键是后端码**（`user` / `breaker` / `done` / `error`、
 * `apply` / `collect`），值指向语言包 key。
 *
 * 模块作用域不能调 `t()`（切语言不会重渲染），所以这里只存 key，取值处 `t(...)`。
 */
const STOP_REASON_LABEL_KEYS: Record<string, MessageKey> = {
  user: "applyProgress.stopReason.user",
  breaker: "applyProgress.stopReason.breaker",
  done: "applyProgress.stopReason.done",
  error: "applyProgress.stopReason.error",
};

const KIND_LABEL_KEYS: Record<string, MessageKey> = {
  apply: "applyProgress.kind.apply",
  collect: "applyProgress.kind.collect",
};

export default function ApplyProgressPanel({ task, busy, onPause, onResume, onStop }: Props) {
  useLocale();
  const statusMeta = TASK_STATUS_META[task.status];
  const active = isActive(task.status);
  const canResume = task.status === "paused" || task.status === "breaker_paused";
  // 未登记的停止原因（后端新增码）没有 key：原样显示那个码，比显示一条 key 或空白强。
  const stopReasonKey: MessageKey | undefined = task.stop_reason
    ? STOP_REASON_LABEL_KEYS[task.stop_reason]
    : undefined;
  const alertMessage =
    task.message || (stopReasonKey ? t(stopReasonKey) : task.stop_reason ? task.stop_reason : "");
  const kindKey: MessageKey | undefined = KIND_LABEL_KEYS[task.kind];

  const columns: TableColumnsType<ApplyTaskItem> = [
    {
      title: t("applyProgress.column.job"),
      dataIndex: "job_title",
      render: (title: string, item) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{title || t("applyProgress.deletedJob")}</Typography.Text>
          {item.company && (
            <Typography.Text type="secondary" className="apply-progress-company">
              {item.company}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t("applyProgress.column.status"),
      dataIndex: "status",
      width: 96,
      render: (value: ApplyTaskItem["status"]) => {
        const meta = TASK_ITEM_STATUS_META[value];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: t("applyProgress.column.failureKind"),
      dataIndex: "failure_category",
      width: 180,
      render: (value: string) => (value ? <Tag color="red">{failureLabel(value)}</Tag> : "-"),
    },
    { title: t("applyProgress.column.attempt"), dataIndex: "attempt", width: 64 },
  ];

  const expandedRowRender = (item: ApplyTaskItem): ReactNode => (
    <Descriptions size="small" column={1} className="apply-progress-detail">
      <Descriptions.Item label={t("applyProgress.field.currentStep")}>
        {stepLabel(task.current_step)}
      </Descriptions.Item>
      <Descriptions.Item label={t("applyProgress.field.resume")}>
        {item.resume_title || t("applyProgress.defaultResume")}
      </Descriptions.Item>
      <Descriptions.Item label={t("applyProgress.field.greeting")}>
        {item.greeting || t("applyProgress.defaultGreeting")}
      </Descriptions.Item>
      {item.failure_detail && (
        // 跳过的条目也会写明细（例如「按『同公司只投一个岗位』跳过」），那是**跳过原因**
        // 不是失败诊断——同一个字段两种含义时，标签得跟着状态走，否则用户会以为出错了。
        <Descriptions.Item
          label={
            item.status === "skipped"
              ? t("applyProgress.field.skipReason")
              : t("applyProgress.field.diagnosis")
          }
        >
          {item.failure_detail}
        </Descriptions.Item>
      )}
      <Descriptions.Item label={t("applyProgress.field.startedAt")}>
        {formatDateTime(item.started_at ?? undefined)}
      </Descriptions.Item>
      <Descriptions.Item label={t("applyProgress.field.finishedAt")}>
        {formatDateTime(item.finished_at ?? undefined)}
      </Descriptions.Item>
    </Descriptions>
  );

  return (
    <section className="apply-progress-panel" aria-live="polite">
      <div className="apply-progress-head">
        <Space wrap size={12} align="center">
          <Typography.Text strong>
            {kindKey ? t(kindKey) : t("applyProgress.kindFallback")}
          </Typography.Text>
          {/* 任务进行中时在标题行给一个转动信号：状态 Tag 是静态的，转圈才能一眼看出
              "这一批正在跑"（页面滚到别处回来时尤其重要）。 */}
          {active && <Spin size="small" />}
          <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
          {active && (
            <Typography.Text type="secondary">
              {/* 步骤名仍来自 `types/apply/failures.ts` 的 `STEP_LABELS`（另一批迁移），
                  这里只负责「当前步骤：」这层外壳。 */}
              {t("applyProgress.progress", { step: stepLabel(task.current_step) })}
            </Typography.Text>
          )}
        </Space>
        <Space wrap>
          <Button
            icon={<PauseOutlined />}
            disabled={!active || task.status !== "running" || busy}
            onClick={onPause}
          >
            {t("applyProgress.action.pause")}
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={!canResume || busy}
            onClick={onResume}
          >
            {t("applyProgress.action.resume")}
          </Button>
          <Button danger icon={<StopOutlined />} disabled={!active || busy} onClick={onStop}>
            {t("applyProgress.action.stop")}
          </Button>
        </Space>
      </div>

      {alertMessage && (
        <Alert
          type={alertType(task.status)}
          showIcon
          title={alertMessage}
          className="apply-progress-alert"
        />
      )}

      <Space wrap size={16} className="apply-progress-counts">
        <Typography.Text>
          {t("applyProgress.count.processed", { done: task.processed, total: task.total })}
        </Typography.Text>
        <Typography.Text type="success">
          {t("applyProgress.count.succeeded", { count: task.succeeded })}
        </Typography.Text>
        <Typography.Text type="danger">
          {t("applyProgress.count.failed", { count: task.failed })}
        </Typography.Text>
        <Typography.Text type="secondary">
          {t("applyProgress.count.skipped", { count: task.skipped })}
        </Typography.Text>
        {/* 投递批次到终态后给下一步入口：投出去的岗位在求职进度里推进，
            不给入口用户不知道这一批"结束了然后呢"。 */}
        {!active && task.kind === "apply" && (
          <Link to="/tracker">
            <Button type="link" size="small" style={{ padding: 0 }}>
              {t("applyProgress.action.track")}
            </Button>
          </Link>
        )}
      </Space>

      {task.items.length > 0 ? (
        <Table<ApplyTaskItem>
          className="apply-progress-table"
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={task.items}
          pagination={false}
          expandable={{ expandedRowRender }}
          scroll={{ x: "max-content" }}
        />
      ) : (
        <Typography.Paragraph type="secondary" className="apply-progress-empty">
          {task.kind === "collect"
            ? t("applyProgress.empty.collect")
            : t("applyProgress.empty.apply")}
        </Typography.Paragraph>
      )}
    </section>
  );
}
