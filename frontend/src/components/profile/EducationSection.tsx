/** 教育经历分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd/es/form/FormList";
import ProfileSection from "./ProfileSection";

export function EducationSection() {
  return (
    <ProfileSection
      title="教育经历"
      fieldName="educations"
      emptyValue={{ school: "", major: "", degree: "本科", start_date: "", end_date: "", gpa: "", courses: "", achievements: "" }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name={[field.name, "school"]} label="学校" rules={[{ required: true, message: "必填" }]}>
              <Input placeholder="如：天津工业大学" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={[field.name, "major"]} label="专业">
              <Input placeholder="如：软件工程" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={[field.name, "degree"]} label="学历">
              <Input placeholder="本科 / 硕士 / 博士" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name={[field.name, "start_date"]} label="开始时间">
              <Input placeholder="2022.09" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name={[field.name, "end_date"]} label="结束时间">
              <Input placeholder="2026.06" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name={[field.name, "gpa"]} label="绩点/排名">
              <Input placeholder="如：3.8/4.0 或 前10%" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name={[field.name, "courses"]} label="核心课程">
              <Input.TextArea rows={2} placeholder="每行一门课程" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name={[field.name, "achievements"]} label="在校成果">
              <Input.TextArea rows={2} placeholder="奖学金、竞赛、论文等，每行一条" />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
