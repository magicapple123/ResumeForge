// SPDX-License-Identifier: Apache-2.0
/** 教育经历分区。 */
import { Col, Form, Input, Row, Select } from "antd";
import type { FormListFieldData } from "antd";
import PartialDateSelect from "./PartialDateSelect";
import ProfileSection from "./ProfileSection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editable: boolean;
}

export function EducationSection({ editable }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <ProfileSection
      fieldName="educations"
      editable={editable}
      emptyValue={{
        school: "",
        department: "",
        major: "",
        // 表单默认值会落库，也是与后端一致的协议值，不翻译。
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
        return (
          [school, major, degree].filter(Boolean).join(" · ") ||
          t("educationSection.itemLabel", { index: index + 1 })
        );
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "school"]}
              label={t("educationSection.field.school")}
              rules={[{ required: true, message: t("common.required") }]}
            >
              <Input placeholder={t("educationSection.placeholder.school")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name={[field.name, "department"]}
              label={t("educationSection.field.department")}
            >
              <Input placeholder={t("educationSection.placeholder.department")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "major"]} label={t("educationSection.field.major")}>
              <Input placeholder={t("educationSection.placeholder.major")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name={[field.name, "degree"]} label={t("educationSection.field.degree")}>
              {/* `value` 是提交给后端的协议值（还要与网申表单下拉逐字匹配），只翻 label。 */}
              <Select
                allowClear
                placeholder={t("common.placeholder.select")}
                options={[
                  { value: "高中", label: t("educationSection.degree.highSchool") },
                  { value: "大专", label: t("educationSection.degree.juniorCollege") },
                  { value: "本科", label: t("educationSection.degree.bachelor") },
                  { value: "硕士", label: t("educationSection.degree.master") },
                  { value: "博士", label: t("educationSection.degree.doctor") },
                ]}
              />
            </Form.Item>
          </Col>
          {/* 网申表单把"学历"拆成三个独立下拉，这两项只在填表时用得到。 */}
          <Col xs={12} md={6}>
            <Form.Item
              name={[field.name, "study_mode"]}
              label={t("educationSection.field.studyMode")}
            >
              <Select
                allowClear
                placeholder={t("common.placeholder.select")}
                options={[
                  { value: "全日制", label: t("educationSection.studyMode.fullTime") },
                  { value: "非全日制", label: t("educationSection.studyMode.partTime") },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name={[field.name, "degree_type"]}
              label={t("educationSection.field.degreeType")}
            >
              <Select
                allowClear
                placeholder={t("common.placeholder.select")}
                options={[
                  { value: "学士", label: t("educationSection.degreeType.bachelor") },
                  { value: "硕士学位", label: t("educationSection.degreeType.master") },
                  { value: "博士学位", label: t("educationSection.degreeType.doctor") },
                  { value: "其他", label: t("educationSection.degreeType.other") },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item
              name={[field.name, "start_date"]}
              label={t("educationSection.field.startDate")}
            >
              <PartialDateSelect
                label={t("educationSection.aria.startDate", { index: field.name + 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name={[field.name, "end_date"]} label={t("educationSection.field.endDate")}>
              <PartialDateSelect
                label={t("educationSection.aria.endDate", { index: field.name + 1 })}
                allowOngoing
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "gpa"]} label={t("educationSection.field.gpa")}>
              <Input placeholder={t("educationSection.placeholder.gpa")} />
            </Form.Item>
          </Col>
          {/* 四六级分数录在这一段学历上：网申表单普遍问**具体分数**（不少系统按分数自动筛，
              只填"已通过"过不了），而成绩是这段时间考出来的。网申填表取最高学历那一条。 */}
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "cet4_score"]} label={t("educationSection.field.cet4")}>
              <Input placeholder={t("educationSection.placeholder.cet4")} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "cet6_score"]} label={t("educationSection.field.cet6")}>
              <Input placeholder={t("educationSection.placeholder.cet6")} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "courses"]} label={t("educationSection.field.courses")}>
              <Input.TextArea rows={2} placeholder={t("educationSection.placeholder.courses")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "achievements"]}
              label={t("educationSection.field.achievements")}
            >
              <Input.TextArea
                rows={2}
                placeholder={t("educationSection.placeholder.achievements")}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
