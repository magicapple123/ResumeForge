/**
 * 备选岗位的批量选择工具条：全选本页 / 全选全部、已选计数、导出 CSV 与批量导入/删除/清空/退出多选。
 *
 * 从 CandidateJobsDrawer 拆出（RF-08 文件行数预算）：纯受控展示组件，状态与动作
 * 全部由抽屉传入。服务端分页后选择集只作用于当前页——「全选本页」与范围文案就在
 * 这里向用户写清楚（§2.5 规则 4：本页/全部不得含糊）；「全选全部岗位」跨页勾选
 * 当前筛选下的全部候选（上限由抽屉裁决）。
 */
import { Checkbox, Button, Space, Tooltip, Typography } from "antd";

interface Props {
  /** 当前页条数 > 0 时才渲染（调用方控制）。 */
  selectedCount: number;
  /** 当前页条目数：写进范围文案。 */
  pageCount: number;
  allSelected: boolean;
  someSelected: boolean;
  /** 待处理的选中条数（批量导入只对这些生效）。 */
  pendingSelectedCount: number;
  selecting: boolean;
  batchAction: "import" | "delete" | null;
  onToggleAll: (checked: boolean) => void;
  onImport: () => void;
  onDelete: () => void;
  onClear: () => void;
  onExit: () => void;
  /** 当前筛选下全部候选数：>0 且传了 onSelectAllPages 时显示「全选全部岗位」。 */
  totalCount?: number;
  selectAllPagesLoading?: boolean;
  /** 一键全选所有页（跨页）；未传时不渲染该入口。 */
  onSelectAllPages?: () => void;
  /** 勾选了条目时显示「导出 CSV」。 */
  exporting?: boolean;
  onExportCsv?: () => void;
}

export default function CandidateBatchToolbar({
  selectedCount,
  pageCount,
  allSelected,
  someSelected,
  pendingSelectedCount,
  selecting,
  batchAction,
  onToggleAll,
  onImport,
  onDelete,
  onClear,
  onExit,
  totalCount = 0,
  selectAllPagesLoading = false,
  onSelectAllPages,
  exporting = false,
  onExportCsv,
}: Props) {
  return (
    <Space wrap size={4} style={{ marginTop: 8, marginBottom: 12 }}>
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        disabled={batchAction !== null}
        onChange={(event) => onToggleAll(event.target.checked)}
      >
        全选本页
      </Checkbox>
      <Typography.Text type="secondary">
        已选 {selectedCount} / {totalCount > 0 ? totalCount : pageCount} 条
      </Typography.Text>
      {onSelectAllPages && totalCount > 0 && (
        <Tooltip title={`按当前筛选，一键选中全部 ${totalCount} 条候选（跨页，不止当前页）`}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            disabled={batchAction !== null}
            loading={selectAllPagesLoading}
            onClick={onSelectAllPages}
          >
            全选全部
          </Button>
        </Tooltip>
      )}
      {onExportCsv && someSelected && (
        <Button
          size="small"
          disabled={batchAction !== null}
          loading={exporting}
          onClick={onExportCsv}
        >
          导出 CSV
        </Button>
      )}
      {/* R8：批量导入/批量删除只在多选模式渲染；入口在卡片右键菜单的「批量选择」。 */}
      {selecting && (
        <>
          <Button
            size="small"
            disabled={pendingSelectedCount === 0 || batchAction !== null}
            loading={batchAction === "import"}
            onClick={onImport}
          >
            批量导入
          </Button>
          <Button
            size="small"
            danger
            disabled={selectedCount === 0 || batchAction !== null}
            loading={batchAction === "delete"}
            onClick={onDelete}
          >
            批量删除
          </Button>
          <Button
            size="small"
            disabled={selectedCount === 0 || batchAction !== null}
            onClick={onClear}
          >
            清空选择
          </Button>
          <Button size="small" disabled={batchAction !== null} onClick={onExit}>
            退出多选
          </Button>
        </>
      )}
    </Space>
  );
}
