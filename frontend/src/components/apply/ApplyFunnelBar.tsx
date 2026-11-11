// SPDX-License-Identifier: Apache-2.0
/**
 * 页头漏斗条（#14F）：最近 7 天的执行量（已投 / 成功 / 失败 / 面试中），点击下钻。
 *
 * 与 analytics 的分工：analytics 算的是**长期转化率**（面试率 / Offer 率 / 渠道），
 * 这里只做**最近 7 天的执行量**——两个口径不互相覆盖，也不在这里再算一遍百分比。
 *
 * 「面试中」来自求职进度（track），没有对应的投递记录筛选，所以它下钻到 `/tracker`；
 * 其余三个切到「投递记录」并带上结果筛选。接口读不到时**整条不渲染**（不占位、不报错弹窗）：
 * 它是增强信息，不该让页面顶部凭空多一行错误。
 */
import { Button, Space, Statistic, Typography } from "antd";
import { useApi } from "../../hooks/useApi";
import { getApplySummary } from "../../api/applyExtras";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyFunnelSummary } from "../../types";

/** 漏斗的四个维度（协议值 → 展示名 key）。 */
const FUNNEL_ITEMS: {
  key: keyof ApplyFunnelSummary;
  drill: FunnelDrill;
  labelKey: MessageKey;
  color: string;
}[] = [
  {
    key: "applied",
    drill: "applied",
    labelKey: "applyUi.funnel.applied",
    color: "var(--rf-info-strong)",
  },
  {
    key: "succeeded",
    drill: "succeeded",
    labelKey: "applyUi.funnel.succeeded",
    color: "var(--rf-success-text)",
  },
  {
    key: "failed",
    drill: "failed",
    labelKey: "applyUi.funnel.failed",
    color: "var(--rf-error-text)",
  },
  {
    key: "interviewing",
    drill: "interviewing",
    labelKey: "applyUi.funnel.interviewing",
    color: "var(--rf-warning-text)",
  },
];

export type FunnelDrill = "applied" | "succeeded" | "failed" | "interviewing";

/** 窗口天数：与后端 `/apply/summary?days=7` 的默认值一致，写成常量便于以后按需放开。 */
export const FUNNEL_DAYS = 7;

export default function ApplyFunnelBar({ onDrill }: { onDrill: (drill: FunnelDrill) => void }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后指标名停在旧文案。
  useLocale();
  const { data, error } = useApi<ApplyFunnelSummary>(
    () => getApplySummary(FUNNEL_DAYS),
    [FUNNEL_DAYS],
  );
  if (error || !data) return null;

  return (
    <Space size={4} wrap className="apply-funnel-bar">
      {FUNNEL_ITEMS.map((item) => (
        <Button
          key={item.key}
          type="text"
          className="apply-funnel-item"
          // 卡片数字本身不念得清"点了会发生什么"，aria-label 把维度 + 数值 + 动作都说出来。
          aria-label={t("applyUi.funnel.drillAria", {
            days: FUNNEL_DAYS,
            dimension: t(item.labelKey),
            value: data[item.key],
          })}
          onClick={() => onDrill(item.drill)}
        >
          <Statistic
            title={t(item.labelKey)}
            value={data[item.key]}
            /* 16（而不是 18）：四枚指标要与页头标题同高，18 会把页头顶到 61px，
               首屏表格因此少一行（#14G 第二版实测）。 */
            styles={{ content: { color: item.color, fontSize: 16 } }}
          />
        </Button>
      ))}
      <Typography.Text type="secondary">
        {t("applyUi.funnel.hint", { days: FUNNEL_DAYS })}
      </Typography.Text>
    </Space>
  );
}
