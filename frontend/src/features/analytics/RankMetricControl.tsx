// SPDX-License-Identifier: Apache-2.0
/**
 * 榜单排序控件（R13）：「投递数 / 面试率 / 名称」三段单选。
 *
 * 与进度页的排序下拉**刻意不共用组件**：那边的语义是"字段 + 可翻转的方向"（五个键、
 * 方向写进 URL、下推服务端分页），这边是"字段 + 固定方向"（三个键、纯本地排序）。
 * 硬凑成一个组件，就得塞进两套互斥的 props 和两条渲染分支——共用的是外观，分裂的是语义。
 *
 * 用 antd `Segmented` 而不是自定义按钮组：它自带 radio 语义（读屏会报"三选一"）、
 * 键盘方向键切换与焦点环，这三样手写一遍只会更容易漏。
 */
import { Segmented } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { RANK_METRICS, RANK_METRIC_LABEL_KEYS, type RankMetric } from "./rankOrder";

interface Props {
  value: RankMetric;
  onChange: (next: RankMetric) => void;
  /** 榜单为空时置灰：控件还在（结构一眼可读），但点了不会有任何变化。 */
  disabled?: boolean;
}

export default function RankMetricControl({ value, onChange, disabled = false }: Props) {
  // 模块级 t()：不订阅语言变化的话，切语言后控件文案会停在旧语言。
  useLocale();
  return (
    <Segmented
      size="small"
      disabled={disabled}
      value={value}
      onChange={(next) => onChange(next as RankMetric)}
      options={RANK_METRICS.map((metric) => ({
        value: metric,
        label: t(RANK_METRIC_LABEL_KEYS[metric]),
      }))}
    />
  );
}
