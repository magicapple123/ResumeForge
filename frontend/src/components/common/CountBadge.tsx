// SPDX-License-Identifier: Apache-2.0
/**
 * 计数角标（整改 #14）：页头那种「压在图标右上角的小红胶囊」，两处共用。
 *
 * ## 为什么要抽出来
 *
 * 页头有两个计数入口：通知铃铛（未读条数）与后台任务（待确认任务数）。它们此前各自写
 * `<Badge count size="small" offset>`，于是页头同时存在两种尺寸的角标——一个 14px 量级的
 * 胶囊和一个 20px 量级的实心圆，并排看像两套设计。样式只在 `count-badge.css` 里写一遍。
 *
 * ## 三个口径
 *
 * 1. **不用 antd 的 `size="small"`**：那是约 20px 的实心圆 + 700 字重数字，比旁边几个线性
 *    图标重一档；这里用 `min-width:14px; height:14px` 的胶囊。
 * 2. **锚点是被数的那个图标，不是包着它的按钮**：`Badge` 要包在 18px 的图标上（`offset`
 *    按图标算）。包在 32px 的按钮上时角标会落在按钮外角，中间隔着 8px 内边距，看着"飘"。
 * 3. **`count` 为 0 或负数一律不渲染角标**（antd 的 `showZero` 默认关闭）：未读为 0 时
 *    页头不该留一颗空红点。
 */
import { Badge } from "antd";
import type { ReactNode } from "react";
import "./count-badge.css";

export interface CountBadgeProps {
  /** 要显示的条数；0 / 负数不渲染角标。 */
  count: number;
  /** 相对**子元素**的偏移（应当传图标，不是按钮）。 */
  offset?: [number, number];
  /** 被数的图标（18px 量级的线性图标）。 */
  children: ReactNode;
}

export default function CountBadge({ count, offset = [0, 0], children }: CountBadgeProps) {
  return (
    <Badge className="rf-count-badge" count={count} offset={offset} overflowCount={99}>
      {children}
    </Badge>
  );
}
