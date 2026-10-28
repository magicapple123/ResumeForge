// SPDX-License-Identifier: Apache-2.0
/**
 * 「科研项目」编辑页（W14 / P2-02）：项目名称、本人角色、实验室/机构、周期、基金、描述与成果。
 *
 * 描述/成果是**多行文本 ↔ 字符串数组**的既有转换（复用 `resumeFieldUtils.multilineItemProps`），
 * 与教育/经历的"每行一项"完全同一套行为——不做第二种换行语义。
 * F10：当前方案里隐藏的字段不显示（仍有值的保留）。
 */
import { Form, Input, Row } from "antd";
import { useLocale } from "../../../i18n/i18nContext";
import ResearchListSection from "./ResearchListSection";
import EditorFieldCol from "../../resume-editor/EditorFieldCol";
import { useEditorFieldVisibility } from "../../resume-editor/editorSchemaContext";
import { multilineItemProps } from "../../resume-editor/resumeFieldUtils";
import { useCarrierDisplayProps } from "../../resume-editor/carrierDisplay";
import { rt } from "../../../features/resume-research/i18n";
import { emptyResearchProject } from "../../../features/resume-research/researchFields";

const LABEL = "research.tab.projects";

export default function ResearchProjectsEditor() {
  useLocale();
  const label = rt(LABEL);
  const visible = useEditorFieldVisibility("research_projects");
  // 任务 #8：承载区是 description（列表），自定义字段行只在自己的输入框里显示。
  const carrierProps = useCarrierDisplayProps("research_projects", true);
  return (
    <ResearchListSection
      name="research_projects"
      label={label}
      emptyDescription={rt("research.empty.projects")}
      addLabel={rt("research.list.add", { label })}
      makeEmpty={emptyResearchProject}
    >
      {(field) => (
        <Row gutter={12}>
          <EditorFieldCol xs={24} md={12} show={visible.show("name")}>
            <Form.Item
              name={[field.name, "name"]}
              label={rt("research.projects.name")}
              rules={
                visible.show("name")
                  ? [{ required: true, message: rt("research.required.name") }]
                  : undefined
              }
            >
              <Input placeholder={rt("research.projects.namePlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("role")}>
            <Form.Item name={[field.name, "role"]} label={rt("research.projects.role")}>
              <Input placeholder={rt("research.projects.rolePlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("organization")}>
            <Form.Item
              name={[field.name, "organization"]}
              label={rt("research.projects.organization")}
            >
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("start_date")}>
            <Form.Item name={[field.name, "start_date"]} label={rt("research.projects.start")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("end_date")}>
            <Form.Item name={[field.name, "end_date"]} label={rt("research.projects.end")}>
              <Input />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={12} md={6} show={visible.show("level")}>
            <Form.Item name={[field.name, "level"]} label={rt("research.projects.level")}>
              <Input placeholder={rt("research.projects.levelPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol span={24} show={visible.show("funding")}>
            <Form.Item name={[field.name, "funding"]} label={rt("research.projects.funding")}>
              <Input placeholder={rt("research.projects.fundingPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("description")}>
            <Form.Item
              {...carrierProps}
              name={[field.name, "description"]}
              label={rt("research.projects.description")}
            >
              <Input.TextArea
                rows={4}
                placeholder={rt("research.projects.descriptionPlaceholder")}
              />
            </Form.Item>
          </EditorFieldCol>
          <EditorFieldCol xs={24} md={12} show={visible.show("outcomes")}>
            <Form.Item
              {...multilineItemProps}
              name={[field.name, "outcomes"]}
              label={rt("research.projects.outcomes")}
            >
              <Input.TextArea rows={4} placeholder={rt("research.projects.outcomesPlaceholder")} />
            </Form.Item>
          </EditorFieldCol>
        </Row>
      )}
    </ResearchListSection>
  );
}
