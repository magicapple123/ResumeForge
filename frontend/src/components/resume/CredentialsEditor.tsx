// SPDX-License-Identifier: Apache-2.0
/**
 * 证书资质编辑槽（F4 §5.6 / A4；R-70 起栏目名由「资格证照」改为「证书资质」）。
 *
 * 三条口径：
 * - **没有证号字段**：后端 schema 刻意不声明 `credential_number`（私密值不进纸面/导出），
 *   这里也不给输入框，避免"填了却永远不出现"；
 * - 状态是**用户自填的事实锁**（unknown/pending/active/expired），系统不自动认定；
 * - `id` 隐藏保留：旧记录里已有的稳定身份不能被一次保存抹掉。
 * F10：当前方案里隐藏的字段不显示（仍有值的保留）。
 */
import { Col, Form, Input, Row, Select } from "antd";
import { t } from "../../i18n";
import ResumeListSection from "../resume-editor/ResumeListSection";
import EditorFieldCol from "../resume-editor/EditorFieldCol";
import { useEditorFieldVisibility } from "../resume-editor/editorSchemaContext";

const STATUS_OPTIONS = [
  { value: "unknown", label: t("credentials.credentialStatus.unknown") },
  { value: "pending", label: t("credentials.credentialStatus.pending") },
  { value: "active", label: t("credentials.credentialStatus.active") },
  { value: "expired", label: t("credentials.credentialStatus.expired") },
];

export default function CredentialsEditor() {
  const visible = useEditorFieldVisibility("credentials");
  return (
    <ResumeListSection
      title={t("editor.tab.credentials")}
      name="credentials"
      emptyValue={{
        name: "",
        issuer: "",
        credential_type: "",
        issue_date: "",
        expiry_date: "",
        status: "unknown",
        verify_url: "",
        note: "",
      }}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol xs={24} md={9} show={visible.show("name")}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("credentials.credential.name")}
              rules={
                visible.show("name")
                  ? [{ required: true, message: t("editor.credentials.name-required") }]
                  : undefined
              }
            >
              <Input maxLength={128} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={9} show={visible.show("issuer")}>
            <Form.Item name={[field.name, "issuer"]} label={t("credentials.credential.issuer")}>
              <Input maxLength={256} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={9} show={visible.show("credential_type")}>
            <Form.Item
              name={[field.name, "credential_type"]}
              label={t("credentials.credential.credentialType")}
            >
              <Input
                maxLength={128}
                placeholder={t("credentials.credential.credentialTypePlaceholder")}
              />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={6} show={visible.show("status")}>
            <Form.Item name={[field.name, "status"]} label={t("credentials.credential.status")}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={5} show={visible.show("issue_date")}>
            <Form.Item
              name={[field.name, "issue_date"]}
              label={t("credentials.credential.issueDate")}
            >
              <Input maxLength={32} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={5} show={visible.show("expiry_date")}>
            <Form.Item
              name={[field.name, "expiry_date"]}
              label={t("credentials.credential.expiryDate")}
            >
              <Input maxLength={32} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={14} show={visible.show("verify_url")}>
            <Form.Item
              name={[field.name, "verify_url"]}
              label={t("credentials.credential.verifyUrl")}
            >
              <Input maxLength={256} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("note")}>
            <Form.Item name={[field.name, "note"]} label={t("credentials.credential.note")}>
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
          </EditorFieldCol>
          <Col span={0}>
            <Form.Item name={[field.name, "id"]} hidden>
              <Input />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResumeListSection>
  );
}
