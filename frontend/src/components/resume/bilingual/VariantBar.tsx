// SPDX-License-Identifier: Apache-2.0
/**
 * 语言版本切换条（W16 / v2）：中/英版本切换 + 缺版本时的创建入口。
 *
 * v2 口径：版本"自己的排版"仍独立保存（`resume_variant.layout`），但列表接口只回
 * 摘要（`VariantOut` 不含排版字段）；排版详情由 `VariantLayoutSection` 在选中版本后
 * 用 `export-input` 读取，这里的 Segmented 只负责**选哪个语言版本**。
 *
 * 缺版本时不再另起一个按钮：直接把它作为 Segmented 的第三项「+ 未创建」——一眼看出
 * "这个语言还没做"，点它就开始创建。只读模式下这一项禁用（版本仍可查看，不能再创建）。
 *
 * 创建入口在"创建后自动翻译"那条流程里要跑几十秒：`busy` 期间该项禁用、文案换成
 * `busyLabel`（进度提示由宿主通过 i18n 传入，本组件不写死文案）。
 */
import { Segmented, Space, Typography } from "antd";
import { bt } from "../../../features/resume-bilingual/i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { LanguageVariant } from "../../../features/resume-bilingual/types";

interface Props {
  variants: LanguageVariant[];
  /** 当前语言（缺版本时为空串）。 */
  current: string;
  onSwitch: (language: "zh-CN" | "en-US") => void;
  /** 当前语言还没有版本时提供创建入口；不传 = 不渲染「+ 未创建」这一项。 */
  onCreate?: (language: "zh-CN" | "en-US") => void;
  /** 正在创建/翻译：创建项禁用，文案换成 busyLabel。 */
  busy?: boolean;
  /** busy 期间的文案（宿主按阶段给"正在创建"/"正在翻译…"）。 */
  busyLabel?: string;
  /** 只读模式（无 revision）：版本仍可查看，但不能再创建。 */
  disabled?: boolean;
}

/** Segmented 里"创建"那一项的取值：不与真实语言码混在一起。 */
const CREATE_VALUE = "create";

export default function VariantBar({
  variants,
  current,
  onSwitch,
  onCreate,
  busy = false,
  busyLabel,
  disabled = false,
}: Props) {
  useLocale();
  const zh = variants.find((item) => item.language === "zh-CN");
  const en = variants.find((item) => item.language === "en-US");
  const missing: "zh-CN" | "en-US" | null = !zh ? "zh-CN" : !en ? "en-US" : null;
  const currentVariant = variants.find((item) => item.language === current) ?? null;

  const options: { value: string; label: string; disabled?: boolean }[] = [
    { value: "zh-CN", label: bt("bilingual.variant.zh") },
    { value: "en-US", label: bt("bilingual.variant.en") },
  ];
  if (missing && onCreate) {
    options.push({
      value: CREATE_VALUE,
      label: busy
        ? (busyLabel ?? bt("bilingual.variant.creating"))
        : bt("bilingual.variant.createOption"),
      disabled: busy || disabled,
    });
  }

  return (
    <div className="variant-bar" data-variant-bar="1">
      <Space size={8} wrap align="center" className="variant-bar__switcher">
        <Typography.Text type="secondary" className="variant-bar__hint">
          {bt("bilingual.variant.switcher")}
        </Typography.Text>
        <Segmented
          value={current}
          aria-label={bt("bilingual.variant.switcher")}
          options={options}
          onChange={(value) => {
            if (value === CREATE_VALUE) {
              if (!busy && !disabled && missing) onCreate?.(missing);
              return;
            }
            onSwitch(value === "en-US" ? "en-US" : "zh-CN");
          }}
        />
        {/* 纯文本版本名已删：它和 Segmented 的选项同名，读起来像两套控件。
            改成一句"正在看哪一份"，版本名来自服务端（可能是用户改过的名字）。 */}
        {currentVariant ? (
          <Typography.Text type="secondary" className="variant-bar__version">
            {bt("bilingual.variant.viewing", { name: currentVariant.name })}
          </Typography.Text>
        ) : null}
      </Space>
    </div>
  );
}
