// SPDX-License-Identifier: Apache-2.0
/**
 * 「单行语义」值输入框（I-14）——`InlineMarkTextArea` 的自适应高度特例。
 *
 * 容器 / 透明文本域 / 行内标记遮罩层全部在 `InlineMarkTextArea` 里（三处入口共用一份，
 * I-26）；本文件只声明"值输入框"这一种用法。
 *
 * ## 为什么从"可拖高"改成"按内容自适应"
 *
 * 问题 8 曾经是 `rows={1}` + `resizable`：框恒为一行高，长值（「机器学习；深度学习基础；
 * 自然语言处理；…」）的第二行起藏在框内滚动里，而界面上**没有任何**"还有更多"的提示。
 * I-14 改为 `autoSize={{ minRows: 1, maxRows: 4 }}`：
 *
 * - 短值（「全日制」「8/126」）仍是一行高——`minRows: 1`，列表总体高度基本不变；
 * - 长值在 4 行内直接铺开，不再需要框内滚动；
 * - 超过 4 行才出现内部滚动条（`maxRows` 是硬上限，`.rf-value-textarea` 的
 *   `max-height: 40vh` 是窄视口下的第二道兜底）。
 *
 * 取舍：antd 在 `autoSize` 下会把 `resize` 强制成 `none`（rc-textarea 自己量高度），
 * 所以右下角的拖高手柄消失，"自动长高"与"手动拖高"只能二选一。原来的组件名
 * `ResizableValueTextArea` 因此与实现相反，已改名（旧名勿再使用）。
 *
 * ## 语义仍是单行（Enter 必须拦掉）
 *
 * 字段值最终写进纸面的「一行灰字」（`.sub-cell` 没有 `white-space: pre-wrap`），
 * 换行符在 HTML / PDF / Word 里都会被折叠成空格 —— 允许换行等于给用户一个
 * "看得到、导不出"的假象。所以这里拦 Enter（输入法组合中的 Enter 放行，那是确认候选词），
 * 只把框**拉高**，当值不放宽成多行。真要多行字段是排版语义变更，得三个导出入口一起改。
 *
 * ## 高度交给 rc-textarea（壳里不传 height）
 *
 * 高度由 `autoSize` 写在文本域的内联 `style.height` 上；这里不传 `rows`，也不接管
 * `onResize`。两层结构的度量只允许有一个出处（见 `inline-mark-overlay.css`）——
 * 换行位置在"刚好 3 行 / 刚好 4 行"两个临界点上依赖 `scrollbar-gutter: stable`
 * 的等宽预留，改高度策略前先把那两个值量一遍。
 */
import InlineMarkTextArea from "./InlineMarkTextArea";
import type { RichRun, RichValue } from "../inline/richRuns";
import "./auto-grow-value-textarea.css";

interface Props {
  /** 当前值（受控）。结构化模式下是纯文本，否则是含行内标记的源串。 */
  value: string;
  /** 无障碍名：沿用各调用点原有的 `aria-label`，测试按它定位。 */
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** 值变化：只回传字符串，写回由调用方决定（字段 / 页眉字段的 patch）。 */
  onChange: (value: string) => void;
  /** I-13：结构化模式（见 `InlineMarkTextArea`）。 */
  rich?: { runs: RichRun[]; onChange: (next: RichValue) => void } | null;
}

export default function AutoGrowValueTextArea({
  value,
  ariaLabel,
  placeholder,
  disabled = false,
  onChange,
  rich = null,
}: Props) {
  return (
    <InlineMarkTextArea
      value={value}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
      rich={rich}
      className="rf-value-textarea"
      size="small"
      // 1–4 行：短值仍是一行高，长值最多铺到 4 行，超出才在框内滚动。
      autoSize={{ minRows: 1, maxRows: 4 }}
      blockEnter
    />
  );
}
