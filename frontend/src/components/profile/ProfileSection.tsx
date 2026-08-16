/** 资料分区容器：卡片 + 动态列表 + 增删行，各分区共用。 */
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Form } from "antd";
import type { FormListFieldData, FormListOperation } from "antd/es/form/FormList";
import type { ReactNode } from "react";

interface Props {
  title: string;
  /** 表单字段名（对应 profile 的 educations/experiences/...） */
  fieldName: string;
  /** 新增一行的默认值 */
  emptyValue: Record<string, string>;
  /** 行渲染函数 */
  renderRow: (field: FormListFieldData, remove: FormListOperation["remove"]) => ReactNode;
}

export default function ProfileSection({ title, fieldName, emptyValue, renderRow }: Props) {
  return (
    <Card size="small" title={title} style={{ marginBottom: 16 }}>
      <Form.List name={fieldName}>
        {(fields, { add, remove }) => (
          <>
            {fields.map((field) => (
              <div
                key={field.key}
                style={{
                  position: "relative",
                  border: "1px solid #f0f0f0",
                  borderRadius: 8,
                  padding: "16px 40px 4px 16px",
                  marginBottom: 12,
                  background: "#fafafa",
                }}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ position: "absolute", top: 8, right: 8 }}
                  onClick={() => remove(field.name)}
                />
                {renderRow(field, remove)}
              </div>
            ))}
            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => add({ ...emptyValue })}
            >
              添加一条
            </Button>
          </>
        )}
      </Form.List>
    </Card>
  );
}
