// SPDX-License-Identifier: Apache-2.0
/** 周投递目标 + 生成成本（清单 §17.3-C6 / C7，P3）。
 *
 * 目标值存本数据集设置（0 = 没设目标，不是"目标为零次"）：输入 0 保存即取消目标。
 * 生成成本只报 token 与耗时，**不报金额**——本地账本没有价格表，凭记忆写单价就是编的。
 */
import { App, Button, Col, InputNumber, Progress, Row, Space, Typography } from "antd";
import { useState } from "react";
import { putAnalyticsWeeklyGoal } from "../../api/analytics";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard } from "../../types";
import SectionCard from "./SectionCard";
import StatCard from "./StatCard";

const MAX_WEEKLY_GOAL = 100;

/** 毫秒 → 秒（保留一位小数）。账本里存的是 duration_ms。 */
function secondsOf(durationMs: number): string {
  return (durationMs / 1000).toFixed(1);
}

export default function GoalCostBlock({
  data,
  onSaved,
}: {
  data: AnalyticsDashboard;
  onSaved: () => void;
}) {
  useLocale();
  const { message } = App.useApp();
  // 输入框只在"用户改过"时用本地草稿（draft），否则一直以服务端值为准——
  // 这样看板刷新/保存成功后不需要 effect 回写 state（React 也不建议 effect 里 setState）。
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const target = draft ?? data.weekly_goal.target;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await putAnalyticsWeeklyGoal(Number(target) || 0);
      setDraft(null); // 保存成功后回到服务端值（刷新后由新数据渲染）
      message.success(t("analyticsPage.goal.saved"));
      onSaved();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("analyticsPage.goal.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const cost = data.generation_cost;
  const avgTokens =
    cost.generate_calls > 0 ? Math.round(cost.generate_completion_tokens / cost.generate_calls) : 0;
  const hasGoal = data.weekly_goal.target > 0;
  const percent = hasGoal
    ? Math.min(100, Math.round((data.weekly_goal.this_week_count / data.weekly_goal.target) * 100))
    : 0;

  return (
    <SectionCard
      title={t("analyticsPage.goal.title")}
      description={t("analyticsPage.goal.description")}
    >
      <Row gutter={[16, 16]} align="middle">
        <Col xs={24} xl={12}>
          <Space wrap align="center">
            <Typography.Text>{t("analyticsPage.goal.weeklyLabel")}</Typography.Text>
            <InputNumber
              min={0}
              max={MAX_WEEKLY_GOAL}
              value={target}
              onChange={(value) => setDraft(Number(value) || 0)}
              aria-label={t("analyticsPage.goal.weeklyLabel")}
            />
            <Button type="primary" loading={saving} onClick={() => void save()}>
              {t("analyticsPage.goal.save")}
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {t("analyticsPage.goal.zeroHint")}
          </Typography.Paragraph>
          {hasGoal ? (
            <Progress
              style={{ marginTop: 12 }}
              percent={percent}
              format={() =>
                t("analyticsPage.goal.progress", {
                  done: data.weekly_goal.this_week_count,
                  target: data.weekly_goal.target,
                })
              }
            />
          ) : (
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              {t("analyticsPage.goal.thisWeek", { count: data.weekly_goal.this_week_count })}
            </Typography.Paragraph>
          )}
        </Col>
        <Col xs={24} xl={12}>
          <Row gutter={[16, 16]}>
            <Col xs={12}>
              <StatCard
                title={t("analyticsPage.cost.generateCalls")}
                value={cost.generate_calls}
                hint={t("analyticsPage.cost.generateCallsHint")}
              />
            </Col>
            <Col xs={12}>
              <StatCard
                title={t("analyticsPage.cost.avgDuration")}
                value={secondsOf(cost.generate_avg_duration_ms)}
                suffix={t("analyticsPage.cost.seconds")}
                hint={t("analyticsPage.cost.avgDurationHint")}
              />
            </Col>
            <Col xs={12}>
              <StatCard
                title={t("analyticsPage.cost.avgCompletion")}
                value={avgTokens}
                hint={t("analyticsPage.cost.avgCompletionHint")}
              />
            </Col>
            <Col xs={12}>
              <StatCard
                title={t("analyticsPage.cost.totalCalls")}
                value={cost.total_calls}
                hint={t("analyticsPage.cost.totalCallsHint", { tokens: cost.total_tokens })}
              />
            </Col>
          </Row>
        </Col>
      </Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t("analyticsPage.cost.caliber")}
      </Typography.Paragraph>
    </SectionCard>
  );
}
