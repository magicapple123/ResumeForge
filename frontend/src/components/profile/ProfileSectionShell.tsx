/** 个人资料大分区的排序外壳与顺序定义。 */

import { DownOutlined, HolderOutlined, RightOutlined } from "@ant-design/icons";
import { Tooltip, Typography } from "antd";
import { memo } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { SECTION_LABELS } from "./ProfileSectionConfig";
import type { ProfileSectionKey } from "./ProfileSectionConfig";

export type { ProfileSectionKey } from "./ProfileSectionConfig";

export type ProfileSectionPointerDownHandler = (
  event: ReactPointerEvent<HTMLButtonElement>,
  sectionKey: ProfileSectionKey,
) => void;

interface SortableProfileSectionProps {
  sectionKey: ProfileSectionKey;
  order: number;
  editable: boolean;
  compact: boolean;
  /** 查看态是否折叠：编辑态永远展开，所以这里只在 `editable=false` 时被调用方置真。 */
  collapsed: boolean;
  onToggleCollapsed: (sectionKey: ProfileSectionKey) => void;
  onHandlePointerDown: ProfileSectionPointerDownHandler;
  onMoveByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
  children: ReactNode;
}

/**
 * 单个可排序分区的外壳。memo 化（T05）：拖拽实时重排 / 页面无关渲染时，
 * props 引用稳定（回调 useCallback、内容 useMemo）的分区子树整块跳过。
 */
export const SortableProfileSection = memo(function SortableProfileSection({
  sectionKey,
  order,
  editable,
  compact,
  collapsed,
  onToggleCollapsed,
  onHandlePointerDown,
  onMoveByOffset,
  children,
}: SortableProfileSectionProps) {
  // 标题栏是每张卡唯一的标题：卡片本体不再自带标题（否则展开时会和标题栏重复）。
  // 查看态是可点的折叠开关；编辑态只是普通标题，折叠由「全部展开/收起」在查看态接管。
  const titleBar = compact ? null : editable ? (
    <div className="profile-section-titlebar">
      <Typography.Text strong>{SECTION_LABELS[sectionKey]}</Typography.Text>
    </div>
  ) : (
    <button
      type="button"
      className="profile-section-collapse-toggle"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "展开" : "收起"}${SECTION_LABELS[sectionKey]}`}
      onClick={() => onToggleCollapsed(sectionKey)}
    >
      <span className="profile-section-collapse-icon">
        {collapsed ? <RightOutlined /> : <DownOutlined />}
      </span>
      <Typography.Text strong>{SECTION_LABELS[sectionKey]}</Typography.Text>
    </button>
  );

  return (
    <div
      className={`profile-section-sortable${compact ? " is-section-reordering" : ""}${
        collapsed && !compact ? " is-collapsed" : ""
      }`}
      style={{ order }}
      data-profile-section-key={sectionKey}
    >
      {editable && sectionKey !== "basic_info" && (
        <Tooltip title={`拖动调整“${SECTION_LABELS[sectionKey]}”顺序`}>
          <button
            type="button"
            className="profile-section-drag-handle"
            aria-label={`拖动调整${SECTION_LABELS[sectionKey]}顺序`}
            onPointerDown={(event) => onHandlePointerDown(event, sectionKey)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              onMoveByOffset(sectionKey, event.key === "ArrowUp" ? -1 : 1);
            }}
          >
            <HolderOutlined />
          </button>
        </Tooltip>
      )}
      {titleBar}
      {compact && (
        <div className="profile-section-compact-label">
          {/* 调整顺序时标签会被 CSS 截断，而最长的几个（“个人总结 / 自我评价”）
              偏偏最先被截——名字是拖动目标的身份，截了就没法认。 */}
          <Typography.Text strong>{SECTION_LABELS[sectionKey]}</Typography.Text>
        </div>
      )}
      <div className={`profile-section-content${compact || collapsed ? " is-collapsed" : ""}`}>
        {children}
      </div>
    </div>
  );
});
