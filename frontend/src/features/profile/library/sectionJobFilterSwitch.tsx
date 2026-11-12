// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块的「参与岗位相关性筛选」开关（问题清单 需求 6）。
 *
 * 这是**板块级**开关，不是字段级：一个板块下的所有条目共用一个判据。
 * - 开：该板块的条目也要与 JD 关键词有交集才进简历，交集不足的条目只出现在
 *   「没写进这份简历」的清单里（资料本身不丢）；
 * - 关（默认）：保持历史行为，整块无条件进简历——「作品集」「通用补充」这类本来
 *   就该全带的板块应该保持关闭。
 *
 * 说明文字必须常驻可见，不能只塞进 Tooltip：用户是按说明来做决定的，藏起来的说明
 * 等于没有。开关与「参与当前方案」的复选框是两个不同的概念，所以放在第二行、带文字，
 * 不用第二个勾选框。
 */
import { Switch } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  /** 板块名：一屏里会有多个开关，无障碍名必须能区分。 */
  sectionName: string;
  checked: boolean;
  /** 写请求进行中：禁用避免连续点击互相覆盖。 */
  busy?: boolean;
  onChange: (enabled: boolean) => void;
}

export default function SectionJobFilterSwitch({
  sectionName,
  checked,
  busy = false,
  onChange,
}: Props) {
  useLocale();
  return (
    <div className="profile-settings-job-filter">
      <Switch
        size="small"
        checked={checked}
        disabled={busy || undefined}
        aria-label={t("profileLibrary.sectionSettings.jobFilterAria", { name: sectionName })}
        onChange={onChange}
      />
      <span className="profile-settings-job-filter-label">
        {t("profileLibrary.sectionSettings.jobFilter")}
      </span>
      <span className="profile-settings-job-filter-hint">
        {t("profileLibrary.sectionSettings.jobFilterHint")}
      </span>
    </div>
  );
}
