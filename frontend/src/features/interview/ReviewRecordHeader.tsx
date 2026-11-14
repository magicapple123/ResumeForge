// SPDX-License-Identifier: Apache-2.0
/**
 * 查看历史记录时的卡片头：返回入口 + 时间 · 岗位/简历。
 *
 * 从 `InterviewReviewPanel` 拆出：面板已贴 500 行预算，而这块只依赖 props。
 * 组件内用模块级 `t()`，所以必须订阅语言变化。
 */
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";

import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewReviewRecord } from "../../types";
import { formatServerTime } from "../../utils/serverTime";

export default function ReviewRecordHeader({
  record,
  onCloseRecord,
}: {
  record: InterviewReviewRecord;
  onCloseRecord?: () => void;
}) {
  useLocale();

  return (
    <Space wrap align="center" size={8}>
      {onCloseRecord && (
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={onCloseRecord}>
          {t("interviewReview.header.back")}
        </Button>
      )}
      <Typography.Text type="secondary">
        {t("interviewReview.header.meta", {
          // 格式化留在代码里：`{time}` 只接格式化后的结果。
          time: formatServerTime(record.created_at),
          target:
            record.resume_title || record.job_title || t("interview.reviewHistory.fallbackTitle"),
        })}
      </Typography.Text>
    </Space>
  );
}
