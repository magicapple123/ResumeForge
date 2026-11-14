// SPDX-License-Identifier: Apache-2.0
/**
 * 匹配结果的「用的是哪份简历」说明：显示标题与版本，输入变了给「结论已过期」警告。
 *
 * 没有 source 的旧结论要明确说「来源未知」，而不是默认成「当前简历」——那会让用户以为
 * 这份结论是刚算的。
 */
import { Alert, Space, Typography } from "antd";
import type { JobMatchResult } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function JobMatchSourceNotice({
  result,
  stale,
}: {
  result: JobMatchResult;
  stale?: boolean;
}) {
  useLocale();
  const source = result.source;
  return (
    <Space orientation="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
      <Typography.Text type="secondary">
        {source?.resume_id
          ? t("jobMatch.resume.source", {
              title: source.resume_title,
              revision: source.resume_revision ?? 0,
            })
          : t(source ? "jobMatch.resume.profileOnly" : "jobMatch.resume.unknownSource")}
      </Typography.Text>
      {stale && <Alert type="warning" showIcon title={t("jobMatch.resume.stale")} />}
    </Space>
  );
}
