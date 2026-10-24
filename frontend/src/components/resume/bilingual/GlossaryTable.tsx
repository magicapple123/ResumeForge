// SPDX-License-Identifier: Apache-2.0
/**
 * 术语表（W16）：用户指定"这个词固定译成那个词"，并可为每条上锁。
 *
 * ## 删除语义
 *
 * 术语表进回收站（Wave3 §2.2），所以删除是**软删 + 可恢复**：组件只发 `onDeleteTerm`，
 * 由宿主执行软删并给 5 秒撤销（AGENTS 删除口径：能恢复的直接执行，不前置确认弹窗）。
 *
 * ## 表单
 *
 * 组件内部有 `Form`（新增术语），但**没有弹层**——`popupGuard` 只约束"同一文件里既有表单又有弹层"，
 * 这里是页内表单，不受限；提交中禁用由宿主传入的 `saving` 控制。
 */
import { DeleteOutlined, LockOutlined, PlusOutlined, UnlockOutlined } from "@ant-design/icons";
import {
  Button,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { bt } from "../../../features/resume-bilingual/i18n";
import {
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type GlossaryTerm,
} from "../../../features/resume-bilingual/types";

interface Props {
  terms: GlossaryTerm[];
  /** 新增或更新（锁开关也走这里）；不传 = 只读。 */
  onSaveTerm?: (term: GlossaryTerm) => void;
  /** 软删（宿主负责 Toaster 撤销与恢复）。 */
  onDeleteTerm?: (term: GlossaryTerm) => void;
  saving?: boolean;
}

function categoryLabel(category: GlossaryCategory): string {
  return bt(("bilingual.glossary.category." + category) as Parameters<typeof bt>[0]);
}

const CATEGORY_OPTIONS = GLOSSARY_CATEGORIES.map((category) => ({
  value: category,
  label: categoryLabel(category),
}));

export default function GlossaryTable({ terms, onSaveTerm, onDeleteTerm, saving = false }: Props) {
  const readOnly = !onSaveTerm;
  const [form] = Form.useForm<{
    source_term: string;
    target_term: string;
    category: GlossaryCategory;
    locked: boolean;
    note: string;
  }>();

  const handleAdd = async () => {
    if (!onSaveTerm) return;
    const values = await form.validateFields();
    onSaveTerm({
      id: 0,
      source_term: values.source_term.trim(),
      target_term: values.target_term.trim(),
      language_from: "zh-CN",
      language_to: "en-US",
      category: values.category,
      locked: values.locked ?? true,
      note: (values.note ?? "").trim(),
    });
    form.resetFields();
  };

  const columns: TableColumnsType<GlossaryTerm> = [
    {
      title: bt("bilingual.glossary.source"),
      dataIndex: "source_term",
      render: (value: string) => <Typography.Text>{value}</Typography.Text>,
    },
    {
      title: bt("bilingual.glossary.category"),
      dataIndex: "category",
      width: 110,
      render: (value: GlossaryCategory) => categoryLabel(value),
    },
    {
      title: bt("bilingual.glossary.target"),
      dataIndex: "target_term",
    },
    {
      title: bt("bilingual.glossary.locked"),
      dataIndex: "locked",
      width: 90,
      render: (value: boolean, term) => (
        <Tooltip title={bt("bilingual.glossary.lockedHint")}>
          <Switch
            size="small"
            checked={value}
            disabled={readOnly || saving || undefined}
            checkedChildren={<LockOutlined />}
            unCheckedChildren={<UnlockOutlined />}
            aria-label={bt("bilingual.glossary.locked")}
            onChange={(checked) => onSaveTerm?.({ ...term, locked: checked })}
          />
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 60,
      render: (_value, term) =>
        onDeleteTerm ? (
          <Tooltip title={bt("bilingual.glossary.delete")}>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={bt("bilingual.glossary.delete")}
              onClick={() => onDeleteTerm(term)}
            />
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <div data-glossary-table="1">
      <Space size={8} align="center" style={{ marginBottom: 6 }}>
        <Typography.Text strong>{bt("bilingual.glossary.title")}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bt("bilingual.glossary.hint")}
        </Typography.Text>
      </Space>
      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={terms}
        pagination={false}
        locale={{ emptyText: bt("bilingual.glossary.empty") }}
      />
      {readOnly ? null : (
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={8} align="bottom">
            <Col xs={24} md={6}>
              <Form.Item
                name="source_term"
                label={bt("bilingual.glossary.source")}
                rules={[{ required: true, message: bt("bilingual.glossary.required") }]}
              >
                <Input aria-label={bt("bilingual.glossary.source")} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item
                name="target_term"
                label={bt("bilingual.glossary.target")}
                rules={[{ required: true, message: bt("bilingual.glossary.required") }]}
              >
                <Input aria-label={bt("bilingual.glossary.target")} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item
                name="category"
                label={bt("bilingual.glossary.category")}
                initialValue="term"
              >
                <Select options={CATEGORY_OPTIONS} aria-label={bt("bilingual.glossary.category")} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item
                name="locked"
                label={bt("bilingual.glossary.locked")}
                valuePropName="checked"
                initialValue={true}
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item name="note" label={bt("bilingual.glossary.note")}>
                <Input aria-label={bt("bilingual.glossary.note")} />
              </Form.Item>
            </Col>
          </Row>
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            loading={saving}
            aria-label={bt("bilingual.glossary.add")}
            onClick={() => void handleAdd()}
          >
            {bt("bilingual.glossary.save")}
          </Button>
        </Form>
      )}
    </div>
  );
}
