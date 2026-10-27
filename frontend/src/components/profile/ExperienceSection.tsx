// SPDX-License-Identifier: Apache-2.0
/** 实习/工作经历分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd";
import PartialDateSelect from "./PartialDateSelect";
import ProfileSection from "./ProfileSection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editable: boolean;
}

export function ExperienceSection({ editable }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <ProfileSection
      fieldName="experiences"
      editable={editable}
      emptyValue={{
        company: "",
        role: "",
        start_date: "",
        end_date: "",
        description: "",
      }}
      itemLabel={(item, index) => {
        const company = String(item.company ?? "").trim();
        const role = String(item.role ?? "").trim();
        return (
          [company, role].filter(Boolean).join(" · ") ||
          t("profileUi.experience.itemLabel", { index: index + 1 })
        );
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} md={7}>
            <Form.Item
              name={[field.name, "company"]}
              label={t("profileUi.experience.field.company")}
              rules={[{ required: true, message: t("common.required") }]}
            >
              <Input placeholder={t("profileUi.experience.placeholder.company")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name={[field.name, "role"]} label={t("profileUi.experience.field.role")}>
              <Input placeholder={t("profileUi.experience.placeholder.role")} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name={[field.name, "start_date"]} label={t("profileUi.field.start")}>
              <PartialDateSelect
                label={t("profileUi.experience.startDateAria", { index: field.name + 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name={[field.name, "end_date"]} label={t("profileUi.field.end")}>
              <PartialDateSelect
                label={t("profileUi.experience.endDateAria", { index: field.name + 1 })}
                allowOngoing
              />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              name={[field.name, "description"]}
              label={t("profileUi.experience.field.description")}
            >
              <Input.TextArea
                rows={4}
                placeholder={t("profileUi.experience.placeholder.description")}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
