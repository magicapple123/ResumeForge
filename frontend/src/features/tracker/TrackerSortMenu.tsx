// SPDX-License-Identifier: Apache-2.0
/**
 * 进度页排序下拉（R13）：触发按钮显示「字段 + 方向」，点开是五项单选菜单。
 *
 * ## 为什么是 `Dropdown + Menu` 而不是 `Select`
 *
 * 需求是"重复点当前项即翻转方向"。antd 的 `Select`/`Menu` 在**重选同一个值**时不会触发
 * 变更回调，这条交互根本表达不出来——只能在 `onClick` 里自己算翻转，所以用 `Menu`
 * 并且 `selectable={false}`（选中态由我们按 `aria-checked` 自己维护）。
 *
 * ## 为什么 ARIA 是手写的
 *
 * 菜单项是"五选一、各带一个方向"，语义上是 radio 而不是 checkbox：`aria-checked` 挂在
 * `role="menuitem"` 上不合法，必须挂 `menuitemradio`。antd 不会替我们声明这两条，
 * `role`/`aria-checked` 是作为额外 props 透传到菜单项 `li` 上的（见类型别名处的说明）。
 * 触发按钮同样自己维护 `aria-haspopup`/`aria-expanded`（照 `TrackCard` 状态胶囊的做法）。
 */
import { ArrowDownOutlined, ArrowUpOutlined, CheckOutlined, DownOutlined } from "@ant-design/icons";
import { Dropdown } from "antd";
import type { MenuItemType } from "antd/es/menu/interface";
import { useState } from "react";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  nextTrackSort,
  TRACK_SORT_DEFAULT_ORDERS,
  TRACK_SORT_KEYS,
  type TrackSortKey,
  type TrackSortState,
} from "./trackSort";

/**
 * 字段 → 语言包 key。界面名与后端字段名**刻意不同**：`next_action_date` 对用户是噪音，
 * 「下一步时间」才是他脑子里的那个词。
 */
const SORT_LABEL_KEYS: Record<TrackSortKey, MessageKey> = {
  stage: "trackerPage.sort.stage",
  updated: "trackerPage.sort.updated",
  next_action_date: "trackerPage.sort.nextActionDate",
  applied_at: "trackerPage.sort.appliedAt",
  company: "trackerPage.sort.company",
};

/**
 * antd 的 `MenuItemType` 不带 ARIA 字段，但 `@rc-component/menu` 的菜单项会把未知 props
 * 透传到 `li`（并显式支持 `role`）。所以这两个字段只能在这里补上类型——它们是**必须
 * 落到 DOM 上**的，不是装饰。
 */
type SortMenuItemType = MenuItemType & {
  role?: "menuitemradio";
  "aria-checked"?: boolean;
};

interface Props {
  value: TrackSortState;
  onChange: (next: TrackSortState) => void;
}

export default function TrackerSortMenu({ value, onChange }: Props) {
  // 模块级 t()：必须订阅语言变化，否则切语言后菜单文案停在旧语言。
  useLocale();
  const [open, setOpen] = useState(false);
  const fieldLabel = t(SORT_LABEL_KEYS[value.key]);
  // 方向只在"有方向"的字段上说；「阶段优先」是固定次序，报读时说明它是固定的。
  const ariaLabel =
    value.order === ""
      ? t("trackerPage.sort.ariaFixed", { field: fieldLabel })
      : t("trackerPage.sort.ariaField", {
          field: fieldLabel,
          direction: value.order === "asc" ? t("trackerPage.sort.asc") : t("trackerPage.sort.desc"),
        });

  const items: SortMenuItemType[] = TRACK_SORT_KEYS.map((key) => {
    const active = value.key === key;
    // 非当前字段显示的是"点它会用的方向"（该字段默认方向），不是当前字段的方向。
    const direction = key === "stage" ? "" : active ? value.order : TRACK_SORT_DEFAULT_ORDERS[key];
    return {
      key,
      role: "menuitemradio",
      "aria-checked": active,
      label: (
        <span className="tracker-sort-option">
          <span>{t(SORT_LABEL_KEYS[key])}</span>
          {direction === "" ? (
            <span className="tracker-sort-option-fixed">{t("trackerPage.sort.fixed")}</span>
          ) : (
            <span className="tracker-sort-option-dir" aria-hidden="true">
              {direction === "asc" ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            </span>
          )}
          {/* 选中项打勾：点了之后菜单会关，勾是"现在是这一项"的唯一常驻痕迹。 */}
          <CheckOutlined
            className="tracker-sort-option-check"
            aria-hidden="true"
            style={{ visibility: active ? "visible" : "hidden" }}
          />
        </span>
      ),
    };
  });

  return (
    <Dropdown
      trigger={["click"]}
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      menu={{
        items,
        selectable: false,
        onClick: ({ key }) => onChange(nextTrackSort(value, key as TrackSortKey)),
      }}
    >
      <button
        type="button"
        className="tracker-sort-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="tracker-sort-trigger-label">{fieldLabel}</span>
        {value.order === "" ? null : value.order === "asc" ? (
          <ArrowUpOutlined className="tracker-sort-trigger-dir" aria-hidden="true" />
        ) : (
          <ArrowDownOutlined className="tracker-sort-trigger-dir" aria-hidden="true" />
        )}
        <DownOutlined className="tracker-sort-trigger-caret" aria-hidden="true" />
      </button>
    </Dropdown>
  );
}
