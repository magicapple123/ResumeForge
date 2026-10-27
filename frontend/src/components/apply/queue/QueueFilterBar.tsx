// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列的筛选与工具栏：状态/准入两个筛选、计数、全选与清空、批量移出、刷新、开始投递。
 * （自 ApplyQueuePanel 拆出：DOM、类名、Tootip/Popconfirm 文案与按钮顺序逐字随迁，
 * 状态仍由面板持有，这里只受控展示并回调。）
 *
 * 两个下拉的选项在渲染期由 filterOptions.ts 构建（展示名走语言包，`value` 仍是协议值），
 * 本组件只迁工具栏自己的文案；移出确认与详情抽屉共用同一条后果正文，避免两处措辞分叉。
 */
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Select, Space, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { QueueStatus } from "../../../types";
import {
  admissionFilterOptions,
  statusFilterOptions,
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
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后工具栏停在旧文案。
  useLocale();
  return (
    <div className="apply-queue-head">
      <Space wrap>
        <Select
          allowClear
          placeholder={t("applyQueue.filter.byStatus")}
          style={{ width: 128 }}
          value={statusFilter}
          onChange={(value) => onStatusChange(value as QueueStatus | undefined)}
          options={statusFilterOptions()}
          aria-label={t("applyQueue.filter.byStatus")}
        />
        <Select
          allowClear
          placeholder={t("applyQueue.filter.byAdmission")}
          style={{ width: 128 }}
          value={admissionFilter}
          onChange={(value) => onAdmissionChange(value as AdmissionFilterValue | undefined)}
          options={admissionFilterOptions()}
          aria-label={t("applyQueue.filter.byAdmission")}
        />
        <Typography.Text type="secondary">
          {filterActive
            ? t("applyQueue.filter.countFiltered", {
                total: queueTotal,
                shown: filteredCount,
                selected: selectedCount,
              })
            : t("applyQueue.filter.count", { total: queueTotal, selected: selectedCount })}
        </Typography.Text>
        <Tooltip title={t("applyQueue.filter.selectAllHint")}>
          <Button disabled={busy || selectableCount === 0} onClick={onSelectAll}>
            {t("applyQueue.filter.selectAll")}
          </Button>
        </Tooltip>
        <Button disabled={busy || selectedCount === 0} onClick={onClearSelection}>
          {t("applyQueue.filter.clearSelection")}
        </Button>
        <Popconfirm
          // 标题只留动作 + 对象：加数量会顶到「弹窗标题 ≤12 字」上限（§1.5），而选中几条
          // 在工具栏「已选 N 个」里就写着；后果与可逆性进正文（§4.4 三段式）。
          title={t("applyQueue.confirm.removeSelectedTitle")}
          description={t("applyQueue.confirm.removeBody")}
          okText={t("applyQueue.action.removeShort")}
          cancelText={t("common.action.cancel")}
          okButtonProps={{ danger: true }}
          disabled={busy || selectedCount === 0 || batchRemoving}
          onConfirm={onRemoveSelected}
        >
          <Button danger disabled={busy || selectedCount === 0} loading={batchRemoving}>
            {t("applyQueue.action.removeSelected")}
          </Button>
        </Popconfirm>
        {/* loading 直接挂 reload 的请求态：本地接口虽快，转圈一闪也是「点到了」的确认
            （此前点击毫无反馈，用户会以为没点上而连点好几次）。 */}
        <Button icon={<ReloadOutlined />} loading={loading} onClick={onReload}>
          {t("common.action.refresh")}
        </Button>
      </Space>
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        loading={busy}
        disabled={startDisabled}
        onClick={onStart}
      >
        {t("applyQueue.action.start")}
      </Button>
    </div>
  );
}
