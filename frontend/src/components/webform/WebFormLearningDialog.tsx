/**
 * 填完之后问一句：「这次填的这几项简历通里没有，要记住下次自动填吗？」
 *
 * ## 为什么是"问一句"而不是静默记下来
 *
 * 自动记一切会在两处出事：字段认错时**把错值记下来**（下次亲手填进十个表单），以及把
 * 一次性的东西（内推码、某家的申请编号）当成常用资料。所以走"先提案、你点一下才落库"——
 * 记错的成本从"污染十个表单"降到"少点一次取消"。
 *
 * 提案由**后端**算（`POST /preview` 返回的 `learning.candidates`），判据是"这个字段在
 * 库里没有值"。所以一个字段被记住之后就不再提案——这条提示不会每次填表都弹。
 *
 * 所有被记住的字段都按通用资料处理；真要反悔，去「我的资料 → 网申资料」删掉即可。
 */
import { Modal, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import type { WebFormLearningCandidate } from "../../types";

export interface LearningSelection {
  candidate: WebFormLearningCandidate;
  reuse: "general";
}

interface Props {
  open: boolean;
  candidates: WebFormLearningCandidate[];
  /** 正在写入（避免重复点）。 */
  saving: boolean;
  onCancel: () => void;
  onSubmit: (selections: LearningSelection[]) => void;
}

export default function WebFormLearningDialog({
  open,
  candidates,
  saving,
  onCancel,
  onSubmit,
}: Props) {
  // 默认全勾，用户仍可逐条取消。
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.map((item) => item.key)),
  );
  const selected = candidates.filter((item) => checked.has(item.key));

  return (
    <Modal
      open={open}
      title={`本次填的 ${candidates.length} 项简历通里没有，要记住吗？`}
      okText={`记住选中的 ${selected.length} 项`}
      cancelText="这次算了"
      okButtonProps={{ disabled: selected.length === 0 }}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => onSubmit(selected.map((candidate) => ({ candidate, reuse: "general" })))}
      width={720}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        记住之后，下次遇到同一个框会自动填。所有记住的字段都按通用资料保存，你随时可以在 「我的资料
        → 网申资料」里改掉或删掉。
      </Typography.Paragraph>
      <Table<WebFormLearningCandidate>
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={candidates}
        scroll={{ y: 320 }}
        rowSelection={{
          selectedRowKeys: [...checked],
          onChange: (keys) => setChecked(new Set(keys.map(String))),
        }}
        columns={[
          {
            title: "字段",
            dataIndex: "label",
            width: 180,
            render: (label: string, record) => (
              <Space size={4}>
                <Typography.Text>{label}</Typography.Text>
                {/* AI 认出来的必须单独标：它比规则更可能认错字段。 */}
                {record.from === "ai" ? <Tag color="purple">AI 认的</Tag> : null}
              </Space>
            ),
          },
          {
            title: "填入的值",
            dataIndex: "value",
            ellipsis: true,
            render: (value: string) => <Typography.Text>{value}</Typography.Text>,
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        已选字段会按通用资料保存，下次遇到相同类型的网申字段时自动参与匹配。
      </Typography.Paragraph>
    </Modal>
  );
}
