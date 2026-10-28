// SPDX-License-Identifier: Apache-2.0
/**
 * 条目级「从资料填入本条」的下拉 + 按钮（任务 #9：每个多条目板块的每条都有）。
 *
 * 选中一条资料候选 → 只把**空字段**填进**当前这一条**，用户手写的内容一个字不覆盖。
 * 板块级的「从我的资料追加一条」已下线：用户要的是"这一条还缺什么从资料带过来"，
 * 整条追加会多出一条重复经历，还得自己再删。
 *
 * 三条约束：
 * - **只做加法**：不替换、不覆盖用户已经改过的内容；
 * - **不能重复**：在其它条目里已经用过的候选禁用（「已在其他条目」），"就是本条自己"
 *   的也禁用（「当前条目」）——否则同一份资料会被填两遍；
 * - **不传候选 / 候选为空就不渲染**：一个永远没有选项的下拉比没有更让人困惑。
 */
import { ImportOutlined } from "@ant-design/icons";
import { Button, Select, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ProfileFillItem } from "../../features/profile/profileFillOptions";

interface Props {
  /** 模块名（"教育经历" / "项目经历"…），用于按钮文案与无障碍标签。 */
  label: string;
  /** 该模块的全部候选（已按资料顺序、已去重）。 */
  items: ProfileFillItem[];
  /** **其它**条目已用过的去重键 → 命中者标「已在其他条目」并禁用。 */
  existingKeys: Set<string>;
  /** 当前这一条自己的键 → 命中者标「当前条目」并禁用（不重复填自己）。 */
  currentKey?: string;
  /** 填入选中的那一条。 */
  onFill: (item: ProfileFillItem) => void;
}

export default function ProfileFillBar({ label, items, existingKeys, currentKey, onFill }: Props) {
  useLocale();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 候选为空时连控件都不出现。
  if (items.length === 0) return null;

  // 候选身份是资料 entry_id（稳定），"是否已在表单里"用形状键 matchKey 比对：
  // 用户手抄过同样的内容时也应算"已加入"，否则下拉里会再出现一条。
  const matchKeyOf = (item: ProfileFillItem): string => item.matchKey ?? item.key;
  const options = items.map((item) => {
    const matchKey = matchKeyOf(item);
    const isCurrent = currentKey != null && matchKey === currentKey;
    const inOthers = existingKeys.has(matchKey);
    // 后缀优先级：先说自己，再说别人——"当前条目"比"已在其他条目"更贴近用户当下正在看的东西。
    const suffix = isCurrent
      ? ` ${t("editor.profileFill.suffix.current")}`
      : inOthers
        ? ` ${t("editor.profileFill.suffix.other")}`
        : "";
    return {
      value: item.key,
      // `optionFilterProp="label"` 搜的是这个字段：主标题 + 次要说明都参与搜索，
      // 用户记得"公司名"或"2024"都能找到。
      label: item.hint
        ? `${t("editor.profileFill.option", { label: item.label, hint: item.hint })}${suffix}`
        : `${item.label}${suffix}`,
      disabled: isCurrent || inOthers,
      title: item.hint,
    };
  });

  const selected = items.find((item) => item.key === selectedKey) ?? null;
  const selectedMatchKey = selected ? matchKeyOf(selected) : "";
  const selectedBlocked =
    !selected || existingKeys.has(selectedMatchKey) || selectedMatchKey === currentKey;
  const allBlocked = items.every((item) => {
    const matchKey = matchKeyOf(item);
    return existingKeys.has(matchKey) || matchKey === currentKey;
  });

  const fill = () => {
    if (selectedBlocked || !selected) return;
    onFill(selected);
    // 填完清掉选择：同一条已经用过，再点一次只会被禁用，留着选中态反而像"没成功"。
    setSelectedKey(null);
  };

  return (
    // 用 `div` + flex 而不是 antd 的 `Space`：`Space` 的每一项都是 `flex: none`，
    // 宽度不够时它不会缩、只会整体溢出容器——中栏（400–448px）里表现成"按钮被推出
    // 右边界、压在标签条上"（用户 2026-10-23 截图："后面的内容穿透出来了"）。
    // 改成 flex 之后，中间那颗下拉吃掉剩余宽度，文字与按钮固定，最窄时换行而不是溢出。
    <div className="resume-profile-fill" data-fill-variant="entry">
      <Typography.Text type="secondary" className="resume-profile-fill-label">
        {t("editor.profileFill.title.entry")}
      </Typography.Text>
      <Select
        size="small"
        className="resume-profile-fill-select"
        placeholder={t("editor.profileFill.placeholder.entry")}
        aria-label={t("editor.profileFill.aria.entry")}
        showSearch
        optionFilterProp="label"
        value={selectedKey}
        options={options}
        onChange={(value: string | null) => setSelectedKey(value ?? null)}
        notFoundContent={t("editor.profileFill.empty")}
      />
      <Tooltip title={allBlocked ? t("editor.profileFill.allBlocked", { label }) : ""}>
        <Button
          size="small"
          icon={<ImportOutlined />}
          disabled={selectedBlocked}
          aria-label={t("editor.profileFill.fillEntryAria", { label })}
          onClick={fill}
        >
          {t("editor.profileFill.action.fill")}
        </Button>
      </Tooltip>
      {/* 必须说清语义：用户有权知道这里不会覆盖他已经写好的内容。 */}
      <Typography.Text type="secondary" className="resume-profile-fill-hint">
        {t("editor.profileFill.onlyBlank")}
      </Typography.Text>
    </div>
  );
}
