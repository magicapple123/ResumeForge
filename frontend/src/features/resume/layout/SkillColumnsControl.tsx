// SPDX-License-Identifier: Apache-2.0
/**
 * 技能每行个数（R-08）：`format_config.skill_columns` 的控件。
 *
 * 为什么是一个独立小文件而不是塞进 `ResumeSpacingControls`（已 369 行）：那个组件是
 * "标签 + ± + 滑杆 + 读数"的连续量控件，这里是**离散四档**，混进去会让它的
 * `withScale` / 探针注入逻辑多出一个特例。四种取值与后端 `FORMAT_FIELDS.skill_columns`
 * 的 min/max/step 逐项一致（1–4）。
 *
 * 「跟随默认」= 删键：没设过时一行排几个由模板 CSS 决定，写死一个 3 会让存量简历
 * 的标签突然重排。
 */
import { Segmented, Tooltip } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";

export const SKILL_COLUMNS_KEY = "skill_columns";

/** 四档（1–4）。顺序即分段控件的顺序。 */
export const SKILL_COLUMN_VALUES = [1, 2, 3, 4] as const;

/** 读当前档位；未设置/脏数据返回 0（= 跟随模板默认）。 */
export function readSkillColumns(
  config: ResumeFormatConfig | null | undefined,
): number {
  const raw = config?.[SKILL_COLUMNS_KEY];
  return typeof raw === "number" && SKILL_COLUMN_VALUES.includes(raw as 1 | 2 | 3 | 4) ? raw : 0;
}

/** 写回档位；0/非法值删键。 */
export function withSkillColumns(
  config: ResumeFormatConfig | null | undefined,
  value: number,
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(config ?? {}) };
  if (!SKILL_COLUMN_VALUES.includes(value as 1 | 2 | 3 | 4)) delete next[SKILL_COLUMNS_KEY];
  else next[SKILL_COLUMNS_KEY] = value;
  return next;
}

interface Props {
  formatConfig?: ResumeFormatConfig | null;
  disabled?: boolean;
  onChange: (next: ResumeFormatConfig) => void;
}

export default function SkillColumnsControl({
  formatConfig,
  disabled = false,
  onChange,
}: Props) {
  useLocale();
  const value = readSkillColumns(formatConfig);
  return (
    <div className="resume-wb-field-row">
      <span className="resume-wb-field-label">{t("skillColumns.label")}</span>
      <Tooltip title={t("skillColumns.hint")}>
        <span style={{ justifySelf: "start" }}>
          <Segmented
            size="small"
            aria-label={t("skillColumns.label")}
            value={value === 0 ? "auto" : String(value)}
            disabled={disabled || undefined}
            options={[
              { value: "auto", label: t("skillColumns.auto") },
              ...SKILL_COLUMN_VALUES.map((count) => ({
                value: String(count),
                label: String(count),
              })),
            ]}
            onChange={(next) =>
              onChange(withSkillColumns(formatConfig, next === "auto" ? 0 : Number(next)))
            }
          />
        </span>
      </Tooltip>
    </div>
  );
}
