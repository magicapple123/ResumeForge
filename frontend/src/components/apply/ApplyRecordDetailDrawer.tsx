/**
 * 投递记录详情抽屉（纯展示子组件，PR-18 拆分批从 ApplyRecordsPanel 纯搬迁）：
 * 展示单条记录的完整快照（岗位、简历、招呼语、结果、失败分类与失败信息、时间、批次）。
 * `record` 为 null 时抽屉关闭；打开/关闭由主组件 state 驱动，这里只渲染。
 */
import { Descriptions, Drawer } from "antd";
import { TASK_ITEM_STATUS_META, failureLabel, type ApplyRecord } from "../../types";
import { formatDateTime } from "../../utils/format";

interface Props {
  record: ApplyRecord | null;
  onClose: () => void;
}

export default function ApplyRecordDetailDrawer({ record, onClose }: Props) {
  return (
    <Drawer
      title="投递记录详情"
      placement="right"
      size={480}
      open={record !== null}
      onClose={onClose}
      destroyOnHidden
    >
      {record && (
        <Descriptions column={1} bordered size="small" colon>
          <Descriptions.Item label="岗位">
            {record.job_title || "（岗位已删除）"}
            {record.company ? ` · ${record.company}` : ""}
          </Descriptions.Item>
          <Descriptions.Item label="简历">{record.resume_title || "-"}</Descriptions.Item>
          <Descriptions.Item label="招呼语">
            {record.greeting || "（默认招呼语）"}
          </Descriptions.Item>
          <Descriptions.Item label="结果">
            {TASK_ITEM_STATUS_META[record.status].label}
          </Descriptions.Item>
          <Descriptions.Item label="失败分类">
            {record.failure_category
              ? failureLabel(record.failure_category, record.failure_label)
              : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="失败信息（含页面 URL / 标题）">
            {record.failure_detail || "-"}
          </Descriptions.Item>
          <Descriptions.Item label="时间">
            {formatDateTime(record.finished_at || record.created_at)}
          </Descriptions.Item>
          <Descriptions.Item label="任务 / 批次">
            {`批次 #${record.task_id} · 第 ${record.attempt} 次尝试`}
          </Descriptions.Item>
        </Descriptions>
      )}
    </Drawer>
  );
}
