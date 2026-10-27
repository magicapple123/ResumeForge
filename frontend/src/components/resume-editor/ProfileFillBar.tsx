// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料填入」的下拉 + 按钮。两个入口共用这一个组件，靠 `variant` 区分：
 *
 * - `append`（默认）：模块**顶部**，选中一条 → **追加**到数组末尾。用于"资料里又补了
 *   一段实习，整条加进这份简历"。
 * - `entry`：每个**条目的头部**，选中一条 → 把资料里的字段填进**当前这一条**的空字段。
 *   用于"这条我手写了一半，剩下的从资料里带过来"。
 *
 * 为什么合成一个组件而不是两个：两者的候选、去重键、搜索行为完全一样，只有文案和
 * "哪些选项该禁用"不同。分成两个组件会让"候选怎么算"出现两处实现，而它恰好是最容易
 * 漂移的地方（资料页加了字段、忘了同步另一份）。
 *
 * 四条约束：
 * - **只做加法**：不替换、不覆盖用户已经改过的内容；
 * - **不能重复**：`append` 里已经存在的条目禁用（「已加入」）；`entry` 里"在其它条目中
 *   已经用过"的禁用（「已在其他条目」）、"就是本条自己"的也禁用（「当前条目」）；
 * - **不传候选就什么都不渲染**：编辑已保存简历时，这条入口没有意义；
 * - 候选为空时同样不渲染——一个永远没有选项的下拉比没有更让人困惑。
 */

import { ImportOutlined } from "@ant-design/icons";
import { Button, Select, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ProfileFillItem } from "../../features/profile/profileFillOptions";

/** `append` = 模块顶部追加一条；`entry` = 条目头部填进当前这条。 */
export type ProfileFillVariant = "append" | "entry";

interface Props {
  /** 模块名（"教育经历" / "项目经历"…），用于按钮文案与无障碍标签。 */
  label: string;
  /** 该模块的全部候选（已按资料顺序、已去重）。 */
  items: ProfileFillItem[];
  /**
   * 已被占用的去重键：
   * - `append`：整表已有条目的键 → 命中者标「已加入」并禁用；
   * - `entry`：**其它**条目的键 → 命中者标「已在其他条目」并禁用。
   */
  existingKeys: Set<string>;
  /** 填入选中的那一条。 */
  onFill: (item: ProfileFillItem) => void;
  /** 入口形态，默认 `append`（保持既有行为）。 */
  variant?: ProfileFillVariant;
  /** 仅 `entry` 用：当前这一条自己的键 → 命中者标「当前条目」并禁用（不重复填自己）。 */
  currentKey?: string;
}

export default function ProfileFillBar({
  label,
  items,
  existingKeys,
  onFill,
  variant = "append",
  currentKey,
}: Props) {
  useLocale();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const isEntry = variant === "entry";

  // 候选为空时连控件都不出现。
  if (items.length === 0) return null;

  // 候选身份是资料 entry_id（稳定），"是否已在表单里"用形状键 matchKey 比对：
  // 用户手抄过同样的内容时也应算"已加入"，否则下拉里会再出现一条。
  const matchKeyOf = (item: ProfileFillItem): string => item.matchKey ?? item.key;
  const options = items.map((item) => {
    const matchKey = matchKeyOf(item);
    const isCurrent = isEntry && currentKey != null && matchKey === currentKey;
    const inOthers = existingKeys.has(matchKey);
    // 后缀优先级：先说自己，再说别人——"当前条目"比"已在其他条目"更贴近用户当下正在看的东西。
    // 分隔空格放在这里而不是语言包里：指南按原文引用「已加入」，值要逐字等于那个短语。
    const suffix = isCurrent
      ? ` ${t("editor.profileFill.suffix.current")}`
      : inOthers
        ? isEntry
          ? ` ${t("editor.profileFill.suffix.other")}`
          : ` ${t("editor.profileFill.suffix.joined")}`
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
    !selected || existingKeys.has(selectedMatchKey) || (isEntry && selectedMatchKey === currentKey);
  const allBlocked = items.every((item) => {
    const matchKey = matchKeyOf(item);
    return existingKeys.has(matchKey) || (isEntry && matchKey === currentKey);
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
    <div className="resume-profile-fill" data-fill-variant={variant}>
      <Typography.Text type="secondary" className="resume-profile-fill-label">
        {isEntry ? t("editor.profileFill.title.entry") : t("editor.profileFill.title.append")}
      </Typography.Text>
      <Select
        size="small"
        className="resume-profile-fill-select"
        placeholder={
          isEntry
            ? t("editor.profileFill.placeholder.entry")
            : t("editor.profileFill.placeholder.append", { label })
        }
        aria-label={
          isEntry
            ? t("editor.profileFill.aria.entry")
            : t("editor.profileFill.aria.append", { label })
        }
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
          aria-label={
            isEntry
              ? t("editor.profileFill.fillEntryAria", { label })
              : t("editor.profileFill.fillSelectedAria", { label })
          }
          onClick={fill}
        >
          {t("editor.profileFill.action.fill")}
        </Button>
      </Tooltip>
      {/* 条目模式必须说清语义：它和顶部的"追加一条"在同一屏里，用户有权知道
          这里不会覆盖他已经写好的内容。 */}
      {isEntry && (
        <Typography.Text type="secondary" className="resume-profile-fill-hint">
          {t("editor.profileFill.onlyBlank")}
        </Typography.Text>
      )}
    </div>
  );
}
