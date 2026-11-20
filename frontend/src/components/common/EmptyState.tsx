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

/**
 * 空态水印插图（WF-18）：产品线稿标识的单色放大版。
 *
 * 为什么内联 SVG 而不是 `<img>`：颜色要跟主题走（`currentColor` + 语义 token），
 * 还要能压透明度；`<img>` 里的内部图层 CSS 摸不到。
 * 72px / 55% 是实测口径——antd `PRESENTED_IMAGE_SIMPLE` 的线框重量大致相当，
 * 再深就会比旁边的说明文字更抢眼。
 */
export function EmptyWatermark({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="rf-empty-watermark"
      style={{
        // 显式给宽高：antd 的 `.ant-empty-image` 会把 svg 拉到父容器高度（实测 72×125，竖向拉长）。
        width: size,
        height: size,
        flex: "none",
        color: "var(--rf-text-secondary)",
        opacity: 0.55,
      }}
    >
      <rect x="11" y="11" width="490" height="490" rx="55" strokeWidth="12" />
      <path
        strokeWidth="14"
        d="M326 100C379 107 431 111 464 116C476 118 482 128 478 139C437 245 388 355 335 454C330 464 320 469 310 466C268 455 221 440 186 431C149 395 98 384 43 360C34 356 29 346 35 335C87 246 135 144 168 59C173 47 183 42 194 46C223 57 289 79 326 100Z"
      />
      <path
        strokeWidth="12"
        d="M326 100C316.6 130 305.7 161 293.9 192.3M251.7 295.7C230.4 344.2 207.9 390.6 186 431"
      />
      <path
        strokeWidth="13"
        d="M254 194C259 187 267 187 271 194L279 209Q281 213 288 215L304 219C314 222 315 231 306 238L291 249Q287 252 288 258L289 273C290 282 283 288 274 283L260 274Q255 270 249 273L229 280C220 283 213 278 216 269L221 254Q223 248 219 244L209 232C202 223 207 215 217 214L235 212Q240 212 243 207Z"
      />
    </svg>
  );
}

export default function EmptyState({
  description,
  actionLabel,
  onAction,
  inline = false,
  image,
  children,
}: {
  /** 一句话说清这里是什么、为什么是空的。 */
  description: ReactNode;
  /** 可选的主动作（如「去创建」）；与 children 二选一或并用。 */
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** 紧凑容器内使用：不渲染 `.rf-state` 外壳（避免 192px 最小高度撑高行）。 */
  inline?: boolean;
  /** 自定义插图（如 `<EmptyWatermark />`）；不传维持 antd simple，现有调用零改动。 */
  image?: ReactNode;
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

  // 默认插图（WF-18 收口）：**整块空态**统一用产品线稿，`inline`（表格 emptyText、
  // 侧栏、下拉）仍保留 antd simple——那些位置的槽位只有 40px 上下，72px 线稿会把行高撑开。
  // 之所以做成默认值而不是让每个调用点自己传：全库 71 个调用点只有 7 个传了，
  // 于是"有的页面换了、有的没换"（2026-11-20 用户截图）。
  const empty = (
    <Empty
      image={image ?? (inline ? Empty.PRESENTED_IMAGE_SIMPLE : <EmptyWatermark />)}
      description={description}
    >
      {action ? <div className="rf-state-actions">{action}</div> : null}
    </Empty>
  );

  return inline ? empty : <div className="rf-state">{empty}</div>;
}
