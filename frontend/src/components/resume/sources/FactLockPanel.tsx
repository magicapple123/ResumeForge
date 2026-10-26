// SPDX-License-Identifier: Apache-2.0
/**
 * 事实锁面板（W12）：锁定姓名/机构/时间/数字/职责边界，并在 AI 想改时给出解释。
 *
 * **锁的是 AI 行为，不是用户的手**（契约 §3）：界面文案必须说清这一点，否则用户会以为
 * "锁定后自己也不能改"。冲突提示（409 fact_lock_conflict）由宿主把业务码传进来，
 * 面板只负责把它翻译成"发生了什么 + 怎么办"。
 */
import { DeleteOutlined, LockOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Form, Input, Row, Select, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import EmptyState from "../../common/EmptyState";
import { pt } from "../../../features/resume-provenance/i18n";
import { factLockKindKey } from "../../../features/resume-provenance/helpers";
import {
  FACT_LOCK_KINDS,
  type FactLockCreateRequest,
  type FactLockKind,
  type FactLockOut,
  type FactLockViolationOut,
} from "../../../features/resume-provenance/types";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  locks: FactLockOut[];
  /** 当前选中对象的定位（新建锁时带上；没有选中时禁用新建）。 */
  selection?: {
    object_id?: string | null;
    point_id?: string | null;
    path?: string | null;
    label?: string;
  };
  loading?: boolean;
  saving?: boolean;
  /** 冲突业务码：`fact_lock_conflict` 时给出专门说明。 */
  conflictCode?: string | null;
  /** 逐条违规（`factLockViolationsFromError(err)` 的结果）；有值就逐条展示。 */
  violations?: FactLockViolationOut[];
  onCreate?: (payload: FactLockCreateRequest) => void;
  onDelete?: (lock: FactLockOut) => void;
}

export default function FactLockPanel({
  locks,
  selection,
  loading = false,
  saving = false,
  conflictCode = null,
  violations = [],
  onCreate,
  onDelete,
}: Props) {
  useLocale();
  const kindOptions = FACT_LOCK_KINDS.map((kind) => ({
    value: kind,
    label: pt(factLockKindKey(kind) ?? "provenance.lock.kind.number"),
  }));
  const readOnly = !onCreate;
  const hasTarget = Boolean(selection?.object_id || selection?.point_id || selection?.path);

  const columns: TableColumnsType<FactLockOut> = [
    {
      title: pt("provenance.lock.kind"),
      dataIndex: "kind",
      width: 110,
      render: (kind: string) => {
        const key = factLockKindKey(kind);
        return <Tag icon={<LockOutlined />}>{key ? pt(key) : kind}</Tag>;
      },
    },
    {
      title: pt("provenance.lock.value"),
      dataIndex: "locked_value",
      ellipsis: true,
    },
    {
      title: pt("provenance.lock.label"),
      dataIndex: "label",
      ellipsis: true,
    },
    {
      title: "",
      key: "actions",
      width: 60,
      render: (_value, lock) =>
        onDelete ? (
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label={pt("provenance.lock.remove")}
            onClick={() => onDelete(lock)}
          />
        ) : null,
    },
  ];

  const handleCreate = (values: { kind: FactLockKind; label: string }) => {
    if (!onCreate || !selection) return;
    onCreate({
      kind: values.kind,
      object_id: selection.object_id ?? null,
      point_id: selection.point_id ?? null,
      path: selection.path ?? null,
      label: values.label ?? "",
    });
  };

  return (
    <div data-fact-locks="1">
      <Space size={6} align="center" style={{ marginBottom: 6 }} wrap>
        <Typography.Text strong>{pt("provenance.lock.title")}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pt("provenance.lock.hint")}
        </Typography.Text>
      </Space>

      {conflictCode === "fact_lock_conflict" ? (
        violations.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            title={pt("provenance.lock.violations")}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {violations.map((violation) => {
                  const kindKey = factLockKindKey(violation.kind);
                  const label = violation.label || (kindKey ? pt(kindKey) : violation.kind);
                  return (
                    <li key={violation.lock_id + ":" + violation.field}>
                      <Typography.Text>
                        {pt("provenance.lock.violationLine", {
                          label,
                          locked: violation.locked_value,
                          current: violation.current_value,
                        })}
                      </Typography.Text>
                      <div style={{ fontSize: 12, color: "var(--rf-text-secondary)" }}>
                        {pt("provenance.lock.violationReason", { reason: violation.reason })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            }
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 8 }}
            title={pt("provenance.lock.conflict")}
            description={pt("provenance.lock.conflict.hint")}
          />
        )
      ) : null}

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={locks}
        pagination={false}
        locale={{ emptyText: <EmptyState inline description={pt("provenance.lock.empty")} /> }}
      />

      {readOnly ? null : (
        <Form
          layout="vertical"
          style={{ marginTop: 8 }}
          onFinish={handleCreate}
          initialValues={{ kind: "name", label: "" }}
        >
          <Row gutter={8} align="bottom">
            <Col xs={24} md={8}>
              <Form.Item
                name="kind"
                label={pt("provenance.lock.kind")}
                rules={[{ required: true }]}
              >
                <Select options={kindOptions} aria-label={pt("provenance.lock.kind")} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="label" label={pt("provenance.lock.label")}>
                <Input aria-label={pt("provenance.lock.label")} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item>
                <Button
                  type="dashed"
                  htmlType="submit"
                  loading={saving}
                  disabled={!hasTarget || undefined}
                  icon={<LockOutlined />}
                  aria-label={pt("provenance.lock.add")}
                >
                  {pt("provenance.lock.add")}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      )}
    </div>
  );
}
