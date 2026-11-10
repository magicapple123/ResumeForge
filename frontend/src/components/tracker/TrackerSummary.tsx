// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度：顶部「指标带 + 阶段构成条」合并卡（12.2 + 13.2-A/B/C）。
 *
 * 2026-11-10（波次 3）：原来是两排各 5 个等宽盒（5 张统计卡 + 5 张漏斗卡），
 * 用户读成"AI 生成的 dashboard"。现在一张 12px 圆角容器里两段：
 *
 * - 指标带：数字与标签同基线（`12 总数`），不再大数字压小标签；
 * - 构成条：一条 100% 堆叠条，五段按「进行中总数」切分，图例给阶段名 + 数量 + 占比。
 *
 * 构成条为什么不是五条独立进度条：五个状态是**互斥快照**（一条记录只属于一级），
 * 不存在"从 01 走到 05"的推进关系；一条构成条才不会把"构成"读成"流程进度"。
 * 段宽用 `flex: {count} 0 0` 分配（不各自算百分比——四舍五入会出现合计 102%），
 * 图例百分比用最大余数法（见 trackComposition.ts），合计恰好 100。
 *
 * 无障碍：堆叠条整体 `aria-hidden`，语义由图例按钮的 aria-label（阶段 + 数量 + 占比）
 * 承担；图例按钮点击即按该阶段筛选，选中态 `aria-pressed`。
 */
import { Skeleton, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import type { TrackStats } from "../../types";
import { FUNNEL_STATUSES } from "../../types";
import { largestRemainderPercents } from "./trackComposition";

interface Props {
  stats: TrackStats | undefined;
  statsLoading: boolean;
  statsError: string;
  totalCount: number;
  /** 当前按哪个阶段筛选（`""` = 不筛选）；构成条图例与筛选下拉共用同一份状态。 */
  status: string;
  onSelectStatus: (next: string) => void;
}

/** 指标带的五项：总数 / 进行中 / 本月投递 / Offer / 已结束。 */
const METRIC_CLASSES = ["total", "active", "month", "offer", "closed"] as const;

export default function TrackerSummary({
  stats,
  statsLoading,
  statsError,
  totalCount,
  status,
  onSelectStatus,
}: Props) {
  useLocale();
  const funnelCounts = FUNNEL_STATUSES.map((key) => stats?.status_counts?.[key] ?? 0);
  const funnelTotal = funnelCounts.reduce((sum, count) => sum + count, 0);
  const percents = largestRemainderPercents(funnelCounts);
  const metricValues = [
    totalCount,
    stats?.active_count ?? 0,
    stats?.month_count ?? 0,
    stats?.offer_count ?? 0,
    stats?.rejected_count ?? 0,
  ];
  const metricLabels = [
    t("trackerPage.stat.total"),
    t("trackerPage.stat.active"),
    t("trackerPage.stat.month"),
    t("trackerForm.status.offer"),
    t("trackerPage.stat.closed"),
  ];

  return (
    <div className="tracker-summary" aria-busy={statsLoading || undefined}>
      <div className="tracker-summary-card">
        {statsLoading ? (
          <>
            <div className="tracker-summary-skeleton-row">
              {METRIC_CLASSES.map((key) => (
                <div key={key} className="tracker-summary-skeleton">
                  <Skeleton active title={false} paragraph={{ rows: 1 }} />
                </div>
              ))}
            </div>
            <Skeleton active title={false} paragraph={{ rows: 2 }} />
          </>
        ) : (
          <>
            {statsError && (
              <Typography.Text type="danger">
                {t("trackerPage.stats.error", { error: statsError })}
              </Typography.Text>
            )}
            {/* 指标带上色只靠**语义类名**（T9），不按位置：错误文案多一个兄弟节点也不会串色。 */}
            <div className="tracker-metric-band">
              {METRIC_CLASSES.map((key, index) => (
                <span key={key} className={`tracker-metric tracker-metric--${key}`}>
                  <span className="tracker-metric-value">{metricValues[index]}</span>
                  <span className="tracker-metric-label">{metricLabels[index]}</span>
                </span>
              ))}
            </div>

            {totalCount > 0 && (
              <>
                <div className="tracker-summary-divider" />
                <div className="tracker-funnel">
                  <Typography.Text type="secondary" className="tracker-funnel-headline">
                    {t("trackerPage.composition.headline", {
                      count: funnelTotal,
                      closed: stats?.rejected_count ?? 0,
                    })}
                  </Typography.Text>
                  {funnelTotal > 0 && (
                    <div className="tracker-funnel-stack" aria-hidden="true">
                      {FUNNEL_STATUSES.map((key, index) =>
                        funnelCounts[index] > 0 ? (
                          <span
                            key={key}
                            className="tracker-composition-seg"
                            data-stage-index={index}
                            // flex 按原始计数分配剩余空间：天然正好铺满，不会四舍五入到 102%。
                            style={{
                              flexGrow: funnelCounts[index],
                              flexShrink: 0,
                              flexBasis: 0,
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  )}
                  <div className="tracker-funnel-legend">
                    {FUNNEL_STATUSES.map((key, index) => {
                      const selected = status === key;
                      const count = funnelCounts[index];
                      const label = t(TRACK_STATUS_LABEL_KEYS[key]);
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`tracker-funnel-step${selected ? " is-selected" : ""}${count === 0 ? " is-empty" : ""}`}
                          data-stage-index={index}
                          aria-pressed={selected}
                          // 不写 aria-label：WCAG 2.5.3（Label in Name）要求可见文本被
                          // accessible name 包含，而「已投递 / 3 / 38%」三段拼起来是
                          // 「已投递338%」，任何带「条，占」的完整句都不含这个连续子串
                          // （axe 报 label-content-name-mismatch）。因此让可见文本自己
                          // 充当名称（「已投递 3 38%」，读得懂），完整口语版放 title 当
                          // 辅助说明——title 只作 description，不参与名称计算。
                          title={t("trackerPage.composition.stepAria", {
                            label,
                            count,
                            percent: percents[index],
                          })}
                          onClick={() => onSelectStatus(selected ? "" : key)}
                        >
                          <span className="tracker-funnel-dot" aria-hidden="true" />
                          <span className="tracker-funnel-label">{label}</span>
                          <span className="tracker-funnel-count">{count}</span>
                          <span className="tracker-funnel-percent">{percents[index]}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
