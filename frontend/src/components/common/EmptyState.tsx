// SPDX-License-Identifier: Apache-2.0
/**
 * 空态（RF-12 固化的通用模式之一）。
 *
 * 薄封装而非新组件库：统一「simple 插图 + 一句说明 + 可选动作」的空态形态，
 * 避免各页面自己拼 <Empty> 时插图口径、按钮排布各写一套。已确认「确实没有
 * 数据」时用它；请求失败请改用同目录的 ErrorState（语义与视觉都不同）。
 *
 * `inline`：表格 emptyText / Listy 空列表 / Drawer 侧栏这类**已经处在紧凑容器里**的
 * 位置，`EmptyState` 外层的 `.rf-state` 带 `min-height:192px`，会凭空把行高撑起来
 * （密度不匹配）。`inline` 时只输出 `<Empty>` 本身，不套外壳。
 */
import { Button, Empty } from "antd";
import type { ReactNode } from "react";

export default function EmptyState({
  description,
  actionLabel,
  onAction,
  inline = false,
  children,
}: {
  /** 一句话说清这里是什么、为什么是空的。 */
  description: ReactNode;
  /** 可选的主动作（如「去创建」）；与 children 二选一或并用。 */
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** 紧凑容器内使用：不渲染 `.rf-state` 外壳（避免 192px 最小高度撑高行）。 */
  inline?: boolean;
  /** 需要自定义动作区时的出口（不渲染默认按钮）。 */
  children?: ReactNode;
}) {
  // 没有任何动作时不要输出空的 `.rf-state-actions`（表格 emptyText 里会带出多余间距）。
  const action =
    children != null ? (
      children
    ) : actionLabel && onAction ? (
      <Button type="primary" onClick={onAction}>
        {actionLabel}
      </Button>
    ) : null;

  const empty = (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
      {action ? <div className="rf-state-actions">{action}</div> : null}
    </Empty>
  );

  return inline ? empty : <div className="rf-state">{empty}</div>;
}
