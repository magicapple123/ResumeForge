// SPDX-License-Identifier: Apache-2.0
/**
 * 语言版本切换条（W16）：中/英版本切换 + 当前版本自己的排版摘要 + 缺版本时的创建入口。
 *
 * "两份版本各自排版"是 W16 的硬口径，所以这里**同时显示当前版本的模板/页数**——
 * 用户切过去就能确认"切语言没有连带改排版"。切语言本身只调回调，不改任何内容。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Segmented, Space, Typography } from "antd";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { LanguageVariant } from "../../../features/resume-bilingual/types";

interface Props {
  variants: LanguageVariant[];
  /** 当前语言（缺版本时为空串）。 */
  current: string;
  onSwitch: (language: "zh-CN" | "en-US") => void;
  /** 当前语言还没有版本时提供创建入口；不传 = 不渲染。 */
  onCreate?: (language: "zh-CN" | "en-US") => void;
}

export default function VariantBar({ variants, current, onSwitch, onCreate }: Props) {
  useLocale();
  const zh = variants.find((item) => item.language === "zh-CN");
  const en = variants.find((item) => item.language === "en-US");
  const missing = !zh || !en;

  return (
    <Space orientation="vertical" size={4} style={{ width: "100%" }}>
      <Space size={8} wrap align="center">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bt("bilingual.variant.switcher")}
        </Typography.Text>
        <Segmented
          value={current}
          aria-label={bt("bilingual.variant.switcher")}
          onChange={(value) => onSwitch(value === "en-US" ? "en-US" : "zh-CN")}
          options={[
            { value: "zh-CN", label: bt("bilingual.variant.zh") },
            { value: "en-US", label: bt("bilingual.variant.en") },
          ]}
        />
        {missing && onCreate ? (
          <Button
            size="small"
            icon={<PlusOutlined />}
            aria-label={bt("bilingual.variant.create")}
            onClick={() => onCreate(zh ? "en-US" : "zh-CN")}
          >
            {bt("bilingual.variant.create")}
          </Button>
        ) : null}
      </Space>
      {variants.length > 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bt("bilingual.variant.layoutHint")}
        </Typography.Text>
      ) : null}
      {variants.map((variant) => (
        <Typography.Text
          key={variant.id}
          type={variant.language === current ? undefined : "secondary"}
          style={{ fontSize: 12 }}
        >
          {variant.name} ·{" "}
          {bt("bilingual.variant.layout", {
            template: variant.template,
            pages: variant.page_limit,
          })}
        </Typography.Text>
      ))}
    </Space>
  );
}
