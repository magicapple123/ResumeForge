// SPDX-License-Identifier: Apache-2.0
/** 投递记录表格的列定义（从 ApplyRecordsPanel 拆出，压 500 行预算）。
 *
 * 纯展示：列头文案、结果/失败分类的渲染与行内动作。数据加载、筛选、批次分组与
 * 删除/重投的行为留在面板本体。
 */
import { EyeOutlined, RedoOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import ApplyRecordTrackButton from "./ApplyRecordTrackButton";
import JdChangeBadge from "./insights/JdChangeBadge";
import { RowActions } from "../../components/common/RowActions";
import { formatDateTime } from "../../utils/format";
import { TASK_ITEM_STATUS_META, failureLabel, type ApplyRecord } from "../../types";
import { t } from "../../i18n";
import {
  STEP_LABEL_KEYS,
  TASK_ITEM_STATUS_LABEL_KEYS,
  failureCategoryKey,
  failureReasonKey,
} from "../../i18n/enum/apply";

interface ApplyRecordColumnOptions {
  disabled: boolean;
  /** 正在重投的记录 id（重投按钮 loading 用）。 */
  retryingId: number | null;
  onRetry: (record: ApplyRecord) => void;
  onRemove: (record: ApplyRecord) => void;
  onOpenDetail: (record: ApplyRecord) => void;
}

export function buildApplyRecordColumns({
  disabled,
  retryingId,
  onRetry,
  onRemove,
  onOpenDetail,
}: ApplyRecordColumnOptions): TableColumnsType<ApplyRecord> {
  return [
    {
      title: t("applyRecords.column.job"),
      dataIndex: "job_title",
      ellipsis: true,
      render: (title: string, record) => (
        <Space orientation="vertical" size={0} style={{ width: "100%" }}>
          <Typography.Text ellipsis>{title || t("applyRecords.deletedJob")}</Typography.Text>
          {record.company && (
            <Typography.Text type="secondary" ellipsis>
              {record.company}
            </Typography.Text>
          )}
          {/* #15B JD 变更（被动式）：徽标与抽屉整块在组件里，本文件只挂一行。 */}
          <JdChangeBadge record={record} />
        </Space>
      ),
    },
    {
      title: t("applyRecords.column.result"),
      dataIndex: "status",
      width: 80,
      render: (value: ApplyRecord["status"]) => {
        const meta = TASK_ITEM_STATUS_META[value];
        return <Tag color={meta.color}>{t(TASK_ITEM_STATUS_LABEL_KEYS[value])}</Tag>;
      },
    },
    {
      title: t("applyRecords.column.failureKind"),
      key: "failure",
      ellipsis: true,
      render: (_, record) => {
        if (!record.failure_category) return "-";
        // 已知分类走语言包；后端新增、尚未登记的分类回退后端文案 / 原码（旧行为）。
        const key = failureCategoryKey(record.failure_category);
        const reasonKey = failureReasonKey(record.failure_reason ?? "");
        const step = record.failure_step ?? "";
        const stepLabelText = STEP_LABEL_KEYS[step] ? t(STEP_LABEL_KEYS[step]) : "";
        // #39：具体原因随分类一起显示（failure_detail 是后端诊断串，截一行摘要）。
        const detail = record.failure_detail.trim().split(String.fromCharCode(10))[0];
        // #39 返工：列首 Tag 直接显示**子码中文**（大类名只作兜底）——原先 Tag=大类、
        // 右侧再排一条子码中文，同一条信息出现了两遍，窄列里还把原码挤到换行。
        const primaryLabel = reasonKey
          ? t(reasonKey)
          : key
            ? t(key)
            : failureLabel(record.failure_category, record.failure_label);
        return (
          <Space orientation="vertical" size={0}>
            {/* Tag=子码中文（可读结论）；原码小字（可筛选、可给建议）；第三行=诊断摘要。 */}
            <Space size={4} wrap>
              <Tag color="red">{primaryLabel}</Tag>
              {record.failure_reason ? (
                <Typography.Text code style={{ fontSize: 12 }}>
                  {record.failure_reason}
                </Typography.Text>
              ) : null}
            </Space>
            {detail || stepLabelText ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                {[stepLabelText, detail].filter(Boolean).join(" · ")}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: t("applyRecords.column.resume"),
      dataIndex: "resume_title",
      width: 120,
      ellipsis: true,
      render: (v: string) => v || "-",
    },
    {
      title: t("applyRecords.column.greeting"),
      dataIndex: "greeting",
      ellipsis: true,
      render: (v: string) => v || t("applyRecords.defaultGreeting"),
    },
    {
      title: t("applyRecords.column.finishedAt"),
      key: "finished_at",
      width: 150,
      render: (_, record) => formatDateTime(record.finished_at || record.created_at),
    },
    {
      title: t("applyRecords.column.actions"),
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<RedoOutlined />}
            loading={retryingId === record.id}
            disabled={disabled || record.job_id == null}
            onClick={() => onRetry(record)}
          >
            {t("applyRecords.action.retry")}
          </Button>
          {/* #14C 跟进闭环：投出去之后的事在求职进度里，这里一键把它写进去。 */}
          <ApplyRecordTrackButton record={record} />
          {/* 「查看详情」与「删除」都收进「···」菜单：整行点击本来就能看详情，
              独立的「详 情」按钮与「···」并排是重复入口（用户反馈）。 */}
          <RowActions
            more={[
              {
                key: "detail",
                label: t("applyRecords.action.viewDetail"),
                icon: <EyeOutlined />,
                onClick: () => onOpenDetail(record),
              },
              {
                key: "delete",
                label: t("common.action.delete"),
                danger: true,
                confirm: t("applyRecords.confirm.deleteRecord"),
                onClick: () => onRemove(record),
              },
            ]}
          />
        </Space>
      ),
    },
  ];
}
