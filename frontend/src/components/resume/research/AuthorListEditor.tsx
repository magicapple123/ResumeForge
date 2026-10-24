// SPDX-License-Identifier: Apache-2.0
/**
 * 论文作者 / 专利发明人的**嵌套列表编辑器**（W14）。
 *
 * ## 为什么是嵌套 Form.List
 *
 * 作者挂在某一条论文/专利下面：表单路径是 `["publications", 0, "authors", 1, "name"]`。
 * 用 `Form.List name={[entryIndex, listKey]}` 让 antd 自己维护上下标——自己拼数组再
 * `setFieldValue` 会在删中间一位时把后面前后错位（这是本项目踩过的同类问题）。
 *
 * ## 两条语义硬约束
 *
 * 1. **顺序 = 署名顺序**：上移/下移是真实数据操作，不是视觉排序；顺序会进导出（作者顺序）。
 * 2. **本人标记不改写姓名文本**：`is_self` 是一个布尔字段，渲染层据此加粗**显示**；
 *    绝不把 `**` 写进 `name`（那会污染搜索、复制与姓名文本本身，契约 §5.9 Q3）。
 */
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Col, Form, Input, Row, Space, Tooltip } from "antd";
import EmptyState from "../../common/EmptyState";
import { rt } from "../../../features/resume-research/i18n";

interface Props {
  /** 外层条目在 Form.List 里的下标（论文/专利第几条）。 */
  entryIndex: number;
  /** 作者字段名：论文用 authors，专利用 inventors。 */
  listKey: "authors" | "inventors";
  /** 添加按钮文案（"添加作者" / "添加发明人"）。 */
  addLabel: string;
  emptyDescription: string;
}

export default function AuthorListEditor({
  entryIndex,
  listKey,
  addLabel,
  emptyDescription,
}: Props) {
  return (
    <Form.List name={[entryIndex, listKey]}>
      {(fields, operations) => (
        <div data-research-authors={listKey}>
          {fields.length === 0 ? (
            <div style={{ marginBottom: 8 }}>
              <EmptyState inline description={emptyDescription} />
            </div>
          ) : null}
          {fields.map((field, index) => (
            <Row
              key={field.key}
              gutter={8}
              align="middle"
              data-research-author={index}
              style={{ marginBottom: 6 }}
            >
              <Col xs={24} md={10}>
                <Form.Item
                  name={[field.name, "name"]}
                  label={index === 0 ? rt("research.authors.name") : undefined}
                  style={{ marginBottom: 4 }}
                >
                  <Input
                    placeholder={rt("research.authors.namePlaceholder")}
                    aria-label={rt("research.authors.name")}
                  />
                </Form.Item>
              </Col>
              <Col xs={8} md={4}>
                <Form.Item
                  name={[field.name, "is_self"]}
                  valuePropName="checked"
                  style={{ marginBottom: 4 }}
                  tooltip={rt("research.authors.selfHint")}
                >
                  <Checkbox>{rt("research.authors.self")}</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={8} md={4}>
                <Form.Item
                  name={[field.name, "corresponding"]}
                  valuePropName="checked"
                  style={{ marginBottom: 4 }}
                >
                  <Checkbox>{rt("research.authors.corresponding")}</Checkbox>
                </Form.Item>
              </Col>
              <Col xs={8} md={6}>
                <Space size={0}>
                  <Tooltip title={rt("research.list.moveUp")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowUpOutlined />}
                      aria-label={rt("research.authors.moveUpAria", { index: index + 1 })}
                      disabled={index === 0 || undefined}
                      onClick={() => operations.move(index, index - 1)}
                    />
                  </Tooltip>
                  <Tooltip title={rt("research.list.moveDown")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowDownOutlined />}
                      aria-label={rt("research.authors.moveDownAria", { index: index + 1 })}
                      disabled={index === fields.length - 1 || undefined}
                      onClick={() => operations.move(index, index + 1)}
                    />
                  </Tooltip>
                  <Tooltip title={rt("research.authors.name")}>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={rt("research.authors.removeAria", { index: index + 1 })}
                      onClick={() => operations.remove(field.name)}
                    />
                  </Tooltip>
                </Space>
              </Col>
            </Row>
          ))}
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            aria-label={addLabel}
            onClick={() => operations.add({ name: "", is_self: false, corresponding: false })}
          >
            {addLabel}
          </Button>
          <div style={{ color: "var(--rf-text-secondary)", fontSize: 12, marginTop: 4 }}>
            {rt("research.section.hint")}
          </div>
        </div>
      )}
    </Form.List>
  );
}
