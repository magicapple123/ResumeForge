// SPDX-License-Identifier: Apache-2.0
/**
 * 行内格式的**静态富文本块**：开关打开后，"失焦 + 有格式"的字段用它替代文本域。
 *
 * ## 为什么它不是"带样式的文本域"
 *
 * 文本域只有一套字体度量：逐字符改字号必然同时错位光标、折行与行高（这正是 T01 这条
 * 待办存在的原因）。所以预览换形态——**两种渲染永不同框**：
 *
 * ```
 * 编辑中：<textarea>（纯文本、正常光标）+ 遮罩层只画 文字/隐藏段/选区/链接下划线
 * 未编辑：本组件（真实字号/字重/颜色，含链接下划线），点一下换回文本域
 * ```
 *
 * ## 为什么自己渲染 `richSegments` 而不是复用 `renderRichValue`
 *
 * `renderRichValue` 只画 `bold / size / color`，**不画链接下划线**（它服务纸面导出的
 * `<strong>/<span>` 子集）。而链接下划线是编辑态唯一保留的格式提示，预览态不能反而丢掉。
 *
 * ## 度量从哪来
 *
 * `padding / border / border-radius / min-height` 与 `.rf-inline-mark-layer` **共用
 * `.rf-inline-mark-static` 一组 token**（见 `styles/inline-mark-overlay.css`）——不在这里
 * 写内联度量，否则"点进去矮一截"会被写死成两个数字，改一处忘一处。
 */
import { useMemo } from "react";

import { richSegments } from "../inline/richRuns";
import type { RichRun } from "../inline/richRuns";
import { inlineMarkSegmentStyle } from "./inlineMarkSegments";
import { clickOffsetFromPoint } from "./inlineMarkClickOffset";
import "./../../../styles/inline-mark-overlay.css";

interface Props {
  /** 纯文本（标记字符已在上游换算掉）。 */
  value: string;
  runs: RichRun[];
  /** 无障碍名：沿用文本域那条 `aria-label`，读屏切换形态后仍是同一个控件。 */
  ariaLabel: string;
  className?: string;
  /** 进入编辑态：`offset` 是点击处的纯文本下标（拿不到点位时由调用方落末尾）。 */
  onEnterEdit: (offset: number) => void;
  /** 「回车编辑」提示：拼在 `aria-label` 后面，给键盘用户。 */
  enterHint?: string;
}

export default function InlineMarkStatic({
  value,
  runs,
  ariaLabel,
  className,
  onEnterEdit,
  enterHint,
}: Props) {
  const segments = useMemo(() => richSegments({ text: value, runs }), [value, runs]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // 拖选复制：用户选了一段文字再点，意图是复制而不是编辑。第一次点击不换形态，
    // 第二次（选区仍在）才进——否则选中即消失，剪贴板里什么都没有。
    if (window.getSelection()?.toString()) return;
    const offset = clickOffsetFromPoint(event.currentTarget, event.clientX, event.clientY);
    onEnterEdit(offset ?? value.length);
  };

  return (
    <div
      className={["rf-inline-mark-static", className].filter(Boolean).join(" ")}
      role="textbox"
      aria-readonly="true"
      aria-multiline="true"
      aria-label={enterHint ? `${ariaLabel} · ${enterHint}` : ariaLabel}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onEnterEdit(value.length);
      }}
    >
      {segments.map((segment, index) => {
        const classes = ["rf-inline-mark-segment"];
        if (segment.bold) classes.push("rf-inline-mark-bold");
        if (segment.href) classes.push("rf-inline-mark-link");
        const style = inlineMarkSegmentStyle(segment);
        return (
          <span key={index} className={classes.join(" ")} style={style}>
            {segment.text}
          </span>
        );
      })}
    </div>
  );
}
