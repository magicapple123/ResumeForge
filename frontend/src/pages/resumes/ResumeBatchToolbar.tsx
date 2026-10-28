// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的批量操作条：已选计数 + 全选全部 + 「批量操作」下拉 + 退出选择。
 *
 * 形态对齐岗位广场：原来独立的「批量删除」按钮收进下拉，和「批量导出」放在同一个入口；
 * 计数用次要文字色、按钮同一尺寸，不再与岗位广场各长一套。
 */
import { Button, Dropdown, Tooltip } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import BatchActionBar from "../../components/common/BatchActionBar";
import { buildResumeBatchMenuItems, type ResumeBatchAction } from "./resumeBatchActions";

export default function ResumeBatchToolbar({
  count,
  total,
  selectAllLoading,
  exporting,
  onSelectAll,
  onAction,
  onExit,
}: {
  count: number;
  total: number;
  selectAllLoading: boolean;
  exporting: boolean;
  onSelectAll: () => void;
  onAction: (action: ResumeBatchAction) => void;
  onExit: () => void;
}) {
  useLocale();
  const busy = exporting;
  return (
    // 外层留出上间距：提示条与操作条此前贴在一起，读起来像同一块内容。
    <div style={{ marginTop: 16 }}>
      <BatchActionBar count={count} onExit={onExit}>
        {total > 0 ? (
          <Tooltip title={t("resumesPage.selectAll.tooltip", { count: total })}>
            <Button loading={selectAllLoading} disabled={busy} onClick={onSelectAll}>
              {t("resumesPage.selectAll.button", { count: total })}
            </Button>
          </Tooltip>
        ) : null}
        <Dropdown
          disabled={count === 0 || busy}
          menu={{ items: buildResumeBatchMenuItems(onAction, count === 0 || busy) }}
          trigger={["click"]}
        >
          <Button disabled={count === 0 || busy} loading={exporting}>
            {t("resumesPage.batch.actions")}
          </Button>
        </Dropdown>
      </BatchActionBar>
    </div>
  );
}
