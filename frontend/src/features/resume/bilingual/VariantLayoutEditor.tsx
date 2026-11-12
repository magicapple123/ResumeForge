// SPDX-License-Identifier: Apache-2.0
/**
 * W16 变体独立排版的编辑表单（纯展示 + 受控回调）。
 *
 * 只改三个显式字段（页数上限 / 字号档位 / 模板只读），布局细节继承模板；
 * 真正写库由 VariantLayoutSection 调 PATCH /variants/{id} layout 完成。
 *
 * 标题带**版本名**：面板里同时存在中/英两份版本，只写"这份版本的排版"看不出是哪一份。
 * 模板是只读展示（派生时确定），"独立保存"这类说明一律放卡片底部——顶部只留标题与状态。
 */
import { Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import { bt } from "./i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  VARIANT_FONT_SCALES,
  variantPageLimitOptions,
  type VariantLayoutFields,
} from "./variantLayout";

interface Props {
  /** 版本名（中文版 / 英文版，或用户改过的名字）。 */
  name: string;
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
  name,
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
  // 禁用按钮没有点击事件，antd 的 Tooltip 不会弹：套一层 span 并用原生 title 兜底，
  // 让"为什么点不了"在鼠标悬停时读得到。
  const saveReason = saving
    ? bt("bilingual.layout.saving")
    : !dirty
      ? bt("bilingual.layout.unchanged")
      : null;
  const resetReason = saving
    ? bt("bilingual.layout.saving")
    : inherited
      ? bt("bilingual.layout.resetInherited")
      : null;
  return (
    <section data-variant-layout="1" className="variant-layout">
      <Space size={6} wrap align="center" className="variant-layout__head">
        <Typography.Text strong>
          {bt("bilingual.layout.title", { name: name.trim() || "-" })}
        </Typography.Text>
        <Tag color={inherited ? "default" : "blue"}>
          {inherited ? bt("bilingual.layout.inherited") : bt("bilingual.layout.own")}
        </Tag>
      </Space>
      <Space size={10} wrap align="end" className="variant-layout__controls">
        <label className="variant-layout__field">
          <Typography.Text className="variant-layout__label">
            {bt("bilingual.layout.template")}
          </Typography.Text>
          {/* 模板不可改：派生时确定，这里只显示当前值。用纯文本而不是 code/链接样式，
              避免看起来像可点。 */}
          <span className="variant-layout__readonly" title={bt("bilingual.layout.templateHint")}>
            {fields.template || "-"}
          </span>
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
        <Tooltip title={saveReason}>
          <span title={saveReason ?? undefined}>
            <Button
              size="small"
              type="primary"
              loading={saving || undefined}
              disabled={disabled || !dirty || undefined}
              onClick={onSave}
            >
              {bt("bilingual.layout.save")}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={resetReason}>
          <span title={resetReason ?? undefined}>
            <Button
              size="small"
              disabled={disabled || inherited || saving || undefined}
              onClick={onResetInherit}
            >
              {bt("bilingual.layout.reset")}
            </Button>
          </span>
        </Tooltip>
      </Space>
      <div className="variant-layout__hint variant-layout__hint--foot">
        {bt("bilingual.layout.hint")}
      </div>
      <div className="variant-layout__hint variant-layout__hint--foot">
        {bt("bilingual.layout.templateHint")}
      </div>
    </section>
  );
}
