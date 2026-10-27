// SPDX-License-Identifier: Apache-2.0
/** 专业技能分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd";
import ProfileSection from "./ProfileSection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editable: boolean;
}

export function SkillSection({ editable }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <ProfileSection
      fieldName="skills"
      editable={editable}
      emptyValue={{ name: "", level: "" }}
      itemLabel={(item, index) => {
        const name = String(item.name ?? "").trim();
        const level = String(item.level ?? "").trim();
        return (
          [name, level].filter(Boolean).join(" · ") ||
          t("profileUi.skill.itemLabel", { index: index + 1 })
        );
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("profileUi.skill.field.name")}
              rules={[{ required: true, message: t("common.required") }]}
            >
              <Input placeholder={t("profileUi.skill.placeholder.name")} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name={[field.name, "level"]} label={t("profileUi.skill.field.level")}>
              <Input placeholder={t("profileUi.skill.placeholder.level")} />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
