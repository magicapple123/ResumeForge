/**
 * 岗位广场批量操作条：选择模式下的清空/批量设置状态/批量删除。
 * （自 JobsPage 拆出：:489-537 整块逐字随迁；applyBatchStatus/removeSelectedJobs
 * 经 prop 直通页面 handler，零 api 导入。）
 */
import { CheckOutlined, ClearOutlined, DeleteOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Select, Space, Tooltip, Typography } from "antd";
import type { BatchAction } from "./jobFilterOptions";
import { STATUS_OPTIONS } from "./jobFilterOptions";

export function BatchToolbar({
  selectionMode,
  selectedJobIds,
  setSelectedJobIds,
  batchAction,
  batchStatus,
  setBatchStatus,
  applyBatchStatus,
  enqueueSelectedJobs,
  removeSelectedJobs,
}: {
  selectionMode: boolean;
  selectedJobIds: number[];
  setSelectedJobIds: (value: number[]) => void;
  batchAction: BatchAction;
  batchStatus: string | undefined;
  setBatchStatus: (value: string | undefined) => void;
  applyBatchStatus: () => Promise<void>;
  enqueueSelectedJobs: () => Promise<void>;
  removeSelectedJobs: () => Promise<void>;
}) {
  if (!selectionMode) return null;
  return (
    <Space style={{ marginBottom: 12, minHeight: 32 }} wrap>
      <Typography.Text type="secondary">已选 {selectedJobIds.length} 个岗位</Typography.Text>
      <Button
        icon={<ClearOutlined />}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        onClick={() => {
          setSelectedJobIds([]);
          setBatchStatus(undefined);
        }}
      >
        清空选择
      </Button>
      <Select
        placeholder="批量设置状态"
        value={batchStatus}
        options={STATUS_OPTIONS}
        style={{ width: 150 }}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        onChange={setBatchStatus}
      />
      <Button
        icon={<CheckOutlined />}
        disabled={selectedJobIds.length === 0 || !batchStatus || batchAction !== null}
        loading={batchAction === "status"}
        onClick={() => void applyBatchStatus()}
      >
        应用状态
      </Button>
      {/* 海投效率路径：批量直接入队。Tooltip 必须说清两件看不见的事——双确认会被
          一并带上（不逐条弹窗）、来源不支持的岗位会静默跳过，否则用户只看到"少进去了几个"。 */}
      <Tooltip title="海投路径：直接加入投递队列（未分析/真实缺口不再逐条弹确认）；来源不支持的岗位自动跳过并在结果中说明">
        <Button
          icon={<SendOutlined />}
          disabled={selectedJobIds.length === 0 || batchAction !== null}
          loading={batchAction === "enqueue"}
          onClick={() => void enqueueSelectedJobs()}
        >
          加入投递队列
        </Button>
      </Tooltip>
      <Popconfirm
        title={`确定删除选中的 ${selectedJobIds.length} 个岗位？`}
        description="将移入回收站，可随时恢复"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        disabled={selectedJobIds.length === 0 || batchAction !== null}
        onConfirm={() => removeSelectedJobs()}
      >
        <Button
          danger
          icon={<DeleteOutlined />}
          disabled={selectedJobIds.length === 0 || batchAction !== null}
          loading={batchAction === "delete"}
        >
          批量删除
        </Button>
      </Popconfirm>
    </Space>
  );
}
