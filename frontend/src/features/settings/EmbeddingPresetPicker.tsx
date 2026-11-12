// SPDX-License-Identifier: Apache-2.0
/**
 * 厂商预设选择器（6 格：5 个预设 + 自定义）。
 *
 * 第 1 条起它不再是首屏的常驻网格，而是「新建/编辑配置」弹窗内的一排快捷预设：
 * 选中只回填地址与候选模型，**不是免校验**——保存后仍需真实探测才能激活。
 * host 由 baseUrl 计算（见 embeddingRemotePresets），不存第二份真相。
 */
import { Typography, theme } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  CUSTOM_PRESET_ID,
  CUSTOM_PRESET_NOTE_KEY,
  EMBEDDING_REMOTE_PRESETS,
  presetHostOf,
} from "./embeddingRemotePresets";

interface Props {
  value: string;
  onChange: (presetId: string) => void;
}

export default function EmbeddingPresetPicker({ value, onChange }: Props) {
  useLocale();
  const { token } = theme.useToken();

  // Selected state: brand tint background + 1.5px brand border (rationale documented in SearchCard).
  const cardStyle = (selected: boolean) => ({
    textAlign: "left" as const,
    cursor: "pointer",
    backgroundColor: selected ? "var(--rf-brand-tint)" : "transparent",
    borderStyle: "solid",
    borderWidth: selected ? "1.5px" : "1px",
    borderColor: selected ? "var(--rf-brand)" : "var(--rf-border)",
    borderRadius: token.borderRadiusLG,
    padding: "6px 10px",
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 2,
    width: "100%",
  });

  const options = [
    ...EMBEDDING_REMOTE_PRESETS.map((preset) => ({
      id: preset.id,
      label: t(preset.labelKey),
      note: presetHostOf(preset.baseUrl),
    })),
    {
      id: CUSTOM_PRESET_ID,
      label: t("embeddingSearch.remote.preset.custom"),
      note: t(CUSTOM_PRESET_NOTE_KEY),
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("embeddingSearch.remote.preset.aria")}
      style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
    >
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            onClick={() => onChange(option.id)}
            style={cardStyle(selected)}
          >
            <Typography.Text strong>{option.label}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {option.note}
            </Typography.Text>
          </button>
        );
      })}
    </div>
  );
}
