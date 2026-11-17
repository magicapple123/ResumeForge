// SPDX-License-Identifier: Apache-2.0
/**
 * 双语面板的内容页签（字段对照 / 翻译候选 / 术语表）——**下划线形态**。
 *
 * 不复用 `WorkbenchLeftTabs`：那是左栏的 chip 页签（可换行、块状底色），两种形态混在
 * 同一页里读起来像两套导航。这里按内容页签的惯例做成下划线：一条容器底边 + 选中项
 * 压在上面的 2px 色条（`::after`，不占布局，切换时文字不抖）。
 *
 * 语义与键盘（与 `WorkbenchLeftTabs` 同一套口径，但独立实现）：`role="tablist"` +
 * 每项 `role="tab"`，只有选中项进 Tab 序列（roving tabindex）；←/→ 循环、Home/End
 * 跳到首尾，切换后焦点跟着走。
 */
import { Button } from "antd";
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface BilingualTabItem<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  items: readonly BilingualTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 读屏区域名（`role="tablist"` 的可访问名）。 */
  ariaLabel: string;
}

export default function BilingualTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: Props<T>) {
  const buttons = useRef(new Map<T, HTMLElement | null>());
  // 键盘切换后把焦点交给新的选中页签；鼠标点击不抢焦点。
  const focusOnNextRender = useRef(false);

  useEffect(() => {
    if (!focusOnNextRender.current) return;
    focusOnNextRender.current = false;
    buttons.current.get(value)?.focus();
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    // 方向键在 tablist 里是"换选中"，不是"滚页面"。
    event.preventDefault();
    const count = items.length;
    if (count === 0) return;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? count - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + count) % count;
    if (nextIndex === index) return;
    focusOnNextRender.current = true;
    onChange(items[nextIndex].value);
  };

  return (
    <div className="bilingual-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <Button
            key={item.value}
            type="text"
            size="small"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`bilingual-tab${selected ? " is-active" : ""}`}
            data-tab={item.value}
            ref={(node) => {
              buttons.current.set(item.value, node);
            }}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {/* 包一层 `<span>`：antd Button 会给两个汉字的纯字符串子节点自动插空格。 */}
            <span>{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
