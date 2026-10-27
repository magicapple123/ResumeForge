// SPDX-License-Identifier: Apache-2.0
/** 项目经历分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd";
import PartialDateSelect from "./PartialDateSelect";
import ProfileSection from "./ProfileSection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editable: boolean;
}

export function ProjectSection({ editable }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <ProfileSection
      fieldName="projects"
      editable={editable}
      emptyValue={{
        name: "",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: "",
        description: "",
        highlights: "",
      }}
      itemLabel={(item, index) => {
        const name = String(item.name ?? "").trim();
        const role = String(item.role ?? "").trim();
        return (
          [name, role].filter(Boolean).join(" · ") ||
          t("profileUi.project.itemLabel", { index: index + 1 })
        );
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} md={7}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("profileUi.project.field.name")}
              rules={[{ required: true, message: t("common.required") }]}
            >
              <Input placeholder={t("profileUi.project.placeholder.name")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name={[field.name, "role"]} label={t("profileUi.project.field.role")}>
              <Input placeholder={t("profileUi.project.placeholder.role")} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name={[field.name, "start_date"]} label={t("profileUi.field.start")}>
              <PartialDateSelect
                label={t("profileUi.project.startDateAria", { index: field.name + 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name={[field.name, "end_date"]} label={t("profileUi.field.end")}>
              <PartialDateSelect
                label={t("profileUi.project.endDateAria", { index: field.name + 1 })}
                allowOngoing
              />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              name={[field.name, "tech_stack"]}
              label={t("profileUi.project.field.techStack")}
            >
              <Input placeholder={t("profileUi.project.placeholder.techStack")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "description"]}
              label={t("profileUi.project.field.description")}
            >
              <Input.TextArea
                rows={3}
                placeholder={t("profileUi.project.placeholder.description")}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "highlights"]}
              label={t("profileUi.project.field.highlights")}
            >
              <Input.TextArea
                rows={3}
                placeholder={t("profileUi.project.placeholder.highlights")}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
