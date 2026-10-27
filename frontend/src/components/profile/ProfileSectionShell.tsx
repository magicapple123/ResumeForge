// SPDX-License-Identifier: Apache-2.0
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
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { SECTION_LABELS } from "./ProfileSectionConfig";
import type { ProfileSectionKey } from "./ProfileSectionConfig";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export type { ProfileSectionKey } from "./ProfileSectionConfig";

/**
 * 视觉隐藏但读屏可读（sr-only 的内联等价物）：只给 aria-live 播报用的文本，
 * 不新增全局样式文件（R10）。
 */
const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export type ProfileSectionPointerDownHandler = (
  event: ReactPointerEvent<HTMLButtonElement>,
  sectionKey: ProfileSectionKey,
) => void;

interface SortableProfileSectionProps {
  sectionKey: ProfileSectionKey;
  /** 分区显示名：服务端 SectionOut.name（自建大字段也用它）；缺省回落内置兜底标签。 */
  label?: string;
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
  /**
   * 拖动激活期：**全部**分区折叠成 52px 紧凑条（`is-compact`，见 profile.css 与
   * `features/profile/profileCompactDrag.ts`）。默认 false——查看态的折叠走
   * `collapsed`，与这个「拖拽期紧凑布局」是两件不同的事，互不影响。
   */
  compact?: boolean;
  /** 查看态是否折叠：编辑态永远展开，所以这里只在 `editable=false` 时被调用方置真。 */
  collapsed: boolean;
  /** 上移微调是否可用（`basic_info` 固定首位 → 第 1 个可拖分区的上移禁用）。 */
  canMoveUp: boolean;
  /** 下移微调是否可用（已在末位时禁用）。 */
  canMoveDown: boolean;
  onToggleCollapsed: (sectionKey: ProfileSectionKey) => void;
  onHandlePointerDown: ProfileSectionPointerDownHandler;
  onMoveByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
  /**
   * 标题栏右侧的常驻动作槽（如「字段设置」齿轮）。必须渲染在折叠按钮**之外**——
   * 按钮里嵌按钮是非法结构，点击也会连带触发折叠。
   */
  actions?: ReactNode;
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
  label,
  canMoveUp,
  canMoveDown,
  onMoveByOffset,
}: {
  sectionKey: ProfileSectionKey;
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这两个按钮不重渲染。
  useLocale();
  const guardPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // 防御性阻止冒泡：微调按钮绝不能开启拖拽。
    event.stopPropagation();
  };
  return (
    <>
      <Tooltip title={t("profileUi.section.moveUpTooltip", { label })}>
        <button
          type="button"
          className="profile-section-nudge profile-section-nudge-up"
          aria-label={t("profileUi.section.moveUpAria", { label })}
          disabled={!canMoveUp}
          onPointerDown={guardPointerDown}
          onClick={() => onMoveByOffset(sectionKey, -1)}
        >
          <ArrowUpOutlined />
        </button>
      </Tooltip>
      <Tooltip title={t("profileUi.section.moveDownTooltip", { label })}>
        <button
          type="button"
          className="profile-section-nudge profile-section-nudge-down"
          aria-label={t("profileUi.section.moveDownAria", { label })}
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
  label,
  order,
  editable,
  reordering,
  dragging,
  compact = false,
  collapsed,
  canMoveUp,
  canMoveDown,
  onToggleCollapsed,
  onHandlePointerDown,
  onMoveByOffset,
  actions,
  children,
}: SortableProfileSectionProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const displayLabel = label && label.trim() ? label : (SECTION_LABELS[sectionKey] ?? sectionKey);
  // 标题栏是每张卡唯一的标题：卡片本体不再自带标题（否则展开时会和标题栏重复）。
  // 查看态是可点的折叠开关；编辑态只是普通标题，折叠由「全部展开/收起」在查看态接管。
  // 动作槽始终在折叠按钮之外：按钮里嵌按钮是非法结构（点齿轮会连带折叠整卡）。
  const titleBar = (
    <div className="profile-section-titlebar">
      {editable ? (
        <span className="profile-section-title">
          <Typography.Text strong>{displayLabel}</Typography.Text>
        </span>
      ) : (
        <button
          type="button"
          className="profile-section-collapse-toggle"
          aria-expanded={!collapsed}
          aria-label={t(
            collapsed ? "profileUi.section.expandAria" : "profileUi.section.collapseAria",
            {
              label: displayLabel,
            },
          )}
          onClick={() => onToggleCollapsed(sectionKey)}
        >
          <span className="profile-section-collapse-icon">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </span>
          <Typography.Text strong>{displayLabel}</Typography.Text>
        </button>
      )}
      {actions ? <div className="profile-section-titlebar-actions">{actions}</div> : null}
    </div>
  );

  return (
    <div
      className={`profile-section-sortable${
        reordering || editable ? " is-section-reordering" : ""
      }${collapsed ? " is-collapsed" : ""}${dragging ? " is-dragging" : ""}${
        compact ? " is-compact" : ""
      }`}
      style={{ order }}
      data-profile-section-key={sectionKey}
      // 可编程聚焦的落点（R10）：移动后焦点优先给拖动把手，没有把手的分区（basic_info）
      // 落到这里。-1 表示不进入 tab 序，只接受脚本 focus()。
      tabIndex={-1}
      onKeyDown={(event) => {
        // 只处理**根节点自身**上的方向键：分区内容里文本框的 ArrowUp/Down 必须保持
        // 原有语义（移动光标），把手也已有同名处理，事件冒泡上来不能二次触发换位。
        if (event.target !== event.currentTarget) return;
        if (sectionKey === "basic_info") return;
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onMoveByOffset(sectionKey, event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      {editable && sectionKey !== "basic_info" && (
        <>
          {/* 键盘换位没有视觉反馈的替代品：读屏用户需要被告知"现在排第几"。
              内容随 order 变化而变化，aria-live 才会播报（挂载时的初始内容不播报）。 */}
          <span role="status" aria-live="polite" style={VISUALLY_HIDDEN_STYLE}>
            {t("profileUi.section.movedTo", { label: displayLabel, order: order + 1 })}
          </span>
          <SectionNudgeButtons
            sectionKey={sectionKey}
            label={displayLabel}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMoveByOffset={onMoveByOffset}
          />
          <Tooltip title={t("profileUi.section.dragTooltip", { label: displayLabel })}>
            <button
              type="button"
              className="profile-section-drag-handle"
              aria-label={t("profileUi.section.dragAria", { label: displayLabel })}
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
