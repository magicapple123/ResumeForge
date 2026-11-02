// SPDX-License-Identifier: Apache-2.0
/**
 * 「标题布局」三选一：左右 / 上下 / 元信息在上（问题 6，方案 A）。
 *
 * ## 为什么从条目卡头部搬到这里
 *
 * 以前这三个图标跟 `#1`、「⋯」同级摆在条目卡头那一行。那一行的惯例是**卡片级动作**
 * （序号、隐藏徽标、更多操作），而这三个按钮改的是**「标题与元信息」这一域**的排法
 * （`EntryLayout.head`，后端 `SectionLayout` 里根本没有这个字段，它天生只属于条目）。
 * 位置暗示了错误的作用域，又没有文字，于是"看起来像在改整条/整块版式"。
 *
 * 搬进域标题行之后：按钮就在它真正控制的那一行上，前面还多了 11px 的「标题布局」标签。
 *
 * ## 交互与可访问性契约（不要删）
 *
 * - 容器 `role="group"` + `aria-label`（`document.entry.headLayout`，**复用既有 key**，
 *   不新增文案，避免中英两包各加一条）；
 * - 每个按钮都有 `aria-label` + `aria-pressed` + `Tooltip`：现有测试按可访问名点这三个按钮；
 * - 图标 `aria-hidden`，语义只走可访问名；
 * - `stopPropagation` 保留：现在这组按钮已不在右键菜单触发区内，但点它不该顺手展开
 *   外层可点区域（域标题行未来可能挂"整域"动作）。
 *
 * ## 窄栏降级
 *
 * 中栏宽由用户拖动决定（380–760），**不能用视口断点**。样式在 `entry-head-layout.css`：
 * 用项目既有的 `@container wb-editor` 在窄档只隐藏 11px 标签，按钮与 Tooltip 全保留。
 */
import { ColumnHeightOutlined, SwapOutlined, VerticalAlignTopOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import { setEntryHeadLayout } from "../../features/resume-document";
import type { ResumeDocument, ResumeEntry } from "../../types/resumeDocument";
import "./entry-head-layout.css";

type HeadLayout = ResumeEntry["layout"]["head"];

/**
 * 三种标题布局：语义靠 tooltip + `aria-label`，视觉只给一个图标。
 *
 * 原来是 antd `Segmented`：三个中文词占 180px，320–360px 的窄中栏里把 `#1` 与操作按钮
 * 挤到换行；换成图标后同样是三选一，只占 66px。
 */
type HeadLayoutSpec = readonly [HeadLayout, MessageKey, ReactNode];

const HEAD_LAYOUTS: readonly HeadLayoutSpec[] = [
  ["split", "document.entry.headLayout.split", <SwapOutlined aria-hidden="true" />],
  ["stacked", "document.entry.headLayout.stacked", <ColumnHeightOutlined aria-hidden="true" />],
  [
    "meta_first",
    "document.entry.headLayout.meta_first",
    <VerticalAlignTopOutlined aria-hidden="true" />,
  ],
];

interface Props {
  document: ResumeDocument;
  entry: ResumeEntry;
  entryPath: string;
  readOnly?: boolean;
  onChange: (next: ResumeDocument) => void;
}

export default function EntryHeadLayoutSwitch({
  document,
  entry,
  entryPath,
  readOnly = false,
  onChange,
}: Props) {
  const { t } = useI18n();
  const label = t("document.entry.headLayout");
  return (
    <span className="document-zone-head-layout" role="group" aria-label={label}>
      {/* 可见标签只是图标组的说明：读屏已经从 `aria-label` 拿到同一句话，
          所以这里 `aria-hidden`，避免重复朗读两遍。 */}
      <span className="document-zone-layout-label" aria-hidden="true">
        {label}
      </span>
      {HEAD_LAYOUTS.map(([value, labelKey, icon]) => {
        const active = entry.layout.head === value;
        const name = t(labelKey);
        return (
          <Tooltip key={value} title={name}>
            <Button
              size="small"
              type="text"
              className={`document-entry-layout-btn${active ? " is-active" : ""}`}
              aria-label={name}
              aria-pressed={active}
              disabled={readOnly}
              icon={icon}
              onClick={(event) => {
                event.stopPropagation();
                onChange(setEntryHeadLayout(document, entryPath, value));
              }}
            />
          </Tooltip>
        );
      })}
    </span>
  );
}
