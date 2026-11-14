// SPDX-License-Identifier: Apache-2.0
/**
 * 设置项搜索：输入关键词 → 按分组归并的下拉 → 选中后跳到那一组并高亮目标卡。
 *
 * 用 antd `AutoComplete` 而不是自造下拉：键盘上下选择、Esc 关闭、无障碍语义都由它提供。
 * `filterOption={false}`：命中结果已经由 `searchSettingsEntries` 算好，再让 antd 按
 * `value`（索引 id，如 `interview-camera`）过滤一次会把结果全滤掉。
 */
import { AutoComplete } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { searchSettingsEntries } from "./settingsIndex";
import type { SettingsIndexEntry } from "./settingsIndex";
import { SETTINGS_SECTIONS } from "./settingsSections";

export interface SettingsSearchProps {
  onJump: (entry: SettingsIndexEntry) => void;
}

export default function SettingsSearch({ onJump }: SettingsSearchProps) {
  // 订阅语言变化：索引里的标题与别名都走 t()，切语言后下拉要跟着换。
  useLocale();
  const [query, setQuery] = useState("");

  // 索引只有 31 条，逐次过滤的开销远小于缓存失效的复杂度，不做 useMemo。
  const matches = searchSettingsEntries(query);

  // 按九组归并：顺序跟导航一致，用户看到的分组标题和左边那一列对得上。
  const options = SETTINGS_SECTIONS.map((section) => {
    const items = matches.filter((entry) => entry.section === section.key);
    if (items.length === 0) return null;
    return {
      label: t(section.titleKey),
      options: items.map((entry) => ({ value: entry.id, label: t(entry.titleKey) })),
    };
  }).filter((group) => group !== null);

  const handleSelect = (value: string) => {
    const entry = matches.find((item) => item.id === value);
    setQuery("");
    if (entry) onJump(entry);
  };

  return (
    <AutoComplete
      className="settings-search"
      value={query}
      options={options}
      onChange={setQuery}
      onSelect={handleSelect}
      filterOption={false}
      allowClear
      placeholder={t("settings.search.placeholder")}
      notFoundContent={query.trim() ? t("settings.search.empty") : null}
      aria-label={t("settings.search.placeholder")}
    />
  );
}
