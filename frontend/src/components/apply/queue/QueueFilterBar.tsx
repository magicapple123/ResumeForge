// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列的筛选与工具栏：状态/准入两个筛选、计数、全选与清空、批量移出、刷新、开始投递。
 * （自 ApplyQueuePanel 拆出：DOM、类名、Tootip/Popconfirm 文案与按钮顺序逐字随迁，
 * 状态仍由面板持有，这里只受控展示并回调。）
 */
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Select, Space, Tooltip, Typography } from "antd";
import type { QueueStatus } from "../../../types";
import {
  ADMISSION_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type AdmissionFilterValue,
} from "./filterOptions";

export function QueueFilterBar({
  statusFilter,
  onStatusChange,
  admissionFilter,
  onAdmissionChange,
  queueTotal,
  filteredCount,
  filterActive,
  selectedCount,
  selectableCount,
  busy,
  batchRemoving,
  loading,
  onSelectAll,
  onClearSelection,
  onRemoveSelected,
  onReload,
  startDisabled,
  onStart,
}: {
  statusFilter: QueueStatus | undefined;
  onStatusChange: (value: QueueStatus | undefined) => void;
  admissionFilter: AdmissionFilterValue | undefined;
  onAdmissionChange: (value: AdmissionFilterValue | undefined) => void;
  queueTotal: number;
  /** 筛选生效时表格里实际显示多少条。 */
  filteredCount: number;
  filterActive: boolean;
  selectedCount: number;
  /** 「全选队列」会勾上的条数（当前筛选结果里可投的那些）。 */
  selectableCount: number;
  busy: boolean;
  batchRemoving: boolean;
  loading: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRemoveSelected: () => void;
  onReload: () => void;
  /** 有任务在跑：禁止重复开始。 */
  startDisabled: boolean;
  onStart: () => void;
}) {
  return (
    <div className="apply-queue-head">
      <Space wrap>
        <Select
          allowClear
          placeholder="按状态筛选"
          style={{ width: 128 }}
          value={statusFilter}
          onChange={(value) => onStatusChange(value as QueueStatus | undefined)}
          options={STATUS_FILTER_OPTIONS}
          aria-label="按状态筛选"
        />
        <Select
          allowClear
          placeholder="按准入筛选"
          style={{ width: 128 }}
          value={admissionFilter}
          onChange={(value) => onAdmissionChange(value as AdmissionFilterValue | undefined)}
          options={ADMISSION_FILTER_OPTIONS}
          aria-label="按准入筛选"
        />
        <Typography.Text type="secondary">
          共 {queueTotal} 个岗位
          {filterActive ? `，筛选出 ${filteredCount} 个` : ""}，已选 {selectedCount} 个
        </Typography.Text>
        <Tooltip title="勾选当前列表里的全部可投岗位（跨页生效）；不勾选则整队列按顺序投递">
          <Button disabled={busy || selectableCount === 0} onClick={onSelectAll}>
            全选队列
          </Button>
        </Tooltip>
        <Button disabled={busy || selectedCount === 0} onClick={onClearSelection}>
          清空选择
        </Button>
        <Popconfirm
          // 标题只留动作 + 对象：加数量会顶到「弹窗标题 ≤12 字」上限（§1.5），而选中几条
          // 在工具栏「已选 N 个」里就写着；后果与可逆性进正文（§4.4 三段式）。
          title="把选中的岗位移出队列？"
          description="只是从队列里拿掉，岗位与投递记录都不会被删除。"
          okText="移出"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          disabled={busy || selectedCount === 0 || batchRemoving}
          onConfirm={onRemoveSelected}
        >
          <Button danger disabled={busy || selectedCount === 0} loading={batchRemoving}>
            移出所选
          </Button>
        </Popconfirm>
        {/* loading 直接挂 reload 的请求态：本地接口虽快，转圈一闪也是「点到了」的确认
            （此前点击毫无反馈，用户会以为没点上而连点好几次）。 */}
        <Button icon={<ReloadOutlined />} loading={loading} onClick={onReload}>
          刷新
        </Button>
      </Space>
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        loading={busy}
        disabled={startDisabled}
        onClick={onStart}
      >
        开始投递
      </Button>
    </div>
  );
}
