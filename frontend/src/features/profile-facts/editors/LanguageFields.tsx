// SPDX-License-Identifier: Apache-2.0
/** 语言能力编辑字段（payload 见契约 §1 language）。 */
import { Col, Row } from "antd";
import { FactDateField, FactTextField } from "./fields";
import { isFieldHidden, type HiddenFields } from "./fieldHelpers";

interface Props {
  hiddenFields: HiddenFields;
}

export default function LanguageFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          {hidden("name") ? null : (
            <FactTextField
              name="name"
              labelKey="profileFacts.language.name"
              placeholderKey="profileFacts.language.namePlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={128}
            />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("level") ? null : (
            <FactTextField
              name="level"
              labelKey="profileFacts.language.level"
              placeholderKey="profileFacts.language.levelPlaceholder"
              maxLength={64}
            />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("date") ? null : (
            <FactDateField name="date" labelKey="profileFacts.language.date" />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          {hidden("certificate") ? null : (
            <FactTextField
              name="certificate"
              labelKey="profileFacts.language.certificate"
              placeholderKey="profileFacts.language.certificatePlaceholder"
              maxLength={256}
            />
          )}
        </Col>
        <Col xs={24} md={10}>
          {hidden("score") ? null : (
            <FactTextField
              name="score"
              labelKey="profileFacts.language.score"
              placeholderKey="profileFacts.language.scorePlaceholder"
              maxLength={64}
            />
          )}
        </Col>
      </Row>
    </>
  );
}
