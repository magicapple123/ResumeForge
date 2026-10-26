// SPDX-License-Identifier: Apache-2.0
/**
 * 实践 / 服务经历编辑字段（payload 见契约 §3.1 practice）。
 *
 * 「机构或客户」是中性称谓：志愿服务、兼职、合同项目、自雇客户都能用同一个字段，
 * 不会把客户强行写成"雇主"。关系类型只有用户显式选择时才记录。
 */
import { Col, Row } from "antd";
import { useLocale } from "../../../i18n/i18nContext";
import { PRACTICE_KIND_OPTIONS } from "../constants";
import { isFieldHidden, translateOptions, type HiddenFields } from "./fieldHelpers";
import { FactDateField, FactSelectField, FactTextAreaField, FactTextField } from "./fields";

interface Props {
  hiddenFields: HiddenFields;
}

export default function PracticeFields({ hiddenFields }: Props) {
  useLocale();
  const kindOptions = translateOptions(PRACTICE_KIND_OPTIONS);
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          {hidden("organization") ? null : (
            <FactTextField
              name="organization"
              labelKey="profileFacts.practice.organization"
              placeholderKey="profileFacts.practice.organizationPlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={128}
            />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("role") ? null : (
            <FactTextField
              name="role"
              labelKey="profileFacts.practice.role"
              placeholderKey="profileFacts.practice.rolePlaceholder"
              maxLength={128}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          {hidden("start_date") ? null : (
            <FactDateField name="start_date" labelKey="profileFacts.practice.start" />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("end_date") ? null : (
            <FactDateField name="end_date" labelKey="profileFacts.practice.end" allowOngoing />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("experience_kind") ? null : (
            <FactSelectField
              name="experience_kind"
              labelKey="profileFacts.practice.kind"
              options={kindOptions}
            />
          )}
        </Col>
      </Row>
      {hidden("description") ? null : (
        <FactTextAreaField
          name="description"
          labelKey="profileFacts.practice.description"
          placeholderKey="profileFacts.practice.descriptionPlaceholder"
          rows={4}
        />
      )}
    </>
  );
}
