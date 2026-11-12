// SPDX-License-Identifier: Apache-2.0
/**
 * 板块层「参与当前方案」的行首勾选框（问题 18 的 ①）。
 *
 * 与方案层的行首 Radio 同一位置、同一形态：三层都用「左侧选择 + 右侧动作」的节奏。
 * 语义与 SectionVisibilitySwitch 完全一致（勾选 = 该板块 key 在当前方案参与清单里），
 * 只是控件形态从行尾 Switch 换成行首 Checkbox——两者不要混用，否则又回到三种表达。
 */
import { Checkbox, Tooltip } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  /** 板块名：给无障碍名做区分（一屏里会有多个勾选框）。 */
  sectionName: string;
  checked: boolean;
  /** 基本信息恒参与（R-21），不能取消。 */
  locked?: boolean;
  busy?: boolean;
  onChange: (checked: boolean) => void;
}

export default function ParticipationCheckbox({
  sectionName,
  checked,
  locked = false,
  busy = false,
  onChange,
}: Props) {
  useLocale();
  const box = (
    <Checkbox
      checked={locked ? true : checked}
      aria-label={t("profileLibrary.section.visibleAria", { name: sectionName })}
      disabled={locked || busy || undefined}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
  // 禁用的勾选框不接收鼠标事件，Tooltip 必须包一层真实元素才能触发。
  return (
    <Tooltip
      title={locked ? t("profileLibrary.section.basicLocked") : t("profileLibrary.section.visible")}
    >
      <span className="profile-participation">{box}</span>
    </Tooltip>
  );
}
