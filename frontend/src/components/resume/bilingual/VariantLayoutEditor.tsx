// SPDX-License-Identifier: Apache-2.0
/**
 * W16 变体独立排版的编辑表单（纯展示 + 受控回调）。
 *
 * 只改三个显式字段（页数上限 / 字号档位 / 模板只读），布局细节继承模板；
 * 真正写库由 VariantLayoutSection 调 PATCH /variants/{id} layout 完成。
 */
import { Button, Select, Space, Tag, Typography } from "antd";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  VARIANT_FONT_SCALES,
  variantPageLimitOptions,
  type VariantLayoutFields,
} from "../../../features/resume-bilingual/variantLayout";

interface Props {
  fields: VariantLayoutFields;
  /** 当前是否继承简历排版（inherit 时「恢复继承」禁用）。 */
  inherited: boolean;
  dirty?: boolean;
  saving?: boolean;
  disabled?: boolean;
  onChange: (next: VariantLayoutFields) => void;
  onSave: () => void;
  onResetInherit: () => void;
}

function fontLabel(scale: string): string {
  if (scale === "small") return bt("bilingual.layout.font.small");
  if (scale === "large") return bt("bilingual.layout.font.large");
  if (scale === "standard") return bt("bilingual.layout.font.standard");
  return scale;
}

export default function VariantLayoutEditor({
  fields,
  inherited,
  dirty = false,
  saving = false,
  disabled = false,
  onChange,
  onSave,
  onResetInherit,
}: Props) {
  useLocale();
  const fontOptions = VARIANT_FONT_SCALES.map((scale) => ({
    value: scale,
    label: fontLabel(scale),
  }));
  return (
    <section data-variant-layout="1" className="variant-layout">
      <Space size={6} wrap align="center" className="variant-layout__head">
        <Typography.Text strong>{bt("bilingual.layout.title")}</Typography.Text>
        <Tag color={inherited ? "default" : "blue"}>
          {inherited ? bt("bilingual.layout.inherited") : bt("bilingual.layout.own")}
        </Tag>
      </Space>
      <div className="variant-layout__hint">{bt("bilingual.layout.hint")}</div>
      <Space size={10} wrap align="end" className="variant-layout__controls">
        <label className="variant-layout__field">
          <Typography.Text className="variant-layout__label">
            {bt("bilingual.layout.template")}
          </Typography.Text>
          <Typography.Text code>{fields.template || "-"}</Typography.Text>
        </label>
        <label className="variant-layout__field">
          <Typography.Text className="variant-layout__label">
            {bt("bilingual.layout.pages")}
          </Typography.Text>
          <Select
            size="small"
            value={fields.page_limit}
            options={variantPageLimitOptions().map((page) => ({
              value: page,
              label: String(page),
            }))}
            disabled={disabled || saving}
            aria-label={bt("bilingual.layout.pages")}
            className="variant-layout__pages"
            onChange={(value) => onChange({ ...fields, page_limit: value })}
          />
        </label>
        <label className="variant-layout__field">
          <Typography.Text className="variant-layout__label">
            {bt("bilingual.layout.fontScale")}
          </Typography.Text>
          <Select
            size="small"
            value={fields.font_scale}
            options={fontOptions}
            disabled={disabled || saving}
            aria-label={bt("bilingual.layout.fontScale")}
            className="variant-layout__font"
            onChange={(value) => onChange({ ...fields, font_scale: value })}
          />
        </label>
        <Button
          size="small"
          type="primary"
          loading={saving || undefined}
          disabled={disabled || !dirty || undefined}
          onClick={onSave}
        >
          {bt("bilingual.layout.save")}
        </Button>
        <Button
          size="small"
          disabled={disabled || inherited || saving || undefined}
          onClick={onResetInherit}
        >
          {bt("bilingual.layout.reset")}
        </Button>
      </Space>
      <div className="variant-layout__hint variant-layout__hint--foot">
        {bt("bilingual.layout.templateHint")}
      </div>
    </section>
  );
}
