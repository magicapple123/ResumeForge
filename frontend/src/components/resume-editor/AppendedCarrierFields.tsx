// SPDX-License-Identifier: Apache-2.0
/**
 * 系统板块里**用户自定义字段**的输入框（需求 #5，2026-10-27）。
 *
 * 用户在「我的资料 → 项目经历」等系统板块加了自定义字段后，新建简历/编辑器里也要能填。
 * 后端 `_editor_section` 已把这些字段放进 `EditorSectionOut.fields`（`resume_attr` 为 null
 * ——它们没有 ResumeContent 的独立槽位），并在板块上给了承载区元数据
 * （`carrier_attr` / `carrier_list`）：纸面投影会把它们的值以「标签：值」追加到承载区
 * （`_build_entry` 的 extras）。本组件把输入框**直接绑定到承载区同一路径**，读写规则见
 * `carrierFieldValue.ts`——值只有一处、保存两次不会重复、清空即删行。
 *
 * 三条边界：
 * 1. 只在有方案视图（`editor_schema`）时渲染；旧冻结快照没有承载区元数据 → 不渲染，
 *    行为与改动前逐字一致（已有字段仍可通过承载区正文框看到/编辑）；
 * 2. 只渲染**承载区存在**的板块（仅素材板块如知识产权没有承载区，值本就不上纸面）；
 * 3. 标签用 Form.Item 的 label（与系统字段同一套栅格），输入框额外带 aria-label：
 *    承载区按名字被两个 Form.Item 共用（正文框 + 这些字段），DOM id 只能有一个，
 *    所以这里给每个字段自己的 id，读屏/测试靠 aria-label 精确定位到它。
 */
import { Form, Input, Row } from "antd";
import { memo } from "react";
import type { EditorFieldOut, EditorSectionOut } from "../../features/profile-library/types";
import { useLocale } from "../../i18n/i18nContext";
import EditorFieldCol from "./EditorFieldCol";
import { readCarrierField, writeCarrierField } from "./carrierFieldValue";
import { useEditorSchemaSections } from "./editorSchemaContext";

/** 与自建板块「标签：值」行同一个长度上限（ResumeCustomLine.value 也是 2000）。 */
const FIELD_VALUE_MAX = 2000;

/** 本分区里「没有独立槽位、以承载区标签行上纸」的可见字段（自定义字段等）。 */
function appendedFieldsOf(section: EditorSectionOut | undefined): EditorFieldOut[] {
  if (!section?.carrier_attr) return [];
  return section.fields.filter((field) => field.resume_attr === null);
}

function CarrierFieldItem({
  entryName,
  field,
  carrierAttr,
  carrierList,
}: {
  /** 条目在 Form.List 里的下标。 */
  entryName: number;
  field: EditorFieldOut;
  carrierAttr: string;
  carrierList: boolean;
}) {
  useLocale();
  const controlId = `resume-carrier-${entryName}-${carrierAttr}-${field.key}`;
  const control =
    field.field_type === "multi_line" ? (
      <Input.TextArea
        id={controlId}
        aria-label={field.label}
        rows={3}
        maxLength={FIELD_VALUE_MAX}
      />
    ) : (
      <Input id={controlId} aria-label={field.label} maxLength={FIELD_VALUE_MAX} />
    );
  return (
    <Form.Item
      name={[entryName, carrierAttr]}
      label={field.label}
      getValueProps={(value) => ({ value: readCarrierField(value, field.label) })}
      normalize={(value, prevValue) =>
        writeCarrierField(prevValue, field.label, String(value ?? ""), carrierList)
      }
    >
      {control}
    </Form.Item>
  );
}

interface Props {
  /** 正文数组字段名（education / projects / …）：在编辑器视图里对应 `resume_field`。 */
  sectionField: string;
  /** 条目在 Form.List 里的下标。 */
  entryName: number;
}

function AppendedCarrierFields({ sectionField, entryName }: Props) {
  useLocale();
  const sections = useEditorSchemaSections();
  const section = sections.find((item) => item.resume_field === sectionField);
  const fields = appendedFieldsOf(section);
  if (!section?.carrier_attr || fields.length === 0) return null;
  const carrierAttr = section.carrier_attr;
  const carrierList = Boolean(section.carrier_list);
  return (
    <Row gutter={12}>
      {fields.map((field) => (
        <EditorFieldCol
          key={field.field_id}
          xs={24}
          md={field.field_type === "multi_line" ? 24 : 12}
        >
          <CarrierFieldItem
            entryName={entryName}
            field={field}
            carrierAttr={carrierAttr}
            carrierList={carrierList}
          />
        </EditorFieldCol>
      ))}
    </Row>
  );
}

/**
 * 默认导出 memo 化：Form.List 每次值变化都会重跑渲染函数，本组件只依赖「板块字段名 +
 * 第几条」两个稳定入参；值本身由内部共享同一路径的 Form.Item 自己订阅（需求 #12）。
 */
export default memo(AppendedCarrierFields);
