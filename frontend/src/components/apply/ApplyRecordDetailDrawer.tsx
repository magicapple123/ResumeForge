// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录详情抽屉（#39 终版：按「发生了什么 / 在哪一步 / 你该怎么做」三段重排）。
 *
 * 旧版是 8 行平铺的 Descriptions（岗位/简历/招呼语/结果/失败分类/失败信息/时间/批次）。
 * 它把三类完全不同的信息混在一张表里：**事实**（投哪个岗、第几次）、**定位**（失败发生在
 * 哪一步、哪个控件）、**行动**（现在该干什么）。失败原因只有一个中文分类 + 一段长诊断，
 * 用户得自己从长句里读出"这次该等一等，还是该去登录，还是该反馈给我们"。
 *
 * 新版按这三段拆开，并且「你该怎么做」**由失败子码决定**（子码 → 建议的映射在下面
 * ADVICE_KEYS 里，文案在语言包）：同一个「页面结构变化 / 选择器失效」大类下，
 * site_changed 和 render_timeout 给的是两条不同的建议，这正是 #39 要的"建议与子码对应"。
 *
 * 没失败的记录（成功 / 跳过）只渲染第一段（含时间与批次），不显示空的三段标题。
 *
 * T07「我已提交」：**投递成功**的记录多一段「记录投递结果」——点一次按钮即复用后端的
 * record_applied 写路径（track 去重 + 投递快照 + 7 天后 hr_reply 提醒），成功后把提醒
 * 日期如实显示出来。一次性引导只在后端返回 `show_followup_hint=true` 时出现：总开关关着
 * 时后端既不弹也不标记已弹，前端不自己判断开关（否则两处 gate 会漂）。
 */
import { Alert, App, Button, Collapse, Descriptions, Space, Tag, Typography, Drawer } from "antd";
import { useState } from "react";
import { markRecordSubmitted, type ApplyRecordSubmittedResponse } from "../../api/apply";
import DeliveryReceipt from "../../features/apply/receipt/DeliveryReceipt";
import { failureLabel, type ApplyRecord } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t, type MessageKey } from "../../i18n";
import {
  STEP_LABEL_KEYS,
  TASK_ITEM_STATUS_LABEL_KEYS,
  failureCategoryKey,
  failureReasonKey,
  failureTargetKey,
} from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  record: ApplyRecord | null;
  onClose: () => void;
}

/**
 * 失败子码 → 「你该怎么做」的文案 key。
 *
 * 键是后端下发的稳定子码（services/apply/failure_taxonomy.py），不是展示文案；未登记的子码
 * 不给建议（抽屉里显示"未识别"），而不是编一条放之四海而皆准的"请重试"——那正是这条
 * 验收要消灭的空话。
 */
const ADVICE_KEYS: Record<string, MessageKey> = {
  site_changed: "applyUi.recordDetail.advice.site_changed",
  render_timeout: "applyUi.recordDetail.advice.render_timeout",
  page_not_navigated: "applyUi.recordDetail.advice.page_not_navigated",
  selector_missing: "applyUi.recordDetail.advice.selector_missing",
  login_required: "applyUi.recordDetail.advice.login_required",
  captcha_required: "applyUi.recordDetail.advice.captcha_required",
  greeting_missing: "applyUi.recordDetail.advice.greeting_missing",
  network_timeout: "applyUi.recordDetail.advice.network_timeout",
  upload_failed: "applyUi.recordDetail.advice.upload_failed",
  site_unsupported: "applyUi.recordDetail.advice.site_unsupported",
  profile_insufficient: "applyUi.recordDetail.advice.profile_insufficient",
  unconfirmed: "applyUi.recordDetail.advice.unconfirmed",
  unknown: "applyUi.recordDetail.advice.unknown",
};

function adviceKey(reason: string): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(ADVICE_KEYS, reason)
    ? ADVICE_KEYS[reason]
    : undefined;
}

