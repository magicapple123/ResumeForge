// SPDX-License-Identifier: Apache-2.0
/**
 * 语言版本切换条（W16 / v2）：中/英版本切换 + 缺版本时的创建入口。
 *
 * v2 口径：版本"自己的排版"仍独立保存（`resume_variant.layout`），但列表接口只回
 * 摘要（`VariantOut` 不含排版字段）；排版详情由 `VariantLayoutSection` 在选中版本后
 * 用 `export-input` 读取，这里的 Segmented 只负责**选哪个语言版本**。
 *
 * 2026-11（T19）：切换项**只列已有版本**。曾经把一个「+ 未创建」塞成 Segmented 的第三项，
 * 于是"还没做的语言"和"已有的版本"长得一样，选项数也不等于版本数。现在缺版时在切换器
 * 旁边给一颗**虚线按钮**（`+ 英文版` / `+ 中文版`），它是动作、不是选择。
 *
 * 创建入口在"创建后自动翻译"那条流程里要跑几十秒：`busy` 期间按钮禁用、文案换成
 * `busyLabel`（进度提示由宿主通过 i18n 传入，本组件不写死文案）。
 */
import { Button, Segmented, Space, Typography } from "antd";
import { bt } from "./i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { LanguageVariant } from "./types";

interface Props {
  variants: LanguageVariant[];
  /** 当前语言（缺版本时为空串）。 */
  current: string;
  onSwitch: (language: "zh-CN" | "en-US") => void;
  /** 当前语言还没有版本时提供创建入口；不传 = 不渲染虚线按钮。 */
  onCreate?: (language: "zh-CN" | "en-US") => void;
  /** 正在创建/翻译：创建按钮禁用，文案换成 busyLabel。 */
  busy?: boolean;
  /** busy 期间的文案（宿主按阶段给"正在创建"/"正在翻译…"）。 */
  busyLabel?: string;
  /** 只读模式（无 revision）：版本仍可查看，但不能再创建。 */
  disabled?: boolean;
}

/** 语言码 → 界面名。表在渲染处按需查（`t()` 不能在模块作用域求值）。 */
function languageLabel(language: "zh-CN" | "en-US"): string {
  return language === "en-US" ? bt("bilingual.variant.en") : bt("bilingual.variant.zh");
}

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

  // 只列**真实存在**的版本：选项数 = 版本数，不再有"第三项占位"。
  const options = (["zh-CN", "en-US"] as const)
    .filter((language) => (language === "zh-CN" ? Boolean(zh) : Boolean(en)))
    .map((language) => ({ value: language, label: languageLabel(language) }));

  return (
    <div className="variant-bar" data-variant-bar="1">
      <Space size={8} wrap align="center" className="variant-bar__switcher">
        <Typography.Text type="secondary" className="variant-bar__hint">
          {bt("bilingual.variant.switcher")}
        </Typography.Text>
        {/* 一个版本都没有时不出切换器：空的 Segmented 是个点不动的空盒子。 */}
        {options.length > 0 ? (
          <Segmented
            value={current}
            aria-label={bt("bilingual.variant.switcher")}
            options={options}
            onChange={(value) => onSwitch(value === "en-US" ? "en-US" : "zh-CN")}
          />
        ) : null}
        {missing && onCreate ? (
          <Button
            size="small"
            type="dashed"
            disabled={busy || disabled || undefined}
            onClick={() => {
              if (!busy && !disabled && missing) onCreate(missing);
            }}
          >
            {busy
              ? (busyLabel ?? bt("bilingual.variant.creating"))
              : bt("bilingual.variant.createOption", { language: languageLabel(missing) })}
          </Button>
        ) : null}
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
