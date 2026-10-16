/**
 * 空态（RF-12 固化的通用模式之一）。
 *
 * 薄封装而非新组件库：统一「simple 插图 + 一句说明 + 可选动作」的空态形态，
 * 避免各页面自己拼 <Empty> 时插图口径、按钮排布各写一套。已确认「确实没有
 * 数据」时用它；请求失败请改用同目录的 ErrorState（语义与视觉都不同）。
 */
import { Button, Empty } from "antd";
import type { ReactNode } from "react";

export default function EmptyState({
  description,
  actionLabel,
  onAction,
  children,
}: {
  /** 一句话说清这里是什么、为什么是空的。 */
  description: ReactNode;
  /** 可选的主动作（如「去创建」）；与 children 二选一或并用。 */
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** 需要自定义动作区时的出口（不渲染默认按钮）。 */
  children?: ReactNode;
}) {
  return (
    <div className="rf-state">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
        <div className="rf-state-actions">
          {children ??
            (actionLabel && onAction ? (
              <Button type="primary" onClick={onAction}>
                {actionLabel}
              </Button>
            ) : null)}
        </div>
      </Empty>
    </div>
  );
}
