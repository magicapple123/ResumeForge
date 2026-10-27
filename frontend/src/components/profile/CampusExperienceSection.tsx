// SPDX-License-Identifier: Apache-2.0
/** 校园经历分区：学生会、团支部、班级与社团等校内经历。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd";
import PartialDateSelect from "./PartialDateSelect";
import ProfileSection from "./ProfileSection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editable: boolean;
}

export function CampusExperienceSection({ editable }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <ProfileSection
      fieldName="campus_experiences"
      editable={editable}
      emptyValue={{
        organization: "",
        role: "",
        start_date: "",
        end_date: "",
        description: "",
      }}
      itemLabel={(item, index) => {
        const organization = String(item.organization ?? "").trim();
        const role = String(item.role ?? "").trim();
        return (
          [organization, role].filter(Boolean).join(" · ") ||
          t("profileUi.campus.itemLabel", { index: index + 1 })
        );
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} md={7}>
            <Form.Item
              name={[field.name, "organization"]}
              label={t("profileUi.campus.field.organization")}
            >
              <Input placeholder={t("profileUi.campus.placeholder.organization")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={7}>
            <Form.Item name={[field.name, "role"]} label={t("profileUi.campus.field.role")}>
              <Input placeholder={t("profileUi.campus.placeholder.role")} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item
              name={[field.name, "start_date"]}
              label={t("profileUi.campus.field.startDate")}
            >
              <PartialDateSelect
                label={t("profileUi.campus.startDateAria", { index: field.name + 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={5}>
            <Form.Item name={[field.name, "end_date"]} label={t("profileUi.campus.field.endDate")}>
              <PartialDateSelect
                label={t("profileUi.campus.endDateAria", { index: field.name + 1 })}
                allowOngoing
              />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item
              name={[field.name, "description"]}
              label={t("profileUi.campus.field.description")}
            >
              <Input.TextArea
                rows={3}
                placeholder={t("profileUi.campus.placeholder.description")}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
