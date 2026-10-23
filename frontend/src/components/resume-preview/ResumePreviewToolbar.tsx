// SPDX-License-Identifier: Apache-2.0
/**
 * 预览工具栏（P2b 起是**两行**）。
 *
 * ```
 * row1（primary）: [草稿|精确] ............... [样式][版式][顺序][页数]
 * row2（measure）: [字号][行距][页边距]
 * ```
 *
 * 为什么分两行（项 4 / D7 / D31）：结构类（样式/版式/顺序/页数）与度量类（字号/行距/
 * 页边距）是两组不同性质的动作，挤在一行时"改版式"的四个按钮被挤到同一行右侧去抢位置。
 * 缩放条**不在工具栏里**：缩放是"看"的动作，它被移到纸面下方（见 ResumePreview）。
 *
 * 2026-10-21 去掉了「抓手 / 编辑」切换与「让 AI 改这一栏」：
 * - 编辑模式（点纸面字段直接改）与「选中文字 → 右键 → AI 润色」「手动调整」重复，
 *   而它要求 iframe 接管指针事件，与按住拖动平移互斥；
 * - 「让 AI 改这一栏」原本只在编辑模式下可用（同一个指针事件依赖），随之一并退场。
 *
 * 剩下的交互只有"看"：拖动平移、Ctrl+滚轮缩放、草稿 / 精确两种口径。
 *
 * 2026-11 又回来了**一个**编辑入口：「草稿模式编辑」复选框（点纸面字段 → 跳输入框）。
 * 它与被去掉的那套"编辑模式"不是同一件事：不接管指针事件（只挂 `click`，拖动平移照旧），
 * 也不在纸面上加任何节点（路径由后端模板的 `data-resume-path` 提供），所以不会重演
 * 当初那条"点一下纸面就抢走拖动"的毛病。精确模式下它是禁用的——纸面是一张 PDF。
 */
import { Checkbox, Segmented, Tooltip, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";

interface Props {
  /** 第一行右侧：结构类版式控件（模板 / 版式 / 板块顺序 / 最大篇幅）。 */
  templateControls?: ReactNode;
  /** 第二行左侧：度量类版式控件（字号 / 行距 / 页边距）。 */
  measureControls?: ReactNode;
  /** 是否提供「精确预览」：只有拿得到简历 id 的宿主才为真。 */
  canExactPreview?: boolean;
  previewMode?: "draft" | "exact";
  onPreviewModeChange?: (mode: "draft" | "exact") => void;
  /**
   * 「草稿模式编辑」的勾选值。
   *
   * 语义由宿主决定（`useClickToEdit`），工具栏只负责显示与回传——它不知道勾了之后
   * 谁来接收路径，也不知道路径长什么样。
   */
  clickToEdit?: boolean;
  onClickToEditChange?: (next: boolean) => void;
  /**
   * 宿主有没有提供落点回调。为假时**整颗复选框都不渲染**：摆一个勾了也没反应的开关，
   * 比不摆更让人困惑（导出/分享那种只读宿主就是这一支）。
   */
  clickToEditAvailable?: boolean;
}

export default function ResumePreviewToolbar({
  templateControls,
  measureControls,
  canExactPreview = false,
  previewMode = "draft",
  onPreviewModeChange,
  clickToEdit = false,
  onClickToEditChange,
  clickToEditAvailable = false,
}: Props) {
  const draftMode = previewMode === "draft";
  // 一句还是两句：草稿模式下解释"勾了能干什么"，精确模式下解释"为什么点不了"。
  const clickToEditHint = draftMode
    ? t("preview.clickToEdit.hint")
    : t("preview.clickToEdit.exact");
  return (
    <div className="resume-preview-toolbar">
      <div className="resume-preview-toolbar-row resume-preview-toolbar-row-primary">
        <div className="resume-preview-toolbar-cluster">
          {/* 预览口径（方案 A）：草稿 = CSS 多列，改一下立刻看到；精确 = 服务端 PDF，
              与导出逐点相同。两者不是"新旧版本"，是两种用途，所以做成并列切换。 */}
          {canExactPreview ? (
            <Segmented
              size="small"
              aria-label="预览口径"
              value={previewMode}
              onChange={(value) => onPreviewModeChange?.(value as "draft" | "exact")}
              options={[
                {
                  value: "draft",
                  label: <Tooltip title="按浏览器排版实时显示，编辑时用这个">草稿</Tooltip>,
                },
                {
                  value: "exact",
                  label: (
                    <Tooltip title="按导出引擎排出的真实 PDF 显示，与下载到的文件完全一致">
                      精确
                    </Tooltip>
                  ),
                },
              ]}
            />
          ) : null}
          {clickToEditAvailable ? (
            // Tooltip 包一层 `<span>` 而不是直接包 Checkbox：禁用的表单控件收不到
            // mouseenter，antd 的 Tooltip 也就永远不显示——而"为什么不能用"正是这一档
            // 唯一需要解释的东西。
            <Tooltip title={clickToEditHint}>
              <span className="resume-preview-click-edit">
                <Checkbox
                  checked={clickToEdit}
                  disabled={!draftMode}
                  onChange={(event) => onClickToEditChange?.(event.target.checked)}
                >
                  {t("preview.clickToEdit.label")}
                </Checkbox>
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="resume-preview-toolbar-controls">{templateControls}</div>
      </div>
      <div className="resume-preview-toolbar-row resume-preview-toolbar-row-measure">
        <div className="resume-preview-toolbar-cluster">{measureControls}</div>
      </div>
      {/* 说明放在**度量控件下方**单独一行（2026-10-21 用户要求）：它解释的是"你现在拖的
          这些值在精确模式下由谁排版"，贴在这一组控件下面才对得上；原先挂在第二行右端，
          窄屏一折行就跑到控件上面去了。 */}
      {canExactPreview && previewMode === "exact" ? (
        <div className="resume-preview-toolbar-row resume-preview-toolbar-row-hint">
          <Typography.Text type="secondary" className="resume-preview-exact-hint">
            这一版由导出引擎排版，与下载到的 PDF 完全一致；缩放用 PDF 查看器自带的 Ctrl+滚轮
          </Typography.Text>
        </div>
      ) : null}
    </div>
  );
}
