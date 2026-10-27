// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录详情抽屉（纯展示子组件，PR-18 拆分批从 ApplyRecordsPanel 纯搬迁）：
 * 展示单条记录的完整快照（岗位、简历、招呼语、结果、失败分类与失败信息、时间、批次）。
 * `record` 为 null 时抽屉关闭；打开/关闭由主组件 state 驱动，这里只渲染。
 */
import { Descriptions, Drawer } from "antd";
import { failureLabel, type ApplyRecord } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { TASK_ITEM_STATUS_LABEL_KEYS, failureCategoryKey } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  record: ApplyRecord | null;
  onClose: () => void;
}

export default function ApplyRecordDetailDrawer({ record, onClose }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后抽屉停在旧文案。
  useLocale();
  // 已知失败分类走语言包；后端新增、尚未登记的分类回退后端文案 / 原码（旧行为）。
  const failureText = (item: ApplyRecord): string => {
    if (!item.failure_category) return "-";
    const key = failureCategoryKey(item.failure_category);
    return key ? t(key) : failureLabel(item.failure_category, item.failure_label);
  };
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
        <Descriptions column={1} bordered size="small" colon>
          <Descriptions.Item label={t("applyRecords.column.job")}>
            {record.job_title || t("applyRecords.deletedJob")}
            {record.company ? ` · ${record.company}` : ""}
          </Descriptions.Item>
          <Descriptions.Item label={t("applyRecords.column.resume")}>
            {record.resume_title || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("applyRecords.column.greeting")}>
            {record.greeting || t("applyUi.recordDetail.defaultGreeting")}
          </Descriptions.Item>
          <Descriptions.Item label={t("applyRecords.column.result")}>
            {t(TASK_ITEM_STATUS_LABEL_KEYS[record.status])}
          </Descriptions.Item>
          <Descriptions.Item label={t("applyRecords.column.failureKind")}>
            {failureText(record)}
          </Descriptions.Item>
          <Descriptions.Item label={t("applyUi.recordDetail.failureDetail")}>
            {record.failure_detail || "-"}
          </Descriptions.Item>
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
      )}
    </Drawer>
  );
}
