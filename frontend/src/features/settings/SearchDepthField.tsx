// SPDX-License-Identifier: Apache-2.0
/**
 * 「搜索深度」字段：三档互斥单选（摘要 / 标准 / 深入）。
 *
 * 从 `SearchCard` 整块抽出（那张卡越过 500 行预算，仓库规矩是拆分而不是登记豁免）：
 * 标题、三档 `Radio`、说明文案与变更回调本就是一个完整字段，抽出来不改变任何 DOM
 * 结构、类名与文案，卡里只留一行 `<SearchDepthField … />`。
 *
 * 三档的 `value` 就是后端 `SearchConfig.depth` 的协议值，原样提交；`labelKey` 只负责
 * 显示，在渲染处 `t()`——模块作用域里调 `t()` 会把语言固定在模块求值那一刻（§8.1）。
 */
import { Radio } from "antd";
import SettingsField from "./SettingsField";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { SearchDepth } from "../../types";

const DEPTH_OPTIONS: { value: SearchDepth; labelKey: MessageKey }[] = [
  { value: "snippet", labelKey: "searchCard.depth.snippet" },
  { value: "standard", labelKey: "searchCard.depth.standard" },
  { value: "deep", labelKey: "searchCard.depth.deep" },
];

interface Props {
  /** 当前档位（受控：值来自卡片里那份配置草稿）。 */
  value: SearchDepth;
  /** 用户换档：只上报新值；保存（400ms 合并）仍由卡片统一负责。 */
  onChange: (depth: SearchDepth) => void;
}

export default function SearchDepthField({ value, onChange }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <SettingsField label={t("searchCard.depth.title")} hint={t("searchCard.depth.hint")}>
      {/* 表单控件是互斥单选，必须用 Radio：Checkbox 点已选项无法取消，语义也不对。
          P4-08 起三档是「摘要 / 标准 / 深入」，提交的是 `depth` 协议值。 */}
      <Radio.Group
        aria-label={t("searchCard.depth.title")}
        value={value}
        onChange={(event) => onChange(event.target.value as SearchDepth)}
      >
        {DEPTH_OPTIONS.map((option) => (
          <Radio key={option.value} value={option.value}>
            {t(option.labelKey)}
          </Radio>
        ))}
      </Radio.Group>
    </SettingsField>
  );
}
