// SPDX-License-Identifier: Apache-2.0
/** 求职漏斗：自绘 SVG，不引 echarts/antv/plots。
 *
 * 每个阶段一条**居中**的横条，宽度与计数成正比（相对最大值）——"漏斗形状"本身就是信息，
 * 所以走居中对齐而不是共享左基线。几何与封顶都在 :mod:`HorizontalBarChart` 里（公司排行
 * 用的是同一份），这里只负责"给每一阶段配一个颜色"和开启"相对第一阶段的百分比"。
 *
 * 每个阶段使用独立的语义色：漏斗的形状表达数量递减，颜色帮助用户快速定位阶段。
 *
 * 只负责画，漏斗的阶段顺序与口径由后端 ``/api/analytics/dashboard`` 下发（见
 * services/analytics.py）。
 */
import type { FunnelStage } from "../../types";
import { useChartPalette } from "../../theme/chartPalette";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import HorizontalBarChart from "./HorizontalBarChart";

interface Props {
  stages: FunnelStage[];
}

export default function FunnelChart({ stages }: Props) {
  useLocale();
  const palette = useChartPalette();
  return (
    <HorizontalBarChart
      items={stages.map((stage) => ({
        key: stage.status,
        label: stage.label,
        count: stage.count,
      }))}
      ariaLabel={t("analyticsUi.funnel.aria")}
      align="center"
      showPercent
      colorFor={(key) => {
        // 按**阶段 key** 取色，与「求职进度」页用的是同一套 token：
        // 已投递=灰、筛选中=蓝、测评=青、面试=紫、Offer=绿、已结束=红。
        const stageColor = palette.stage[key];
        if (stageColor) return stageColor;
        // 后端将来加了新阶段也不至于没颜色：退回系列色（极少数情况）。
        const index = stages.findIndex((stage) => stage.status === key);
        return palette.series[Math.max(0, index) % palette.series.length];
      }}
    />
  );
}
