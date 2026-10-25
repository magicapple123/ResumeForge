// SPDX-License-Identifier: Apache-2.0
/**
 * 作品项目编辑字段（payload 见契约 §3.1 work_project）。
 *
 * 内部键仍是 `tech_stack`，界面按普通用户口径叫「工具与方法」（计划 §3.3）——
 * 改文案不改契约键，导出与候选映射仍读同一个字段。
 */
import { Col, Row } from "antd";
import { isFieldHidden, type HiddenFields } from "./fieldHelpers";
import { FactDateField, FactTextAreaField, FactTextField, FactUrlField } from "./fields";

interface Props {
  hiddenFields: HiddenFields;
}

export default function WorkProjectFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          {hidden("name") ? null : (
            <FactTextField
              name="name"
              labelKey="profileFacts.workProject.name"
              placeholderKey="profileFacts.workProject.namePlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={128}
            />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("role") ? null : (
            <FactTextField
              name="role"
              labelKey="profileFacts.workProject.role"
              placeholderKey="profileFacts.workProject.rolePlaceholder"
              maxLength={128}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          {hidden("start_date") ? null : (
            <FactDateField name="start_date" labelKey="profileFacts.workProject.start" />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("end_date") ? null : (
            <FactDateField name="end_date" labelKey="profileFacts.workProject.end" allowOngoing />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("artifact_type") ? null : (
            <FactTextField
              name="artifact_type"
              labelKey="profileFacts.workProject.artifactType"
              placeholderKey="profileFacts.workProject.artifactTypePlaceholder"
              maxLength={64}
            />
          )}
        </Col>
      </Row>
      {hidden("tech_stack") ? null : (
        <FactTextAreaField
          name="tech_stack"
          labelKey="profileFacts.workProject.techStack"
          placeholderKey="profileFacts.workProject.techStackPlaceholder"
          maxLength={2000}
          rows={2}
        />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          {hidden("description") ? null : (
            <FactTextAreaField
              name="description"
              labelKey="profileFacts.workProject.description"
              placeholderKey="profileFacts.workProject.descriptionPlaceholder"
              rows={3}
            />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("highlights") ? null : (
            <FactTextAreaField
              name="highlights"
              labelKey="profileFacts.workProject.highlights"
              placeholderKey="profileFacts.workProject.highlightsPlaceholder"
              rows={3}
            />
          )}
        </Col>
      </Row>
      {hidden("public_url") ? null : (
        <FactUrlField
          name="public_url"
          labelKey="profileFacts.workProject.publicUrl"
          placeholderKey="profileFacts.workProject.publicUrlPlaceholder"
        />
      )}
    </>
  );
}
