// SPDX-License-Identifier: Apache-2.0
/** 荣誉奖项分区。 */
import { Col, Form, Input, Row } from "antd";
import type { FormListFieldData } from "antd";
import PartialDateSelect from "./PartialDateSelect";
import ProfileSection from "./ProfileSection";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  editable: boolean;
}

export function AwardSection({ editable }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <ProfileSection
      fieldName="awards"
      editable={editable}
      emptyValue={{ name: "", date: "", description: "" }}
      itemLabel={(item, index) => {
        const name = String(item.name ?? "").trim();
        const date = String(item.date ?? "").trim();
        return (
          [name, date].filter(Boolean).join(" · ") ||
          t("profileUi.award.itemLabel", { index: index + 1 })
        );
      }}
      renderRow={(field: FormListFieldData) => (
        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("profileUi.award.field.name")}
              rules={[{ required: true, message: t("common.required") }]}
            >
              <Input placeholder={t("profileUi.award.placeholder.name")} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Form.Item name={[field.name, "date"]} label={t("profileUi.award.field.date")}>
              <PartialDateSelect label={t("profileUi.award.dateAria", { index: field.name + 1 })} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={16} md={8}>
            <Form.Item
              name={[field.name, "description"]}
              label={t("profileUi.award.field.description")}
            >
              <Input placeholder={t("profileUi.award.placeholder.description")} />
            </Form.Item>
          </Col>
        </Row>
      )}
    />
  );
}
