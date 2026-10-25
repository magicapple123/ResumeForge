// SPDX-License-Identifier: Apache-2.0
/**
 * 事实编辑器里的「自定义字段」输入区：由字段设置（schema）驱动渲染。
 *
 * 为什么按 schema 而不是按 payload：字段定义是**按类型**的（契约 §2），payload 里存的
 * 只是值快照。定义里删除的字段即使 payload 还留着旧值，也不再显示/使用。
 */
import { Form, Input, Typography } from "antd";
import { t } from "../../../i18n";
import type { FactCustomFieldDef } from "../types";

interface Props {
  defs: readonly FactCustomFieldDef[];
  maxLength: number;
}

export default function CustomFieldInputs({ defs, maxLength }: Props) {
  if (defs.length === 0) return null;
  return (
    // 自定义字段是与九类默认字段不同来源的内容，单独成小节（上边框 + 12px 标题）。
    <div className="profile-facts-custom-fields">
      <Typography.Text strong className="profile-facts-custom-fields-title">
        {t("profileFacts.editor.customFields")}
      </Typography.Text>
      {defs.map((def) => (
        <Form.Item key={def.key} name={["custom", def.key]} label={def.label}>
          <Input maxLength={maxLength} />
        </Form.Item>
      ))}
    </div>
  );
}
