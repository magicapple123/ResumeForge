// SPDX-License-Identifier: Apache-2.0
/**
 * 设置卡里的一行字段：标签 +（右侧一个）附属操作 + 控件 + 一行提示。
 *
 * ## 为什么存在
 *
 * 「语义检索 / 语音转写 / 联网搜索」三张卡原先各自手写
 * `div + Typography.Text strong + Typography.Paragraph type="secondary"`，行距、层级与
 * 提示位置各不相同；「大模型 API 配置」卡是它们的基准（条目 02）。抽这一个组件，是为了让
 * 三张卡的字段排版**看起来是同一张卡**，而不是三份近似实现。
 *
 * ## 为什么不替换 LLM 弹窗里的 `Form.Item`
 *
 * `Form.Item` 是表单校验容器（label 联动、错误提示、必填标记、`htmlFor` 与控件的 id 绑定）。
 * 把校验容器换成纯展示容器会丢掉这些能力，也会把两套布局混在一起。本组件**只服务三张
 * 设置卡**，不导出给表单弹窗用。
 *
 * ## 无障碍
 *
 * `label` 只渲染成文本（不做 `htmlFor` 绑定）：卡里的控件各自带 `aria-label`，由控件自己
 * 声明可访问名（例如「语音服务地址」比「服务地址」更明确）。这样两个标签不会互相覆盖。
 */
import { Flex, Typography } from "antd";
import type { ReactNode } from "react";

interface Props {
  /** 字段名（≤7 字），与控件自身的 aria-label 可以不同。 */
  label: string;
  /** 一行提示：说清填什么 / 为什么，不重复 label 已经说过的内容。 */
  hint?: ReactNode;
  /** 标签右侧的附属操作（如「拉取模型列表」「···」）。不传就不渲染。 */
  action?: ReactNode;
  children: ReactNode;
}

export default function SettingsField({ label, hint, action, children }: Props) {
  return (
    <div>
      <Flex align="center" justify="space-between" gap={8} style={{ marginBottom: 4 }}>
        <Typography.Text strong>{label}</Typography.Text>
        {action}
      </Flex>
      {children}
      {hint ? (
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {hint}
        </Typography.Paragraph>
      ) : null}
    </div>
  );
}
