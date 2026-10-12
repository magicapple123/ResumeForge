/**
 * 备选岗位的批量选择工具条：全选本页、已选计数与批量导入/删除/清空/退出多选。
 *
 * 从 CandidateJobsDrawer 拆出（RF-08 文件行数预算）：纯受控展示组件，状态与动作
 * 全部由抽屉传入。服务端分页后选择集只作用于当前页——「全选本页」与范围文案就在
 * 这里向用户写清楚（§2.5 规则 4：本页/全部不得含糊）。
 */
import { Checkbox, Button, Space, Typography } from "antd";

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
}: Props) {
  return (
    <Space wrap style={{ marginTop: 8, marginBottom: 12 }}>
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        disabled={batchAction !== null}
        onChange={(event) => onToggleAll(event.target.checked)}
      >
        全选本页
      </Checkbox>
      <Typography.Text type="secondary">
        已选 {selectedCount} 条（当前页共 {pageCount} 条）
      </Typography.Text>
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
