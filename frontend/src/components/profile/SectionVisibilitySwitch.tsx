// SPDX-License-Identifier: Apache-2.0
/**
 * 「在资料页显示」开关（F9）：大字段的显示/隐藏 = 当前组参与清单的增删。
 *
 * 语义（Lead D1 裁决）：隐藏 = 从当前组参与清单移除，因此也不参与生成/导出/网申；
 * 显示 = 加回当前组。不新开第二套存储。基本信息参与网申（R-21），恒在清单首位：
 * 这里渲染成禁用开关并给 Tooltip 说明原因，不提供任何绕过路径。
 *
 * 三处入口（组管理大字段行、字段设置顶部、资料页已隐藏列表）共用本组件，
 * 写请求由宿主（useCurrentProfileGroup.setSectionVisible）统一发出。
 */
import { Switch, Tooltip, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 大字段名：给无障碍名做区分（一屏里会有多个同名开关）。 */
  sectionName: string;
  /** 该大字段是否在当前组参与清单里。 */
  visible: boolean;
  /** 基本信息：恒参与、不可隐藏。 */
  locked?: boolean;
  busy?: boolean;
  /**
   * 隐藏开关左侧的「在资料页显示」文字。列表行里同一列全是这个开关时，
   * 每行重复一遍会把动作列吃掉一半宽度；此时只留开关（aria-label 不变）。
   */
  hideLabel?: boolean;
  onChange: (visible: boolean) => void;
}

export default function SectionVisibilitySwitch({
  sectionName,
  visible,
  locked = false,
  busy = false,
  hideLabel = false,
  onChange,
}: Props) {
  useLocale();
  const control = (
    <span className="profile-visibility-switch">
      {hideLabel ? null : (
        <Typography.Text type="secondary">{t("profileLibrary.section.visible")}</Typography.Text>
      )}
      <Switch
        size="small"
        checked={locked ? true : visible}
        aria-label={t("profileLibrary.section.visibleAria", { name: sectionName })}
        disabled={locked || busy || undefined}
        onChange={onChange}
      />
    </span>
  );
  // 禁用的开关不接收鼠标事件，Tooltip 必须包一层真实元素才能触发。
  return locked ? (
    <Tooltip title={t("profileLibrary.section.basicLocked")}>
      <span className="profile-visibility-switch-locked">{control}</span>
    </Tooltip>
  ) : (
    control
  );
}
