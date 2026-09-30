/** 教育经历分区。 */
import { Col, Form, Input, Row, Select } from "antd";
import type { FormListFieldData } from "antd/es/form/FormList";
import PartialDateSelect from "./PartialDateSelect";
import ProfileSection from "./ProfileSection";

interface Props {
  editable: boolean;
}

export function EducationSection({ editable }: Props) {
  return (
    <ProfileSection
      fieldName="educations"
      editable={editable}
      emptyValue={{
        school: "",
        department: "",
        major: "",
        degree: "本科",
        study_mode: "",
        degree_type: "",
        start_date: "",
        end_date: "",
        gpa: "",
        cet4_score: "",
        cet6_score: "",
        courses: "",
        achievements: "",
      }}
      itemLabel={(item, index) => {
        const school = String(item.school ?? "").trim();
        const major = String(item.major ?? "").trim();
        const degree = String(item.degree ?? "").trim();
        return [school, major, degree].filter(Boolean).join(" · ") || `教育经历 ${index + 1}`;
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "school"]}
              label="学校"
              rules={[{ required: true, message: "必填" }]}
            >
              <Input placeholder="如：天津工业大学" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "department"]} label="院系">
              <Input placeholder="如：计算机科学与技术学院" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "major"]} label="专业">
              <Input placeholder="如：软件工程" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "degree"]} label="学历">
              <Select
                allowClear
                placeholder="请选择"
                options={["高中", "大专", "本科", "硕士", "博士"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          </Col>
          {/* 网申表单把"学历"拆成三个独立下拉，这两项只在填表时用得到。 */}
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "study_mode"]} label="学习形式">
              <Select
                allowClear
                placeholder="请选择"
                options={["全日制", "非全日制"].map((value) => ({ value, label: value }))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "degree_type"]} label="学位">
              <Select
                allowClear
                placeholder="请选择"
                options={["学士", "硕士学位", "博士学位", "其他"].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "start_date"]} label="开始时间">
              <PartialDateSelect label={`教育经历${field.name + 1}开始时间`} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "end_date"]} label="结束时间">
              <PartialDateSelect label={`教育经历${field.name + 1}结束时间`} allowOngoing />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "gpa"]} label="绩点/排名">
              <Input placeholder="如：3.8/4.0 或 前10%" />
            </Form.Item>
          </Col>
          {/* 四六级分数录在这一段学历上：网申表单普遍问**具体分数**（不少系统按分数自动筛，
              只填"已通过"过不了），而成绩是这段时间考出来的。网申填表取最高学历那一条。 */}
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "cet4_score"]} label="英语四级分数">
              <Input placeholder="如：520" inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "cet6_score"]} label="英语六级分数">
              <Input placeholder="如：512" inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "courses"]} label="核心课程">
              <Input.TextArea rows={2} placeholder="每行一门课程" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "achievements"]} label="在校成果">
              <Input.TextArea rows={2} placeholder="奖学金、竞赛、论文等，每行一条" />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
