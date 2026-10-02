import type { CSSProperties, MouseEvent, ReactNode } from "react";

export interface ListyItemProps {
  /** 主内容区（对应原 List.Item 的 children / List.Item.Meta 部分）。 */
  children?: ReactNode;
  /** 右侧操作区（对应原 List.Item 的 actions）。 */
  actions?: ReactNode[];
  className?: string;
  style?: CSSProperties;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
}

/**
 * List.Item 的轻量替代。Listy 只提供滚动容器与行外壳（内边距、分隔线、悬停背景），
 * 「主内容 + 右侧操作」的行内布局按 antd v6 迁移指引在 itemRender 里用普通 JSX 重组，
 * 该组件把这段 flex 布局收敛到一处，避免每个列表各写一份。
 */
export function ListyItem({
  children,
  actions,
  className,
  style,
  onClick,
  ariaLabel,
}: ListyItemProps) {
  const hasActions = actions !== undefined && actions.length > 0;
  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, ...style }}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {hasActions && (
        <div
          className="listy-item-actions"
          style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 4 }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

interface ListyMetaProps {
  /** 左侧头像区（对应原 List.Item.Meta 的 avatar）。 */
  avatar?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
}

/**
 * List.Item.Meta 的轻量替代：头像 + 标题/描述纵向排布，内容样式交给调用方的
 * Typography / Tag 等节点自行控制（与现有用法一致）。
 */
export function ListyMeta({ avatar, title, description }: ListyMetaProps) {
  const content = (
    <div style={{ minWidth: 0 }}>
      {title != null && <div>{title}</div>}
      {description != null && <div style={{ marginTop: 2 }}>{description}</div>}
    </div>
  );
  if (avatar == null) return content;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      {avatar}
      {content}
    </div>
  );
}
