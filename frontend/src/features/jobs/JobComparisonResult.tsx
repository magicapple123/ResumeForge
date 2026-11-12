// SPDX-License-Identifier: Apache-2.0
/**
 * 横向对比结果：名次 + 每个岗位"为什么排在这里"。
 *
 * 与逐岗卡片的分工：这里是**相对判断**（谁更适合、差在哪），下方卡片仍是每个岗位的
 * 五类结论与参考分。两者不重复，也不互相推导——排序不出现百分比，参考分不参与排序。
 */
import { Card, Space, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { JobComparisonResult, JobComparisonVerdict, JobMatchBatchItem } from "../../types";

const VERDICT_META: Record<JobComparisonVerdict, { color: string; labelKey: MessageKeyOfVerdict }> =
  {
    best: { color: "green", labelKey: "jobMatchBatch.comparison.verdict.best" },
    good: { color: "blue", labelKey: "jobMatchBatch.comparison.verdict.good" },
    fair: { color: "gold", labelKey: "jobMatchBatch.comparison.verdict.fair" },
    weak: { color: "default", labelKey: "jobMatchBatch.comparison.verdict.weak" },
  };

/** 四个 key 都是本文件直接写死的字面量，用联合类型让 `t()` 的键检查仍然生效。 */
type MessageKeyOfVerdict =
  | "jobMatchBatch.comparison.verdict.best"
  | "jobMatchBatch.comparison.verdict.good"
  | "jobMatchBatch.comparison.verdict.fair"
  | "jobMatchBatch.comparison.verdict.weak";

export default function JobComparisonResult({
  comparison,
  items,
}: {
  comparison: JobComparisonResult;
  items: JobMatchBatchItem[];
}) {
  useLocale();
  const jobById = new Map(items.map((item) => [item.job_id, item]));
  const ranked = [...comparison.items].sort((left, right) => left.rank - right.rank);
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {comparison.error ? (
        <Typography.Text type="warning">{comparison.error}</Typography.Text>
      ) : (
        <Card size="small" className="job-comparison-summary">
          <Typography.Paragraph strong style={{ marginBottom: 0 }}>
            {comparison.summary}
          </Typography.Paragraph>
        </Card>
      )}
      {ranked.map((entry) => {
        const job = jobById.get(entry.job_id);
        const verdict = VERDICT_META[entry.verdict] ?? VERDICT_META.fair;
        return (
          <Card
            key={entry.job_id}
            size="small"
            title={
              <Space size={6} wrap>
                <Tag color={entry.rank === 1 ? "gold" : "default"}>
                  {t("jobMatchBatch.comparison.rank", { rank: entry.rank })}
                </Tag>
                <span>{job?.job_title ?? entry.headline}</span>
                {job?.company ? (
                  <Typography.Text type="secondary">· {job.company}</Typography.Text>
                ) : null}
              </Space>
            }
            extra={<Tag color={verdict.color}>{t(verdict.labelKey)}</Tag>}
          >
            {entry.headline ? <Typography.Paragraph>{entry.headline}</Typography.Paragraph> : null}
            <ul className="job-comparison-reasons">
              {entry.reasons.map((reason, index) => (
                <li key={`${entry.job_id}-reason-${index}`}>{reason}</li>
              ))}
            </ul>
            {entry.concerns.length > 0 ? (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {t("jobMatchBatch.comparison.concerns", {
                  concerns: entry.concerns.join(t("jobMatchBatch.comparison.separator")),
                })}
              </Typography.Paragraph>
            ) : null}
          </Card>
        );
      })}
      <Typography.Text type="secondary">{t("jobMatchBatch.comparison.disclaimer")}</Typography.Text>
      {comparison.notes.map((note, index) => (
        <Typography.Text key={`comparison-note-${index}`} type="secondary">
          {note}
        </Typography.Text>
      ))}
    </Space>
  );
}
