// SPDX-License-Identifier: Apache-2.0
/**
 * 语言能力编辑器（2026-10 起独立成栏）。
 *
 * 用户反馈：「我的资料里的语言能力在制作台变成了专业技能」。根因是旧投影把语言压成一条
 * `skills` 记录；现在正文有独立的 `content.languages` 分区，本组件按资料页五个字段
 * 渲染成固定表单，页签名与资料页一致（「语言能力」）。
 *
 * 字段可见性走编辑器视图（当前方案里隐藏的字段不渲染；正文里已有值的字段仍保留）。
 */
import { Form, Input, Row } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EditorFieldCol from "./EditorFieldCol";
import ResumeListSection from "./ResumeListSection";
import { useEditorFieldVisibility } from "./editorSchemaContext";

export default function LanguageEditor() {
  useLocale();
  const visible = useEditorFieldVisibility("languages");
  return (
    <ResumeListSection
      title={t("editor.section.languages")}
      name="languages"
      // 任务 #9：语言能力也是多条目板块，每条都能从资料填入。
      fillSection="languages"
      emptyValue={{ name: "", level: "", certificate: "", score: "", obtained_at: "" }}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol xs={24} md={8} show={visible.show("name")}>
            <Form.Item
              name={[field.name, "name"]}
              label={t("editor.field.language")}
              rules={
                visible.show("name")
                  ? [{ required: true, message: t("editor.required.language") }]
                  : undefined
              }
            >
              <Input placeholder={t("editor.placeholder.language")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("level")}>
            <Form.Item name={[field.name, "level"]} label={t("editor.field.languageLevel")}>
              <Input placeholder={t("editor.placeholder.languageLevel")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("certificate")}>
            <Form.Item
              name={[field.name, "certificate"]}
              label={t("editor.field.languageCertificate")}
            >
              <Input placeholder={t("editor.placeholder.languageCertificate")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("score")}>
            <Form.Item name={[field.name, "score"]} label={t("editor.field.languageScore")}>
              <Input placeholder={t("editor.placeholder.languageScore")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("obtained_at")}>
            <Form.Item
              name={[field.name, "obtained_at"]}
              label={t("editor.field.languageObtained")}
            >
              <Input placeholder={t("editor.placeholder.languageObtained")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResumeListSection>
  );
}
