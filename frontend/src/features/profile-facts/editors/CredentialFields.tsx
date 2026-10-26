// SPDX-License-Identifier: Apache-2.0
/**
 * 资格证照编辑字段（payload 见契约 §3.1 credential）。
 *
 * 证号（credential_number）是本地私密字段：输入框用 `Input.Password`，旁边常驻一句
 * 「默认不发送给 AI、不印到简历」的说明——用户要能一眼确认它不会被带出去，而不是
 * 只在文档里承诺。字段设置里被隐藏的字段不渲染（旧值由服务端保留）。
 */
import { Col, Form, Input, Row } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { CREDENTIAL_STATUS_OPTIONS } from "../constants";
import { isFieldHidden, translateOptions, type HiddenFields } from "./fieldHelpers";
import {
  FactDateField,
  FactSelectField,
  FactTextAreaField,
  FactTextField,
  FactUrlField,
} from "./fields";

interface Props {
  hiddenFields: HiddenFields;
}

export default function CredentialFields({ hiddenFields }: Props) {
  useLocale();
  const statusOptions = translateOptions(CREDENTIAL_STATUS_OPTIONS);
  const hidden = (key: string) => isFieldHidden(hiddenFields, key);
  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          {hidden("name") ? null : (
            <FactTextField
              name="name"
              labelKey="profileFacts.credential.name"
              placeholderKey="profileFacts.credential.namePlaceholder"
              requiredMessageKey="research.required.name"
              maxLength={128}
            />
          )}
        </Col>
        <Col xs={24} md={10}>
          {hidden("issuer") ? null : (
            <FactTextField
              name="issuer"
              labelKey="profileFacts.credential.issuer"
              placeholderKey="profileFacts.credential.issuerPlaceholder"
              maxLength={256}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={7}>
          {hidden("issue_date") ? null : (
            <FactDateField name="issue_date" labelKey="profileFacts.credential.issueDate" />
          )}
        </Col>
        <Col xs={24} md={7}>
          {hidden("expiry_date") ? null : (
            <FactDateField name="expiry_date" labelKey="profileFacts.credential.expiryDate" />
          )}
        </Col>
        <Col xs={24} md={10}>
          {hidden("status") ? null : (
            <FactSelectField
              name="status"
              labelKey="profileFacts.credential.status"
              options={statusOptions}
              extra={t("profileFacts.credential.statusHint")}
            />
          )}
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={10}>
          {hidden("credential_number") ? null : (
            <Form.Item
              name="credential_number"
              label={t("profileFacts.credential.number")}
              extra={t("profileFacts.credential.numberHint")}
            >
              <Input.Password
                autoComplete="off"
                maxLength={128}
                placeholder={t("profileFacts.credential.numberPlaceholder")}
              />
            </Form.Item>
          )}
        </Col>
        <Col xs={24} md={14}>
          {hidden("verify_url") ? null : (
            <FactUrlField name="verify_url" labelKey="profileFacts.credential.verifyUrl" />
          )}
        </Col>
      </Row>
      {hidden("note") ? null : (
        <FactTextAreaField
          name="note"
          labelKey="profileFacts.credential.note"
          maxLength={2000}
          rows={2}
        />
      )}
    </>
  );
}
