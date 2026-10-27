// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块**条目**的字段表单（第 8 项）：有字段定义时按定义渲染，与系统板块同一套录入方式。
 *
 * 为什么单独成文件：`CustomSectionsEditor` 已承担「页签骨架 / 增删板块 / 对齐时机」，
 * 再塞一套字段表单就会顶破 500 行预算；这里的边界是"一条 entry 长什么样"。
 *
 * 两种行：
 * - **定义字段**（`alignment.bindings`）：`Form.Item` 的 label 直接用字段定义 label，
 *   单行字段两列、多行字段整行——与 `ResumeSectionEditors.EducationEditor` 的栅格一致。
 *   `lines[j].label` 由隐藏字段钉住，保存时服务端按定义重建 label，不会串列。
 * - **定义之外的历史行**（`alignment.extraLineIndexes`）：字段被删 / 用户手加的行，
 *   仍用「标签 + 值 + 删除」渲染。**绝不丢数据**：这些行不参与字段绑定，原样存回。
 */
import { DeleteOutlined } from "@ant-design/icons";
import { Button, Form, Input, Row, Tooltip } from "antd";
import type { EditorFieldOut } from "../../features/profile-library/types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import EditorFieldCol from "./EditorFieldCol";
import type { CustomEntryAlignment } from "./customSectionAlignment";

const TEXT_MAX = 4000;
const LINE_VALUE_MAX = 2000;

/**
 * 字段控件：**必须直接返回 antd 的 Input/TextArea**，不能再用一层自定义组件包起来——
 * `Form.Item` 是靠 cloneElement 把 value/onChange/id 注入到**直属子元素**的，包一层
 * 之后这些 props 会落在包装组件上被丢掉（输入框既不受控、label 也点不到）。
 */
function fieldControl(field: EditorFieldOut, maxLength: number) {
  return field.field_type === "multi_line" ? (
    <Input.TextArea rows={3} maxLength={maxLength} />
  ) : (
    <Input maxLength={maxLength} />
  );
}

interface Props {
  /** 条目在 `Form.List` 里的下标（所有 `Form.Item` 名字的第二个片段）。 */
  entryName: number;
  alignment: CustomEntryAlignment;
  /** 删除一条**定义之外**的历史行（下标是它在 lines 里的位置）。 */
  onRemoveLine: (lineIndex: number) => void;
}

export default function CustomSectionFields({ entryName, alignment, onRemoveLine }: Props) {
  useLocale();
  const { textField, bindings, extraLineIndexes } = alignment;

  return (
    <Row gutter={12}>
      {textField ? (
        <EditorFieldCol span={24}>
          <Form.Item name={[entryName, "text"]} label={textField.label}>
            {fieldControl(textField, TEXT_MAX)}
          </Form.Item>
        </EditorFieldCol>
      ) : null}
      {bindings.map(({ field, lineIndex }) => (
        <EditorFieldCol
          key={field.field_id}
          xs={24}
          md={field.field_type === "multi_line" ? 24 : 12}
        >
          {/* label 钉死成定义 label：服务端按定义重建行，这里存一份是为了让"隐藏的
              非定义行"与"定义行"能区分开（对齐全靠 label 命中）。 */}
          <Form.Item name={[entryName, "lines", lineIndex, "label"]} hidden>
            <Input />
          </Form.Item>
          <Form.Item name={[entryName, "lines", lineIndex, "value"]} label={field.label}>
            {fieldControl(field, LINE_VALUE_MAX)}
          </Form.Item>
        </EditorFieldCol>
      ))}
      {extraLineIndexes.map((lineIndex) => (
        <EditorFieldCol key={`extra-${lineIndex}`} span={24}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Form.Item
              name={[entryName, "lines", lineIndex, "label"]}
              label={t("editor.custom-sections.label")}
              style={{ flex: "0 0 220px", marginBottom: 12 }}
            >
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item
              name={[entryName, "lines", lineIndex, "value"]}
              label={t("editor.custom-sections.value")}
              style={{ flex: "1 1 auto", marginBottom: 12 }}
            >
              <Input maxLength={LINE_VALUE_MAX} />
            </Form.Item>
            <Tooltip title={t("editor.custom-sections.remove-line")}>
              <Button
                type="text"
                danger
                aria-label={t("editor.custom-sections.remove-line")}
                icon={<DeleteOutlined />}
                onClick={() => onRemoveLine(lineIndex)}
              />
            </Tooltip>
          </div>
        </EditorFieldCol>
      ))}
    </Row>
  );
}
