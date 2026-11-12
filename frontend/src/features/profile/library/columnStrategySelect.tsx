// SPDX-License-Identifier: Apache-2.0
/**
 * 字段的「纸面位置 + 仅素材」控件组（问题 18 的 A 段）。
 *
 * 语义是两层，不是三个平级元素：
 * 1) 位置策略（用户主动选，Select）；
 * 2) 仅素材覆盖开关（打开即强制 hidden 并禁用 Select）。
 * 所以开关必须带可见文字「仅素材」，结果文案用 `margin-left: auto` 靠右——否则
 * 「纸面位置：正文」正好占着开关标签的位置，读起来像"纸面位置的开关"。
 *
 * 窄档适配靠 `flex-wrap`（抽屉宽度 380–640 由用户拖动，禁止视口断点）。
 */
import { Select, Switch } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  PLACEMENT_LABEL_KEYS,
  profilePlacementLabel,
  PROFILE_PLACEMENT_OPTIONS,
} from "./fieldPlacement";
import type { Placement } from "../../../types/resumeDocument";

/** 「仅素材」开关 + 可见文字（行内编辑与「添加字段」行共用同一形态）。 */
export function MaterialOnlyToggle({
  checked,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  useLocale();
  return (
    <span className="profile-field-material">
      <Switch
        size="small"
        checked={checked}
        aria-label={t("structure.profile.materialOnlyToggle")}
        disabled={disabled || undefined}
        onChange={onChange}
      />
      <span className="profile-field-material-label">
        {t("structure.profile.materialOnlyShort")}
      </span>
    </span>
  );
}

interface Props {
  /** Select 的当前值："" = 按类型自动。仅素材时恒为 hidden。 */
  value: string;
  /** 结果文案用的生效位置（effective/默认值），与 value 是同一份数据的不同读法。 */
  effectivePlacement: Placement | "";
  materialOnly: boolean;
  busy?: boolean;
  onChangePlacement: (value: string) => void;
  onChangeMaterialOnly: (checked: boolean) => void;
}

export default function ColumnStrategySelect({
  value,
  effectivePlacement,
  materialOnly,
  busy = false,
  onChangePlacement,
  onChangeMaterialOnly,
}: Props) {
  useLocale();
  return (
    <div className="profile-field-placement">
      <Select
        className="profile-field-placement-select"
        size="small"
        value={materialOnly ? "hidden" : value}
        aria-label={t("structure.profile.editPlacement")}
        disabled={busy || materialOnly || undefined}
        onChange={onChangePlacement}
        options={[
          { value: "", label: t("structure.profile.placementAuto") },
          ...PROFILE_PLACEMENT_OPTIONS.map((option) => ({
            value: option,
            label: t(PLACEMENT_LABEL_KEYS[option]),
          })),
        ]}
      />
      <MaterialOnlyToggle checked={materialOnly} disabled={busy} onChange={onChangeMaterialOnly} />
      <span
        className={materialOnly ? "profile-field-material-hint" : "profile-field-placement-hint"}
      >
        {materialOnly
          ? t("structure.profile.materialOnlyHint")
          : t("structure.profile.placementBadge", {
              placement: profilePlacementLabel(effectivePlacement),
            })}
      </span>
    </div>
  );
}
