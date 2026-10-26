// SPDX-License-Identifier: Apache-2.0
/** 简历微调表单的「基本信息」标签页（从 `ResumeEditorModal` 按区块拆出，纯搬运）。
 *
 *  字段集合、顺序、栅格断点与占位符全部照搬原实现——DOM 结构与文案都不变，
 *  既有测试（`ResumeEditorModal.test.tsx` 按 label 定位）不受影响。
 *  F10：当前方案里隐藏的字段不显示（仍有值的保留，见 `useEditorFieldVisibility`）。
 */
import { ImportOutlined } from "@ant-design/icons";
import { Button, Form, Input, Row, Space, Tooltip } from "antd";
import EditorFieldCol from "../resume-editor/EditorFieldCol";
import { useEditorFieldVisibility } from "../resume-editor/editorSchemaContext";

interface Props {
  /** 「个人总结」的候选值（来自「我的资料」）；空串 = 不渲染「从我的资料填入」按钮。 */
  summarySource: string;
  /** 把 `summarySource` 写进「个人总结」栏。写入的是表单值，仍要点保存才算改过简历。 */
  onFillSummary: () => void;
}

export default function ResumeBasicInfoTab({ summarySource, onFillSummary }: Props) {
  // basic_info 与 summary 都落在「基本信息」页签，可见字段取两者并集。
  const visible = useEditorFieldVisibility("basic_info", "summary");
  return (
    <Row gutter={12}>
      <EditorFieldCol xs={24} md={8} show={visible.show("name")}>
        <Form.Item name="name" label="姓名">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={12} md={8} show={visible.show("gender")}>
        <Form.Item name="gender" label="性别">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={12} md={8} show={visible.show("birth_year")}>
        <Form.Item name="birth_year" label="出生年份">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={24} md={8} show={visible.show("phone")}>
        <Form.Item name="phone" label="手机">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={24} md={8} show={visible.show("email")}>
        <Form.Item name="email" label="邮箱">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={24} md={8} show={visible.show("city")}>
        <Form.Item name="city" label="所在城市">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={24} md={8} show={visible.show("github")}>
        <Form.Item name="github" label="GitHub 主页">
          <Input placeholder="https://github.com/用户名" />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol xs={24} md={8} show={visible.show("personal_website")}>
        <Form.Item name="personal_website" label="个人主页">
          <Input placeholder="https://example.com" />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol span={24} show={visible.show("job_intent")}>
        <Form.Item name="job_intent" label="求职意向">
          <Input />
        </Form.Item>
      </EditorFieldCol>
      <EditorFieldCol span={24} show={visible.show("summary")}>
        <Form.Item name="summary" label="个人总结">
          <Input.TextArea rows={5} />
        </Form.Item>
        {summarySource && (
          <Space size={6} style={{ marginTop: -8, marginBottom: 12 }}>
            <Tooltip title="把「我的资料」里的个人总结写到这一栏（会覆盖当前内容，可再用撤销前的原文改回）">
              <Button size="small" icon={<ImportOutlined />} onClick={onFillSummary}>
                从我的资料填入个人总结
              </Button>
            </Tooltip>
          </Space>
        )}
      </EditorFieldCol>
    </Row>
  );
}
