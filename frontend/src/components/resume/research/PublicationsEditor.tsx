// SPDX-License-Identifier: Apache-2.0
/**
 * 「论文发表」编辑页（W14 / P2-02）：题目、作者顺序与本人标记、期刊会议、年份、发表状态、DOI/URL。
 *
 * ## 三条产品口径（都来自契约 §5）
 *
 * 1. **状态准确**：下拉项只有 published/accepted/in_press/under_review/preprint/other 六个值，
 *    文案严格区分「已发表」与「在投」——AI 与界面都不许把在投提升成已发表。
 * 2. **作者顺序 = 署名顺序**：顺序编辑在 `AuthorListEditor`，本页只把它放进条目里。
 * 3. **DOI/URL 只在合法时变链接**：见 `UrlPreview`，非法值原样保留在字段里、不静默清空。
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
  PUBLICATION_STATUSES,
  emptyPublication,
  publicationStatusKey,
} from "../../../features/resume-research/researchFields";

const LABEL = rt("research.tab.publications");

const STATUS_OPTIONS = PUBLICATION_STATUSES.map((status) => ({
  value: status,
  label: rt(publicationStatusKey(status)),
}));

export default function PublicationsEditor() {
  const visible = useEditorFieldVisibility("publications");
  return (
    <ResearchListSection
      name="publications"
      label={LABEL}
      emptyDescription={rt("research.empty.publications")}
      addLabel={rt("research.list.add", { label: LABEL })}
      makeEmpty={emptyPublication}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol span={24} show={visible.show("title")}>
            <Form.Item
              name={[field.name, "title"]}
              label={rt("research.publications.title")}
              rules={
                visible.show("title")
                  ? [{ required: true, message: rt("research.required.title") }]
                  : undefined
              }
            >
              <Input placeholder={rt("research.publications.titlePlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("authors")}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{rt("research.authors.label")}</div>
            <AuthorListEditor
              entryIndex={field.name}
              listKey="authors"
              addLabel={rt("research.authors.add")}
              emptyDescription={rt("research.authors.empty")}
            />
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("venue")}>
            <Form.Item name={[field.name, "venue"]} label={rt("research.publications.venue")}>
              <Input placeholder={rt("research.publications.venuePlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("year")}>
            <Form.Item name={[field.name, "year"]} label={rt("research.publications.year")}>
              <Input placeholder={rt("research.publications.yearPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("status")}>
            <Form.Item
              name={[field.name, "status"]}
              label={rt("research.publications.status")}
              tooltip={rt("research.status.hint")}
            >
              <Select options={STATUS_OPTIONS} aria-label={rt("research.publications.status")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("doi")}>
            <Form.Item name={[field.name, "doi"]} label={rt("research.publications.doi")}>
              <Input placeholder={rt("research.publications.doiPlaceholder")} />
            </Form.Item>
            <UrlPreview path={["publications", field.name, "doi"]} kind="doi" />
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("url")}>
            <Form.Item name={[field.name, "url"]} label={rt("research.publications.url")}>
              <Input placeholder={rt("research.publications.urlPlaceholder")} />
            </Form.Item>
            <UrlPreview path={["publications", field.name, "url"]} kind="url" />
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("volume_pages")}>
            <Form.Item
              name={[field.name, "volume_pages"]}
              label={rt("research.publications.volumePages")}
            >
              <Input placeholder={rt("research.publications.volumePagesPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("outcome_type")}>
            <Form.Item
              name={[field.name, "outcome_type"]}
              label={rt("research.publications.outcomeType")}
            >
              <Input placeholder={rt("research.publications.outcomeTypePlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("my_rank")}>
            <Form.Item name={[field.name, "my_rank"]} label={rt("research.publications.myRank")}>
              <Input placeholder={rt("research.publications.myRankPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("note")}>
            <Form.Item name={[field.name, "note"]} label={rt("research.publications.note")}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResearchListSection>
  );
}
