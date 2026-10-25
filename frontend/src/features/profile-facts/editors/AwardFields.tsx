// SPDX-License-Identifier: Apache-2.0
/** 荣誉与获奖编辑字段（payload 见契约 §1 award）。 */
import { Col, Row } from "antd";
import { FactDateField, FactTextAreaField, FactTextField } from "./fields";
import { isFieldHidden, type HiddenFields } from "./fieldHelpers";

interface Props {
  hiddenFields: HiddenFields;
}

export default function AwardFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          {hidden("name") ? null : (
            <FactTextField
              name="name"
              labelKey="profileFacts.award.name"
              placeholderKey="profileFacts.award.namePlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={256}
            />
          )}
        </Col>
        <Col xs={24} md={10}>
          {hidden("issuer") ? null : (
            <FactTextField name="issuer" labelKey="profileFacts.award.issuer" maxLength={256} />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={8}>
          {hidden("date") ? null : <FactDateField name="date" labelKey="profileFacts.award.date" />}
        </Col>
        <Col xs={12} md={16}>
          {hidden("level") ? null : (
            <FactTextField
              name="level"
              labelKey="profileFacts.award.level"
              placeholderKey="profileFacts.award.levelPlaceholder"
              maxLength={64}
            />
          )}
        </Col>
      </Row>
      {hidden("description") ? null : (
        <FactTextAreaField
          name="description"
          labelKey="profileFacts.award.description"
          maxLength={2000}
          rows={3}
        />
      )}
    </>
  );
}
