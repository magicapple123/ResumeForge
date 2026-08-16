/** 专业技能分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd/es/form/FormList";
import ProfileSection from "./ProfileSection";

export function SkillSection() {
  return (
    <ProfileSection
      title="专业技能"
      fieldName="skills"
      emptyValue={{ name: "", level: "" }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name={[field.name, "name"]} label="技能名称" rules={[{ required: true, message: "必填" }]}>
              <Input placeholder="如：Python / 深度学习 / React" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name={[field.name, "level"]} label="熟练程度">
              <Input placeholder="熟练 / 掌握 / 了解" />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
