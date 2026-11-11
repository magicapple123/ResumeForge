// SPDX-License-Identifier: Apache-2.0
/** 收藏夹找回层工具条（#28A）：搜索 + 状态筛选 + 排序 + 导出。
 *
 * 单独成组件：FavoritesPage 还有页签、批量操作与简历表格，页面文件必须留在
 * 500 行预算内（test_file_size_budget 硬闸门）。
 */
import { Button, Input, Select, Space } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { FavoriteSort } from "../../types";

/** 状态筛选（#28A）：在招 / 已关闭 / 已投 / 未投。 */
export type StatusFilter = "all" | "open" | "closed" | "applied" | "unapplied";

const STATUS_FILTERS: StatusFilter[] = ["all", "open", "closed", "applied", "unapplied"];
const SORT_OPTIONS: FavoriteSort[] = ["favorited_desc", "posted_desc", "match_desc"];

const STATUS_LABEL_KEYS: Record<StatusFilter, MessageKey> = {
  all: "favorites.filter.status.all",
  open: "favorites.filter.status.open",
  closed: "favorites.filter.status.closed",
  applied: "favorites.filter.status.applied",
  unapplied: "favorites.filter.status.unapplied",
};

const SORT_LABEL_KEYS: Record<FavoriteSort, MessageKey> = {
  favorited_desc: "favorites.sort.favorited",
  posted_desc: "favorites.sort.posted",
  match_desc: "favorites.sort.match",
};

interface FavoritesToolbarProps {
  keywordInput: string;
  statusFilter: StatusFilter;
  sort: FavoriteSort;
  onKeywordInputChange: (value: string) => void;
  onSearch: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onSortChange: (value: FavoriteSort) => void;
  onExport: (format: "csv" | "md") => void;
}

export default function FavoritesToolbar(props: FavoritesToolbarProps) {
  useLocale();
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Input.Search
        allowClear
        placeholder={t("favorites.search.placeholder")}
        value={props.keywordInput}
        onChange={(event) => props.onKeywordInputChange(event.target.value)}
        onSearch={props.onSearch}
        style={{ width: 260 }}
      />
      <Select<StatusFilter>
        aria-label={t("favorites.filter.status")}
        value={props.statusFilter}
        options={STATUS_FILTERS.map((value) => ({
          value,
          label: t(STATUS_LABEL_KEYS[value]),
        }))}
        onChange={props.onStatusChange}
        style={{ width: 120 }}
      />
      <Select<FavoriteSort>
        aria-label={t("favorites.sort.label")}
        value={props.sort}
        options={SORT_OPTIONS.map((value) => ({
          value,
          label: t(SORT_LABEL_KEYS[value]),
        }))}
        onChange={props.onSortChange}
        style={{ width: 140 }}
      />
      <Button onClick={() => props.onExport("csv")}>{t("favorites.action.exportCsv")}</Button>
      <Button onClick={() => props.onExport("md")}>{t("favorites.action.exportMarkdown")}</Button>
    </Space>
  );
}
