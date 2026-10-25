// SPDX-License-Identifier: Apache-2.0
/** 培训与课程编辑字段（payload 见契约 §1 training）。 */
import { Col, Row } from "antd";
import { FactDateField, FactTextAreaField, FactTextField } from "./fields";
import { isFieldHidden, type HiddenFields } from "./fieldHelpers";

interface Props {
  hiddenFields: HiddenFields;
}

export default function TrainingFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          {hidden("name") ? null : (
            <FactTextField
              name="name"
              labelKey="profileFacts.training.name"
              placeholderKey="profileFacts.training.namePlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={256}
            />
          )}
        </Col>
        <Col xs={24} md={10}>
          {hidden("organization") ? null : (
            <FactTextField
              name="organization"
              labelKey="profileFacts.training.organization"
              maxLength={256}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          {hidden("start_date") ? null : (
            <FactDateField name="start_date" labelKey="profileFacts.training.start" />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("end_date") ? null : (
            <FactDateField name="end_date" labelKey="profileFacts.training.end" allowOngoing />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("hours") ? null : (
            <FactTextField
              name="hours"
              labelKey="profileFacts.training.hours"
              placeholderKey="profileFacts.training.hoursPlaceholder"
              maxLength={32}
            />
          )}
        </Col>
      </Row>
      {hidden("description") ? null : (
        <FactTextAreaField
          name="description"
          labelKey="profileFacts.training.description"
          placeholderKey="profileFacts.training.descriptionPlaceholder"
          rows={3}
        />
      )}
      {hidden("outcomes") ? null : (
        <FactTextAreaField
          name="outcomes"
          labelKey="profileFacts.training.outcomes"
          placeholderKey="profileFacts.training.outcomesPlaceholder"
          rows={3}
        />
      )}
    </>
  );
}
