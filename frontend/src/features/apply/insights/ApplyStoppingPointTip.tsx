// SPDX-License-Identifier: Apache-2.0
/**
 * #15E 边际收益停止线：投到"再多投也没用"时给一句提醒，并给**两个具体动作**。
 *
 * 三态（判据全在后端，前端只展示）：
 * - `ok`：还没到拐点 → **整条不渲染**。常驻的"继续加油"是噪声，提醒的价值在于"值得看一眼"；
 * - `insufficient`：样本 < 10 条投递 → 只显示一行灰字「样本不足（N 条投递）」，
 *   **不显示任何比率**（3 条投递算出来的 33% 会被当成结论）；
 * - `past`：过了拐点 → 黄条 + 「跟进待回音」/「改简历」两个按钮。
 *   这两个按钮是这条提醒存在的意义：只说"收益在下降"而不给下一步，等于什么都没说。
 *
 * 失败/加载中一律不渲染，也不报错：这条提示是附加信息，不该在记录页顶部留一块红。
 */
import { Alert, Button, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import { getStoppingPoint } from "../../../api/applyInsights";
import { useApi } from "../../../hooks/useApi";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyStoppingPoint } from "../../../types";

/** 回看窗口（天）：4 周足够看出"回音率是否掉下来了"，又不至于把早期数据混进来。 */
export const STOPPING_POINT_DAYS = 28;

/**
 * 比率 → 百分数文本。
 *
 * 后端可能给 0–1 的比率（0.05）也可能给百分数（5）：`<= 1` 一律按比率放大 100，
 * 保留一位小数并去掉多余的 `.0`（「5%」比「5.0%」好读）。`null` 给破折号——
 * 缺数据时显示 0% 是最坏的误导。
 */
function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  const percent = rate <= 1 ? rate * 100 : rate;
  return String(Number(percent.toFixed(1)));
}

/** 周数：后端给了逐周明细就按条数算，否则按窗口天数折算（28 天 = 4 周）。 */
function weeksOf(point: ApplyStoppingPoint, days: number): number {
  if (point.weeks.length > 0) return point.weeks.length;
  return Math.max(1, Math.round(days / 7));
}

export default function ApplyStoppingPointTip({ days = STOPPING_POINT_DAYS }: { days?: number }) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { data, error } = useApi<ApplyStoppingPoint>(() => getStoppingPoint(days), [days]);

  if (error || !data) return null;
  // 还没到拐点：不打扰。
  if (data.status === "ok") return null;

  if (data.status === "insufficient") {
    return (
      <Typography.Text
        type="secondary"
        className="apply-stopping-point-tip"
        style={{ display: "block" }}
      >
        {t("applyQueue.insights.stopping.insufficient", { applied: data.applied })}
      </Typography.Text>
    );
  }

  return (
    <Alert
      type="warning"
      showIcon
      className="apply-stopping-point-tip"
      title={t("applyQueue.insights.stopping.past", {
        weeks: weeksOf(data, days),
        recent: formatRate(data.recent_rate),
        baseline: formatRate(data.baseline_rate),
        applied: data.applied,
      })}
      description={
        <Space wrap>
          {/* 动作一：待回音的记录在求职进度里（`/tracker`）——去那里逐条跟进，而不是再投新的。 */}
          <Link to="/tracker">
            <Button size="small">{t("applyQueue.insights.stopping.followup")}</Button>
          </Link>
          {/* 动作二：回音率掉下来多半是简历不对口——去简历中心改，而不是继续加投递量。 */}
          <Link to="/resumes">
            <Button size="small" type="primary">
              {t("applyQueue.insights.stopping.improve")}
            </Button>
          </Link>
        </Space>
      }
    />
  );
}
