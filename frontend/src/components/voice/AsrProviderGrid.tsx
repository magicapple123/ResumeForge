// SPDX-License-Identifier: Apache-2.0
/**
 * 语音转写的服务商卡片网格（2 列）：厂商名 + 一句说明，选中态 1.5px 主色边框 + 浅底。
 *
 * 单独成文件有两个原因：
 *
 * 1. `AsrSettingsCard.tsx` 已经顶到 500 行预算（卡头主操作、预设、协议、模型拉取、Key、
 *    测试结果都在那一张卡上），网格是一块可以整体搬走的纯展示；
 * 2. 网格的选中态与语义检索的厂商网格必须**看起来一样**（条目 02 的统一口径），把它孤立
 *    出来才好对照：两者都是 `role="radiogroup"` + `role="radio"` + `aria-checked`，
 *    键盘 Tab 可达、Enter 可选。
 *
 * 它不做任何请求：选中只是回调 `onSelect`，由卡片决定填哪些字段。
 */
import { Typography, theme } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { CUSTOM_ASR_PRESET_ID, type AsrPreset } from "./asrPresets";

interface Props {
  presets: readonly AsrPreset[];
  /** 当前选中项（含 `custom`）。 */
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function AsrProviderGrid({ presets, selectedId, onSelect }: Props) {
  useLocale();
  const { token } = theme.useToken();

  // Selected state: brand tint background + 1.5px brand border (rationale documented in SearchCard).
  //
  // Colours come from the `--rf-*` CSS variables so dark mode stays readable: the light-theme
  // `palette.brandTint` literal kept the tile white while the label turned light in dark mode.
  // `borderWidth` is set on its own because a `${1.5}px` value inside the `border` shorthand
  // is normalised.
  const cardStyle = (selected: boolean) => ({
    textAlign: "left" as const,
    cursor: "pointer",
    padding: "8px 10px",
    borderRadius: token.borderRadiusLG,
    backgroundColor: selected ? "var(--rf-brand-tint)" : "transparent",
    borderStyle: "solid",
    borderWidth: selected ? "1.5px" : "1px",
    borderColor: selected ? "var(--rf-brand)" : "var(--rf-border)",
  });

  const option = (id: string, label: string, note: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={selectedId === id}
      aria-label={label}
      onClick={() => onSelect(id)}
      style={cardStyle(selectedId === id)}
    >
      <Typography.Text strong>{label}</Typography.Text>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {note}
        </Typography.Text>
      </div>
    </button>
  );

  return (
    <div
      role="radiogroup"
      aria-label={t("voiceInput.settings.provider.aria")}
      style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
    >
      {[
        ...presets.map((preset) => option(preset.id, t(preset.labelKey), t(preset.noteKey))),
        option(
          CUSTOM_ASR_PRESET_ID,
          t("voiceInput.settings.provider.custom"),
          t("voiceInput.settings.provider.note.custom"),
        ),
      ]}
    </div>
  );
}
