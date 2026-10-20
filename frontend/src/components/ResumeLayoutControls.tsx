// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式控制（壳）：生成配置阶段与预览弹窗共用。
 *
 * 自 P2 起这里**只做组合**，两组控件各自成文件（D4）：
 * - `ResumeTemplateControls`：结构类——样式模板 / 版式模板 / 板块顺序 / 最大篇幅；
 * - `ResumeMeasureControls`：度量类——字号 / 行距 / 页边距。
 *
 * 壳的职责只有两件：
 * 1. **只取一次模板目录**，再经 props 下发给两组。让两组各写一份 `useApi` 不仅是两次
 *    请求，更是"两份实现"——目录的字段与默认值曾经各改各的。
 * 2. 保持"一行全都要"这种旧形态（生成配置阶段就是它）：外层 `Space` 的间距规则与拆分前
 *    完全一致，两组的内部间距用同一套数值，所以拆完之后视觉不变。
 *
 * 预览工具栏/弹窗按两个插槽分别渲染（`templateControls` / `measureControls`），
 * 那时壳不出场——两行布局由工具栏自己决定。
 */
import { Space } from "antd";
import { useResumeTemplateCatalog } from "../hooks/useResumeTemplateCatalog";
import type { ResumeLayout } from "../types";
import type { ResumePreviewHandle } from "./ResumePreview";
import ResumeMeasureControls from "./resume/ResumeMeasureControls";
import ResumeTemplateControls from "./resume/ResumeTemplateControls";

interface Props {
  layout: ResumeLayout;
  disabled?: boolean;
  onChange: (layout: ResumeLayout) => void;
  /** 紧凑模式：只留控件、不显示分组标签（放在工具栏里时用）。 */
  compact?: boolean;
  /** 用哪份简历做模板预览；为空时后端用内置示例内容。 */
  resumeId?: number;
  /**
   * 预览句柄：拖动字号时用它把探针 CSS 即时注入预览（本地缩放，无网络往返）。
   * 没有预览时（生成前的配置阶段）可省略——滑块仍可用，只是没有即时反馈。
   */
  previewRef?: React.RefObject<ResumePreviewHandle | null>;
  /**
   * 默认板块顺序是否跟随「我的资料」。
   *
   * 只在**生成**场景为 true：新简历的默认顺序应当等于用户在资料页排好的顺序。
   * 已保存简历（预览 / 编辑）与生成后的预览阶段都不传——它们读的是这份简历自己的
   * `section_order`，没有则用内置默认。否则用户在资料页拖一下，所有老简历的外观都会
   * 跟着变，而"老简历不追溯改变"是这条功能的前提。
   */
  preferProfileOrder?: boolean;
}

export default function ResumeLayoutControls({
  layout,
  disabled = false,
  onChange,
  compact = false,
  resumeId,
  previewRef,
  preferProfileOrder = false,
}: Props) {
  // 目录只在这里取一次：两组的默认值（行距 / 页边距 / 字号档位）都吃这一份数据。
  // 取数走 `useResumeTemplateCatalog`（唯一加载入口），这样"一个宿主一次请求"是有出处的。
  const { catalog } = useResumeTemplateCatalog();

  return (
    <Space size={compact ? 8 : 16} wrap className="resume-layout-controls">
      <ResumeTemplateControls
        layout={layout}
        disabled={disabled}
        compact={compact}
        resumeId={resumeId}
        catalog={catalog}
        preferProfileOrder={preferProfileOrder}
        onChange={onChange}
      />
      <ResumeMeasureControls
        layout={layout}
        disabled={disabled}
        compact={compact}
        catalog={catalog}
        previewRef={previewRef}
        onChange={onChange}
      />
    </Space>
  );
}
