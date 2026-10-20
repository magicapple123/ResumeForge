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
import HorizontalBarChart from "./HorizontalBarChart";

interface Props {
  stages: FunnelStage[];
}

export default function FunnelChart({ stages }: Props) {
  const palette = useChartPalette();
  const firstKey = stages[0]?.status;
  return (
    <HorizontalBarChart
      items={stages.map((stage) => ({
        key: stage.status,
        label: stage.label,
        count: stage.count,
      }))}
      ariaLabel="求职漏斗"
      align="center"
      showPercent
      colorFor={(key) => {
        const index = stages.findIndex((stage) => stage.status === key);
        // 第一阶段是"全部岗位"，用中性灰而不是彩色：它不是一个需要被辨认的阶段。
        return key === firstKey
          ? palette.neutral
          : palette.series[Math.max(1, index) % palette.series.length];
      }}
    />
  );
}
