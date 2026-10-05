/**
 * 岗位广场批量操作条：选择模式下的清空/批量设置状态/批量删除。
 * （自 JobsPage 拆出：:489-537 整块逐字随迁；applyBatchStatus/removeSelectedJobs
 * 经 prop 直通页面 handler，零 api 导入。）
 */
import { CheckOutlined, ClearOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Select, Space, Typography } from "antd";
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
  removeSelectedJobs,
}: {
  selectionMode: boolean;
  selectedJobIds: number[];
  setSelectedJobIds: (value: number[]) => void;
  batchAction: BatchAction;
  batchStatus: string | undefined;
  setBatchStatus: (value: string | undefined) => void;
  applyBatchStatus: () => Promise<void>;
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
