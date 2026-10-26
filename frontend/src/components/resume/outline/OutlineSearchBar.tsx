// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲搜索框（D01）：过滤 + 命中上下选择 + Enter 定位 + Esc 清除/恢复滚动位置。
 *
 * 只做受控展示与键盘映射；匹配计算在 `features/resume-outline/search.ts`，定位/滚动
 * 副作用在 `OutlinePanel`。这样搜索的键盘语义只有这一处，面板不必在树与输入框各写一套。
 */
import { ArrowDownOutlined, ArrowUpOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Input, Space, Tooltip } from "antd";
import type { KeyboardEvent } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export interface OutlineSearchBarProps {
  value: string;
  /** 命中总数（0 且 value 非空时显示"没有匹配的内容"）。 */
  matchCount: number;
  /** 当前命中下标（-1 = 还没有选中任一命中）。 */
  activeIndex: number;
  onChange: (value: string) => void;
  /** 上下选择（+1 下一条 / -1 上一条）。 */
  onStep: (delta: number) => void;
  /** Enter：定位到当前命中。 */
  onLocate: () => void;
  /** Esc / 清除按钮：清空查询并按记忆恢复滚动位置。 */
  onClear: () => void;
  /** 有可恢复的滚动位置时渲染"回到之前位置"。 */
  canRestore?: boolean;
  onRestore?: () => void;
  /** 首次聚焦（面板据此记录树的当前滚动位置）。 */
  onFocus?: () => void;
}

export default function OutlineSearchBar({
  value,
  matchCount,
  activeIndex,
  onChange,
  onStep,
  onLocate,
  onClear,
  canRestore = false,
  onRestore,
  onFocus,
}: OutlineSearchBarProps) {
  useLocale();
  const searching = value.trim() !== "";
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onStep(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onStep(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onLocate();
      return;
    }
    if (event.key === "Escape") {
      // Esc 永远是"退出搜索"：清空查询 + 恢复进入搜索前的滚动位置。
      event.preventDefault();
      onClear();
    }
  };
  return (
    <div className="resume-outline-search">
      <Input
        size="small"
        allowClear
        value={value}
        aria-label={t("outline.search.label")}
        placeholder={t("outline.search.placeholder")}
        prefix={<SearchOutlined aria-hidden="true" />}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Space size={2} className="resume-outline-search-nav">
        <Tooltip title={t("outline.search.prev")}>
          <Button
            size="small"
            type="text"
            icon={<ArrowUpOutlined />}
            disabled={matchCount === 0}
            aria-label={t("outline.search.prev")}
            onClick={() => onStep(-1)}
          />
        </Tooltip>
        <Tooltip title={t("outline.search.next")}>
          <Button
            size="small"
            type="text"
            icon={<ArrowDownOutlined />}
            disabled={matchCount === 0}
            aria-label={t("outline.search.next")}
            onClick={() => onStep(1)}
          />
        </Tooltip>
      </Space>
      {searching ? (
        // 状态与按键提示同一行、整行显示（第二行）：输入框与 ↑↓ 占第一行时不再抢宽度。
        <div className="resume-outline-search-meta">
          <span className="resume-outline-search-status" role="status" aria-live="polite">
            {matchCount === 0
              ? t("outline.search.noMatch")
              : t("outline.search.count", {
                  current: Math.max(0, activeIndex) + 1,
                  total: matchCount,
                })}
          </span>
          <span className="resume-outline-search-hint">{t("outline.search.navigateHint")}</span>
        </div>
      ) : null}
      {canRestore && onRestore ? (
        <Tooltip title={t("outline.search.restoreHint")}>
          <Button size="small" type="link" onClick={onRestore}>
            {t("outline.search.restore")}
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}
