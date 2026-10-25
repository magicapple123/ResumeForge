// SPDX-License-Identifier: Apache-2.0
/**
 * 导出弹窗的**变体选项数据源**（W16 → W19/D18）。
 *
 * 只消费 `useVariants().variants`（VariantOut，签名保持不变）并投影成 antd Select 的
 * options：fe-delivery 不需要知道变体字段细节，也不重复调用 listVariants。
 * 选项的 value 是 variant_id；导出请求体由 fe-delivery 按 be-export 契约传。
 *
 * 纯函数：不请求、不读 React，便于单测与导出弹窗复用。
 */
import { t } from "../../i18n";
import type { VariantOut } from "./types";

export interface VariantExportOption {
  value: number;
  label: string;
  /** 这条变体是否有独立排版（导出时按它自己的排版渲染）。 */
  hasLayout: boolean;
  jobTitle: string;
}

/** 变体列表 → 导出选择器选项。数据为空时返回空数组（调用方展示「当前简历」）。 */
export function buildVariantExportOptions(variants: readonly VariantOut[]): VariantExportOption[] {
  return variants.map((variant) => ({
    value: variant.id,
    label: t("versions.variants.exportOption", {
      name: variant.name,
      job: variant.job_title
        ? t("versions.variants.exportOption.job", { job: variant.job_title })
        : "",
      layout: variant.has_layout
        ? t("versions.variants.exportOption.layout")
        : t("versions.variants.exportOption.inherited"),
    }),
    hasLayout: Boolean(variant.has_layout),
    jobTitle: variant.job_title,
  }));
}
