// SPDX-License-Identifier: Apache-2.0
/** 简历编辑器的分区字段表单。 */
import { Form, Input, Row, Select } from "antd";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useCarrierDisplayProps } from "./carrierDisplay";
import EditorFieldCol from "./EditorFieldCol";
import ResumeListSection from "./ResumeListSection";
import { useEditorFieldVisibility } from "./editorSchemaContext";
import { multilineItemProps } from "./resumeFieldUtils";

/** 工作类型（A4 白名单 code：后端存 code，界面显示中文；与资料页同一组枚举）。 */
const EXPERIENCE_KIND_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "full_time", labelKey: "editor.jobKind.fullTime" },
  { value: "part_time", labelKey: "editor.jobKind.partTime" },
  { value: "contract", labelKey: "editor.jobKind.contract" },
  { value: "self_employed", labelKey: "editor.jobKind.selfEmployed" },
  { value: "internship", labelKey: "editor.jobKind.internship" },
  { value: "volunteer", labelKey: "editor.jobKind.volunteer" },
  { value: "other", labelKey: "editor.jobKind.other" },
];

export function EducationEditor() {
  useLocale();
  // F10：当前方案里看不见的字段不渲染（仍有值的字段保留，见 useEditorFieldVisibility）。
  const visible = useEditorFieldVisibility("educations");
  // 任务 #8：承载区正文框只显示用户手写行（自定义字段行由 AppendedCarrierFields 单独编辑）。
  const carrierProps = useCarrierDisplayProps("education", true);
  return (
    <ResumeListSection
      title={t("editor.section.education")}
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
          <EditorFieldCol xs={24} md={8} show={visible.show("school")}>
            <Form.Item
              name={[field.name, "school"]}
              label={t("editor.field.school")}
              rules={
                visible.show("school")
                  ? [{ required: true, message: t("editor.required.school") }]
                  : undefined
              }
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("major")}>
            <Form.Item name={[field.name, "major"]} label={t("editor.field.major")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("degree")}>
            <Form.Item name={[field.name, "degree"]} label={t("editor.field.degree")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("start_date")}>
            <Form.Item name={[field.name, "start_date"]} label={t("editor.field.startDate")}>
              <Input placeholder="2023.09" />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("end_date")}>
            <Form.Item name={[field.name, "end_date"]} label={t("editor.field.endDate")}>
              <Input placeholder="2027.06" />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("gpa")}>
            <Form.Item name={[field.name, "gpa"]} label={t("editor.field.gpa")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("study_form")}>
            <Form.Item name={[field.name, "study_form"]} label={t("editor.field.studyForm")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("degree_type")}>
            <Form.Item name={[field.name, "degree_type"]} label={t("editor.field.degreeType")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("department")}>
            <Form.Item name={[field.name, "department"]} label={t("editor.field.department")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("rank")}>
            <Form.Item name={[field.name, "rank"]} label={t("editor.field.classRank")}>
              <Input placeholder={t("editor.placeholder.classRank")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={9} show={visible.show("advisor")}>
            <Form.Item name={[field.name, "advisor"]} label={t("editor.field.advisor")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={15} show={visible.show("research_direction")}>
            <Form.Item
              name={[field.name, "research_direction"]}
              label={t("editor.field.researchDirection")}
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("courses")}>
            <Form.Item
              {...multilineItemProps}
              name={[field.name, "courses"]}
              label={t("editor.field.courses")}
            >
              <Input.TextArea rows={3} placeholder={t("editor.placeholder.onePerLine")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("achievements")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "achievements"]}
              label={t("editor.field.studyAchievements")}
            >
              <Input.TextArea rows={3} placeholder={t("editor.placeholder.onePerLine")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function ExperienceEditor() {
  useLocale();
  const visible = useEditorFieldVisibility("experiences");
  const carrierProps = useCarrierDisplayProps("experience", true);
  return (
    <ResumeListSection
      title={t("editor.section.experience")}
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
          <EditorFieldCol xs={24} md={8} show={visible.show("company")}>
            <Form.Item
              name={[field.name, "company"]}
              label={t("editor.field.company")}
              rules={
                visible.show("company")
                  ? [{ required: true, message: t("editor.required.company") }]
                  : undefined
              }
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("role")}>
            <Form.Item name={[field.name, "role"]} label={t("editor.field.expRole")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={4} show={visible.show("start_date")}>
            <Form.Item name={[field.name, "start_date"]} label={t("editor.field.start")}>
              <Input placeholder="2025.03" />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={4} show={visible.show("end_date")}>
            <Form.Item name={[field.name, "end_date"]} label={t("editor.field.end")}>
              <Input placeholder="2025.08" />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("team_size")}>
            <Form.Item name={[field.name, "team_size"]} label={t("editor.field.teamSize")}>
              <Input placeholder={t("editor.placeholder.teamSize")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("experience_kind")}>
            <Form.Item name={[field.name, "experience_kind"]} label={t("editor.field.jobKind")}>
              <Select
                allowClear
                options={EXPERIENCE_KIND_OPTIONS.map((o) => ({
                  value: o.value,
                  label: t(o.labelKey),
                }))}
              />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("description")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "description"]}
              label={t("editor.field.expDescription")}
            >
              <Input.TextArea rows={5} placeholder={t("editor.placeholder.onePointPerLine")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function CampusEditor() {
  useLocale();
  const visible = useEditorFieldVisibility("campus_experiences");
  const carrierProps = useCarrierDisplayProps("campus_experience", true);
  return (
    <ResumeListSection
      title={t("editor.section.campus")}
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
          <EditorFieldCol xs={24} md={8} show={visible.show("organization")}>
            <Form.Item
              name={[field.name, "organization"]}
              label={t("editor.field.organization")}
              rules={
                visible.show("organization")
                  ? [{ required: true, message: t("editor.required.organization") }]
                  : undefined
              }
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("role")}>
            <Form.Item name={[field.name, "role"]} label={t("editor.field.campusRole")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={4} show={visible.show("start_date")}>
            <Form.Item name={[field.name, "start_date"]} label={t("editor.field.start")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={4} show={visible.show("end_date")}>
            <Form.Item name={[field.name, "end_date"]} label={t("editor.field.end")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("activity_type")}>
            <Form.Item name={[field.name, "activity_type"]} label={t("editor.field.activityType")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("description")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "description"]}
              label={t("editor.field.campusDescription")}
            >
              <Input.TextArea rows={5} placeholder={t("editor.placeholder.onePointPerLine")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function ProjectEditor() {
  useLocale();
  const visible = useEditorFieldVisibility("projects");
  const carrierProps = useCarrierDisplayProps("projects", true);
  return (
    <ResumeListSection
      title={t("editor.section.projects")}
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
          <EditorFieldCol xs={24} md={8} show={visible.show("name")}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("editor.field.projectName")}
              rules={
                visible.show("name")
                  ? [{ required: true, message: t("editor.required.projectName") }]
                  : undefined
              }
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("role")}>
            <Form.Item name={[field.name, "role"]} label={t("editor.field.projectRole")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={4} show={visible.show("start_date")}>
            <Form.Item name={[field.name, "start_date"]} label={t("editor.field.start")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={4} show={visible.show("end_date")}>
            <Form.Item name={[field.name, "end_date"]} label={t("editor.field.end")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("project_size")}>
            <Form.Item name={[field.name, "project_size"]} label={t("editor.field.projectSize")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={10} show={visible.show("artifact_type")}>
            <Form.Item name={[field.name, "artifact_type"]} label={t("editor.field.artifactType")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("tech_stack")}>
            <Form.Item
              {...multilineItemProps}
              name={[field.name, "tech_stack"]}
              label={t("editor.field.techStack")}
            >
              <Input.TextArea rows={2} placeholder={t("editor.placeholder.onePerLine")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("description")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "description"]}
              label={t("editor.field.projectDescription")}
            >
              <Input.TextArea rows={5} placeholder={t("editor.placeholder.onePointPerLine")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("highlights")}>
            <Form.Item
              {...multilineItemProps}
              name={[field.name, "highlights"]}
              label={t("editor.field.highlights")}
            >
              <Input.TextArea rows={5} placeholder={t("editor.placeholder.onePointPerLine")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function SkillEditor() {
  useLocale();
  const visible = useEditorFieldVisibility("skills");
  const carrierProps = useCarrierDisplayProps("skills", false);
  return (
    <ResumeListSection
      title={t("editor.section.skills")}
      name="skills"
      fillSection="skills"
      emptyValue={{ name: "", level: "", category: "" }}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol xs={24} md={12} show={visible.show("name")}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("editor.field.skillName")}
              rules={
                visible.show("name")
                  ? [{ required: true, message: t("editor.required.skillName") }]
                  : undefined
              }
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("level")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "level"]}
              label={t("editor.field.skillLevel")}
            >
              <Input placeholder={t("editor.placeholder.skillLevel")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("category")}>
            <Form.Item name={[field.name, "category"]} label={t("editor.field.skillCategory")}>
              <Input placeholder={t("editor.placeholder.skillCategory")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}

export function AwardEditor() {
  useLocale();
  const visible = useEditorFieldVisibility("awards");
  const carrierProps = useCarrierDisplayProps("awards", false);
  return (
    <ResumeListSection
      title={t("editor.section.awards")}
      name="awards"
      fillSection="awards"
      emptyValue={{ name: "", date: "", description: "", issuer: "", level: "", ratio: "" }}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol xs={24} md={12} show={visible.show("name")}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("editor.field.awardName")}
              rules={
                visible.show("name")
                  ? [{ required: true, message: t("editor.required.awardName") }]
                  : undefined
              }
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("date")}>
            <Form.Item name={[field.name, "date"]} label={t("editor.field.awardDate")}>
              <Input placeholder="2025.10" />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("issuer")}>
            <Form.Item name={[field.name, "issuer"]} label={t("editor.field.issuer")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("level")}>
            <Form.Item name={[field.name, "level"]} label={t("editor.field.awardLevel")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("ratio")}>
            <Form.Item name={[field.name, "ratio"]} label={t("editor.field.awardRatio")}>
              <Input placeholder={t("editor.placeholder.awardRatio")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("description")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "description"]}
              label={t("editor.field.notes")}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}
