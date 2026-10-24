// SPDX-License-Identifier: Apache-2.0
/**
 * 「科研项目」编辑页（W14 / P2-02）：项目名称、本人角色、实验室/机构、周期、基金、描述与成果。
 *
 * 描述/成果是**多行文本 ↔ 字符串数组**的既有转换（复用 `resumeFieldUtils.multilineItemProps`），
 * 与教育/经历的"每行一项"完全同一套行为——不做第二种换行语义。
 */
import { Col, Form, Input, Row } from "antd";
import ResearchListSection from "./ResearchListSection";
import { multilineItemProps } from "../../resume-editor/resumeFieldUtils";
import { rt } from "../../../features/resume-research/i18n";
import { emptyResearchProject } from "../../../features/resume-research/researchFields";

const LABEL = rt("research.tab.projects");

export default function ResearchProjectsEditor() {
  return (
    <ResearchListSection
      name="research_projects"
      label={LABEL}
      emptyDescription={rt("research.empty.projects")}
      addLabel={rt("research.list.add", { label: LABEL })}
      makeEmpty={emptyResearchProject}
    >
      {(field) => (
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "name"]}
              label={rt("research.projects.name")}
              rules={[{ required: true, message: rt("research.required.name") }]}
            >
              <Input placeholder={rt("research.projects.namePlaceholder")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name={[field.name, "role"]} label={rt("research.projects.role")}>
              <Input placeholder={rt("research.projects.rolePlaceholder")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name={[field.name, "organization"]}
              label={rt("research.projects.organization")}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "start_date"]} label={rt("research.projects.start")}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name={[field.name, "end_date"]} label={rt("research.projects.end")}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name={[field.name, "funding"]} label={rt("research.projects.funding")}>
              <Input placeholder={rt("research.projects.fundingPlaceholder")} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              {...multilineItemProps}
              name={[field.name, "description"]}
              label={rt("research.projects.description")}
            >
              <Input.TextArea
                rows={4}
                placeholder={rt("research.projects.descriptionPlaceholder")}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              {...multilineItemProps}
              name={[field.name, "outcomes"]}
              label={rt("research.projects.outcomes")}
            >
              <Input.TextArea rows={4} placeholder={rt("research.projects.outcomesPlaceholder")} />
            </Form.Item>
          </Col>
        </Row>
      )}
    </ResearchListSection>
  );
}
