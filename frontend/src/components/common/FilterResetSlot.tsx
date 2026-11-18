// SPDX-License-Identifier: Apache-2.0
/**
 * 筛选栏的"尾槽"：筛选控件占满左侧，`恢复默认排序` 贴在这一行的**最右**（I-39）。
 *
 * ## 为什么不把按钮塞进 `Space`
 *
 * antd 的 `Space` 会给每个子节点包一层 `.ant-space-item`，`margin-left: auto` 写在
 * `Button` 上只会作用于 wrapper 内部的元素——**推不动整项**。所以尾槽必须是外层 flex：
 * 一排两项（`Space` 吃剩余宽度 + 按钮 `flex: 0 0 auto`），按钮才能真正贴行右。
 *
 * 两页（简历中心 / 岗位广场）共用这一个组件，避免"一页尾槽、一页塞进 Space"的两种写法。
 * 默认排序方向不同的说明走调用方的 Tooltip 文案（导入 vs 修改），组件不管。
 */
import { UndoOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { ReactNode } from "react";
import "./filterRow.css";

export function FilterResetSlot({
  bar,
  changed,
  hint,
  label,
  onReset,
  className,
}: {
  /** 筛选控件本体（通常是一个 `Space`）。 */
  bar: ReactNode;
  /** 当前排序是否已离开默认值：false 时**整颗按钮不渲染**（不留"灰着但不让点"的占位）。 */
  changed: boolean;
  /** Tooltip：两页方向不同（最近导入 / 最近修改），由调用方给。 */
  hint: string;
  /** 可见文字 + aria-label（保持同一个词，读屏与视觉一致）。 */
  label: string;
  onReset: () => void;
  /** 外层额外类名（页面级的 margin 等）。 */
  className?: string;
}) {
  return (
    <div className={className ? `filter-row ${className}` : "filter-row"}>
      {bar}
      {changed ? (
        <Tooltip title={hint}>
          <Button
            className="filter-reset"
            icon={<UndoOutlined />}
            aria-label={label}
            onClick={onReset}
          >
            {label}
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}
