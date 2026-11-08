// SPDX-License-Identifier: Apache-2.0
/**
 * 投递交付单（T09）：已有投递快照的**只读验收视图**。
 *
 * 五条硬约束（计划 §6.2.5）在界面上的落点：
 * - 三态与优先级**只由后端给**（waiting_human > has_doubts > ready）。本组件里没有
 *   "有疑点就标黄""没人手只剩就标绿"这类重算——那会让同一份数据在两处得出不同结论；
 * - 不 live 导出 PDF、不重算历史：页数与格式都取快照里的既有值；
 * - 不新增指纹列：指纹不同只在简历版本旁标「投出后简历改过」，**不参与三态**；
 * - 不提供删除/归档：验收只写 receipt_acked_at，不碰求职进度；
 * - 不另起列表：这里就是抽屉里的展开视图。
 *
 * 失败记录同样可读（"卡在人手上"是正常终态，不是错误），所以这里不按记录状态 gate。
 */
import { App, Button, Descriptions, Space, Tag, Typography } from "antd";
import { useState } from "react";
import {
  ackDeliveryReceipt,
  getDeliveryReceipt,
  type DeliveryReceipt as DeliveryReceiptData,
  type DeliveryReceiptState,
} from "../../../api/deliveryReceipt";
import EmptyState from "../../../components/common/EmptyState";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { useApi } from "../../../hooks/useApi";
import { formatDateTime } from "../../../utils/format";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import "../../../styles/delivery-receipt.css";

/**
 * 三态徽标：**协议值 → 展示名/颜色**的纯映射表。
 *
 * 注意这里只做"取哪个标签"，没有任何"该显示哪个 state"的判断——state 由后端算好。
 */
const STATE_META: Record<DeliveryReceiptState, { labelKey: MessageKey; color: string }> = {
  waiting_human: { labelKey: "deliveryReceipt.state.waiting_human", color: "warning" },
  has_doubts: { labelKey: "deliveryReceipt.state.has_doubts", color: "gold" },
  ready: { labelKey: "deliveryReceipt.state.ready", color: "success" },
};

const STATE_FALLBACK = {
  labelKey: "deliveryReceipt.stateUnknown" as MessageKey,
  color: "default",
};

/** 稳定码 → 展示名；未登记的码回退显示原码（不猜、不留空白）。 */
const REASON_LABEL_KEYS: Record<string, MessageKey> = {
  captcha_required: "deliveryReceipt.reason.captcha_required",
  login_required: "deliveryReceipt.reason.login_required",
  reupload_resume: "deliveryReceipt.reason.reupload_resume",
  answer_screening_questions: "deliveryReceipt.reason.answer_screening_questions",
  fill_required_field: "deliveryReceipt.reason.fill_required_field",
  confirm_in_browser: "deliveryReceipt.reason.confirm_in_browser",
  doubts_present: "deliveryReceipt.reason.doubts_present",
  snapshot_missing: "deliveryReceipt.reason.snapshot_missing",
  artifact_missing: "deliveryReceipt.reason.artifact_missing",
  page_limit: "deliveryReceipt.reason.page_limit",
};

function reasonLabel(code: string): string {
  const key = REASON_LABEL_KEYS[code];
  return key ? t(key) : code;
}

interface Props {
  recordId: number;
}

