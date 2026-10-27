// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位的批量选择工具条：按「选择区 / 批量操作区 / 退出区」三组排列。
 *
 * 从 CandidateJobsDrawer 拆出（RF-08 文件行数预算）：纯受控展示组件，状态与动作
 * 全部由抽屉传入。选择集可以跨页（「全选全部」）：勾选框三态与「全选本页」的范围
 * 文案都按「本页」口径写清楚（§2.5 规则 4：本页/全部不得含糊）；「全选全部岗位」
 * 跨页勾选当前筛选下的全部候选（上限由抽屉裁决），翻页不丢（产品决策）。
 *
 * 分组布局（用户反馈一行太挤）：选择区（勾选框 + 计数 + 全选全部）→ 批量操作区
 * （导出 CSV、批量删除、清空选择）→ 退出区（退出多选）。组间用大间距而不是
 * 分隔线：Space wrap 换行时竖直分隔线会孤零零挂在行首。
 *
 * 显隐规则（用户三轮反馈的最终口径）：整套工具栏只在多选模式渲染（入口=卡片右键
 * 「批量选择」，抽屉控制）；进入多选立即显示批量操作区，未选中时按钮禁用而不是
 * 藏掉；退出多选后整组消失。批量导入入口已移除（产品决策）。
 *
 * 批量删除的二次确认留在**这里**（就地 `Popconfirm`），因为它必须在抽屉之中、又不能是
 * 第二层容器：抽屉(1) + `modal.confirm`(1) 就是 §3.7 禁止的叠层，Popover 不占容器层。
 */
import { Checkbox, Button, Popconfirm, Space, Tooltip, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** 当前页条数 > 0 时才渲染（调用方控制）。 */
  selectedCount: number;
  /** 当前页条目数：写进范围文案。 */
  pageCount: number;
  /** 本页是否全部选中（勾选框 checked 的口径是「本页」）。 */
  allSelected: boolean;
  /** 本页是否部分选中（勾选框 indeterminate 的口径是「本页」）。 */
  someSelected: boolean;
  selecting: boolean;
  batchAction: "import" | "delete" | null;
  onToggleAll: (checked: boolean) => void;
  /** 用户就地确认之后才回调（参数里不带事件，见 `Popconfirm` 的 onConfirm）。 */
  onDelete: () => void;
  onClear: () => void;
  onExit: () => void;
  /** 当前筛选下全部候选数：>0 且处于多选模式时显示「全选全部」。 */
  totalCount?: number;
  selectAllPagesLoading?: boolean;
  /** 一键全选所有页（跨页）；未传时不渲染该入口。 */
  onSelectAllPages?: () => void;
  /** 勾选了条目时「导出 CSV」可用。 */
  exporting?: boolean;
  onExportCsv?: () => void;
}

export default function CandidateBatchToolbar({
  selectedCount,
  pageCount,
  allSelected,
  someSelected,
  selecting,
  batchAction,
  onToggleAll,
  onDelete,
  onClear,
  onExit,
  totalCount = 0,
  selectAllPagesLoading = false,
  onSelectAllPages,
  exporting = false,
  onExportCsv,
}: Props) {
  useLocale();
  const hasSelection = selectedCount > 0;
  const busy = batchAction !== null;
  // 工具栏整套（含选择区）只在多选模式有意义：普通模式没有勾选框（CandidateCardGrid
  // 同口径），这里兜底返回 null，双重保险防止普通模式漏渲染。
  if (!selecting) return null;
  return (
    /* marginTop 12：与上方搜索框只留一行节奏（28 是上一轮「太近」反馈的过渡值，
       用户最新截图反馈留白太多；12 与抽屉内其它 marginBottom: 12 一致）。 */
    <Space
      wrap
      size={16}
      style={{ marginTop: 12, marginBottom: 12, rowGap: 8 }}
      aria-label={t("jobs.candidate.batchToolbar.aria")}
    >
      {/* 选择区：全选本页 + 计数 + 全选全部。 */}
      <Space wrap size={8}>
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          disabled={busy}
          onChange={(event) => onToggleAll(event.target.checked)}
        >
          {t("jobs.candidate.batchToolbar.selectPage")}
        </Checkbox>
        <Typography.Text type="secondary">
          {t("jobs.candidate.batchToolbar.selectedCount", {
            selected: selectedCount,
            total: totalCount > 0 ? totalCount : pageCount,
          })}
        </Typography.Text>
        {onSelectAllPages && totalCount > 0 && (
          <Tooltip title={t("jobs.candidate.batchToolbar.selectAllTooltip", { count: totalCount })}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              disabled={busy}
              loading={selectAllPagesLoading}
              onClick={onSelectAllPages}
            >
              {t("jobs.candidate.batchToolbar.selectAll")}
            </Button>
          </Tooltip>
        )}
      </Space>
      {/* 批量操作区：进入即见，未选中时禁用（导出 CSV/批量删除/清空选择）。 */}
      <Space wrap size={8}>
        {onExportCsv && (
          <Button
            size="small"
            disabled={!hasSelection || busy}
            loading={exporting}
            onClick={onExportCsv}
          >
            {t("jobs.candidate.batchToolbar.exportCsv")}
          </Button>
        )}
        {/* 批量删除的二次确认是**就地 Popconfirm**（Popover 形态，不占容器层）：
            抽屉本身已是一层容器，`modal.confirm` 会是第二层（AGENTS.md 的 §3.7）。
            文案给全三段：动作 + 条数 + 后果（删除进回收站可恢复）。 */}
        <Popconfirm
          title={t("jobs.candidate.batch.delete-confirm", { count: selectedCount })}
          description={t("jobs.candidate.batch.delete-note", { count: selectedCount })}
          okText={t("jobs.candidate.batch.delete-action")}
          cancelText={t("common.action.cancel")}
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
          disabled={!hasSelection || busy}
        >
          <Button
            size="small"
            danger
            disabled={!hasSelection || busy}
            loading={batchAction === "delete"}
          >
            {t("jobs.candidate.batchToolbar.delete")}
          </Button>
        </Popconfirm>
        {/* 一键全清（含跨页选中）；「全选本页」再点一次只清本页。 */}
        <Button size="small" disabled={!hasSelection || busy} onClick={onClear}>
          {t("jobs.candidate.batchToolbar.clear")}
        </Button>
      </Space>
      {/* 退出区：即使什么都没选，也要能退出去。 */}
      <Button size="small" disabled={busy} onClick={onExit}>
        {t("jobs.candidate.batchToolbar.exit")}
      </Button>
    </Space>
  );
}
