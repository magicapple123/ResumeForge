/** 荣誉奖项分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd/es/form/FormList";
import ProfileSection from "./ProfileSection";

export function AwardSection() {
  return (
    <ProfileSection
      title="荣誉奖项"
      fieldName="awards"
      emptyValue={{ name: "", date: "", description: "" }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col span={10}>
            <Form.Item name={[field.name, "name"]} label="奖项名称" rules={[{ required: true, message: "必填" }]}>
              <Input placeholder="如：全国大学生数学建模竞赛一等奖" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name={[field.name, "date"]} label="获得时间">
              <Input placeholder="2024.10" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={[field.name, "description"]} label="说明">
              <Input placeholder="选填，如：全国前 1%" />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
