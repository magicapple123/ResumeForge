// SPDX-License-Identifier: Apache-2.0
/**
 * 「专利」编辑页（W14 / P2-02）：专利名称、发明人顺序、专利号、国家/地区、状态、申请/授权日、链接。
 *
 * 专利号与状态都是**事实锁字段**（契约 §5.5）：界面只做原样录入与展示，不提供任何
 * "自动推成已授权"的动作；状态文案与后端枚举一一对应（审查中 ≠ 已授权）。
 * F10：当前方案里隐藏的字段不显示（仍有值的保留）。
 */
import { Form, Input, Row, Select } from "antd";
import AuthorListEditor from "./AuthorListEditor";
import ResearchListSection from "./ResearchListSection";
import UrlPreview from "./UrlPreview";
import EditorFieldCol from "../../resume-editor/EditorFieldCol";
import { useEditorFieldVisibility } from "../../resume-editor/editorSchemaContext";
import { rt } from "../../../features/resume-research/i18n";
import {
  PATENT_STATUSES,
  emptyPatent,
  patentStatusKey,
} from "../../../features/resume-research/researchFields";

const LABEL = rt("research.tab.patents");

const STATUS_OPTIONS = PATENT_STATUSES.map((status) => ({
  value: status,
  label: rt(patentStatusKey(status)),
}));

export default function PatentsEditor() {
  const visible = useEditorFieldVisibility("patents");
  return (
    <ResearchListSection
      name="patents"
      label={LABEL}
      emptyDescription={rt("research.empty.patents")}
      addLabel={rt("research.list.add", { label: LABEL })}
      makeEmpty={emptyPatent}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol span={24} show={visible.show("title")}>
            <Form.Item
              name={[field.name, "title"]}
              label={rt("research.patents.name")}
              rules={
                visible.show("title")
                  ? [{ required: true, message: rt("research.required.name") }]
                  : undefined
              }
            >
              <Input placeholder={rt("research.patents.namePlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("inventors")}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{rt("research.inventors.label")}</div>
            <AuthorListEditor
              entryIndex={field.name}
              listKey="inventors"
              addLabel={rt("research.inventors.add")}
              emptyDescription={rt("research.inventors.empty")}
            />
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("patent_number")}>
            <Form.Item
              name={[field.name, "patent_number"]}
              label={rt("research.patents.number")}
              tooltip={rt("research.patents.numberHint")}
            >
              <Input placeholder={rt("research.patents.numberPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("country")}>
            <Form.Item name={[field.name, "country"]} label={rt("research.patents.country")}>
              <Input placeholder={rt("research.patents.countryPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={8} show={visible.show("status")}>
            <Form.Item
              name={[field.name, "status"]}
              label={rt("research.patents.status")}
              tooltip={rt("research.status.hint")}
            >
              <Select options={STATUS_OPTIONS} aria-label={rt("research.patents.status")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("filed_date")}>
            <Form.Item name={[field.name, "filed_date"]} label={rt("research.patents.filed")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("granted_date")}>
            <Form.Item name={[field.name, "granted_date"]} label={rt("research.patents.granted")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("url")}>
            <Form.Item name={[field.name, "url"]} label={rt("research.patents.url")}>
              <Input placeholder={rt("research.patents.urlPlaceholder")} />
            </Form.Item>
            <UrlPreview path={["patents", field.name, "url"]} kind="url" />
          </EditorFieldCol>
        </Row>
      )}
    </ResearchListSection>
  );
}
