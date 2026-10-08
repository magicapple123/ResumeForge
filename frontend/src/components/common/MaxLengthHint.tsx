/**
 * 输入超限提示：统一替换 antd 输入框的 showCount 常驻计数（「0/2000」这类计数
 * 每击键都在跳，用户反而只顾盯着还剩几个字）。maxLength 继续作为硬上限；
 * 只有真的顶到上限时，才在输入框下方出现一行小号红字提醒。
 *
 * 两种用法：
 * - 直接用（value 在手边的受控场景）：
 *   `<MaxLengthHint value={text} maxLength={2000} />`，放在输入控件之后。
 * - Form.Item 直挂：
 *   `<Form.Item name="greeting"><HintedTextArea rows={3} maxLength={1000} /></Form.Item>`
 *   —— Form.Item 会把 value/onChange 注入直接子元素；HintedTextArea 透传给
 *   TextArea 并顺带渲染提示。整个组件只渲染输入框（+达上限时的一行提示），
 *   不引入额外订阅，击键重渲仍只发生在 rc-field-form 的 Field 内部。
 */
import { Input, Typography } from "antd";
import type { TextAreaProps } from "antd/es/input";

interface MaxLengthHintProps {
  value?: unknown;
  maxLength: number;
}

function lengthOf(value: MaxLengthHintProps["value"]): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return String(value).length;
  return 0;
}

/** 达到 maxLength 时渲染一行小号红字，否则什么都不渲染。 */
export function MaxLengthHint({ value, maxLength }: MaxLengthHintProps) {
  if (maxLength <= 0 || lengthOf(value) < maxLength) return null;
  return (
    <Typography.Text type="danger" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
      已达 {maxLength} 字上限
    </Typography.Text>
  );
}

/** Form.Item 直挂版：value/onChange 由 Form.Item 注入（见文件头说明）。 */
export function HintedTextArea(props: TextAreaProps) {
  const { maxLength } = props;
  return (
    <>
      <Input.TextArea {...props} />
      {maxLength ? <MaxLengthHint value={props.value} maxLength={maxLength} /> : null}
    </>
  );
}