export default function ApplyRecordDetailDrawer({ record, onClose }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后抽屉停在旧文案。
  useLocale();
  const { message } = App.useApp();
  // 「我已提交」的本地结果按记录 id 存：抽屉开着换记录时不能把上一条的提醒日期带过来。
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<{
    recordId: number;
    result: ApplyRecordSubmittedResponse;
  } | null>(null);
  // 交付单是展开才读的（GET .../receipt），收起时不发请求、不占首屏。
  const [receiptOpen, setReceiptOpen] = useState(false);
  const submissionResult =
    record !== null && submission !== null && submission.recordId === record.id
      ? submission.result
      : null;

  const markSubmitted = async () => {
    if (!record || submitting) return;
    setSubmitting(true);
    try {
      const result = await markRecordSubmitted(record.id);
      setSubmission({ recordId: record.id, result });
      message.success(t("applyUi.recordDetail.submitted.toast"));
    } catch (error) {
      message.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : t("applyUi.recordDetail.submitted.error"),
      );
    } finally {
      setSubmitting(false);
    }
  };
  // 已知失败分类走语言包；后端新增、尚未登记的分类回退后端文案 / 原码（旧行为）。
  const failureText = (item: ApplyRecord): string => {
    if (!item.failure_category) return "-";
    const key = failureCategoryKey(item.failure_category);
    return key ? t(key) : failureLabel(item.failure_category, item.failure_label);
  };
  const stepLabelText = record?.failure_step
    ? STEP_LABEL_KEYS[record.failure_step]
      ? t(STEP_LABEL_KEYS[record.failure_step])
      : record.failure_step
    : "";
  const targetKey = record ? failureTargetKey(record.failure_target ?? "") : undefined;
  const reason = record?.failure_reason ?? "";
  const reasonKey = failureReasonKey(reason);
  const advice = adviceKey(reason);
  const failed = Boolean(record?.failure_category);

  return (
    <Drawer
      title={t("applyUi.recordDetail.title")}
      placement="right"
      size={480}
      open={record !== null}
      onClose={onClose}
      destroyOnHidden
    >
      {record && (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          {/* ===== 第一段：发生了什么（事实 + 分类 + 子码 + 诊断）===== */}
          <section>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t("applyUi.recordDetail.section.what")}
            </Typography.Title>
            <Descriptions column={1} bordered size="small" colon>
              <Descriptions.Item label={t("applyRecords.column.job")}>
                {record.job_title || t("applyRecords.deletedJob")}
                {record.company ? " · " + record.company : ""}
              </Descriptions.Item>
              <Descriptions.Item label={t("applyRecords.column.result")}>
                <Tag>{t(TASK_ITEM_STATUS_LABEL_KEYS[record.status])}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("applyRecords.column.resume")}>
                {record.resume_title || "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("applyRecords.column.greeting")}>
                {record.greeting || t("applyUi.recordDetail.defaultGreeting")}
              </Descriptions.Item>
              {failed ? (
                <Descriptions.Item label={t("applyRecords.column.failureKind")}>
                  {failureText(record)}
                </Descriptions.Item>
              ) : null}
              {failed ? (
                <Descriptions.Item label={t("applyUi.recordDetail.failureCode")}>
                  <Space size={6} wrap>
                    {reason ? (
                      <Typography.Text code>{reason}</Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">
                        {t("applyUi.recordDetail.unidentified")}
                      </Typography.Text>
                    )}
                    {reasonKey ? (
                      <Typography.Text type="secondary">{t(reasonKey)}</Typography.Text>
                    ) : null}
                  </Space>
                </Descriptions.Item>
              ) : null}
              {failed ? (
                <Descriptions.Item label={t("applyUi.recordDetail.failureDetail")}>
                  {record.failure_detail || "-"}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </section>

          {/* ===== T07：记录投递结果（仅投递成功的记录）===== */}
          {record.status === "success" ? (
            <section data-testid="apply-record-submit-section">
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                {t("applyUi.recordDetail.submitted.section")}
              </Typography.Title>
              {submissionResult ? (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Tag color="success">{t("applyUi.recordDetail.submitted.done")}</Tag>
                  <Typography.Text type="secondary">
                    {t("applyUi.recordDetail.submitted.reminder", {
                      date: formatDateTime(submissionResult.reminder_due_at),
                    })}
                  </Typography.Text>
                  {/* 一次性引导由后端 gate（show_followup_hint）：关掉任务卡总开关后恒为 false。 */}
                  {submissionResult.show_followup_hint ? (
                    <div data-testid="apply-record-followup-hint">
                      <Alert
                        type="info"
                        showIcon
                        title={t("applyUi.recordDetail.submitted.hintTitle")}
                        description={t("applyUi.recordDetail.submitted.hintBody")}
                      />
                    </div>
                  ) : null}
                </Space>
              ) : (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  <Typography.Text type="secondary">
                    {t("applyUi.recordDetail.submitted.hint")}
                  </Typography.Text>
                  <Button
                    type="primary"
                    loading={submitting}
                    onClick={() => void markSubmitted()}
                    data-testid="apply-record-mark-submitted"
                  >
                    {t("applyUi.recordDetail.submitted.action")}
                  </Button>
                </Space>
              )}
            </section>
          ) : null}

          {/* ===== 第二段：在哪一步（阶段 + 环节 + 时间 + 批次）===== */}
          <section>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t("applyUi.recordDetail.section.where")}
            </Typography.Title>
            <Descriptions column={1} bordered size="small" colon>
              {failed ? (
                <Descriptions.Item label={t("applyUi.recordDetail.step")}>
                  {stepLabelText || t("applyUi.recordDetail.unidentified")}
                </Descriptions.Item>
              ) : null}
              {failed ? (
                <Descriptions.Item label={t("applyUi.recordDetail.target")}>
                  {targetKey ? t(targetKey) : t("applyUi.recordDetail.unidentified")}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={t("applyUi.recordDetail.time")}>
                {formatDateTime(record.finished_at || record.created_at)}
              </Descriptions.Item>
              <Descriptions.Item label={t("applyUi.recordDetail.taskBatch")}>
                {t("applyUi.recordDetail.batchAttempt", {
                  id: record.task_id,
                  attempt: record.attempt,
                })}
              </Descriptions.Item>
            </Descriptions>
          </section>

          {/* ===== T09：投递交付单（展开才读取；失败记录也可读，用于解释"卡在人手上"）===== */}
          <Collapse
            size="small"
            items={[
              {
                key: "receipt",
                label: t("deliveryReceipt.title"),
                children: receiptOpen ? <DeliveryReceipt recordId={record.id} /> : null,
              },
            ]}
            activeKey={receiptOpen ? ["receipt"] : []}
            onChange={(keys) =>
              setReceiptOpen((Array.isArray(keys) ? keys : [keys]).includes("receipt"))
            }
          />

          {/* ===== 第三段：你该怎么做（建议由子码决定）===== */}
          {failed ? (
            <section>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                {t("applyUi.recordDetail.section.advice")}
              </Typography.Title>
              {advice ? (
                <Alert type="info" showIcon description={t(advice)} />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  description={t("applyUi.recordDetail.unidentified")}
                />
              )}
            </section>
          ) : null}
        </Space>
      )}
    </Drawer>
  );
}
