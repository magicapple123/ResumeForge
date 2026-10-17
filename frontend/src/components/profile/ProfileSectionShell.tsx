/** 个人资料大分区的排序外壳与顺序定义。 */

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DownOutlined,
  HolderOutlined,
  RightOutlined,
} from "@ant-design/icons";
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
  /**
   * 是否处于拖拽中。与 `editable` 一起决定 `is-section-reordering` 类——该类把
   * 分区的 `content-visibility` 从 `auto` 强制成 `visible`，保证拖拽期几何真实且
   * 稳定（离屏分区默认只按 `contain-intrinsic-size` 报 420px 假高度）。
   *
   * **类在进入编辑态时就挂上**（`reordering || editable`），而不是等拖拽激活：
   * 激活瞬间同时发生「全部分区 auto → visible」与「被拖壳 will-change 提升合成层 +
   * transform 逐帧变化」，Chrome 对刚切出 content-visibility 的内容会出现栅格失效，
   * 卡片背景整帧画不出来（真机连拍实测标题栏与第一个条目之间露出整段页面背景）。
   * 提前到编辑态挂类后，拖拽全程不再发生 CV 切换，激活时只剩 will-change 提升。
   * 代价是编辑态整页真实布局（查看态维持 auto 优化不变）。
   */
  reordering: boolean;
  /** 是否正在被拖：挂 `is-dragging`（置顶 + 合成层提示，见 profile.css）。 */
  dragging: boolean;
  /** 查看态是否折叠：编辑态永远展开，所以这里只在 `editable=false` 时被调用方置真。 */
  collapsed: boolean;
  /** 上移微调是否可用（`basic_info` 固定首位 → 第 1 个可拖分区的上移禁用）。 */
  canMoveUp: boolean;
  /** 下移微调是否可用（已在末位时禁用）。 */
  canMoveDown: boolean;
  onToggleCollapsed: (sectionKey: ProfileSectionKey) => void;
  onHandlePointerDown: ProfileSectionPointerDownHandler;
  onMoveByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
  children: ReactNode;
}

/**
 * 分区把手上移/下移微调按钮：点击把该分区移动一位。
 *
 * 行为**复用键盘排序的同一条路径**（`onMoveByOffset`，即 handle 上 ArrowUp/Down
 * 走的同一个函数），不另写一套 reorder。按钮与拖拽把手是**兄弟节点**，点击本就
 * 不会冒泡进把手的 pointerdown；仍显式 `stopPropagation` 兜底，保证绝不进入拖拽态。
 * 悬停分区 / 焦点进入分区时才显示（减少编辑态视觉噪音，见 profile.css）。
 */
function SectionNudgeButtons({
  sectionKey,
  canMoveUp,
  canMoveDown,
  onMoveByOffset,
}: {
  sectionKey: ProfileSectionKey;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
}) {
  const label = SECTION_LABELS[sectionKey];
  const guardPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // 防御性阻止冒泡：微调按钮绝不能开启拖拽。
    event.stopPropagation();
  };
  return (
    <>
      <Tooltip title={`上移“${label}”`}>
        <button
          type="button"
          className="profile-section-nudge profile-section-nudge-up"
          aria-label={`上移${label}`}
          disabled={!canMoveUp}
          onPointerDown={guardPointerDown}
          onClick={() => onMoveByOffset(sectionKey, -1)}
        >
          <ArrowUpOutlined />
        </button>
      </Tooltip>
      <Tooltip title={`下移“${label}”`}>
        <button
          type="button"
          className="profile-section-nudge profile-section-nudge-down"
          aria-label={`下移${label}`}
          disabled={!canMoveDown}
          onPointerDown={guardPointerDown}
          onClick={() => onMoveByOffset(sectionKey, 1)}
        >
          <ArrowDownOutlined />
        </button>
      </Tooltip>
    </>
  );
}

/**
 * 单个可排序分区的外壳。memo 化（T05）：拖拽实时重排 / 页面无关渲染时，
 * props 引用稳定（回调 useCallback、内容 useMemo）的分区子树整块跳过。
 */
export const SortableProfileSection = memo(function SortableProfileSection({
  sectionKey,
  order,
  editable,
  reordering,
  dragging,
  collapsed,
  canMoveUp,
  canMoveDown,
  onToggleCollapsed,
  onHandlePointerDown,
  onMoveByOffset,
  children,
}: SortableProfileSectionProps) {
  // 标题栏是每张卡唯一的标题：卡片本体不再自带标题（否则展开时会和标题栏重复）。
  // 查看态是可点的折叠开关；编辑态只是普通标题，折叠由「全部展开/收起」在查看态接管。
  const titleBar = editable ? (
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
      className={`profile-section-sortable${
        reordering || editable ? " is-section-reordering" : ""
      }${collapsed ? " is-collapsed" : ""}${dragging ? " is-dragging" : ""}`}
      style={{ order }}
      data-profile-section-key={sectionKey}
    >
      {editable && sectionKey !== "basic_info" && (
        <>
          <SectionNudgeButtons
            sectionKey={sectionKey}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveByOffset={onMoveByOffset}
          />
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
        </>
      )}
      {titleBar}
      <div className={`profile-section-content${collapsed ? " is-collapsed" : ""}`}>{children}</div>
    </div>
  );
});
