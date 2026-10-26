// SPDX-License-Identifier: Apache-2.0
/**
 * 可隐藏的栅格列（F10）：字段不在当前方案可见字段里时把这一格藏起来。
 *
 * 为什么用 `display:none` 而不是条件渲染：`Form.Item` 卸载后它的值不再进提交值，
 * 而"方案里隐藏了某字段"不该让正文里已有的那个值被一次保存清掉（旧简历也走同一份表单）。
 */
import { Col } from "antd";
import type { GetProps } from "antd";

type ColProps = GetProps<typeof Col>;

interface Props extends ColProps {
  /** false = 隐藏这一格（字段仍注册在表单里，值原样保留）。 */
  show?: boolean;
}

export default function EditorFieldCol({ show = true, style, ...rest }: Props) {
  return <Col {...rest} style={show ? style : { ...style, display: "none" }} />;
}
