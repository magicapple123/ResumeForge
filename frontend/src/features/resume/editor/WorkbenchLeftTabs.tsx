// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏的**页签条**（2026-10-25 从 `WorkbenchParamsColumn` 拆出）。
 *
 * 为什么不用 antd `Segmented`：左栏内容宽默认只有 380，6 个页签每个分到约 63px，四字
 * 标签直接进省略号（用户截图里的「排版... / 文档... / 表达...」）；而 Segmented 的选中
 * 指示器是绝对定位的动画 thumb，换成换行布局会错位。2026-10-25 起第一列可拖动改宽，
 * 页签条必须在 360–640 之间都读得全——所以改成可换行的 chip 页签：窄时两行、宽时一行。
 *
 * 语义：`role="tablist"` + 每个 `Button role="tab"`；←/→ 循环、Home/End 跳到首尾。
 * 标签包一层 `<span>` 是必需的——antd Button 会给"两个汉字的纯字符串子节点"自动插空格
 * （「历 史」），包起来之后两个字的页签与四个字的页签视觉一致，测试按文案定位也不会碎。
 */
import { Button } from "antd";
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface WorkbenchLeftTabItem<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  items: readonly WorkbenchLeftTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 读屏区域名（`role="tablist"` 的可访问名）。 */
  ariaLabel: string;
}

export default function WorkbenchLeftTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: Props<T>) {
  // antd Button 的 ref 在"不是链接"时是 button，但类型上仍是 button | anchor 的联合；
  // 两者都继承 HTMLElement，focus() 是共同能力。
  const buttons = useRef(new Map<T, HTMLElement | null>());
  // 键盘切换后把焦点交给新的选中页签；鼠标点击不抢焦点（antd Button 自己会处理）。
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
    <div className="resume-wb-left-tabs" role="tablist" aria-label={ariaLabel}>
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
            className={`resume-wb-left-tab${selected ? " is-active" : ""}`}
            data-tab={item.value}
            ref={(node) => {
              buttons.current.set(item.value, node);
            }}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span>{item.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
