// SPDX-License-Identifier: Apache-2.0
/**
 * 可复用的「板块顺序」控件：结构面板、新建简历、AI 生成配置共用。
 *
 * 顺序只作为 UI 状态传入/传出；调用方负责把新顺序写回文档（制作台/新建）或
 * format_config（生成配置），本组件不碰存储。
 */
import { Button, Popover } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, SyncOutlined, SwapOutlined } from "@ant-design/icons";
import { useLocale } from "../../i18n/i18nContext";
import { t } from "../../i18n";
import "./sectionOrderControl.css";

export interface SectionOrderItem {
  key: string;
  label: string;
}

interface Props {
  /** 可排的全部板块（顺序无关；组件内部按 currentOrder 展开）。 */
  items: readonly SectionOrderItem[];
  /** 当前顺序；缺失的板块按 items 原顺序补在末尾。 */
  order: readonly string[];
  onChange: (next: string[]) => void;
  /** 「与资料顺序同步」：不传则不显示该动作。 */
  onSyncProfile?: () => void;
  /** 为 true 时资料顺序不可用（例如旧后端没下发），按钮禁用。 */
  syncProfileDisabled?: boolean;
  disabled?: boolean;
}

/** 统一顺序：只认 items 里的 key，未知/重复 key 丢弃，缺失项按 items 原顺序补末尾。 */
function orderedSectionItems(
  items: readonly SectionOrderItem[],
  order: readonly string[],
): SectionOrderItem[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const result: SectionOrderItem[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    if (item && !result.some((current) => current.key === key)) result.push(item);
  }
  for (const item of items) {
    if (!result.some((current) => current.key === item.key)) result.push(item);
  }
  return result;
}

export default function SectionOrderControl({
  items,
  order,
  onChange,
  onSyncProfile,
  syncProfileDisabled = false,
  disabled = false,
}: Props) {
  useLocale();
  const ordered = orderedSectionItems(items, order);
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = ordered.map((item) => item.key);
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title={t("sections.templateControls.orderTitle")}
      content={
        <div
          className="rf-section-order-control"
          role="group"
          aria-label={t("sections.templateControls.orderListAriaLabel")}
        >
          {onSyncProfile ? (
            <Button
              size="small"
              aria-label={t("sections.templateControls.orderSyncProfile")}
              icon={<SyncOutlined />}
              disabled={disabled || syncProfileDisabled}
              onClick={onSyncProfile}
              style={{ marginBottom: 6 }}
            >
              {t("sections.templateControls.orderSyncProfile")}
            </Button>
          ) : null}
          {ordered.map((item, index) => (
            <div className="rf-section-order-control-row" key={item.key}>
              <span className="rf-section-order-control-label">{item.label}</span>
              <Button
                type="text"
                size="small"
                aria-label={t("sections.templateControls.orderMoveUpAria", { label: item.label })}
                disabled={disabled || index === 0}
                icon={<ArrowUpOutlined />}
                onClick={() => move(index, -1)}
              />
              <Button
                type="text"
                size="small"
                aria-label={t("sections.templateControls.orderMoveDownAria", {
                  label: item.label,
                })}
                disabled={disabled || index === ordered.length - 1}
                icon={<ArrowDownOutlined />}
                onClick={() => move(index, 1)}
              />
            </div>
          ))}
        </div>
      }
    >
      <Button
        type="text"
        size="small"
        disabled={disabled}
        aria-label={t("sections.templateControls.orderTriggerAriaLabel")}
        icon={<SwapOutlined />}
      >
        {t("sections.templateControls.orderTrigger")}
      </Button>
    </Popover>
  );
}
