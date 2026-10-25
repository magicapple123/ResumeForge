// SPDX-License-Identifier: Apache-2.0
/** 简历编辑器的分区字段表单。 */
import { Col, Form, Input, Row, Select } from "antd";
import ResumeListSection from "./ResumeListSection";
import { multilineItemProps } from "./resumeFieldUtils";

/** 工作类型（A4 白名单 code：后端存 code，界面显示中文；与资料页同一组枚举）。 */
const EXPERIENCE_KIND_OPTIONS = [
  { value: "full_time", label: "全职" },
  { value: "part_time", label: "兼职" },
  { value: "contract", label: "合同" },
  { value: "self_employed", label: "自雇" },
  { value: "internship", label: "实习" },
  { value: "volunteer", label: "志愿" },
  { value: "other", label: "其他" },
];

export function EducationEditor() {
  return (
    <ResumeListSection
      title="教育经历"
      name="education"
      fillSection="education"
      emptyValue={{
        school: "",
        major: "",
        degree: "",
        start_date: "",
        end_date: "",
        gpa: "",
        courses: [],
        achievements: [],
        study_form: "",
        degree_type: "",
        department: "",
        rank: "",
        advisor: "",
        research_direction: "",
      }}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "school"]}
              label="学校"
              rules={[{ required: true, message: "请填写学校" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "major"]} label="专业">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "degree"]} label="学历">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "start_date"]} label="开始时间">
              <Input placeholder="2023.09" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "end_date"]} label="结束时间">
              <Input placeholder="2027.06" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "gpa"]} label="绩点/排名">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "study_form"]} label="学习形式">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "degree_type"]} label="学位类型">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "department"]} label="院系">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "rank"]} label="成绩排名">
              <Input placeholder="如：前 10%" />
            </Form.Item>
          </Col>
          <Col xs={24} md={9}>
            <Form.Item name={[field.name, "advisor"]} label="导师">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={15}>
            <Form.Item name={[field.name, "research_direction"]} label="研究方向">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item {...multilineItemProps} name={[field.name, "courses"]} label="核心课程">
              <Input.TextArea rows={3} placeholder="每行一项" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item {...multilineItemProps} name={[field.name, "achievements"]} label="在校成果">
              <Input.TextArea rows={3} placeholder="每行一项" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function ExperienceEditor() {
  return (
    <ResumeListSection
      title="实习/工作经历"
      name="experience"
      fillSection="experience"
      emptyValue={{
        company: "",
        role: "",
        start_date: "",
        end_date: "",
        description: [],
        team_size: "",
        experience_kind: "",
      }}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "company"]}
              label="公司"
              rules={[{ required: true, message: "请填写公司" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "role"]} label="岗位">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name={[field.name, "start_date"]} label="开始">
              <Input placeholder="2025.03" />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name={[field.name, "end_date"]} label="结束">
              <Input placeholder="2025.08" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "team_size"]} label="团队规模">
              <Input placeholder="如：8 人" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "experience_kind"]} label="工作类型">
              <Select allowClear options={EXPERIENCE_KIND_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item {...multilineItemProps} name={[field.name, "description"]} label="工作内容">
              <Input.TextArea rows={5} placeholder="每行一个要点" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function CampusEditor() {
  return (
    <ResumeListSection
      title="校园经历"
      name="campus_experience"
      fillSection="campusExperience"
      emptyValue={{
        organization: "",
        role: "",
        start_date: "",
        end_date: "",
        description: [],
        activity_type: "",
      }}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "organization"]}
              label="组织/部门"
              rules={[{ required: true, message: "请填写组织/部门" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "role"]} label="职务/角色">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name={[field.name, "start_date"]} label="开始">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name={[field.name, "end_date"]} label="结束">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "activity_type"]} label="活动类型">
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item {...multilineItemProps} name={[field.name, "description"]} label="经历描述">
              <Input.TextArea rows={5} placeholder="每行一个要点" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function ProjectEditor() {
  return (
    <ResumeListSection
      title="项目经历"
      name="projects"
      fillSection="projects"
      emptyValue={{
        name: "",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: [],
        highlights: [],
        project_size: "",
        artifact_type: "",
      }}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "name"]}
              label="项目名称"
              rules={[{ required: true, message: "请填写项目名称" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "role"]} label="担任角色">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name={[field.name, "start_date"]} label="开始">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name={[field.name, "end_date"]} label="结束">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "project_size"]} label="项目规模">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name={[field.name, "artifact_type"]} label="成果类型">
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item {...multilineItemProps} name={[field.name, "tech_stack"]} label="技术栈">
              <Input.TextArea rows={2} placeholder="每行一项" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item {...multilineItemProps} name={[field.name, "description"]} label="项目描述">
              <Input.TextArea rows={5} placeholder="每行一个要点" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item {...multilineItemProps} name={[field.name, "highlights"]} label="亮点/成果">
              <Input.TextArea rows={5} placeholder="每行一个要点" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function SkillEditor() {
  return (
    <ResumeListSection
      title="专业技能"
      name="skills"
      fillSection="skills"
      emptyValue={{ name: "", level: "", category: "" }}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "name"]}
              label="技能名称"
              rules={[{ required: true, message: "请填写技能名称" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "level"]} label="熟练程度">
              <Input placeholder="熟练 / 掌握 / 了解" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "category"]} label="技能分类">
              <Input placeholder="如：编程语言 / 工具" />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function AwardEditor() {
  return (
    <ResumeListSection
      title="荣誉奖项"
      name="awards"
      fillSection="awards"
      emptyValue={{ name: "", date: "", description: "", issuer: "", level: "", ratio: "" }}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "name"]}
              label="奖项名称"
              rules={[{ required: true, message: "请填写奖项名称" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "date"]} label="获奖时间">
              <Input placeholder="2025.10" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "issuer"]} label="颁发机构">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "level"]} label="奖项级别">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "ratio"]} label="获奖比例">
              <Input placeholder="如：前 5%" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name={[field.name, "description"]} label="说明">
              <Input.TextArea rows={3} />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}
