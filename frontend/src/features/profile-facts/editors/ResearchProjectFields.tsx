// SPDX-License-Identifier: Apache-2.0
/** 科研项目编辑字段（payload 见契约 §3.1 research_project）。 */
import { Col, Row } from "antd";
import { FactDateField, FactTextAreaField, FactTextField } from "./fields";
import { isFieldHidden, type HiddenFields } from "./fieldHelpers";

interface Props {
  hiddenFields: HiddenFields;
}

export default function ResearchProjectFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          {hidden("name") ? null : (
            <FactTextField
              name="name"
              labelKey="research.projects.name"
              placeholderKey="research.projects.namePlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={256}
            />
          )}
        </Col>
        <Col xs={24} md={10}>
          {hidden("role") ? null : (
            <FactTextField
              name="role"
              labelKey="research.projects.role"
              placeholderKey="research.projects.rolePlaceholder"
              maxLength={128}
            />
          )}
        </Col>
      </Row>
      {hidden("organization") ? null : (
        <FactTextField
          name="organization"
          labelKey="research.projects.organization"
          maxLength={256}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          {hidden("start_date") ? null : (
            <FactDateField name="start_date" labelKey="research.projects.start" />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("end_date") ? null : (
            <FactDateField name="end_date" labelKey="research.projects.end" allowOngoing />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("funding") ? null : (
            <FactTextField
              name="funding"
              labelKey="research.projects.funding"
              placeholderKey="research.projects.fundingPlaceholder"
              maxLength={256}
            />
          )}
        </Col>
      </Row>
      {hidden("description") ? null : (
        <FactTextAreaField
          name="description"
          labelKey="research.projects.description"
          placeholderKey="research.projects.descriptionPlaceholder"
          rows={4}
        />
      )}
      {hidden("outcomes") ? null : (
        <FactTextAreaField
          name="outcomes"
          labelKey="research.projects.outcomes"
          placeholderKey="research.projects.outcomesPlaceholder"
          rows={3}
        />
      )}
    </>
  );
}
