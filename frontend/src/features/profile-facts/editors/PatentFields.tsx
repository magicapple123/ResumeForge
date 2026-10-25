// SPDX-License-Identifier: Apache-2.0
/** 专利编辑字段（payload 见契约 §3.1 patent）。 */
import { Col, Row } from "antd";
import { t } from "../../../i18n";
import { PATENT_STATUS_OPTIONS } from "../constants";
import { isFieldHidden, translateOptions, type HiddenFields } from "./fieldHelpers";
import { FactDateField, FactSelectField, FactTextField, FactUrlField } from "./fields";
import PersonRows from "./PersonRows";

const STATUS_OPTIONS = translateOptions(PATENT_STATUS_OPTIONS);

interface Props {
  hiddenFields: HiddenFields;
}

export default function PatentFields({ hiddenFields }: Props) {
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      {hidden("title") ? null : (
        <FactTextField
          name="title"
          labelKey="research.patents.name"
          placeholderKey="research.patents.namePlaceholder"
          requiredMessageKey="research.required.name"
          maxLength={512}
        />
      )}
      {hidden("inventors") ? null : <PersonRows name="inventors" role="inventor" />}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          {hidden("patent_number") ? null : (
            <FactTextField
              name="patent_number"
              labelKey="research.patents.number"
              placeholderKey="research.patents.numberPlaceholder"
              maxLength={64}
              extra={t("research.patents.numberHint")}
            />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("country") ? null : (
            <FactTextField
              name="country"
              labelKey="research.patents.country"
              placeholderKey="research.patents.countryPlaceholder"
              maxLength={32}
            />
          )}
        </Col>
        <Col xs={12} md={8}>
          {hidden("status") ? null : (
            <FactSelectField
              name="status"
              labelKey="research.patents.status"
              options={STATUS_OPTIONS}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          {hidden("filed_date") ? null : (
            <FactDateField name="filed_date" labelKey="research.patents.filed" />
          )}
        </Col>
        <Col xs={12} md={6}>
          {hidden("granted_date") ? null : (
            <FactDateField name="granted_date" labelKey="research.patents.granted" />
          )}
        </Col>
        <Col xs={24} md={12}>
          {hidden("url") ? null : (
            <FactUrlField
              name="url"
              labelKey="research.patents.url"
              placeholderKey="research.patents.urlPlaceholder"
            />
          )}
        </Col>
      </Row>
    </>
  );
}
