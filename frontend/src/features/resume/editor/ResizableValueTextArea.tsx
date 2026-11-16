// SPDX-License-Identifier: Apache-2.0
/**
 * 可拖高的「单行语义」值输入框（问题 8，方案 A）——`InlineMarkTextArea` 的单行特例。
 *
 * 容器 / 透明文本域 / 行内标记遮罩层全部在 `InlineMarkTextArea` 里（三处入口共用一份，
 * I-26）；本文件只声明"值输入框"这一种用法与它背后的三条实测结论。
 *
 * ## 为什么不用单行 `Input`，也不直接开 `autoSize`
 *
 * - 单行 `Input` 没有多行能力：长值（「Java全栈开发工程师 + …」）只能横向滚，看不到全文；
 * - `Input.TextArea autoSize` 会自动长高，但 `autoSize` 会把 `resize` 强制成 `none`
 *   （rc-textarea 的 `calculateNodeHeight` 负责长高时不再让浏览器接管右下角手柄），
 *   于是"自动长高"和"右下角可拖"只能二选一。用户要的是后者：**框保持一行高，拖右下角看全文**。
 *   多行正文要的恰好是前者，所以那两处传 `autoSize`，不传 `resizable`。
 *
 * ## 语义仍是单行（Enter 必须拦掉）
 *
 * 字段值最终写进纸面的「一行灰字」（`.sub-cell` 没有 `white-space: pre-wrap`），
 * 换行符在 HTML / PDF / Word 里都会被折叠成空格 —— 允许换行等于给用户一个
 * "看得到、导不出"的假象。所以这里拦 Enter（输入法组合中的 Enter 放行，那是确认候选词），
 * 只把框**拉高**，当值不放宽成多行。真要多行字段是排版语义变更，得三个导出出口一起改。
 *
 * ## 高度由浏览器自己持有（不接管 `onResize`）
 *
 * 拖出来的高度是浏览器写进 textarea 内联 `style.height` 的。React 只托管它在 `style` 里
 * 声明过的属性，所以壳里**不传 height**，用户拖出来的高度就不会被重渲染擦掉。
 *
 * 曾经按清单里的备选方案接 `onResize` 回写 `state.height`，实测**不可用**：
 * 把框设成 140px 后 `onResize` 回调报的是 62px（rc-textarea 量的是内容高，不是设置值），
 * 回写后框反而从 140px 被压回 62px —— 正是要避免的"拖高又缩回去"。
 */
import InlineMarkTextArea from "./InlineMarkTextArea";
import "./resizable-value-textarea.css";

interface Props {
  /** 当前值（受控，含行内标记的源串）。 */
  value: string;
  /** 无障碍名：沿用各调用点原有的 `aria-label`，测试按它定位。 */
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** 值变化：只回传字符串，写回由调用方决定（字段 / 页眉字段的 patch）。 */
  onChange: (value: string) => void;
}

export default function ResizableValueTextArea({
  value,
  ariaLabel,
  placeholder,
  disabled = false,
  onChange,
}: Props) {
  return (
    <InlineMarkTextArea
      value={value}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      onChange={onChange}
      className="rf-value-textarea"
      size="small"
      // `rows={1}`：不要 `rows={2}`——短字段会立刻变成两行高，与改动前的单行输入框不一致。
      rows={1}
      resizable
      blockEnter
    />
  );
}