export default function DeliveryReceipt({ recordId }: Props) {
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error, reload, setData } = useApi<DeliveryReceiptData>(
    () => getDeliveryReceipt(recordId),
    [recordId],
  );
  const [acking, setAcking] = useState(false);

  if (loading && !data) return <LoadingBlock />;
  if (!data) {
    return (
      <ErrorState
        description={error || t("deliveryReceipt.error.load")}
        onRetry={() => void reload()}
      />
    );
  }

  const stateMeta = STATE_META[data.state] ?? STATE_FALLBACK;
  const acked = data.receipt_acked_at;

  const ack = async () => {
    if (acking) return;
    setAcking(true);
    try {
      const result = await ackDeliveryReceipt(recordId);
      setData({ ...data, receipt_acked_at: result.receipt_acked_at });
      message.success(t("deliveryReceipt.ack.toast"));
    } catch (ackError) {
      message.error(
        ackError instanceof Error && ackError.message.trim()
          ? ackError.message
          : t("deliveryReceipt.ack.error"),
      );
    } finally {
      setAcking(false);
    }
  };

  return (
    <section className="delivery-receipt" data-testid={`delivery-receipt-${recordId}`}>
      <div className="delivery-receipt-head">
        <Tag color={stateMeta.color} data-testid="delivery-receipt-state">
          {t(stateMeta.labelKey)}
        </Tag>
        {!STATE_META[data.state] ? <Typography.Text code>{data.state}</Typography.Text> : null}
        {data.state_reasons.map((code) => (
          <Tag key={code}>{reasonLabel(code)}</Tag>
        ))}
      </div>

      {data.delivery ? (
        <section className="delivery-receipt-section">
          <Typography.Title level={5}>{t("deliveryReceipt.section.delivery")}</Typography.Title>
          <Descriptions column={1} bordered size="small" colon>
            <Descriptions.Item label={t("deliveryReceipt.field.job")}>
              {[data.delivery.company, data.delivery.job_title].filter(Boolean).join(" · ")}
            </Descriptions.Item>
            <Descriptions.Item label={t("deliveryReceipt.field.resume")}>
              <Space size={6} wrap>
                <span>{data.delivery.resume_title || "-"}</span>
                {data.delivery.resume_changed_since_delivery ? (
                  <Tag color="warning">{t("deliveryReceipt.field.resumeChanged")}</Tag>
                ) : null}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t("deliveryReceipt.field.pages")}>
              {/* apply 快照不带产物信息（ADR-0002）：null 显示"未记录"，不是缺件。 */}
              {data.delivery.pages !== null && data.delivery.page_limit !== null
                ? t("deliveryReceipt.field.pagesValue", {
                    pages: data.delivery.pages,
                    limit: data.delivery.page_limit,
                  })
                : t("deliveryReceipt.field.notRecorded")}
            </Descriptions.Item>
            <Descriptions.Item label={t("deliveryReceipt.field.format")}>
              {data.delivery.export_format ?? t("deliveryReceipt.field.notRecorded")}
            </Descriptions.Item>
            <Descriptions.Item label={t("deliveryReceipt.field.createdAt")}>
              {formatDateTime(data.delivery.created_at)}
            </Descriptions.Item>
          </Descriptions>
        </section>
      ) : (
        <EmptyState inline description={t("deliveryReceipt.empty.snapshot")} />
      )}

      {data.fill ? (
        <section className="delivery-receipt-section">
          <Typography.Title level={5}>{t("deliveryReceipt.section.fill")}</Typography.Title>
          <Space size={8} wrap>
            <Typography.Text type="secondary">
              {data.fill.unknown
                ? t("deliveryReceipt.fill.unknown")
                : data.fill.matched
                  ? t("deliveryReceipt.fill.matched")
                  : t("deliveryReceipt.field.notRecorded")}
            </Typography.Text>
            <Typography.Text>
              {t("deliveryReceipt.fill.count", {
                filled: data.fill.filled_count,
                total: data.fill.total_count,
              })}
            </Typography.Text>
            {data.fill.failed_count > 0 ? (
              <Typography.Text type="danger">
                {t("deliveryReceipt.fill.failed", { count: data.fill.failed_count })}
              </Typography.Text>
            ) : null}
          </Space>
        </section>
      ) : null}

      <section className="delivery-receipt-section">
        <Typography.Title level={5}>{t("deliveryReceipt.section.doubts")}</Typography.Title>
        <Typography.Text>
          {t("deliveryReceipt.doubts.count", { count: data.doubts.count })}
        </Typography.Text>
      </section>

      <section className="delivery-receipt-section">
        <Typography.Title level={5}>{t("deliveryReceipt.section.humanSteps")}</Typography.Title>
        {data.human_steps.length > 0 ? (
          <ul className="delivery-receipt-steps">
            {data.human_steps.map((code) => (
              <li key={code}>{reasonLabel(code)}</li>
            ))}
          </ul>
        ) : (
          <Typography.Text type="secondary">{t("deliveryReceipt.humanSteps.none")}</Typography.Text>
        )}
      </section>

      <section className="delivery-receipt-section">
        <Typography.Title level={5}>{t("deliveryReceipt.section.followup")}</Typography.Title>
        <Typography.Text type="secondary">
          {data.followup
            ? t("deliveryReceipt.followup.due", { date: formatDateTime(data.followup.due_at) })
            : t("deliveryReceipt.followup.none")}
        </Typography.Text>
      </section>

      <div className="delivery-receipt-ack">
        {acked ? (
          <Tag color="success" data-testid="delivery-receipt-acked">
            {t("deliveryReceipt.ack.done")}
          </Tag>
        ) : (
          <>
            <Typography.Text type="secondary">{t("deliveryReceipt.ack.hint")}</Typography.Text>
            <Button
              size="small"
              loading={acking}
              onClick={() => void ack()}
              data-testid="delivery-receipt-ack"
            >
              {t("deliveryReceipt.ack.action")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
