// SPDX-License-Identifier: Apache-2.0
/**
 * W16 岗位变体选择器（导出弹层内）：选择后导出/核对请求带 `variant_id`。
 *
 * 数据由宿主注入（ResumeDetailPreview 用现有 `useVariants` 取列表），本组件只做展示与
 * 可访问性；不自己发明"变体内容快照"——变体的 content/layout 由后端
 * `GET /resumes/{id}/variants/{variant_id}/export-input` 唯一解析。
 */
import { Select } from "antd";
import { t } from "../../../i18n";

export interface VariantOption {
  id: number;
  name: string;
  job_title?: string | null;
  company?: string | null;
}

export interface VariantPickerProps {
  variants: VariantOption[];
  loading?: boolean;
  value: number | null;
  onChange: (variantId: number | null) => void;
  disabled?: boolean;
}

export default function VariantPicker({
  variants,
  loading = false,
  value,
  onChange,
  disabled = false,
}: VariantPickerProps) {
  return (
    <div className="resume-delivery-preset-bar">
      <span className="resume-delivery-label">{t("delivery.variant.label")}</span>
      <Select
        style={{ minWidth: 220 }}
        aria-label={t("delivery.variant.label")}
        loading={loading}
        allowClear
        disabled={disabled}
        placeholder={t("delivery.variant.none")}
        value={value ?? undefined}
        options={variants.map((variant) => ({
          value: variant.id,
          label: variant.job_title ? `${variant.name} · ${variant.job_title}` : variant.name,
        }))}
        onChange={(next?: number) => onChange(next ?? null)}
      />
      <span className="resume-delivery-hint">{t("delivery.variant.hint")}</span>
    </div>
  );
}
